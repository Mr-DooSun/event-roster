const encoder = new TextEncoder();

export const KDF_POLICY = {
  algorithm: "PBKDF2-HMAC-SHA-256",
  iterations: 600_000,
  saltBytes: 16,
  hashBytes: 32,
} as const;

export interface PasswordCredential {
  algorithm: typeof KDF_POLICY.algorithm;
  iterations: typeof KDF_POLICY.iterations;
  salt: string;
  hash: string;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const output = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function pepperPassword(
  password: string,
  pepper: string,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(password.normalize("NFC")),
  );
}

export async function derivePassword(
  password: string,
  pepper: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const pepperedPassword = await pepperPassword(password, pepper);
  const material = await crypto.subtle.importKey(
    "raw",
    pepperedPassword,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      iterations: KDF_POLICY.iterations,
      name: "PBKDF2",
      salt,
    },
    material,
    KDF_POLICY.hashBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function createCredential(
  password: string,
  pepper: string,
): Promise<PasswordCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(KDF_POLICY.saltBytes));
  const hash = await derivePassword(password, pepper, salt);
  return {
    algorithm: KDF_POLICY.algorithm,
    iterations: KDF_POLICY.iterations,
    salt: encodeBase64Url(salt),
    hash: encodeBase64Url(hash),
  };
}

export async function verifyCredential(
  password: string,
  credential: PasswordCredential,
  pepper: string,
): Promise<boolean> {
  if (
    credential.algorithm !== KDF_POLICY.algorithm ||
    credential.iterations !== KDF_POLICY.iterations
  ) {
    return false;
  }
  const expected = decodeBase64Url(credential.hash);
  const actual = await derivePassword(
    password,
    pepper,
    decodeBase64Url(credential.salt),
  );
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}
