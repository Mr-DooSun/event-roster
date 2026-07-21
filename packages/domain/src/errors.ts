import type { ApiProblemCode } from "@event-roster/contracts";

export class DomainError extends Error {
  readonly code: ApiProblemCode;
  readonly details?: unknown;

  constructor(code: ApiProblemCode, details?: unknown) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}
