import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
const COST_12_HASH = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;

export type AuthPrimitiveErrorCode =
  | "PASSWORD_TOO_LONG"
  | "INVALID_POLICY_HASH";

export class AuthPrimitiveError extends Error {
  readonly code: AuthPrimitiveErrorCode;

  constructor(code: AuthPrimitiveErrorCode) {
    super(code);
    this.name = "AuthPrimitiveError";
    this.code = code;
  }
}

export class BcryptPasswordHasher {
  async hash(password: string): Promise<string> {
    assertPasswordLength(password);
    return bcrypt.hash(password, BCRYPT_COST);
  }

  async verify(password: string, hash: string): Promise<boolean> {
    assertPasswordLength(password);
    if (!COST_12_HASH.test(hash)) {
      throw new AuthPrimitiveError("INVALID_POLICY_HASH");
    }

    return bcrypt.compare(password, hash);
  }
}

function assertPasswordLength(password: string): void {
  if (bcrypt.truncates(password)) {
    throw new AuthPrimitiveError("PASSWORD_TOO_LONG");
  }
}
