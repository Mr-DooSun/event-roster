import { authedRequest, seedOperator, seedOrganization } from "./admin";
import type { LoginResult } from "./auth";

export interface RosterFixture {
  operator: LoginResult;
  event: { id: string; revision: number; status: string };
  firstParticipant: { id: string; participantId: string };
  secondParticipant: { id: string; participantId: string };
}

export async function setupPreRegistration(): Promise<RosterFixture> {
  const operator = await seedOperator();
  await seedOrganization("org-1", "1팀");
  const createParticipant = async (name: string) => {
    const response = await authedRequest(operator, "/api/v1/participants", {
      method: "POST",
      body: JSON.stringify({ name, organizationId: "org-1" }),
    });
    return response.json<{ id: string; participantId: string }>();
  };
  const firstParticipant = await createParticipant("첫 참가자");
  const secondParticipant = await createParticipant("둘째 참가자");
  const created = await authedRequest(operator, "/api/v1/events", {
    method: "POST",
    body: JSON.stringify({ year: 2029, half: "H1", name: "2029 상반기 행사" }),
  });
  const draft = await created.json<{ id: string; revision: number }>();
  const transitioned = await authedRequest(
    operator,
    `/api/v1/events/${draft.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: draft.revision,
      }),
    },
  );
  const event = await transitioned.json<{
    id: string;
    revision: number;
    status: string;
  }>();
  return { operator, event, firstParticipant, secondParticipant };
}

export async function addRoster(
  fixture: RosterFixture,
  participantId: string,
  expectedRevision = fixture.event.revision,
) {
  return authedRequest(
    fixture.operator,
    `/api/v1/events/${fixture.event.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({ participantId, expectedRevision }),
    },
  );
}
