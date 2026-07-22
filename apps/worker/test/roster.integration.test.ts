import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { addRosterEntry } from "../src/services/roster";
import { authedRequest, seedManager, seedOrganization } from "./support/admin";
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

it("rejects a manager writing another organization roster", async () => {
  const fixture = await setupPreRegistration();
  await seedOrganization("org-2", "2팀");
  const manager = await seedManager("org-2");
  const forbidden = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        expectedRevision: fixture.project.revision,
      }),
    },
  );
  expect(forbidden.status).toBe(403);
});

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
        expectedRevision: dayOf.revision,
      }),
    },
  );
  expect(forbidden.status).toBe(403);
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
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(deactivated.status).toBe(200);

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
