import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedManager, seedOrganization } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("summarizes active participant roles within each actor scope", async () => {
  const fixture = await setupPreRegistration();
  const student = await addRoster(fixture, fixture.firstParticipant.id);
  const studentEntry = await student.json<{ projectRevision: number }>();
  await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: studentEntry.projectRevision },
    },
    fixture.secondParticipant.id,
    undefined,
    { role: "TEACHER", grade: null },
  );
  const now = "2026-07-21T00:00:00.000Z";
  await seedOrganization("org-2", "2팀");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('org-2-teacher', 'P-ORG2', '다른 조직 교사', 'org-2', 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-2', 1, ?, 'user-1', 'user-1')`,
    ).bind(fixture.project.id, now),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, participant_role_snapshot, student_grade_snapshot,
        source, status, was_expected_at_start, revision,
        created_by, updated_by, created_at, updated_at)
       VALUES ('org-2-teacher-entry', ?, 'org-2-teacher', 'org-2', '다른 조직 교사', '2팀',
               'TEACHER', NULL, 'PRE_REGISTRATION', 'ACTIVE', 0, 0,
               'user-1', 'user-1', ?, ?)`,
    ).bind(fixture.project.id, now, now),
  ]);

  const manager = await seedManager("org-1");
  const [operatorResponse, managerResponse] = await Promise.all([
    authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/summary`,
    ),
    authedRequest(manager, `/api/v1/projects/${fixture.project.id}/summary`),
  ]);

  expect(await operatorResponse.json()).toMatchObject({
    studentTotal: 1,
    teacherTotal: 2,
    organizations: [
      { organizationId: "org-1", studentCount: 1, teacherCount: 1 },
      { organizationId: "org-2", studentCount: 0, teacherCount: 1 },
    ],
  });
  expect(await managerResponse.json()).toMatchObject({
    studentTotal: 1,
    teacherTotal: 1,
    organizations: [
      { organizationId: "org-1", studentCount: 1, teacherCount: 1 },
    ],
  });
});

it("uses the current active pre-registration roster as expected before IN_PROGRESS", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
  });
});

it("counts pre-registration cancellation and in-progress addition independently", async () => {
  const fixture = await setupPreRegistration();
  const preResponse = await addRoster(fixture, fixture.firstParticipant.id);
  const preEntry = await preResponse.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const inProgressResponse = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: preEntry.projectRevision,
      }),
    },
  );
  const inProgress = await inProgressResponse.json<{ revision: number }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${preEntry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: inProgress.revision,
        expectedEntryRevision: preEntry.revision,
      }),
    },
  );
  const afterCancel = await cancelled.json<{ projectRevision: number }>();
  await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: afterCancel.projectRevision,
      },
    },
    fixture.secondParticipant.id,
  );

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
    organizations: [
      {
        expected: 1,
        inProgressAdded: 1,
        inProgressCancelled: 1,
        final: 1,
        delta: 0,
      },
    ],
  });
});

it("counts a pre-registration row reactivated after IN_PROGRESS as an in-progress addition", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${entry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: entry.projectRevision,
        expectedEntryRevision: entry.revision,
      }),
    },
  );
  const cancelledEntry = await cancelled.json<{
    revision: number;
    projectRevision: number;
  }>();
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: cancelledEntry.projectRevision,
      }),
    },
  );
  const inProgress = await transitioned.json<{ revision: number }>();
  const reactivated = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: inProgress.revision },
    },
    fixture.firstParticipant.id,
  );
  expect(await reactivated.json<{ source: string }>()).toMatchObject({
    source: "IN_PROGRESS",
  });

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 0,
    finalTotal: 1,
    deltaTotal: 1,
    organizations: [{ inProgressAdded: 1, inProgressCancelled: 0 }],
  });
});

it("hides empty deleted rows and preserves deleted rows with historical counts", async () => {
  const fixture = await setupPreRegistration();
  const now = "2026-07-21T00:00:00.000Z";
  await seedOrganization("org-empty-inactive", "빈 비활성");
  await seedOrganization("org-history-inactive", "이력 비활성");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-empty-inactive', 0, ?, ?, ?)`,
    ).bind(
      fixture.project.id,
      now,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-history-inactive', 0, ?, ?, ?)`,
    ).bind(
      fixture.project.id,
      now,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'org-history-inactive', 3, ?)`,
    ).bind(fixture.project.id, now),
  ]);
  await env.DB.prepare(
    `UPDATE projects SET status = 'IN_PROGRESS' WHERE id = ?`,
  )
    .bind(fixture.project.id)
    .run();
  await env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?
     WHERE id IN ('org-empty-inactive', 'org-history-inactive')`,
  )
    .bind(now, fixture.operator.userId)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  const body = await response.json<{
    expectedTotal: number;
    organizations: Array<{
      organizationId: string;
      isActive: boolean;
      masterIsActive: boolean;
      masterIsDeleted: boolean;
      expected: number;
    }>;
  }>();
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE id IN ('org-empty-inactive', 'org-history-inactive')`,
  ).run();

  expect(body.organizations.map((row) => row.organizationId)).toEqual([
    "org-1",
    "org-history-inactive",
  ]);
  expect(body.organizations[1]).toMatchObject({
    organizationId: "org-history-inactive",
    isActive: false,
    masterIsActive: false,
    masterIsDeleted: true,
    expected: 3,
  });
  expect(body.expectedTotal).toBe(3);
});

it("hides inactive zero rows and preserves inactive rows with historical counts", async () => {
  const fixture = await setupPreRegistration();
  const now = "2026-07-21T00:00:00.000Z";
  await seedOrganization("org-empty-inactive", "빈 비활성");
  await seedOrganization("org-history-inactive", "이력 비활성");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-empty-inactive', 0, ?, ?, ?)`,
    ).bind(
      fixture.project.id,
      now,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-history-inactive', 0, ?, ?, ?)`,
    ).bind(
      fixture.project.id,
      now,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'org-history-inactive', 3, ?)`,
    ).bind(fixture.project.id, now),
  ]);
  await env.DB.prepare(
    `UPDATE projects SET status = 'IN_PROGRESS' WHERE id = ?`,
  )
    .bind(fixture.project.id)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  const body = await response.json<{
    expectedTotal: number;
    organizations: Array<{
      organizationId: string;
      isActive: boolean;
      masterIsActive: boolean;
      masterIsDeleted: boolean;
      expected: number;
    }>;
  }>();

  expect(body.organizations.map((row) => row.organizationId)).toEqual([
    "org-1",
    "org-history-inactive",
  ]);
  expect(body.organizations[1]).toMatchObject({
    organizationId: "org-history-inactive",
    isActive: false,
    masterIsActive: true,
    masterIsDeleted: false,
    expected: 3,
  });
  expect(body.expectedTotal).toBe(3);
});
