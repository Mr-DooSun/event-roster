import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { updateProjectParticipant } from "../src/services/participants";
import {
  authedRequest,
  seedManager,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { authenticatedHeaders, resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);
afterEach(async () => {
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL`,
  ).run();
});

async function markProjectDeleted(
  projectId: string,
  actorId: string,
  revision: number,
) {
  const timestamp = "2026-07-29T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE projects
     SET status = 'CLOSED', revision = ?, updated_at = ?,
         closed_at = ?, closed_by = ?, close_reason = 'MANUAL',
         deleted_at = ?, deleted_by = ?, deleted_revision = ?
     WHERE id = ?`,
  )
    .bind(
      revision + 1,
      timestamp,
      timestamp,
      actorId,
      timestamp,
      actorId,
      revision + 1,
      projectId,
    )
    .run();
}

it("rejects participant changes after the project is deleted", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  await markProjectDeleted(
    fixture.project.id,
    fixture.operator.userId,
    entry.projectRevision,
  );

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "삭제 후 변경",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: entry.projectRevision + 1,
      }),
    },
  );
  expect(response.status).toBe(404);
});

it("keeps ordinary participant edits blocked after a project is closed", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  const inProgress = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "IN_PROGRESS",
        expectedRevision: entry.projectRevision,
      }),
    },
  );
  const inProgressProject = await inProgress.json<{ revision: number }>();
  const closed = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "CLOSED",
        expectedRevision: inProgressProject.revision,
      }),
    },
  );
  const closedProject = await closed.json<{ revision: number }>();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "종료 뒤 일반 수정 금지",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: closedProject.revision,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "PROJECT_CLOSED" });
  expect(
    await env.DB.prepare("SELECT name, revision FROM participants WHERE id = ?")
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "첫 참가자", revision: 0 });
});

it("keeps global participants read-only", async () => {
  const fixture = await setupPreRegistration();
  const list = await authedRequest(fixture.operator, "/api/v1/participants");
  expect(list.status).toBe(200);
  expect(await list.json<Array<{ id: string }>>()).toHaveLength(2);

  const create = await authedRequest(fixture.operator, "/api/v1/participants", {
    method: "POST",
    body: JSON.stringify({ name: "전역 생성 금지", organizationId: "org-1" }),
  });
  const update = await authedRequest(
    fixture.operator,
    `/api/v1/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "전역 수정 금지", expectedRevision: 0 }),
    },
  );
  expect(create.status).toBe(404);
  expect(update.status).toBe(404);
});

it("hides inactive and deleted organization participants from the operator selection list", async () => {
  const fixture = await setupPreRegistration();
  await seedOrganization("org-inactive", "비활성 참가자 조직", false);
  await seedOrganization("org-deleted", "삭제 참가자 조직");
  const changedAt = "2026-08-03T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('inactive-participant', 'P-INACTIVE', '비활성 참가자',
               'org-inactive', 0, ?, ?)`,
    ).bind(changedAt, changedAt),
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('deleted-participant', 'P-DELETED', '삭제 참가자',
               'org-deleted', 0, ?, ?)`,
    ).bind(changedAt, changedAt),
    env.DB.prepare(
      `UPDATE organizations
       SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
       WHERE id = 'org-deleted'`,
    ).bind(changedAt, fixture.operator.userId, changedAt),
  ]);

  const response = await authedRequest(
    fixture.operator,
    "/api/v1/participants",
  );

  expect(response.status).toBe(200);
  expect(
    (await response.json<Array<{ participantId: string }>>())
      .map(({ participantId }) => participantId)
      .sort(),
  ).toEqual(["P-FIRST", "P-SECOND"]);
});

it("rejects moving a participant into a deleted organization", async () => {
  const fixture = await setupPreRegistration();
  const roster = await addRoster(fixture, fixture.firstParticipant.id);
  const rosterBody = await roster.json<{ projectRevision: number }>();
  const target = await seedOrganization("org-2", "삭제 대상 조직");
  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: target.id,
        expectedProjectRevision: rosterBody.projectRevision,
      }),
    },
  );
  const linkedBody = await linked.json<{ projectRevision: number }>();
  const deletedAt = "2026-08-03T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(deletedAt, fixture.operator.userId, deletedAt, target.id)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        organizationId: target.id,
        role: "STUDENT",
        grade: "M2",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: linkedBody.projectRevision,
      }),
    },
  );

  expect(response.status).toBe(422);
  expect(
    await env.DB.prepare(
      `SELECT organization_id, revision FROM participants WHERE id = ?`,
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ organization_id: "org-1", revision: 0 });
});

it.each(["INACTIVE", "DELETED"] as const)(
  "rejects editing a participant whose current organization is %s",
  async (organizationState) => {
    const fixture = await setupPreRegistration();
    const added = await addRoster(fixture, fixture.firstParticipant.id);
    const entry = await added.json<{ projectRevision: number }>();
    const changedAt = "2026-08-03T00:00:00.000Z";
    if (organizationState === "DELETED") {
      await env.DB.prepare(
        `UPDATE organizations
         SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
         WHERE id = 'org-1'`,
      )
        .bind(changedAt, fixture.operator.userId, changedAt)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE organizations SET is_active = 0, updated_at = ?
         WHERE id = 'org-1'`,
      )
        .bind(changedAt)
        .run();
    }

    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "차단되어야 할 수정",
          expectedRevision: fixture.firstParticipant.revision,
          expectedProjectRevision: entry.projectRevision,
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(
      await env.DB.prepare(
        `SELECT name, revision FROM participants WHERE id = ?`,
      )
        .bind(fixture.firstParticipant.id)
        .first(),
    ).toEqual({ name: "첫 참가자", revision: 0 });
  },
);

it("rejects moving a participant from a deleted organization into an active organization", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  const target = await seedOrganization("org-2", "활성 이동 대상");
  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: target.id,
        expectedProjectRevision: entry.projectRevision,
      }),
    },
  );
  const linkedBody = await linked.json<{ projectRevision: number }>();
  const changedAt = "2026-08-03T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
     WHERE id = 'org-1'`,
  )
    .bind(changedAt, fixture.operator.userId, changedAt)
    .run();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        organizationId: target.id,
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: linkedBody.projectRevision,
      }),
    },
  );

  expect(response.status).toBe(422);
  expect(
    await env.DB.prepare(
      `SELECT organization_id, revision FROM participants WHERE id = ?`,
    )
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ organization_id: "org-1", revision: 0 });
});

it("rechecks source organization deletion atomically before participant update", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        const changedAt = "2026-08-03T00:00:00.000Z";
        await env.DB.prepare(
          `UPDATE organizations
           SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
           WHERE id = 'org-1'`,
        )
          .bind(changedAt, fixture.operator.userId, changedAt)
          .run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    updateProjectParticipant(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.project.id,
      fixture.firstParticipant.id,
      {
        name: "경합 수정 차단",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: entry.projectRevision,
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    await env.DB.prepare(`SELECT name, revision FROM participants WHERE id = ?`)
      .bind(fixture.firstParticipant.id)
      .first(),
  ).toEqual({ name: "첫 참가자", revision: 0 });
});

it("returns the newest roster profile as a suggestion without writing the master", async () => {
  const fixture = await setupPreRegistration();
  const newestProject = await seedProject(fixture.operator, {
    name: "최신 추천 프로젝트",
  });
  const now = "2026-07-28T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
       VALUES ('suggestion-old', ?, ?, 'org-1', '첫 참가자', '1팀',
               'STUDENT', 'M2', 'PRE_REGISTRATION', 'ACTIVE',
               0, 0, ?, ?, '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')`,
    ).bind(
      newestProject.id,
      fixture.firstParticipant.id,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
       VALUES ('suggestion-new', ?, ?, 'org-1', '첫 참가자', '1팀',
               'TEACHER', NULL, 'PRE_REGISTRATION', 'ACTIVE',
               0, 0, ?, ?, ?, ?)`,
    ).bind(
      fixture.project.id,
      fixture.firstParticipant.id,
      fixture.operator.userId,
      fixture.operator.userId,
      now,
      now,
    ),
  ]);

  const response = await authedRequest(
    fixture.operator,
    "/api/v1/participants",
  );
  expect(response.status).toBe(200);
  const participants =
    await response.json<
      Array<{
        participantId: string;
        suggestedRole: string | null;
        suggestedGrade: string | null;
      }>
    >();
  expect(
    participants.find((item) => item.participantId === "P-FIRST"),
  ).toMatchObject({ suggestedRole: "TEACHER", suggestedGrade: null });
  expect(
    participants.find((item) => item.participantId === "P-SECOND"),
  ).toMatchObject({ suggestedRole: null, suggestedGrade: null });
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM participants
       WHERE id = ? AND name = '첫 참가자' AND revision = 0`,
    )
      .bind(fixture.firstParticipant.id)
      .first<{ count: number }>(),
  ).toEqual({ count: 1 });
});

it("never suggests a roster profile outside an organization manager scope", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");
  await seedOrganization("org-2", "2팀");
  const outOfScopeProject = await seedProject(fixture.operator, {
    name: "범위 밖 추천 프로젝트",
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
       VALUES ('manager-suggestion-in-scope', ?, ?, 'org-1', '첫 참가자', '1팀',
               'STUDENT', 'M3', 'PRE_REGISTRATION', 'ACTIVE',
               0, 0, ?, ?, '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z')`,
    ).bind(
      outOfScopeProject.id,
      fixture.firstParticipant.id,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
       VALUES ('manager-suggestion-out-of-scope', ?, ?, 'org-2', '첫 참가자', '2팀',
               'TEACHER', NULL, 'PRE_REGISTRATION', 'ACTIVE',
               0, 0, ?, ?, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`,
    ).bind(
      fixture.project.id,
      fixture.firstParticipant.id,
      fixture.operator.userId,
      fixture.operator.userId,
    ),
  ]);

  const response = await authedRequest(manager, "/api/v1/participants");
  expect(response.status).toBe(200);
  const participants =
    await response.json<
      Array<{
        participantId: string;
        suggestedRole: string | null;
        suggestedGrade: string | null;
      }>
    >();
  expect(
    participants.find((item) => item.participantId === "P-FIRST"),
  ).toMatchObject({ suggestedRole: "STUDENT", suggestedGrade: "M3" });
});

it("updates only the current project snapshot and replaces its legacy profile", async () => {
  const fixture = await setupPreRegistration();
  const secondOrganization = await seedOrganization("org-2", "2팀");
  const otherProject = await seedProject(fixture.operator, {
    name: "다른 프로젝트",
  });
  let fixtureProjectRevision = fixture.project.revision;
  for (const [projectId, organizationId, expectedProjectRevision] of [
    [fixture.project.id, secondOrganization.id, fixture.project.revision],
    [otherProject.id, "org-1", otherProject.revision],
  ]) {
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${projectId}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId, expectedProjectRevision }),
      },
    );
    expect(linked.status).toBe(201);
    const linkedBody = await linked.json<{ projectRevision: number }>();
    if (projectId === fixture.project.id) {
      fixtureProjectRevision = linkedBody.projectRevision;
    }
  }
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.batch(
    [fixture.project.id, otherProject.id].map((projectId, index) =>
      env.DB.prepare(
        `INSERT INTO project_roster_entries
         (id, project_id, participant_id, organization_id,
          participant_name_snapshot, organization_name_snapshot, source, status,
          was_expected_at_start, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'org-1', '첫 참가자', '1팀', 'PRE_REGISTRATION',
                 'ACTIVE', 0, 0, 'user-1', 'user-1', ?, ?)`,
      ).bind(
        `entry-${index}`,
        projectId,
        fixture.firstParticipant.id,
        now,
        now,
      ),
    ),
  );

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "수정 참가자",
        organizationId: secondOrganization.id,
        role: "STUDENT",
        grade: "H2",
        expectedRevision: fixture.firstParticipant.revision,
        expectedProjectRevision: fixtureProjectRevision,
      }),
    },
  );
  expect(response.status).toBe(200);
  const updatedBody = await response.json<{
    name: string;
    organizationId: string;
    role: string | null;
    grade: string | null;
    suggestedRole?: string | null;
    suggestedGrade?: string | null;
  }>();
  expect(updatedBody).toMatchObject({
    name: "수정 참가자",
    organizationId: secondOrganization.id,
    role: "STUDENT",
    grade: "H2",
  });
  expect(updatedBody).not.toHaveProperty("suggestedRole");
  expect(updatedBody).not.toHaveProperty("suggestedGrade");
  const master = await env.DB.prepare(
    "SELECT name, organization_id FROM participants WHERE id=?",
  )
    .bind(fixture.firstParticipant.id)
    .first<{ name: string; organization_id: string }>();
  const snapshots = (
    await env.DB.prepare(
      `SELECT project_id, participant_name_snapshot, organization_id,
              organization_name_snapshot, participant_role_snapshot,
              student_grade_snapshot
       FROM project_roster_entries WHERE participant_id=? ORDER BY project_id`,
    )
      .bind(fixture.firstParticipant.id)
      .all<{
        project_id: string;
        participant_name_snapshot: string;
        organization_id: string;
        organization_name_snapshot: string;
        participant_role_snapshot: string | null;
        student_grade_snapshot: string | null;
      }>()
  ).results;
  expect(master).toEqual({
    name: "수정 참가자",
    organization_id: secondOrganization.id,
  });
  expect(snapshots).toEqual(
    [
      {
        project_id: otherProject.id,
        participant_name_snapshot: "첫 참가자",
        organization_id: "org-1",
        organization_name_snapshot: "1팀",
        participant_role_snapshot: null,
        student_grade_snapshot: null,
      },
      {
        project_id: fixture.project.id,
        participant_name_snapshot: "수정 참가자",
        organization_id: secondOrganization.id,
        organization_name_snapshot: "2팀",
        participant_role_snapshot: "STUDENT",
        student_grade_snapshot: "H2",
      },
    ].sort((left, right) => left.project_id.localeCompare(right.project_id)),
  );
  const audit = await env.DB.prepare(
    `SELECT details_json FROM audit_logs
     WHERE action = 'PARTICIPANT_UPDATED' AND entity_id = ?
     ORDER BY occurred_at DESC, id DESC LIMIT 1`,
  )
    .bind(fixture.firstParticipant.id)
    .first<{ details_json: string }>();
  expect(JSON.parse(audit?.details_json ?? "{}")).toMatchObject({
    before: { role: null, grade: null },
    after: { role: "STUDENT", grade: "H2" },
  });
});

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "prevents a %s from editing a moved participant master outside its scope",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    await seedOrganization("org-2", "2팀");
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedProjectRevision: fixture.project.revision,
        }),
      },
    );
    const linkedBody = await linked.json<{ projectRevision: number }>();
    const added = await addRoster(
      fixture,
      fixture.firstParticipant.id,
      linkedBody.projectRevision,
    );
    const entry = await added.json<{ projectRevision: number }>();
    const moved = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedRevision: fixture.firstParticipant.revision,
          expectedProjectRevision: entry.projectRevision,
        }),
      },
    );
    const movedParticipant = await moved.json<{
      revision: number;
      projectRevision: number;
    }>();
    const manager = await seedManager("org-1");
    await env.DB.prepare(
      `UPDATE user_organizations
       SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-1'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();
    const response = await authedRequest(
      manager,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "권한 밖 변경",
          expectedRevision: movedParticipant.revision,
          expectedProjectRevision: movedParticipant.projectRevision,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(
      (
        await env.DB.prepare("SELECT name FROM participants WHERE id=?")
          .bind(fixture.firstParticipant.id)
          .first<{ name: string }>()
      )?.name,
    ).toBe("첫 참가자");
  },
);

it.each(["PRIMARY_LEADER", "MANAGER"] as const)(
  "allows a %s scoped to both snapshot and master organizations to edit a moved participant",
  async (assignmentRole) => {
    const fixture = await setupPreRegistration();
    await seedOrganization("org-2", "2팀");
    const linked = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedProjectRevision: fixture.project.revision,
        }),
      },
    );
    const linkedBody = await linked.json<{ projectRevision: number }>();
    const added = await addRoster(
      fixture,
      fixture.firstParticipant.id,
      linkedBody.projectRevision,
    );
    const entry = await added.json<{ projectRevision: number }>();
    const moved = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: "org-2",
          expectedRevision: fixture.firstParticipant.revision,
          expectedProjectRevision: entry.projectRevision,
        }),
      },
    );
    const movedParticipant = await moved.json<{
      revision: number;
      projectRevision: number;
    }>();
    const manager = await seedManager("org-1");
    await env.DB.prepare(
      `UPDATE user_organizations SET assignment_role = ?
       WHERE user_id = ? AND organization_id = 'org-1'`,
    )
      .bind(assignmentRole, manager.userId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES ('manager-user', 'org-2', ?, NULL, '2026-07-23T00:00:00.000Z')`,
    )
      .bind(assignmentRole)
      .run();

    const response = await authedRequest(
      manager,
      `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "양쪽 범위 변경",
          expectedRevision: movedParticipant.revision,
          expectedProjectRevision: movedParticipant.projectRevision,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      (
        await env.DB.prepare("SELECT name FROM participants WHERE id=?")
          .bind(fixture.firstParticipant.id)
          .first<{ name: string }>()
      )?.name,
    ).toBe("양쪽 범위 변경");
  },
);

it("makes participant history read-only for a manager after membership deactivation while the operator can edit", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const entry = await added.json<{ projectRevision: number }>();
  const deactivated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/organizations/org-1`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: entry.projectRevision,
      }),
    },
  );
  const deactivatedBody = await deactivated.json<{ projectRevision: number }>();
  const manager = await seedManager("org-1");
  const managerPatch = await authedRequest(
    manager,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "관리자 변경 금지",
        expectedRevision: 0,
        expectedProjectRevision: deactivatedBody.projectRevision,
      }),
    },
  );
  expect(managerPatch.status).toBe(403);
  const operatorPatch = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "운영자 변경 허용",
        expectedRevision: 0,
        expectedProjectRevision: deactivatedBody.projectRevision,
      }),
    },
  );
  expect(operatorPatch.status).toBe(200);
});
