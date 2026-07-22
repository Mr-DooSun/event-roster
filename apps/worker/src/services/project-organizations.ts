import type {
  AddProjectOrganization,
  ProjectOrganization,
} from "@event-roster/contracts";
import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import {
  findProjectOrganization,
  listActorProjectOrganizationIds,
  listProjectOrganizations,
} from "../db/project-organizations";
import { findProject } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { canonicalizeOrganizationName, createOperatorGuard } from "./admin";
import { closeExpiredProject } from "./project-expiration";

export async function getProjectOrganizations(
  env: Env,
  actor: Actor,
  projectId: string,
): Promise<ProjectOrganization[]> {
  await requireVisibleProject(env, actor, projectId);
  const organizations = await listProjectOrganizations(env.DB, projectId);
  if (actor.session.user.role === "OPERATOR") return organizations;
  const visibleIds = new Set(
    await listActorProjectOrganizationIds(
      env.DB,
      actor.session.user.id,
      projectId,
      false,
    ),
  );
  return organizations.filter((organization) =>
    visibleIds.has(organization.organizationId),
  );
}

export async function addProjectOrganization(
  env: Env,
  actor: Actor,
  projectId: string,
  input: AddProjectOrganization,
  now = new Date(),
): Promise<{ organization: ProjectOrganization; created: boolean }> {
  await requireMutableProject(env, projectId, now);
  const timestamp = now.toISOString();
  const today = toKstDate(now);
  const organizationId =
    "organizationId" in input ? input.organizationId : crypto.randomUUID();
  const current = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (current?.isActive) throw new DomainError("CONFLICT");

  const priorAudit = current
    ? true
    : await hasPriorMembershipAudit(env.DB, projectId, organizationId);
  const created = !current && !priorAudit;
  const action = created
    ? "PROJECT_ORGANIZATION_ADDED"
    : "PROJECT_ORGANIZATION_REACTIVATED";
  const guardId = crypto.randomUUID();
  const newOrganization = "newOrganizationName" in input;
  const operationPredicate = newOrganization
    ? `EXISTS (
         SELECT 1 FROM projects WHERE id = ? AND status <> 'CLOSED'
           AND (end_date IS NULL OR end_date >= ?)
       ) AND NOT EXISTS (
         SELECT 1 FROM organizations WHERE canonical_name = ?
       ) AND NOT EXISTS (
         SELECT 1 FROM project_organizations
         WHERE project_id = ? AND organization_id = ?
       )`
    : `EXISTS (
         SELECT 1 FROM projects WHERE id = ? AND status <> 'CLOSED'
           AND (end_date IS NULL OR end_date >= ?)
       ) AND EXISTS (
         SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
       ) AND NOT EXISTS (
         SELECT 1 FROM project_organizations
         WHERE project_id = ? AND organization_id = ? AND is_active = 1
       )`;
  const operationBindings = newOrganization
    ? [
        projectId,
        today,
        canonicalizeOrganizationName(input.newOrganizationName),
        projectId,
        organizationId,
      ]
    : [projectId, today, organizationId, projectId, organizationId];
  const statements: D1PreparedStatement[] = [];
  if (newOrganization) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO organizations
         (id, name, canonical_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      ).bind(
        organizationId,
        input.newOrganizationName,
        canonicalizeOrganizationName(input.newOrganizationName),
        timestamp,
        timestamp,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, deactivated_at,
        added_by, updated_by)
       VALUES (?, ?, 1, ?, NULL, ?, ?)
       ON CONFLICT(project_id, organization_id) DO UPDATE SET
         is_active = 1, deactivated_at = NULL, updated_by = excluded.updated_by`,
    ).bind(
      projectId,
      organizationId,
      timestamp,
      actor.session.user.id,
      actor.session.user.id,
    ),
    membershipAuditStatement(
      env.DB,
      actor.session.user.id,
      action,
      projectId,
      organizationId,
      timestamp,
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
    await translateExpiredMutationFailure(env, projectId, now, error);
    throwConstraintConflict(error);
  }
  const organization = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  return { organization, created };
}

export async function setProjectOrganizationActive(
  env: Env,
  actor: Actor,
  projectId: string,
  organizationId: string,
  isActive: boolean,
  now = new Date(),
): Promise<{
  organizationId: string;
  isActive: boolean;
  removed: boolean;
}> {
  if (isActive) {
    const result = await addProjectOrganization(
      env,
      actor,
      projectId,
      { organizationId },
      now,
    );
    return {
      organizationId,
      isActive: result.organization.isActive,
      removed: false,
    };
  }

  await requireMutableProject(env, projectId, now);
  const current = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!current?.isActive) throw new DomainError("NOT_FOUND");
  const timestamp = now.toISOString();
  const today = toKstDate(now);
  const guardId = crypto.randomUUID();
  const historyPredicate = `(
    EXISTS (
      SELECT 1 FROM project_roster_entries roster
      WHERE roster.project_id = project_organizations.project_id
        AND roster.organization_id = project_organizations.organization_id
    ) OR EXISTS (
      SELECT 1 FROM project_expected_snapshots snapshot
      WHERE snapshot.project_id = project_organizations.project_id
        AND snapshot.organization_id = project_organizations.organization_id
    ) OR EXISTS (
      SELECT 1 FROM audit_logs audit
      WHERE audit.entity_type = 'PROJECT_ORGANIZATION'
        AND audit.action GLOB 'PROJECT_ORGANIZATION_*'
        AND audit.entity_id = project_organizations.project_id || ':' || project_organizations.organization_id
    )
  )`;
  const membershipPredicate = `project_id = ? AND organization_id = ?
    AND is_active = 1 AND ${current.hasHistory ? "" : "NOT "}${historyPredicate}`;
  const mutation = current.hasHistory
    ? env.DB.prepare(
        `UPDATE project_organizations
         SET is_active = 0, deactivated_at = ?, updated_by = ?
         WHERE ${membershipPredicate}`,
      ).bind(timestamp, actor.session.user.id, projectId, organizationId)
    : env.DB.prepare(
        `DELETE FROM project_organizations WHERE ${membershipPredicate}`,
      ).bind(projectId, organizationId);
  const action = current.hasHistory
    ? "PROJECT_ORGANIZATION_DEACTIVATED"
    : "PROJECT_ORGANIZATION_REMOVED";
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (
           SELECT 1 FROM projects WHERE id = ? AND status <> 'CLOSED'
             AND (end_date IS NULL OR end_date >= ?)
         ) AND EXISTS (
           SELECT 1 FROM project_organizations WHERE ${membershipPredicate}
         )`,
        [projectId, today, projectId, organizationId],
      ),
      statements: [
        mutation,
        membershipAuditStatement(
          env.DB,
          actor.session.user.id,
          action,
          projectId,
          organizationId,
          timestamp,
        ),
      ],
      failureCode: "CONFLICT",
    });
  } catch (error) {
    await translateExpiredMutationFailure(env, projectId, now, error);
    throw error;
  }
  return {
    organizationId,
    isActive: false,
    removed: !current.hasHistory,
  };
}

async function requireVisibleProject(
  env: Env,
  actor: Actor,
  projectId: string,
): Promise<void> {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (actor.session.user.role === "OPERATOR") return;
  const visible = await listActorProjectOrganizationIds(
    env.DB,
    actor.session.user.id,
    projectId,
    false,
  );
  if (visible.length === 0) throw new DomainError("FORBIDDEN");
}

async function requireMutableProject(
  env: Env,
  projectId: string,
  now: Date,
): Promise<void> {
  await closeExpiredProject(env, projectId, now);
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
}

async function translateExpiredMutationFailure(
  env: Env,
  projectId: string,
  now: Date,
  error: unknown,
): Promise<void> {
  if (!(error instanceof DomainError)) return;
  await closeExpiredProject(env, projectId, now);
  const project = await findProject(env.DB, projectId);
  if (project?.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
}

async function hasPriorMembershipAudit(
  db: D1Database,
  projectId: string,
  organizationId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM audit_logs
       WHERE entity_type = 'PROJECT_ORGANIZATION'
         AND action GLOB 'PROJECT_ORGANIZATION_*' AND entity_id = ?
       LIMIT 1`,
    )
    .bind(membershipEntityId(projectId, organizationId))
    .first<{ found: number }>();
  return row?.found === 1;
}

function membershipAuditStatement(
  db: D1Database,
  actorId: string,
  action: string,
  projectId: string,
  organizationId: string,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'PROJECT_ORGANIZATION', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      membershipEntityId(projectId, organizationId),
      timestamp,
      JSON.stringify({ projectId, organizationId }),
    );
}

function membershipEntityId(projectId: string, organizationId: string) {
  return `${projectId}:${organizationId}`;
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
