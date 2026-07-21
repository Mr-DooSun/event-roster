import { DomainError } from "@event-roster/domain";
import type { Actor } from "./authentication";

export function requireFullSession(actor: Actor): void {
  if (actor.session.kind !== "FULL") {
    throw new DomainError("FORBIDDEN");
  }
}

export function requireOperator(actor: Actor): void {
  requireFullSession(actor);
  if (actor.session.user.role !== "OPERATOR") {
    throw new DomainError("FORBIDDEN");
  }
}
