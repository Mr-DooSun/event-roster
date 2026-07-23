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
    organizationIds: string[];
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
    ...input.organizationIds.map((organizationId) =>
      env.DB.prepare(
        `INSERT INTO user_organizations
         (user_id, organization_id, assignment_role, assigned_by, assigned_at)
         VALUES (?, ?, 'MANAGER', ?, ?)`,
      ).bind(id, organizationId, actor.session.user.id, now),
    ),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'USER_CREATED', 'USER', ?, ?, '{}')`,
    ).bind(crypto.randomUUID(), actor.session.user.id, id, now),
  ];
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `NOT EXISTS (SELECT 1 FROM users WHERE login_id_canonical = ?)
         AND ${activeOrganizationsPredicate(input.organizationIds)}`,
        [input.loginId, ...input.organizationIds, input.organizationIds.length],
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
    organizationIds?: string[] | undefined;
  },
) {
  const current = await findAdminUserState(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  const nextOrganizationIds = input.organizationIds ?? current.organizationIds;
  const organizationIdsToValidate = input.organizationIds ?? [];
  const securityChange =
    (input.role !== undefined && input.role !== current.role) ||
    (input.isActive !== undefined && input.isActive !== current.isActive) ||
    (input.organizationIds !== undefined &&
      !sameIds(input.organizationIds, current.organizationIds));
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE users SET display_name = COALESCE(?, display_name),
       role = COALESCE(?, role), is_active = COALESCE(?, is_active),
       session_version = session_version + ?, updated_at = ? WHERE id = ?`,
    ).bind(
      input.displayName ?? null,
      input.role ?? null,
      input.isActive === undefined ? null : input.isActive ? 1 : 0,
      securityChange ? 1 : 0,
      now,
      id,
    ),
  ];
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
  if (input.organizationIds) {
    statements.push(
      env.DB.prepare("DELETE FROM user_organizations WHERE user_id = ?").bind(
        id,
      ),
      ...input.organizationIds.map((organizationId) =>
        env.DB.prepare(
          `INSERT INTO user_organizations
           (user_id, organization_id, assignment_role, assigned_by, assigned_at)
           VALUES (?, ?, 'MANAGER', ?, ?)`,
        ).bind(id, organizationId, actor.session.user.id, now),
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'USER_UPDATED', 'USER', ?, ?, '{}')`,
    ).bind(crypto.randomUUID(), actor.session.user.id, id, now),
  );
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM users WHERE id = ? AND is_bootstrap = 0 AND session_version = ?
      ) AND ${activeOrganizationsPredicate(organizationIdsToValidate)}`,
      [
        id,
        current.sessionVersion,
        ...organizationIdsToValidate,
        organizationIdsToValidate.length,
      ],
    ),
    statements,
    failureCode: "CONFLICT",
  });
  return {
    id: current.id,
    loginId: current.loginId,
    displayName: input.displayName ?? current.displayName,
    role: input.role ?? current.role,
    isActive: input.isActive ?? current.isActive,
    organizationIds: nextOrganizationIds,
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
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'PASSWORD_RESET', 'USER', ?, ?, '{}')`,
    ).bind(crypto.randomUUID(), actor.session.user.id, id, now),
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

function activeOrganizationsPredicate(ids: string[]): string {
  if (ids.length === 0) return "? = 0";
  return `(SELECT COUNT(*) FROM organizations
           WHERE is_active = 1 AND id IN (${ids.map(() => "?").join(",")})) = ?`;
}

function sameIds(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
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

function throwConstraintConflict(error: unknown): never {
  if (
    error instanceof Error &&
    (error.message.includes("SQLITE_CONSTRAINT") ||
      error.message.includes("UNIQUE constraint"))
  ) {
    throw new DomainError("CONFLICT");
  }
  throw error;
}
