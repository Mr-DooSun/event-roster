import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  CapabilityEvidence,
  EvidenceEntry,
  EvidenceResponse,
  EvidenceScenario,
} from "./assert-capability-evidence.mts";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = requiredEnvironment("CAPABILITY_PROBE_URL");
const probeSecret = requiredEnvironment("CAPABILITY_PROBE_SECRET");

const runId = randomUUID();

function sanitizeResponse(value: unknown): EvidenceResponse {
  if (typeof value !== "object" || value === null) return {};
  const input = value as Record<string, unknown>;
  const output: EvidenceResponse = {};
  if (typeof input.scenario === "string") {
    output.scenario = input.scenario as EvidenceScenario;
  }
  for (const key of [
    "scenarioPassed",
    "passwordVerified",
    "jwtVerified",
    "revokedJwtRejected",
    "changedPasswordRevokedBothSessions",
  ] as const) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (typeof input.committedRows === "number") {
    output.committedRows = input.committedRows;
  }
  if (typeof input.rollbackRows === "number") {
    output.rollbackRows = input.rollbackRows;
  }
  return output;
}

async function invoke(
  scenario: EvidenceScenario,
  phase: EvidenceEntry["phase"],
): Promise<EvidenceEntry> {
  const url = new URL("/__capability", baseUrl);
  url.searchParams.set("runId", runId);
  url.searchParams.set("scenario", scenario);
  const response = await fetch(url, {
    headers: { "X-ER-Capability-Secret": probeSecret },
  });
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    // A non-JSON response remains empty and is rejected by the evidence assertion.
  }
  return {
    phase,
    scenario,
    status: response.status,
    response: sanitizeResponse(body),
  };
}

const entries: EvidenceEntry[] = [];
for (const scenario of ["correct", "wrong", "nonexistent"] as const) {
  for (let request = 0; request < 50; request += 1) {
    entries.push(await invoke(scenario, "sequential"));
  }
}
for (const scenario of ["jwt-revocation", "atomic", "rollback"] as const) {
  entries.push(await invoke(scenario, "required"));
}
entries.push(
  ...(await Promise.all(
    Array.from({ length: 13 }, () => invoke("correct", "concurrent")),
  )),
);

const evidence: CapabilityEvidence = {
  runId,
  createdAt: new Date().toISOString(),
  entries,
};
const directory = new URL(
  "../../../docs/superpowers/evidence/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const output = new URL(`${runId}.json`, directory);
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
  mode: 0o600,
});
console.log(`Capability probe run ID: ${runId}`);
console.log(`Evidence written: ${output.pathname}`);
