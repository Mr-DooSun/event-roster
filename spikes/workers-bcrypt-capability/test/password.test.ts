import bcrypt from "bcryptjs";
import { expect, it } from "vitest";
import {
  assertCostTwelveHash,
  BCRYPT_COST,
  hashPassword,
  verifyPassword,
} from "../src/password";

it("creates a cost-12 bcrypt hash that verifies only the original password", async () => {
  const hash = await hashPassword("temporary-password-123");
  expect(BCRYPT_COST).toBe(12);
  expect(assertCostTwelveHash(hash)).toBeUndefined();
  await expect(verifyPassword("temporary-password-123", hash)).resolves.toBe(
    true,
  );
  await expect(verifyPassword("different-password-123", hash)).resolves.toBe(
    false,
  );
});

it("rejects a structurally valid bcrypt hash with a different cost", async () => {
  const costTenHash = await bcrypt.hash("test-only-cost-ten-password", 10);
  expect(() => assertCostTwelveHash(costTenHash)).toThrow();
});
