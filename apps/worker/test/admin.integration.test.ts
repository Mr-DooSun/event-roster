import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
} from "./support/admin";
import { login, resetAuthState } from "./support/auth";

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
