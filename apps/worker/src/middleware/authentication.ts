import type { AccessClaims } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { verifyAccessToken } from "../auth/access-token";
import { findSessionById, type SessionRecord } from "../db/auth";
import type { Env } from "../env";

export interface Actor {
  claims: AccessClaims;
  session: SessionRecord;
}

export async function requireActor(
  request: Request,
  env: Env,
  now = new Date(),
): Promise<Actor> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  let claims: AccessClaims;
  try {
    claims = await verifyAccessToken(
      authorization.slice("Bearer ".length),
      env.JWT_SIGNING_KEY,
      now,
    );
  } catch {
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  const session = await findSessionById(env.DB, claims.sid);
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now.toISOString() ||
    !session.user.isActive ||
    session.user.sessionVersion !== claims.sv ||
    session.sessionVersion !== claims.sv ||
    session.kind !== claims.kind ||
    session.userId !== claims.sub
  ) {
    throw new DomainError("AUTHENTICATION_REQUIRED");
  }

  return { claims, session };
}
