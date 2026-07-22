import type { ProjectStatus, RosterSource } from "@event-roster/contracts";
import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import { findProjectOrganization } from "../db/project-organizations";
import { findProject } from "../db/projects";
import { findRosterByParticipant, type RosterRecord } from "../db/roster";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { closeExpiredProject } from "./project-expiration";

export interface ParticipantRecord {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
}

export async function getParticipants(env: Env, actor: Actor) {
  const manager = actor.session.user.role === "ORGANIZATION_MANAGER";
  if (manager && actor.session.user.organizationIds.length === 0) return [];
  const sql = manager
    ? `SELECT id, participant_id, name, organization_id, revision FROM participants
       WHERE organization_id IN (${actor.session.user.organizationIds.map(() => "?").join(",")})
       ORDER BY name, participant_id`
    : `SELECT id, participant_id, name, organization_id, revision
       FROM participants ORDER BY name, participant_id`;
  const rows = (
    await env.DB.prepare(sql)
      .bind(...(manager ? actor.session.user.organizationIds : []))
      .all<ParticipantRow>()
  ).results;
  return rows.map(mapParticipant);
}

export async function createParticipantAndAddToProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { name: string; organizationId: string; expectedRevision: number },
  now = new Date(),
): Promise<{
  participant: ParticipantRecord;
  rosterEntry: RosterRecord;
  projectRevision: number;
}> {
  const project = await requireRosterMutableProject(env, projectId, now);
  assertActorScope(actor, input.organizationId, project.status);
  const membership = await findProjectOrganization(
    env.DB,
    projectId,
    input.organizationId,
  );
  if (!membership?.isActive || !membership.masterIsActive) {
    throw new DomainError("VALIDATION_FAILED");
  }
  const participantId = crypto.randomUUID();
  const participantNumber = `P-${crypto.randomUUID().toUpperCase()}`;
  const entryId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const source: RosterSource =
    project.status === "PRE_REGISTRATION" ? "PRE_REGISTRATION" : "IN_PROGRESS";
  const guardId = crypto.randomUUID();
  let results: D1Result[];
  try {
    results = await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: projectParticipantGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.organizationId,
        project.status,
        input.expectedRevision,
        toKstDate(now),
        `EXISTS (
           SELECT 1 FROM project_organizations po
           JOIN organizations o ON o.id = po.organization_id
           WHERE po.project_id = ? AND po.organization_id = ?
             AND po.is_active = 1 AND o.is_active = 1
         )`,
        [projectId, input.organizationId],
      ),
      statements: [
        env.DB.prepare(
          `INSERT INTO participants
         (id, participant_id, name, organization_id, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        ).bind(
          participantId,
          participantNumber,
          input.name,
          input.organizationId,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          `INSERT INTO project_roster_entries
         (id, project_id, participant_id, organization_id,
          participant_name_snapshot, organization_name_snapshot, source, status,
          was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
         SELECT ?, ?, ?, o.id, ?, o.name, ?, 'ACTIVE', 0, 0, ?, ?, ?, ?
         FROM organizations o WHERE o.id = ?`,
        ).bind(
          entryId,
          projectId,
          participantId,
          input.name,
          source,
          actor.session.user.id,
          actor.session.user.id,
          timestamp,
          timestamp,
          input.organizationId,
        ),
        incrementProject(env.DB, projectId, timestamp),
        auditStatement(
          env.DB,
          actor,
          "PARTICIPANT_CREATED",
          "PARTICIPANT",
          participantId,
          projectId,
          input.organizationId,
          timestamp,
        ),
        auditStatement(
          env.DB,
          actor,
          "ROSTER_ADDED",
          "ROSTER_ENTRY",
          entryId,
          projectId,
          input.organizationId,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (error instanceof DomainError) {
      await closeExpiredProject(env, projectId, now);
      const latest = await findProject(env.DB, projectId);
      if (latest?.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
    }
    throw error;
  }
  if (!results[1]?.success) throw new DomainError("INTERNAL_ERROR");
  return {
    participant: {
      id: participantId,
      participantId: participantNumber,
      name: input.name,
      organizationId: input.organizationId,
      revision: 0,
    },
    rosterEntry: {
      id: entryId,
      projectId,
      participantId,
      participantNumber,
      organizationId: input.organizationId,
      participantName: input.name,
      organizationName: membership.name,
      source,
      status: "ACTIVE",
      wasExpectedAtStart: false,
      revision: 0,
      updatedAt: timestamp,
    },
    projectRevision: input.expectedRevision + 1,
  };
}

export async function updateProjectParticipant(
  env: Env,
  actor: Actor,
  projectId: string,
  participantId: string,
  input: {
    name?: string | undefined;
    organizationId?: string | undefined;
    expectedRevision: number;
    expectedProjectRevision: number;
  },
  now = new Date(),
): Promise<ParticipantRecord & { projectRevision: number }> {
  await closeExpiredProject(env, projectId, now);
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
  const [current, entry] = await Promise.all([
    findParticipant(env.DB, participantId),
    findRosterByParticipant(env.DB, projectId, participantId),
  ]);
  if (!current || !entry) throw new DomainError("NOT_FOUND");
  assertActorScope(actor, entry.organizationId, project.status);
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    !actor.session.user.organizationIds.includes(current.organizationId)
  ) {
    throw new DomainError("FORBIDDEN");
  }
  const nextOrganizationId = input.organizationId ?? current.organizationId;
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    nextOrganizationId !== current.organizationId
  ) {
    throw new DomainError("FORBIDDEN");
  }
  if (nextOrganizationId !== current.organizationId) {
    const membership = await findProjectOrganization(
      env.DB,
      projectId,
      nextOrganizationId,
    );
    if (!membership?.isActive || !membership.masterIsActive) {
      throw new DomainError("VALIDATION_FAILED");
    }
  }
  const timestamp = now.toISOString();
  const guardId = crypto.randomUUID();
  const membershipPredicate =
    nextOrganizationId === current.organizationId
      ? "1 = 1"
      : `EXISTS (
           SELECT 1 FROM project_organizations po
           JOIN organizations o ON o.id = po.organization_id
           WHERE po.project_id = ? AND po.organization_id = ?
             AND po.is_active = 1 AND o.is_active = 1
         )`;
  const membershipBindings =
    nextOrganizationId === current.organizationId
      ? []
      : [projectId, nextOrganizationId];
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: projectParticipantGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        entry.organizationId,
        project.status,
        input.expectedProjectRevision,
        toKstDate(now),
        `EXISTS (
           SELECT 1 FROM participants WHERE id = ? AND revision = ?
         ) AND EXISTS (
           SELECT 1 FROM project_roster_entries
           WHERE project_id = ? AND participant_id = ?
         ) AND EXISTS (
           SELECT 1 FROM users scoped_user
           WHERE scoped_user.id = ? AND (
             scoped_user.role = 'OPERATOR' OR (
               EXISTS (
                 SELECT 1 FROM participants scoped_participant
                 JOIN user_organizations master_scope
                   ON master_scope.organization_id = scoped_participant.organization_id
                 WHERE scoped_participant.id = ?
                   AND master_scope.user_id = scoped_user.id
               ) AND EXISTS (
                 SELECT 1 FROM project_roster_entries scoped_roster
                 JOIN user_organizations roster_scope
                   ON roster_scope.organization_id = scoped_roster.organization_id
                 WHERE scoped_roster.project_id = ?
                   AND scoped_roster.participant_id = ?
                   AND roster_scope.user_id = scoped_user.id
               )
             )
           )
         ) AND ${membershipPredicate}`,
        [
          participantId,
          input.expectedRevision,
          projectId,
          participantId,
          actor.session.user.id,
          participantId,
          projectId,
          participantId,
          ...membershipBindings,
        ],
      ),
      statements: [
        env.DB.prepare(
          `UPDATE participants
           SET name = ?, organization_id = ?, revision = revision + 1,
               updated_at = ? WHERE id = ?`,
        ).bind(
          input.name ?? current.name,
          nextOrganizationId,
          timestamp,
          participantId,
        ),
        incrementProject(env.DB, projectId, timestamp),
        auditStatement(
          env.DB,
          actor,
          "PARTICIPANT_UPDATED",
          "PARTICIPANT",
          participantId,
          projectId,
          entry.organizationId,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (error instanceof DomainError) {
      await closeExpiredProject(env, projectId, now);
      const latest = await findProject(env.DB, projectId);
      if (latest?.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
    }
    throw error;
  }
  return {
    ...current,
    name: input.name ?? current.name,
    organizationId: nextOrganizationId,
    revision: input.expectedRevision + 1,
    projectRevision: input.expectedProjectRevision + 1,
  };
}

interface ParticipantRow {
  id: string;
  participant_id: string;
  name: string;
  organization_id: string;
  revision: number;
}

async function findParticipant(db: D1Database, id: string) {
  const row = await db
    .prepare(
      `SELECT id, participant_id, name, organization_id, revision
       FROM participants WHERE id = ?`,
    )
    .bind(id)
    .first<ParticipantRow>();
  return row ? mapParticipant(row) : null;
}

async function requireRosterMutableProject(
  env: Env,
  projectId: string,
  now: Date,
) {
  await closeExpiredProject(env, projectId, now);
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
  if (
    project.status !== "PRE_REGISTRATION" &&
    project.status !== "IN_PROGRESS"
  ) {
    throw new DomainError("CONFLICT");
  }
  return project;
}

function assertActorScope(
  actor: Actor,
  organizationId: string,
  projectStatus: ProjectStatus,
) {
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    (!actor.session.user.organizationIds.includes(organizationId) ||
      projectStatus !== "PRE_REGISTRATION")
  ) {
    throw new DomainError("FORBIDDEN");
  }
}

function projectParticipantGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  projectId: string,
  organizationId: string,
  projectStatus: ProjectStatus,
  expectedProjectRevision: number,
  today: string,
  operationPredicate: string,
  operationBindings: Array<string | number>,
) {
  return db
    .prepare(
      `INSERT INTO operation_guards (id, ok)
       VALUES (?, CASE WHEN EXISTS (
         SELECT 1 FROM users u JOIN auth_sessions s ON s.user_id = u.id
         WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.kind = 'FULL'
           AND u.is_active = 1 AND u.session_version = ? AND s.session_version = ?
           AND (u.role = 'OPERATOR' OR (? = 'PRE_REGISTRATION' AND EXISTS (
             SELECT 1 FROM user_organizations uo
             WHERE uo.user_id = u.id AND uo.organization_id = ?
           )))
       ) AND EXISTS (
         SELECT 1 FROM projects
         WHERE id = ? AND status = ? AND revision = ?
           AND (end_date IS NULL OR end_date >= ?)
       ) AND (${operationPredicate}) THEN 1 ELSE 0 END)`,
    )
    .bind(
      guardId,
      actor.session.user.id,
      actor.session.id,
      actor.claims.sv,
      actor.claims.sv,
      projectStatus,
      organizationId,
      projectId,
      projectStatus,
      expectedProjectRevision,
      today,
      ...operationBindings,
    );
}

function incrementProject(
  db: D1Database,
  projectId: string,
  timestamp: string,
) {
  return db
    .prepare(
      "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
    )
    .bind(timestamp, projectId);
}

function auditStatement(
  db: D1Database,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  projectId: string,
  organizationId: string,
  timestamp: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actor.session.user.id,
      action,
      entityType,
      entityId,
      timestamp,
      JSON.stringify({ projectId, organizationId }),
    );
}

function mapParticipant(row: ParticipantRow): ParticipantRecord {
  return {
    id: row.id,
    participantId: row.participant_id,
    name: row.name,
    organizationId: row.organization_id,
    revision: row.revision,
  };
}
