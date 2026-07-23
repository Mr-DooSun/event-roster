import type { Role } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { BcryptPasswordHasher } from "../auth/password";
import { findAdminUserState, listUsers } from "../db/admin";
import { runGuardedAtomic } from "../db/atomic";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { requireOperator } from "../middleware/authorization";

const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const hasher = new BcryptPasswordHasher();

export function requireAdministrativeOperator(actor: Actor): void {
  requireOperator(actor);
  if (actor.session.user.isBootstrap) throw new DomainError("FORBIDDEN");
}

export async function getUsers(env: Env) {
  return listUsers(env.DB);
}

export async function createUser(
  env: Env,
  actor: Actor,
  input: {
    loginId: string;
    displayName: string;
    role: Role;
  },
) {
  const temporaryPassword = createTemporaryPassword();
  let passwordHash: string;
  try {
    passwordHash = await hasher.hash(temporaryPassword);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO users
       (id, login_id, login_id_canonical, display_name, role, is_active,
        is_bootstrap, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, 1, ?, ?)`,
    ).bind(
      id,
      input.loginId,
      input.loginId,
      input.displayName,
      input.role,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO password_credentials
       (user_id, password_hash, must_change_password, changed_at)
       VALUES (?, ?, 1, ?)`,
    ).bind(id, passwordHash, now),
    userAuditStatement(env.DB, actor.session.user.id, "USER_CREATED", id, now, {
      userId: id,
      before: { displayName: null, role: null, isActive: null },
      after: {
        displayName: input.displayName,
        role: input.role,
        isActive: true,
      },
    }),
  ];
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        "NOT EXISTS (SELECT 1 FROM users WHERE login_id_canonical = ?)",
        [input.loginId],
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    throwConstraintConflict(error);
  }
  return { id, temporaryPassword };
}

export async function updateUser(
  env: Env,
  actor: Actor,
  id: string,
  input: {
    displayName?: string | undefined;
    role?: Role | undefined;
    isActive?: boolean | undefined;
  },
) {
  const current = await findAdminUserState(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  const displayName = input.displayName ?? current.displayName;
  const role = input.role ?? current.role;
  const isActive = input.isActive ?? current.isActive;
  const profileChanged =
    displayName !== current.displayName || role !== current.role;
  const activeChanged = isActive !== current.isActive;
  const securityChange = role !== current.role || activeChanged;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (profileChanged || activeChanged) {
    statements.push(
      env.DB.prepare(
        `UPDATE users SET display_name = ?, role = ?, is_active = ?,
         session_version = session_version + ?, updated_at = ? WHERE id = ?`,
      ).bind(
        displayName,
        role,
        isActive ? 1 : 0,
        securityChange ? 1 : 0,
        now,
        id,
      ),
    );
  }
  if (securityChange) {
    statements.push(
      env.DB.prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      ).bind(now, id),
      env.DB.prepare(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
         WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)`,
      ).bind(now, id),
    );
  }
  const auditDetails = {
    userId: id,
    before: {
      displayName: current.displayName,
      role: current.role,
      isActive: current.isActive,
    },
    after: { displayName, role, isActive },
  };
  if (profileChanged) {
    statements.push(
      userAuditStatement(
        env.DB,
        actor.session.user.id,
        "USER_UPDATED",
        id,
        now,
        auditDetails,
      ),
    );
  }
  if (activeChanged) {
    statements.push(
      userAuditStatement(
        env.DB,
        actor.session.user.id,
        isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        id,
        now,
        auditDetails,
      ),
    );
  }
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM users WHERE id = ? AND is_bootstrap = 0 AND session_version = ?
      ) AND (? <> 'OPERATOR' OR NOT EXISTS (
        SELECT 1 FROM user_organizations WHERE user_id = ?
      ))`,
      [id, current.sessionVersion, role, id],
    ),
    statements,
    failureCode: "CONFLICT",
  });
  return {
    id: current.id,
    loginId: current.loginId,
    displayName,
    role,
    isActive,
    organizationIds: current.organizationIds,
  };
}

export async function resetUserPassword(env: Env, actor: Actor, id: string) {
  const current = await findAdminUserState(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  const temporaryPassword = createTemporaryPassword();
  let passwordHash: string;
  try {
    passwordHash = await hasher.hash(temporaryPassword);
  } catch {
    throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
  }
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE password_credentials SET password_hash = ?, must_change_password = 1,
       changed_at = ? WHERE user_id = ?`,
    ).bind(passwordHash, now, id),
    env.DB.prepare(
      "UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?",
    ).bind(now, id),
    env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
    ).bind(now, id),
    env.DB.prepare(
      `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
       WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)`,
    ).bind(now, id),
    userAuditStatement(
      env.DB,
      actor.session.user.id,
      "PASSWORD_RESET",
      id,
      now,
      { userId: id },
    ),
  ];
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM users u
         JOIN password_credentials p ON p.user_id = u.id
         WHERE u.id = ? AND u.is_bootstrap = 0
           AND u.session_version = ? AND p.password_hash = ?
       )`,
      [id, current.sessionVersion, current.passwordHash],
    ),
    statements,
    failureCode: "CONFLICT",
  });
  return { id, temporaryPassword };
}

export function createOperatorGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  operationPredicate: string,
  operationBindings: Array<string | number>,
) {
  return db
    .prepare(
      `INSERT INTO operation_guards (id, ok)
       VALUES (?, CASE WHEN EXISTS (
         SELECT 1 FROM users u
         JOIN auth_sessions s ON s.user_id = u.id
         WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL
           AND u.is_active = 1 AND u.is_bootstrap = 0 AND u.role = 'OPERATOR'
           AND s.kind = 'FULL' AND u.session_version = ? AND s.session_version = ?
       ) AND (${operationPredicate}) THEN 1 ELSE 0 END)`,
    )
    .bind(
      guardId,
      actor.session.user.id,
      actor.session.id,
      actor.claims.sv,
      actor.claims.sv,
      ...operationBindings,
    );
}

function createTemporaryPassword(): string {
  const random = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(
    random,
    (value) =>
      TEMPORARY_PASSWORD_ALPHABET[value % TEMPORARY_PASSWORD_ALPHABET.length],
  ).join("");
}

function userAuditStatement(
  db: D1Database,
  actorUserId: string,
  action: string,
  userId: string,
  occurredAt: string,
  details: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'USER', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      userId,
      occurredAt,
      JSON.stringify(details),
    );
}

function throwConstraintConflict(error: unknown): never {
  if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
    throw new DomainError("CONFLICT");
  }
  throw error;
}
