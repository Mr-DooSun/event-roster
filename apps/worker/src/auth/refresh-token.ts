const TOKEN_BYTES = 32;
const REFRESH_MAX_AGE_SECONDS = 604_800;
const COOKIE_PREFIX = "__Host-er_refresh=";
const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";

export type RandomBytes = (length: number) => Uint8Array;

export function createRefreshToken(
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const bytes = randomBytes(TOKEN_BYTES);
  if (bytes.byteLength !== TOKEN_BYTES) {
    throw new Error("INVALID_RANDOM_BYTES");
  }
  return encodeBase64Url(bytes);
}

export async function hashRefreshToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export function createRefreshCookie(raw: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(raw)) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }
  return `${COOKIE_PREFIX}${raw}; Path=/; Max-Age=${REFRESH_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearRefreshCookie(): string {
  return `${COOKIE_PREFIX}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function defaultRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export const refreshCookieName = COOKIE_PREFIX.slice(0, -1);
export const refreshCookieAttributes = COOKIE_ATTRIBUTES;
