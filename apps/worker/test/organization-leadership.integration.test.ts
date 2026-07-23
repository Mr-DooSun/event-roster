import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { authedRequest, seedOperator, seedOrganization } from "./support/admin";
import { login, resetAuthState, seedUser } from "./support/auth";
import {
  seedLeadershipFixture,
  seedOperatorWithTwoOrganizations,
  seedTwoManagersAndPrimary,
} from "./support/organization-leadership";

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

it("assigns one primary and many managers while allowing one user across organizations", async () => {
  const operator = await seedOperatorWithTwoOrganizations();
  const created = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/managers",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "NEW",
        loginId: "team.leader",
        displayName: "대표 조직장",
        assignmentRole: "PRIMARY_LEADER",
      }),
    },
  );
  expect(created.status).toBe(201);
  expect(created.headers.get("Cache-Control")).toBe("no-store");
  const createdBody = await created.json<{
    manager: { userId: string; assignmentRole: string };
    temporaryPassword: string;
  }>();
  expect(createdBody).toMatchObject({
    manager: { assignmentRole: "PRIMARY_LEADER" },
    temporaryPassword: expect.stringMatching(/^.{20}$/),
  });

  const userId = createdBody.manager.userId;
  const second = await authedRequest(
    operator,
    "/api/v1/organizations/org-2/managers",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "EXISTING",
        userId,
        assignmentRole: "MANAGER",
      }),
    },
  );
  expect(second.status).toBe(201);
  expect(second.headers.get("Cache-Control")).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT organization_id, assignment_role FROM user_organizations WHERE user_id = ? ORDER BY organization_id",
    )
      .bind(userId)
      .all(),
  ).toMatchObject({
    results: [
      { organization_id: "org-1", assignment_role: "PRIMARY_LEADER" },
      { organization_id: "org-2", assignment_role: "MANAGER" },
    ],
  });

  const auditRows = await env.DB.prepare(
    `SELECT action, details_json FROM audit_logs
     WHERE entity_id = ? ORDER BY action`,
  )
    .bind(userId)
    .all<{ action: string; details_json: string }>();
  expect(auditRows.results.map((row) => row.action).sort()).toEqual([
    "ORGANIZATION_MANAGER_ASSIGNED",
    "ORGANIZATION_PRIMARY_ASSIGNED",
    "USER_CREATED",
  ]);
  for (const row of auditRows.results.filter((item) =>
    item.action.startsWith("ORGANIZATION_"),
  )) {
    expect(JSON.parse(row.details_json)).toEqual(
      expect.objectContaining({ organizationId: expect.any(String), userId }),
    );
  }
  expect(JSON.stringify(auditRows.results)).not.toContain(
    createdBody.temporaryPassword,
  );
  const organizationAudit = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/audit",
  );
  expect(
    (
      await organizationAudit.json<{
        items: Array<{ action: string }>;
      }>()
    ).items.map((item) => item.action),
  ).toEqual(expect.arrayContaining(["ORGANIZATION_PRIMARY_ASSIGNED"]));
});

it("revokes an existing account session when assigning it", async () => {
  const operator = await seedOperatorWithTwoOrganizations();
  await seedUser({
    id: "candidate-1",
    loginId: "candidate-1",
    password: "candidate-password-123",
  });
  await env.DB.prepare(
    "UPDATE users SET role='ORGANIZATION_MANAGER', display_name='기존 후보' WHERE id='candidate-1'",
  ).run();
  const candidate = await login("candidate-1", "candidate-password-123");

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/managers",
    {
      method: "POST",
      body: JSON.stringify({
        kind: "EXISTING",
        userId: "candidate-1",
        assignmentRole: "MANAGER",
      }),
    },
  );
  expect(response.status).toBe(201);
  expect(
    (
      await authedRequest(candidate, "/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${candidate.body.accessToken}` },
      })
    ).status,
  ).toBe(401);
  expect(
    await env.DB.prepare(
      "SELECT session_version FROM users WHERE id='candidate-1'",
    ).first(),
  ).toEqual({ session_version: 2 });
});

it("rejects inactive organizations, inactive targets, wrong roles, duplicates, and a second primary", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  await seedOrganization("org-inactive", "비활성 조직", false);
  await seedUser({ id: "inactive-user", loginId: "inactive-user" });
  await env.DB.prepare(
    "UPDATE users SET role='ORGANIZATION_MANAGER', is_active=0 WHERE id='inactive-user'",
  ).run();

  const cases = [
    ["org-inactive", "manager-2", "MANAGER"],
    ["org-2", "inactive-user", "MANAGER"],
    ["org-2", operator.userId, "MANAGER"],
    ["org-1", "manager-2", "MANAGER"],
    ["org-1", "manager-3", "PRIMARY_LEADER"],
  ] as const;
  for (const [organizationId, userId, assignmentRole] of cases) {
    const response = await authedRequest(
      operator,
      `/api/v1/organizations/${organizationId}/managers`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "EXISTING",
          userId,
          assignmentRole,
        }),
      },
    );
    expect(response.status).toBe(409);
  }
});

it("replaces a primary atomically and keeps the former primary as a manager", async () => {
  const { operator, manager } = await seedTwoManagersAndPrimary();
  const promotedManager = await login("manager-02", "manager-password-123");
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "MANAGER",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    primaryLeader: { userId: "manager-2" },
    managers: expect.arrayContaining([
      expect.objectContaining({
        userId: "leader-1",
        assignmentRole: "MANAGER",
      }),
    ]),
  });
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_logs WHERE action='ORGANIZATION_PRIMARY_REPLACED'",
  ).first<{ details_json: string }>();
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    organizationId: "org-1",
    previousPrimaryUserId: "leader-1",
    primaryUserId: "manager-2",
    previousPrimaryDisposition: "MANAGER",
  });
  expect((await authedRequest(manager, "/api/v1/auth/me")).status).toBe(401);
  expect((await authedRequest(promotedManager, "/api/v1/auth/me")).status).toBe(
    401,
  );
});

it("rejects an inactive assigned manager as the next primary without writes", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  await env.DB.prepare(
    "UPDATE users SET is_active=0 WHERE id='manager-2'",
  ).run();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "MANAGER",
      }),
    },
  );
  expect(response.status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT user_id FROM user_organizations WHERE organization_id='org-1' AND assignment_role='PRIMARY_LEADER'",
    ).first(),
  ).toEqual({ user_id: "leader-1" });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'ORGANIZATION_PRIMARY_%'",
    ).first(),
  ).toEqual({ count: 0 });
});

it("can remove the former primary during replacement without deleting either account", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "REMOVE",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT user_id, assignment_role FROM user_organizations WHERE organization_id='org-1' ORDER BY user_id",
    ).all(),
  ).toMatchObject({
    results: [
      { user_id: "manager-2", assignment_role: "PRIMARY_LEADER" },
      { user_id: "manager-3", assignment_role: "MANAGER" },
    ],
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE id IN ('leader-1', 'manager-2')",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(2);
});

it("removes a primary into a leaderless state while preserving its other assignments and account", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  await env.DB.prepare(`INSERT INTO user_organizations
    (user_id, organization_id, assignment_role, assigned_by, assigned_at)
    VALUES ('leader-1', 'org-2', 'MANAGER', ?, ?)`)
    .bind(operator.userId, "2026-07-23T00:00:00.000Z")
    .run();

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: null,
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "REMOVE",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ primaryLeader: null });
  expect(
    await env.DB.prepare(
      "SELECT organization_id, assignment_role FROM user_organizations WHERE user_id='leader-1'",
    ).all(),
  ).toMatchObject({
    results: [{ organization_id: "org-2", assignment_role: "MANAGER" }],
  });
  expect(
    await env.DB.prepare(
      "SELECT is_active FROM users WHERE id='leader-1'",
    ).first(),
  ).toEqual({ is_active: 1 });
});

it("assigns a primary to a leaderless organization from its active managers", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-2/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: null,
        previousPrimaryDisposition: "MANAGER",
      }),
    },
  );
  expect(response.status).toBe(409);

  await env.DB.prepare(`INSERT INTO user_organizations
    (user_id, organization_id, assignment_role, assigned_by, assigned_at)
    VALUES ('manager-2', 'org-2', 'MANAGER', ?, ?)`)
    .bind(operator.userId, "2026-07-23T00:00:00.000Z")
    .run();
  const assigned = await authedRequest(
    operator,
    "/api/v1/organizations/org-2/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "manager-2",
        expectedPrimaryUserId: null,
        previousPrimaryDisposition: "MANAGER",
      }),
    },
  );
  expect(assigned.status).toBe(200);
  expect(await assigned.json()).toMatchObject({
    primaryLeader: { userId: "manager-2" },
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action='ORGANIZATION_PRIMARY_ASSIGNED' AND entity_id='manager-2'",
    ).first(),
  ).toEqual({ count: 1 });
});

it("rejects stale concurrent primary replacements without extra assignment or audit writes", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const replace = (userId: string) =>
    authedRequest(operator, "/api/v1/organizations/org-1/primary", {
      method: "PATCH",
      body: JSON.stringify({
        userId,
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "MANAGER",
      }),
    });
  const responses = await Promise.all([
    replace("manager-2"),
    replace("manager-3"),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM user_organizations WHERE organization_id='org-1' AND assignment_role='PRIMARY_LEADER'",
    ).first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action='ORGANIZATION_PRIMARY_REPLACED'",
    ).first(),
  ).toEqual({ count: 1 });
});

it("treats replacing a primary with itself as a no-write operation", async () => {
  const { operator, manager } = await seedTwoManagersAndPrimary();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: "leader-1",
        expectedPrimaryUserId: "leader-1",
        previousPrimaryDisposition: "REMOVE",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    primaryLeader: { userId: "leader-1" },
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'ORGANIZATION_PRIMARY_%'",
    ).first(),
  ).toEqual({ count: 0 });
  expect((await authedRequest(manager, "/api/v1/auth/me")).status).toBe(200);
});

it("treats an already leaderless organization as a no-write primary removal", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-2/primary",
    {
      method: "PATCH",
      body: JSON.stringify({
        userId: null,
        expectedPrimaryUserId: null,
        previousPrimaryDisposition: "REMOVE",
      }),
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: "org-2",
    primaryLeader: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'ORGANIZATION_PRIMARY_%'",
    ).first(),
  ).toEqual({ count: 0 });
});

it("removes only additional managers, revokes their sessions, and never deletes accounts", async () => {
  const { operator } = await seedTwoManagersAndPrimary();
  const manager = await login("manager-02", "manager-password-123");
  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/org-1/managers/leader-1",
        { method: "DELETE" },
      )
    ).status,
  ).toBe(409);

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/org-1/managers/manager-2",
    { method: "DELETE" },
  );
  expect(response.status).toBe(204);
  expect((await authedRequest(manager, "/api/v1/auth/me")).status).toBe(401);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE id='manager-2'",
    ).first(),
  ).toEqual({ count: 1 });
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_logs WHERE action='ORGANIZATION_MANAGER_REMOVED'",
  ).first<{ details_json: string }>();
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    organizationId: "org-1",
    userId: "manager-2",
    beforeAssignmentRole: "MANAGER",
    afterAssignmentRole: null,
  });
});

it("rolls back new account provisioning when its assignment audit cannot be appended", async () => {
  const operator = await seedOperatorWithTwoOrganizations();
  await env.DB.prepare(`CREATE TRIGGER reject_assignment_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'ORGANIZATION_MANAGER_ASSIGNED'
    BEGIN SELECT RAISE(ABORT, 'AUDIT_REJECTED'); END`).run();
  try {
    const response = await authedRequest(
      operator,
      "/api/v1/organizations/org-1/managers",
      {
        method: "POST",
        body: JSON.stringify({
          kind: "NEW",
          loginId: "rollback-manager",
          displayName: "롤백 담당자",
          assignmentRole: "MANAGER",
        }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE login_id='rollback-manager'",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM password_credentials WHERE user_id IN (SELECT id FROM users WHERE login_id='rollback-manager')",
      ).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM user_organizations WHERE organization_id='org-1'",
      ).first(),
    ).toEqual({ count: 0 });
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS reject_assignment_audit",
    ).run();
  }
});

it("allows only non-bootstrap operators with full sessions to mutate organization assignments", async () => {
  const { operator, manager } = await seedTwoManagersAndPrimary();
  for (const [path, init] of [
    [
      "/api/v1/organizations/org-2/managers",
      {
        method: "POST",
        body: JSON.stringify({
          kind: "EXISTING",
          userId: "manager-2",
          assignmentRole: "MANAGER",
        }),
      },
    ],
    [
      "/api/v1/organizations/org-1/primary",
      {
        method: "PATCH",
        body: JSON.stringify({
          userId: "manager-2",
          expectedPrimaryUserId: "leader-1",
          previousPrimaryDisposition: "MANAGER",
        }),
      },
    ],
    ["/api/v1/organizations/org-1/managers/manager-2", { method: "DELETE" }],
  ] as const) {
    expect((await authedRequest(manager, path, init)).status).toBe(403);
  }
  expect(
    (
      await authedRequest(operator, "/api/v1/organizations/org-2/managers", {
        method: "POST",
        body: JSON.stringify({
          kind: "EXISTING",
          userId: "manager-2",
          assignmentRole: "MANAGER",
        }),
      })
    ).status,
  ).toBe(201);
});
