import { describe, expect, it } from "vitest";
import { BcryptPasswordHasher } from "../../src/auth/password";

describe("BcryptPasswordHasher", () => {
  it("uses cost 12 and verifies a valid password", async () => {
    const hasher = new BcryptPasswordHasher();
    const hash = await hasher.hash("temporary-password-123");

    expect(hash.startsWith("$2b$12$")).toBe(true);
    await expect(hasher.verify("temporary-password-123", hash)).resolves.toBe(
      true,
    );
    await expect(hasher.verify("wrong-password-123", hash)).resolves.toBe(
      false,
    );
  });

  it("rejects bcrypt truncation before hash or verification", async () => {
    const hasher = new BcryptPasswordHasher();
    const tooLong = `${"가".repeat(24)}a`;

    await expect(hasher.hash(tooLong)).rejects.toThrow("PASSWORD_TOO_LONG");
    await expect(
      hasher.verify(
        tooLong,
        "$2b$12$9Q3XHF3Qx/OvVAnrL6l7wOZAVVfZWxT0gEEn7MZQt/8V.KVl/6d5K",
      ),
    ).rejects.toThrow("PASSWORD_TOO_LONG");
  });

  it("fails closed for hashes outside the cost-12 policy", async () => {
    const hasher = new BcryptPasswordHasher();

    await expect(
      hasher.verify(
        "temporary-password-123",
        "$2b$10$9Q3XHF3Qx/OvVAnrL6l7wOZAVVfZWxT0gEEn7MZQt/8V.KVl/6d5K",
      ),
    ).rejects.toThrow("INVALID_POLICY_HASH");
  });
});
