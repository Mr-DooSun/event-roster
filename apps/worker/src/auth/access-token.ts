import type { AccessClaims, SessionKind } from "@event-roster/contracts";
import { jwtVerify, SignJWT } from "jose";

const ISSUER = "event-roster";
const AUDIENCE = "event-roster-web";
const ACCESS_TOKEN_TTL_SECONDS = 900;

export interface AccessTokenSubject {
  sub: string;
  sid: string;
  sv: number;
  kind: SessionKind;
}

export async function issueAccessToken(
  subject: AccessTokenSubject,
  signingKey: string,
  now: Date = new Date(),
): Promise<string> {
  assertAccessTokenSubject(subject);
  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({
    sid: subject.sid,
    sv: subject.sv,
    kind: subject.kind,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(subject.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(encodeSigningKey(signingKey));
}

export async function verifyAccessToken(
  token: string,
  signingKey: string,
  now: Date = new Date(),
): Promise<AccessClaims> {
  const { payload, protectedHeader } = await jwtVerify(
    token,
    encodeSigningKey(signingKey),
    {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    },
  );

  if (
    protectedHeader.typ !== "JWT" ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    !Number.isInteger(payload.sv) ||
    (payload.sv as number) < 1 ||
    (payload.kind !== "FULL" && payload.kind !== "MUST_CHANGE_PASSWORD") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("INVALID_ACCESS_TOKEN");
  }

  return {
    sub: payload.sub,
    sid: payload.sid,
    sv: payload.sv as number,
    kind: payload.kind,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: payload.iat,
    exp: payload.exp,
  };
}

function encodeSigningKey(signingKey: string): Uint8Array {
  return new TextEncoder().encode(signingKey);
}

function assertAccessTokenSubject(subject: AccessTokenSubject): void {
  if (
    !subject.sub ||
    !subject.sid ||
    !Number.isInteger(subject.sv) ||
    subject.sv < 1 ||
    (subject.kind !== "FULL" && subject.kind !== "MUST_CHANGE_PASSWORD")
  ) {
    throw new Error("INVALID_ACCESS_TOKEN_SUBJECT");
  }
}
