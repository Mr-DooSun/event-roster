import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("paginates event audit history with an opaque cursor", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  const first = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/audit-logs?limit=1`,
  );
  const firstPage = await first.json<{
    items: Array<{ action: string }>;
    nextCursor: string | null;
  }>();
  expect(first.status).toBe(200);
  expect(firstPage.items).toHaveLength(1);
  expect(firstPage.nextCursor).toBeTruthy();
  expect(firstPage.nextCursor).not.toContain(fixture.event.id);

  const second = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/audit-logs?limit=1&cursor=${encodeURIComponent(
      firstPage.nextCursor ?? "",
    )}`,
  );
  expect((await second.json<{ items: unknown[] }>()).items).toHaveLength(1);
});

it("rejects malformed audit cursors as validation errors", async () => {
  const fixture = await setupPreRegistration();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/audit-logs?cursor=not-a-cursor`,
  );
  expect(response.status).toBe(422);
  expect(await response.json<{ code: string }>()).toMatchObject({
    code: "VALIDATION_FAILED",
  });
});

it("allowlists audit details and never exposes credential-like fields", async () => {
  const fixture = await setupPreRegistration();
  await env.DB.prepare(
    `INSERT INTO audit_logs
     (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
     VALUES ('unsafe-audit', 'user-1', 'TEST', 'EVENT', ?,
             '2099-01-01T00:00:00.000Z', ?)`,
  )
    .bind(
      fixture.event.id,
      JSON.stringify({
        eventId: fixture.event.id,
        organizationId: "org-1",
        csrfToken: "must-not-leak",
        recoveryCode: "must-not-leak",
      }),
    )
    .run();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/audit-logs?limit=10`,
  );
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("must-not-leak");
});
