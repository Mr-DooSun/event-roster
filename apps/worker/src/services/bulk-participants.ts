import type {
  BulkParticipantDuplicate,
  BulkRosterCreateRequest,
  BulkRosterCreateResponse,
  ParticipantRole,
  RosterSource,
  StudentGrade,
} from "@event-roster/contracts";
import { canonicalizeParticipantName } from "@event-roster/contracts";
import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import { findProjectOrganization } from "../db/project-organizations";
import { findProject } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import {
  assertActorScope,
  incrementProject,
  projectParticipantGuard,
  requireRosterMutableProject,
} from "./participants";
import { closeExpiredProject } from "./project-expiration";

const PARTICIPANT_CHUNK_SIZE = 15;
const ROSTER_CHUNK_SIZE = 15;
const AUDIT_CHUNK_SIZE = 18;

export interface BulkParticipantHooks {
  afterSnapshot?: () => Promise<void>;
}

export async function createBulkParticipantsAndAddToProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: BulkRosterCreateRequest,
  now = new Date(),
  hooks?: BulkParticipantHooks,
): Promise<BulkRosterCreateResponse> {
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
  const existingParticipants = (
    await env.DB.prepare(
      "SELECT name, revision FROM participants WHERE organization_id = ?",
    )
      .bind(input.organizationId)
      .all<{ name: string; revision: number }>()
  ).results;
  await hooks?.afterSnapshot?.();
  const duplicates = collectDuplicates(
    input.participants.map((participant) => participant.name),
    existingParticipants.map((participant) => participant.name),
  );
  if (duplicates.length > 0 && !input.confirmDuplicateNames) {
    throw new DomainError("CONFLICT", {
      reason: "DUPLICATE_PARTICIPANT_NAMES",
      duplicates,
    });
  }
  const batchId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const source: RosterSource =
    project.status === "PRE_REGISTRATION" ? "PRE_REGISTRATION" : "IN_PROGRESS";
  const prepared = input.participants.map((participant) => ({
    participantId: crypto.randomUUID(),
    participantNumber: `P-${crypto.randomUUID().toUpperCase()}`,
    rosterEntryId: crypto.randomUUID(),
    ...participant,
  }));
  const guardId = crypto.randomUUID();
  const participantRevisionSum = existingParticipants.reduce(
    (sum, participant) => sum + participant.revision,
    0,
  );
  const snapshotPredicate = input.confirmDuplicateNames
    ? ""
    : ` AND (
           SELECT COUNT(*) FROM participants WHERE organization_id = ?
         ) = ? AND COALESCE((
           SELECT SUM(revision) FROM participants WHERE organization_id = ?
         ), 0) = ?`;
  const snapshotBindings = input.confirmDuplicateNames
    ? []
    : [
        input.organizationId,
        existingParticipants.length,
        input.organizationId,
        participantRevisionSum,
      ];
  const auditRows = prepared.flatMap((participant) => [
    {
      id: crypto.randomUUID(),
      action: "PARTICIPANT_CREATED",
      entityType: "PARTICIPANT",
      entityId: participant.participantId,
      detailsJson: JSON.stringify({
        batchId,
        projectId,
        organizationId: input.organizationId,
        participantRole: participant.role,
        studentGrade: participant.grade,
      }),
    },
    {
      id: crypto.randomUUID(),
      action: "ROSTER_ADDED",
      entityType: "ROSTER_ENTRY",
      entityId: participant.rosterEntryId,
      detailsJson: JSON.stringify({
        batchId,
        projectId,
        organizationId: input.organizationId,
        participantRole: participant.role,
        studentGrade: participant.grade,
      }),
    },
  ]);
  const statements = [
    ...chunks(prepared, PARTICIPANT_CHUNK_SIZE).map((chunk) =>
      participantInsert(env.DB, chunk, input.organizationId, timestamp),
    ),
    ...chunks(prepared, ROSTER_CHUNK_SIZE).map((chunk) =>
      rosterInsert(
        env.DB,
        chunk,
        projectId,
        input.organizationId,
        source,
        actor.session.user.id,
        timestamp,
      ),
    ),
    incrementProject(env.DB, projectId, timestamp),
    ...chunks(auditRows, AUDIT_CHUNK_SIZE).map((chunk) =>
      auditInsert(env.DB, chunk, actor.session.user.id, timestamp),
    ),
  ];
  try {
    await runGuardedAtomic(env.DB, {
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
         )${snapshotPredicate}`,
        [projectId, input.organizationId, ...snapshotBindings],
      ),
      statements,
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
    batchId,
    participants: prepared.map((participant) => ({
      participant: {
        id: participant.participantId,
        participantId: participant.participantNumber,
        name: participant.name,
        organizationId: input.organizationId,
        revision: 0,
      },
      rosterEntry: {
        id: participant.rosterEntryId,
        projectId,
        participantId: participant.participantId,
        participantNumber: participant.participantNumber,
        organizationId: input.organizationId,
        participantName: participant.name,
        organizationName: membership.name,
        source,
        status: "ACTIVE",
        role: participant.role,
        grade: participant.grade,
        wasExpectedAtStart: false,
        revision: 0,
        updatedAt: timestamp,
      },
    })),
    projectRevision: input.expectedRevision + 1,
  };
}

function collectDuplicates(
  names: string[],
  existingNames: string[],
): BulkParticipantDuplicate[] {
  const inputCounts = new Map<string, number>();
  const displayNames = new Map<string, string>();
  for (const name of names) {
    const key = canonicalizeParticipantName(name);
    inputCounts.set(key, (inputCounts.get(key) ?? 0) + 1);
    if (!displayNames.has(key)) displayNames.set(key, name);
  }
  const existingKeys = new Set(existingNames.map(canonicalizeParticipantName));
  return [...inputCounts].flatMap(([key, count]) => {
    const kinds: BulkParticipantDuplicate["kinds"] = [];
    if (count > 1) kinds.push("INPUT_DUPLICATE");
    if (existingKeys.has(key)) kinds.push("EXISTING_PARTICIPANT");
    return kinds.length > 0
      ? [{ name: displayNames.get(key) as string, kinds }]
      : [];
  });
}

interface PreparedParticipant {
  participantId: string;
  participantNumber: string;
  rosterEntryId: string;
  name: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
}

interface PreparedAudit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  detailsJson: string;
}

function participantInsert(
  db: D1Database,
  rows: PreparedParticipant[],
  organizationId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, participant_id, name) AS (VALUES ${values})
       INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       SELECT id, participant_id, name, ?, 0, ?, ? FROM input`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.participantId,
        row.participantNumber,
        row.name,
      ]),
      organizationId,
      timestamp,
      timestamp,
    );
}

function rosterInsert(
  db: D1Database,
  rows: PreparedParticipant[],
  projectId: string,
  organizationId: string,
  source: RosterSource,
  actorUserId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, participant_id, participant_name, participant_role, student_grade)
       AS (VALUES ${values})
       INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
       SELECT input.id, ?, input.participant_id, o.id,
              input.participant_name, o.name, input.participant_role,
              input.student_grade, ?, 'ACTIVE',
              0, 0, ?, ?, ?, ?
       FROM input JOIN organizations o ON o.id = ?`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.rosterEntryId,
        row.participantId,
        row.name,
        row.role,
        row.grade,
      ]),
      projectId,
      source,
      actorUserId,
      actorUserId,
      timestamp,
      timestamp,
      organizationId,
    );
}

function auditInsert(
  db: D1Database,
  rows: PreparedAudit[],
  actorUserId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, action, entity_type, entity_id, details_json)
       AS (VALUES ${values})
       INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       SELECT id, ?, action, entity_type, entity_id, ?, details_json FROM input`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.id,
        row.action,
        row.entityType,
        row.entityId,
        row.detailsJson,
      ]),
      actorUserId,
      timestamp,
    );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
