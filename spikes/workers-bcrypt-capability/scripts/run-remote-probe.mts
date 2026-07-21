import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { CapabilityEvidence } from "../src/evidence";
import { collectProbeAttempts } from "../src/remote-probe";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = requiredEnvironment("CAPABILITY_PROBE_URL");
const probeToken = requiredEnvironment("CAPABILITY_PROBE_TOKEN");
const runId = randomUUID();
const attempts = await collectProbeAttempts({
  baseUrl,
  probeToken,
  runId,
  fetch,
});

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
