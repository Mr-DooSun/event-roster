import { issueSessionJwt, verifySessionJwt } from "./jwt";
import { derivePassword } from "./password";

export type ProbeScenario =
  | "correct"
  | "wrong"
  | "nonexistent"
  | "jwt-revocation"
  | "atomic"
  | "rollback";

export interface ProbeResponse {
  scenario: ProbeScenario;
  scenarioPassed: boolean;
  passwordVerified?: boolean;
  jwtVerified?: boolean;
  revokedJwtRejected?: boolean;
  changedPasswordRevokedBothSessions?: boolean;
  committedRows?: number;
  rollbackRows?: number;
}

const IMPORT_ROWS = 130;
const ATOMIC_STATEMENT_COUNT = 1 + IMPORT_ROWS * 3 + 1;
const PASSWORD_PROBE_SALT = Uint8Array.from([
  0x45, 0x52, 0x2d, 0x43, 0x41, 0x50, 0x41, 0x42, 0x49, 0x4c, 0x49, 0x54, 0x59,
  0x2d, 0x30, 0x31,
]);
const EXPECTED_PASSWORD = "temporary-password-123";
let expectedPasswordHash:
  | { pepper: string; promise: Promise<Uint8Array> }
  | undefined;

type PasswordDeriver = (
  password: string,
  pepper: string,
  salt: Uint8Array<ArrayBuffer>,
) => Promise<Uint8Array>;

export function isProbeAuthorized(
  configuredSecret: string | undefined,
  suppliedSecret: string | undefined,
): boolean {
  return (
    configuredSecret !== undefined &&
    suppliedSecret !== undefined &&
    configuredSecret.length > 0 &&
    suppliedSecret.length > 0 &&
    configuredSecret === suppliedSecret
  );
}

function getExpectedPasswordHash(
  pepper: string,
  derive: PasswordDeriver,
  correctCandidate?: Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (expectedPasswordHash?.pepper !== pepper) {
    expectedPasswordHash = {
      pepper,
      promise: correctCandidate
        ? correctCandidate.then((value) => value.slice())
        : derive(EXPECTED_PASSWORD, pepper, PASSWORD_PROBE_SALT),
    };
  }
  return expectedPasswordHash.promise;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function runPasswordProbe(
  scenario: "correct" | "wrong" | "nonexistent",
  pepper: string,
  derive: PasswordDeriver = derivePassword,
): Promise<ProbeResponse> {
  const candidate = derive(
    scenario === "correct"
      ? EXPECTED_PASSWORD
      : scenario === "wrong"
        ? "different-password-123"
        : "nonexistent-user-password-123",
    pepper,
    PASSWORD_PROBE_SALT,
  );
  const expected = getExpectedPasswordHash(
    pepper,
    derive,
    scenario === "correct" ? candidate : undefined,
  );
  const passwordVerified = equalBytes(await candidate, await expected);
  return {
    scenario,
    scenarioPassed:
      scenario === "correct" ? passwordVerified : !passwordVerified,
    passwordVerified,
  };
}

async function countImportRows(db: D1Database, runId: string): Promise<number> {
  const queries = [
    ["probe_runs", "id"],
    ["probe_participants", "run_id"],
    ["probe_roster_entries", "run_id"],
    ["probe_audit_logs", "run_id"],
    ["probe_import_runs", "run_id"],
  ] as const;
  const results = await db.batch(
    queries.map(([table, column]) =>
      db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
        .bind(runId),
    ),
  );
  return results.reduce((total, result) => {
    const row = result.results[0] as { count?: number } | undefined;
    return total + (row?.count ?? 0);
  }, 0);
}

export async function runAtomicProbe(
  db: D1Database,
  runId: string,
): Promise<ProbeResponse> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO probe_runs (id, created_at) VALUES (?, ?)")
      .bind(runId, new Date().toISOString()),
  ];
  for (let row = 1; row <= IMPORT_ROWS; row += 1) {
    const participantNumber = String(row).padStart(4, "0");
    statements.push(
      db
        .prepare(
          "INSERT INTO probe_participants (id, run_id, participant_number) VALUES (?, ?, ?)",
        )
        .bind(`${runId}-participant-${row}`, runId, participantNumber),
      db
        .prepare(
          "INSERT INTO probe_roster_entries (id, run_id, participant_number) VALUES (?, ?, ?)",
        )
        .bind(`${runId}-roster-${row}`, runId, participantNumber),
      db
        .prepare(
          "INSERT INTO probe_audit_logs (id, run_id, action) VALUES (?, ?, ?)",
        )
        .bind(`${runId}-audit-${row}`, runId, "CREATE"),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO probe_import_runs (id, run_id, row_count) VALUES (?, ?, ?)",
      )
      .bind(`${runId}-import`, runId, IMPORT_ROWS),
  );

  await db.batch(statements);
  const committedRows = await countImportRows(db, runId);
  return {
    scenario: "atomic",
    scenarioPassed: committedRows === ATOMIC_STATEMENT_COUNT,
    committedRows,
  };
}

export async function runRollbackProbe(
  db: D1Database,
  runId: string,
): Promise<ProbeResponse> {
  let failed = false;
  try {
    await db.batch([
      db
        .prepare("INSERT INTO probe_runs (id, created_at) VALUES (?, ?)")
        .bind(runId, new Date().toISOString()),
      db
        .prepare("INSERT INTO probe_runs (id, created_at) VALUES (?, ?)")
        .bind(runId, new Date().toISOString()),
    ]);
  } catch {
    failed = true;
  }
  const rollbackRows = await countImportRows(db, runId);
  return {
    scenario: "rollback",
    scenarioPassed: failed && rollbackRows === 0,
    rollbackRows,
  };
}

async function verifyPersistedSession(
  db: D1Database,
  token: string,
  signingKey: string,
  now: Date,
): Promise<boolean> {
  try {
    const claims = await verifySessionJwt(token, signingKey, now);
    const row = await db
      .prepare(
        `SELECT s.session_version AS session_version,
                s.revoked_at AS revoked_at,
                u.session_version AS user_session_version
           FROM probe_sessions s
           JOIN probe_users u ON u.id = s.user_id
          WHERE s.id = ? AND s.user_id = ?`,
      )
      .bind(claims.sid, claims.sub)
      .first<{
        session_version: number;
        revoked_at: string | null;
        user_session_version: number;
      }>();
    return (
      row !== null &&
      row.revoked_at === null &&
      row.session_version === claims.sv &&
      row.user_session_version === claims.sv
    );
  } catch {
    return false;
  }
}

export async function runJwtRevocationProbe(
  db: D1Database,
  runId: string,
  signingKey: string,
): Promise<ProbeResponse> {
  const userId = `user-${runId}`;
  const sessionIds = [`session-${runId}-1`, `session-${runId}-2`] as const;
  await db.batch([
    db
      .prepare("INSERT INTO probe_users (id, session_version) VALUES (?, 1)")
      .bind(userId),
    ...sessionIds.map((sessionId) =>
      db
        .prepare(
          "INSERT INTO probe_sessions (id, user_id, session_version, revoked_at) VALUES (?, ?, 1, NULL)",
        )
        .bind(sessionId, userId),
    ),
  ]);

  const issuedAt = new Date();
  const tokens = await Promise.all(
    sessionIds.map((sessionId) =>
      issueSessionJwt(
        { sub: userId, sid: sessionId, sv: 1, kind: "FULL" },
        signingKey,
        issuedAt,
      ),
    ),
  );
  const beforeRevocation = await Promise.all(
    tokens.map((token) =>
      verifyPersistedSession(db, token, signingKey, issuedAt),
    ),
  );

  const revokedAt = new Date(issuedAt.getTime() + 1_000).toISOString();
  await db.batch([
    db
      .prepare("UPDATE probe_users SET session_version = 2 WHERE id = ?")
      .bind(userId),
    db
      .prepare("UPDATE probe_sessions SET revoked_at = ? WHERE user_id = ?")
      .bind(revokedAt, userId),
  ]);
  const afterRevocation = await Promise.all(
    tokens.map((token) =>
      verifyPersistedSession(
        db,
        token,
        signingKey,
        new Date(issuedAt.getTime() + 2_000),
      ),
    ),
  );
  const persisted = await db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM probe_sessions s
         JOIN probe_users u ON u.id = s.user_id
        WHERE s.user_id = ?
          AND s.revoked_at IS NOT NULL
          AND u.session_version = 2`,
    )
    .bind(userId)
    .first<{ count: number }>();
  const jwtVerified = beforeRevocation.every(Boolean);
  const revokedJwtRejected = afterRevocation.every((value) => !value);
  const changedPasswordRevokedBothSessions = persisted?.count === 2;
  return {
    scenario: "jwt-revocation",
    scenarioPassed:
      jwtVerified && revokedJwtRejected && changedPasswordRevokedBothSessions,
    jwtVerified,
    revokedJwtRejected,
    changedPasswordRevokedBothSessions,
  };
}
