import { beforeEach, expect, it } from "vitest";
import { authedRequest } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("uses the current active pre-registration roster as expected before IN_PROGRESS", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
  });
});

it("counts pre-registration cancellation and in-progress addition independently", async () => {
  const fixture = await setupPreRegistration();
  const preResponse = await addRoster(fixture, fixture.firstParticipant.id);
  const preEntry = await preResponse.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const inProgressResponse = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: preEntry.projectRevision,
      }),
    },
  );
  const inProgress = await inProgressResponse.json<{ revision: number }>();
  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${preEntry.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: inProgress.revision,
        expectedEntryRevision: preEntry.revision,
      }),
    },
  );
  const afterCancel = await cancelled.json<{ projectRevision: number }>();
  await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: afterCancel.projectRevision,
      },
    },
    fixture.secondParticipant.id,
  );

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 1,
    finalTotal: 1,
    deltaTotal: 0,
    organizations: [
      {
        expected: 1,
        inProgressAdded: 1,
        inProgressCancelled: 1,
        final: 1,
        delta: 0,
      },
    ],
  });
});

it("counts a pre-registration row reactivated after IN_PROGRESS as an in-progress addition", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
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
  const transitioned = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: cancelledEntry.projectRevision,
      }),
    },
  );
  const inProgress = await transitioned.json<{ revision: number }>();
  const reactivated = await addRoster(
    {
      ...fixture,
      project: { ...fixture.project, revision: inProgress.revision },
    },
    fixture.firstParticipant.id,
  );
  expect(await reactivated.json<{ source: string }>()).toMatchObject({
    source: "IN_PROGRESS",
  });

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 0,
    finalTotal: 1,
    deltaTotal: 1,
    organizations: [{ inProgressAdded: 1, inProgressCancelled: 0 }],
  });
});
