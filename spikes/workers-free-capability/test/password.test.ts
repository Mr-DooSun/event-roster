import { expect, it } from "vitest";
import {
  createCredential,
  KDF_POLICY,
  verifyCredential,
} from "../src/password";

it("keeps the fixed 600,000-iteration policy and rejects a wrong password", async () => {
  const credential = await createCredential(
    "temporary-password-123",
    "test-pepper",
  );
  expect(KDF_POLICY).toMatchObject({
    algorithm: "PBKDF2-HMAC-SHA-256",
    iterations: 600_000,
    saltBytes: 16,
    hashBytes: 32,
  });
  await expect(
    verifyCredential("temporary-password-123", credential, "test-pepper"),
  ).resolves.toBe(true);
  await expect(
    verifyCredential("different-password-123", credential, "test-pepper"),
  ).resolves.toBe(false);
});
