import type {
  NormalizedImportRow,
  ParticipantRole,
  RosterSource,
  RosterStatus,
  StudentGrade,
} from "@event-roster/contracts";
import {
  DomainError,
  toKstDate,
  validateNormalizedRows,
} from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import { findProject } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard } from "./admin";
import { closeExpiredProject } from "./project-expiration";
import { getRoster, getSummary } from "./roster";

const PARTICIPANT_CHUNK_SIZE = 15;
const ROSTER_CHUNK_SIZE = 9;
const AUDIT_CHUNK_SIZE = 45;

interface ImportMutationPolicy {
  mode: "ORDINARY" | "CLOSED_CORRECTION";
  source: "PRE_REGISTRATION" | "IN_PROGRESS";
  auditAction: "ROSTER_IMPORTED" | "CLOSED_PROJECT_ROSTER_IMPORTED";
  allowHistoricalOrganizationMasters: boolean;
}

const ORDINARY_IMPORT_POLICY: ImportMutationPolicy = {
  mode: "ORDINARY",
  source: "PRE_REGISTRATION",
  auditAction: "ROSTER_IMPORTED",
  allowHistoricalOrganizationMasters: false,
};

const CLOSED_CORRECTION_IMPORT_POLICY: ImportMutationPolicy = {
  mode: "CLOSED_CORRECTION",
  source: "IN_PROGRESS",
  auditAction: "CLOSED_PROJECT_ROSTER_IMPORTED",
  allowHistoricalOrganizationMasters: true,
};

interface ImportRosterSnapshot {
  name: string;
  organizationId: string;
  role: ParticipantRole | null;
  grade: StudentGrade | null;
  status: RosterStatus;
}

interface ResolvedImportRow {
  rowNumber: number;
  name: string;
  expectedParticipantName: string;
  organizationId: string;
  organizationName: string;
  organizationCanonicalName: string;
  participantId: string;
  participantRevision: number;
  entryId: string;
  createParticipant: boolean;
  organizationParticipantCountAfterInsert: number;
  organizationParticipantRevisionSum: number;
  mutateRoster: boolean;
  before: ImportRosterSnapshot | null;
  after: ImportRosterSnapshot;
  role: ParticipantRole;
  grade: StudentGrade | null;
}

export function buildImportQueryPlan(rows: NormalizedImportRow[]) {
  const participantChunks = Math.ceil(rows.length / PARTICIPANT_CHUNK_SIZE);
  const rosterChunks = Math.ceil(rows.length / ROSTER_CHUNK_SIZE);
  const auditChunks = Math.ceil(rows.length / AUDIT_CHUNK_SIZE);
  return {
    rows,
    queryCount:
      4 + 1 + participantChunks + rosterChunks + auditChunks + 1 + 1 + 1,
    bindingCounts: [
      1,
      0,
      1,
      6 * Math.min(PARTICIPANT_CHUNK_SIZE, rows.length),
      10 * Math.min(ROSTER_CHUNK_SIZE, rows.length) + 6,
      2 * Math.min(AUDIT_CHUNK_SIZE, rows.length) + 2,
      2,
      5,
      1,
    ],
  };
}

export async function validateImport(
  env: Env,
  projectId: string,
  rows: NormalizedImportRow[],
) {
  return validateImportWithPolicy(env, projectId, rows, ORDINARY_IMPORT_POLICY);
}

export async function validateClosedCorrectionImport(
  env: Env,
  projectId: string,
  rows: NormalizedImportRow[],
) {
  return validateImportWithPolicy(
    env,
    projectId,
    rows,
    CLOSED_CORRECTION_IMPORT_POLICY,
  );
}

async function validateImportWithPolicy(
  env: Env,
  projectId: string,
  rows: NormalizedImportRow[],
  policy: ImportMutationPolicy,
) {
  const normalized = validateNormalizedRows(rows);
  const project = await requireImportProject(
    env,
    projectId,
    new Date(),
    policy,
  );
  const resolved = await resolveRows(env.DB, projectId, normalized, policy);
  return {
    projectRevision: project.revision,
    rows: resolved.map((row) => ({
      rowNumber: row.input.rowNumber,
      name: row.input.name,
      organizationName: row.input.organizationName,
      role: row.input.role,
      grade: row.input.grade,
      issues: row.issues,
      candidates: row.candidates.map((candidate) => ({
        participantId: candidate.id,
        participantNumber: candidate.participant_id,
        name: candidate.name,
      })),
    })),
  };
}

export async function commitImport(
  env: Env,
  actor: Actor,
  projectId: string,
  rows: NormalizedImportRow[],
  expectedProjectRevision: number,
  currentTime = new Date(),
) {
  return commitImportWithPolicy(
    env,
    actor,
    projectId,
    rows,
    expectedProjectRevision,
    currentTime,
    ORDINARY_IMPORT_POLICY,
  );
}

export async function commitClosedCorrectionImport(
  env: Env,
  actor: Actor,
  projectId: string,
  rows: NormalizedImportRow[],
  expectedProjectRevision: number,
  currentTime = new Date(),
) {
  return commitImportWithPolicy(
    env,
    actor,
    projectId,
    rows,
    expectedProjectRevision,
    currentTime,
    CLOSED_CORRECTION_IMPORT_POLICY,
  );
}

async function commitImportWithPolicy(
  env: Env,
  actor: Actor,
  projectId: string,
  rows: NormalizedImportRow[],
  expectedProjectRevision: number,
  currentTime: Date,
  policy: ImportMutationPolicy,
) {
  const normalized = validateNormalizedRows(rows);
  await requireImportProject(env, projectId, currentTime, policy);
  const resolution = await resolveRows(env.DB, projectId, normalized, policy);
  if (resolution.some((row) => row.issues.length > 0)) {
    throw new DomainError("VALIDATION_FAILED", {
      rows: resolution.map((row) => ({
        rowNumber: row.input.rowNumber,
        issues: row.issues,
      })),
    });
  }
  const createdByOrganization = new Map<string, number>();
  for (const row of resolution) {
    if (!selectCandidate(row.input, row.candidates)) {
      const organizationId = row.organizationId as string;
      createdByOrganization.set(
        organizationId,
        (createdByOrganization.get(organizationId) ?? 0) + 1,
      );
    }
  }
  const resolved: ResolvedImportRow[] = resolution.map((row) => {
    const selected = selectCandidate(row.input, row.candidates);
    const organizationId = row.organizationId as string;
    const expectedParticipantName = selected?.name ?? row.input.name;
    const before = selected?.entry_id
      ? {
          name: selected.entry_participant_name as string,
          organizationId: selected.entry_organization_id as string,
          role: selected.entry_role,
          grade: selected.entry_grade,
          status: selected.entry_status as RosterStatus,
        }
      : null;
    const after: ImportRosterSnapshot = {
      name: expectedParticipantName,
      organizationId,
      role: row.input.role,
      grade: row.input.grade,
      status: "ACTIVE",
    };
    return {
      rowNumber: row.input.rowNumber,
      name: row.input.name,
      expectedParticipantName,
      organizationId,
      organizationName: row.organizationName as string,
      organizationCanonicalName: row.organizationCanonicalName as string,
      participantId: selected?.id ?? crypto.randomUUID(),
      participantRevision: selected?.revision ?? 0,
      entryId: row.existingEntryId ?? crypto.randomUUID(),
      createParticipant: !selected,
      organizationParticipantCountAfterInsert:
        row.organizationParticipantCount +
        (createdByOrganization.get(organizationId) ?? 0),
      organizationParticipantRevisionSum:
        row.organizationParticipantRevisionSum,
      mutateRoster: shouldMutateRoster(
        policy,
        selected,
        after,
        row.organizationName as string,
      ),
      before,
      after,
      role: row.input.role,
      grade: row.input.grade,
    };
  });
  const now = currentTime.toISOString();
  const batchId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  const newParticipants = resolved.filter((row) => row.createParticipant);
  for (const chunk of chunks(newParticipants, PARTICIPANT_CHUNK_SIZE)) {
    statements.push(participantInsert(env.DB, chunk, now));
  }
  for (const chunk of chunks(resolved, ROSTER_CHUNK_SIZE)) {
    statements.push(
      rosterUpsert(
        env.DB,
        chunk,
        projectId,
        actor.session.user.id,
        now,
        policy,
      ),
    );
  }
  const rosterMutations = resolved.filter((row) => row.mutateRoster);
  for (const chunk of chunks(rosterMutations, AUDIT_CHUNK_SIZE)) {
    statements.push(
      importAuditInsert(
        env.DB,
        chunk,
        projectId,
        actor.session.user.id,
        now,
        batchId,
        policy,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE projects SET revision = revision + 1, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).bind(now, projectId),
    importRunInsert(
      env.DB,
      batchId,
      projectId,
      actor.session.user.id,
      resolved.length,
      now,
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
        importProjectGuardPredicate(policy),
        importProjectGuardBindings(
          policy,
          projectId,
          expectedProjectRevision,
          currentTime,
        ),
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes(
        "NOT NULL constraint failed: project_roster_entries.organization_id",
      ) ||
        error.message.includes(
          "NOT NULL constraint failed: project_roster_entries.participant_id",
        ))
    ) {
      throw new DomainError("STALE_REVISION");
    }
    if (error instanceof DomainError && policy.mode === "ORDINARY") {
      await closeExpiredProject(env, projectId, currentTime);
      const latest = await findProject(env.DB, projectId);
      if (latest?.status === "CLOSED") {
        throw new DomainError("PROJECT_CLOSED");
      }
    }
    if (error instanceof DomainError && policy.mode === "CLOSED_CORRECTION") {
      const latest = await findProject(env.DB, projectId);
      if (!latest) throw new DomainError("NOT_FOUND");
      if (latest.status !== "CLOSED") {
        throw new DomainError("INVALID_TRANSITION");
      }
      if (latest.revision !== expectedProjectRevision) {
        throw new DomainError("STALE_REVISION");
      }
    }
    throw error;
  }
  return {
    importedCount: resolved.length,
    projectRevision: expectedProjectRevision + 1,
  };
}

export async function getExportData(env: Env, actor: Actor, projectId: string) {
  const [roster, summary] = await Promise.all([
    getRoster(env, actor, projectId),
    getSummary(env, actor, projectId),
  ]);
  return {
    명단: roster.map((row) => ({
      "고유 ID": row.participantNumber,
      이름: row.participantName,
      조직: row.organizationName,
      "참가자 구분": displayRole(row.role),
      학년: displayGrade(row.grade, row.role),
      "등록 시점": displaySource(row.source),
      상태: displayStatus(row.status),
      "최종 수정": row.updatedAt,
    })),
    집계: summary.organizations.map((row) => ({
      조직: row.organizationName,
      예상: row.expected,
      "진행 중 추가": row.inProgressAdded,
      "진행 중 취소": row.inProgressCancelled,
      최종: row.final,
      증감: row.delta,
      학생: row.studentCount,
      담당교사: row.teacherCount,
    })),
  };
}

function displayRole(role: ParticipantRole | null) {
  if (role === "STUDENT") return "학생";
  if (role === "TEACHER") return "담당교사";
  return "미지정";
}

function displayGrade(
  grade: StudentGrade | null,
  role: ParticipantRole | null,
) {
  if (role === "TEACHER") return "";
  if (grade === null) return "미지정";
  return {
    M1: "중1",
    M2: "중2",
    M3: "중3",
    H1: "고1",
    H2: "고2",
    H3: "고3",
  }[grade];
}

function displaySource(source: RosterSource) {
  if (source === "PRE_REGISTRATION") return "사전";
  return "진행 중";
}

function displayStatus(status: RosterStatus) {
  if (status === "ACTIVE") return "참석";
  return "취소";
}

async function resolveRows(
  db: D1Database,
  projectId: string,
  rows: NormalizedImportRow[],
  policy: ImportMutationPolicy,
) {
  const organizations = (
    await db
      .prepare(
        `SELECT o.id, o.name, o.canonical_name,
                (po.is_active = 1
                 ${
                   policy.allowHistoricalOrganizationMasters
                     ? ""
                     : "AND o.is_active = 1 AND o.deleted_at IS NULL"
}) AS is_active
         FROM project_organizations po
         JOIN organizations o ON o.id = po.organization_id
         WHERE po.project_id = ?`,
      )
      .bind(projectId)
      .all<{
        id: string;
        name: string;
        canonical_name: string;
        is_active: number;
      }>()
  ).results;
  const participantRows = (
    await db
      .prepare(
        `SELECT p.id, p.participant_id, p.name, p.organization_id, p.revision,
              r.id AS entry_id, r.participant_name_snapshot AS entry_participant_name,
              r.organization_id AS entry_organization_id,
              r.organization_name_snapshot AS entry_organization_name,
              r.participant_role_snapshot AS entry_role,
              r.student_grade_snapshot AS entry_grade,
              r.source AS entry_source, r.status AS entry_status,
              r.was_expected_at_start AS entry_was_expected
       FROM participants p
       LEFT JOIN project_roster_entries r
         ON r.participant_id = p.id AND r.project_id = ?`,
      )
      .bind(projectId)
      .all<{
        id: string;
        participant_id: string;
        name: string;
        organization_id: string;
        revision: number;
        entry_id: string | null;
        entry_participant_name: string | null;
        entry_organization_id: string | null;
        entry_organization_name: string | null;
        entry_role: ParticipantRole | null;
        entry_grade: StudentGrade | null;
        entry_source: RosterSource | null;
        entry_status: RosterStatus | null;
        entry_was_expected: number | null;
      }>()
  ).results;
  return rows.map((input) => {
    const organization = organizations.find(
      (item) => item.canonical_name === canonical(input.organizationName),
    );
    const candidates = organization
      ? participantRows.filter(
          (item) =>
            item.organization_id === organization.id &&
            canonical(item.name) === canonical(input.name),
        )
      : [];
    const issues: string[] = [];
    if (organization?.is_active !== 1) issues.push("UNKNOWN_ORGANIZATION");
    if (candidates.length > 1 && !selectCandidate(input, candidates)) {
      issues.push("AMBIGUOUS_PARTICIPANT");
    }
    if (input.resolvedParticipantId && !selectCandidate(input, candidates)) {
      issues.push("INVALID_CANDIDATE");
    }
    const selected = selectCandidate(input, candidates);
    return {
      input,
      organizationId: organization?.id,
      organizationName: organization?.name,
      organizationCanonicalName: organization?.canonical_name,
      organizationParticipantCount: organization
        ? participantRows.filter(
            (participant) => participant.organization_id === organization.id,
          ).length
        : 0,
      organizationParticipantRevisionSum: organization
        ? participantRows
            .filter(
              (participant) => participant.organization_id === organization.id,
            )
            .reduce((sum, participant) => sum + participant.revision, 0)
        : 0,
      candidates,
      issues,
      existingEntryId: selected?.entry_id ?? undefined,
    };
  });
}

function selectCandidate<T extends { id: string }>(
  input: NormalizedImportRow,
  candidates: T[],
): T | undefined {
  if (input.resolvedParticipantId) {
    return candidates.find(
      (candidate) => candidate.id === input.resolvedParticipantId,
    );
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function shouldMutateRoster(
  policy: ImportMutationPolicy,
  selected:
    | {
        entry_id: string | null;
        entry_participant_name: string | null;
        entry_organization_id: string | null;
        entry_organization_name: string | null;
        entry_role: ParticipantRole | null;
        entry_grade: StudentGrade | null;
        entry_source: RosterSource | null;
        entry_status: RosterStatus | null;
        entry_was_expected: number | null;
      }
    | undefined,
  after: ImportRosterSnapshot,
  organizationName: string,
) {
  if (policy.mode === "ORDINARY") {
    return selected?.entry_status !== "ACTIVE";
  }
  if (!selected?.entry_id) return true;
  return (
    selected.entry_participant_name !== after.name ||
    selected.entry_organization_id !== after.organizationId ||
    selected.entry_organization_name !== organizationName ||
    selected.entry_role !== after.role ||
    selected.entry_grade !== after.grade ||
    selected.entry_source !== policy.source ||
    selected.entry_status !== "ACTIVE" ||
    selected.entry_was_expected !== 0
  );
}

function participantInsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  now: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, 0, ?, ?)").join(",");
  const bindings = rows.flatMap((row) => [
    row.participantId,
    `P-${crypto.randomUUID().toUpperCase()}`,
    row.name,
    row.organizationId,
    now,
    now,
  ]);
  return db
    .prepare(
      `INSERT INTO participants
     (id, participant_id, name, organization_id, revision, created_at, updated_at)
     VALUES ${values}`,
    )
    .bind(...bindings);
}

function rosterUpsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  projectId: string,
  actorId: string,
  now: string,
  policy: ImportMutationPolicy,
) {
  const values = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
  return db
    .prepare(
      `WITH incoming(
         entry_id, participant_id, expected_name, expected_organization_id,
         expected_revision, expected_organization_canonical,
         expected_organization_participant_count,
         expected_organization_revision_sum, participant_role, student_grade
       ) AS (VALUES ${values})
       INSERT INTO project_roster_entries
         (id, project_id, participant_id, organization_id, participant_name_snapshot,
          organization_name_snapshot, participant_role_snapshot,
          student_grade_snapshot, source, status, was_expected_at_start, revision,
          created_by, updated_by, created_at, updated_at)
       SELECT i.entry_id, ?, p.id,
              CASE WHEN p.name = i.expected_name
                         AND p.organization_id = i.expected_organization_id
                         AND p.revision = i.expected_revision
                         ${
                           policy.allowHistoricalOrganizationMasters
                             ? ""
                             : "AND o.is_active = 1 AND o.deleted_at IS NULL"
}
                         AND EXISTS (
                           SELECT 1 FROM project_organizations po
                           WHERE po.project_id = ? AND po.organization_id = o.id
                             AND po.is_active = 1
                         )
                         AND o.canonical_name = i.expected_organization_canonical
                         AND (SELECT COUNT(*) FROM participants candidate
                              WHERE candidate.organization_id = i.expected_organization_id)
                             = i.expected_organization_participant_count
                         AND (SELECT COALESCE(SUM(candidate.revision), 0)
                              FROM participants candidate
                              WHERE candidate.organization_id = i.expected_organization_id)
                             = i.expected_organization_revision_sum
                   THEN p.organization_id ELSE NULL END,
              p.name, o.name, i.participant_role, i.student_grade,
              '${policy.source}', 'ACTIVE', 0, 0, ?, ?, ?, ?
       FROM incoming i LEFT JOIN participants p ON p.id = i.participant_id
       LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE 1 = 1
       ${rosterConflictClause(policy)}`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.entryId,
        row.participantId,
        row.expectedParticipantName,
        row.organizationId,
        row.participantRevision,
        row.organizationCanonicalName,
        row.organizationParticipantCountAfterInsert,
        row.organizationParticipantRevisionSum,
        row.role,
        row.grade,
      ]),
      projectId,
      projectId,
      actorId,
      actorId,
      now,
      now,
    );
}

function rosterConflictClause(policy: ImportMutationPolicy) {
  if (policy.mode === "ORDINARY") {
    return `ON CONFLICT(project_id, participant_id) DO UPDATE SET
      status = CASE WHEN project_roster_entries.status = 'CANCELLED'
                    THEN 'ACTIVE' ELSE project_roster_entries.status END,
      participant_role_snapshot =
        CASE WHEN project_roster_entries.status = 'CANCELLED'
             THEN excluded.participant_role_snapshot
             ELSE project_roster_entries.participant_role_snapshot END,
      student_grade_snapshot =
        CASE WHEN project_roster_entries.status = 'CANCELLED'
             THEN excluded.student_grade_snapshot
             ELSE project_roster_entries.student_grade_snapshot END,
      updated_by = CASE WHEN project_roster_entries.status = 'CANCELLED'
                        THEN excluded.updated_by ELSE project_roster_entries.updated_by END,
      updated_at = CASE WHEN project_roster_entries.status = 'CANCELLED'
                        THEN excluded.updated_at ELSE project_roster_entries.updated_at END,
      revision = project_roster_entries.revision +
                 CASE WHEN project_roster_entries.status = 'CANCELLED' THEN 1 ELSE 0 END`;
  }
  return `ON CONFLICT(project_id, participant_id) DO UPDATE SET
    organization_id = excluded.organization_id,
    participant_name_snapshot = excluded.participant_name_snapshot,
    organization_name_snapshot = excluded.organization_name_snapshot,
    participant_role_snapshot = excluded.participant_role_snapshot,
    student_grade_snapshot = excluded.student_grade_snapshot,
    source = excluded.source,
    status = 'ACTIVE',
    was_expected_at_start = 0,
    revision = project_roster_entries.revision + 1,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  WHERE project_roster_entries.participant_name_snapshot
          IS NOT excluded.participant_name_snapshot
     OR project_roster_entries.organization_id IS NOT excluded.organization_id
     OR project_roster_entries.organization_name_snapshot
          IS NOT excluded.organization_name_snapshot
     OR project_roster_entries.participant_role_snapshot
          IS NOT excluded.participant_role_snapshot
     OR project_roster_entries.student_grade_snapshot
          IS NOT excluded.student_grade_snapshot
     OR project_roster_entries.source IS NOT excluded.source
     OR project_roster_entries.status IS NOT 'ACTIVE'
     OR project_roster_entries.was_expected_at_start IS NOT 0`;
}

function importAuditInsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  projectId: string,
  actorId: string,
  now: string,
  batchId: string,
  policy: ImportMutationPolicy,
) {
  const values = rows.map(() => "(?, ?)").join(",");
  return db
    .prepare(
      `WITH incoming(entry_id, details_json) AS (VALUES ${values})
     INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
     SELECT lower(hex(randomblob(16))), ?, '${policy.auditAction}', 'ROSTER_ENTRY',
            entry_id, ?, details_json
     FROM incoming`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.entryId,
        JSON.stringify(
          policy.mode === "CLOSED_CORRECTION"
            ? {
                batchId,
                projectId,
                organizationId: row.organizationId,
                role: row.role,
                grade: row.grade,
                before: row.before,
                after: row.after,
              }
            : {
                projectId,
                organizationId: row.organizationId,
                role: row.role,
                grade: row.grade,
              },
        ),
      ]),
      actorId,
      now,
    );
}

function importRunInsert(
  db: D1Database,
  batchId: string,
  projectId: string,
  actorUserId: string,
  rowCount: number,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO project_import_runs
       (id, project_id, actor_user_id, row_count, created_at, details_json)
       VALUES (?, ?, ?, ?, ?, '{}')`,
    )
    .bind(batchId, projectId, actorUserId, rowCount, now);
}

function importProjectGuardPredicate(policy: ImportMutationPolicy) {
  if (policy.mode === "CLOSED_CORRECTION") {
    return `EXISTS (
      SELECT 1 FROM projects
      WHERE id = ? AND status = 'CLOSED' AND revision = ?
        AND deleted_at IS NULL
    )`;
  }
  return `EXISTS (
    SELECT 1 FROM projects
    WHERE id = ? AND status = 'PRE_REGISTRATION' AND revision = ?
      AND deleted_at IS NULL
      AND (end_date IS NULL OR end_date >= ?)
  )`;
}

function importProjectGuardBindings(
  policy: ImportMutationPolicy,
  projectId: string,
  expectedProjectRevision: number,
  currentTime: Date,
): Array<string | number> {
  if (policy.mode === "CLOSED_CORRECTION") {
    return [projectId, expectedProjectRevision];
  }
  return [projectId, expectedProjectRevision, toKstDate(currentTime)];
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function canonical(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

async function requireImportProject(
  env: Env,
  projectId: string,
  now: Date,
  policy: ImportMutationPolicy,
) {
  if (policy.mode === "ORDINARY") {
    await closeExpiredProject(env, projectId, now);
  }
  const project = await findProject(env.DB, projectId);
  if (!project) throw new DomainError("NOT_FOUND");
  if (policy.mode === "CLOSED_CORRECTION") {
    if (project.status !== "CLOSED") {
      throw new DomainError("INVALID_TRANSITION");
    }
    return project;
  }
  if (project.status === "CLOSED") throw new DomainError("PROJECT_CLOSED");
  if (project.status !== "PRE_REGISTRATION") {
    throw new DomainError("CONFLICT");
  }
  return project;
}
