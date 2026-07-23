import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Env } from "../src/env";
import { requireActor } from "../src/middleware/authentication";
import { updateOrganization } from "../src/services/organizations";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import {
  authenticatedHeaders,
  login,
  resetAuthState,
  seedUser,
} from "./support/auth";

beforeEach(resetAuthState);

it("returns a generated temporary password once without persisting plaintext", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const response = await authedRequest(operator, "/api/v1/users", {
    method: "POST",
    body: JSON.stringify({
      loginId: "team.manager",
      displayName: "조직 담당자",
      role: "ORGANIZATION_MANAGER",
    }),
  });
  const body = await response.json<{ id: string; temporaryPassword: string }>();

  expect(response.status).toBe(201);
  expect(body.temporaryPassword).toHaveLength(20);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const raw = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM password_credentials WHERE password_hash = ?",
  )
    .bind(body.temporaryPassword)
    .first<{ count: number }>();
  expect(raw?.count).toBe(0);
  const passwordHash = await env.DB.prepare(
    "SELECT password_hash FROM password_credentials WHERE user_id = ?",
  )
    .bind(body.id)
    .first<{ password_hash: string }>();
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_logs WHERE action='USER_CREATED' AND entity_id=?",
  )
    .bind(body.id)
    .first<{ details_json: string }>();
  expect(passwordHash).not.toBeNull();
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    userId: body.id,
    before: { displayName: null, role: null, isActive: null },
    after: {
      displayName: "조직 담당자",
      role: "ORGANIZATION_MANAGER",
      isActive: true,
    },
  });
  expect(audit?.details_json).not.toContain(body.temporaryPassword);
  expect(audit?.details_json).not.toContain(passwordHash?.password_hash);
  expect(
    (await login("team.manager", body.temporaryPassword)).body.session
      .sessionKind,
  ).toBe("MUST_CHANGE_PASSWORD");
});

it("allows only operators to manage organizations", async () => {
  await seedOrganization();
  const manager = await seedManager();
  const forbidden = await authedRequest(manager, "/api/v1/organizations", {
    method: "POST",
    body: JSON.stringify({ name: "2팀" }),
  });
  expect(forbidden.status).toBe(403);
});

it("revokes sessions when an account is deactivated", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const manager = await seedManager();
  const response = await authedRequest(operator, "/api/v1/users/manager-user", {
    method: "PATCH",
    body: JSON.stringify({ isActive: false }),
  });
  expect(response.status).toBe(200);
  expect(
    (
      await authedRequest(manager, "/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${manager.body.accessToken}` },
      })
    ).status,
  ).toBe(401);
});

it("allows only one concurrent password reset result to remain valid", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const manager = await seedManager();
  const reset = () =>
    authedRequest(operator, "/api/v1/users/manager-user/password-reset", {
      method: "POST",
    });
  const responses = await Promise.all([reset(), reset()]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  const success = responses.find((response) => response.status === 200);
  const body = await success?.json<{ temporaryPassword: string }>();
  expect(body?.temporaryPassword).toHaveLength(20);
  const oldSession = await authedRequest(manager, "/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${manager.body.accessToken}` },
  });
  expect(oldSession.status).toBe(401);
  expect(
    (await login("manager-02", body?.temporaryPassword ?? "")).response.status,
  ).toBe(200);
  const audit = await env.DB.prepare(
    "SELECT details_json FROM audit_logs WHERE action='PASSWORD_RESET' AND entity_id='manager-user'",
  ).first<{ details_json: string }>();
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    userId: "manager-user",
  });
  expect(audit?.details_json).not.toContain(body?.temporaryPassword);
});

it("rejects organization assignment through the generic user endpoint", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const response = await authedRequest(operator, "/api/v1/users", {
    method: "POST",
    body: JSON.stringify({
      loginId: "manager.invalid",
      displayName: "잘못된 경로",
      role: "ORGANIZATION_MANAGER",
      organizationIds: ["org-1"],
    }),
  });
  expect(response.status).toBe(422);
});

it("writes sanitized user update and active-state audit actions", async () => {
  const operator = await seedOperator();
  await seedUser({ id: "audit-user", loginId: "audit-user" });
  await env.DB.prepare(
    "UPDATE users SET role='ORGANIZATION_MANAGER', display_name='변경 전' WHERE id='audit-user'",
  ).run();

  expect(
    (
      await authedRequest(operator, "/api/v1/users/audit-user", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "변경 후" }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await authedRequest(operator, "/api/v1/users/audit-user", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await authedRequest(operator, "/api/v1/users/audit-user", {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      })
    ).status,
  ).toBe(200);

  const rows = await env.DB.prepare(
    "SELECT action, details_json FROM audit_logs WHERE entity_id='audit-user' ORDER BY occurred_at, id",
  ).all<{ action: string; details_json: string }>();
  expect(rows.results.map((row) => row.action).sort()).toEqual([
    "USER_DEACTIVATED",
    "USER_REACTIVATED",
    "USER_UPDATED",
  ]);
  for (const row of rows.results) {
    const details = JSON.parse(row.details_json);
    expect(Object.keys(details).sort()).toEqual(["after", "before", "userId"]);
    expect(Object.keys(details.before).sort()).toEqual([
      "displayName",
      "isActive",
      "role",
    ]);
    expect(Object.keys(details.after).sort()).toEqual([
      "displayName",
      "isActive",
      "role",
    ]);
    expect(row.details_json).not.toMatch(
      /password|hash|token|csrf|recovery|ip/i,
    );
  }
});

it("preserves assignments when rejecting an assigned manager role change and allows it after removal", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  await seedManager();

  const rejected = await authedRequest(operator, "/api/v1/users/manager-user", {
    method: "PATCH",
    body: JSON.stringify({ role: "OPERATOR" }),
  });
  expect(rejected.status).toBe(409);
  expect(
    await env.DB.prepare(
      `SELECT u.role, COUNT(uo.organization_id) AS assignment_count
       FROM users u LEFT JOIN user_organizations uo ON uo.user_id=u.id
       WHERE u.id='manager-user' GROUP BY u.id`,
    ).first(),
  ).toEqual({ role: "ORGANIZATION_MANAGER", assignment_count: 1 });

  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/org-1/managers/manager-user",
        { method: "DELETE" },
      )
    ).status,
  ).toBe(204);
  const allowed = await authedRequest(operator, "/api/v1/users/manager-user", {
    method: "PATCH",
    body: JSON.stringify({ role: "OPERATOR" }),
  });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toMatchObject({ role: "OPERATOR" });
});

it("rejects a stale rename after a concurrent deactivate without resurrecting or auditing it", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(operator),
    }),
    env as Env,
  );
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          "UPDATE organizations SET is_active = 0 WHERE id = 'org-1'",
        ).run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    updateOrganization({ ...(env as Env), DB: raceDb }, actor, "org-1", {
      name: "stale rename",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await env.DB.prepare(
      "SELECT name, canonical_name, is_active FROM organizations WHERE id = 'org-1'",
    ).first(),
  ).toEqual({ name: "1팀", canonical_name: "1팀", is_active: 0 });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type = 'ORGANIZATION' AND entity_id = 'org-1'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("rejects a stale deactivate after a concurrent rename without losing or auditing the rename", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(operator),
    }),
    env as Env,
  );
  let pending = true;
  const raceDb = {
    prepare: (query: string) => env.DB.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      if (pending) {
        pending = false;
        await env.DB.prepare(
          `UPDATE organizations
           SET name = 'concurrent rename', canonical_name = 'concurrent rename'
           WHERE id = 'org-1'`,
        ).run();
      }
      return env.DB.batch(statements);
    },
  } as D1Database;

  await expect(
    updateOrganization({ ...(env as Env), DB: raceDb }, actor, "org-1", {
      isActive: false,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await env.DB.prepare(
      "SELECT name, canonical_name, is_active FROM organizations WHERE id = 'org-1'",
    ).first(),
  ).toEqual({
    name: "concurrent rename",
    canonical_name: "concurrent rename",
    is_active: 1,
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type = 'ORGANIZATION' AND entity_id = 'org-1'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
});

it("revalidates the operator session for a no-op organization update", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const actor = await requireActor(
    new Request("https://event-roster.test", {
      headers: authenticatedHeaders(operator),
    }),
    env as Env,
  );
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?")
    .bind("2026-07-23T00:00:00.000Z", actor.session.id)
    .run();

  await expect(
    updateOrganization(env as Env, actor, "org-1", { name: "1팀" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type = 'ORGANIZATION' AND entity_id = 'org-1'",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);
});
