import {
  type ClosedProjectCorrectionCandidateOrganization,
  type ClosedProjectCorrectionCandidateParticipant,
  ParticipantRoleSchema,
  StudentGradeSchema,
} from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { findProject } from "../db/projects";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard, requireAdministrativeOperator } from "./admin";

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
