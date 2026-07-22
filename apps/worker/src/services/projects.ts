import {
  CreateProjectRequestSchema,
  type Project,
  type ProjectStatus,
  type UpdateProjectRequestSchema,
} from "@event-roster/contracts";
import {
  DomainError,
  isProjectExpired,
  toKstDate,
  transitionProject,
} from "@event-roster/domain";
import type { z } from "zod";
import { runGuardedAtomic } from "../db/atomic";
import { listActorProjectOrganizationIds } from "../db/project-organizations";
import { findProject, listProjects } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard } from "./admin";
import { closeExpiredProject } from "./project-expiration";

export async function getProjects(env: Env, actor: Actor): Promise<Project[]> {
  return listProjects(
    env.DB,
    actor.session.user.role === "OPERATOR" ? undefined : actor.session.user.id,
  );
}

export async function getProject(
  env: Env,
  actor: Actor,
  projectId: string,
): Promise<Project> {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (actor.session.user.role !== "OPERATOR") {
    const visibleOrganizationIds = await listActorProjectOrganizationIds(
      env.DB,
      actor.session.user.id,
      projectId,
      false,
    );
    if (visibleOrganizationIds.length === 0) {
      throw new DomainError("FORBIDDEN");
    }
  }
  return project;
}

export async function createProject(
  env: Env,
  actor: Actor,
  input: z.infer<typeof CreateProjectRequestSchema>,
  now = new Date(),
): Promise<Project> {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(env.DB, guardId, actor, "1 = 1", []),
    statements: [
      env.DB.prepare(
        `INSERT INTO projects
         (id, name, start_date, end_date, status, revision, created_by,
          created_at, updated_at, closed_at, closed_by, close_reason)
         VALUES (?, ?, ?, ?, 'PREPARING', 0, ?, ?, ?, NULL, NULL, NULL)`,
      ).bind(
        id,
        input.name,
        input.startDate ?? null,
        input.endDate ?? null,
        actor.session.user.id,
        timestamp,
        timestamp,
      ),
      auditStatement(
        env.DB,
        actor.session.user.id,
        "PROJECT_CREATED",
        id,
        timestamp,
      ),
    ],
    failureCode: "CONFLICT",
  });
  return requireStoredProject(env.DB, id);
}

export async function updateProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof UpdateProjectRequestSchema>,
  now = new Date(),
): Promise<Project> {
  const expired = await closeExpiredProject(env, projectId, now);
  const current = await findProject(env.DB, projectId);
  if (!current) throw new DomainError("NOT_FOUND");
  if (expired) throw new DomainError("PROJECT_CLOSED");
  const closedDateOnly =
    current.status === "CLOSED" && input.name === undefined;
  if (current.status === "CLOSED" && !closedDateOnly) {
    throw new DomainError("PROJECT_CLOSED");
  }
  const nextName = input.name ?? current.name;
  const nextStartDate =
    input.startDate === undefined ? current.startDate : input.startDate;
  const nextEndDate =
    input.endDate === undefined ? current.endDate : input.endDate;
  const validated = CreateProjectRequestSchema.parse({
    name: nextName,
    ...(nextStartDate === null ? {} : { startDate: nextStartDate }),
    ...(nextEndDate === null ? {} : { endDate: nextEndDate }),
  });
  const timestamp = now.toISOString();
  const today = toKstDate(now);
  const guardId = crypto.randomUUID();
  const mutationPredicate = closedDateOnly
    ? "id = ? AND revision = ? AND status = 'CLOSED'"
    : `id = ? AND revision = ? AND status <> 'CLOSED'
       AND (end_date IS NULL OR end_date >= ?)`;
  const mutationBindings: Array<string | number> = closedDateOnly
    ? [projectId, input.expectedRevision]
    : [projectId, input.expectedRevision, today];
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (SELECT 1 FROM projects WHERE ${mutationPredicate})`,
        mutationBindings,
      ),
      statements: [
        env.DB.prepare(
          `UPDATE projects
           SET name = ?, start_date = ?, end_date = ?,
               revision = revision + 1, updated_at = ?
           WHERE ${mutationPredicate}`,
        ).bind(
          validated.name,
          validated.startDate ?? null,
          validated.endDate ?? null,
          timestamp,
          ...mutationBindings,
        ),
        auditStatement(
          env.DB,
          actor.session.user.id,
          "PROJECT_UPDATED",
          projectId,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (!closedDateOnly) {
      await translateExpiredMutationFailure(env, projectId, now, error);
    }
    throw error;
  }
  return requireStoredProject(env.DB, projectId);
}

export async function changeProjectStatus(
  env: Env,
  actor: Actor,
  projectId: string,
  targetStatus: ProjectStatus,
  expectedRevision: number,
  now = new Date(),
): Promise<Project> {
  const expired = await closeExpiredProject(env, projectId, now);
  const current = await findProject(env.DB, projectId);
  if (!current) throw new DomainError("NOT_FOUND");
  if (expired) throw new DomainError("PROJECT_CLOSED");
  transitionProject(current.status, targetStatus, actor.session.user.role);
  if (current.revision !== expectedRevision) {
    throw new DomainError("STALE_REVISION");
  }
  if (
    current.status === "CLOSED" &&
    targetStatus === "IN_PROGRESS" &&
    isProjectExpired(current.endDate, now)
  ) {
    throw new DomainError("INVALID_TRANSITION");
  }

  const timestamp = now.toISOString();
  const today = toKstDate(now);
  const closing = targetStatus === "CLOSED";
  const reopening = current.status === "CLOSED";
  const mutationPredicate = reopening
    ? "id = ? AND status = 'CLOSED' AND revision = ?"
    : `id = ? AND status <> 'CLOSED' AND status = ? AND revision = ?
       AND (end_date IS NULL OR end_date >= ?)`;
  const mutationBindings: Array<string | number> = reopening
    ? [projectId, expectedRevision]
    : [projectId, current.status, expectedRevision, today];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE projects
       SET status = ?, revision = revision + 1, updated_at = ?,
           closed_at = ?, closed_by = ?, close_reason = ?
       WHERE ${mutationPredicate}`,
    ).bind(
      targetStatus,
      timestamp,
      closing ? timestamp : null,
      closing ? actor.session.user.id : null,
      closing ? "MANUAL" : null,
      ...mutationBindings,
    ),
  ];

  if (current.status === "PRE_REGISTRATION" && targetStatus === "IN_PROGRESS") {
    statements.push(
      expectedSnapshotStatement(env.DB, projectId, timestamp),
      env.DB.prepare(
        `UPDATE project_roster_entries
         SET was_expected_at_start = 1
         WHERE project_id = ? AND source = 'PRE_REGISTRATION' AND status = 'ACTIVE'`,
      ).bind(projectId),
    );
  }
  statements.push(
    auditStatement(
      env.DB,
      actor.session.user.id,
      reopening ? "PROJECT_REOPENED" : "PROJECT_TRANSITIONED",
      projectId,
      timestamp,
    ),
  );

  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (SELECT 1 FROM projects WHERE ${mutationPredicate})`,
        mutationBindings,
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (!reopening) {
      await translateExpiredMutationFailure(env, projectId, now, error);
    }
    throw error;
  }
  return requireStoredProject(env.DB, projectId);
}

async function translateExpiredMutationFailure(
  env: Env,
  projectId: string,
  now: Date,
  originalError: unknown,
): Promise<void> {
  if (!(originalError instanceof DomainError)) return;
  await closeExpiredProject(env, projectId, now);
  const latest = await findProject(env.DB, projectId);
  if (latest?.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
}

function expectedSnapshotStatement(
  db: D1Database,
  projectId: string,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       SELECT ?, linked.organization_id, COUNT(roster.id), ?
       FROM (
         SELECT organization_id FROM project_organizations
         WHERE project_id = ? AND is_active = 1
         UNION
         SELECT organization_id FROM project_roster_entries
         WHERE project_id = ? AND source = 'PRE_REGISTRATION' AND status = 'ACTIVE'
       ) linked
       LEFT JOIN project_roster_entries roster
         ON roster.project_id = ? AND roster.organization_id = linked.organization_id
        AND roster.source = 'PRE_REGISTRATION' AND roster.status = 'ACTIVE'
       GROUP BY linked.organization_id
       ON CONFLICT(project_id, organization_id) DO NOTHING`,
    )
    .bind(projectId, timestamp, projectId, projectId, projectId);
}

function auditStatement(
  db: D1Database,
  actorId: string,
  action: string,
  projectId: string,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'PROJECT', ?, ?, '{}')`,
    )
    .bind(crypto.randomUUID(), actorId, action, projectId, timestamp);
}

async function requireStoredProject(
  db: D1Database,
  projectId: string,
): Promise<Project> {
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  return project;
}
