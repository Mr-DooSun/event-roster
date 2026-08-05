import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import { apiRequest, login, resetAuthState, seedUser } from "./support/auth";

beforeEach(resetAuthState);

it("returns every master candidate only to an administrative operator for a closed project", async () => {
  const fixture = await seedCorrectionCandidates();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    organizations: [
      {
        id: "org-active",
        name: "가동 조직",
        isActive: true,
        isDeleted: false,
      },
      {
        id: "org-inactive",
        name: "나중 비활성 조직",
        isActive: false,
        isDeleted: false,
      },
      {
        id: "org-deleted",
        name: "다음 삭제 조직",
        isActive: false,
        isDeleted: true,
      },
    ],
    participants: [
      {
        id: "active-participant",
        participantId: "P-ACTIVE",
        name: "가동 참가자",
        organizationId: "org-active",
        revision: 2,
        suggestedRole: "TEACHER",
        suggestedGrade: null,
      },
      {
        id: "inactive-participant",
        participantId: "P-INACTIVE",
        name: "나중 참가자",
        organizationId: "org-inactive",
        revision: 0,
        suggestedRole: null,
        suggestedGrade: null,
      },
      {
        id: "deleted-participant",
        participantId: "P-DELETED",
        name: "다음 참가자",
        organizationId: "org-deleted",
        revision: 1,
        suggestedRole: null,
        suggestedGrade: null,
      },
    ],
  });

  const managerProjectsBefore = await managerProjectIds(fixture.manager);
  const managerParticipantsBefore = await managerParticipantIds(
    fixture.manager,
  );

  expect(
    (
      await authedRequest(
        fixture.manager,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await authedRequest(
        fixture.bootstrap,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await apiRequest(
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(401);

  const open = await authedRequest(
    fixture.operator,
    "/api/v1/projects/project-open/history-corrections/candidates",
  );
  expect(open.status).toBe(409);
  expect(await open.json()).toMatchObject({ code: "INVALID_TRANSITION" });

  const deleted = await authedRequest(
    fixture.operator,
    "/api/v1/projects/project-deleted/history-corrections/candidates",
  );
  expect(deleted.status).toBe(404);

  expect(await managerProjectIds(fixture.manager)).toEqual(
    managerProjectsBefore,
  );
  expect(await managerParticipantIds(fixture.manager)).toEqual(
    managerParticipantsBefore,
  );
});

async function seedCorrectionCandidates() {
  const operator = await seedOperator();
  await seedOrganization("org-active", "가동 조직");
  await seedOrganization("org-inactive", "나중 비활성 조직", false);
  await seedOrganization("org-deleted", "다음 삭제 조직");
  const manager = await seedManager("org-active");
  await seedUser({
    id: "bootstrap-user",
    loginId: "bootstrap-01",
    password: "bootstrap-password-123",
    isBootstrap: true,
  });
  const bootstrap = {
    ...(await login("bootstrap-01", "bootstrap-password-123")),
    userId: "bootstrap-user",
  };
  const now = "2026-08-05T00:00:00.000Z";
  const later = "2026-08-06T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE organizations
       SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
       WHERE id = 'org-deleted'`,
    ).bind(now, operator.userId, now),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason)
       VALUES ('project-closed', '종료 보정 대상', 'CLOSED', 3, ?, ?, ?, ?, ?, 'MANUAL')`,
    ).bind(operator.userId, now, now, now, operator.userId),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at)
       VALUES ('project-open', '진행 중 대상', 'IN_PROGRESS', 0, ?, ?, ?)`,
    ).bind(operator.userId, now, now),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason, deleted_at, deleted_by, deleted_revision)
       VALUES ('project-deleted', '삭제된 종료 대상', 'CLOSED', 1, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 1)`,
    ).bind(
      operator.userId,
      now,
      now,
      now,
      operator.userId,
      now,
      operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES ('project-closed', 'org-active', 1, ?, ?, ?)`,
    ).bind(now, operator.userId, operator.userId),
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES
       ('active-participant', 'P-ACTIVE', '가동 참가자', 'org-active', 2, ?, ?),
       ('inactive-participant', 'P-INACTIVE', '나중 참가자', 'org-inactive', 0, ?, ?),
       ('deleted-participant', 'P-DELETED', '다음 참가자', 'org-deleted', 1, ?, ?)`,
    ).bind(now, now, now, now, now, now),
    rosterStatement(
      "roster-active-old",
      "project-closed",
      "active-participant",
      "org-active",
      "STUDENT",
      "M1",
      now,
      operator.userId,
    ),
    rosterStatement(
      "roster-active-latest",
      "project-open",
      "active-participant",
      "org-active",
      "TEACHER",
      null,
      later,
      operator.userId,
    ),
  ]);

  return { operator, manager, bootstrap, closedProjectId: "project-closed" };
}

function rosterStatement(
  id: string,
  projectId: string,
  participantId: string,
  organizationId: string,
  role: "STUDENT" | "TEACHER",
  grade: "M1" | null,
  timestamp: string,
  actorId: string,
) {
  return env.DB.prepare(
    `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, participant_role_snapshot, student_grade_snapshot,
        source, status, was_expected_at_start, revision, created_by, updated_by,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, '스냅샷 참가자', '스냅샷 조직', ?, ?, 'IN_PROGRESS',
               'ACTIVE', 0, 0, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    participantId,
    organizationId,
    role,
    grade,
    actorId,
    actorId,
    timestamp,
    timestamp,
  );
}

async function managerProjectIds(
  manager: Awaited<ReturnType<typeof seedManager>>,
) {
  return (
    await (
      await authedRequest(manager, "/api/v1/projects")
    ).json<Array<{ id: string }>>()
  )
    .map(({ id }) => id)
    .sort();
}

async function managerParticipantIds(
  manager: Awaited<ReturnType<typeof seedManager>>,
) {
  return (
    await (
      await authedRequest(manager, "/api/v1/participants")
    ).json<Array<{ id: string }>>()
  )
    .map(({ id }) => id)
    .sort();
}
