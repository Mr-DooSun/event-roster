import { beforeEach, expect, it } from "vitest";
import { authedRequest } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("uses the current active pre-event roster as expected before DAY_OF", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
  });
});

it("counts pre-event cancellation and day-of addition independently", async () => {
  const fixture = await setupPreRegistration();
  const preResponse = await addRoster(fixture, fixture.firstParticipant.id);
  const preEntry = await preResponse.json<{
    id: string;
    revision: number;
    eventRevision: number;
  }>();
  const dayOfResponse = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: preEntry.eventRevision,
      }),
    },
  );
  const dayOf = await dayOfResponse.json<{ revision: number }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster/${preEntry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: dayOf.revision,
        expectedEntryRevision: preEntry.revision,
      }),
    },
  );
  const afterCancel = await cancelled.json<{ eventRevision: number }>();
  await addRoster(
    {
      ...fixture,
      event: { ...fixture.event, revision: afterCancel.eventRevision },
    },
    fixture.secondParticipant.id,
  );

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
    organizations: [
      { expected: 1, dayOfAdded: 1, dayOfCancelled: 1, final: 1, delta: 0 },
    ],
  });
});

it("counts a pre-event row reactivated after DAY_OF as a day-of addition", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    revision: number;
    eventRevision: number;
  }>();
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
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "DAY_OF",
        expectedRevision: cancelledEntry.eventRevision,
      }),
    },
  );
  const dayOf = await transitioned.json<{ revision: number }>();
  const reactivated = await addRoster(
    { ...fixture, event: { ...fixture.event, revision: dayOf.revision } },
    fixture.firstParticipant.id,
  );
  expect(await reactivated.json<{ source: string }>()).toMatchObject({
    source: "DAY_OF",
  });

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 0,
    finalTotal: 1,
    deltaTotal: 1,
    organizations: [{ dayOfAdded: 1, dayOfCancelled: 0 }],
  });
});
