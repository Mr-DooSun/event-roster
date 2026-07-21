export type ProbeOperation = "hash" | "correct" | "wrong" | "dummy";
export type EvidencePhase = "warmup" | "sequential" | "concurrent";

export interface EvidenceAttempt {
  phase: EvidencePhase;
  operation: ProbeOperation;
  status: number;
  milliseconds: number;
  response: { hashed?: boolean; verified?: boolean };
}

export interface CapabilityEvidence {
  runId: string;
  createdAt: string;
  attempts: EvidenceAttempt[];
}

const sequentialOperations = ["hash", "correct", "wrong", "dummy"] as const;
const expectedBoolean = {
  hash: { hashed: true },
  correct: { verified: true },
  wrong: { verified: false },
  dummy: { verified: false },
} as const;

function p95(milliseconds: number[]): number {
  const sorted = [...milliseconds].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

function assertAttemptShape(attempt: EvidenceAttempt): void {
  if (!Number.isFinite(attempt.milliseconds) || attempt.milliseconds < 0) {
    throw new Error("invalid milliseconds");
  }
  if (
    !Number.isInteger(attempt.status) ||
    attempt.status < 200 ||
    attempt.status >= 300
  ) {
    throw new Error("non-2xx status");
  }
}

function assertExactAttempts(
  evidence: CapabilityEvidence,
  phase: EvidencePhase,
  operation: ProbeOperation,
  count: number,
): EvidenceAttempt[] {
  const attempts = evidence.attempts.filter(
    (attempt) => attempt.phase === phase && attempt.operation === operation,
  );
  if (attempts.length !== count) {
    throw new Error(`${operation} count must be exactly ${count}`);
  }
  for (const attempt of attempts) {
    assertAttemptShape(attempt);
    const expected = expectedBoolean[operation];
    if (
      ("hashed" in expected && attempt.response.hashed !== expected.hashed) ||
      ("verified" in expected &&
        attempt.response.verified !== expected.verified)
    ) {
      throw new Error(`${operation} semantic result failed`);
    }
  }
  return attempts;
}

export function assertCapabilityPass(evidence: CapabilityEvidence): void {
  for (const operation of sequentialOperations) {
    assertExactAttempts(evidence, "warmup", operation, 3);
    const sequential = assertExactAttempts(
      evidence,
      "sequential",
      operation,
      50,
    );
    if (p95(sequential.map((attempt) => attempt.milliseconds)) > 1500) {
      throw new Error(`${operation} sequential P95 exceeds 1500ms`);
    }
  }

  for (const operation of ["correct", "hash"] as const) {
    const concurrent = assertExactAttempts(
      evidence,
      "concurrent",
      operation,
      13,
    );
    if (concurrent.some((attempt) => attempt.milliseconds > 8000)) {
      throw new Error(`${operation} concurrent attempt exceeds 8000ms`);
    }
  }

  const expectedTotal = 12 + 200 + 26;
  if (evidence.attempts.length !== expectedTotal) {
    throw new Error(`attempt count must be exactly ${expectedTotal}`);
  }
}
