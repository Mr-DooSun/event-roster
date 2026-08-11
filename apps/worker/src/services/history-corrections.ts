import {
  type AddProjectOrganization,
  type AddProjectOrganizationsBulk,
  type BulkParticipantDuplicate,
  type Gender,
  type BulkRosterCreateRequest,
  type BulkRosterCreateResponse,
  type ClosedProjectCorrectionCandidateOrganization,
  type ClosedProjectCorrectionCandidateParticipant,
  canonicalizeParticipantName,
  type NormalizedImportRow,
  type ParticipantRole,
  ParticipantRoleSchema,
  type ProjectOrganizationBulkMutationResult,
  type ProjectOrganizationMutationResult,
  type ProjectOrganizationPatch,
  RosterParticipantProfileSchema,
  type RosterStatus,
  type StudentGrade,
  StudentGradeSchema,
} from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import {
  findOrganizationByCanonicalName,
  findOrganizationState,
} from "../db/organizations";
import { findProjectOrganization } from "../db/project-organizations";
import { findProject } from "../db/projects";
import {
  findRosterById,
  findRosterByParticipant,
  type RosterRecord,
} from "../db/roster";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard, requireAdministrativeOperator } from "./admin";
import {
  commitClosedCorrectionImport,
  validateClosedCorrectionImport,
} from "./imports";
import { canonicalizeOrganizationName } from "./organizations";

interface OrganizationCandidateRow {
  id: string;
  name: string;
  is_active: number;
  deleted_at: string | null;
}

interface ParticipantCandidateRow {
  id: string;
  participant_id: string;
  name: string;
  organization_id: string;
  revision: number;
  suggested_role: string | null;
  suggested_grade: string | null;
}

type ClosedRosterSnapshot = {
  name: string;
  organizationId: string;
  role: ParticipantRole | null;
  grade: StudentGrade | null;
  gender: Gender | null;
  status: RosterStatus;
};

type ClosedRosterCreateInput =
  | {
      participantId: string;
      confirmedParticipant: {
        name: string;
        organizationId: string;
        role: ParticipantRole;
        grade: StudentGrade | null;
        gender?: Gender | null | undefined;
      };
      expectedParticipantRevision: number;
      expectedRevision: number;
    }
  | {
      newParticipant: {
        name: string;
        organizationId: string;
        role: ParticipantRole;
        grade: StudentGrade | null;
        gender?: Gender | null | undefined;
      };
      expectedRevision: number;
    };

type ClosedRosterPatchInput = {
  name?: string | undefined;
  organizationId?: string | undefined;
  role?: ParticipantRole | undefined;
  grade?: StudentGrade | null | undefined;
  gender?: Gender | null | undefined;
  status?: RosterStatus | undefined;
  expectedProjectRevision: number;
  expectedEntryRevision: number;
};

interface ClosedRosterCorrectionHooks {
  afterCommit?: () => Promise<void>;
}

const CLOSED_BULK_PARTICIPANT_CHUNK_SIZE = 15;
const CLOSED_BULK_ROSTER_CHUNK_SIZE = 15;
const CLOSED_BULK_AUDIT_CHUNK_SIZE = 18;

export async function validateClosedProjectImport(
  env: Env,
  actor: Actor,
  projectId: string,
  rows: NormalizedImportRow[],
) {
  requireAdministrativeOperator(actor);
  return validateClosedCorrectionImport(env, projectId, rows);
}

export async function commitClosedProjectImport(
  env: Env,
  actor: Actor,
  projectId: string,
  rows: NormalizedImportRow[],
  expectedProjectRevision: number,
  currentTime = new Date(),
) {
  requireAdministrativeOperator(actor);
  return commitClosedCorrectionImport(
    env,
    actor,
    projectId,
    rows,
    expectedProjectRevision,
    currentTime,
  );
}

export async function requireClosedCorrectionProject(
  env: Env,
  actor: Actor,
  projectId: string,
) {
  requireAdministrativeOperator(actor);
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status !== "CLOSED") {
    throw new DomainError("INVALID_TRANSITION");
  }
  return project;
}

export function createClosedCorrectionGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  projectId: string,
  expectedProjectRevision: number,
  operationPredicate = "1 = 1",
  operationBindings: Array<string | number> = [],
) {
  return createOperatorGuard(
    db,
    guardId,
    actor,
    `EXISTS (
       SELECT 1 FROM projects
       WHERE id = ? AND status = 'CLOSED' AND revision = ?
         AND deleted_at IS NULL
     ) AND (${operationPredicate})`,
    [projectId, expectedProjectRevision, ...operationBindings],
  );
}

export async function getClosedCorrectionCandidates(
  env: Env,
  actor: Actor,
  projectId: string,
): Promise<{
  organizations: ClosedProjectCorrectionCandidateOrganization[];
  participants: ClosedProjectCorrectionCandidateParticipant[];
}> {
  await requireClosedCorrectionProject(env, actor, projectId);
  const [organizationRows, participantRows] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, is_active, deleted_at
       FROM organizations
       ORDER BY name, id`,
    ).all<OrganizationCandidateRow>(),
    env.DB.prepare(
      `SELECT p.id, p.participant_id, p.name, p.organization_id, p.revision,
              (SELECT r.participant_role_snapshot
               FROM project_roster_entries r
               WHERE r.participant_id = p.id
               ORDER BY r.updated_at DESC, r.id DESC
               LIMIT 1) AS suggested_role,
              (SELECT r.student_grade_snapshot
               FROM project_roster_entries r
               WHERE r.participant_id = p.id
               ORDER BY r.updated_at DESC, r.id DESC
               LIMIT 1) AS suggested_grade
       FROM participants p
       ORDER BY p.name, p.participant_id`,
    ).all<ParticipantCandidateRow>(),
  ]);

  return {
    organizations: organizationRows.results.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active === 1,
      isDeleted: row.deleted_at !== null,
    })),
    participants: participantRows.results.map((row) => ({
      id: row.id,
      participantId: row.participant_id,
      name: row.name,
      organizationId: row.organization_id,
      revision: row.revision,
      suggestedRole:
        row.suggested_role === null
          ? null
          : ParticipantRoleSchema.parse(row.suggested_role),
      suggestedGrade:
        row.suggested_grade === null
          ? null
          : StudentGradeSchema.parse(row.suggested_grade),
    })),
  };
}

export async function correctClosedProjectRoster(
  env: Env,
  actor: Actor,
  projectId: string,
  input: ClosedRosterCreateInput,
  now = new Date(),
  hooks?: ClosedRosterCorrectionHooks,
) {
  return "newParticipant" in input
    ? createClosedProjectParticipantAndRoster(
        env,
        actor,
        projectId,
        input.newParticipant,
        input.expectedRevision,
        now,
        hooks,
      )
    : addExistingParticipantToClosedProject(
        env,
        actor,
        projectId,
        input,
        now,
        hooks,
      );
}

async function addExistingParticipantToClosedProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: Extract<ClosedRosterCreateInput, { participantId: string }>,
  now: Date,
  hooks?: ClosedRosterCorrectionHooks,
): Promise<{
  created: boolean;
  result: RosterRecord & { projectRevision: number };
}> {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const participant = await env.DB.prepare(
    `SELECT id, participant_id, revision
     FROM participants WHERE id = ?`,
  )
    .bind(input.participantId)
    .first<{ id: string; participant_id: string; revision: number }>();
  if (!participant) throw new DomainError("NOT_FOUND");
  if (participant.revision !== input.expectedParticipantRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const organization = await findOrganizationState(
    env.DB,
    input.confirmedParticipant.organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  await requireActiveClosedProjectMembership(
    env,
    projectId,
    input.confirmedParticipant.organizationId,
  );
  const existing = await findRosterByParticipant(
    env.DB,
    projectId,
    input.participantId,
  );
  if (existing?.status === "ACTIVE") throw new DomainError("CONFLICT");

  const timestamp = now.toISOString();
  const entryId = existing?.id ?? crypto.randomUUID();
  const after: ClosedRosterSnapshot = {
    ...input.confirmedParticipant,
    gender: input.confirmedParticipant.gender ?? null,
    status: "ACTIVE",
  };
  const before = existing ? closedRosterSnapshot(existing) : null;
  const operation = existing ? "RESTORED" : "ADDED";
  const guardId = crypto.randomUUID();
  const operationPredicate = existing
    ? `EXISTS (
         SELECT 1 FROM project_roster_entries
         WHERE id = ? AND project_id = ? AND participant_id = ?
           AND revision = ? AND status = 'CANCELLED'
       )`
    : `NOT EXISTS (
         SELECT 1 FROM project_roster_entries
         WHERE project_id = ? AND participant_id = ?
       )`;
  const operationBindings = existing
    ? [existing.id, projectId, input.participantId, existing.revision]
    : [projectId, input.participantId];
  const statements: D1PreparedStatement[] = existing
    ? [
        env.DB.prepare(
          `UPDATE project_roster_entries
           SET participant_name_snapshot = ?, organization_id = ?,
               organization_name_snapshot = ?,
               participant_role_snapshot = ?, student_grade_snapshot = ?, gender_snapshot = ?,
               status = 'ACTIVE', revision = revision + 1,
               updated_by = ?, updated_at = ?
           WHERE id = ? AND project_id = ? AND revision = ?`,
        ).bind(
          after.name,
          after.organizationId,
          organization.name,
          after.role,
          after.grade,
          after.gender ?? null,
          actor.session.user.id,
          timestamp,
          existing.id,
          projectId,
          existing.revision,
        ),
      ]
    : [
        env.DB.prepare(
          `INSERT INTO project_roster_entries
           (id, project_id, participant_id, organization_id,
            participant_name_snapshot, organization_name_snapshot,
            participant_role_snapshot, student_grade_snapshot, gender_snapshot, source, status,
            was_expected_at_start, revision, created_by, updated_by,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 'ACTIVE',
                   0, 0, ?, ?, ?, ?)`,
        ).bind(
          entryId,
          projectId,
          input.participantId,
          after.organizationId,
          after.name,
          organization.name,
          after.role,
          after.grade,
          after.gender ?? null,
          actor.session.user.id,
          actor.session.user.id,
          timestamp,
          timestamp,
        ),
      ];
  statements.push(
    projectRevisionStatement(
      env.DB,
      projectId,
      input.expectedRevision,
      timestamp,
    ),
    closedProjectRosterCorrectionAuditStatement(
      env.DB,
      actor.session.user.id,
      entryId,
      projectId,
      after.organizationId,
      operation,
      before,
      after,
      timestamp,
    ),
  );

  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedRevision,
        `EXISTS (
           SELECT 1 FROM participants
           WHERE id = ? AND revision = ?
         ) AND EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND name = ?
         ) AND EXISTS (
           SELECT 1 FROM project_organizations
           WHERE project_id = ? AND organization_id = ? AND is_active = 1
         ) AND ${operationPredicate}`,
        [
          input.participantId,
          input.expectedParticipantRevision,
          after.organizationId,
          organization.name,
          projectId,
          after.organizationId,
          ...operationBindings,
        ],
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedRosterCorrectionFailure(
      env,
      projectId,
      input.expectedRevision,
      error,
    );
  }
  await hooks?.afterCommit?.();
  return {
    created: !existing,
    result: {
      id: entryId,
      projectId,
      participantId: input.participantId,
      participantNumber: participant.participant_id,
      organizationId: after.organizationId,
      participantName: after.name,
      organizationName: organization.name,
      source: existing?.source ?? "IN_PROGRESS",
      status: "ACTIVE",
      role: after.role,
      grade: after.grade,
      gender: after.gender ?? null,
      wasExpectedAtStart: existing?.wasExpectedAtStart ?? false,
      revision: existing ? existing.revision + 1 : 0,
      updatedAt: timestamp,
      projectRevision: input.expectedRevision + 1,
    },
  };
}

async function createClosedProjectParticipantAndRoster(
  env: Env,
  actor: Actor,
  projectId: string,
  participantInput: {
    name: string;
    organizationId: string;
    role: ParticipantRole;
    grade: StudentGrade | null;
    gender?: Gender | null | undefined;
  },
  expectedRevision: number,
  now: Date,
  hooks?: ClosedRosterCorrectionHooks,
) {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== expectedRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const organization = await findOrganizationState(
    env.DB,
    participantInput.organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  await requireActiveClosedProjectMembership(
    env,
    projectId,
    participantInput.organizationId,
  );

  const participantId = crypto.randomUUID();
  const participantNumber = `P-${crypto.randomUUID().toUpperCase()}`;
  const entryId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const after: ClosedRosterSnapshot = {
    ...participantInput,
    gender: participantInput.gender ?? null,
    status: "ACTIVE",
  };
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        expectedRevision,
        `EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND name = ?
         ) AND EXISTS (
           SELECT 1 FROM project_organizations
           WHERE project_id = ? AND organization_id = ? AND is_active = 1
         )`,
        [
          participantInput.organizationId,
          organization.name,
          projectId,
          participantInput.organizationId,
        ],
      ),
      statements: [
        env.DB.prepare(
          `INSERT INTO participants
           (id, participant_id, name, organization_id, revision,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        ).bind(
          participantId,
          participantNumber,
          participantInput.name,
          participantInput.organizationId,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          `INSERT INTO project_roster_entries
           (id, project_id, participant_id, organization_id,
            participant_name_snapshot, organization_name_snapshot,
            participant_role_snapshot, student_grade_snapshot, gender_snapshot, source, status,
            was_expected_at_start, revision, created_by, updated_by,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 'ACTIVE',
                   0, 0, ?, ?, ?, ?)`,
        ).bind(
          entryId,
          projectId,
          participantId,
          participantInput.organizationId,
          participantInput.name,
          organization.name,
          participantInput.role,
          participantInput.grade,
          participantInput.gender ?? null,
          actor.session.user.id,
          actor.session.user.id,
          timestamp,
          timestamp,
        ),
        projectRevisionStatement(
          env.DB,
          projectId,
          expectedRevision,
          timestamp,
        ),
        closedProjectRosterCorrectionAuditStatement(
          env.DB,
          actor.session.user.id,
          entryId,
          projectId,
          participantInput.organizationId,
          "CREATED_AND_ADDED",
          null,
          after,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedRosterCorrectionFailure(
      env,
      projectId,
      expectedRevision,
      error,
    );
  }
  await hooks?.afterCommit?.();
  return {
    created: true,
    result: {
      participant: {
        id: participantId,
        participantId: participantNumber,
        name: participantInput.name,
        organizationId: participantInput.organizationId,
        revision: 0,
      },
      rosterEntry: {
        id: entryId,
        projectId,
        participantId,
        participantNumber,
        organizationId: participantInput.organizationId,
        participantName: participantInput.name,
        organizationName: organization.name,
        source: "IN_PROGRESS" as const,
        status: "ACTIVE" as const,
        role: participantInput.role,
        grade: participantInput.grade,
        wasExpectedAtStart: false,
        revision: 0,
        updatedAt: timestamp,
      },
      projectRevision: expectedRevision + 1,
    },
  };
}

export async function patchClosedProjectRoster(
  env: Env,
  actor: Actor,
  projectId: string,
  entryId: string,
  input: ClosedRosterPatchInput,
  now = new Date(),
  hooks?: ClosedRosterCorrectionHooks,
): Promise<RosterRecord & { projectRevision: number }> {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const current = await findRosterById(env.DB, projectId, entryId);
  if (!current) throw new DomainError("NOT_FOUND");
  if (current.revision !== input.expectedEntryRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const after: ClosedRosterSnapshot = {
    name: input.name ?? current.participantName,
    organizationId: input.organizationId ?? current.organizationId,
    role: input.role ?? current.role,
    grade: input.grade !== undefined ? input.grade : current.grade,
    gender: input.gender !== undefined ? input.gender : current.gender,
    status: input.status ?? current.status,
  };
  if (input.role !== undefined || input.grade !== undefined) {
    const profile = RosterParticipantProfileSchema.safeParse({
      role: after.role,
      grade: after.grade,
    });
    if (!profile.success) throw new DomainError("VALIDATION_FAILED");
    after.role = profile.data.role;
    after.grade = profile.data.grade;
  }
  const before = closedRosterSnapshot(current);
  if (sameClosedRosterSnapshot(before, after)) {
    throw new DomainError("CONFLICT");
  }
  const organization = await findOrganizationState(
    env.DB,
    after.organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  await requireActiveClosedProjectMembership(
    env,
    projectId,
    after.organizationId,
  );

  const operation =
    after.status === before.status
      ? "UPDATED"
      : after.status === "CANCELLED"
        ? "CANCELLED"
        : "RESTORED";
  const timestamp = now.toISOString();
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedProjectRevision,
        `EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND name = ?
         ) AND EXISTS (
           SELECT 1 FROM project_organizations
           WHERE project_id = ? AND organization_id = ? AND is_active = 1
         ) AND EXISTS (
           SELECT 1 FROM project_roster_entries
           WHERE id = ? AND project_id = ? AND revision = ?
         )`,
        [
          after.organizationId,
          organization.name,
          projectId,
          after.organizationId,
          entryId,
          projectId,
          input.expectedEntryRevision,
        ],
      ),
      statements: [
        env.DB.prepare(
          `UPDATE project_roster_entries
           SET participant_name_snapshot = ?, organization_id = ?,
               organization_name_snapshot = ?,
               participant_role_snapshot = ?, student_grade_snapshot = ?, gender_snapshot = ?,
               status = ?, revision = revision + 1,
               updated_by = ?, updated_at = ?
           WHERE id = ? AND project_id = ? AND revision = ?`,
        ).bind(
          after.name,
          after.organizationId,
          organization.name,
          after.role,
          after.grade,
          after.gender,
          after.status,
          actor.session.user.id,
          timestamp,
          entryId,
          projectId,
          input.expectedEntryRevision,
        ),
        projectRevisionStatement(
          env.DB,
          projectId,
          input.expectedProjectRevision,
          timestamp,
        ),
        closedProjectRosterCorrectionAuditStatement(
          env.DB,
          actor.session.user.id,
          entryId,
          projectId,
          after.organizationId,
          operation,
          before,
          after,
          timestamp,
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedRosterCorrectionFailure(
      env,
      projectId,
      input.expectedProjectRevision,
      error,
    );
  }
  await hooks?.afterCommit?.();
  return {
    ...current,
    organizationId: after.organizationId,
    participantName: after.name,
    organizationName: organization.name,
    status: after.status,
    role: after.role,
    grade: after.grade,
    gender: after.gender,
    revision: input.expectedEntryRevision + 1,
    updatedAt: timestamp,
    projectRevision: input.expectedProjectRevision + 1,
  };
}

export async function correctClosedProjectRosterBulk(
  env: Env,
  actor: Actor,
  projectId: string,
  input: BulkRosterCreateRequest,
  now = new Date(),
): Promise<BulkRosterCreateResponse> {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const organization = await findOrganizationState(
    env.DB,
    input.organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  await requireActiveClosedProjectMembership(
    env,
    projectId,
    input.organizationId,
  );
  const existingParticipants = (
    await env.DB.prepare(
      `SELECT id, name, revision FROM participants
       WHERE organization_id = ? ORDER BY id`,
    )
      .bind(input.organizationId)
      .all<{ id: string; name: string; revision: number }>()
  ).results;
  const duplicates = collectClosedBulkDuplicates(
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
  const prepared = input.participants.map((participant) => ({
    participantId: crypto.randomUUID(),
    participantNumber: `P-${crypto.randomUUID().toUpperCase()}`,
    rosterEntryId: crypto.randomUUID(),
    ...participant,
  }));
  const participantSnapshotFingerprint = JSON.stringify(
    existingParticipants.map((participant) => [
      participant.id,
      participant.name,
      participant.revision,
    ]),
  );
  const snapshotPredicate = input.confirmDuplicateNames
    ? ""
    : ` AND (
           SELECT json_group_array(json_array(id, name, revision))
           FROM (
             SELECT id, name, revision FROM participants
             WHERE organization_id = ? ORDER BY id
           )
         ) = ?`;
  const snapshotBindings = input.confirmDuplicateNames
    ? []
    : [input.organizationId, participantSnapshotFingerprint];
  const auditRows = prepared.map((participant) => ({
    id: crypto.randomUUID(),
    entityId: participant.rosterEntryId,
    detailsJson: JSON.stringify({
      batchId,
      projectId,
      organizationId: input.organizationId,
      operation: "CREATED_AND_ADDED",
      before: null,
      after: {
        name: participant.name,
        organizationId: input.organizationId,
        role: participant.role,
        grade: participant.grade,
        status: "ACTIVE",
      },
    }),
  }));
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedRevision,
        `EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND name = ?
         ) AND EXISTS (
           SELECT 1 FROM project_organizations
           WHERE project_id = ? AND organization_id = ? AND is_active = 1
         )${snapshotPredicate}`,
        [
          input.organizationId,
          organization.name,
          projectId,
          input.organizationId,
          ...snapshotBindings,
        ],
      ),
      statements: [
        ...closedChunks(prepared, CLOSED_BULK_PARTICIPANT_CHUNK_SIZE).map(
          (chunk) =>
            closedBulkParticipantInsert(
              env.DB,
              chunk,
              input.organizationId,
              timestamp,
            ),
        ),
        ...closedChunks(prepared, CLOSED_BULK_ROSTER_CHUNK_SIZE).map((chunk) =>
          closedBulkRosterInsert(
            env.DB,
            chunk,
            projectId,
            input.organizationId,
            actor.session.user.id,
            timestamp,
          ),
        ),
        projectRevisionStatement(
          env.DB,
          projectId,
          input.expectedRevision,
          timestamp,
        ),
        ...closedChunks(auditRows, CLOSED_BULK_AUDIT_CHUNK_SIZE).map((chunk) =>
          closedBulkAuditInsert(
            env.DB,
            chunk,
            actor.session.user.id,
            timestamp,
          ),
        ),
      ],
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    await translateClosedRosterCorrectionFailure(
      env,
      projectId,
      input.expectedRevision,
      error,
    );
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
        organizationName: organization.name,
        source: "IN_PROGRESS",
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

export async function correctClosedProjectOrganization(
  env: Env,
  actor: Actor,
  projectId: string,
  input: AddProjectOrganization,
  now = new Date(),
): Promise<ProjectOrganizationMutationResult & { created: boolean }> {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }

  const timestamp = now.toISOString();
  const newOrganization = "newOrganizationName" in input;
  const canonicalName = newOrganization
    ? canonicalizeOrganizationName(input.newOrganizationName)
    : null;
  if (canonicalName) {
    const existing = await findOrganizationByCanonicalName(
      env.DB,
      canonicalName,
    );
    if (existing) throwOrganizationNameConflict(existing);
  }
  const organizationId = newOrganization
    ? crypto.randomUUID()
    : input.organizationId;
  if (!newOrganization) {
    const organization = await findOrganizationState(env.DB, organizationId);
    if (!organization) throw new DomainError("NOT_FOUND");
  }
  const current = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (current?.isActive) throw new DomainError("CONFLICT");

  const operation = newOrganization
    ? "CREATED_AND_ADDED"
    : current
      ? "REACTIVATED"
      : "ADDED";
  const created = newOrganization || !current;
  const guardId = crypto.randomUUID();
  const operationPredicate = newOrganization
    ? `NOT EXISTS (
         SELECT 1 FROM organizations WHERE canonical_name = ?
       ) AND NOT EXISTS (
         SELECT 1 FROM project_organizations
         WHERE project_id = ? AND organization_id = ?
       )`
    : `EXISTS (
         SELECT 1 FROM organizations WHERE id = ?
       ) AND NOT EXISTS (
         SELECT 1 FROM project_organizations
         WHERE project_id = ? AND organization_id = ? AND is_active = 1
       )`;
  const operationBindings = newOrganization
    ? [canonicalName as string, projectId, organizationId]
    : [organizationId, projectId, organizationId];
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
        canonicalName,
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
    projectRevisionStatement(
      env.DB,
      projectId,
      input.expectedProjectRevision,
      timestamp,
    ),
    closedProjectOrganizationCorrectionAuditStatement(
      env.DB,
      actor.session.user.id,
      projectId,
      organizationId,
      operation,
      current ? { isActive: current.isActive } : null,
      { isActive: true },
      timestamp,
    ),
  );

  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedProjectRevision,
        operationPredicate,
        operationBindings,
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    await translateClosedCorrectionFailure(
      env,
      projectId,
      input.expectedProjectRevision,
      error,
      canonicalName,
    );
  }
  const organization = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  return {
    organization,
    projectRevision: input.expectedProjectRevision + 1,
    created,
  };
}

export async function correctClosedProjectOrganizationsBulk(
  env: Env,
  actor: Actor,
  projectId: string,
  input: AddProjectOrganizationsBulk,
  now = new Date(),
): Promise<ProjectOrganizationBulkMutationResult> {
  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }

  const timestamp = now.toISOString();
  const guardId = crypto.randomUUID();
  const operationPredicate = input.organizationIds
    .map(
      () => `EXISTS (SELECT 1 FROM organizations WHERE id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM project_organizations
          WHERE project_id = ? AND organization_id = ? AND is_active = 1
        )`,
    )
    .join(" AND ");
  const operationBindings = input.organizationIds.flatMap((organizationId) => [
    organizationId,
    projectId,
    organizationId,
  ]);
  const statements: D1PreparedStatement[] = input.organizationIds.flatMap(
    (organizationId) => [
      env.DB.prepare(
        `INSERT INTO project_organizations
         (project_id, organization_id, is_active, added_at, deactivated_at,
          added_by, updated_by)
         VALUES (?, ?, 1, ?, NULL, ?, ?)
         ON CONFLICT(project_id, organization_id) DO UPDATE SET
           is_active = 1,
           deactivated_at = CASE
             WHEN project_organizations.is_active = 0 THEN excluded.added_at
             ELSE NULL
           END,
           updated_by = excluded.updated_by`,
      ).bind(
        projectId,
        organizationId,
        timestamp,
        actor.session.user.id,
        actor.session.user.id,
      ),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
         SELECT ?, ?, 'CLOSED_PROJECT_ORGANIZATION_CORRECTED',
                'PROJECT_ORGANIZATION', ?, ?,
                json_object(
                  'projectId', ?,
                  'organizationId', ?,
                  'operation', CASE WHEN deactivated_at = ? THEN 'REACTIVATED' ELSE 'ADDED' END,
                  'before', CASE WHEN deactivated_at = ? THEN json_object('isActive', 0) ELSE NULL END,
                  'after', json_object('isActive', 1)
                )
         FROM project_organizations
         WHERE project_id = ? AND organization_id = ? AND is_active = 1`,
      ).bind(
        crypto.randomUUID(),
        actor.session.user.id,
        `${projectId}:${organizationId}`,
        timestamp,
        projectId,
        organizationId,
        timestamp,
        timestamp,
        projectId,
        organizationId,
      ),
      env.DB.prepare(
        `UPDATE project_organizations SET deactivated_at = NULL
         WHERE project_id = ? AND organization_id = ? AND deactivated_at = ?`,
      ).bind(projectId, organizationId, timestamp),
    ],
  );
  statements.push(
    projectRevisionStatement(
      env.DB,
      projectId,
      input.expectedProjectRevision,
      timestamp,
    ),
  );

  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedProjectRevision,
        operationPredicate,
        operationBindings,
      ),
      statements,
      failureCode: "CONFLICT",
    });
  } catch (error) {
    await translateClosedCorrectionFailure(
      env,
      projectId,
      input.expectedProjectRevision,
      error,
    );
  }

  return {
    organizationIds: input.organizationIds,
    projectRevision: input.expectedProjectRevision + 1,
  };
}

export async function setClosedProjectOrganizationActive(
  env: Env,
  actor: Actor,
  projectId: string,
  organizationId: string,
  input: ProjectOrganizationPatch,
  now = new Date(),
): Promise<ProjectOrganizationMutationResult> {
  if (input.isActive) {
    const result = await correctClosedProjectOrganization(
      env,
      actor,
      projectId,
      {
        organizationId,
        expectedProjectRevision: input.expectedProjectRevision,
      },
      now,
    );
    return {
      organization: result.organization,
      projectRevision: result.projectRevision,
    };
  }

  const project = await requireClosedCorrectionProject(env, actor, projectId);
  if (project.revision !== input.expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }
  const current = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!current?.isActive) throw new DomainError("NOT_FOUND");

  const timestamp = now.toISOString();
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createClosedCorrectionGuard(
        env.DB,
        guardId,
        actor,
        projectId,
        input.expectedProjectRevision,
        `EXISTS (
           SELECT 1 FROM project_organizations
           WHERE project_id = ? AND organization_id = ? AND is_active = 1
         )`,
        [projectId, organizationId],
      ),
      statements: [
        env.DB.prepare(
          `UPDATE project_organizations
           SET is_active = 0, deactivated_at = ?, updated_by = ?
           WHERE project_id = ? AND organization_id = ? AND is_active = 1`,
        ).bind(timestamp, actor.session.user.id, projectId, organizationId),
        projectRevisionStatement(
          env.DB,
          projectId,
          input.expectedProjectRevision,
          timestamp,
        ),
        closedProjectOrganizationCorrectionAuditStatement(
          env.DB,
          actor.session.user.id,
          projectId,
          organizationId,
          "EXCLUDED",
          { isActive: true },
          { isActive: false },
          timestamp,
        ),
      ],
      failureCode: "CONFLICT",
    });
  } catch (error) {
    await translateClosedCorrectionFailure(
      env,
      projectId,
      input.expectedProjectRevision,
      error,
    );
  }
  const organization = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!organization) throw new DomainError("NOT_FOUND");
  return {
    organization,
    projectRevision: input.expectedProjectRevision + 1,
  };
}

async function requireActiveClosedProjectMembership(
  env: Env,
  projectId: string,
  organizationId: string,
) {
  const membership = await findProjectOrganization(
    env.DB,
    projectId,
    organizationId,
  );
  if (!membership?.isActive) throw new DomainError("VALIDATION_FAILED");
  return membership;
}

function closedRosterSnapshot(entry: RosterRecord): ClosedRosterSnapshot {
  return {
    name: entry.participantName,
    organizationId: entry.organizationId,
    role: entry.role,
    grade: entry.grade,
    gender: entry.gender,
    status: entry.status,
  };
}

function sameClosedRosterSnapshot(
  left: ClosedRosterSnapshot,
  right: ClosedRosterSnapshot,
): boolean {
  return (
    left.name === right.name &&
    left.organizationId === right.organizationId &&
    left.role === right.role &&
    left.grade === right.grade &&
    left.gender === right.gender &&
    left.status === right.status
  );
}

interface ClosedBulkPreparedParticipant {
  participantId: string;
  participantNumber: string;
  rosterEntryId: string;
  name: string;
  role: ParticipantRole;
  grade: StudentGrade | null;
}

interface ClosedBulkPreparedAudit {
  id: string;
  entityId: string;
  detailsJson: string;
}

function collectClosedBulkDuplicates(
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

function closedBulkParticipantInsert(
  db: D1Database,
  rows: ClosedBulkPreparedParticipant[],
  organizationId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, participant_id, name) AS (VALUES ${values})
       INSERT INTO participants
       (id, participant_id, name, organization_id, revision,
        created_at, updated_at)
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

function closedBulkRosterInsert(
  db: D1Database,
  rows: ClosedBulkPreparedParticipant[],
  projectId: string,
  organizationId: string,
  actorUserId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, participant_id, participant_name,
                  participant_role, student_grade)
       AS (VALUES ${values})
       INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by,
        created_at, updated_at)
       SELECT input.id, ?, input.participant_id, o.id,
              input.participant_name, o.name, input.participant_role,
              input.student_grade, 'IN_PROGRESS', 'ACTIVE', 0, 0,
              ?, ?, ?, ?
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
      actorUserId,
      actorUserId,
      timestamp,
      timestamp,
      organizationId,
    );
}

function closedBulkAuditInsert(
  db: D1Database,
  rows: ClosedBulkPreparedAudit[],
  actorUserId: string,
  timestamp: string,
) {
  const values = rows.map(() => "(?, ?, ?)").join(", ");
  return db
    .prepare(
      `WITH input(id, entity_id, details_json) AS (VALUES ${values})
       INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id,
        occurred_at, details_json)
       SELECT id, ?, 'CLOSED_PROJECT_ROSTER_CORRECTED', 'ROSTER_ENTRY',
              entity_id, ?, details_json FROM input`,
    )
    .bind(
      ...rows.flatMap((row) => [row.id, row.entityId, row.detailsJson]),
      actorUserId,
      timestamp,
    );
}

function closedChunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function projectRevisionStatement(
  db: D1Database,
  projectId: string,
  expectedProjectRevision: number,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE projects
       SET revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ? AND status = 'CLOSED'
         AND deleted_at IS NULL`,
    )
    .bind(timestamp, projectId, expectedProjectRevision);
}

function closedProjectRosterCorrectionAuditStatement(
  db: D1Database,
  actorId: string,
  entryId: string,
  projectId: string,
  organizationId: string,
  operation:
    | "ADDED"
    | "CREATED_AND_ADDED"
    | "UPDATED"
    | "CANCELLED"
    | "RESTORED",
  before: ClosedRosterSnapshot | null,
  after: ClosedRosterSnapshot,
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at,
        details_json)
       VALUES (?, ?, 'CLOSED_PROJECT_ROSTER_CORRECTED', 'ROSTER_ENTRY',
               ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      entryId,
      timestamp,
      JSON.stringify({ projectId, organizationId, operation, before, after }),
    );
}

function closedProjectOrganizationCorrectionAuditStatement(
  db: D1Database,
  actorId: string,
  projectId: string,
  organizationId: string,
  operation: "ADDED" | "CREATED_AND_ADDED" | "EXCLUDED" | "REACTIVATED",
  before: { isActive: boolean } | null,
  after: { isActive: boolean },
  timestamp: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'CLOSED_PROJECT_ORGANIZATION_CORRECTED',
               'PROJECT_ORGANIZATION', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorId,
      `${projectId}:${organizationId}`,
      timestamp,
      JSON.stringify({ projectId, organizationId, operation, before, after }),
    );
}

async function translateClosedCorrectionFailure(
  env: Env,
  projectId: string,
  expectedProjectRevision: number,
  error: unknown,
  canonicalName?: string | null,
): Promise<never> {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status !== "CLOSED") throw new DomainError("INVALID_TRANSITION");
  if (canonicalName) {
    const existing = await findOrganizationByCanonicalName(
      env.DB,
      canonicalName,
    );
    if (existing) throwOrganizationNameConflict(existing);
  }
  if (project.revision !== expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }
  throwConstraintConflict(error);
}

async function translateClosedRosterCorrectionFailure(
  env: Env,
  projectId: string,
  expectedProjectRevision: number,
  error: unknown,
): Promise<never> {
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (project.status !== "CLOSED") throw new DomainError("INVALID_TRANSITION");
  if (project.revision !== expectedProjectRevision) {
    throw new DomainError("STALE_REVISION");
  }
  if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
    throw new DomainError("CONFLICT");
  }
  throw error;
}

function throwOrganizationNameConflict(organization: {
  id: string;
  name: string;
  isDeleted: boolean;
}): never {
  if (organization.isDeleted) {
    throw new DomainError("ORGANIZATION_NAME_RESERVED", {
      organizationId: organization.id,
    });
  }
  throw new DomainError("CONFLICT", {
    organizationId: organization.id,
    organizationName: organization.name,
    reason: "ORGANIZATION_NAME_EXISTS",
  });
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
