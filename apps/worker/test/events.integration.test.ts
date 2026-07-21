import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedOperator, seedOrganization } from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);

it("enforces unique half and approved revision-based transitions", async () => {
  const operator = await seedOperator();
  const create = () =>
    authedRequest(operator, "/api/v1/events", {
      method: "POST",
      body: JSON.stringify({
        year: 2026,
        half: "H1",
        name: "2026 상반기 행사",
      }),
    });
  const created = await create();
  const event = await created.json<{ id: string; revision: number }>();

  expect(created.status).toBe(201);
  expect((await create()).status).toBe(409);
  expect(
    (
      await authedRequest(operator, `/api/v1/events/${event.id}/transition`, {
        method: "POST",
        body: JSON.stringify({
          targetStatus: "DAY_OF",
          expectedRevision: event.revision,
        }),
      })
    ).status,
  ).toBe(409);
});

it("freezes expected snapshots on DAY_OF transition", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const created = await authedRequest(operator, "/api/v1/events", {
    method: "POST",
    body: JSON.stringify({ year: 2026, half: "H2", name: "2026 하반기 행사" }),
  });
  let event = await created.json<{ id: string; revision: number }>();
  const pre = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: event.revision,
      }),
    },
  );
  event = await pre.json<{ id: string; revision: number }>();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO participants (id, participant_id, name, organization_id, revision, created_at, updated_at) VALUES ('person-1', 'P-001', '홍길동', 'org-1', 0, '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')",
    ),
    env.DB.prepare(
      "INSERT INTO event_roster_entries (id, event_id, participant_id, organization_id, participant_name_snapshot, organization_name_snapshot, source, status, revision, created_by, updated_by, created_at, updated_at) VALUES ('entry-1', ?, 'person-1', 'org-1', '홍길동', '1팀', 'PRE_EVENT', 'ACTIVE', 0, 'user-1', 'user-1', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')",
    ).bind(event.id),
    env.DB.prepare("UPDATE organizations SET is_active = 0 WHERE id = 'org-1'"),
  ]);

  const dayOf = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: event.revision,
      }),
    },
  );
  expect(dayOf.status).toBe(200);
  const dayOfEvent = await dayOf.clone().json<{ revision: number }>();
  const snapshot = await env.DB.prepare(
    "SELECT expected_count FROM event_expected_snapshots WHERE event_id = ? AND organization_id = 'org-1'",
  )
    .bind(event.id)
    .first<{ expected_count: number }>();
  expect(snapshot?.expected_count).toBe(1);

  const closed = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "CLOSED",
        expectedRevision: dayOfEvent.revision,
      }),
    },
  );
  const closedEvent = await closed.json<{ revision: number }>();
  const reopened = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: closedEvent.revision,
      }),
    },
  );
  expect(reopened.status).toBe(200);
  expect(
    (
      await env.DB.prepare(
        "SELECT expected_count FROM event_expected_snapshots WHERE event_id = ? AND organization_id = 'org-1'",
      )
        .bind(event.id)
        .first<{ expected_count: number }>()
    )?.expected_count,
  ).toBe(1);
});

it("rejects a stale transition without writing snapshots", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const created = await authedRequest(operator, "/api/v1/events", {
    method: "POST",
    body: JSON.stringify({ year: 2027, half: "H1", name: "2027 상반기 행사" }),
  });
  const event = await created.json<{ id: string; revision: number }>();
  const pre = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: event.revision,
      }),
    },
  );
  expect(pre.status).toBe(200);
  const stale = await authedRequest(
    operator,
    `/api/v1/events/${event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: event.revision,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_expected_snapshots WHERE event_id = ?",
      )
        .bind(event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});
