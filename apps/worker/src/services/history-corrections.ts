import {
  type AddProjectOrganization,
  type ClosedProjectCorrectionCandidateOrganization,
  type ClosedProjectCorrectionCandidateParticipant,
  ParticipantRoleSchema,
  type ProjectOrganizationMutationResult,
  type ProjectOrganizationPatch,
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
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard, requireAdministrativeOperator } from "./admin";
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
