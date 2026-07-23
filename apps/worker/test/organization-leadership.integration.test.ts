import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedOperator, seedOrganization } from "./support/admin";
import { resetAuthState } from "./support/auth";
import { seedLeadershipFixture } from "./support/organization-leadership";

beforeEach(resetAuthState);

it("returns searchable organization summaries and a complete operator detail", async () => {
  const { operator } = await seedLeadershipFixture();
  const list = await authedRequest(
    operator,
    "/api/v1/organizations?query=1%ED%8C%80&status=ACTIVE&leaderStatus=ASSIGNED",
  );

  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([
    expect.objectContaining({
      id: "org-1",
      primaryLeader: { userId: "leader-1", displayName: "대표 조직장" },
      managerCount: 2,
      projectCount: 2,
    }),
  ]);

  const detail = await authedRequest(operator, "/api/v1/organizations/org-1");
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: "org-1",
    managers: [
      expect.objectContaining({
        userId: "leader-1",
        assignmentRole: "PRIMARY_LEADER",
      }),
      expect.objectContaining({
        userId: "manager-2",
        assignmentRole: "MANAGER",
      }),
      expect.objectContaining({
        userId: "manager-3",
        assignmentRole: "MANAGER",
      }),
    ],
    projects: [
      expect.objectContaining({ projectId: "project-active" }),
      expect.objectContaining({ projectId: "project-closed" }),
    ],
  });
});

it("filters by leader and active status while treating search metacharacters literally", async () => {
  const { operator } = await seedLeadershipFixture();
  await seedOrganization("org-inactive", "휴면_100%\\팀", false);

  const unassigned = await authedRequest(
    operator,
    "/api/v1/organizations?leaderStatus=UNASSIGNED",
  );
  expect(await unassigned.json<Array<{ id: string }>>()).toEqual([
    expect.objectContaining({ id: "org-2" }),
    expect.objectContaining({ id: "org-inactive" }),
  ]);

  const inactive = await authedRequest(
    operator,
    "/api/v1/organizations?query=_100%25%5C&status=INACTIVE",
  );
  expect(await inactive.json<Array<{ id: string }>>()).toEqual([
    expect.objectContaining({ id: "org-inactive" }),
  ]);

  const empty = await authedRequest(
    operator,
    "/api/v1/organizations?query=%20%20%20",
  );
  expect(empty.status).toBe(200);
  expect(await empty.json<Array<unknown>>()).toHaveLength(3);

  const malformed = await authedRequest(
    operator,
    "/api/v1/organizations?status=ARCHIVED&unexpected=true",
  );
  expect(malformed.status).toBe(422);
});

it("keeps manager organization summaries scoped and denies administration reads", async () => {
  const { manager } = await seedLeadershipFixture();
  const list = await authedRequest(manager, "/api/v1/organizations");
  expect(await list.json<Array<{ id: string }>>()).toEqual([
    expect.objectContaining({ id: "org-1" }),
  ]);

  for (const path of [
    "/api/v1/organizations/org-1",
    "/api/v1/organizations/org-1/assignable-users?query=manager",
    "/api/v1/organizations/org-1/audit",
  ]) {
    expect((await authedRequest(manager, path)).status).toBe(403);
  }
});

it("searches only active unassigned manager accounts and validates the organization", async () => {
  const { operator } = await seedLeadershipFixture();
  await env.DB.prepare(
    "UPDATE users SET display_name='후보 기존 관리자' WHERE id='manager-2'",
  ).run();
  for (const [id, loginId, displayName, role, isActive] of [
    [
      "candidate-active",
      "candidate-01",
      "후보 관리자",
      "ORGANIZATION_MANAGER",
      1,
    ],
    [
      "candidate-inactive",
      "candidate-02",
      "후보 비활성",
      "ORGANIZATION_MANAGER",
      0,
    ],
    ["candidate-operator", "candidate-03", "후보 운영자", "OPERATOR", 1],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO users
       (id, login_id, login_id_canonical, display_name, role, is_active,
        is_bootstrap, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    )
      .bind(
        id,
        loginId,
        loginId,
        displayName,
        role,
        isActive,
        "2026-07-23T00:00:00.000Z",
        "2026-07-23T00:00:00.000Z",
      )
      .run();
  }

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/assignable-users?query=%ED%9B%84%EB%B3%B4",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    {
      userId: "candidate-active",
      loginId: "candidate-01",
      displayName: "후보 관리자",
      isActive: true,
    },
  ]);

  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/missing/assignable-users?query=",
      )
    ).status,
  ).toBe(404);
});

it("paginates organization audit by timestamp and id and sanitizes all details", async () => {
  const { operator } = await seedLeadershipFixture();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('audit-a', ?, 'TEST_A', 'PROJECT_ORGANIZATION', 'project-active:org-1',
              '2026-07-23T01:00:00.000Z', ?)`).bind(
      operator.userId,
      JSON.stringify({
        projectId: "project-active",
        organizationId: "org-1",
        count: 2,
        active: true,
        passwordHash: "must-not-leak",
        nested: { csrfToken: "must-not-leak", safe: "visible" },
      }),
    ),
    env.DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('audit-z', ?, 'TEST_Z', 'ORGANIZATION', 'org-1',
              '2026-07-23T01:00:00.000Z', ?)`).bind(
      operator.userId,
      JSON.stringify({ organizationId: "org-1", token: "must-not-leak" }),
    ),
    env.DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('audit-other', ?, 'TEST_OTHER', 'ORGANIZATION', 'org-2',
              '2026-07-23T02:00:00.000Z', '{}')`).bind(operator.userId),
  ]);

  const first = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/audit?limit=1",
  );
  const firstPage = await first.json<{
    items: Array<{ id: string; details: Record<string, string> }>;
    nextCursor: string | null;
  }>();
  expect(first.status).toBe(200);
  expect(firstPage.items.map((item) => item.id)).toEqual(["audit-z"]);
  expect(firstPage.nextCursor).toBeTruthy();

  const second = await authedRequest(
    operator,
    `/api/v1/organizations/org-1/audit?limit=1&cursor=${encodeURIComponent(
      firstPage.nextCursor ?? "",
    )}`,
  );
  const secondPage = await second.json<{
    items: Array<{ id: string; details: Record<string, string> }>;
  }>();
  expect(secondPage.items.map((item) => item.id)).toEqual(["audit-a"]);
  expect(secondPage.items[0]?.details).toMatchObject({
    organizationId: "org-1",
    projectId: "project-active",
    count: "2",
    active: "true",
    nested: JSON.stringify({ safe: "visible" }),
  });
  expect(JSON.stringify(secondPage)).not.toContain("must-not-leak");

  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/org-1/audit?cursor=not-a-cursor",
      )
    ).status,
  ).toBe(422);
  expect(
    (await authedRequest(operator, "/api/v1/organizations/missing/audit"))
      .status,
  ).toBe(404);
});

it("writes exact sanitized audit rows for organization create, rename, and status changes", async () => {
  const operator = await seedOperator();
  const created = await authedRequest(operator, "/api/v1/organizations", {
    method: "POST",
    body: JSON.stringify({ name: "감사 조직" }),
  });
  const organization = await created.json<{ id: string }>();
  expect(created.status).toBe(201);

  const renamedAndDeactivated = await authedRequest(
    operator,
    `/api/v1/organizations/${organization.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "변경 조직", isActive: false }),
    },
  );
  expect(renamedAndDeactivated.status).toBe(200);
  expect(
    (
      await authedRequest(
        operator,
        `/api/v1/organizations/${organization.id}`,
        { method: "PATCH", body: JSON.stringify({ isActive: true }) },
      )
    ).status,
  ).toBe(200);

  const audit = await authedRequest(
    operator,
    `/api/v1/organizations/${organization.id}/audit?limit=20`,
  );
  const body = await audit.json<{
    items: Array<{ action: string; details: Record<string, string> }>;
  }>();
  expect(body.items.map((item) => item.action).sort()).toEqual([
    "ORGANIZATION_CREATED",
    "ORGANIZATION_DEACTIVATED",
    "ORGANIZATION_REACTIVATED",
    "ORGANIZATION_RENAMED",
  ]);
  for (const item of body.items) {
    expect(Object.keys(item.details).sort()).toEqual(["after", "before"]);
    expect(item.details).toEqual(
      expect.objectContaining({
        before: expect.any(String),
        after: expect.any(String),
      }),
    );
  }
  expect(JSON.stringify(body)).not.toMatch(
    /password|hash|token|csrf|recovery|ip/i,
  );
});
