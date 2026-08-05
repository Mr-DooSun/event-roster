import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import { apiRequest, login, resetAuthState, seedUser } from "./support/auth";

beforeEach(resetAuthState);
afterEach(async () => {
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL`,
  ).run();
});

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

it("links active, inactive, deleted, and newly created organizations to a closed project without mutating existing masters", async () => {
  const fixture = await seedCorrectionCandidates();
  await seedOrganization("org-later-active", "나중 가동 조직");
  const masterStates = await organizationStates([
    "org-later-active",
    "org-inactive",
    "org-deleted",
  ]);
  const projectBefore = await closedProjectState(fixture.closedProjectId);

  let revision = projectBefore.revision;
  for (const organizationId of [
    "org-later-active",
    "org-inactive",
    "org-deleted",
  ]) {
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          expectedProjectRevision: revision,
        }),
      },
    );
    expect(response.status).toBe(201);
    revision = (await response.json<{ projectRevision: number }>())
      .projectRevision;
  }

  const create = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        newOrganizationName: "종료 후 신규 조직",
        expectedProjectRevision: revision,
      }),
    },
  );
  expect(create.status).toBe(201);
  const created = await create.json<{
    organization: { organizationId: string; isActive: boolean };
    projectRevision: number;
  }>();
  expect(created.organization).toMatchObject({ isActive: true });
  expect(created.projectRevision).toBe(revision + 1);

  expect(
    await organizationStates([
      "org-later-active",
      "org-inactive",
      "org-deleted",
    ]),
  ).toEqual(masterStates);
  expect(await closedProjectState(fixture.closedProjectId)).toEqual({
    ...projectBefore,
    revision: projectBefore.revision + 4,
  });
  expect(
    await env.DB.prepare(
      `SELECT is_active, deleted_at FROM organizations WHERE id = ?`,
    )
      .bind(created.organization.organizationId)
      .first(),
  ).toEqual({ is_active: 1, deleted_at: null });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual([
    expect.objectContaining({
      organizationId: "org-later-active",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: "org-inactive",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: "org-deleted",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: created.organization.organizationId,
      operation: "CREATED_AND_ADDED",
      before: null,
      after: { isActive: true },
    }),
  ]);
});

it("soft-excludes an empty closed-project membership and reactivates its composite-key row", async () => {
  const fixture = await seedCorrectionCandidates();
  await seedOrganization("org-empty", "빈 조직");

  const added = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-empty",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(added.status).toBe(201);
  const addedBody = await added.json<{ projectRevision: number }>();
  const excluded = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations/org-empty`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: addedBody.projectRevision,
      }),
    },
  );
  expect(excluded.status).toBe(200);
  const excludedBody = await excluded.json<{ projectRevision: number }>();
  expect(
    await env.DB.prepare(
      `SELECT is_active, deactivated_at FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first(),
  ).toMatchObject({ is_active: 0 });

  const reactivated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations/org-empty`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: true,
        expectedProjectRevision: excludedBody.projectRevision,
      }),
    },
  );
  expect(reactivated.status).toBe(200);
  expect(await reactivated.json()).toMatchObject({
    organization: { organizationId: "org-empty", isActive: true },
    projectRevision: excludedBody.projectRevision + 1,
  });
  expect(
    await env.DB.prepare(
      `SELECT is_active, deactivated_at FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first(),
  ).toEqual({ is_active: 1, deactivated_at: null });
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first<{ count: number }>(),
  ).toEqual({ count: 1 });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        organizationId: "org-empty",
        operation: "EXCLUDED",
        before: { isActive: true },
        after: { isActive: false },
      }),
      expect.objectContaining({
        organizationId: "org-empty",
        operation: "REACTIVATED",
        before: { isActive: false },
        after: { isActive: true },
      }),
    ]),
  );
});

it("does not grant inactive or deleted organization managers visibility or correction access, and serializes same-revision corrections", async () => {
  const fixture = await seedCorrectionCandidates();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM user_organizations
       WHERE user_id = ? AND organization_id = 'org-active'`,
    ).bind(fixture.manager.userId),
    env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES (?, 'org-inactive', 'MANAGER', ?, ?)`,
    ).bind(
      fixture.manager.userId,
      fixture.operator.userId,
      "2026-08-05T00:00:00.000Z",
    ),
  ]);
  const inactiveLink = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-inactive",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(inactiveLink.status).toBe(201);
  expect(await managerProjectIds(fixture.manager)).not.toContain(
    fixture.closedProjectId,
  );
  expect(
    (
      await authedRequest(
        fixture.manager,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: "org-deleted",
            expectedProjectRevision: 4,
          }),
        },
      )
    ).status,
  ).toBe(403);

  await seedOrganization("org-race", "경합 조직");
  const request = () =>
    authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-race",
          expectedProjectRevision: 4,
        }),
      },
    );
  const responses = await Promise.all([request(), request()]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const conflict = responses.find((response) => response.status === 409);
  expect(await conflict?.json()).toMatchObject({ code: "STALE_REVISION" });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        organizationId: "org-race",
        operation: "ADDED",
      }),
    ]),
  );
});

async function organizationStates(organizationIds: string[]) {
  const rows = (
    await env.DB.prepare(
      `SELECT id, name, is_active, deleted_at, updated_at
       FROM organizations
       WHERE id IN (${organizationIds.map(() => "?").join(", ")})
       ORDER BY id`,
    )
      .bind(...organizationIds)
      .all()
  ).results;
  return rows;
}

async function closedProjectState(projectId: string) {
  const project = await env.DB.prepare(
    `SELECT status, closed_at, closed_by, close_reason, revision
     FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{
      status: string;
      closed_at: string | null;
      closed_by: string | null;
      close_reason: string | null;
      revision: number;
    }>();
  if (!project) throw new Error("closed project fixture is missing");
  return project;
}

async function correctionAudits(projectId: string) {
  const rows = (
    await env.DB.prepare(
      `SELECT details_json FROM audit_logs
       WHERE action = 'CLOSED_PROJECT_ORGANIZATION_CORRECTED'
         AND entity_type = 'PROJECT_ORGANIZATION'
         AND details_json LIKE ?
       ORDER BY rowid`,
    )
      .bind(`%"projectId":"${projectId}"%`)
      .all<{ details_json: string }>()
  ).results;
  return rows.map((row) => JSON.parse(row.details_json));
}

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
