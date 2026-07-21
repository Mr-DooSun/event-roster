import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;

export function assertCostTwelveHash(passwordHash: string): void {
  if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    throw new Error("invalid_bcrypt_policy_hash");
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  assertCostTwelveHash(passwordHash);
  return bcrypt.compare(password, passwordHash);
}
