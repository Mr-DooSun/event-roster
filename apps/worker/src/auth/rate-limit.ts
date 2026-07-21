import { encodeBase64Url } from "./refresh-token";

export async function createLoginRateLimitKey(
  hmacSecret: string,
  loginId: string,
): Promise<string> {
  return createRateLimitKey(
    hmacSecret,
    "LOGIN_ID",
    loginId.trim().toLocaleLowerCase("en-US"),
  );
}

export async function createIpRateLimitKey(
  hmacSecret: string,
  ipAddress: string,
): Promise<string> {
  return createRateLimitKey(hmacSecret, "IP", ipAddress);
}

async function createRateLimitKey(
  hmacSecret: string,
  kind: "LOGIN_ID" | "IP",
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${kind}\u0000${value}`),
  );

  return encodeBase64Url(new Uint8Array(signature));
}
