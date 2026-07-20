const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SessionClaims {
  sub: string;
  sid: string;
  sv: number;
  kind: string;
  iat: number;
  exp: number;
}

type SessionClaimsInput = Omit<SessionClaims, "iat" | "exp">;

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

function encodeJson(value: unknown): string {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

export async function issueSessionJwt(
  input: SessionClaimsInput,
  secret: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    ...input,
    iat: issuedAt,
    exp: issuedAt + 8 * 60 * 60,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionJwt(
  token: string,
  secret: string,
  now = new Date(),
): Promise<SessionClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid JWT");
  const [header, payload, signature] = parts as [string, string, string];
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    decodeBase64Url(signature),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error("invalid JWT signature");
  const parsedHeader = JSON.parse(decoder.decode(decodeBase64Url(header))) as {
    alg?: unknown;
    typ?: unknown;
  };
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") {
    throw new Error("invalid JWT header");
  }
  const claims = JSON.parse(
    decoder.decode(decodeBase64Url(payload)),
  ) as Partial<SessionClaims>;
  if (
    typeof claims.sub !== "string" ||
    typeof claims.sid !== "string" ||
    typeof claims.sv !== "number" ||
    typeof claims.kind !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("invalid JWT claims");
  }
  if (claims.exp <= Math.floor(now.getTime() / 1000)) {
    throw new Error("expired JWT");
  }
  return claims as SessionClaims;
}
