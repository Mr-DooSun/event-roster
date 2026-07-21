import type { ApiProblemCode } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";

export interface GuardedAtomicInput {
  guardId: string;
  guardStatement: D1PreparedStatement;
  statements: D1PreparedStatement[];
  failureCode: ApiProblemCode;
}

export async function runGuardedAtomic(
  db: D1Database,
  input: GuardedAtomicInput,
): Promise<D1Result[]> {
  const cleanup = db
    .prepare("DELETE FROM operation_guards WHERE id = ?")
    .bind(input.guardId);

  try {
    return await db.batch([input.guardStatement, ...input.statements, cleanup]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("GUARD_FAILED")) {
      throw new DomainError(input.failureCode);
    }
    throw error;
  }
}
