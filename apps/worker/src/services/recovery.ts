import { DomainError } from "@event-roster/domain";
import { BcryptPasswordHasher } from "../auth/password";
import { encodeBase64Url } from "../auth/refresh-token";
import { runGuardedAtomic } from "../db/atomic";
import { findUserByLoginId } from "../db/auth";
import type { Env } from "../env";

const hasher = new BcryptPasswordHasher();

export async function createRecoveryCodeHash(
  rawCode: string,
  pepper: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawCode),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function recoverAccount(
  env: Env,
  input: { loginId: string; recoveryCode: string; newPassword: string },
  now = new Date(),
): Promise<void> {
  const user = await findUserByLoginId(env.DB, input.loginId);
  if (!user?.isActive) throw new DomainError("INVALID_RECOVERY_CODE");

  const codeHash = await createRecoveryCodeHash(
    input.recoveryCode,
    env.RECOVERY_CODE_PEPPER,
  );
  const recoveryCode = await env.DB.prepare(
    `SELECT id FROM recovery_codes
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND revoked_at IS NULL`,
  )
    .bind(user.id, codeHash)
    .first<{ id: string }>();
  if (!recoveryCode) throw new DomainError("INVALID_RECOVERY_CODE");

  let passwordHash: string;
  try {
    passwordHash = await hasher.hash(input.newPassword);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const nowIso = now.toISOString();
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE recovery_codes SET used_at = ?
         WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND revoked_at IS NULL`,
    ).bind(nowIso, user.id, codeHash),
    env.DB.prepare(
      `UPDATE password_credentials
         SET password_hash = ?, must_change_password = 0, changed_at = ?
         WHERE user_id = ?`,
    ).bind(passwordHash, nowIso, user.id),
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

  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: env.DB.prepare(
      `INSERT INTO operation_guards (id, ok)
         VALUES (?, CASE WHEN EXISTS (
           SELECT 1 FROM recovery_codes
           WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND revoked_at IS NULL
         ) THEN 1 ELSE 0 END)`,
    ).bind(guardId, user.id, codeHash),
    statements,
    failureCode: "INVALID_RECOVERY_CODE",
  });
}
