import type { AuthSuccess, SessionKind } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { issueAccessToken } from "../auth/access-token";
import { createCsrfToken, hashCsrfToken } from "../auth/csrf";
import { BcryptPasswordHasher } from "../auth/password";
import {
  createIpRateLimitKey,
  createLoginRateLimitKey,
} from "../auth/rate-limit";
import {
  createRefreshCookie,
  createRefreshToken,
  hashRefreshToken,
} from "../auth/refresh-token";
import { runGuardedAtomic } from "../db/atomic";
import {
  type AuthUserRecord,
  findRefreshByHash,
  findUserById,
  findUserByLoginId,
  revokeSessionFamily,
} from "../db/auth";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";

const SESSION_TTL_MS = 604_800_000;
const RATE_WINDOW_MS = 900_000;
const RATE_LIMIT = 5;
const hasher = new BcryptPasswordHasher();

export interface AuthIssueResult {
  body: AuthSuccess;
  refreshCookie: string;
}

export async function loginWithCredentials(
  env: Env,
  input: { loginId: string; password: string; clientIp: string | null },
  now = new Date(),
): Promise<AuthIssueResult> {
  const loginKey = await createLoginRateLimitKey(
    env.IP_HASH_KEY,
    input.loginId,
  );
  const ipKey = await createIpRateLimitKey(
    env.IP_HASH_KEY,
    input.clientIp ?? "missing",
  );
  if (await isRateLimited(env.DB, [loginKey, ipKey], now)) {
    throw new DomainError("RATE_LIMITED");
  }

  const candidate = await findUserByLoginId(env.DB, input.loginId);
  const usableUser = candidate?.isActive ? candidate : null;
  let verified = false;
  try {
    verified = await hasher.verify(
      input.password,
      usableUser?.passwordHash ?? env.DUMMY_BCRYPT_HASH,
    );
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }

  if (!usableUser || !verified) {
    await recordLoginFailure(env.DB, [loginKey, ipKey], now);
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  await clearLoginFailures(env.DB, [loginKey, ipKey]);
  return issueAuthSuccess(
    env,
    usableUser,
    usableUser.mustChangePassword ? "MUST_CHANGE_PASSWORD" : "FULL",
    now,
  );
}

export async function refreshAuthentication(
  env: Env,
  rawRefreshToken: string,
  now = new Date(),
): Promise<AuthIssueResult> {
  const tokenHash = await hashRefreshToken(rawRefreshToken);
  const existing = await findRefreshByHash(env.DB, tokenHash);
  if (!existing) {
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  const isReusable =
    !existing.rotatedAt &&
    !existing.revokedAt &&
    existing.expiresAt > now.toISOString() &&
    !existing.session.revokedAt &&
    existing.session.expiresAt > now.toISOString() &&
    existing.session.user.isActive &&
    existing.session.sessionVersion === existing.session.user.sessionVersion;
  if (!isReusable) {
    await revokeSessionFamily(env.DB, existing.sessionId, now.toISOString());
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  const nextRawRefresh = createRefreshToken();
  const nextRefreshHash = await hashRefreshToken(nextRawRefresh);
  const nextRawCsrf = createCsrfToken();
  const nextCsrfHash = await hashCsrfToken(nextRawCsrf);
  const nextTokenId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const nowIso = now.toISOString();

  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: env.DB.prepare(
        `INSERT INTO operation_guards (id, ok)
           VALUES (?, CASE WHEN EXISTS (
             SELECT 1 FROM refresh_tokens r
             JOIN auth_sessions s ON s.id = r.session_id
             WHERE r.id = ? AND r.rotated_at IS NULL AND r.revoked_at IS NULL
               AND r.expires_at > ? AND s.revoked_at IS NULL AND s.expires_at > ?
           ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, existing.id, nowIso, nowIso),
      statements: [
        env.DB.prepare(
          `INSERT INTO refresh_tokens
             (id, session_id, token_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          nextTokenId,
          existing.sessionId,
          nextRefreshHash,
          nowIso,
          existing.expiresAt,
        ),
        env.DB.prepare(
          `UPDATE refresh_tokens
             SET rotated_at = ?, replaced_by_id = ? WHERE id = ?`,
        ).bind(nowIso, nextTokenId, existing.id),
        env.DB.prepare(
          "UPDATE auth_sessions SET csrf_hash = ? WHERE id = ?",
        ).bind(nextCsrfHash, existing.sessionId),
      ],
      failureCode: "AUTHENTICATION_REQUIRED",
    });
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.code === "AUTHENTICATION_REQUIRED"
    ) {
      await revokeSessionFamily(env.DB, existing.sessionId, nowIso);
    }
    throw error;
  }

  const refreshedUser = await findUserById(env.DB, existing.session.userId);
  if (!refreshedUser) throw new DomainError("AUTHENTICATION_REQUIRED");
  return {
    body: await createAuthBody(
      env,
      refreshedUser,
      existing.session.kind,
      existing.sessionId,
      nextRawCsrf,
      now,
    ),
    refreshCookie: createRefreshCookie(nextRawRefresh),
  };
}

export async function changePassword(
  env: Env,
  actor: Actor,
  currentPassword: string,
  newPassword: string,
  now = new Date(),
): Promise<void> {
  const user = actor.session.user;
  let matches = false;
  try {
    matches = await hasher.verify(currentPassword, user.passwordHash);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  if (!matches) throw new DomainError("AUTHENTICATION_REQUIRED");

  let nextHash: string;
  try {
    nextHash = await hasher.hash(newPassword);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE password_credentials
         SET password_hash = ?, must_change_password = 0, changed_at = ?
         WHERE user_id = ?`,
    ).bind(nextHash, nowIso, user.id),
    env.DB.prepare(
      "UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?",
    ).bind(nowIso, user.id),
    env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
    ).bind(nowIso, user.id),
    env.DB.prepare(
      `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
         WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)`,
    ).bind(nowIso, user.id),
  ];

  if (
    !user.isBootstrap &&
    user.role === "OPERATOR" &&
    user.mustChangePassword
  ) {
    statements.push(
      env.DB.prepare(
        `UPDATE users SET is_active = 0, session_version = session_version + 1,
             updated_at = ? WHERE is_bootstrap = 1 AND is_active = 1`,
      ).bind(nowIso),
      env.DB.prepare(
        `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
           WHERE user_id IN (SELECT id FROM users WHERE is_bootstrap = 1)`,
      ).bind(nowIso),
      env.DB.prepare(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
           WHERE session_id IN (
             SELECT s.id FROM auth_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE u.is_bootstrap = 1
           )`,
      ).bind(nowIso),
      env.DB.prepare(
        "UPDATE bootstrap_locks SET consumed_at = COALESCE(consumed_at, ?) WHERE id = 1",
      ).bind(nowIso),
    );
  }

  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: env.DB.prepare(
      `INSERT INTO operation_guards (id, ok)
       VALUES (?, CASE WHEN EXISTS (
         SELECT 1 FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN password_credentials p ON p.user_id = u.id
         WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL
           AND s.expires_at > ?
           AND s.session_version = ? AND u.session_version = ?
           AND u.is_active = 1 AND p.password_hash = ?
       ) THEN 1 ELSE 0 END)`,
    ).bind(
      guardId,
      actor.session.id,
      user.id,
      nowIso,
      actor.claims.sv,
      actor.claims.sv,
      user.passwordHash,
    ),
    statements,
    failureCode: "AUTHENTICATION_REQUIRED",
  });
}

export async function revokeByRefreshToken(
  env: Env,
  rawRefreshToken: string | null,
  now = new Date(),
): Promise<void> {
  if (!rawRefreshToken) return;
  const record = await findRefreshByHash(
    env.DB,
    await hashRefreshToken(rawRefreshToken),
  );
  if (record)
    await revokeSessionFamily(env.DB, record.sessionId, now.toISOString());
}

export async function issueAuthSuccess(
  env: Env,
  user: AuthUserRecord,
  kind: SessionKind,
  now = new Date(),
): Promise<AuthIssueResult> {
  const sessionId = crypto.randomUUID();
  const refreshId = crypto.randomUUID();
  const rawRefresh = createRefreshToken();
  const rawCsrf = createCsrfToken();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_sessions
         (id, user_id, session_version, kind, csrf_hash, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      user.id,
      user.sessionVersion,
      kind,
      await hashCsrfToken(rawCsrf),
      nowIso,
      expiresAt,
    ),
    env.DB.prepare(
      `INSERT INTO refresh_tokens
         (id, session_id, token_hash, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      refreshId,
      sessionId,
      await hashRefreshToken(rawRefresh),
      nowIso,
      expiresAt,
    ),
  ]);

  return {
    body: await createAuthBody(env, user, kind, sessionId, rawCsrf, now),
    refreshCookie: createRefreshCookie(rawRefresh),
  };
}

async function createAuthBody(
  env: Env,
  user: AuthUserRecord,
  kind: SessionKind,
  sessionId: string,
  csrfToken: string,
  now: Date,
): Promise<AuthSuccess> {
  return {
    accessToken: await issueAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        sv: user.sessionVersion,
        kind,
      },
      env.JWT_SIGNING_KEY,
      now,
    ),
    csrfToken,
    session: {
      sessionKind: kind,
      user: {
        id: user.id,
        loginId: user.loginId,
        displayName: user.displayName,
        role: user.role,
        organizationIds: user.organizationIds,
        isBootstrap: user.isBootstrap,
      },
    },
  };
}

async function isRateLimited(
  db: D1Database,
  keys: string[],
  now: Date,
): Promise<boolean> {
  for (const [index, key] of keys.entries()) {
    const row = await db
      .prepare(
        "SELECT blocked_until FROM login_attempts WHERE key_hash = ? AND key_kind = ?",
      )
      .bind(key, index === 0 ? "LOGIN_ID" : "IP")
      .first<{ blocked_until: string | null }>();
    if (row?.blocked_until && row.blocked_until > now.toISOString())
      return true;
  }
  return false;
}

async function recordLoginFailure(
  db: D1Database,
  keys: string[],
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  const blockedUntil = new Date(now.getTime() + RATE_WINDOW_MS).toISOString();
  const statements = keys.map((key, index) =>
    db
      .prepare(
        `INSERT INTO login_attempts
         (key_hash, key_kind, window_started_at, failure_count, blocked_until, updated_at)
         VALUES (?, ?, ?, 1, NULL, ?)
         ON CONFLICT(key_hash, key_kind) DO UPDATE SET
           failure_count = CASE
             WHEN login_attempts.window_started_at <= ? THEN 1
             ELSE login_attempts.failure_count + 1
           END,
           blocked_until = CASE
             WHEN login_attempts.window_started_at <= ? THEN NULL
             WHEN login_attempts.failure_count + 1 >= ? THEN ?
             ELSE login_attempts.blocked_until
           END,
           window_started_at = CASE
             WHEN login_attempts.window_started_at <= ? THEN excluded.window_started_at
             ELSE login_attempts.window_started_at
           END,
           updated_at = excluded.updated_at`,
      )
      .bind(
        key,
        index === 0 ? "LOGIN_ID" : "IP",
        nowIso,
        nowIso,
        windowStart,
        windowStart,
        RATE_LIMIT,
        blockedUntil,
        windowStart,
      ),
  );
  await db.batch(statements);
}

async function clearLoginFailures(
  db: D1Database,
  keys: string[],
): Promise<void> {
  await db.batch(
    keys.map((key, index) =>
      db
        .prepare(
          "DELETE FROM login_attempts WHERE key_hash = ? AND key_kind = ?",
        )
        .bind(key, index === 0 ? "LOGIN_ID" : "IP"),
    ),
  );
}
