import type {
  OrganizationDetail,
  OrganizationManager,
  OrganizationSummary,
} from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
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

export function canonicalizeOrganizationName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
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
  if (
    error instanceof Error &&
    (error.message.includes("SQLITE_CONSTRAINT") ||
      error.message.includes("UNIQUE constraint"))
  ) {
    throw new DomainError("CONFLICT");
  }
  throw error;
}
