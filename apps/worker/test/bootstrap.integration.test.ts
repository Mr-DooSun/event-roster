import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { createBootstrapAccount } from "../src/services/bootstrap";
import {
  apiRequest,
  authenticatedHeaders,
  cookieHeader,
  login,
  resetAuthState,
} from "./support/auth";

beforeEach(resetAuthState);

it("hands bootstrap access to the first individual operator once", async () => {
  const bootstrap = await apiRequest("/api/v1/bootstrap", {
    method: "POST",
    headers: { "X-Bootstrap-Token": "local-bootstrap-token" },
    body: JSON.stringify({
      loginId: "bootstrap",
      displayName: "초기 설정 계정",
      password: "bootstrap-password-123",
    }),
  });
  expect(bootstrap.status).toBe(201);
  expect(bootstrap.headers.get("Cache-Control")).toBe("no-store");

  const bootstrapLogin = await login("bootstrap", "bootstrap-password-123");
  const handoff = await apiRequest("/api/v1/bootstrap/first-operator", {
    method: "POST",
    headers: authenticatedHeaders(bootstrapLogin),
    body: JSON.stringify({ loginId: "operator-01", displayName: "첫 운영자" }),
  });
  const oneTime = await handoff.json<{
    temporaryPassword: string;
    recoveryCode: string;
  }>();

  expect(handoff.status).toBe(201);
  expect(oneTime.temporaryPassword).toHaveLength(20);
  expect(oneTime.recoveryCode).toBeTruthy();
  const operatorLogin = await login("operator-01", oneTime.temporaryPassword);
  expect(operatorLogin.body.session.sessionKind).toBe("MUST_CHANGE_PASSWORD");

  const changed = await apiRequest("/api/v1/auth/change-password", {
    method: "POST",
    headers: authenticatedHeaders(operatorLogin),
    body: JSON.stringify({
      currentPassword: oneTime.temporaryPassword,
      newPassword: "operator-password-123",
    }),
  });
  expect(changed.status).toBe(204);
  expect(
    (await login("bootstrap", "bootstrap-password-123")).response.status,
  ).toBe(401);
  const bootstrapRefresh = await env.DB.prepare(
    `SELECT r.revoked_at FROM refresh_tokens r
     JOIN auth_sessions s ON s.id = r.session_id
     JOIN users u ON u.id = s.user_id
     WHERE u.is_bootstrap = 1`,
  ).first<{ revoked_at: string | null }>();
  expect(bootstrapRefresh?.revoked_at).not.toBeNull();
});

it("retires bootstrap access when the first operator uses recovery", async () => {
  await apiRequest("/api/v1/bootstrap", {
    method: "POST",
    headers: { "X-Bootstrap-Token": "local-bootstrap-token" },
    body: JSON.stringify({
      loginId: "bootstrap",
      displayName: "초기 설정 계정",
      password: "bootstrap-password-123",
    }),
  });
  const bootstrapLogin = await login("bootstrap", "bootstrap-password-123");
  const handoff = await apiRequest("/api/v1/bootstrap/first-operator", {
    method: "POST",
    headers: authenticatedHeaders(bootstrapLogin),
    body: JSON.stringify({ loginId: "operator-01", displayName: "첫 운영자" }),
  });
  const oneTime = await handoff.json<{
    temporaryPassword: string;
    recoveryCode: string;
  }>();

  const recovered = await apiRequest("/api/v1/auth/recover", {
    method: "POST",
    body: JSON.stringify({
      loginId: "operator-01",
      recoveryCode: oneTime.recoveryCode,
      newPassword: "operator-recovered-password-123",
    }),
  });

  expect(recovered.status).toBe(204);
  expect(
    (await login("bootstrap", "bootstrap-password-123")).response.status,
  ).toBe(401);
  expect(
    (
      await apiRequest("/api/v1/auth/refresh", {
        method: "POST",
        headers: { Cookie: cookieHeader(bootstrapLogin.cookie) },
      })
    ).status,
  ).toBe(401);
  const lock = await env.DB.prepare(
    "SELECT consumed_at FROM bootstrap_locks WHERE id = 1",
  ).first<{ consumed_at: string | null }>();
  expect(lock?.consumed_at).not.toBeNull();
});

it("allows only one concurrent bootstrap creation", async () => {
  const create = (loginId: string) =>
    apiRequest("/api/v1/bootstrap", {
      method: "POST",
      headers: { "X-Bootstrap-Token": "local-bootstrap-token" },
      body: JSON.stringify({
        loginId,
        displayName: "초기 설정 계정",
        password: "bootstrap-password-123",
      }),
    });

  const responses = await Promise.all([
    create("bootstrap-a"),
    create("bootstrap-b"),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
});

it("allows only one concurrent first-operator handoff", async () => {
  await apiRequest("/api/v1/bootstrap", {
    method: "POST",
    headers: { "X-Bootstrap-Token": "local-bootstrap-token" },
    body: JSON.stringify({
      loginId: "bootstrap",
      displayName: "초기 설정 계정",
      password: "bootstrap-password-123",
    }),
  });
  const bootstrapLogin = await login("bootstrap", "bootstrap-password-123");
  const handoff = (loginId: string) =>
    apiRequest("/api/v1/bootstrap/first-operator", {
      method: "POST",
      headers: authenticatedHeaders(bootstrapLogin),
      body: JSON.stringify({ loginId, displayName: "첫 운영자" }),
    });

  const responses = await Promise.all([
    handoff("operator-a"),
    handoff("operator-b"),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
});

it("maps bootstrap password hashing failures to temporary unavailability", async () => {
  await expect(
    createBootstrapAccount(env, {
      loginId: "bootstrap",
      displayName: "초기 설정 계정",
      password: `${"가".repeat(24)}a`,
    }),
  ).rejects.toMatchObject({ code: "AUTH_TEMPORARILY_UNAVAILABLE" });
});
