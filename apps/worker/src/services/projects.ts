import {
  CreateProjectRequestSchema,
  type Project,
  type ProjectStatus,
  type UpdateProjectRequestSchema,
} from "@event-roster/contracts";
import {
  DomainError,
  isProjectExpired,
  transitionProject,
} from "@event-roster/domain";
import type { z } from "zod";
import { runGuardedAtomic } from "../db/atomic";
import { findProject, listProjects } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard } from "./admin";

export async function getProjects(env: Env, _actor: Actor): Promise<Project[]> {
  return listProjects(env.DB);
}

export async function getProject(
  env: Env,
  _actor: Actor,
  projectId: string,
): Promise<Project> {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
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
  const current = await findProject(env.DB, projectId);
  if (!current) throw new DomainError("NOT_FOUND");
  if (current.status === "CLOSED" && input.name !== undefined) {
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
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      "EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ? AND status = ?)",
      [projectId, input.expectedRevision, current.status],
    ),
    statements: [
      env.DB.prepare(
        `UPDATE projects
         SET name = ?, start_date = ?, end_date = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      ).bind(
        validated.name,
        validated.startDate ?? null,
        validated.endDate ?? null,
        timestamp,
        projectId,
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
  const current = await findProject(env.DB, projectId);
  if (!current) throw new DomainError("NOT_FOUND");
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
  const closing = targetStatus === "CLOSED";
  const reopening = current.status === "CLOSED";
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE projects
       SET status = ?, revision = revision + 1, updated_at = ?,
           closed_at = ?, closed_by = ?, close_reason = ?
       WHERE id = ?`,
    ).bind(
      targetStatus,
      timestamp,
      closing ? timestamp : null,
      closing ? actor.session.user.id : null,
      closing ? "MANUAL" : null,
      projectId,
    ),
  ];

  if (current.status === "PRE_REGISTRATION" && targetStatus === "IN_PROGRESS") {
    statements.push(expectedSnapshotStatement(env.DB, projectId, timestamp));
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
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM projects WHERE id = ? AND status = ? AND revision = ?
       )`,
      [projectId, current.status, expectedRevision],
    ),
    statements,
    failureCode: "STALE_REVISION",
  });
  return requireStoredProject(env.DB, projectId);
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
         SELECT organization_id FROM event_roster_entries
         WHERE event_id = ? AND source = 'PRE_EVENT' AND status = 'ACTIVE'
       ) linked
       LEFT JOIN event_roster_entries roster
         ON roster.event_id = ? AND roster.organization_id = linked.organization_id
        AND roster.source = 'PRE_EVENT' AND roster.status = 'ACTIVE'
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
