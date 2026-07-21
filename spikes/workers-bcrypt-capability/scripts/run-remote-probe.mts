import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  CapabilityEvidence,
  EvidenceAttempt,
  EvidencePhase,
  ProbeOperation,
} from "../src/evidence";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = requiredEnvironment("CAPABILITY_PROBE_URL");
const probeToken = requiredEnvironment("CAPABILITY_PROBE_TOKEN");
const runId = randomUUID();

function responseBooleans(value: unknown): EvidenceAttempt["response"] {
  if (typeof value !== "object" || value === null) return {};
  const body = value as Record<string, unknown>;
  const response: EvidenceAttempt["response"] = {};
  if (typeof body.hashed === "boolean") response.hashed = body.hashed;
  if (typeof body.verified === "boolean") response.verified = body.verified;
  return response;
}

async function invoke(
  phase: EvidencePhase,
  operation: ProbeOperation,
): Promise<EvidenceAttempt> {
  const url = new URL("/probe", baseUrl);
  url.searchParams.set("run", runId);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": probeToken,
      },
      body: JSON.stringify({ operation }),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return {
      phase,
      operation,
      status: response.status,
      milliseconds: performance.now() - startedAt,
      response: responseBooleans(body),
    };
  } catch {
    return {
      phase,
      operation,
      status: 0,
      milliseconds: performance.now() - startedAt,
      response: {},
    };
  }
}

const attempts: EvidenceAttempt[] = [];
const operations = ["hash", "correct", "wrong", "dummy"] as const;
for (const operation of operations) {
  for (let count = 0; count < 3; count += 1)
    attempts.push(await invoke("warmup", operation));
  for (let count = 0; count < 50; count += 1)
    attempts.push(await invoke("sequential", operation));
}
attempts.push(
  ...(await Promise.all(
    Array.from({ length: 13 }, () => invoke("concurrent", "correct")),
  )),
  ...(await Promise.all(
    Array.from({ length: 13 }, () => invoke("concurrent", "hash")),
  )),
);

const evidence: CapabilityEvidence = {
  runId,
  createdAt: new Date().toISOString(),
  attempts,
};
const directory = new URL(
  "../../../docs/superpowers/evidence/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const output = new URL(`workers-bcrypt-${runId}.json`, directory);
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, {
  mode: 0o600,
});
console.log(`Capability probe run ID: ${runId}`);
console.log(`Evidence written: ${output.pathname}`);
