import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { resetAuthState } from "./support/auth";

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
      body: JSON.stringify({ organizationId: organization.id }),
    },
  );
  expect(link.status).toBe(201);
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
      hasHistory: false,
    },
  ]);
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    },
  );
  expect(disabled.status).toBe(200);
  expect(
    (
      await authedRequest(
        operator,
        `/api/v1/projects/${project.id}/organizations`,
        {
          method: "POST",
          body: JSON.stringify({ organizationId: organization.id }),
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
  const auditActions = (
    await env.DB.prepare(
      `SELECT action FROM audit_logs
       WHERE entity_type = 'PROJECT_ORGANIZATION'
       ORDER BY occurred_at, rowid`,
    ).all<{ action: string }>()
  ).results.map((row) => row.action);
  expect(auditActions).toEqual([
    "PROJECT_ORGANIZATION_ADDED",
    "PROJECT_ORGANIZATION_REMOVED",
    "PROJECT_ORGANIZATION_REACTIVATED",
  ]);
});

it("creates and links a new organization atomically, then deletes a no-history link", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator);
  const created = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({ newOrganizationName: "신규 조직" }),
    },
  );
  expect(created.status).toBe(201);
  const membership = await created.json<{ organizationId: string }>();
  const disabled = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/organizations/${membership.organizationId}`,
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(await disabled.json()).toMatchObject({
    isActive: false,
    removed: true,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM project_organizations WHERE project_id=? AND organization_id=?",
      )
        .bind(project.id, membership.organizationId)
        .first<{ count: number }>()
    )?.count,
  ).toBe(0);
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
        body: JSON.stringify({ newOrganizationName: "롤백 조직" }),
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
    { method: "PATCH", body: JSON.stringify({ isActive: false }) },
  );
  expect(await disabled.json()).toMatchObject({
    isActive: false,
    removed: false,
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
          body: JSON.stringify({ organizationId: organization.id }),
        },
      )
    ).status,
  ).toBe(403);
});

it("reports global rename impact without rewriting a roster snapshot", async () => {
  const operator = await seedOperator();
  const organization = await seedOrganization();
  const project = await seedProject(operator);
  await linkProjectOrganization(operator, project.id, organization.id);
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
  await linkProjectOrganization(operator, closed.id, first.id);
  await linkProjectOrganization(operator, expired.id, second.id);
  await env.DB.prepare(
    "UPDATE projects SET status='CLOSED', closed_at=?, close_reason='MANUAL' WHERE id=?",
  )
    .bind("2026-07-21T00:00:00.000Z", closed.id)
    .run();
  await env.DB.prepare("UPDATE projects SET end_date='2026-07-21' WHERE id=?")
    .bind(expired.id)
    .run();

  for (const [projectId, organizationId] of [
    [closed.id, first.id],
    [expired.id, second.id],
  ]) {
    const add = await authedRequest(
      operator,
      `/api/v1/projects/${projectId}/organizations`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId }),
      },
    );
    expect(add.status).toBe(409);
    expect(await add.json()).toMatchObject({ code: "PROJECT_CLOSED" });
    const disable = await authedRequest(
      operator,
      `/api/v1/projects/${projectId}/organizations/${organizationId}`,
      { method: "PATCH", body: JSON.stringify({ isActive: false }) },
    );
    expect(disable.status).toBe(409);
    expect(await disable.json()).toMatchObject({ code: "PROJECT_CLOSED" });
  }
});

async function linkProjectOrganization(
  operator: Awaited<ReturnType<typeof seedOperator>>,
  projectId: string,
  organizationId: string,
) {
  const response = await authedRequest(
    operator,
    `/api/v1/projects/${projectId}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({ organizationId }),
    },
  );
  expect(response.status).toBe(201);
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
