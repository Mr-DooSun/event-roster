import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedManager, seedOrganization } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);

it("exports deterministic roster and complete summary arrays without auth fields", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  await env.DB.prepare(
    `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
     VALUES ('same-name', 'P-000', '첫 참가자', 'org-1', 0, ?, ?)`,
  )
    .bind("2026-07-21T00:00:00.000Z", "2026-07-21T00:00:00.000Z")
    .run();
  await env.DB.prepare(
    `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, source, status, was_expected_at_start, revision,
        created_by, updated_by, created_at, updated_at)
     VALUES ('same-entry', ?, 'same-name', 'org-1', '첫 참가자', '1팀',
             'PRE_REGISTRATION', 'ACTIVE', 0, 0, 'user-1', 'user-1', ?, ?)`,
  )
    .bind(
      fixture.project.id,
      "2026-07-21T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z",
    )
    .run();
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/exports/roster`,
  );
  const body = await response.json<{
    명단: Array<{ "고유 ID": string; 이름: string; "최종 수정": string }>;
    집계: Array<{ "진행 중 추가": number; "진행 중 취소": number }>;
  }>();
  expect(response.status).toBe(200);
  expect(body.명단.map((row) => row["고유 ID"])).toEqual([
    "P-000",
    fixture.firstParticipant.participantId,
  ]);
  expect(body.명단.every((row) => row["최종 수정"].length > 0)).toBe(true);
  expect(body.집계[0]).toMatchObject({
    "진행 중 추가": 0,
    "진행 중 취소": 0,
  });
  expect(JSON.stringify(body)).not.toMatch(/token|password|csrf|recovery/i);
});

it("limits export rows and summaries to an organization manager's scope", async () => {
  const fixture = await setupPreRegistration();
  await addRoster(fixture, fixture.firstParticipant.id);
  await seedOrganization("org-2", "2팀");
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('org-2-person', 'P-ORG2', '다른 조직원', 'org-2', 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES (?, 'org-2', 1, ?, 'user-1', 'user-1')`,
    ).bind(fixture.project.id, now),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, source, status, was_expected_at_start, revision,
        created_by, updated_by, created_at, updated_at)
       VALUES ('org-2-entry', ?, 'org-2-person', 'org-2', '다른 조직원', '2팀',
               'PRE_REGISTRATION', 'ACTIVE', 0, 0, 'user-1', 'user-1', ?, ?)`,
    ).bind(fixture.project.id, now, now),
  ]);
  const manager = await seedManager("org-1");
  const response = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/exports/roster`,
  );
  const body = await response.json<{
    명단: Array<{ 조직: string }>;
    집계: Array<{ 조직: string }>;
  }>();
  expect(response.status).toBe(200);
  expect(body.명단.map((row) => row.조직)).toEqual(["1팀"]);
  expect(body.집계.map((row) => row.조직)).toEqual(["1팀"]);
});
