import type { ApiProblemCode } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";

export function assertAffectedRows(
  result: D1Result,
  failureCode: ApiProblemCode = "STALE_REVISION",
): D1Result {
  if (result.meta.changes === 0) {
    throw new DomainError(failureCode);
  }

  return result;
}
