import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { correctClosedProjectRoster } from "../src/services/history-corrections";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import {
  apiRequest,
  authenticatedHeaders,
  login,
  resetAuthState,
  seedUser,
} from "./support/auth";

beforeEach(resetAuthState);
afterEach(async () => {
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL`,
  ).run();
});

it("returns every master candidate only to an administrative operator for a closed project", async () => {
  const fixture = await seedCorrectionCandidates();

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    organizations: [
      {
        id: "org-active",
        name: "가동 조직",
        isActive: true,
        isDeleted: false,
      },
      {
        id: "org-inactive",
        name: "나중 비활성 조직",
        isActive: false,
        isDeleted: false,
      },
      {
        id: "org-deleted",
        name: "다음 삭제 조직",
        isActive: false,
        isDeleted: true,
      },
    ],
    participants: [
      {
        id: "active-participant",
        participantId: "P-ACTIVE",
        name: "가동 참가자",
        organizationId: "org-active",
        revision: 2,
        suggestedRole: "TEACHER",
        suggestedGrade: null,
      },
      {
        id: "inactive-participant",
        participantId: "P-INACTIVE",
        name: "나중 참가자",
        organizationId: "org-inactive",
        revision: 0,
        suggestedRole: null,
        suggestedGrade: null,
      },
      {
        id: "deleted-participant",
        participantId: "P-DELETED",
        name: "다음 참가자",
        organizationId: "org-deleted",
        revision: 1,
        suggestedRole: null,
        suggestedGrade: null,
      },
    ],
  });

  const managerProjectsBefore = await managerProjectIds(fixture.manager);
  const managerParticipantsBefore = await managerParticipantIds(
    fixture.manager,
  );

  expect(
    (
      await authedRequest(
        fixture.manager,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await authedRequest(
        fixture.bootstrap,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await apiRequest(
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/candidates`,
      )
    ).status,
  ).toBe(401);

  const open = await authedRequest(
    fixture.operator,
    "/api/v1/projects/project-open/history-corrections/candidates",
  );
  expect(open.status).toBe(409);
  expect(await open.json()).toMatchObject({ code: "INVALID_TRANSITION" });

  const deleted = await authedRequest(
    fixture.operator,
    "/api/v1/projects/project-deleted/history-corrections/candidates",
  );
  expect(deleted.status).toBe(404);

  expect(await managerProjectIds(fixture.manager)).toEqual(
    managerProjectsBefore,
  );
  expect(await managerParticipantIds(fixture.manager)).toEqual(
    managerParticipantsBefore,
  );
});

it("links active, inactive, deleted, and newly created organizations to a closed project without mutating existing masters", async () => {
  const fixture = await seedCorrectionCandidates();
  await seedOrganization("org-later-active", "나중 가동 조직");
  const masterStates = await organizationStates([
    "org-later-active",
    "org-inactive",
    "org-deleted",
  ]);
  const projectBefore = await closedProjectState(fixture.closedProjectId);

  let revision = projectBefore.revision;
  for (const organizationId of [
    "org-later-active",
    "org-inactive",
    "org-deleted",
  ]) {
    const response = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          expectedProjectRevision: revision,
        }),
      },
    );
    expect(response.status).toBe(201);
    revision = (await response.json<{ projectRevision: number }>())
      .projectRevision;
  }

  const create = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        newOrganizationName: "종료 후 신규 조직",
        expectedProjectRevision: revision,
      }),
    },
  );
  expect(create.status).toBe(201);
  const created = await create.json<{
    organization: { organizationId: string; isActive: boolean };
    projectRevision: number;
  }>();
  expect(created.organization).toMatchObject({ isActive: true });
  expect(created.projectRevision).toBe(revision + 1);

  expect(
    await organizationStates([
      "org-later-active",
      "org-inactive",
      "org-deleted",
    ]),
  ).toEqual(masterStates);
  expect(await closedProjectState(fixture.closedProjectId)).toEqual({
    ...projectBefore,
    revision: projectBefore.revision + 4,
  });
  expect(
    await env.DB.prepare(
      `SELECT is_active, deleted_at FROM organizations WHERE id = ?`,
    )
      .bind(created.organization.organizationId)
      .first(),
  ).toEqual({ is_active: 1, deleted_at: null });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual([
    expect.objectContaining({
      organizationId: "org-later-active",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: "org-inactive",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: "org-deleted",
      operation: "ADDED",
      before: null,
      after: { isActive: true },
    }),
    expect.objectContaining({
      organizationId: created.organization.organizationId,
      operation: "CREATED_AND_ADDED",
      before: null,
      after: { isActive: true },
    }),
  ]);
});

it("soft-excludes an empty closed-project membership and reactivates its composite-key row", async () => {
  const fixture = await seedCorrectionCandidates();
  await seedOrganization("org-empty", "빈 조직");

  const added = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-empty",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(added.status).toBe(201);
  const addedBody = await added.json<{ projectRevision: number }>();
  const excluded = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations/org-empty`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: addedBody.projectRevision,
      }),
    },
  );
  expect(excluded.status).toBe(200);
  const excludedBody = await excluded.json<{ projectRevision: number }>();
  expect(
    await env.DB.prepare(
      `SELECT is_active, deactivated_at FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first(),
  ).toMatchObject({ is_active: 0 });

  const reactivated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations/org-empty`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: true,
        expectedProjectRevision: excludedBody.projectRevision,
      }),
    },
  );
  expect(reactivated.status).toBe(200);
  expect(await reactivated.json()).toMatchObject({
    organization: { organizationId: "org-empty", isActive: true },
    projectRevision: excludedBody.projectRevision + 1,
  });
  expect(
    await env.DB.prepare(
      `SELECT is_active, deactivated_at FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first(),
  ).toEqual({ is_active: 1, deactivated_at: null });
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM project_organizations
       WHERE project_id = ? AND organization_id = 'org-empty'`,
    )
      .bind(fixture.closedProjectId)
      .first<{ count: number }>(),
  ).toEqual({ count: 1 });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        organizationId: "org-empty",
        operation: "EXCLUDED",
        before: { isActive: true },
        after: { isActive: false },
      }),
      expect.objectContaining({
        organizationId: "org-empty",
        operation: "REACTIVATED",
        before: { isActive: false },
        after: { isActive: true },
      }),
    ]),
  );
});

it("does not grant inactive or deleted organization managers visibility or correction access, and serializes same-revision corrections", async () => {
  const fixture = await seedCorrectionCandidates();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM user_organizations
       WHERE user_id = ? AND organization_id = 'org-active'`,
    ).bind(fixture.manager.userId),
    env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES (?, 'org-inactive', 'MANAGER', ?, ?)`,
    ).bind(
      fixture.manager.userId,
      fixture.operator.userId,
      "2026-08-05T00:00:00.000Z",
    ),
  ]);
  const inactiveLink = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-inactive",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(inactiveLink.status).toBe(201);
  expect(await managerProjectIds(fixture.manager)).not.toContain(
    fixture.closedProjectId,
  );
  expect(
    (
      await authedRequest(
        fixture.manager,
        `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: "org-deleted",
            expectedProjectRevision: 4,
          }),
        },
      )
    ).status,
  ).toBe(403);

  await seedOrganization("org-race", "경합 조직");
  const request = () =>
    authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-race",
          expectedProjectRevision: 4,
        }),
      },
    );
  const responses = await Promise.all([request(), request()]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const conflict = responses.find((response) => response.status === 409);
  expect(await conflict?.json()).toMatchObject({ code: "STALE_REVISION" });
  expect(await correctionAudits(fixture.closedProjectId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        organizationId: "org-race",
        operation: "ADDED",
      }),
    ]),
  );
});

it("adds an existing participant as an isolated closed-project snapshot without mutating master history", async () => {
  const fixture = await seedCorrectionCandidates();
  const timestamp = "2026-08-04T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'org-deleted', 2, ?)`,
    ).bind(fixture.closedProjectId, timestamp),
    rosterStatement(
      "roster-deleted-other-project",
      "project-open",
      "deleted-participant",
      "org-deleted",
      "STUDENT",
      "H1",
      timestamp,
      fixture.operator.userId,
    ),
  ]);
  const masterBefore = await participantState("deleted-participant");
  const otherRosterBefore = await rosterState("roster-deleted-other-project");
  const expectedBefore = await expectedSnapshotState(fixture.closedProjectId);
  const closureBefore = await projectClosureState(fixture.closedProjectId);

  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-deleted",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(linked.status).toBe(201);

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: "deleted-participant",
        confirmedParticipant: {
          name: "당시 확인 이름",
          organizationId: "org-deleted",
          role: "TEACHER",
          grade: null,
        },
        expectedParticipantRevision: 1,
        expectedRevision: 4,
      }),
    },
  );

  expect(response.status).toBe(201);
  const body = await response.json<{
    id: string;
    source: string;
    status: string;
    wasExpectedAtStart: boolean;
    projectRevision: number;
  }>();
  expect(body).toMatchObject({
    source: "IN_PROGRESS",
    status: "ACTIVE",
    wasExpectedAtStart: false,
    projectRevision: 5,
  });
  expect(await rosterState(body.id)).toMatchObject({
    project_id: fixture.closedProjectId,
    participant_id: "deleted-participant",
    organization_id: "org-deleted",
    participant_name_snapshot: "당시 확인 이름",
    organization_name_snapshot: "다음 삭제 조직",
    participant_role_snapshot: "TEACHER",
    student_grade_snapshot: null,
    source: "IN_PROGRESS",
    status: "ACTIVE",
    was_expected_at_start: 0,
    revision: 0,
  });
  expect(await participantState("deleted-participant")).toEqual(masterBefore);
  expect(await rosterState("roster-deleted-other-project")).toEqual(
    otherRosterBefore,
  );
  expect(await expectedSnapshotState(fixture.closedProjectId)).toEqual(
    expectedBefore,
  );
  expect(await projectClosureState(fixture.closedProjectId)).toEqual(
    closureBefore,
  );

  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/summary`,
  );
  expect(summary.status).toBe(200);
  expect(await summary.json()).toMatchObject({
    expectedTotal: 2,
    finalTotal: 2,
    deltaTotal: 0,
    organizations: expect.arrayContaining([
      expect.objectContaining({
        organizationId: "org-deleted",
        expected: 2,
        inProgressAdded: 1,
        final: 1,
        delta: -1,
      }),
    ]),
  });
  expect(await rosterCorrectionAudits(fixture.closedProjectId)).toEqual([
    {
      projectId: fixture.closedProjectId,
      organizationId: "org-deleted",
      operation: "ADDED",
      before: null,
      after: {
        name: "당시 확인 이름",
        organizationId: "org-deleted",
        role: "TEACHER",
        grade: null,
        status: "ACTIVE",
      },
    },
  ]);
});

it("rejects an existing-participant correction when the organization name changes after snapshot resolution", async () => {
  const fixture = await seedCorrectionCandidates();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(fixture.operator),
    }),
    env as Env,
  );
  const before = await mutationCounts(fixture.closedProjectId);
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          `UPDATE organizations SET name = '경합 뒤 조직명'
           WHERE id = 'org-active'`,
        ).run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    correctClosedProjectRoster(
      { ...(env as Env), DB: raceDb },
      actor,
      fixture.closedProjectId,
      {
        participantId: "deleted-participant",
        confirmedParticipant: {
          name: "경합 보정 참가자",
          organizationId: "org-active",
          role: "STUDENT",
          grade: "H1",
        },
        expectedParticipantRevision: 1,
        expectedRevision: 3,
      },
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(await mutationCounts(fixture.closedProjectId)).toEqual(before);
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM project_roster_entries
       WHERE project_id = ? AND participant_id = 'deleted-participant'`,
    )
      .bind(fixture.closedProjectId)
      .first(),
  ).toEqual({ count: 0 });
});

it("restores a cancelled closed roster row without changing its historical source or expected flag", async () => {
  const fixture = await seedCorrectionCandidates();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE project_roster_entries
       SET source = 'PRE_REGISTRATION', status = 'CANCELLED',
           was_expected_at_start = 1, revision = 4
       WHERE id = 'roster-active-old'`,
    ),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'org-active', 1, '2026-08-05T00:00:00.000Z')`,
    ).bind(fixture.closedProjectId),
  ]);
  const masterBefore = await participantState("active-participant");
  const expectedBefore = await expectedSnapshotState(fixture.closedProjectId);

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: "active-participant",
        confirmedParticipant: {
          name: "복원 당시 이름",
          organizationId: "org-active",
          role: "STUDENT",
          grade: "M2",
        },
        expectedParticipantRevision: 2,
        expectedRevision: 3,
      }),
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: "roster-active-old",
    participantName: "복원 당시 이름",
    source: "PRE_REGISTRATION",
    status: "ACTIVE",
    role: "STUDENT",
    grade: "M2",
    wasExpectedAtStart: true,
    revision: 5,
    projectRevision: 4,
  });
  expect(await participantState("active-participant")).toEqual(masterBefore);
  expect(await expectedSnapshotState(fixture.closedProjectId)).toEqual(
    expectedBefore,
  );
  expect(await rosterCorrectionAudits(fixture.closedProjectId)).toEqual([
    expect.objectContaining({
      organizationId: "org-active",
      operation: "RESTORED",
      before: expect.objectContaining({ status: "CANCELLED" }),
      after: {
        name: "복원 당시 이름",
        organizationId: "org-active",
        role: "STUDENT",
        grade: "M2",
        status: "ACTIVE",
      },
    }),
  ]);
});

it("creates a new participant and closed roster row atomically with one stable participant number", async () => {
  const fixture = await seedCorrectionCandidates();
  const requestBody = {
    newParticipant: {
      name: "종료 뒤 신규 참가자",
      organizationId: "org-active",
      role: "STUDENT",
      grade: "M3",
    },
    expectedRevision: 3,
  };

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    { method: "POST", body: JSON.stringify(requestBody) },
  );

  expect(response.status).toBe(201);
  const body = await response.json<{
    participant: { id: string; participantId: string };
    rosterEntry: {
      id: string;
      participantNumber: string;
      source: string;
      status: string;
      wasExpectedAtStart: boolean;
    };
    projectRevision: number;
  }>();
  expect(body.participant.participantId).toMatch(/^P-/);
  expect(body.rosterEntry).toMatchObject({
    participantNumber: body.participant.participantId,
    source: "IN_PROGRESS",
    status: "ACTIVE",
    wasExpectedAtStart: false,
  });
  expect(body.projectRevision).toBe(4);
  expect(
    await env.DB.prepare(
      `SELECT participant_id, name, organization_id, revision
       FROM participants WHERE id = ?`,
    )
      .bind(body.participant.id)
      .first(),
  ).toEqual({
    participant_id: body.participant.participantId,
    name: "종료 뒤 신규 참가자",
    organization_id: "org-active",
    revision: 0,
  });
  expect(await rosterState(body.rosterEntry.id)).toMatchObject({
    participant_id: body.participant.id,
    participant_name_snapshot: "종료 뒤 신규 참가자",
    source: "IN_PROGRESS",
    status: "ACTIVE",
    was_expected_at_start: 0,
  });

  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    {
      method: "POST",
      body: JSON.stringify({
        newParticipant: {
          ...requestBody.newParticipant,
          name: "guard 실패 참가자",
        },
        expectedRevision: 3,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect(await mutationCounts(fixture.closedProjectId)).toEqual({
    participants: 4,
    roster: 2,
    projectRevision: 4,
    rosterAudits: 1,
  });

  await env.DB.prepare(
    `CREATE TRIGGER reject_closed_roster_audit
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'CLOSED_PROJECT_ROSTER_CORRECTED'
     BEGIN SELECT RAISE(ABORT, 'REJECT_CORRECTION_AUDIT'); END`,
  ).run();
  try {
    const rejected = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
      {
        method: "POST",
        body: JSON.stringify({
          newParticipant: {
            ...requestBody.newParticipant,
            name: "감사 실패 참가자",
          },
          expectedRevision: 4,
        }),
      },
    );
    expect(rejected.status).toBe(500);
    expect(await mutationCounts(fixture.closedProjectId)).toEqual({
      participants: 4,
      roster: 2,
      projectRevision: 4,
      rosterAudits: 1,
    });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM participants
         WHERE name = '감사 실패 참가자'`,
      ).first(),
    ).toEqual({ count: 0 });
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_closed_roster_audit").run();
  }
});

it("requires an active project membership but not an active organization master for a closed addition", async () => {
  const fixture = await seedCorrectionCandidates();
  const before = await mutationCounts(fixture.closedProjectId);
  const input = {
    newParticipant: {
      name: "비활성 조직 신규 참가자",
      organizationId: "org-inactive",
      role: "TEACHER",
      grade: null,
    },
    expectedRevision: 3,
  };
  const unlinked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    { method: "POST", body: JSON.stringify(input) },
  );
  expect(unlinked.status).toBe(422);
  expect(await mutationCounts(fixture.closedProjectId)).toEqual(before);

  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-inactive",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(linked.status).toBe(201);
  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, expectedRevision: 4 }),
    },
  );
  expect(response.status).toBe(201);
  const body = await response.json<{
    participant: { id: string };
    rosterEntry: { organizationId: string; organizationName: string };
  }>();
  expect(body.rosterEntry).toMatchObject({
    organizationId: "org-inactive",
    organizationName: "나중 비활성 조직",
  });
  expect(await participantState(body.participant.id)).toMatchObject({
    organization_id: "org-inactive",
  });
  expect(
    await env.DB.prepare(
      "SELECT is_active, deleted_at FROM organizations WHERE id = 'org-inactive'",
    ).first(),
  ).toEqual({ is_active: 0, deleted_at: null });
});

it("patches only a closed roster snapshot and preserves source, expectation, masters, and close metadata", async () => {
  const fixture = await seedCorrectionCandidates();
  await env.DB.prepare(
    `INSERT INTO project_expected_snapshots
     (project_id, organization_id, expected_count, captured_at)
     VALUES (?, 'org-active', 3, '2026-08-05T00:00:00.000Z')`,
  )
    .bind(fixture.closedProjectId)
    .run();
  const masterBefore = await participantState("active-participant");
  const expectedBefore = await expectedSnapshotState(fixture.closedProjectId);
  const otherRosterBefore = await rosterState("roster-active-latest");
  const closureBefore = await projectClosureState(fixture.closedProjectId);
  const linked = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-deleted",
        expectedProjectRevision: 3,
      }),
    },
  );
  expect(linked.status).toBe(201);

  const updated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/roster-active-old`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "종료 당시 이름",
        organizationId: "org-deleted",
        role: "TEACHER",
        grade: null,
        expectedProjectRevision: 4,
        expectedEntryRevision: 0,
      }),
    },
  );
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    participantName: "종료 당시 이름",
    organizationId: "org-deleted",
    organizationName: "다음 삭제 조직",
    source: "IN_PROGRESS",
    status: "ACTIVE",
    role: "TEACHER",
    grade: null,
    wasExpectedAtStart: false,
    revision: 1,
    projectRevision: 5,
  });

  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/roster-active-old`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedProjectRevision: 5,
        expectedEntryRevision: 1,
      }),
    },
  );
  expect(cancelled.status).toBe(200);
  expect(await cancelled.json()).toMatchObject({
    status: "CANCELLED",
    source: "IN_PROGRESS",
    wasExpectedAtStart: false,
    revision: 2,
    projectRevision: 6,
  });

  const restored = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/roster-active-old`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "ACTIVE",
        expectedProjectRevision: 6,
        expectedEntryRevision: 2,
      }),
    },
  );
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    status: "ACTIVE",
    source: "IN_PROGRESS",
    wasExpectedAtStart: false,
    revision: 3,
    projectRevision: 7,
  });

  const noOp = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/roster-active-old`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "ACTIVE",
        expectedProjectRevision: 7,
        expectedEntryRevision: 3,
      }),
    },
  );
  expect(noOp.status).toBe(409);
  expect(await participantState("active-participant")).toEqual(masterBefore);
  expect(await expectedSnapshotState(fixture.closedProjectId)).toEqual(
    expectedBefore,
  );
  expect(await rosterState("roster-active-latest")).toEqual(otherRosterBefore);
  expect(await projectClosureState(fixture.closedProjectId)).toEqual(
    closureBefore,
  );
  expect(await closedProjectState(fixture.closedProjectId)).toMatchObject({
    revision: 7,
  });
  expect(await rosterState("roster-active-old")).toMatchObject({
    participant_name_snapshot: "종료 당시 이름",
    organization_id: "org-deleted",
    organization_name_snapshot: "다음 삭제 조직",
    participant_role_snapshot: "TEACHER",
    student_grade_snapshot: null,
    source: "IN_PROGRESS",
    status: "ACTIVE",
    was_expected_at_start: 0,
    revision: 3,
  });
  expect(await rosterCorrectionAudits(fixture.closedProjectId)).toEqual([
    {
      projectId: fixture.closedProjectId,
      organizationId: "org-deleted",
      operation: "UPDATED",
      before: {
        name: "스냅샷 참가자",
        organizationId: "org-active",
        role: "STUDENT",
        grade: "M1",
        status: "ACTIVE",
      },
      after: {
        name: "종료 당시 이름",
        organizationId: "org-deleted",
        role: "TEACHER",
        grade: null,
        status: "ACTIVE",
      },
    },
    expect.objectContaining({
      organizationId: "org-deleted",
      operation: "CANCELLED",
      before: expect.objectContaining({ status: "ACTIVE" }),
      after: expect.objectContaining({ status: "CANCELLED" }),
    }),
    expect.objectContaining({
      organizationId: "org-deleted",
      operation: "RESTORED",
      before: expect.objectContaining({ status: "CANCELLED" }),
      after: expect.objectContaining({ status: "ACTIVE" }),
    }),
  ]);
});

it("bulk-adds 30 closed-project participants with correction semantics and one shared batch audit", async () => {
  const fixture = await seedCorrectionCandidates();
  await env.DB.prepare(
    `INSERT INTO project_expected_snapshots
     (project_id, organization_id, expected_count, captured_at)
     VALUES (?, 'org-active', 7, '2026-08-05T00:00:00.000Z')`,
  )
    .bind(fixture.closedProjectId)
    .run();
  const participants = Array.from({ length: 30 }, (_, index) => ({
    name: index === 0 || index === 29 ? "가동 참가자" : `일괄 보정 ${index}`,
    role: index % 2 === 0 ? ("STUDENT" as const) : ("TEACHER" as const),
    grade: index % 2 === 0 ? ("H2" as const) : null,
  }));
  const before = await mutationCounts(fixture.closedProjectId);

  const conflicted = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-active",
        participants,
        confirmDuplicateNames: false,
        expectedRevision: 3,
      }),
    },
  );
  expect(conflicted.status).toBe(409);
  expect(await mutationCounts(fixture.closedProjectId)).toEqual(before);

  const response = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-active",
        participants,
        confirmDuplicateNames: true,
        expectedRevision: 3,
      }),
    },
  );
  expect(response.status).toBe(201);
  const body = await response.json<{
    batchId: string;
    participants: Array<{
      participant: { id: string; participantId: string };
      rosterEntry: {
        participantId: string;
        participantNumber: string;
        source: string;
        status: string;
        wasExpectedAtStart: boolean;
      };
    }>;
    projectRevision: number;
  }>();
  expect(body.participants).toHaveLength(30);
  expect(body.projectRevision).toBe(4);
  for (const item of body.participants) {
    expect(item.participant.participantId).toMatch(/^P-/);
    expect(item.rosterEntry).toMatchObject({
      participantId: item.participant.id,
      participantNumber: item.participant.participantId,
      source: "IN_PROGRESS",
      status: "ACTIVE",
      wasExpectedAtStart: false,
    });
  }
  const stored = (
    await env.DB.prepare(
      `SELECT p.id, p.participant_id, r.source, r.status,
              r.was_expected_at_start
       FROM participants p
       JOIN project_roster_entries r ON r.participant_id = p.id
       WHERE r.project_id = ? AND r.id <> 'roster-active-old'
       ORDER BY p.id`,
    )
      .bind(fixture.closedProjectId)
      .all<{
        id: string;
        participant_id: string;
        source: string;
        status: string;
        was_expected_at_start: number;
      }>()
  ).results;
  expect(stored).toHaveLength(30);
  expect(stored).toEqual(
    expect.arrayContaining(
      body.participants.map(({ participant }) => ({
        id: participant.id,
        participant_id: participant.participantId,
        source: "IN_PROGRESS",
        status: "ACTIVE",
        was_expected_at_start: 0,
      })),
    ),
  );
  expect(await expectedSnapshotState(fixture.closedProjectId)).toEqual([
    { organization_id: "org-active", expected_count: 7 },
  ]);
  const audits = await rosterCorrectionAudits(fixture.closedProjectId);
  expect(audits).toHaveLength(30);
  expect(new Set(audits.map((audit) => audit.batchId))).toEqual(
    new Set([body.batchId]),
  );
  expect(
    audits.every(
      (audit) =>
        audit.operation === "CREATED_AND_ADDED" &&
        audit.before === null &&
        audit.after.status === "ACTIVE",
    ),
  ).toBe(true);
  const summary = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/summary`,
  );
  expect(await summary.json()).toMatchObject({
    expectedTotal: 7,
    finalTotal: 31,
    deltaTotal: 24,
    organizations: [
      expect.objectContaining({
        organizationId: "org-active",
        expected: 7,
        inProgressAdded: 31,
        final: 31,
        delta: 24,
      }),
    ],
  });
});

it("rolls back every closed bulk row, revision increment, and correction audit on stale or audit failure", async () => {
  const fixture = await seedCorrectionCandidates();
  const before = await mutationCounts(fixture.closedProjectId);
  const stale = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/bulk`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-active",
        participants: [
          { name: "stale 일괄 참가자", role: "TEACHER", grade: null },
        ],
        confirmDuplicateNames: false,
        expectedRevision: 2,
      }),
    },
  );
  expect(stale.status).toBe(409);
  expect(await mutationCounts(fixture.closedProjectId)).toEqual(before);

  await env.DB.prepare(
    `CREATE TRIGGER reject_closed_bulk_audit
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'CLOSED_PROJECT_ROSTER_CORRECTED'
     BEGIN SELECT RAISE(ABORT, 'REJECT_CORRECTION_AUDIT'); END`,
  ).run();
  try {
    const rejected = await authedRequest(
      fixture.operator,
      `/api/v1/projects/${fixture.closedProjectId}/history-corrections/roster/bulk`,
      {
        method: "POST",
        body: JSON.stringify({
          organizationId: "org-active",
          participants: [
            { name: "정상 일괄 참가자", role: "STUDENT", grade: "M1" },
            { name: "감사 실패 일괄 참가자", role: "TEACHER", grade: null },
          ],
          confirmDuplicateNames: false,
          expectedRevision: 3,
        }),
      },
    );
    expect(rejected.status).toBe(500);
    expect(await mutationCounts(fixture.closedProjectId)).toEqual(before);
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_closed_bulk_audit").run();
  }
});

async function participantState(participantId: string) {
  return env.DB.prepare(
    `SELECT id, participant_id, name, organization_id, revision,
            created_at, updated_at
     FROM participants WHERE id = ?`,
  )
    .bind(participantId)
    .first();
}

async function rosterState(entryId: string) {
  return env.DB.prepare(
    `SELECT id, project_id, participant_id, organization_id,
            participant_name_snapshot, organization_name_snapshot,
            participant_role_snapshot, student_grade_snapshot, source, status,
            was_expected_at_start, revision, created_by, updated_by,
            created_at, updated_at
     FROM project_roster_entries WHERE id = ?`,
  )
    .bind(entryId)
    .first();
}

async function expectedSnapshotState(projectId: string) {
  return (
    await env.DB.prepare(
      `SELECT organization_id, expected_count
       FROM project_expected_snapshots WHERE project_id = ?
       ORDER BY organization_id`,
    )
      .bind(projectId)
      .all()
  ).results;
}

async function projectClosureState(projectId: string) {
  return env.DB.prepare(
    `SELECT status, closed_at, closed_by, close_reason
     FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first();
}

async function mutationCounts(projectId: string) {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS count FROM participants"),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM project_roster_entries
       WHERE project_id = ?`,
    ).bind(projectId),
    env.DB.prepare("SELECT revision FROM projects WHERE id = ?").bind(
      projectId,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_logs
       WHERE action = 'CLOSED_PROJECT_ROSTER_CORRECTED'
         AND details_json LIKE ?`,
    ).bind(`%"projectId":"${projectId}"%`),
  ]);
  const participantRow = results[0]?.results[0] as
    | { count: number }
    | undefined;
  const rosterRow = results[1]?.results[0] as { count: number } | undefined;
  const projectRow = results[2]?.results[0] as { revision: number } | undefined;
  const auditRow = results[3]?.results[0] as { count: number } | undefined;
  if (!participantRow || !rosterRow || !projectRow || !auditRow) {
    throw new Error("closed correction mutation count query failed");
  }
  return {
    participants: participantRow.count,
    roster: rosterRow.count,
    projectRevision: projectRow.revision,
    rosterAudits: auditRow.count,
  };
}

async function rosterCorrectionAudits(projectId: string) {
  const rows = (
    await env.DB.prepare(
      `SELECT details_json FROM audit_logs
       WHERE action = 'CLOSED_PROJECT_ROSTER_CORRECTED'
         AND entity_type = 'ROSTER_ENTRY'
         AND details_json LIKE ?
       ORDER BY rowid`,
    )
      .bind(`%"projectId":"${projectId}"%`)
      .all<{ details_json: string }>()
  ).results;
  return rows.map(
    (row) =>
      JSON.parse(row.details_json) as {
        batchId?: string;
        projectId: string;
        organizationId: string;
        operation: string;
        before: null | {
          name: string;
          organizationId: string;
          role: string;
          grade: string | null;
          status: string;
        };
        after: {
          name: string;
          organizationId: string;
          role: string;
          grade: string | null;
          status: string;
        };
      },
  );
}

async function organizationStates(organizationIds: string[]) {
  const rows = (
    await env.DB.prepare(
      `SELECT id, name, is_active, deleted_at, updated_at
       FROM organizations
       WHERE id IN (${organizationIds.map(() => "?").join(", ")})
       ORDER BY id`,
    )
      .bind(...organizationIds)
      .all()
  ).results;
  return rows;
}

async function closedProjectState(projectId: string) {
  const project = await env.DB.prepare(
    `SELECT status, closed_at, closed_by, close_reason, revision
     FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{
      status: string;
      closed_at: string | null;
      closed_by: string | null;
      close_reason: string | null;
      revision: number;
    }>();
  if (!project) throw new Error("closed project fixture is missing");
  return project;
}

async function correctionAudits(projectId: string) {
  const rows = (
    await env.DB.prepare(
      `SELECT details_json FROM audit_logs
       WHERE action = 'CLOSED_PROJECT_ORGANIZATION_CORRECTED'
         AND entity_type = 'PROJECT_ORGANIZATION'
         AND details_json LIKE ?
       ORDER BY rowid`,
    )
      .bind(`%"projectId":"${projectId}"%`)
      .all<{ details_json: string }>()
  ).results;
  return rows.map((row) => JSON.parse(row.details_json));
}

async function seedCorrectionCandidates() {
  const operator = await seedOperator();
  await seedOrganization("org-active", "가동 조직");
  await seedOrganization("org-inactive", "나중 비활성 조직", false);
  await seedOrganization("org-deleted", "다음 삭제 조직");
  const manager = await seedManager("org-active");
  await seedUser({
    id: "bootstrap-user",
    loginId: "bootstrap-01",
    password: "bootstrap-password-123",
    isBootstrap: true,
  });
  const bootstrap = {
    ...(await login("bootstrap-01", "bootstrap-password-123")),
    userId: "bootstrap-user",
  };
  const now = "2026-08-05T00:00:00.000Z";
  const later = "2026-08-06T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE organizations
       SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
       WHERE id = 'org-deleted'`,
    ).bind(now, operator.userId, now),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason)
       VALUES ('project-closed', '종료 보정 대상', 'CLOSED', 3, ?, ?, ?, ?, ?, 'MANUAL')`,
    ).bind(operator.userId, now, now, now, operator.userId),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at)
       VALUES ('project-open', '진행 중 대상', 'IN_PROGRESS', 0, ?, ?, ?)`,
    ).bind(operator.userId, now, now),
    env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason, deleted_at, deleted_by, deleted_revision)
       VALUES ('project-deleted', '삭제된 종료 대상', 'CLOSED', 1, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, 1)`,
    ).bind(
      operator.userId,
      now,
      now,
      now,
      operator.userId,
      now,
      operator.userId,
    ),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, added_by, updated_by)
       VALUES ('project-closed', 'org-active', 1, ?, ?, ?)`,
    ).bind(now, operator.userId, operator.userId),
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES
       ('active-participant', 'P-ACTIVE', '가동 참가자', 'org-active', 2, ?, ?),
       ('inactive-participant', 'P-INACTIVE', '나중 참가자', 'org-inactive', 0, ?, ?),
       ('deleted-participant', 'P-DELETED', '다음 참가자', 'org-deleted', 1, ?, ?)`,
    ).bind(now, now, now, now, now, now),
    rosterStatement(
      "roster-active-old",
      "project-closed",
      "active-participant",
      "org-active",
      "STUDENT",
      "M1",
      now,
      operator.userId,
    ),
    rosterStatement(
      "roster-active-latest",
      "project-open",
      "active-participant",
      "org-active",
      "TEACHER",
      null,
      later,
      operator.userId,
    ),
  ]);

  return { operator, manager, bootstrap, closedProjectId: "project-closed" };
}

function rosterStatement(
  id: string,
  projectId: string,
  participantId: string,
  organizationId: string,
  role: "STUDENT" | "TEACHER",
  grade: "M1" | "H1" | null,
  timestamp: string,
  actorId: string,
) {
  return env.DB.prepare(
    `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id, participant_name_snapshot,
        organization_name_snapshot, participant_role_snapshot, student_grade_snapshot,
        source, status, was_expected_at_start, revision, created_by, updated_by,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, '스냅샷 참가자', '스냅샷 조직', ?, ?, 'IN_PROGRESS',
               'ACTIVE', 0, 0, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    participantId,
    organizationId,
    role,
    grade,
    actorId,
    actorId,
    timestamp,
    timestamp,
  );
}

async function managerProjectIds(
  manager: Awaited<ReturnType<typeof seedManager>>,
) {
  return (
    await (
      await authedRequest(manager, "/api/v1/projects")
    ).json<Array<{ id: string }>>()
  )
    .map(({ id }) => id)
    .sort();
}

async function managerParticipantIds(
  manager: Awaited<ReturnType<typeof seedManager>>,
) {
  return (
    await (
      await authedRequest(manager, "/api/v1/participants")
    ).json<Array<{ id: string }>>()
  )
    .map(({ id }) => id)
    .sort();
}
