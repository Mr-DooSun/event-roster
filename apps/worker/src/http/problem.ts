import type { ApiProblem, ApiProblemCode } from "@event-roster/contracts";

export class HttpProblem extends Error {
  readonly code: ApiProblemCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ApiProblemCode,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HttpProblem";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function problemResponse(
  problem: HttpProblem,
  requestId: string,
): Response {
  const body: ApiProblem = {
    code: problem.code,
    message: problem.message,
    requestId,
    ...(problem.details === undefined ? {} : { details: problem.details }),
  };

  return Response.json(body, {
    status: problem.status,
    headers: { "Cache-Control": "no-store" },
  });
}
