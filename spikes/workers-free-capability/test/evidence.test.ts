import { describe, expect, it } from "vitest";
import {
  assertCapabilityEvidence,
  type CapabilityEvidence,
  type EvidenceEntry,
} from "../scripts/assert-capability-evidence.mts";

function passwordEntry(
  scenario: "correct" | "wrong" | "nonexistent",
  phase: "sequential" | "concurrent",
): EvidenceEntry {
  return {
    phase,
    scenario,
    status: 200,
    response: {
      scenario,
      scenarioPassed: true,
      passwordVerified: scenario === "correct",
    },
  };
}

function validEvidence(): CapabilityEvidence {
  return {
    runId: "evidence-test",
    createdAt: "2026-07-20T00:00:00.000Z",
    entries: [
      ...(["correct", "wrong", "nonexistent"] as const).flatMap((scenario) =>
        Array.from({ length: 50 }, () => passwordEntry(scenario, "sequential")),
      ),
      {
        phase: "required",
        scenario: "jwt-revocation",
        status: 200,
        response: {
          scenario: "jwt-revocation",
          scenarioPassed: true,
          jwtVerified: true,
          revokedJwtRejected: true,
          changedPasswordRevokedBothSessions: true,
        },
      },
      {
        phase: "required",
        scenario: "atomic",
        status: 200,
        response: {
          scenario: "atomic",
          scenarioPassed: true,
          committedRows: 392,
        },
      },
      {
        phase: "required",
        scenario: "rollback",
        status: 200,
        response: {
          scenario: "rollback",
          scenarioPassed: true,
          rollbackRows: 0,
        },
      },
      ...Array.from({ length: 13 }, () =>
        passwordEntry("correct", "concurrent"),
      ),
    ],
  };
}

describe("assertCapabilityEvidence", () => {
  it("accepts complete status-only evidence", () => {
    expect(() => assertCapabilityEvidence(validEvidence())).not.toThrow();
  });

  it("rejects a missing password scenario result", () => {
    const evidence = validEvidence();
    evidence.entries.splice(50, 1);
    expect(() => assertCapabilityEvidence(evidence)).toThrow(
      /wrong sequential count/u,
    );
  });

  it("rejects response mismatches and incomplete security proof", () => {
    const evidence = validEvidence();
    const jwt = evidence.entries.find(
      (entry) => entry.scenario === "jwt-revocation",
    );
    if (jwt) jwt.response.revokedJwtRejected = false;
    expect(() => assertCapabilityEvidence(evidence)).toThrow(
      /JWT revocation evidence/u,
    );
  });
});
