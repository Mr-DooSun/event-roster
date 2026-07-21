import { DomainError } from "@event-roster/domain";
import { BcryptPasswordHasher } from "../auth/password";
import { createRefreshToken } from "../auth/refresh-token";
import { runGuardedAtomic } from "../db/atomic";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createRecoveryCodeHash } from "./recovery";

const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const hasher = new BcryptPasswordHasher();

export async function createBootstrapAccount(
  env: Env,
  input: { loginId: string; displayName: string; password: string },
  now = new Date(),
): Promise<void> {
  let passwordHash: string;
  try {
    passwordHash = await hasher.hash(input.password);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const userId = crypto.randomUUID();
  const nowIso = now.toISOString();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
           (id, login_id, login_id_canonical, display_name, role, is_active,
            is_bootstrap, session_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'OPERATOR', 1, 1, 1, ?, ?)`,
      ).bind(
        userId,
        input.loginId,
        input.loginId,
        input.displayName,
        nowIso,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO password_credentials
           (user_id, password_hash, must_change_password, changed_at)
           VALUES (?, ?, 0, ?)`,
      ).bind(userId, passwordHash, nowIso),
      env.DB.prepare(
        "INSERT INTO bootstrap_locks (id, bootstrap_user_id) VALUES (1, ?)",
      ).bind(userId),
    ]);
  } catch (error) {
    if (isConstraintConflict(error)) throw new DomainError("CONFLICT");
    throw error;
  }
}

export async function createFirstOperator(
  env: Env,
  actor: Actor,
  input: { loginId: string; displayName: string },
  now = new Date(),
): Promise<{ temporaryPassword: string; recoveryCode: string }> {
  if (
    !actor.session.user.isBootstrap ||
    actor.session.user.role !== "OPERATOR"
  ) {
    throw new DomainError("FORBIDDEN");
  }
  const lock = await env.DB.prepare(
    "SELECT consumed_at FROM bootstrap_locks WHERE id = 1",
  ).first<{ consumed_at: string | null }>();
  if (!lock || lock.consumed_at) throw new DomainError("CONFLICT");

  const temporaryPassword = createTemporaryPassword();
  const recoveryCode = createRefreshToken();
  let passwordHash: string;
  try {
    passwordHash = await hasher.hash(temporaryPassword);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const recoveryHash = await createRecoveryCodeHash(
    recoveryCode,
    env.RECOVERY_CODE_PEPPER,
  );
  const userId = crypto.randomUUID();
  const nowIso = now.toISOString();
  const guardId = crypto.randomUUID();

  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: env.DB.prepare(
      `INSERT INTO operation_guards (id, ok)
         VALUES (?, CASE WHEN
           EXISTS (SELECT 1 FROM bootstrap_locks WHERE id = 1 AND consumed_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM users WHERE is_bootstrap = 0)
         THEN 1 ELSE 0 END)`,
    ).bind(guardId),
    statements: [
      env.DB.prepare(
        `INSERT INTO users
           (id, login_id, login_id_canonical, display_name, role, is_active,
            is_bootstrap, session_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'OPERATOR', 1, 0, 1, ?, ?)`,
      ).bind(
        userId,
        input.loginId,
        input.loginId,
        input.displayName,
        nowIso,
        nowIso,
      ),
      env.DB.prepare(
        `INSERT INTO password_credentials
           (user_id, password_hash, must_change_password, changed_at)
           VALUES (?, ?, 1, ?)`,
      ).bind(userId, passwordHash, nowIso),
      env.DB.prepare(
        `INSERT INTO recovery_codes (id, user_id, code_hash, issued_at)
           VALUES (?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), userId, recoveryHash, nowIso),
    ],
    failureCode: "CONFLICT",
  });

  return { temporaryPassword, recoveryCode };
}

function createTemporaryPassword(): string {
  const random = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(
    random,
    (value) =>
      TEMPORARY_PASSWORD_ALPHABET[value % TEMPORARY_PASSWORD_ALPHABET.length],
  ).join("");
}

function isConstraintConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("SQLITE_CONSTRAINT") ||
    error.message.includes("UNIQUE constraint")
  );
}
