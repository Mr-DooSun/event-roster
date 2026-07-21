import { expect, it } from "vitest";
import {
  assertCapabilityPass,
  type CapabilityEvidence,
  type EvidenceAttempt,
} from "../src/evidence";

function attempt(
  phase: EvidenceAttempt["phase"],
  operation: EvidenceAttempt["operation"],
): EvidenceAttempt {
  return {
    phase,
    operation,
    status: 200,
    milliseconds: 100,
    response:
      operation === "hash"
        ? { hashed: true }
        : { verified: operation === "correct" },
  };
}

function evidence(attempts: EvidenceAttempt[]): CapabilityEvidence {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-21T00:00:00.000Z",
    attempts,
  };
}

const passingAttempts = [
  ...(["hash", "correct", "wrong", "dummy"] as const).flatMap((operation) =>
    Array.from({ length: 3 }, () => attempt("warmup", operation)),
  ),
  ...(["hash", "correct", "wrong", "dummy"] as const).flatMap((operation) =>
    Array.from({ length: 50 }, () => attempt("sequential", operation)),
  ),
  ...Array.from({ length: 13 }, () => attempt("concurrent", "correct")),
  ...Array.from({ length: 13 }, () => attempt("concurrent", "hash")),
];

const partialEvidence = evidence(
  passingAttempts.filter((_entry, index) => index !== 62),
);
const passingEvidence = evidence(passingAttempts);

it("rejects missing attempts instead of padding them with zero milliseconds", () => {
  expect(() => assertCapabilityPass(partialEvidence)).toThrow("correct count");
});

it("accepts exactly 3 warm-ups plus 50 hash/correct/wrong/dummy and 13+13 concurrent semantic attempts", () => {
  expect(() => assertCapabilityPass(passingEvidence)).not.toThrow();
});
