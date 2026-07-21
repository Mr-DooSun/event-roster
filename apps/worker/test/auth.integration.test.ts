import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { requireFullSession } from "../src/middleware/authorization";
import { loginWithCredentials } from "../src/services/auth";
import {
  apiRequest,
  authenticatedHeaders,
  cookieHeader,
  login,
  resetAuthState,
  seedUser,
} from "./support/auth";

describe("authentication lifecycle", () => {
  beforeEach(resetAuthState);

  it("logs in with a memory access token and secure refresh cookie", async () => {
    await seedUser();

    const result = await login();

    expect(result.response.status).toBe(200);
    expect(result.body.accessToken).toBeTruthy();
    expect(result.body.csrfToken).toBeTruthy();
    expect(result.body.session).toMatchObject({
      sessionKind: "FULL",
      user: { loginId: "manager-01", role: "OPERATOR" },
    });
    expect(result.cookie).toContain("__Host-er_refresh=");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("Secure");
    expect(result.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the same invalid-credential semantics for wrong and unknown IDs", async () => {
    await seedUser();

    const wrong = await login("manager-01", "wrong-password");
    const unknown = await login("nobody", "wrong-password");
    const wrongProblem = await wrong.response.json<{
      code: string;
      message: string;
    }>();
    const unknownProblem = await unknown.response.json<{
      code: string;
      message: string;
    }>();

    expect([wrong.response.status, unknown.response.status]).toEqual([
      401, 401,
    ]);
    expect({ code: wrongProblem.code, message: wrongProblem.message }).toEqual({
      code: unknownProblem.code,
      message: unknownProblem.message,
    });
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    await seedUser();
    const first = await login();

    const rotatedResponse = await apiRequest("/api/v1/auth/refresh", {
      method: "POST",
      headers: { Cookie: cookieHeader(first.cookie) },
    });
    const rotatedCookie = rotatedResponse.headers.get("Set-Cookie") ?? "";

    expect(rotatedResponse.status).toBe(200);
    expect(cookieHeader(rotatedCookie)).not.toBe(cookieHeader(first.cookie));
    expect(
      (
        await apiRequest("/api/v1/auth/refresh", {
          method: "POST",
          headers: { Cookie: cookieHeader(first.cookie) },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await apiRequest("/api/v1/auth/refresh", {
          method: "POST",
          headers: { Cookie: cookieHeader(rotatedCookie) },
        })
      ).status,
    ).toBe(401);
  });

  it("logs out by revoking the session family and clearing the cookie", async () => {
    await seedUser();
    const result = await login();
    const loggedOut = await apiRequest("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        ...authenticatedHeaders(result),
        Cookie: cookieHeader(result.cookie),
      },
    });

    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(
      (
        await apiRequest("/api/v1/auth/refresh", {
          method: "POST",
          headers: { Cookie: cookieHeader(result.cookie) },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await apiRequest("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${result.body.accessToken}` },
        })
      ).status,
    ).toBe(401);
  });

  it("revokes every session after a required password change", async () => {
    await seedUser({ mustChange: true });
    const first = await login();
    const second = await login();

    expect(first.body.session.sessionKind).toBe("MUST_CHANGE_PASSWORD");
    const changed = await apiRequest("/api/v1/auth/change-password", {
      method: "POST",
      headers: authenticatedHeaders(first),
      body: JSON.stringify({
        currentPassword: "password-1234",
        newPassword: "new-password-1234",
      }),
    });
    expect(changed.status).toBe(204);

    for (const token of [first.body.accessToken, second.body.accessToken]) {
      const me = await apiRequest("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(me.status).toBe(401);
    }
    expect((await login("manager-01", "password-1234")).response.status).toBe(
      401,
    );
    expect(
      (await login("manager-01", "new-password-1234")).response.status,
    ).toBe(200);
  });

  it("locks both login and IP keys before further password work", async () => {
    await seedUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (await login("manager-01", "wrong-password")).response.status,
      ).toBe(401);
    }

    const blocked = await login("manager-01", "wrong-password");
    expect(blocked.response.status).toBe(429);
    expect(await blocked.response.json<{ code: string }>()).toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("atomically counts concurrent failures and blocks before bcrypt", async () => {
    await seedUser();
    await Promise.all(
      Array.from({ length: 6 }, () => login("manager-01", "wrong-password")),
    );
    await env.DB.prepare(
      "UPDATE password_credentials SET password_hash = 'invalid-policy-hash'",
    ).run();

    const blocked = await login("manager-01", "wrong-password");
    expect(blocked.response.status).toBe(429);
  });

  it("clears failed-attempt keys after a successful login", async () => {
    await seedUser();
    expect((await login("manager-01", "wrong-password")).response.status).toBe(
      401,
    );
    expect((await login()).response.status).toBe(200);

    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM login_attempts",
    ).first<{ count: number }>();
    expect(attempts?.count).toBe(0);
  });

  it("stores only refresh and CSRF hashes", async () => {
    await seedUser();
    const result = await login();
    const rawRefresh = cookieHeader(result.cookie).split("=")[1];
    const stored = await env.DB.prepare(
      `SELECT r.token_hash, s.csrf_hash
       FROM refresh_tokens r JOIN auth_sessions s ON s.id = r.session_id`,
    ).first<{ token_hash: string; csrf_hash: string }>();

    expect(stored?.token_hash).not.toBe(rawRefresh);
    expect(stored?.csrf_hash).not.toBe(result.body.csrfToken);
    expect(JSON.stringify(stored)).not.toContain(rawRefresh);
    expect(JSON.stringify(stored)).not.toContain(result.body.csrfToken);
  });

  it("rejects expired refresh tokens and a wrong Origin", async () => {
    await seedUser();
    const result = await login();
    const wrongOrigin = await apiRequest("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: cookieHeader(result.cookie),
        Origin: "https://evil.example",
      },
    });
    expect(wrongOrigin.status).toBe(403);

    await env.DB.prepare(
      "UPDATE refresh_tokens SET expires_at = '2000-01-01T00:00:00.000Z'",
    ).run();
    const expired = await apiRequest("/api/v1/auth/refresh", {
      method: "POST",
      headers: { Cookie: cookieHeader(result.cookie) },
    });
    expect(expired.status).toBe(401);
  });

  it("allows one concurrent refresh and then revokes the whole family", async () => {
    await seedUser();
    const result = await login();
    const refresh = () =>
      apiRequest("/api/v1/auth/refresh", {
        method: "POST",
        headers: { Cookie: cookieHeader(result.cookie) },
      });

    const responses = await Promise.all([refresh(), refresh()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    const success = responses.find((response) => response.status === 200);
    const rotatedCookie = success?.headers.get("Set-Cookie") ?? "";
    expect(
      (
        await apiRequest("/api/v1/auth/refresh", {
          method: "POST",
          headers: { Cookie: cookieHeader(rotatedCookie) },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects a CSRF mismatch and restricts MUST_CHANGE sessions", async () => {
    await seedUser({ mustChange: true });
    const result = await login();
    const mismatch = await apiRequest("/api/v1/auth/change-password", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${result.body.accessToken}`,
        "X-ER-CSRF": "wrong-csrf",
      },
      body: JSON.stringify({
        currentPassword: "password-1234",
        newPassword: "new-password-1234",
      }),
    });
    expect(mismatch.status).toBe(403);
    expect(() =>
      requireFullSession({
        claims: {
          sub: "user-1",
          sid: "session-1",
          sv: 1,
          kind: "MUST_CHANGE_PASSWORD",
          iss: "event-roster",
          aud: "event-roster-web",
          iat: 1,
          exp: 2,
        },
        session: {
          id: "session-1",
          userId: "user-1",
          sessionVersion: 1,
          kind: "MUST_CHANGE_PASSWORD",
          csrfHash: "hash",
          expiresAt: "2099-01-01T00:00:00.000Z",
          revokedAt: null,
          user: {
            id: "user-1",
            loginId: "manager-01",
            displayName: "운영자",
            role: "OPERATOR",
            isActive: true,
            isBootstrap: false,
            sessionVersion: 1,
            passwordHash: "hash",
            mustChangePassword: true,
            organizationIds: [],
          },
        },
      }),
    ).toThrow("FORBIDDEN");
  });

  it("fails closed once when the stored policy hash is invalid", async () => {
    await seedUser();
    await env.DB.prepare(
      "UPDATE password_credentials SET password_hash = '$2b$10$9Q3XHF3Qx/OvVAnrL6l7wOZAVVfZWxT0gEEn7MZQt/8V.KVl/6d5K'",
    ).run();

    const response = await login();
    expect(response.response.status).toBe(503);
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM login_attempts",
    ).first<{ count: number }>();
    expect(attempts?.count).toBe(0);
  });

  it("fails closed when the configured dummy hash is invalid", async () => {
    await expect(
      loginWithCredentials(
        { ...env, DUMMY_BCRYPT_HASH: "invalid-dummy-hash" },
        {
          loginId: "unknown-user",
          password: "wrong-password",
          clientIp: "203.0.113.8",
        },
      ),
    ).rejects.toMatchObject({ code: "AUTH_TEMPORARILY_UNAVAILABLE" });
  });

  it("returns validation semantics for malformed JSON", async () => {
    const response = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: "{",
    });
    expect(response.status).toBe(422);
    expect(await response.json<{ code: string }>()).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
