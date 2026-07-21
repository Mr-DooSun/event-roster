export const API_PROBLEM_CODES = [
  "AUTHENTICATION_REQUIRED",
  "AUTH_TEMPORARILY_UNAVAILABLE",
  "FORBIDDEN",
  "INVALID_CSRF",
  "INVALID_RECOVERY_CODE",
  "INVALID_TRANSITION",
  "EVENT_CLOSED",
  "STALE_REVISION",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
] as const;

export type ApiProblemCode = (typeof API_PROBLEM_CODES)[number];

export interface ApiProblem {
  code: ApiProblemCode;
  message: string;
  requestId: string;
  details?: unknown;
}
