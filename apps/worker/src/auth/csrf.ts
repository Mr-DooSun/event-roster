import {
  defaultRandomBytes,
  encodeBase64Url,
  type RandomBytes,
} from "./refresh-token";

const CSRF_BYTES = 32;

export function createCsrfToken(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const bytes = randomBytes(CSRF_BYTES);
  if (bytes.byteLength !== CSRF_BYTES) {
    throw new Error("INVALID_RANDOM_BYTES");
  }
  return encodeBase64Url(bytes);
}

export async function hashCsrfToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export async function verifyCsrfToken(
  raw: string,
  expectedHash: string,
): Promise<boolean> {
  return constantTimeEqual(await hashCsrfToken(raw), expectedHash);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}
