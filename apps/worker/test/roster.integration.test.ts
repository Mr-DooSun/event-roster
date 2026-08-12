import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { createBulkParticipantsAndAddToProject } from "../src/services/bulk-participants";
import { addRosterEntry, updateRosterEntry } from "../src/services/roster";
import {
  authedRequest,
  seedManager,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { authenticatedHeaders, resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);
afterEach(async () => {
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL`,
  ).run();
});

async function markProjectDeleted(
  projectId: string,
  actorId: string,
  revision: number,
) {
  const timestamp = "2026-07-29T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE projects
     SET status = 'CLOSED', revision = ?, updated_at = ?,
         closed_at = ?, closed_by = ?, close_reason = 'MANUAL',
         deleted_at = ?, deleted_by = ?, deleted_revision = ?
     WHERE id = ?`,
  )
    .bind(
      revision + 1,
      timestamp,
      timestamp,
      actorId,
      timestamp,
      actorId,
      revision + 1,
      projectId,
    )
    .run();
}

it("hides the roster after the project is deleted", async () => {
  const fixture = await setupPreRegistration();
  await markProjectDeleted(
    fixture.project.id,
    fixture.operator.userId,
    fixture.project.revision,
  );

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
  );
  expect(response.status).toBe(404);
});

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

it("persists participant profiles for an existing participant add", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );

  const entry = await addRosterEntry(
    env as Env,
    actor,
    fixture.project.id,
    fixture.firstParticipant.id,
    fixture.project.revision,
    {
      name: "첫 참가자",
      organizationId: "org-1",
      role: "STUDENT",
      grade: "M2",
    },
    fixture.firstParticipant.revision,
  );

  expect(entry).toMatchObject({ role: "STUDENT", grade: "M2" });
  expect(
    await env.DB.prepare(
      `SELECT participant_role_snapshot, student_grade_snapshot
       FROM project_roster_entries WHERE id = ?`,
    )
      .bind(entry.id)
      .first(),
  ).toEqual({
    participant_role_snapshot: "STUDENT",
    student_grade_snapshot: "M2",
  });
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
            role: "STUDENT",
            grade: "M1",
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
  const first = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
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
  const rejectedPatch = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${first.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: closed.revision,
        expectedEntryRevision: first.revision,
      }),
    },
  );
  expect(rejectedPatch.status).toBe(409);
  expect(await rejectedPatch.json()).toMatchObject({ code: "PROJECT_CLOSED" });
  const rejectedBulk = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "종료 뒤 일괄 금지", role: "TEACHER", grade: null },
        ],
        confirmDuplicateNames: false,
        expectedRevision: closed.revision,
      }),
    },
  );
  expect(rejectedBulk.status).toBe(409);
  expect(await rejectedBulk.json()).toMatchObject({ code: "PROJECT_CLOSED" });

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
        confirmedParticipant: {
          name: "첫 참가자",
          organizationId: "org-1",
          role: "STUDENT",
          grade: "M1",
        },
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
        newParticipant: {
          name: "신규 참가자",
          organizationId: "org-1",
          role: "TEACHER",
          grade: null,
        },
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(created.status).toBe(201);
  const createdBody = await created.json<{
    participant: { id: string };
    rosterEntry: { id: string; role: string | null; grade: string | null };
  }>();
  expect(createdBody.rosterEntry).toMatchObject({
    role: "TEACHER",
    grade: null,
  });
  expect(
    await env.DB.prepare(
      `SELECT participant_role_snapshot, student_grade_snapshot
       FROM project_roster_entries WHERE id = ?`,
    )
      .bind(createdBody.rosterEntry.id)
      .first(),
  ).toEqual({
    participant_role_snapshot: "TEACHER",
    student_grade_snapshot: null,
  });
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
        newParticipant: {
          name: "롤백 참가자",
          organizationId: "org-1",
          role: "STUDENT",
          grade: "H1",
        },
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

it("keeps deleted-organization roster history readable while rejecting every new roster path", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const addedBody = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${addedBody.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: addedBody.projectRevision,
        expectedEntryRevision: addedBody.revision,
      }),
    },
  );
  const cancelledBody = await cancelled.json<{ projectRevision: number }>();
  const deletedAt = "2026-08-03T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
     WHERE id = 'org-1'`,
  )
    .bind(deletedAt, fixture.operator.userId, deletedAt)
    .run();

  const historicalRoster = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
  );
  expect(historicalRoster.status).toBe(200);
  expect(
    await historicalRoster.json<Array<{ participantNumber: string }>>(),
  ).toEqual([expect.objectContaining({ participantNumber: "P-FIRST" })]);

  const reactivated = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: cancelledBody.projectRevision },
    },
    fixture.firstParticipant.id,
    cancelledBody.projectRevision,
  );
  const existing = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: cancelledBody.projectRevision },
    },
    fixture.secondParticipant.id,
    cancelledBody.projectRevision,
  );
  const created = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: {
          name: "삭제 조직 신규 참가자",
          organizationId: "org-1",
          role: "TEACHER",
          grade: null,
        },
        expectedRevision: cancelledBody.projectRevision,
      }),
    },
  );
  const bulk = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "삭제 조직 일괄 참가자", role: "STUDENT", grade: "H1" },
        ],
        confirmDuplicateNames: false,
        expectedRevision: cancelledBody.projectRevision,
      }),
    },
  );

  expect(reactivated.status).toBe(409);
  expect(existing.status).toBe(422);
  expect(created.status).toBe(422);
  expect(bulk.status).toBe(422);
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM participants
       WHERE name IN ('삭제 조직 신규 참가자', '삭제 조직 일괄 참가자')`,
    ).first(),
  ).toEqual({ count: 0 });
});

it.each([
  { organizationState: "INACTIVE", nextStatus: "ACTIVE" },
  { organizationState: "INACTIVE", nextStatus: "CANCELLED" },
  { organizationState: "DELETED", nextStatus: "ACTIVE" },
  { organizationState: "DELETED", nextStatus: "CANCELLED" },
] as const)(
  "rejects PATCH roster $nextStatus for a $organizationState organization",
  async ({ organizationState, nextStatus }) => {
    const fixture = await setupPreRegistration();
    const added = await addRoster(fixture, fixture.firstParticipant.id);
    const active = await added.json<{
      id: string;
      revision: number;
      projectRevision: number;
    }>();
    let current = active;
    if (nextStatus === "ACTIVE") {
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
      current = await cancelled.json<{
        id: string;
        revision: number;
        projectRevision: number;
      }>();
    }
    const changedAt = "2026-08-03T00:00:00.000Z";
    if (organizationState === "DELETED") {
      await env.DB.prepare(
        `UPDATE organizations
         SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
         WHERE id = 'org-1'`,
      )
        .bind(changedAt, fixture.operator.userId, changedAt)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE organizations SET is_active = 0, updated_at = ?
         WHERE id = 'org-1'`,
      )
        .bind(changedAt)
        .run();
    }

    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/roster/${active.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
          expectedRevision: current.projectRevision,
          expectedEntryRevision: current.revision,
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(
      await env.DB.prepare(
        `SELECT status, revision FROM project_roster_entries WHERE id = ?`,
      )
        .bind(active.id)
        .first(),
    ).toEqual({
      status: nextStatus === "ACTIVE" ? "CANCELLED" : "ACTIVE",
      revision: current.revision,
    });
    expect(
      await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
        .bind(fixture.project.id)
        .first(),
    ).toEqual({ revision: current.projectRevision });
  },
);

it("rechecks organization deletion atomically before PATCH roster reactivation", async () => {
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
  const cancelledBody = await cancelled.json<{
    revision: number;
    projectRevision: number;
  }>();
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
        const changedAt = "2026-08-03T00:00:00.000Z";
        await env.DB.prepare(
          `UPDATE organizations
           SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
           WHERE id = 'org-1'`,
        )
          .bind(changedAt, fixture.operator.userId, changedAt)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    updateRosterEntry(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.project.id,
      active.id,
      {
        status: "ACTIVE",
        expectedRevision: cancelledBody.projectRevision,
        expectedEntryRevision: cancelledBody.revision,
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    await env.DB.prepare(
      `SELECT status, revision FROM project_roster_entries WHERE id = ?`,
    )
      .bind(active.id)
      .first(),
  ).toEqual({ status: "CANCELLED", revision: 1 });
});

it("rechecks organization deletion atomically before PATCH roster cancellation", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const active = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
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
        const changedAt = "2026-08-03T00:00:00.000Z";
        await env.DB.prepare(
          `UPDATE organizations
           SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
           WHERE id = 'org-1'`,
        )
          .bind(changedAt, fixture.operator.userId, changedAt)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    updateRosterEntry(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.project.id,
      active.id,
      {
        status: "CANCELLED",
        expectedRevision: active.projectRevision,
        expectedEntryRevision: active.revision,
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    await env.DB.prepare(
      `SELECT status, revision FROM project_roster_entries WHERE id = ?`,
    )
      .bind(active.id)
      .first(),
  ).toEqual({ status: "ACTIVE", revision: 0 });
  expect(
    await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
      .bind(fixture.project.id)
      .first(),
  ).toEqual({ revision: active.projectRevision });
});

it("warns about input and existing duplicates without writing rows", async () => {
  const fixture = await setupPreRegistration();
  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants",
  ).first<{ count: number }>();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "첫 참가자", role: "STUDENT", grade: "M1" },
          { name: "새 이름", role: "TEACHER", grade: null },
          { name: " 새   이름 ", role: "STUDENT", grade: "H2" },
        ],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "CONFLICT",
    details: {
      reason: "DUPLICATE_PARTICIPANT_NAMES",
      duplicates: [
        { name: "첫 참가자", kinds: ["EXISTING_PARTICIPANT"] },
        { name: "새 이름", kinds: ["INPUT_DUPLICATE"] },
      ],
    },
  });
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM participants").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(before?.count);
});

it.each([1, 30])(
  "creates %i new participants atomically in input order",
  async (participantCount) => {
    const fixture = await setupPreRegistration();
    const names = Array.from(
      { length: participantCount },
      (_, index) => `대량 참가자 ${index + 1}`,
    );
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/roster/bulk`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-1",
          participants: names.map((name) => ({
            name,
            role: "STUDENT",
            grade: "M3",
          })),
          confirmDuplicateNames: false,
          expectedRevision: fixture.project.revision,
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json<{
      batchId: string;
      participants: Array<{
        participant: { id: string; name: string };
        rosterEntry: {
          id: string;
          source: string;
          role: string | null;
          grade: string | null;
          wasExpectedAtStart: boolean;
        };
      }>;
      projectRevision: number;
    }>();
    expect(body.batchId).toBeTruthy();
    expect(
      body.participants.map(({ participant }) => participant.name),
    ).toEqual(names);
    expect(body.participants).toHaveLength(participantCount);
    expect(body.participants[0]?.rosterEntry).toMatchObject({
      source: "PRE_REGISTRATION",
      role: "STUDENT",
      grade: "M3",
      wasExpectedAtStart: false,
    });
    expect(body.projectRevision).toBe(fixture.project.revision + 1);
    expect(
      (
        await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
          .bind(fixture.project.id)
          .first<{ revision: number }>()
      )?.revision,
    ).toBe(fixture.project.revision + 1);
    expect(
      (
        await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM participants
           WHERE name LIKE '대량 참가자 %'`,
        ).first<{ count: number }>()
      )?.count,
    ).toBe(participantCount);
    expect(
      (
        await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
           WHERE details_json LIKE ?`,
        )
          .bind(`%"batchId":"${body.batchId}"%`)
          .first<{ count: number }>()
      )?.count,
    ).toBe(participantCount * 2);
  },
);

it("writes structured bulk profiles in order and increments the project once", async () => {
  const fixture = await setupPreRegistration();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "  중학생  ", role: "STUDENT", grade: "M2" },
          { name: "중학생", role: "TEACHER", grade: null },
        ],
        confirmDuplicateNames: true,
        expectedRevision: fixture.project.revision,
      }),
    },
  );

  expect(response.status).toBe(201);
  const body = await response.json<{
    batchId: string;
    participants: Array<{
      participant: { id: string };
      rosterEntry: {
        id: string;
        participantName: string;
        role: string | null;
        grade: string | null;
      };
    }>;
    projectRevision: number;
  }>();
  expect(body.participants.map((item) => item.rosterEntry)).toMatchObject([
    { participantName: "중학생", role: "STUDENT", grade: "M2" },
    { participantName: "중학생", role: "TEACHER", grade: null },
  ]);
  expect(body.projectRevision).toBe(fixture.project.revision + 1);
  expect(
    (
      await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
        .bind(fixture.project.id)
        .first<{ revision: number }>()
    )?.revision,
  ).toBe(fixture.project.revision + 1);
  const profileAuditRows = (
    await env.DB.prepare(
      `SELECT action, entity_type, entity_id, details_json FROM audit_logs
       WHERE details_json LIKE ?`,
    )
      .bind(`%"batchId":"${body.batchId}"%`)
      .all<{
        action: string;
        entity_type: string;
        entity_id: string;
        details_json: string;
      }>()
  ).results.map((row) => ({
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: JSON.parse(row.details_json),
  }));
  expect(profileAuditRows).toHaveLength(4);
  expect(profileAuditRows).toEqual(
    expect.arrayContaining([
      {
        action: "PARTICIPANT_CREATED",
        entityType: "PARTICIPANT",
        entityId: body.participants[0]?.participant.id,
        details: {
          batchId: body.batchId,
          projectId: fixture.project.id,
          organizationId: "org-1",
          participantName: "중학생",
          participantRole: "STUDENT",
          studentGrade: "M2",
          gender: null,
        },
      },
      {
        action: "ROSTER_ADDED",
        entityType: "ROSTER_ENTRY",
        entityId: body.participants[0]?.rosterEntry.id,
        details: {
          batchId: body.batchId,
          projectId: fixture.project.id,
          organizationId: "org-1",
          participantName: "중학생",
          participantRole: "STUDENT",
          studentGrade: "M2",
          gender: null,
        },
      },
      {
        action: "PARTICIPANT_CREATED",
        entityType: "PARTICIPANT",
        entityId: body.participants[1]?.participant.id,
        details: {
          batchId: body.batchId,
          projectId: fixture.project.id,
          organizationId: "org-1",
          participantName: "중학생",
          participantRole: "TEACHER",
          studentGrade: null,
          gender: null,
        },
      },
      {
        action: "ROSTER_ADDED",
        entityType: "ROSTER_ENTRY",
        entityId: body.participants[1]?.rosterEntry.id,
        details: {
          batchId: body.batchId,
          projectId: fixture.project.id,
          organizationId: "org-1",
          participantName: "중학생",
          participantRole: "TEACHER",
          studentGrade: null,
          gender: null,
        },
      },
    ]),
  );
});

it("rejects 31 bulk participants before any SQL write", async () => {
  const fixture = await setupPreRegistration();
  const before = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM participants"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_roster_entries"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs"),
  ]);
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: Array.from({ length: 31 }, (_, index) => ({
          name: `초과 참가자 ${index + 1}`,
          role: "STUDENT",
          grade: "M1",
        })),
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );

  expect(response.status).toBe(422);
  const after = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM participants"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_roster_entries"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs"),
  ]);
  expect(after.map((result) => result.results[0])).toEqual(
    before.map((result) => result.results[0]),
  );
});

it("uses the IN_PROGRESS source for operator bulk registration", async () => {
  const fixture = await setupPreRegistration();
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
  const project = await transitioned.json<{ revision: number }>();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [{ name: "당일 참가자", role: "TEACHER", grade: null }],
        confirmDuplicateNames: false,
        expectedRevision: project.revision,
      }),
    },
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    participants: [{ rosterEntry: { source: "IN_PROGRESS" } }],
  });
});

it("rejects stale, inactive, and out-of-scope bulk registration", async () => {
  const fixture = await setupPreRegistration();
  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [{ name: "오래된 요청", role: "STUDENT", grade: "M1" }],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision - 1,
      }),
    },
  );
  expect(stale.status).toBe(409);

  const manager = await seedManager("org-1");
  await seedOrganization("org-2", "2팀");
  const outOfScope = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-2",
        participants: [
          { name: "다른 조직 참가자", role: "STUDENT", grade: "M1" },
        ],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(outOfScope.status).toBe(403);

  await env.DB.prepare(
    `UPDATE project_organizations SET is_active = 0
     WHERE project_id = ? AND organization_id = 'org-1'`,
  )
    .bind(fixture.project.id)
    .run();
  const inactive = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "비활성 조직 참가자", role: "STUDENT", grade: "M1" },
        ],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(inactive.status).toBe(422);
});

it("rejects manager IN_PROGRESS writes and inactive organization masters", async () => {
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
  const project = await transitioned.json<{ revision: number }>();
  const managerResponse = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "담당자 당일 참가자", role: "TEACHER", grade: null },
        ],
        confirmDuplicateNames: false,
        expectedRevision: project.revision,
      }),
    },
  );
  expect(managerResponse.status).toBe(403);

  await env.DB.prepare(
    "UPDATE organizations SET is_active = 0 WHERE id = 'org-1'",
  ).run();
  const inactiveMaster = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants: [
          { name: "비활성 마스터 참가자", role: "STUDENT", grade: "H3" },
        ],
        confirmDuplicateNames: false,
        expectedRevision: project.revision,
      }),
    },
  );
  expect(inactiveMaster.status).toBe(422);
});

it("preserves every profile after a duplicate conflict and confirmed retry", async () => {
  const fixture = await setupPreRegistration();
  const participants = [
    { name: "첫 참가자", role: "STUDENT", grade: "M2" },
    { name: "같은 이름", role: "TEACHER", grade: null },
    { name: "같은 이름", role: "STUDENT", grade: "H1" },
  ] as const;
  const conflicted = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants,
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(conflicted.status).toBe(409);
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        participants,
        confirmDuplicateNames: true,
        expectedRevision: fixture.project.revision,
      }),
    },
  );

  expect(response.status).toBe(201);
  const body = await response.json<{
    participants: Array<{
      rosterEntry: { role: string | null; grade: string | null };
    }>;
  }>();
  expect(body.participants.map((item) => item.rosterEntry)).toMatchObject([
    { role: "STUDENT", grade: "M2" },
    { role: "TEACHER", grade: null },
    { role: "STUDENT", grade: "H1" },
  ]);
});

it("rolls back every bulk row and audit when one insert fails", async () => {
  const fixture = await setupPreRegistration();
  const beforeParticipants = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM participants",
  ).first<{ count: number }>();
  const beforeAudit = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  const beforeRoster = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM project_roster_entries",
  ).first<{ count: number }>();
  await env.DB.prepare(
    `CREATE TRIGGER IF NOT EXISTS reject_bulk_participant
     BEFORE INSERT ON participants
     WHEN NEW.name = '거부 대상'
     BEGIN SELECT RAISE(ABORT, 'REJECT_BULK_TEST'); END`,
  ).run();

  try {
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/roster/bulk`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-1",
          participants: [
            { name: "정상 대상", role: "STUDENT", grade: "M1" },
            { name: "거부 대상", role: "TEACHER", grade: null },
          ],
          confirmDuplicateNames: false,
          expectedRevision: fixture.project.revision,
        }),
      },
    );

    expect(response.status).toBe(500);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM participants",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(beforeParticipants?.count);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{
          count: number;
        }>()
      )?.count,
    ).toBe(beforeAudit?.count);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM project_roster_entries",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(beforeRoster?.count);
    expect(
      (
        await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
          .bind(fixture.project.id)
          .first<{ revision: number }>()
      )?.revision,
    ).toBe(fixture.project.revision);
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_bulk_participant").run();
  }
});

it("rejects a bulk write when participant state changes after its snapshot", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const before = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM participants"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_roster_entries"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs"),
    env.DB.prepare("SELECT revision FROM projects WHERE id = ?").bind(
      fixture.project.id,
    ),
  ]);

  await expect(
    createBulkParticipantsAndAddToProject(
      env as Env,
      actor,
      fixture.project.id,
      {
        organizationId: "org-1",
        participants: [{ name: "경합 참가자", role: "STUDENT", grade: "M2" }],
        confirmDuplicateNames: false,
        expectedRevision: fixture.project.revision,
      },
      new Date("2026-07-28T00:00:00.000Z"),
      {
        afterSnapshot: async () => {
          await env.DB.prepare(
            `UPDATE participants SET revision = revision + 1
             WHERE id = 'participant-1'`,
          ).run();
        },
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants WHERE name = '경합 참가자'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
  const after = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM participants"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_roster_entries"),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs"),
    env.DB.prepare("SELECT revision FROM projects WHERE id = ?").bind(
      fixture.project.id,
    ),
  ]);
  expect(after.map((result) => result.results[0])).toEqual(
    before.map((result) => result.results[0]),
  );
});

it("allows a confirmed duplicate request after participant snapshot changes", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );

  const result = await createBulkParticipantsAndAddToProject(
    env as Env,
    actor,
    fixture.project.id,
    {
      organizationId: "org-1",
      participants: [{ name: "첫 참가자", role: "STUDENT", grade: "M1" }],
      confirmDuplicateNames: true,
      expectedRevision: fixture.project.revision,
    },
    new Date("2026-07-28T00:00:00.000Z"),
    {
      afterSnapshot: async () => {
        await env.DB.prepare(
          `UPDATE participants SET revision = revision + 1
           WHERE id = 'participant-1'`,
        ).run();
      },
    },
  );

  expect(result.participants).toHaveLength(1);
  expect(result.participants[0]?.participant.name).toBe("첫 참가자");
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
  ).toBe("변경된 마스터 이름");
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
        confirmedParticipant: {
          name: "첫 참가자",
          organizationId: "org-1",
          role: "STUDENT",
          grade: "M1",
        },
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
  const target = { revision: linked.projectRevision };
  const reused = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${targetProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: {
          name: "최신 참가자",
          organizationId: "org-2",
          role: "TEACHER",
          grade: null,
        },
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
  const staleTarget = { revision: staleLinked.projectRevision };
  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${staleProject.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        confirmedParticipant: {
          name: "롤백 이름",
          organizationId: "org-2",
          role: "STUDENT",
          grade: "H3",
        },
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
          role: "STUDENT",
          grade: "M3",
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
          role: "TEACHER",
          grade: null,
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
      {
        name: "race 이름",
        organizationId: "org-1",
        role: "STUDENT",
        grade: "M2",
      },
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
      {
        name: "경쟁 조건 이름",
        organizationId: "org-1",
        role: "STUDENT",
        grade: "M1",
      },
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

it("reactivates a same-project entry with the newly confirmed profile", async () => {
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
          name: "복원 확인 이름",
          organizationId: "org-1",
          role: "TEACHER",
          grade: null,
        },
        expectedParticipantRevision: 0,
        expectedRevision: cancelledBody.projectRevision,
      }),
    },
  );
  expect(reactivated.status).toBe(200);
  expect(
    await env.DB.prepare(
      `SELECT participant_name_snapshot, organization_name_snapshot,
              participant_role_snapshot, student_grade_snapshot
       FROM project_roster_entries WHERE id = ?`,
    )
      .bind(active.id)
      .first(),
  ).toEqual({
    participant_name_snapshot: "첫 참가자",
    organization_name_snapshot: "1팀",
    participant_role_snapshot: "TEACHER",
    student_grade_snapshot: null,
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
      {
        name: "첫 참가자",
        organizationId: "org-1",
        role: "STUDENT",
        grade: "M1",
      },
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
  const targetProject = { id: target.id, revision: projectRevision };
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
