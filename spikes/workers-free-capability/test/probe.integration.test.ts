import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isProbeAuthorized,
  runAtomicProbe,
  runJwtRevocationProbe,
  runPasswordProbe,
  runRollbackProbe,
} from "../src/probe";

const tableNames = [
  "probe_sessions",
  "probe_users",
  "probe_import_runs",
  "probe_audit_logs",
  "probe_roster_entries",
  "probe_participants",
  "probe_runs",
] as const;

async function countRows(table: (typeof tableNames)[number], runId: string) {
  const runColumn = table === "probe_runs" ? "id" : "run_id";
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${runColumn} = ?`,
  )
    .bind(runId)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

beforeEach(async () => {
  await env.DB.batch(
    tableNames.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
});

describe("D1 capability probes", () => {
  it("atomically commits the maximum 130-row all-CREATE import shape", async () => {
    const runId = "atomic-local";

    const result = await runAtomicProbe(env.DB, runId);

    expect(result).toMatchObject({
      scenario: "atomic",
      scenarioPassed: true,
      committedRows: 392,
    });
    await expect(countRows("probe_runs", runId)).resolves.toBe(1);
    await expect(countRows("probe_participants", runId)).resolves.toBe(130);
    await expect(countRows("probe_roster_entries", runId)).resolves.toBe(130);
    await expect(countRows("probe_audit_logs", runId)).resolves.toBe(130);
    await expect(countRows("probe_import_runs", runId)).resolves.toBe(1);
  });

  it("rolls every table back when one statement in the batch fails", async () => {
    const runId = "rollback-local";

    const result = await runRollbackProbe(env.DB, runId);

    expect(result).toMatchObject({
      scenario: "rollback",
      scenarioPassed: true,
      rollbackRows: 0,
    });
    for (const table of tableNames.slice(2)) {
      await expect(countRows(table, runId)).resolves.toBe(0);
    }
  });

  it("rejects both old JWTs after a D1-backed password-change revocation", async () => {
    const result = await runJwtRevocationProbe(
      env.DB,
      "jwt-local",
      "local-signing-key",
    );

    expect(result).toMatchObject({
      scenario: "jwt-revocation",
      scenarioPassed: true,
      jwtVerified: true,
      revokedJwtRejected: true,
      changedPasswordRevokedBothSessions: true,
    });
    const sessions = await env.DB.prepare(
      "SELECT session_version, revoked_at FROM probe_sessions ORDER BY id",
    ).all<{ session_version: number; revoked_at: string | null }>();
    expect(sessions.results).toHaveLength(2);
    expect(sessions.results).toEqual([
      expect.objectContaining({
        session_version: 1,
        revoked_at: expect.any(String),
      }),
      expect.objectContaining({
        session_version: 1,
        revoked_at: expect.any(String),
      }),
    ]);
  });
});

describe("probe secret", () => {
  it("fails closed when the configured or supplied secret is absent", () => {
    expect(isProbeAuthorized(undefined, undefined)).toBe(false);
    expect(isProbeAuthorized("", "")).toBe(false);
    expect(isProbeAuthorized("configured", undefined)).toBe(false);
    expect(isProbeAuthorized(undefined, "configured")).toBe(false);
  });

  it("accepts only an exact secret match", () => {
    expect(isProbeAuthorized("configured", "configured")).toBe(true);
    expect(isProbeAuthorized("configured", "different")).toBe(false);
  });
});

describe("password capability probe", () => {
  it("runs one 600,000-iteration candidate derivation for every warmed correct request", async () => {
    let derivations = 0;
    const derive = async (password: string) => {
      derivations += 1;
      return Uint8Array.of(password === "temporary-password-123" ? 1 : 2);
    };

    await runPasswordProbe("correct", "per-request-pepper", derive);
    await runPasswordProbe("correct", "per-request-pepper", derive);

    expect(derivations).toBe(2);
  });
});
