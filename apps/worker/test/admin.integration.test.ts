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
import { authenticatedHeaders, login, resetAuthState } from "./support/auth";

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
      organizationIds: ["org-1"],
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
});

it("revokes sessions after organization-link changes", async () => {
  const operator = await seedOperator();
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  const manager = await seedManager("org-1");
  const changed = await authedRequest(operator, "/api/v1/users/manager-user", {
    method: "PATCH",
    body: JSON.stringify({ organizationIds: ["org-2"] }),
  });
  expect(changed.status).toBe(200);
  expect(
    (
      await authedRequest(manager, "/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${manager.body.accessToken}` },
      })
    ).status,
  ).toBe(401);
});

it("rejects duplicate organization links as validation errors", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const response = await authedRequest(operator, "/api/v1/users", {
    method: "POST",
    body: JSON.stringify({
      loginId: "duplicate.links",
      displayName: "중복 담당자",
      role: "ORGANIZATION_MANAGER",
      organizationIds: ["org-1", "org-1"],
    }),
  });
  expect(response.status).toBe(422);
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
