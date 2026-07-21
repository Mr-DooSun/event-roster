import { DomainError } from "@event-roster/domain";
import { verifyCsrfToken } from "../auth/csrf";
import type { Actor } from "./authentication";

export async function requireCsrf(
  request: Request,
  actor: Actor,
): Promise<void> {
  const raw = request.headers.get("X-ER-CSRF");
  if (!raw || !(await verifyCsrfToken(raw, actor.session.csrfHash))) {
    throw new DomainError("INVALID_CSRF");
  }
}
