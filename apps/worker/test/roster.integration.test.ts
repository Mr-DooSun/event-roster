import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { addRosterEntry } from "../src/services/roster";
import {
  authedRequest,
  seedManager,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { authenticatedHeaders, resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("adds, cancels, and reactivates one roster row with revisions", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    source: string;
    status: string;
    revision: number;
    projectRevision: number;
  }>();
  expect(added.status).toBe(201);
  expect(entry).toMatchObject({
    source: "PRE_REGISTRATION",
    status: "ACTIVE",
  });

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
  expect(cancelled.status).toBe(200);

  const reactivated = await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: cancelledEntry.projectRevision,
      },
    },
    fixture.firstParticipant.id,
  );
  expect(reactivated.status).toBe(200);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ?",
      )
        .bind(fixture.project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("rolls back roster and audit when the project revision is stale", async () => {
  const fixture = await setupPreRegistration();
  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  const stale = await addRoster(
    fixture,
    fixture.firstParticipant.id,
    fixture.project.revision - 1,
  );
  expect(stale.status).toBe(409);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(before?.count);
});

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "rejects a %s writing another organization roster",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    await seedOrganization("org-2", "2팀");
    const manager = await seedManager("org-2");
    await env.DB.prepare(
      `UPDATE user_organizations
       SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-2'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();
    const forbidden = await authedRequest(
      manager,
      `/api/v1/projects/${fixture.project.id}/roster`,
      {
        method: "POST",
        body: JSON.stringify({
          participantId: fixture.firstParticipant.id,
          confirmedParticipant: {
            name: "첫 참가자",
            organizationId: "org-1",
          },
          expectedParticipantRevision: 0,
          expectedRevision: fixture.project.revision,
        }),
      },
    );
    expect(forbidden.status).toBe(403);
  },
);

it("rejects CLOSED mutations and allows audited IN_PROGRESS additions after reopen", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const first = await added.json<{ projectRevision: number }>();
  const transition = async (targetStatus: string, expectedRevision: number) => {
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({ targetStatus, expectedRevision }),
      },
    );
    return response.json<{ revision: number }>();
  };
  const inProgress = await transition("IN_PROGRESS", first.projectRevision);
  const closed = await transition("CLOSED", inProgress.revision);
  const rejected = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: closed.revision },
    },
    fixture.secondParticipant.id,
  );
  expect(rejected.status).toBe(409);
  expect(await rejected.json<{ code: string }>()).toMatchObject({
    code: "PROJECT_CLOSED",
  });

  const reopened = await transition("IN_PROGRESS", closed.revision);
  const afterReopen = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: reopened.revision },
    },
    fixture.secondParticipant.id,
  );
  expect(afterReopen.status).toBe(201);
  expect(await afterReopen.json<{ source: string }>()).toMatchObject({
    source: "IN_PROGRESS",
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT expected_count FROM project_expected_snapshots WHERE project_id = ? AND organization_id = 'org-1'",
      )
        .bind(fixture.project.id)
        .first<{ expected_count: number }>()
    )?.expected_count,
  ).toBe(1);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action = 'PROJECT_REOPENED' AND entity_id = ?`,
      )
        .bind(fixture.project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("forbids organization managers from IN_PROGRESS roster mutations", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  const dayOf = await transitioned.json<{ revision: number }>();
  const forbidden = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: { name: "첫 참가자", organizationId: "org-1" },
        expectedParticipantRevision: 0,
        expectedRevision: dayOf.revision,
      }),
    },
  );
  expect(forbidden.status).toBe(403);
});

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "%s can mutate its active organization only during pre-registration",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    const manager = await seedManager("org-1");
    await env.DB.prepare(
      `UPDATE user_organizations
       SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-1'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();

    const preRegistrationAdd = await addRoster(
      { ...fixture, operator: manager },
      fixture.firstParticipant.id,
    );
    expect(preRegistrationAdd.status).toBe(201);
    const added = await preRegistrationAdd.json<{
      projectRevision: number;
    }>();

    const transitioned = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({
          targetStatus: "IN_PROGRESS",
          expectedRevision: added.projectRevision,
        }),
      },
    );
    expect(transitioned.status).toBe(200);
    const inProgress = await transitioned.json<{ revision: number }>();

    const dayOfAdd = await addRoster(
      {
        ...fixture,
        operator: manager,
        project: { ...fixture.project, revision: inProgress.revision },
      },
      fixture.secondParticipant.id,
      inProgress.revision,
    );
    expect(dayOfAdd.status).toBe(403);
  },
);

it("stops exposing projects and participants on the next request after organization deactivation", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");

  expect(
    await (await authedRequest(manager, "/api/v1/projects")).json<
      Array<{ id: string }>
    >(),
  ).toEqual([expect.objectContaining({ id: fixture.project.id })]);
  expect(
    await (await authedRequest(manager, "/api/v1/participants")).json<
      Array<{ id: string }>
    >(),
  ).toHaveLength(2);

  const deactivated = await authedRequest(
    fixture.operator,
    "/api/v1/organizations/org-1",
    {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    },
  );
  expect(deactivated.status).toBe(200);

  expect(
    await (await authedRequest(manager, "/api/v1/projects")).json<
      Array<{ id: string }>
    >(),
  ).toEqual([]);
  expect(
    await (await authedRequest(manager, "/api/v1/participants")).json<
      Array<{ id: string }>
    >(),
  ).toEqual([]);
  expect(
    (await authedRequest(manager, `/api/v1/projects/${fixture.project.id}`))
      .status,
  ).toBe(403);
});

it("stops assignment-derived access on the next request after assignment removal", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  expect(
    (await authedRequest(manager, `/api/v1/projects/${fixture.project.id}`))
      .status,
  ).toBe(200);

  await env.DB.prepare(
    "DELETE FROM user_organizations WHERE user_id = ? AND organization_id = 'org-1'",
  )
    .bind(manager.userId)
    .run();

  expect(
    await (await authedRequest(manager, "/api/v1/projects")).json<
      Array<{ id: string }>
    >(),
  ).toEqual([]);
  expect(
    (await authedRequest(manager, `/api/v1/projects/${fixture.project.id}`))
      .status,
  ).toBe(403);
});

it("shows projects linked to each active organization of a multi-organization manager", async () => {
  const fixture = await setupPreRegistration();
  await seedOrganization("org-2", "2팀");
  const secondProject = await seedProject(fixture.operator, {
    name: "두 번째 프로젝트",
  });
  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${secondProject.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-2",
        expectedProjectRevision: secondProject.revision,
      }),
    },
  );
  expect(linked.status).toBe(201);
  const manager = await seedManager("org-1");
  await env.DB.prepare(
    `INSERT INTO user_organizations
     (user_id, organization_id, assignment_role, assigned_by, assigned_at)
     VALUES (?, 'org-2', 'PRIMARY_LEADER', NULL, ?)`,
  )
    .bind(manager.userId, "2026-07-23T00:00:00.000Z")
    .run();

  const projects = await (
    await authedRequest(manager, "/api/v1/projects")
  ).json<Array<{ id: string }>>();
  expect(projects.map((project) => project.id).sort()).toEqual(
    [fixture.project.id, secondProject.id].sort(),
  );
});

it("keeps a leaderless organization fully roster-editable by an operator", async () => {
  const fixture = await setupPreRegistration();
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM user_organizations WHERE organization_id = 'org-1'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);

  expect((await addRoster(fixture, fixture.firstParticipant.id)).status).toBe(
    201,
  );
});

it("serializes a PRE_REGISTRATION add against the IN_PROGRESS snapshot transition", async () => {
  const fixture = await setupPreRegistration();
  const transition = authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  const add = addRoster(fixture, fixture.firstParticipant.id);
  const responses = await Promise.all([transition, add]);
  const statuses = responses.map((response) => response.status);
  expect(statuses.filter((status) => status === 409)).toHaveLength(1);
  expect(statuses.some((status) => status === 200 || status === 201)).toBe(
    true,
  );
  const project = await env.DB.prepare(
    "SELECT status FROM projects WHERE id = ?",
  )
    .bind(fixture.project.id)
    .first<{ status: string }>();
  const roster = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ? AND status = 'ACTIVE'",
  )
    .bind(fixture.project.id)
    .first<{ count: number }>();
  const snapshot = await env.DB.prepare(
    "SELECT COALESCE(SUM(expected_count), 0) AS count FROM project_expected_snapshots WHERE project_id = ?",
  )
    .bind(fixture.project.id)
    .first<{ count: number }>();
  if (project?.status === "IN_PROGRESS") {
    expect(snapshot?.count).toBe(roster?.count);
  } else {
    expect(project?.status).toBe("PRE_REGISTRATION");
    expect(snapshot?.count).toBe(0);
  }
});

it("creates a participant and roster entry atomically", async () => {
  const fixture = await setupPreRegistration();
  const created = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: { name: "신규 참가자", organizationId: "org-1" },
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(created.status).toBe(201);
  const createdBody = await created.json<{
    participant: { id: string };
    rosterEntry: { id: string };
  }>();
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants WHERE name='신규 참가자'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE (action = 'PARTICIPANT_CREATED' AND entity_id = ?)
            OR (action = 'ROSTER_ADDED' AND entity_id = ?)`,
      )
        .bind(createdBody.participant.id, createdBody.rosterEntry.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(2);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id=?",
      )
        .bind(fixture.project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);

  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: { name: "롤백 참가자", organizationId: "org-1" },
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants WHERE name='롤백 참가자'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("preserves historical roster operations when a project membership becomes inactive", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
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
  expect(deactivated.status).toBe(200);
  const deactivatedBody = await deactivated.json<{
    projectRevision: number;
  }>();

  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${entry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: deactivatedBody.projectRevision,
        expectedEntryRevision: entry.revision,
      }),
    },
  );
  const cancelledEntry = await cancelled.json<{
    revision: number;
    projectRevision: number;
  }>();
  expect(cancelled.status).toBe(200);
  const reactivated = await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: cancelledEntry.projectRevision,
      },
    },
    fixture.firstParticipant.id,
  );
  const reactivatedEntry = await reactivated.json<{
    projectRevision: number;
  }>();
  expect(reactivated.status).toBe(200);

  const updated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "변경된 마스터 이름",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: reactivatedEntry.projectRevision,
      }),
    },
  );
  expect(updated.status).toBe(200);
  expect(
    (
      await env.DB.prepare(
        "SELECT participant_name_snapshot FROM project_roster_entries WHERE id=?",
      )
        .bind(entry.id)
        .first<{ participant_name_snapshot: string }>()
    )?.participant_name_snapshot,
  ).toBe("첫 참가자");
  expect(
    (
      await authedRequest(
        fixture.operator,
        `/api/v1/projects/${fixture.project.id}/summary`,
      )
    ).status,
  ).toBe(200);

  const newEntry = await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: reactivatedEntry.projectRevision + 1,
      },
    },
    fixture.secondParticipant.id,
  );
  expect(newEntry.status).toBe(422);
});

it("makes an inactive membership read-only for managers while operators can cancel and reactivate history", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
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
  const deactivatedBody = await deactivated.json<{
    projectRevision: number;
  }>();
  const manager = await seedManager("org-1");
  const managerCancel = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster/${entry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: deactivatedBody.projectRevision,
        expectedEntryRevision: entry.revision,
      }),
    },
  );
  expect(managerCancel.status).toBe(403);

  const operatorCancel = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${entry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: deactivatedBody.projectRevision,
        expectedEntryRevision: entry.revision,
      }),
    },
  );
  expect(operatorCancel.status).toBe(200);
  const cancelled = await operatorCancel.json<{
    revision: number;
    projectRevision: number;
  }>();

  const managerReactivate = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: { name: "첫 참가자", organizationId: "org-1" },
        expectedParticipantRevision: 0,
        expectedRevision: cancelled.projectRevision,
      }),
    },
  );
  expect(managerReactivate.status).toBe(403);
  const operatorReactivate = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: cancelled.projectRevision },
    },
    fixture.firstParticipant.id,
  );
  expect(operatorReactivate.status).toBe(200);
  const reactivated = await operatorReactivate.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  await authedRequest(fixture.operator, "/api/v1/organizations/org-1", {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  const masterInactiveCancel = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster/${reactivated.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: reactivated.projectRevision,
        expectedEntryRevision: reactivated.revision,
      }),
    },
  );
  expect(masterInactiveCancel.status).toBe(403);
});

it("atomically refreshes a reused participant only for a new project and preserves old snapshots", async () => {
  const fixture = await setupPreRegistration();
  const oldAdded = await addRoster(fixture, fixture.firstParticipant.id);
  expect(oldAdded.status).toBe(201);
  const targetOrganization = await seedOrganization("org-2", "2팀");
  const targetProject = await seedProject(fixture.operator, {
    name: "새 프로젝트",
  });
  const linkedResponse = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${targetProject.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: targetOrganization.id,
        expectedProjectRevision: targetProject.revision,
      }),
    },
  );
  const linked = await linkedResponse.json<{ projectRevision: number }>();
  const pre = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${targetProject.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: linked.projectRevision,
      }),
    },
  );
  const target = await pre.json<{ revision: number }>();
  const reused = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${targetProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: { name: "최신 참가자", organizationId: "org-2" },
        expectedParticipantRevision: fixture.firstParticipant.revision,
        expectedRevision: target.revision,
      }),
    },
  );
  expect(reused.status).toBe(201);
  expect(
    await env.DB.prepare(
      "SELECT name, organization_id, revision FROM participants WHERE id = ?",
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "최신 참가자", organization_id: "org-2", revision: 1 });
  const snapshots = (
    await env.DB.prepare(
      `SELECT project_id, participant_name_snapshot, organization_name_snapshot
       FROM project_roster_entries WHERE participant_id = ? ORDER BY project_id`,
    )
      .bind(fixture.firstParticipant.id)
      .all<{
        project_id: string;
        participant_name_snapshot: string;
        organization_name_snapshot: string;
      }>()
  ).results;
  expect(snapshots).toEqual(
    expect.arrayContaining([
      {
        project_id: fixture.project.id,
        participant_name_snapshot: "첫 참가자",
        organization_name_snapshot: "1팀",
      },
      {
        project_id: targetProject.id,
        participant_name_snapshot: "최신 참가자",
        organization_name_snapshot: "2팀",
      },
    ]),
  );

  const staleProject = await seedProject(fixture.operator, {
    name: "stale 프로젝트",
  });
  const staleLinkedResponse = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${staleProject.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: targetOrganization.id,
        expectedProjectRevision: staleProject.revision,
      }),
    },
  );
  const staleLinked = await staleLinkedResponse.json<{
    projectRevision: number;
  }>();
  const stalePre = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${staleProject.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: staleLinked.projectRevision,
      }),
    },
  );
  const staleTarget = await stalePre.json<{ revision: number }>();
  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${staleProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: { name: "롤백 이름", organizationId: "org-2" },
        expectedParticipantRevision: 0,
        expectedRevision: staleTarget.revision,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect(
    await env.DB.prepare("SELECT name, revision FROM participants WHERE id = ?")
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "최신 참가자", revision: 1 });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ?",
      )
        .bind(staleProject.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("forbids a manager from moving a reused participant even with both active organization scopes", async () => {
  const { fixture, manager, targetProject } = await setupManagerReuseProject();
  const beforeAudit = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  const response = await authedRequest(
    manager,
    `/api/v1/projects/${targetProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: {
          name: "관리자 이동 금지",
          organizationId: "org-2",
        },
        expectedParticipantRevision: fixture.firstParticipant.revision,
        expectedRevision: targetProject.revision,
      }),
    },
  );

  expect(response.status).toBe(403);
  expect(
    await env.DB.prepare(
      "SELECT name, organization_id, revision FROM participants WHERE id = ?",
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "첫 참가자", organization_id: "org-1", revision: 0 });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ?",
      )
        .bind(targetProject.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    (
      await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
        .bind(targetProject.id)
        .first<{ revision: number }>()
    )?.revision,
  ).toBe(targetProject.revision);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(beforeAudit?.count);
});

it("allows a manager to rename a same-organization participant while reusing it", async () => {
  const { fixture, manager, targetProject } = await setupManagerReuseProject();
  const response = await authedRequest(
    manager,
    `/api/v1/projects/${targetProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: {
          name: "관리자 확인 이름",
          organizationId: "org-1",
        },
        expectedParticipantRevision: fixture.firstParticipant.revision,
        expectedRevision: targetProject.revision,
      }),
    },
  );

  expect(response.status).toBe(201);
  expect(
    await env.DB.prepare(
      "SELECT name, organization_id, revision FROM participants WHERE id = ?",
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({
    name: "관리자 확인 이름",
    organization_id: "org-1",
    revision: 1,
  });
  expect(
    await env.DB.prepare(
      `SELECT participant_name_snapshot, organization_id
       FROM project_roster_entries WHERE project_id = ? AND participant_id = ?`,
    )
      .bind(targetProject.id, fixture.firstParticipant.id)
      .first(),
  ).toEqual({
    participant_name_snapshot: "관리자 확인 이름",
    organization_id: "org-1",
  });
});

it("rechecks a manager participant organization inside the atomic reuse guard", async () => {
  const { fixture, manager, targetProject } = await setupManagerReuseProject();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(manager),
    }),
    env as Env,
  );
  const beforeAudit = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          "UPDATE participants SET organization_id = 'org-2' WHERE id = ?",
        )
          .bind(fixture.firstParticipant.id)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    addRosterEntry(
      { ...(env as Env), DB: raceDb },
      actor,
      targetProject.id,
      fixture.firstParticipant.id,
      targetProject.revision,
      { name: "race 이름", organizationId: "org-1" },
      fixture.firstParticipant.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    await env.DB.prepare(
      "SELECT name, organization_id, revision FROM participants WHERE id = ?",
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "첫 참가자", organization_id: "org-2", revision: 0 });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ?",
      )
        .bind(targetProject.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    (
      await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
        .bind(targetProject.id)
        .first<{ revision: number }>()
    )?.revision,
  ).toBe(targetProject.revision);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(beforeAudit?.count);
});

it("rechecks the manager assignment inside the atomic roster guard", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(manager),
    }),
    env as Env,
  );
  const beforeAudit = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          "DELETE FROM user_organizations WHERE user_id = ? AND organization_id = 'org-1'",
        )
          .bind(manager.userId)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    addRosterEntry(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.project.id,
      fixture.firstParticipant.id,
      fixture.project.revision,
      { name: "경쟁 조건 이름", organizationId: "org-1" },
      fixture.firstParticipant.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_roster_entries WHERE project_id = ?",
      )
        .bind(fixture.project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(beforeAudit?.count);
});

it("reactivates a same-project entry without replacing its snapshot with confirmed values", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const active = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${active.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: active.projectRevision,
        expectedEntryRevision: active.revision,
      }),
    },
  );
  const cancelledBody = await cancelled.json<{ projectRevision: number }>();
  const reactivated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: {
          name: "덮어쓰면 안 됨",
          organizationId: "org-1",
        },
        expectedParticipantRevision: 0,
        expectedRevision: cancelledBody.projectRevision,
      }),
    },
  );
  expect(reactivated.status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT participant_name_snapshot, organization_name_snapshot FROM project_roster_entries WHERE id = ?",
    )
      .bind(active.id)
      .first(),
  ).toEqual({
    participant_name_snapshot: "첫 참가자",
    organization_name_snapshot: "1팀",
  });
});

it("closes an expired project when auto-close first loses a revision race", async () => {
  const fixture = await setupPreRegistration();
  await env.DB.prepare("UPDATE projects SET end_date='2026-07-21' WHERE id=?")
    .bind(fixture.project.id)
    .run();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          "UPDATE projects SET revision=revision+1 WHERE id=?",
        )
          .bind(fixture.project.id)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;
  await expect(
    addRosterEntry(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.project.id,
      fixture.firstParticipant.id,
      fixture.project.revision + 1,
      { name: "첫 참가자", organizationId: "org-1" },
      fixture.firstParticipant.revision,
      new Date("2026-07-22T01:00:00.000Z"),
    ),
  ).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
  expect(
    (
      await env.DB.prepare("SELECT status FROM projects WHERE id=?")
        .bind(fixture.project.id)
        .first<{ status: string }>()
    )?.status,
  ).toBe("CLOSED");
});

async function setupManagerReuseProject() {
  const fixture = await setupPreRegistration();
  await seedOrganization("org-2", "2팀");
  const target = await seedProject(fixture.operator, {
    name: "manager reuse 프로젝트",
  });
  let projectRevision = target.revision;
  for (const organizationId of ["org-1", "org-2"]) {
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${target.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          expectedProjectRevision: projectRevision,
        }),
      },
    );
    expect(linked.status).toBe(201);
    projectRevision = (await linked.json<{ projectRevision: number }>())
      .projectRevision;
  }
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${target.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: projectRevision,
      }),
    },
  );
  const targetProject = await transitioned.json<{
    id: string;
    revision: number;
  }>();
  const manager = await seedManager("org-1");
  await env.DB.prepare(
    `INSERT INTO user_organizations
     (user_id, organization_id, assignment_role, assigned_by, assigned_at)
     VALUES (?, 'org-2', 'MANAGER', NULL, ?)`,
  )
    .bind(manager.userId, "2026-07-23T00:00:00.000Z")
    .run();
  return { fixture, manager, targetProject };
}
