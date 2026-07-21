import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);

it("limits organization managers to active linked organizations", async () => {
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  const manager = await seedManager("org-1");
  const own = await authedRequest(manager, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "김참가", organizationId: "org-1" }),
  });
  const other = await authedRequest(manager, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "이참가", organizationId: "org-2" }),
  });

  expect(own.status).toBe(201);
  expect(other.status).toBe(403);
});

it("rejects participant writes for inactive organizations", async () => {
  await seedOrganization("org-1", "1팀", false);
  const operator = await seedOperator();
  const response = await authedRequest(operator, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "김참가", organizationId: "org-1" }),
  });
  expect(response.status).toBe(409);
});

it("rejects moving a participant who is on a DAY_OF roster", async () => {
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  const operator = await seedOperator();
  const created = await authedRequest(operator, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "김참가", organizationId: "org-1" }),
  });
  const participant = await created.json<{ id: string; revision: number }>();
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events
       (id, year, half, name, status, revision, created_by, created_at, updated_at)
       VALUES ('event-day', 2026, 'H1', '행사', 'DAY_OF', 1, 'user-1', ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO event_roster_entries
       (id, event_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, source, status, revision, created_by, updated_by,
        created_at, updated_at)
       VALUES ('entry-day', 'event-day', ?, 'org-1', '김참가', '1팀',
               'PRE_EVENT', 'ACTIVE', 0,
               'user-1', 'user-1', ?, ?)`,
    ).bind(participant.id, now, now),
  ]);

  const moved = await authedRequest(
    operator,
    `/api/v1/participants/${participant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        organizationId: "org-2",
        expectedRevision: participant.revision,
      }),
    },
  );
  expect(moved.status).toBe(409);
});

it("updates open display snapshots but preserves closed history", async () => {
  await seedOrganization("org-1", "1팀");
  const operator = await seedOperator();
  const created = await authedRequest(operator, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "이전 이름", organizationId: "org-1" }),
  });
  const participant = await created.json<{ id: string; revision: number }>();
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events
       (id, year, half, name, status, revision, created_by, created_at, updated_at)
       VALUES ('event-open', 2028, 'H1', '진행 행사', 'DAY_OF', 1, 'user-1', ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO events
       (id, year, half, name, status, revision, created_by, created_at, updated_at)
       VALUES ('event-closed', 2028, 'H2', '종료 행사', 'CLOSED', 1, 'user-1', ?, ?)`,
    ).bind(now, now),
    ...["event-open", "event-closed"].map((eventId) =>
      env.DB.prepare(
        `INSERT INTO event_roster_entries
         (id, event_id, participant_id, organization_id, participant_name_snapshot,
          organization_name_snapshot, source, status, revision, created_by, updated_by,
          created_at, updated_at)
         VALUES (?, ?, ?, 'org-1', '이전 이름', '1팀', 'PRE_EVENT', 'ACTIVE', 0,
                 'user-1', 'user-1', ?, ?)`,
      ).bind(`entry-${eventId}`, eventId, participant.id, now, now),
    ),
  ]);

  const updated = await authedRequest(
    operator,
    `/api/v1/participants/${participant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "수정 이름",
        expectedRevision: participant.revision,
      }),
    },
  );
  expect(updated.status).toBe(200);
  const rows = (
    await env.DB.prepare(
      "SELECT event_id, participant_name_snapshot FROM event_roster_entries ORDER BY event_id",
    ).all<{ event_id: string; participant_name_snapshot: string }>()
  ).results;
  expect(rows).toEqual([
    { event_id: "event-closed", participant_name_snapshot: "이전 이름" },
    { event_id: "event-open", participant_name_snapshot: "수정 이름" },
  ]);
});
