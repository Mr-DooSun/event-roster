import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { setProjectOrganizationActive } from "../src/services/project-organizations";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { resetAuthState } from "./support/auth";
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);
afterEach(() => vi.useRealTimers());

it("links an existing organization, deactivates it, and reuses the row", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  const link = await authedRequest(
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
  expect(link.status).toBe(201);
  const linked = await link.json<{
    organization: { organizationId: string };
    projectRevision: number;
  }>();
  expect(linked).toMatchObject({
    organization: {
      organizationId: organization.id,
      primaryLeader: null,
      managerCount: 0,
      rosterCount: 0,
    },
    projectRevision: project.revision + 1,
  });
  expect(
    await (
      await authedRequest(
        operator,
        `/api/v1/projects/${project.id}/organizations`,
      )
    ).json(),
  ).toEqual([
    {
      organizationId: organization.id,
      name: organization.name,
      isActive: true,
      masterIsActive: true,
      activeProjectCount: 1,
      hasHistory: true,
      primaryLeader: null,
      managerCount: 0,
      rosterCount: 0,
    },
  ]);
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: linked.projectRevision,
      }),
    },
  );
  expect(disabled.status).toBe(200);
  const disabledBody = await disabled.json<{ projectRevision: number }>();
  expect(
    (
      await authedRequest(
        operator,
        `/api/v1/projects/${project.id}/organizations`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: organization.id,
            expectedProjectRevision: disabledBody.projectRevision,
          }),
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id=? AND organization_id=?",
      )
        .bind(project.id, organization.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
      .bind(project.id)
      .first<{ revision: number }>(),
  ).toEqual({ revision: project.revision + 3 });
  const auditActions = (
    await env.DB.prepare(
      `SELECT action FROM audit_logs
       WHERE entity_type = 'PROJECT_ORGANIZATION'
       ORDER BY occurred_at, rowid`,
    ).all<{ action: string }>()
  ).results.map((row) => row.action);
  expect(auditActions).toEqual([
    "PROJECT_ORGANIZATION_ADDED",
    "PROJECT_ORGANIZATION_DEACTIVATED",
    "PROJECT_ORGANIZATION_REACTIVATED",
  ]);
});

it("aggregates primary leadership, managers, and active roster counts", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  const linked = await linkProjectOrganization(
    operator,
    project.id,
    organization.id,
    project.revision,
  );
  await env.DB.prepare(
    `INSERT INTO user_organizations
     (user_id, organization_id, assignment_role, assigned_by, assigned_at)
     VALUES (?, ?, 'PRIMARY_LEADER', ?, ?)`,
  )
    .bind(
      operator.userId,
      organization.id,
      operator.userId,
      "2026-07-23T00:00:00.000Z",
    )
    .run();
  await seedManager(organization.id);
  await seedRosterSnapshot(
    project.id,
    organization.id,
    organization.name,
    operator.userId,
  );
  const primary = await env.DB.prepare(
    "SELECT display_name FROM users WHERE id = ?",
  )
    .bind(operator.userId)
    .first<{ display_name: string }>();

  const listed = await (
    await authedRequest(
      operator,
      `/api/v1/projects/${project.id}/organizations`,
    )
  ).json();
  expect(listed).toEqual([
    expect.objectContaining({
      organizationId: organization.id,
      primaryLeader: {
        userId: operator.userId,
        displayName: primary?.display_name,
      },
      managerCount: 1,
      rosterCount: 1,
    }),
  ]);
  expect(linked.projectRevision).toBe(project.revision + 1);
});

it("allows only one concurrent add at an observed project revision", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  const request = () =>
    authedRequest(operator, `/api/v1/projects/${project.id}/organizations`, {
      method: "POST",
      body: JSON.stringify({
        organizationId: organization.id,
        expectedProjectRevision: project.revision,
      }),
    });

  const responses = await Promise.all([request(), request()]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const conflict = responses.find((response) => response.status === 409);
  expect(await conflict?.json()).toMatchObject({ code: "STALE_REVISION" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ?",
      )
        .bind(project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action = 'PROJECT_ORGANIZATION_ADDED' AND entity_id = ?`,
      )
        .bind(`${project.id}:${organization.id}`)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
      .bind(project.id)
      .first<{ revision: number }>(),
  ).toEqual({ revision: project.revision + 1 });
});

it("returns the existing organization after a canonical-name create race", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator);
  const request = (newOrganizationName: string) =>
    authedRequest(operator, `/api/v1/projects/${project.id}/organizations`, {
      method: "POST",
      body: JSON.stringify({
        newOrganizationName,
        expectedProjectRevision: project.revision,
      }),
    });

  const responses = await Promise.all([
    request("경합 조직"),
    request("  경합 조직  "),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const success = responses.find((response) => response.status === 201);
  const created = await success?.json<{
    organization: { organizationId: string };
  }>();
  const conflict = responses.find((response) => response.status === 409);
  expect(await conflict?.json()).toMatchObject({
    code: "CONFLICT",
    details: {
      organizationId: created?.organization.organizationId,
      organizationName: "경합 조직",
      reason: "ORGANIZATION_NAME_EXISTS",
    },
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM organizations WHERE canonical_name = ?",
      )
        .bind("경합 조직")
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ?",
      )
        .bind(project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("creates and links a new organization atomically, then deletes a no-history link", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator);
  const created = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        newOrganizationName: "신규 조직",
        expectedProjectRevision: project.revision,
      }),
    },
  );
  expect(created.status).toBe(201);
  const membership = await created.json<{
    organization: { organizationId: string };
    projectRevision: number;
  }>();
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${membership.organization.organizationId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: membership.projectRevision,
      }),
    },
  );
  expect(await disabled.json()).toMatchObject({
    organization: { isActive: false },
    projectRevision: membership.projectRevision + 1,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id=? AND organization_id=?",
      )
        .bind(project.id, membership.organization.organizationId)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);
  const audits = (
    await env.DB.prepare(
      `SELECT action, entity_type, entity_id, details_json FROM audit_logs
       WHERE action IN ('ORGANIZATION_CREATED', 'PROJECT_ORGANIZATION_ADDED')
       ORDER BY rowid`,
    ).all<{
      action: string;
      entity_type: string;
      entity_id: string;
      details_json: string;
    }>()
  ).results.map((audit) => ({
    action: audit.action,
    entityType: audit.entity_type,
    entityId: audit.entity_id,
    details: JSON.parse(audit.details_json),
  }));
  expect(audits).toEqual([
    {
      action: "ORGANIZATION_CREATED",
      entityType: "ORGANIZATION",
      entityId: membership.organization.organizationId,
      details: {
        organizationId: membership.organization.organizationId,
      },
    },
    {
      action: "PROJECT_ORGANIZATION_ADDED",
      entityType: "PROJECT_ORGANIZATION",
      entityId: `${project.id}:${membership.organization.organizationId}`,
      details: {
        projectId: project.id,
        organizationId: membership.organization.organizationId,
      },
    },
  ]);
});

it("treats membership audit rows as history and deletes only a truly audit-free fixture", async () => {
  const operator = await seedOperator();
  const audited = await seedOrganization("org-audited", "감사 조직");
  const legacy = await seedOrganization("org-legacy", "수동 조직");
  const project = await seedProject(operator);
  const linked = await linkProjectOrganization(
    operator,
    project.id,
    audited.id,
    project.revision,
  );
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, ?, 1, ?, ?, ?)`)
    .bind(
      project.id,
      legacy.id,
      "2026-07-21T00:00:00.000Z",
      operator.userId,
      operator.userId,
    )
    .run();

  const listed = await (
    await authedRequest(
      operator,
      `/api/v1/projects/${project.id}/organizations`,
    )
  ).json<Array<{ organizationId: string; hasHistory: boolean }>>();
  expect(
    listed.find((item) => item.organizationId === audited.id)?.hasHistory,
  ).toBe(true);
  expect(
    listed.find((item) => item.organizationId === legacy.id)?.hasHistory,
  ).toBe(false);

  const auditedDisabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${audited.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: linked.projectRevision,
      }),
    },
  );
  const auditedDisabledBody = await auditedDisabled.json<{
    projectRevision: number;
  }>();
  expect(auditedDisabledBody).toMatchObject({
    organization: { isActive: false },
  });
  const legacyDisabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${legacy.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: auditedDisabledBody.projectRevision,
      }),
    },
  );
  expect(await legacyDisabled.json()).toMatchObject({
    organization: { isActive: false },
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ?",
      )
        .bind(project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(1);

  const manager = await seedManager(audited.id);
  const projects = await (
    await authedRequest(manager, "/api/v1/projects")
  ).json<Array<{ id: string }>>();
  expect(projects.map((item) => item.id)).toContain(project.id);
});

it("requeries the active project count after deleting an audit-free membership", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const targetProject = await seedProject(operator, { name: "삭제 대상" });
  const concurrentProject = await seedProject(operator, { name: "동시 변경" });
  const timestamp = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES (?, ?, 1, ?, ?, ?)`).bind(
      targetProject.id,
      organization.id,
      timestamp,
      operator.userId,
      operator.userId,
    ),
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES (?, ?, 1, ?, ?, ?)`).bind(
      concurrentProject.id,
      organization.id,
      timestamp,
      operator.userId,
      operator.userId,
    ),
  ]);
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: {
        Authorization: `Bearer ${operator.body.accessToken}`,
      },
    }),
    env as Env,
  );
  let intercepted = false;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = await env.DB.batch(statements);
      if (!intercepted) {
        intercepted = true;
        await env.DB.prepare(`UPDATE project_organizations
          SET is_active = 0
          WHERE project_id = ? AND organization_id = ?`)
          .bind(concurrentProject.id, organization.id)
          .run();
      }
      return results;
    },
  } as D1Database;

  const result = await setProjectOrganizationActive(
    { ...(env as Env), DB: raceDb },
    actor,
    targetProject.id,
    organization.id,
    {
      isActive: false,
      expectedProjectRevision: targetProject.revision,
    },
  );

  expect(result.organization).toMatchObject({
    organizationId: organization.id,
    isActive: false,
    activeProjectCount: 0,
  });
});

it("does not treat LIKE-wildcard lookalike audit actions as membership history", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization(
    "org-lookalike",
    "유사 감사 조직",
  );
  const project = await seedProject(operator);
  const timestamp = "2026-07-21T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES (?, ?, 1, ?, ?, ?)`).bind(
      project.id,
      organization.id,
      timestamp,
      operator.userId,
      operator.userId,
    ),
    env.DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('lookalike-audit', ?, 'PROJECTXORGANIZATIONYFAKE',
              'PROJECT_ORGANIZATION', ?, ?, '{}')`).bind(
      operator.userId,
      `${project.id}:${organization.id}`,
      timestamp,
    ),
  ]);

  const listed = await (
    await authedRequest(
      operator,
      `/api/v1/projects/${project.id}/organizations`,
    )
  ).json<Array<{ organizationId: string; hasHistory: boolean }>>();
  expect(listed).toEqual([
    expect.objectContaining({
      organizationId: organization.id,
      hasHistory: false,
    }),
  ]);
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: project.revision,
      }),
    },
  );
  expect(await disabled.json()).toMatchObject({
    organization: { isActive: false },
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ? AND organization_id = ?",
      )
        .bind(project.id, organization.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("globally deactivates an organization with audit and blocks only new usage", async () => {
  const fixture = await setupPreRegistration();
  const added = await addRoster(fixture, fixture.firstParticipant.id);
  const active = await added.json<{
    id: string;
    revision: number;
    projectRevision: number;
  }>();
  const deactivated = await authedRequest(
    fixture.operator,
    "/api/v1/organizations/org-1",
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(deactivated.status).toBe(200);
  expect(await deactivated.json()).toMatchObject({
    id: "org-1",
    isActive: false,
    masterIsActive: false,
    activeProjectCount: 1,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'ORGANIZATION_DEACTIVATED' AND entity_id = 'org-1'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(1);

  const cancelled = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/roster/${active.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "CANCELLED",
        expectedRevision: active.projectRevision,
        expectedEntryRevision: active.revision,
      }),
    },
  );
  expect(cancelled.status).toBe(200);
  const cancelledBody = await cancelled.json<{ projectRevision: number }>();
  const updated = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/participants/${fixture.firstParticipant.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "비활성 마스터 이력 수정",
        expectedRevision: 0,
        expectedProjectRevision: cancelledBody.projectRevision,
      }),
    },
  );
  expect(updated.status).toBe(200);
  const blockedRoster = await addRoster(
    {
      ...fixture,
      project: {
        ...fixture.project,
        revision: cancelledBody.projectRevision + 1,
      },
    },
    fixture.secondParticipant.id,
  );
  expect(blockedRoster.status).toBe(422);

  const newProject = await seedProject(fixture.operator, {
    name: "새 연결 차단",
  });
  const blockedLink = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${newProject.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        expectedProjectRevision: newProject.revision,
      }),
    },
  );
  expect(blockedLink.status).toBe(409);

  const validation = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/imports/validate`,
    {
      method: "POST",
      body: JSON.stringify([
        { rowNumber: 2, name: "신규", organizationName: "1팀" },
      ]),
    },
  );
  expect(validation.status).toBe(200);
  expect(await validation.json()).toMatchObject({
    rows: [{ issues: ["UNKNOWN_ORGANIZATION"] }],
  });
  const blockedImport = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/imports/commit`,
    {
      method: "POST",
      body: JSON.stringify({
        rows: [{ rowNumber: 2, name: "신규", organizationName: "1팀" }],
        expectedProjectRevision: cancelledBody.projectRevision + 1,
      }),
    },
  );
  expect(blockedImport.status).toBe(422);
});

it("rejects an ambiguous organization link request", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  const response = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: organization.id,
        newOrganizationName: "모호한 조직",
        expectedProjectRevision: project.revision,
      }),
    },
  );
  expect(response.status).toBe(422);
});

it("rolls back a new organization and membership when audit insertion fails", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator);
  await env.DB.prepare(`CREATE TRIGGER reject_project_organization_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'PROJECT_ORGANIZATION_ADDED'
    BEGIN SELECT RAISE(ABORT, 'AUDIT_REJECTED'); END`).run();
  let response: Response;
  try {
    response = await authedRequest(
      operator,
      `/api/v1/projects/${project.id}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({
          newOrganizationName: "롤백 조직",
          expectedProjectRevision: project.revision,
        }),
      },
    );
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS reject_project_organization_audit",
    ).run();
  }
  expect(response.status).toBe(409);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM organizations
         WHERE canonical_name = '롤백 조직'`,
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    await env.DB.prepare("SELECT revision FROM projects WHERE id = ?")
      .bind(project.id)
      .first<{ revision: number }>(),
  ).toEqual({ revision: project.revision });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('ORGANIZATION_CREATED', 'PROJECT_ORGANIZATION_ADDED')",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id = ?",
      )
        .bind(project.id)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("preserves a historical link and scopes an organization manager to linked projects", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const linked = await seedProject(operator, { name: "연결 프로젝트" });
  const hidden = await seedProject(operator, { name: "숨김 프로젝트" });
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, ?, 1, ?, ?, ?)`)
    .bind(
      linked.id,
      organization.id,
      "2026-05-01T00:00:00.000Z",
      operator.userId,
      operator.userId,
    )
    .run();
  await env.DB.prepare(`INSERT INTO project_expected_snapshots
    (project_id, organization_id, expected_count, captured_at) VALUES (?, ?, 0, ?)`)
    .bind(linked.id, organization.id, "2026-05-01T00:00:00.000Z")
    .run();
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${linked.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: false,
        expectedProjectRevision: linked.revision,
      }),
    },
  );
  expect(await disabled.json()).toMatchObject({
    organization: { isActive: false },
  });
  expect(
    await (
      await authedRequest(
        operator,
        `/api/v1/projects/${linked.id}/organizations`,
      )
    ).json(),
  ).toEqual([
    expect.objectContaining({
      organizationId: organization.id,
      isActive: false,
      hasHistory: true,
    }),
  ]);
  expect(
    (
      await env.DB.prepare(
        `SELECT action FROM audit_logs
         WHERE entity_type = 'PROJECT_ORGANIZATION'
         ORDER BY rowid DESC LIMIT 1`,
      ).first<{ action: string }>()
    )?.action,
  ).toBe("PROJECT_ORGANIZATION_DEACTIVATED");
  const manager = await seedManager(organization.id);
  const visible = await (await authedRequest(manager, "/api/v1/projects")).json<
    Array<{ id: string }>
  >();
  expect(visible.map((project) => project.id)).toContain(linked.id);
  expect(visible.map((project) => project.id)).not.toContain(hidden.id);
  expect(
    (await authedRequest(manager, `/api/v1/projects/${linked.id}`)).status,
  ).toBe(200);
  expect(
    (await authedRequest(manager, `/api/v1/projects/${hidden.id}`)).status,
  ).toBe(403);
  expect(
    (
      await authedRequest(
        manager,
        `/api/v1/projects/${linked.id}/organizations`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: organization.id,
            expectedProjectRevision: linked.revision + 1,
          }),
        },
      )
    ).status,
  ).toBe(403);
});

it("reports global rename impact without rewriting a roster snapshot", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  await linkProjectOrganization(
    operator,
    project.id,
    organization.id,
    project.revision,
  );
  await seedRosterSnapshot(
    project.id,
    organization.id,
    organization.name,
    operator.userId,
  );
  const response = await authedRequest(
    operator,
    `/api/v1/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "변경된 조직" }),
    },
  );
  expect(await response.json()).toMatchObject({
    name: "변경된 조직",
    activeProjectCount: 1,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT organization_name_snapshot FROM project_roster_entries WHERE project_id=? LIMIT 1",
      )
        .bind(project.id)
        .first<{ organization_name_snapshot: string }>()
    )?.organization_name_snapshot,
  ).toBe(organization.name);
});

it("rejects organization membership mutations for closed and expired projects", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T01:00:00.000Z"));
  const operator = await seedOperator();
  const first = await seedOrganization("org-closed", "종료 조직");
  const second = await seedOrganization("org-expired", "만료 조직");
  const closed = await seedProject(operator);
  const expired = await seedProject(operator);
  const closedLink = await linkProjectOrganization(
    operator,
    closed.id,
    first.id,
    closed.revision,
  );
  const expiredLink = await linkProjectOrganization(
    operator,
    expired.id,
    second.id,
    expired.revision,
  );
  await env.DB.prepare(
    "UPDATE projects SET status='CLOSED', closed_at=?, close_reason='MANUAL' WHERE id=?",
  )
    .bind("2026-07-21T00:00:00.000Z", closed.id)
    .run();
  await env.DB.prepare("UPDATE projects SET end_date='2026-07-21' WHERE id=?")
    .bind(expired.id)
    .run();

  for (const [projectId, organizationId, expectedProjectRevision] of [
    [closed.id, first.id, closedLink.projectRevision],
    [expired.id, second.id, expiredLink.projectRevision],
  ]) {
    const add = await authedRequest(
      operator,
      `/api/v1/projects/${projectId}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId, expectedProjectRevision }),
      },
    );
    expect(add.status).toBe(409);
    expect(await add.json()).toMatchObject({ code: "PROJECT_CLOSED" });
    const disable = await authedRequest(
      operator,
      `/api/v1/projects/${projectId}/organizations/${organizationId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          isActive: false,
          expectedProjectRevision,
        }),
      },
    );
    expect(disable.status).toBe(409);
    expect(await disable.json()).toMatchObject({ code: "PROJECT_CLOSED" });
  }
});

async function linkProjectOrganization(
  operator: Awaited<ReturnType<typeof seedOperator>>,
  projectId: string,
  organizationId: string,
  expectedProjectRevision: number,
) {
  const response = await authedRequest(
    operator,
    `/api/v1/projects/${projectId}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({ organizationId, expectedProjectRevision }),
    },
  );
  expect(response.status).toBe(201);
  return response.json<{ projectRevision: number }>();
}

async function seedRosterSnapshot(
  projectId: string,
  organizationId: string,
  organizationName: string,
  userId: string,
) {
  const now = "2026-05-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO participants
      (id, participant_id, name, organization_id, revision, created_at, updated_at)
      VALUES ('legacy-person', 'P-LEGACY', '기존 참가자', ?, 0, ?, ?)`).bind(
      organizationId,
      now,
      now,
    ),
    env.DB.prepare(`INSERT INTO project_roster_entries
      (id, project_id, participant_id, organization_id, participant_name_snapshot,
       organization_name_snapshot, source, status, revision, created_by, updated_by, created_at, updated_at)
      VALUES ('legacy-entry', ?, 'legacy-person', ?, '기존 참가자', ?,
       'PRE_REGISTRATION', 'ACTIVE', 0, ?, ?, ?, ?)`).bind(
      projectId,
      organizationId,
      organizationName,
      userId,
      userId,
      now,
      now,
    ),
  ]);
}
