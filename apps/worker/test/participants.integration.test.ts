import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("keeps global participants read-only", async () => {
  const fixture = await setupPreRegistration();
  const list = await authedRequest(fixture.operator, "/api/v1/participants");
  expect(list.status).toBe(200);
  expect(await list.json<Array<{ id: string }>>()).toHaveLength(2);

  const create = await authedRequest(fixture.operator, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "전역 생성 금지", organizationId: "org-1" }),
  });
  const update = await authedRequest(
    fixture.operator,
    `/api/v1/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "전역 수정 금지", expectedRevision: 0 }),
    },
  );
  expect(create.status).toBe(404);
  expect(update.status).toBe(404);
});

it("updates the participant master organization without rewriting past snapshots", async () => {
  const fixture = await setupPreRegistration();
  const secondOrganization = await seedOrganization("org-2", "2팀");
  const otherProject = await seedProject(fixture.operator, {
    name: "다른 프로젝트",
  });
  let fixtureProjectRevision = fixture.project.revision;
  for (const [projectId, organizationId, expectedProjectRevision] of [
    [fixture.project.id, secondOrganization.id, fixture.project.revision],
    [otherProject.id, "org-1", otherProject.revision],
  ]) {
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${projectId}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId, expectedProjectRevision }),
      },
    );
    expect(linked.status).toBe(201);
    const linkedBody = await linked.json<{ projectRevision: number }>();
    if (projectId === fixture.project.id) {
      fixtureProjectRevision = linkedBody.projectRevision;
    }
  }
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch(
    [fixture.project.id, otherProject.id].map((projectId, index) =>
      env.DB.prepare(
        `INSERT INTO project_roster_entries
         (id, project_id, participant_id, organization_id,
          participant_name_snapshot, organization_name_snapshot, source, status,
          was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'org-1', '첫 참가자', '1팀', 'PRE_REGISTRATION',
                 'ACTIVE', 0, 0, 'user-1', 'user-1', ?, ?)`,
      ).bind(
        `entry-${index}`,
        projectId,
        fixture.firstParticipant.id,
        now,
        now,
      ),
    ),
  );

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "첫 참가자",
        organizationId: secondOrganization.id,
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: fixtureProjectRevision,
      }),
    },
  );
  expect(response.status).toBe(200);
  const master = await env.DB.prepare(
    "SELECT organization_id FROM participants WHERE id=?",
  )
    .bind(fixture.firstParticipant.id)
    .first<{ organization_id: string }>();
  const snapshots = (
    await env.DB.prepare(
      `SELECT project_id, organization_id, organization_name_snapshot
       FROM project_roster_entries WHERE participant_id=? ORDER BY project_id`,
    )
      .bind(fixture.firstParticipant.id)
      .all<{
        project_id: string;
        organization_id: string;
        organization_name_snapshot: string;
      }>()
  ).results;
  expect(master?.organization_id).toBe(secondOrganization.id);
  expect(snapshots).toEqual(
    [
      {
        project_id: otherProject.id,
        organization_id: "org-1",
        organization_name_snapshot: "1팀",
      },
      {
        project_id: fixture.project.id,
        organization_id: "org-1",
        organization_name_snapshot: "1팀",
      },
    ].sort((left, right) => left.project_id.localeCompare(right.project_id)),
  );
});

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "prevents a %s from editing a moved participant master outside its scope",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    await seedOrganization("org-2", "2팀");
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedProjectRevision: fixture.project.revision,
        }),
      },
    );
    const linkedBody = await linked.json<{ projectRevision: number }>();
    const added = await addRoster(
      fixture,
      fixture.firstParticipant.id,
      linkedBody.projectRevision,
    );
    const entry = await added.json<{ projectRevision: number }>();
    const moved = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedRevision: fixture.firstParticipant.revision,
          expectedProjectRevision: entry.projectRevision,
        }),
      },
    );
    const movedParticipant = await moved.json<{
      revision: number;
      projectRevision: number;
    }>();
    const manager = await seedManager("org-1");
    await env.DB.prepare(
      `UPDATE user_organizations
       SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-1'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();
    const response = await authedRequest(
      manager,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "권한 밖 변경",
          expectedRevision: movedParticipant.revision,
          expectedProjectRevision: movedParticipant.projectRevision,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(
      (
        await env.DB.prepare("SELECT name FROM participants WHERE id=?")
          .bind(fixture.firstParticipant.id)
          .first<{ name: string }>()
      )?.name,
    ).toBe("첫 참가자");
  },
);

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "allows a %s scoped to both snapshot and master organizations to edit a moved participant",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    await seedOrganization("org-2", "2팀");
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedProjectRevision: fixture.project.revision,
        }),
      },
    );
    const linkedBody = await linked.json<{ projectRevision: number }>();
    const added = await addRoster(
      fixture,
      fixture.firstParticipant.id,
      linkedBody.projectRevision,
    );
    const entry = await added.json<{ projectRevision: number }>();
    const moved = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedRevision: fixture.firstParticipant.revision,
          expectedProjectRevision: entry.projectRevision,
        }),
      },
    );
    const movedParticipant = await moved.json<{
      revision: number;
      projectRevision: number;
    }>();
    const manager = await seedManager("org-1");
    await env.DB.prepare(
      `UPDATE user_organizations SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-1'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES ('manager-user', 'org-2', ?, NULL, '2026-07-23T00:00:00.000Z')`,
    )
      .bind(assignmentRole)
      .run();

    const response = await authedRequest(
      manager,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "양쪽 범위 변경",
          expectedRevision: movedParticipant.revision,
          expectedProjectRevision: movedParticipant.projectRevision,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      (
        await env.DB.prepare("SELECT name FROM participants WHERE id=?")
          .bind(fixture.firstParticipant.id)
          .first<{ name: string }>()
      )?.name,
    ).toBe("양쪽 범위 변경");
  },
);

it("makes participant history read-only for a manager after membership deactivation while the operator can edit", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  const deactivated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/organizations/org-1`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: entry.projectRevision,
      }),
    },
  );
  const deactivatedBody = await deactivated.json<{ projectRevision: number }>();
  const manager = await seedManager("org-1");
  const managerPatch = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "관리자 변경 금지",
        expectedRevision: 0,
        expectedProjectRevision: deactivatedBody.projectRevision,
      }),
    },
  );
  expect(managerPatch.status).toBe(403);
  const operatorPatch = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "운영자 변경 허용",
        expectedRevision: 0,
        expectedProjectRevision: deactivatedBody.projectRevision,
      }),
    },
  );
  expect(operatorPatch.status).toBe(200);
});
