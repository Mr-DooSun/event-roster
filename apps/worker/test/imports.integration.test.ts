import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { commitImport } from "../src/services/imports";
import { authedRequest, seedManager } from "./support/admin";
import { authenticatedHeaders, resetAuthState } from "./support/auth";
import { setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("commits 130 valid normalized rows atomically", async () => {
  const fixture = await setupPreRegistration();
  const rows = Array.from({ length: 130 }, (_, index) => ({
    rowNumber: index + 2,
    name: `가져온 참가자 ${String(index + 1).padStart(3, "0")}`,
    organizationName: "1팀",
  }));
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows,
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  expect(response.status).toBe(201);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ? AND status = 'ACTIVE'",
      )
        .bind(fixture.event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(130);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM import_runs WHERE event_id = ?",
      )
        .bind(fixture.event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("leaves no rows when one organization is unknown", async () => {
  const fixture = await setupPreRegistration();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedEventRevision: fixture.event.revision,
        rows: [
          { rowNumber: 2, name: "정상", organizationName: "1팀" },
          { rowNumber: 3, name: "오류", organizationName: "없는 팀" },
        ],
      }),
    },
  );
  expect(response.status).toBe(422);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants WHERE name IN ('정상', '오류')",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    (
      await env.DB.prepare("SELECT COUNT(*) AS count FROM import_runs").first<{
        count: number;
      }>()
    )?.count,
  ).toBe(0);
});

it("requires PRE_REGISTRATION for validation and commit", async () => {
  const fixture = await setupPreRegistration();
  const dayOf = await authedRequest(
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
  expect(dayOf.status).toBe(200);
  const rows = [{ rowNumber: 2, name: "신규", organizationName: "1팀" }];
  const validation = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/validate`,
    { method: "POST", body: JSON.stringify(rows) },
  );
  expect(validation.status).toBe(409);
});

it("returns ambiguous candidates and commits only an explicitly selected candidate", async () => {
  const fixture = await setupPreRegistration();
  const duplicate = async () => {
    const response = await authedRequest(
      fixture.operator,
      "/api/v1/participants",
      {
        method: "POST",
        body: JSON.stringify({ name: "동명이인", organizationId: "org-1" }),
      },
    );
    return response.json<{ id: string }>();
  };
  const first = await duplicate();
  const second = await duplicate();
  const rows = [{ rowNumber: 2, name: "동명이인", organizationName: "1팀" }];
  const validation = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/validate`,
    { method: "POST", body: JSON.stringify(rows) },
  );
  const validationBody = await validation.json<{
    rows: Array<{
      issues: string[];
      candidates: Array<{ participantId: string }>;
    }>;
  }>();
  expect(validationBody.rows[0]).toMatchObject({
    issues: ["AMBIGUOUS_PARTICIPANT"],
  });
  expect(validationBody.rows[0]?.candidates).toHaveLength(2);

  const unresolved = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows,
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  expect(unresolved.status).toBe(422);

  const selectedRows = [{ ...rows[0], resolvedParticipantId: second.id }];
  const committed = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: selectedRows,
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  expect(committed.status).toBe(201);
  expect(
    (
      await env.DB.prepare(
        "SELECT participant_id FROM event_roster_entries WHERE event_id = ?",
      )
        .bind(fixture.event.id)
        .first<{ participant_id: string }>()
    )?.participant_id,
  ).toBe(second.id);
  expect(first.id).not.toBe(second.id);
});

it("rejects an invalid resolved candidate and a stale event revision", async () => {
  const fixture = await setupPreRegistration();
  const invalid = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [
          {
            rowNumber: 2,
            name: "첫 참가자",
            organizationName: "1팀",
            resolvedParticipantId: "missing-participant",
          },
        ],
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  expect(invalid.status).toBe(422);

  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [{ rowNumber: 2, name: "신규", organizationName: "1팀" }],
        expectedEventRevision: fixture.event.revision + 1,
      }),
    },
  );
  expect(stale.status).toBe(409);
});

it("treats an active selected participant as a no-op and reactivates a selected cancellation", async () => {
  const fixture = await setupPreRegistration();
  const added = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        expectedRevision: fixture.event.revision,
      }),
    },
  );
  const active = await added.json<{
    id: string;
    revision: number;
    eventRevision: number;
  }>();
  const row = {
    rowNumber: 2,
    name: "첫 참가자",
    organizationName: "1팀",
    resolvedParticipantId: fixture.firstParticipant.id,
  };
  const noOp = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [row],
        expectedEventRevision: active.eventRevision,
      }),
    },
  );
  expect(noOp.status).toBe(201);
  expect(
    (
      await env.DB.prepare(
        "SELECT revision FROM event_roster_entries WHERE id = ?",
      )
        .bind(active.id)
        .first<{ revision: number }>()
    )?.revision,
  ).toBe(active.revision);

  const imported = await noOp.json<{ eventRevision: number }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster/${active.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: imported.eventRevision,
        expectedEntryRevision: active.revision,
      }),
    },
  );
  const cancelledBody = await cancelled.json<{
    revision: number;
    eventRevision: number;
  }>();
  const reactivated = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [row],
        expectedEventRevision: cancelledBody.eventRevision,
      }),
    },
  );
  expect(reactivated.status).toBe(201);
  expect(
    await env.DB.prepare(
      "SELECT status, revision FROM event_roster_entries WHERE id = ?",
    )
      .bind(active.id)
      .first<{ status: string; revision: number }>(),
  ).toMatchObject({ status: "ACTIVE", revision: cancelledBody.revision + 1 });
});

it("forbids organization managers from import endpoints", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  const response = await authedRequest(
    manager,
    `/api/v1/events/${fixture.event.id}/imports/validate`,
    {
      method: "POST",
      body: JSON.stringify([
        { rowNumber: 2, name: "신규", organizationName: "1팀" },
      ]),
    },
  );
  expect(response.status).toBe(403);
});

it("rolls back when a same-name candidate appears after the set reads", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const raceDb = beforeNextBatch(async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('concurrent-person', 'P-CONCURRENT', '경쟁 참가자', 'org-1', 0, ?, ?)`,
    )
      .bind(now, now)
      .run();
  });

  await expect(
    commitImport(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.event.id,
      [{ rowNumber: 2, name: "경쟁 참가자", organizationName: "1팀" }],
      fixture.event.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ?",
      )
        .bind(fixture.event.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("rolls back when the resolved organization is renamed after the set reads", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const raceDb = beforeNextBatch(async () => {
    await env.DB.prepare(
      "UPDATE organizations SET name = '변경된 팀', canonical_name = '변경된 팀' WHERE id = 'org-1'",
    ).run();
  });

  await expect(
    commitImport(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.event.id,
      [{ rowNumber: 2, name: "조직 경쟁", organizationName: "1팀" }],
      fixture.event.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM participants WHERE name = '조직 경쟁'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("rolls back when a selected participant changes after the set reads", async () => {
  const fixture = await setupPreRegistration();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const raceDb = beforeNextBatch(async () => {
    await env.DB.prepare(
      "UPDATE participants SET name = '변경된 이름', revision = revision + 1 WHERE id = ?",
    )
      .bind(fixture.firstParticipant.id)
      .run();
  });

  await expect(
    commitImport(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.event.id,
      [
        {
          rowNumber: 2,
          name: "첫 참가자",
          organizationName: "1팀",
          resolvedParticipantId: fixture.firstParticipant.id,
        },
      ],
      fixture.event.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});

it("serializes import commit against the DAY_OF snapshot transition", async () => {
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
  const imported = authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [{ rowNumber: 2, name: "경쟁 입력", organizationName: "1팀" }],
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  const responses = await Promise.all([transition, imported]);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(
    1,
  );
  expect(
    responses.some(
      (response) => response.status === 200 || response.status === 201,
    ),
  ).toBe(true);

  const event = await env.DB.prepare("SELECT status FROM events WHERE id = ?")
    .bind(fixture.event.id)
    .first<{ status: string }>();
  const rosterCount = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM event_roster_entries WHERE event_id = ? AND status = 'ACTIVE'",
  )
    .bind(fixture.event.id)
    .first<{ count: number }>();
  const snapshotCount = await env.DB.prepare(
    "SELECT COALESCE(SUM(expected_count), 0) AS count FROM event_expected_snapshots WHERE event_id = ?",
  )
    .bind(fixture.event.id)
    .first<{ count: number }>();
  if (event?.status === "DAY_OF") {
    expect(snapshotCount?.count).toBe(rosterCount?.count);
  } else {
    expect(event?.status).toBe("PRE_REGISTRATION");
    expect(snapshotCount?.count).toBe(0);
  }
});

it("commits a case-insensitive match using the selected master name", async () => {
  const fixture = await setupPreRegistration();
  const created = await authedRequest(
    fixture.operator,
    "/api/v1/participants",
    {
      method: "POST",
      body: JSON.stringify({ name: "Alice", organizationId: "org-1" }),
    },
  );
  const participant = await created.json<{ id: string }>();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [{ rowNumber: 2, name: "alice", organizationName: "1팀" }],
        expectedEventRevision: fixture.event.revision,
      }),
    },
  );
  expect(response.status).toBe(201);
  expect(
    (
      await env.DB.prepare(
        "SELECT participant_id FROM event_roster_entries WHERE event_id = ?",
      )
        .bind(fixture.event.id)
        .first<{ participant_id: string }>()
    )?.participant_id,
  ).toBe(participant.id);
});

it("revalidates active no-op rows when organization state changes", async () => {
  const fixture = await setupPreRegistration();
  const added = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: fixture.firstParticipant.id,
        expectedRevision: fixture.event.revision,
      }),
    },
  );
  const active = await added.json<{ eventRevision: number }>();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const raceDb = beforeNextBatch(async () => {
    await env.DB.prepare(
      "UPDATE organizations SET is_active = 0 WHERE id = 'org-1'",
    ).run();
  });
  await expect(
    commitImport(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.event.id,
      [
        {
          rowNumber: 2,
          name: "첫 참가자",
          organizationName: "1팀",
          resolvedParticipantId: fixture.firstParticipant.id,
        },
      ],
      active.eventRevision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});

function beforeNextBatch(before: () => Promise<void>): D1Database {
  let pending = true;
  return {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await before();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;
}
