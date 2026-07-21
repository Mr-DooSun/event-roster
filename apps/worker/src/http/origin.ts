import { DomainError } from "@event-roster/domain";

export function assertExactOrigin(request: Request, appOrigin: string): void {
  if (request.headers.get("Origin") !== appOrigin) {
    throw new DomainError("INVALID_CSRF");
  }
}
