import type {
  ProjectStatus,
  RosterSource,
  RosterStatus,
} from "@event-roster/contracts";
import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import {
  findProjectOrganization,
  listActorProjectOrganizationIds,
} from "../db/project-organizations";
import { findProject } from "../db/projects";
import {
  findRosterById,
  findRosterByParticipant,
  listRoster,
  type RosterRecord,
} from "../db/roster";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import {
  decodeCursor,
  encodeCursor,
  sanitizeAuditDetails,
} from "./audit-pages";
import { closeExpiredProject } from "./project-expiration";

export async function getRoster(env: Env, actor: Actor, projectId: string) {
  await requireVisibleProject(env, actor, projectId);
  return listRoster(
    env.DB,
    projectId,
    actor.session.user.role === "OPERATOR"
      ? undefined
      : await listActorProjectOrganizationIds(
          env.DB,
          actor.session.user.id,
          projectId,
          false,
        ),
  );
}

export async function addRosterEntry(
  env: Env,
  actor: Actor,
  projectId: string,
  participantId: string,
  expectedRevision: number,
  confirmedParticipant: { name: string; organizationId: string },
  expectedParticipantRevision: number,
  now = new Date(),
) {
  const project = await requireMutableProject(env, projectId, now);
  const participant = await env.DB.prepare(
    "SELECT id, participant_id, name, organization_id, revision FROM participants WHERE id = ?",
  )
    .bind(participantId)
    .first<{
      id: string;
      participant_id: string;
      name: string;
      organization_id: string;
      revision: number;
    }>();
  if (!participant) throw new DomainError("NOT_FOUND");
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    participant.organization_id !== confirmedParticipant.organizationId
  ) {
    throw new DomainError("FORBIDDEN");
  }
  const existing = await findRosterByParticipant(
    env.DB,
    projectId,
    participantId,
  );
  if (existing?.status === "ACTIVE") throw new DomainError("CONFLICT");
  const organizationId =
    existing?.organizationId ?? confirmedParticipant.organizationId;
  assertActorScope(actor, organizationId, project.status);
  await assertActiveManagerMembership(env, actor, projectId, organizationId);
  if (confirmedParticipant.organizationId !== organizationId) {
    assertActorScope(
      actor,
      confirmedParticipant.organizationId,
      project.status,
    );
    await assertActiveManagerMembership(
      env,
      actor,
      projectId,
      confirmedParticipant.organizationId,
    );
  }
  if (!existing) {
    const membership = await findProjectOrganization(
      env.DB,
      projectId,
      organizationId,
    );
    if (!membership?.isActive || !membership.masterIsActive) {
      throw new DomainError("VALIDATION_FAILED");
    }
  }

  const source: RosterSource =
    project.status === "PRE_REGISTRATION" ? "PRE_REGISTRATION" : "IN_PROGRESS";
  const nextSource =
    existing && project.status === "IN_PROGRESS" && !existing.wasExpectedAtStart
      ? "IN_PROGRESS"
      : (existing?.source ?? source);
  const timestamp = now.toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const participantStatePredicate = `EXISTS (
    SELECT 1 FROM participants guarded_participant
    JOIN users guarded_actor ON guarded_actor.id = ?
    WHERE guarded_participant.id = ? AND guarded_participant.revision = ?
      AND (guarded_actor.role = 'OPERATOR'
        OR guarded_participant.organization_id = ?)
  )`;
  const participantStateBindings = [
    actor.session.user.id,
    participantId,
    expectedParticipantRevision,
    confirmedParticipant.organizationId,
  ];
  const operationPredicate = existing
    ? `EXISTS (
         SELECT 1 FROM project_roster_entries
         WHERE id = ? AND project_id = ? AND status = 'CANCELLED' AND revision = ?
       ) AND ${participantStatePredicate}`
    : `NOT EXISTS (
         SELECT 1 FROM project_roster_entries
         WHERE project_id = ? AND participant_id = ?
       ) AND ${participantStatePredicate} AND EXISTS (
         SELECT 1 FROM project_organizations po
         JOIN organizations o ON o.id = po.organization_id
         WHERE po.project_id = ? AND po.organization_id = ?
           AND po.is_active = 1 AND o.is_active = 1
       )`;
  const operationBindings = existing
    ? [existing.id, projectId, existing.revision, ...participantStateBindings]
    : [
        projectId,
        participantId,
        ...participantStateBindings,
        projectId,
        confirmedParticipant.organizationId,
      ];
  const statements: D1PreparedStatement[] = existing
    ? [
        env.DB.prepare(
          `UPDATE project_roster_entries
           SET status = 'ACTIVE', source = ?, revision = revision + 1,
               updated_by = ?, updated_at = ?
           WHERE id = ?
           RETURNING id, project_id, participant_id, organization_id,
             participant_name_snapshot, organization_name_snapshot, source, status,
             was_expected_at_start, revision`,
        ).bind(nextSource, actor.session.user.id, timestamp, existing.id),
      ]
    : [
        env.DB.prepare(
          `UPDATE participants
           SET name = ?, organization_id = ?,
               revision = revision + CASE
                 WHEN name <> ? OR organization_id <> ? THEN 1 ELSE 0 END,
               updated_at = ?
           WHERE id = ? AND revision = ?`,
        ).bind(
          confirmedParticipant.name,
          confirmedParticipant.organizationId,
          confirmedParticipant.name,
          confirmedParticipant.organizationId,
          timestamp,
          participantId,
          expectedParticipantRevision,
        ),
        env.DB.prepare(
          `INSERT INTO project_roster_entries
           (id, project_id, participant_id, organization_id,
            participant_name_snapshot, organization_name_snapshot, source, status,
            was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
           SELECT ?, ?, p.id, ?, ?, o.name, ?, 'ACTIVE', 0, 0,
                  ?, ?, ?, ?
           FROM participants p JOIN organizations o ON o.id = ?
           WHERE p.id = ?
           RETURNING id, project_id, participant_id, organization_id,
             participant_name_snapshot, organization_name_snapshot, source, status,
             was_expected_at_start, revision`,
        ).bind(
          id,
          projectId,
          confirmedParticipant.organizationId,
          confirmedParticipant.name,
          source,
          actor.session.user.id,
          actor.session.user.id,
          timestamp,
          timestamp,
          confirmedParticipant.organizationId,
          participantId,
        ),
      ];
  statements.push(
    incrementProject(env.DB, projectId, timestamp),
    ...(!existing &&
    (participant.name !== confirmedParticipant.name ||
      participant.organization_id !== confirmedParticipant.organizationId)
      ? [
          participantAudit(
            env.DB,
            actor,
            participantId,
            projectId,
            confirmedParticipant.organizationId,
            timestamp,
          ),
        ]
      : []),
    rosterAudit(
      env.DB,
      actor,
      existing ? "ROSTER_REACTIVATED" : "ROSTER_ADDED",
      id,
      projectId,
      organizationId,
      timestamp,
    ),
  );
  let results: D1Result[];
  try {
    results = await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: rosterGuard(
        env.DB,
        guardId,
        actor,
        organizationId,
        confirmedParticipant.organizationId,
        projectId,
        project.status,
        expectedRevision,
        toKstDate(now),
        operationPredicate,
        operationBindings,
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedFailure(env, projectId, now, error);
    throw error;
  }
  return {
    ...mapReturnedRoster(
      results[existing ? 1 : 2]?.results[0],
      participant.participant_id,
      timestamp,
    ),
    projectRevision: expectedRevision + 1,
  };
}

export async function updateRosterEntry(
  env: Env,
  actor: Actor,
  projectId: string,
  entryId: string,
  input: {
    status: RosterStatus;
    expectedRevision: number;
    expectedEntryRevision: number;
  },
  now = new Date(),
) {
  const project = await requireMutableProject(env, projectId, now);
  const entry = await findRosterById(env.DB, projectId, entryId);
  if (!entry) throw new DomainError("NOT_FOUND");
  assertActorScope(actor, entry.organizationId, project.status);
  await assertActiveManagerMembership(
    env,
    actor,
    projectId,
    entry.organizationId,
  );
  if (entry.status === input.status) throw new DomainError("CONFLICT");
  const timestamp = now.toISOString();
  const nextSource: RosterSource =
    input.status === "ACTIVE" &&
    project.status === "IN_PROGRESS" &&
    !entry.wasExpectedAtStart
      ? "IN_PROGRESS"
      : entry.source;
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: rosterGuard(
        env.DB,
        guardId,
        actor,
        entry.organizationId,
        entry.organizationId,
        projectId,
        project.status,
        input.expectedRevision,
        toKstDate(now),
        `EXISTS (
           SELECT 1 FROM project_roster_entries
           WHERE id = ? AND project_id = ? AND revision = ? AND status = ?
         )`,
        [entryId, projectId, input.expectedEntryRevision, entry.status],
      ),
      statements: [
        env.DB.prepare(
          `UPDATE project_roster_entries
           SET status = ?, source = ?, revision = revision + 1,
               updated_by = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          input.status,
          nextSource,
          actor.session.user.id,
          timestamp,
          entryId,
        ),
        incrementProject(env.DB, projectId, timestamp),
        rosterAudit(
          env.DB,
          actor,
          input.status === "CANCELLED"
            ? "ROSTER_CANCELLED"
            : "ROSTER_REACTIVATED",
          entryId,
          projectId,
          entry.organizationId,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedFailure(env, projectId, now, error);
    throw error;
  }
  return {
    ...entry,
    status: input.status,
    source: nextSource,
    revision: input.expectedEntryRevision + 1,
    updatedAt: timestamp,
    projectRevision: input.expectedRevision + 1,
  };
}

export async function getSummary(env: Env, actor: Actor, projectId: string) {
  await requireVisibleProject(env, actor, projectId);
  const scope =
    actor.session.user.role === "OPERATOR"
      ? undefined
      : await listActorProjectOrganizationIds(
          env.DB,
          actor.session.user.id,
          projectId,
          false,
        );
  const scopeSql = scope
    ? ` AND po.organization_id IN (${scope.map(() => "?").join(",")})`
    : "";
  const rows = (
    await env.DB.prepare(
      `SELECT po.organization_id, o.name AS organization_name,
         CASE WHEN p.status = 'PRE_REGISTRATION' THEN
           SUM(CASE WHEN r.source = 'PRE_REGISTRATION' AND r.status = 'ACTIVE'
                    THEN 1 ELSE 0 END)
           ELSE COALESCE(s.expected_count, 0)
         END AS expected,
         SUM(CASE WHEN r.source = 'IN_PROGRESS' AND r.status = 'ACTIVE'
                  THEN 1 ELSE 0 END) AS in_progress_added,
         SUM(CASE WHEN r.source = 'PRE_REGISTRATION' AND r.status = 'CANCELLED'
                        AND r.was_expected_at_start = 1
                  THEN 1 ELSE 0 END) AS in_progress_cancelled,
         SUM(CASE WHEN r.status = 'ACTIVE' THEN 1 ELSE 0 END) AS final
       FROM projects p
       JOIN project_organizations po ON po.project_id = p.id
       JOIN organizations o ON o.id = po.organization_id
       LEFT JOIN project_expected_snapshots s
         ON s.project_id = p.id AND s.organization_id = po.organization_id
       LEFT JOIN project_roster_entries r
         ON r.project_id = p.id AND r.organization_id = po.organization_id
       WHERE p.id = ?${scopeSql}
       GROUP BY po.organization_id, o.name, p.status, s.expected_count
       ORDER BY o.name, po.organization_id`,
    )
      .bind(projectId, ...(scope ?? []))
      .all<{
        organization_id: string;
        organization_name: string;
        expected: number;
        in_progress_added: number;
        in_progress_cancelled: number;
        final: number;
      }>()
  ).results;
  const organizations = rows.map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    expected: row.expected,
    inProgressAdded: row.in_progress_added,
    inProgressCancelled: row.in_progress_cancelled,
    final: row.final,
    delta: row.final - row.expected,
  }));
  const expectedTotal = organizations.reduce(
    (sum, row) => sum + row.expected,
    0,
  );
  const finalTotal = organizations.reduce((sum, row) => sum + row.final, 0);
  return {
    projectId,
    expectedTotal,
    finalTotal,
    deltaTotal: finalTotal - expectedTotal,
    organizations,
  };
}

export async function getAuditPage(
  env: Env,
  actor: Actor,
  projectId: string,
  limit: number,
  cursor: string | null,
) {
  await requireVisibleProject(env, actor, projectId);
  const decoded = cursor ? decodeCursor(cursor) : null;
  const scope =
    actor.session.user.role === "OPERATOR"
      ? undefined
      : await listActorProjectOrganizationIds(
          env.DB,
          actor.session.user.id,
          projectId,
          false,
        );
  const cursorSql = decoded
    ? " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))"
    : "";
  const scopeSql = scope
    ? ` AND CASE WHEN json_valid(details_json) THEN
             (json_extract(details_json, '$.organizationId') IS NULL
              OR json_extract(details_json, '$.organizationId') IN (${scope.map(() => "?").join(",")}))
           ELSE 1 END`
    : "";
  const bindings: Array<string | number> = [projectId, projectId];
  if (decoded)
    bindings.push(decoded.occurredAt, decoded.occurredAt, decoded.id);
  bindings.push(...(scope ?? []), limit + 1);
  const rows = (
    await env.DB.prepare(
      `SELECT id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json
       FROM audit_logs
       WHERE ((entity_type = 'PROJECT' AND entity_id = ?)
          OR CASE WHEN json_valid(details_json) THEN
               json_extract(details_json, '$.projectId') = ?
             ELSE 0 END)${cursorSql}${scopeSql}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
      .bind(...bindings)
      .all<{
        id: string;
        actor_user_id: string | null;
        action: string;
        entity_type: string;
        entity_id: string;
        occurred_at: string;
        details_json: string;
      }>()
  ).results;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
      details: sanitizeAuditDetails(row.details_json),
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ occurredAt: last.occurred_at, id: last.id })
        : null,
  };
}

async function requireVisibleProject(
  env: Env,
  actor: Actor,
  projectId: string,
) {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (actor.session.user.role === "OPERATOR") return project;
  const scope = await listActorProjectOrganizationIds(
    env.DB,
    actor.session.user.id,
    projectId,
    false,
  );
  if (scope.length === 0) throw new DomainError("FORBIDDEN");
  return project;
}

async function requireMutableProject(env: Env, projectId: string, now: Date) {
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

function rosterGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  organizationId: string,
  confirmedOrganizationId: string,
  projectId: string,
  projectStatus: ProjectStatus,
  expectedRevision: number,
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
           ) AND EXISTS (
             SELECT 1 FROM project_organizations scoped_membership
             JOIN organizations scoped_master
               ON scoped_master.id = scoped_membership.organization_id
             WHERE scoped_membership.project_id = ?
               AND scoped_membership.organization_id = ?
               AND scoped_membership.is_active = 1
               AND scoped_master.is_active = 1
           ) AND EXISTS (
             SELECT 1 FROM user_organizations confirmed_scope
             WHERE confirmed_scope.user_id = u.id
               AND confirmed_scope.organization_id = ?
           ) AND EXISTS (
             SELECT 1 FROM project_organizations confirmed_membership
             JOIN organizations confirmed_master
               ON confirmed_master.id = confirmed_membership.organization_id
             WHERE confirmed_membership.project_id = ?
               AND confirmed_membership.organization_id = ?
               AND confirmed_membership.is_active = 1
               AND confirmed_master.is_active = 1
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
      organizationId,
      confirmedOrganizationId,
      projectId,
      confirmedOrganizationId,
      projectId,
      projectStatus,
      expectedRevision,
      today,
      ...operationBindings,
    );
}

async function assertActiveManagerMembership(
  env: Env,
  actor: Actor,
  projectId: string,
  organizationId: string,
) {
  if (actor.session.user.role !== "ORGANIZATION_MANAGER") return;
  const membership = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!membership?.isActive || !membership.masterIsActive) {
    throw new DomainError("FORBIDDEN");
  }
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

function rosterAudit(
  db: D1Database,
  actor: Actor,
  action: string,
  entryId: string,
  projectId: string,
  organizationId: string,
  timestamp: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, ?, 'ROSTER_ENTRY', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actor.session.user.id,
      action,
      entryId,
      timestamp,
      JSON.stringify({ projectId, organizationId }),
    );
}

function participantAudit(
  db: D1Database,
  actor: Actor,
  participantId: string,
  projectId: string,
  organizationId: string,
  timestamp: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'PARTICIPANT_UPDATED', 'PARTICIPANT', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actor.session.user.id,
      participantId,
      timestamp,
      JSON.stringify({ projectId, organizationId }),
    );
}

async function translateClosedFailure(
  env: Env,
  projectId: string,
  now: Date,
  error: unknown,
) {
  if (!(error instanceof DomainError)) return;
  await closeExpiredProject(env, projectId, now);
  const project = await findProject(env.DB, projectId);
  if (project?.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
}

function mapReturnedRoster(
  value: unknown,
  participantNumber: string,
  updatedAt: string,
): RosterRecord {
  if (!value || typeof value !== "object")
    throw new DomainError("INTERNAL_ERROR");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.participant_id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.participant_name_snapshot !== "string" ||
    typeof row.organization_name_snapshot !== "string" ||
    (row.source !== "PRE_REGISTRATION" && row.source !== "IN_PROGRESS") ||
    (row.status !== "ACTIVE" && row.status !== "CANCELLED") ||
    typeof row.was_expected_at_start !== "number" ||
    typeof row.revision !== "number"
  ) {
    throw new DomainError("INTERNAL_ERROR");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    participantId: row.participant_id,
    participantNumber,
    organizationId: row.organization_id,
    participantName: row.participant_name_snapshot,
    organizationName: row.organization_name_snapshot,
    source: row.source,
    status: row.status,
    wasExpectedAtStart: row.was_expected_at_start === 1,
    revision: row.revision,
    updatedAt,
  };
}
