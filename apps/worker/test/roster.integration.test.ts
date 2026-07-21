import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedManager, seedOrganization } from "./support/admin";
import { resetAuthState } from "./support/auth";
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
    eventRevision: number;
  }>();
  expect(added.status).toBe(201);
  expect(entry).toMatchObject({ source: "PRE_EVENT", status: "ACTIVE" });

  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster/${entry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: entry.eventRevision,
        expectedEntryRevision: entry.revision,
      }),
    },
  );
  const cancelledEntry = await cancelled.json<{
    revision: number;
    eventRevision: number;
  }>();
  expect(cancelled.status).toBe(200);

  const reactivated = await addRoster(
    {
      ...fixture,
      event: { ...fixture.event, revision: cancelledEntry.eventRevision },
    },
    fixture.firstParticipant.id,
  );
  expect(reactivated.status).toBe(200);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ?",
      )
        .bind(fixture.event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("rolls back roster and audit when the event revision is stale", async () => {
  const fixture = await setupPreRegistration();
  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs",
  ).first<{ count: number }>();
  const stale = await addRoster(
    fixture,
    fixture.firstParticipant.id,
    fixture.event.revision - 1,
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
    `/api/v1/events/${fixture.event.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        expectedRevision: fixture.event.revision,
      }),
    },
  );
  expect(forbidden.status).toBe(403);
});

it("rejects CLOSED mutations and allows audited DAY_OF additions after reopen", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const first = await added.json<{ eventRevision: number }>();
  const transition = async (targetStatus: string, expectedRevision: number) => {
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/events/${fixture.event.id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({ targetStatus, expectedRevision }),
      },
    );
    return response.json<{ revision: number }>();
  };
  const dayOf = await transition("DAY_OF", first.eventRevision);
  const closed = await transition("CLOSED", dayOf.revision);
  const rejected = await addRoster(
    { ...fixture, event: { ...fixture.event, revision: closed.revision } },
    fixture.secondParticipant.id,
  );
  expect(rejected.status).toBe(409);
  expect(await rejected.json<{ code: string }>()).toMatchObject({
    code: "EVENT_CLOSED",
  });

  const reopened = await transition("DAY_OF", closed.revision);
  const afterReopen = await addRoster(
    { ...fixture, event: { ...fixture.event, revision: reopened.revision } },
    fixture.secondParticipant.id,
  );
  expect(afterReopen.status).toBe(201);
  expect(await afterReopen.json<{ source: string }>()).toMatchObject({
    source: "DAY_OF",
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT expected_count FROM event_expected_snapshots WHERE event_id = ? AND organization_id = 'org-1'",
      )
        .bind(fixture.event.id)
        .first<{ expected_count: number }>()
    )?.expected_count,
  ).toBe(1);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action = 'EVENT_REOPENED' AND entity_id = ?`,
      )
        .bind(fixture.event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("forbids organization managers from DAY_OF roster mutations", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: fixture.event.revision,
      }),
    },
  );
  const dayOf = await transitioned.json<{ revision: number }>();
  const forbidden = await authedRequest(
    manager,
    `/api/v1/events/${fixture.event.id}/roster`,
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

it("serializes a PRE_EVENT add against the DAY_OF snapshot transition", async () => {
  const fixture = await setupPreRegistration();
  const transition = authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: fixture.event.revision,
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
  const event = await env.DB.prepare("SELECT status FROM events WHERE id = ?")
    .bind(fixture.event.id)
    .first<{ status: string }>();
  const roster = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ? AND status = 'ACTIVE'",
  )
    .bind(fixture.event.id)
    .first<{ count: number }>();
  const snapshot = await env.DB.prepare(
    "SELECT COALESCE(SUM(expected_count), 0) AS count FROM event_expected_snapshots WHERE event_id = ?",
  )
    .bind(fixture.event.id)
    .first<{ count: number }>();
  if (event?.status === "DAY_OF") {
    expect(snapshot?.count).toBe(roster?.count);
  } else {
    expect(event?.status).toBe("PRE_REGISTRATION");
    expect(snapshot?.count).toBe(0);
  }
});
