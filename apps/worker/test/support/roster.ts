import { env } from "cloudflare:workers";
import type { SeededLogin } from "./admin";
import {
  authedRequest,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./admin";

export interface RosterFixture {
  operator: SeededLogin;
  project: { id: string; revision: number; status: string };
  firstParticipant: { id: string; participantId: string; revision: number };
  secondParticipant: { id: string; participantId: string; revision: number };
}

export async function setupPreRegistration(): Promise<RosterFixture> {
  const operator = await seedOperator();
  const organization = await seedOrganization("org-1", "1팀");
  const project = await seedProject(operator, { name: "테스트 프로젝트" });
  const linkResponse = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: organization.id,
        expectedProjectRevision: project.revision,
      }),
    },
  );
  if (!linkResponse.ok) {
    throw new Error(`link organization failed: ${linkResponse.status}`);
  }
  const linked = await linkResponse.json<{ projectRevision: number }>();
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('participant-1', 'P-FIRST', '첫 참가자', 'org-1', 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('participant-2', 'P-SECOND', '둘째 참가자', 'org-1', 0, ?, ?)`,
    ).bind(now, now),
  ]);
  const transitioned = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: linked.projectRevision,
      }),
    },
  );
  return {
    operator,
    project: await transitioned.json<{
      id: string;
      revision: number;
      status: string;
    }>(),
    firstParticipant: {
      id: "participant-1",
      participantId: "P-FIRST",
      revision: 0,
    },
    secondParticipant: {
      id: "participant-2",
      participantId: "P-SECOND",
      revision: 0,
    },
  };
}

export async function addRoster(
  fixture: RosterFixture,
  participantId: string,
  expectedRevision = fixture.project.revision,
) {
  const participant = await env.DB.prepare(
    "SELECT name, organization_id, revision FROM participants WHERE id = ?",
  )
    .bind(participantId)
    .first<{ name: string; organization_id: string; revision: number }>();
  if (!participant) throw new Error(`participant not found: ${participantId}`);
  return authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId,
        confirmedParticipant: {
          name: participant.name,
          organizationId: participant.organization_id,
        },
        expectedParticipantRevision: participant.revision,
        expectedRevision,
      }),
    },
  );
}
