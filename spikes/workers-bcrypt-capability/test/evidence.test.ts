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

function clonePassingEvidence(): CapabilityEvidence {
  return structuredClone(passingEvidence);
}

function requiredAttempt(
  evidence: CapabilityEvidence,
  predicate: (attempt: EvidenceAttempt) => boolean,
): EvidenceAttempt {
  const selected = evidence.attempts.find(predicate);
  if (!selected) throw new Error("missing required test attempt");
  return selected;
}

it("rejects missing attempts instead of padding them with zero milliseconds", () => {
  expect(() => assertCapabilityPass(partialEvidence)).toThrow("correct count");
});

it("accepts exactly 3 warm-ups plus 50 hash/correct/wrong/dummy and 13+13 concurrent semantic attempts", () => {
  expect(() => assertCapabilityPass(passingEvidence)).not.toThrow();
});

it("rejects non-2xx and transport statuses instead of treating them as evidence", () => {
  const non2xx = clonePassingEvidence();
  requiredAttempt(non2xx, () => true).status = 503;
  expect(() => assertCapabilityPass(non2xx)).toThrow("non-2xx status");

  const transportFailure = clonePassingEvidence();
  requiredAttempt(transportFailure, () => true).status = 0;
  expect(() => assertCapabilityPass(transportFailure)).toThrow(
    "non-2xx status",
  );
});

it("rejects a semantic boolean mismatch", () => {
  const invalid = clonePassingEvidence();
  const correct = requiredAttempt(
    invalid,
    (entry) => entry.phase === "sequential" && entry.operation === "correct",
  );
  correct.response = { verified: false };

  expect(() => assertCapabilityPass(invalid)).toThrow(
    "correct semantic result failed",
  );
});

it("rejects a sequential P95 above 1500 milliseconds", () => {
  const slow = clonePassingEvidence();
  slow.attempts
    .filter(
      (entry) => entry.phase === "sequential" && entry.operation === "hash",
    )
    .slice(0, 3)
    .forEach((entry) => {
      entry.milliseconds = 1501;
    });

  expect(() => assertCapabilityPass(slow)).toThrow(
    "hash sequential P95 exceeds 1500ms",
  );
});

it("rejects a concurrent attempt above eight seconds", () => {
  const slow = clonePassingEvidence();
  const concurrent = requiredAttempt(
    slow,
    (entry) => entry.phase === "concurrent" && entry.operation === "correct",
  );
  concurrent.milliseconds = 8001;

  expect(() => assertCapabilityPass(slow)).toThrow(
    "correct concurrent attempt exceeds 8000ms",
  );
});

it("rejects a 239th attempt even when every required operation is present", () => {
  const extraAttempt = {
    ...attempt("warmup", "hash"),
    phase: "unrecognized",
  } as unknown as EvidenceAttempt;
  const invalid = clonePassingEvidence();
  invalid.attempts.push(extraAttempt);

  expect(() => assertCapabilityPass(invalid)).toThrow(
    "attempt count must be exactly 238",
  );
});
