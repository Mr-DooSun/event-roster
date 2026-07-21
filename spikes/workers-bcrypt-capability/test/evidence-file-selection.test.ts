import { expect, it } from "vitest";
import {
  assertCapabilityPass,
  type CapabilityEvidence,
  type EvidenceAttempt,
} from "../src/evidence";
import {
  type EvidenceFileCandidate,
  selectLatestEvidenceFile,
} from "../src/evidence-file-selection";

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

function passingEvidence(): CapabilityEvidence {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-21T00:00:00.000Z",
    attempts: [
      ...(["hash", "correct", "wrong", "dummy"] as const).flatMap((operation) =>
        Array.from({ length: 3 }, () => attempt("warmup", operation)),
      ),
      ...(["hash", "correct", "wrong", "dummy"] as const).flatMap((operation) =>
        Array.from({ length: 50 }, () => attempt("sequential", operation)),
      ),
      ...Array.from({ length: 13 }, () => attempt("concurrent", "correct")),
      ...Array.from({ length: 13 }, () => attempt("concurrent", "hash")),
    ],
  };
}

it("selects the newest evidence by mtime instead of the highest UUID, so a newer partial run cannot inherit an old PASS", () => {
  const oldPass = "workers-bcrypt-ffffffff-ffff-4fff-8fff-ffffffffffff.json";
  const newPartial = "workers-bcrypt-00000000-0000-4000-8000-000000000002.json";
  const candidates: EvidenceFileCandidate[] = [
    { name: oldPass, modifiedTimeMs: 1_000 },
    { name: newPartial, modifiedTimeMs: 2_000 },
  ];
  const fixture = new Map<string, CapabilityEvidence>([
    [oldPass, passingEvidence()],
    [newPartial, { ...passingEvidence(), attempts: [] }],
  ]);

  const selected = selectLatestEvidenceFile(candidates);
  const selectedEvidence = fixture.get(selected.name);
  if (!selectedEvidence) throw new Error("missing selected test fixture");

  expect(selected.name).toBe(newPartial);
  expect(() => assertCapabilityPass(selectedEvidence)).toThrow();
});

it("fails closed when more than one evidence file shares the newest mtime", () => {
  expect(() =>
    selectLatestEvidenceFile([
      {
        name: "workers-bcrypt-00000000-0000-4000-8000-000000000001.json",
        modifiedTimeMs: 2_000,
      },
      {
        name: "workers-bcrypt-00000000-0000-4000-8000-000000000002.json",
        modifiedTimeMs: 2_000,
      },
    ]),
  ).toThrow("ambiguous latest evidence");
});

it("fails closed when no evidence file can be selected", () => {
  expect(() => selectLatestEvidenceFile([])).toThrow(
    "no Workers bcrypt evidence exists",
  );
});
