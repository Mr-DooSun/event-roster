import type {
  OrganizationDetail,
  OrganizationManager,
  OrganizationManagerCreateRequest,
  OrganizationPrimaryPatchRequest,
  OrganizationSummary,
} from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { BcryptPasswordHasher } from "../auth/password";
import { runGuardedAtomic } from "../db/atomic";
import {
  findOrganizationDetail,
  findOrganizationState,
  listAssignableManagerAccounts,
  listOrganizationAuditRows,
  listOrganizationSummaries,
  type OrganizationListFilters,
} from "../db/organizations";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard, requireAdministrativeOperator } from "./admin";
import {
  decodeCursor,
  encodeCursor,
  sanitizeAuditDetails,
} from "./audit-pages";

const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const passwordHasher = new BcryptPasswordHasher();

export async function getOrganizationSummaries(
  env: Env,
  actor: Actor,
  filters: OrganizationListFilters,
): Promise<OrganizationSummary[]> {
  const scopedFilters: OrganizationListFilters = {
    ...filters,
    query: filters.query.trim(),
  };
  if (actor.session.user.role !== "OPERATOR") {
    scopedFilters.visibleOrganizationIds = actor.session.user.organizationIds;
  }
  return listOrganizationSummaries(env.DB, scopedFilters);
}

export async function getOrganizationDetail(
  env: Env,
  actor: Actor,
  organizationId: string,
): Promise<OrganizationDetail> {
  requireAdministrativeOperator(actor);
  const detail = await findOrganizationDetail(env.DB, organizationId);
  if (!detail) throw new DomainError("NOT_FOUND");
  return detail;
}

export async function getAssignableManagerAccounts(
  env: Env,
  actor: Actor,
  organizationId: string,
  query: string,
): Promise<
  Array<
    Pick<OrganizationManager, "userId" | "loginId" | "displayName" | "isActive">
  >
> {
  requireAdministrativeOperator(actor);
  if (!(await findOrganizationState(env.DB, organizationId))) {
    throw new DomainError("NOT_FOUND");
  }
  return listAssignableManagerAccounts(env.DB, organizationId, query.trim());
}

export async function getOrganizationAuditPage(
  env: Env,
  actor: Actor,
  organizationId: string,
  limit: number,
  cursor: string | null,
): Promise<{
  items: Array<{
    id: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    occurredAt: string;
    details: Record<string, string>;
  }>;
  nextCursor: string | null;
}> {
  requireAdministrativeOperator(actor);
  if (!(await findOrganizationState(env.DB, organizationId))) {
    throw new DomainError("NOT_FOUND");
  }
  const page = await listOrganizationAuditRows(
    env.DB,
    organizationId,
    limit,
    cursor ? decodeCursor(cursor) : null,
  );
  const last = page.rows.at(-1);
  return {
    items: page.rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
      details: sanitizeAuditDetails(row.details_json),
    })),
    nextCursor:
      page.hasMore && last
        ? encodeCursor({ occurredAt: last.occurred_at, id: last.id })
        : null,
  };
}

export async function createOrganization(env: Env, actor: Actor, name: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const canonicalName = canonicalizeOrganizationName(name);
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        "NOT EXISTS (SELECT 1 FROM organizations WHERE canonical_name = ?)",
        [canonicalName],
      ),
      statements: [
        env.DB.prepare(
          `INSERT INTO organizations
           (id, name, canonical_name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, canonicalName, now, now),
        organizationAuditStatement(
          env.DB,
          actor.session.user.id,
          "ORGANIZATION_CREATED",
          id,
          now,
          {
            before: { name: null, isActive: null },
            after: { name, isActive: true },
          },
        ),
      ],
      failureCode: "CONFLICT",
    });
  } catch (error) {
    throwConstraintConflict(error);
  }
  return { id, name, isActive: true };
}

export async function updateOrganization(
  env: Env,
  actor: Actor,
  id: string,
  input: { name?: string | undefined; isActive?: boolean | undefined },
) {
  const current = await findOrganizationState(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  const name = input.name ?? current.name;
  const isActive = input.isActive ?? current.isActive;
  const renamed = input.name !== undefined && input.name !== current.name;
  const statusChanged =
    input.isActive !== undefined && input.isActive !== current.isActive;
  if (!renamed && !statusChanged) {
    const guardId = crypto.randomUUID();
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (
           SELECT 1 FROM organizations
           WHERE id = ? AND name = ? AND canonical_name = ? AND is_active = ?
         )`,
        [id, current.name, current.canonicalName, current.isActive ? 1 : 0],
      ),
      statements: [],
      failureCode: "CONFLICT",
    });
    return organizationMutationResult(
      id,
      name,
      isActive,
      await countActiveProjects(env.DB, id),
    );
  }

  const now = new Date().toISOString();
  const before = { name: current.name, isActive: current.isActive };
  const after = { name, isActive };
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE organizations
       SET name = ?, canonical_name = ?, is_active = ?, updated_at = ?
       WHERE id = ? AND name = ? AND canonical_name = ? AND is_active = ?`,
    ).bind(
      name,
      canonicalizeOrganizationName(name),
      isActive ? 1 : 0,
      now,
      id,
      current.name,
      current.canonicalName,
      current.isActive ? 1 : 0,
    ),
  ];
  const details = { before, after };
  if (renamed) {
    statements.push(
      organizationAuditStatement(
        env.DB,
        actor.session.user.id,
        "ORGANIZATION_RENAMED",
        id,
        now,
        details,
      ),
    );
  }
  if (statusChanged) {
    statements.push(
      organizationAuditStatement(
        env.DB,
        actor.session.user.id,
        isActive ? "ORGANIZATION_REACTIVATED" : "ORGANIZATION_DEACTIVATED",
        id,
        now,
        details,
      ),
    );
  }

  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (
           SELECT 1 FROM organizations
           WHERE id = ? AND name = ? AND canonical_name = ? AND is_active = ?
         )`,
        [id, current.name, current.canonicalName, current.isActive ? 1 : 0],
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    throwConstraintConflict(error);
  }
  return organizationMutationResult(
    id,
    name,
    isActive,
    await countActiveProjects(env.DB, id),
  );
}

export async function assignOrganizationManager(
  env: Env,
  actor: Actor,
  organizationId: string,
  input: OrganizationManagerCreateRequest,
): Promise<{
  manager: OrganizationManager;
  temporaryPassword?: string;
}> {
  const now = new Date().toISOString();
  const userId = input.kind === "NEW" ? crypto.randomUUID() : input.userId;
  const assignmentAction =
    input.assignmentRole === "PRIMARY_LEADER"
      ? "ORGANIZATION_PRIMARY_ASSIGNED"
      : "ORGANIZATION_MANAGER_ASSIGNED";
  const assignmentDetails = {
    organizationId,
    userId,
    beforeAssignmentRole: null,
    afterAssignmentRole: input.assignmentRole,
  };
  const statements: D1PreparedStatement[] = [];
  let temporaryPassword: string | undefined;

  if (input.kind === "NEW") {
    temporaryPassword = createTemporaryPassword();
    let passwordHash: string;
    try {
      passwordHash = await passwordHasher.hash(temporaryPassword);
    } catch {
      throw new DomainError("AUTH_TEMPORARILY_UNAVAILABLE");
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO users
         (id, login_id, login_id_canonical, display_name, role, is_active,
          is_bootstrap, session_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ORGANIZATION_MANAGER', 1, 0, 1, ?, ?)`,
      ).bind(
        userId,
        input.loginId,
        input.loginId.toLocaleLowerCase(),
        input.displayName,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO password_credentials
         (user_id, password_hash, must_change_password, changed_at)
         VALUES (?, ?, 1, ?)`,
      ).bind(userId, passwordHash, now),
      userAuditStatement(
        env.DB,
        actor.session.user.id,
        "USER_CREATED",
        userId,
        now,
        {
          userId,
          before: { displayName: null, role: null, isActive: null },
          after: {
            displayName: input.displayName,
            role: "ORGANIZATION_MANAGER",
            isActive: true,
          },
        },
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      organizationId,
      input.assignmentRole,
      actor.session.user.id,
      now,
    ),
  );
  if (input.kind === "EXISTING") {
    statements.push(...revokeUserSessionsStatements(env.DB, userId, now));
  }
  statements.push(
    assignmentAuditStatement(
      env.DB,
      actor.session.user.id,
      assignmentAction,
      userId,
      now,
      assignmentDetails,
    ),
  );

  const primaryPredicate =
    input.assignmentRole === "PRIMARY_LEADER"
      ? `AND NOT EXISTS (
           SELECT 1 FROM user_organizations
           WHERE organization_id = ? AND assignment_role = 'PRIMARY_LEADER'
         )`
      : "";
  const primaryBindings =
    input.assignmentRole === "PRIMARY_LEADER" ? [organizationId] : [];
  const operationPredicate =
    input.kind === "NEW"
      ? `EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
         ) AND NOT EXISTS (
           SELECT 1 FROM users WHERE login_id_canonical = ?
         ) ${primaryPredicate}`
      : `EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
         ) AND EXISTS (
           SELECT 1 FROM users
           WHERE id = ? AND role = 'ORGANIZATION_MANAGER'
             AND is_active = 1 AND is_bootstrap = 0
         ) AND NOT EXISTS (
           SELECT 1 FROM user_organizations
           WHERE user_id = ? AND organization_id = ?
         ) ${primaryPredicate}`;
  const operationBindings: Array<string | number> =
    input.kind === "NEW"
      ? [organizationId, input.loginId.toLocaleLowerCase(), ...primaryBindings]
      : [organizationId, userId, userId, organizationId, ...primaryBindings];
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        operationPredicate,
        operationBindings,
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    throwConstraintConflict(error);
  }

  const manager = await findAssignedManager(env.DB, organizationId, userId);
  if (!manager) throw new DomainError("INTERNAL_ERROR");
  return temporaryPassword ? { manager, temporaryPassword } : { manager };
}

export async function replaceOrganizationPrimary(
  env: Env,
  actor: Actor,
  organizationId: string,
  input: OrganizationPrimaryPatchRequest,
): Promise<OrganizationDetail> {
  const currentPrimaryUserId = await findPrimaryUserId(env.DB, organizationId);
  const organization = await findOrganizationState(env.DB, organizationId);
  if (!organization) throw new DomainError("NOT_FOUND");
  if (currentPrimaryUserId !== input.expectedPrimaryUserId) {
    throw new DomainError("CONFLICT");
  }

  const exactPrimaryPredicate = `COALESCE((
    SELECT user_id FROM user_organizations
    WHERE organization_id = ? AND assignment_role = 'PRIMARY_LEADER'
  ), '') = ?`;
  const targetPredicate = input.userId
    ? `AND EXISTS (
         SELECT 1 FROM user_organizations target_assignment
         JOIN users target_user ON target_user.id = target_assignment.user_id
         WHERE target_assignment.organization_id = ?
           AND target_assignment.user_id = ?
           AND target_assignment.assignment_role = 'MANAGER'
           AND target_user.role = 'ORGANIZATION_MANAGER'
           AND target_user.is_active = 1 AND target_user.is_bootstrap = 0
       )`
    : "";
  const operationPredicate = `EXISTS (
    SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
  ) AND ${exactPrimaryPredicate} ${targetPredicate}`;
  const operationBindings: Array<string | number> = [
    organizationId,
    organizationId,
    input.expectedPrimaryUserId ?? "",
  ];
  if (input.userId) {
    operationBindings.push(organizationId, input.userId);
  }

  const guardId = crypto.randomUUID();
  if (input.userId === currentPrimaryUserId) {
    const currentAccountPredicate = input.userId
      ? `AND EXISTS (
          SELECT 1 FROM user_organizations current_assignment
          JOIN users current_user ON current_user.id = current_assignment.user_id
          WHERE current_assignment.organization_id = ?
            AND current_assignment.user_id = ?
            AND current_assignment.assignment_role = 'PRIMARY_LEADER'
            AND current_user.role = 'ORGANIZATION_MANAGER'
            AND current_user.is_active = 1 AND current_user.is_bootstrap = 0
        )`
      : "";
    const noOpPredicate = `EXISTS (
      SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
    ) AND ${exactPrimaryPredicate} ${currentAccountPredicate}`;
    const noOpBindings: Array<string | number> = [
      organizationId,
      organizationId,
      input.expectedPrimaryUserId ?? "",
    ];
    if (input.userId) {
      noOpBindings.push(organizationId, input.userId);
    }
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        noOpPredicate,
        noOpBindings,
      ),
      statements: [],
      failureCode: "CONFLICT",
    });
    return requireOrganizationDetail(env.DB, organizationId);
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (currentPrimaryUserId) {
    if (input.previousPrimaryDisposition === "MANAGER" && input.userId) {
      statements.push(
        env.DB.prepare(
          `UPDATE user_organizations SET assignment_role = 'MANAGER'
           WHERE organization_id = ? AND user_id = ?
             AND assignment_role = 'PRIMARY_LEADER'`,
        ).bind(organizationId, currentPrimaryUserId),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `DELETE FROM user_organizations
           WHERE organization_id = ? AND user_id = ?
             AND assignment_role = 'PRIMARY_LEADER'`,
        ).bind(organizationId, currentPrimaryUserId),
      );
    }
  }
  if (input.userId) {
    statements.push(
      env.DB.prepare(
        `UPDATE user_organizations SET assignment_role = 'PRIMARY_LEADER'
         WHERE organization_id = ? AND user_id = ? AND assignment_role = 'MANAGER'`,
      ).bind(organizationId, input.userId),
    );
  }
  const affectedUserIds = new Set(
    [currentPrimaryUserId, input.userId].filter(
      (userId): userId is string => userId !== null,
    ),
  );
  for (const userId of affectedUserIds) {
    statements.push(...revokeUserSessionsStatements(env.DB, userId, now));
  }
  const action = input.userId
    ? currentPrimaryUserId
      ? "ORGANIZATION_PRIMARY_REPLACED"
      : "ORGANIZATION_PRIMARY_ASSIGNED"
    : "ORGANIZATION_PRIMARY_REMOVED";
  statements.push(
    assignmentAuditStatement(
      env.DB,
      actor.session.user.id,
      action,
      input.userId ?? currentPrimaryUserId ?? organizationId,
      now,
      {
        organizationId,
        previousPrimaryUserId: currentPrimaryUserId,
        primaryUserId: input.userId,
        previousPrimaryDisposition: input.previousPrimaryDisposition,
      },
    ),
  );

  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        operationPredicate,
        operationBindings,
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    throwConstraintConflict(error);
  }
  return requireOrganizationDetail(env.DB, organizationId);
}

export async function removeOrganizationManager(
  env: Env,
  actor: Actor,
  organizationId: string,
  userId: string,
): Promise<void> {
  if (!(await findOrganizationState(env.DB, organizationId))) {
    throw new DomainError("NOT_FOUND");
  }
  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM user_organizations
         WHERE organization_id = ? AND user_id = ?
           AND assignment_role = 'MANAGER'
       )`,
      [organizationId, userId],
    ),
    statements: [
      env.DB.prepare(
        `DELETE FROM user_organizations
         WHERE organization_id = ? AND user_id = ?
           AND assignment_role = 'MANAGER'`,
      ).bind(organizationId, userId),
      ...revokeUserSessionsStatements(env.DB, userId, now),
      assignmentAuditStatement(
        env.DB,
        actor.session.user.id,
        "ORGANIZATION_MANAGER_REMOVED",
        userId,
        now,
        {
          organizationId,
          userId,
          beforeAssignmentRole: "MANAGER",
          afterAssignmentRole: null,
        },
      ),
    ],
    failureCode: "CONFLICT",
  });
}

export function canonicalizeOrganizationName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

async function findAssignedManager(
  db: D1Database,
  organizationId: string,
  userId: string,
): Promise<OrganizationManager | null> {
  const detail = await findOrganizationDetail(db, organizationId);
  return detail?.managers.find((manager) => manager.userId === userId) ?? null;
}

async function findPrimaryUserId(
  db: D1Database,
  organizationId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT user_id FROM user_organizations
       WHERE organization_id = ? AND assignment_role = 'PRIMARY_LEADER'`,
    )
    .bind(organizationId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

async function requireOrganizationDetail(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationDetail> {
  const detail = await findOrganizationDetail(db, organizationId);
  if (!detail) throw new DomainError("INTERNAL_ERROR");
  return detail;
}

function revokeUserSessionsStatements(
  db: D1Database,
  userId: string,
  occurredAt: string,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        "UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?",
      )
      .bind(occurredAt, userId),
    db
      .prepare(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
         WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)`,
      )
      .bind(occurredAt, userId),
    db
      .prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      )
      .bind(occurredAt, userId),
  ];
}

function assignmentAuditStatement(
  db: D1Database,
  actorUserId: string,
  action: string,
  entityId: string,
  occurredAt: string,
  details: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'USER_ORGANIZATION', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      entityId,
      occurredAt,
      JSON.stringify(details),
    );
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

function createTemporaryPassword(): string {
  const random = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(
    random,
    (value) =>
      TEMPORARY_PASSWORD_ALPHABET[value % TEMPORARY_PASSWORD_ALPHABET.length],
  ).join("");
}

function organizationAuditStatement(
  db: D1Database,
  actorUserId: string,
  action: string,
  organizationId: string,
  occurredAt: string,
  details: Record<string, unknown>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'ORGANIZATION', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      organizationId,
      occurredAt,
      JSON.stringify(details),
    );
}

async function countActiveProjects(
  db: D1Database,
  organizationId: string,
): Promise<number> {
  return (
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM project_organizations
         WHERE organization_id = ? AND is_active = 1`,
        )
        .bind(organizationId)
        .first<{ count: number }>()
    )?.count ?? 0
  );
}

function organizationMutationResult(
  id: string,
  name: string,
  isActive: boolean,
  activeProjectCount: number,
) {
  return {
    id,
    name,
    isActive,
    masterIsActive: isActive,
    activeProjectCount,
  };
}

function throwConstraintConflict(error: unknown): never {
  if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
    throw new DomainError("CONFLICT");
  }
  throw error;
}
