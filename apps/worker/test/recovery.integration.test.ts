import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  createRecoveryCodeHash,
  recoverAccount,
} from "../src/services/recovery";
import { apiRequest, login, resetAuthState, seedUser } from "./support/auth";

beforeEach(resetAuthState);

it("consumes a recovery code once and revokes existing sessions", async () => {
  await seedUser();
  const existing = await login();
  const recoveryCode = "offline-recovery-code";
  const codeHash = await createRecoveryCodeHash(
    recoveryCode,
    env.RECOVERY_CODE_PEPPER,
  );
  await env.DB.prepare(
    "INSERT INTO recovery_codes (id, user_id, code_hash, issued_at) VALUES ('recovery-1', 'user-1', ?, '2026-07-21T00:00:00.000Z')",
  )
    .bind(codeHash)
    .run();

  const recovered = await apiRequest("/api/v1/auth/recover", {
    method: "POST",
    body: JSON.stringify({
      loginId: "manager-01",
      recoveryCode,
      newPassword: "recovered-password-123",
    }),
  });
  expect(recovered.status).toBe(204);
  expect(
    (
      await apiRequest("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${existing.body.accessToken}` },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await apiRequest("/api/v1/auth/recover", {
        method: "POST",
        body: JSON.stringify({
          loginId: "manager-01",
          recoveryCode,
          newPassword: "another-password-123",
        }),
      })
    ).status,
  ).toBe(401);
  expect(
    (await login("manager-01", "recovered-password-123")).response.status,
  ).toBe(200);
});

it("allows only one concurrent recovery-code consumer", async () => {
  await seedUser();
  const recoveryCode = "offline-recovery-code";
  const codeHash = await createRecoveryCodeHash(
    recoveryCode,
    env.RECOVERY_CODE_PEPPER,
  );
  await env.DB.prepare(
    "INSERT INTO recovery_codes (id, user_id, code_hash, issued_at) VALUES ('recovery-race', 'user-1', ?, '2026-07-21T00:00:00.000Z')",
  )
    .bind(codeHash)
    .run();
  const recover = (newPassword: string) =>
    apiRequest("/api/v1/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        loginId: "manager-01",
        recoveryCode,
        newPassword,
      }),
    });

  const responses = await Promise.all([
    recover("recovered-password-123"),
    recover("other-password-1234"),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    204, 401,
  ]);
});

it("rejects an invalid recovery code before password hashing", async () => {
  await seedUser();
  await expect(
    recoverAccount(env, {
      loginId: "manager-01",
      recoveryCode: "invalid-code",
      newPassword: `${"가".repeat(24)}a`,
    }),
  ).rejects.toMatchObject({ code: "INVALID_RECOVERY_CODE" });
});

it("does not let a stale password change overwrite a concurrent recovery", async () => {
  await seedUser({ mustChange: true });
  const existing = await login();
  const recoveryCode = "offline-recovery-code";
  const codeHash = await createRecoveryCodeHash(
    recoveryCode,
    env.RECOVERY_CODE_PEPPER,
  );
  await env.DB.prepare(
    "INSERT INTO recovery_codes (id, user_id, code_hash, issued_at) VALUES ('recovery-change-race', 'user-1', ?, '2026-07-21T00:00:00.000Z')",
  )
    .bind(codeHash)
    .run();

  await Promise.allSettled([
    apiRequest("/api/v1/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        loginId: "manager-01",
        recoveryCode,
        newPassword: "recovered-password-123",
      }),
    }),
    apiRequest("/api/v1/auth/change-password", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${existing.body.accessToken}`,
        "X-ER-CSRF": existing.body.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: "password-1234",
        newPassword: "stale-change-password-123",
      }),
    }),
  ]);

  expect(
    (await login("manager-01", "recovered-password-123")).response.status,
  ).toBe(200);
  expect(
    (await login("manager-01", "stale-change-password-123")).response.status,
  ).toBe(401);
});
