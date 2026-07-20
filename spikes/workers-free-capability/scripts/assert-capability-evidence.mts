export type EvidenceScenario =
  | "correct"
  | "wrong"
  | "nonexistent"
  | "jwt-revocation"
  | "atomic"
  | "rollback";

export interface EvidenceResponse {
  scenario?: EvidenceScenario;
  scenarioPassed?: boolean;
  passwordVerified?: boolean;
  jwtVerified?: boolean;
  revokedJwtRejected?: boolean;
  changedPasswordRevokedBothSessions?: boolean;
  committedRows?: number;
  rollbackRows?: number;
}

export interface EvidenceEntry {
  phase: "sequential" | "required" | "concurrent";
  scenario: EvidenceScenario;
  status: number;
  response: EvidenceResponse;
}

export interface CapabilityEvidence {
  runId: string;
  createdAt: string;
  entries: EvidenceEntry[];
}

function fail(message: string): never {
  throw new Error(`capability evidence rejected: ${message}`);
}

export function assertCapabilityEvidence(evidence: CapabilityEvidence): void {
  if (!evidence.runId || !Array.isArray(evidence.entries)) {
    fail("invalid evidence document");
  }
  for (const entry of evidence.entries) {
    if (entry.status !== 200)
      fail(`${entry.scenario} returned ${entry.status}`);
    if (entry.response.scenario !== entry.scenario) {
      fail(`${entry.scenario} response scenario mismatch`);
    }
    if (entry.response.scenarioPassed !== true) {
      fail(`${entry.scenario} scenario did not pass`);
    }
  }

  for (const scenario of ["correct", "wrong", "nonexistent"] as const) {
    const entries = evidence.entries.filter(
      (entry) => entry.phase === "sequential" && entry.scenario === scenario,
    );
    if (entries.length !== 50) fail(`${scenario} sequential count is not 50`);
    const expected = scenario === "correct";
    if (entries.some((entry) => entry.response.passwordVerified !== expected)) {
      fail(`${scenario} password verification mismatch`);
    }
  }

  const concurrent = evidence.entries.filter(
    (entry) => entry.phase === "concurrent" && entry.scenario === "correct",
  );
  if (concurrent.length !== 13) fail("concurrent correct count is not 13");
  if (concurrent.some((entry) => entry.response.passwordVerified !== true)) {
    fail("concurrent password verification mismatch");
  }

  const required = (scenario: EvidenceScenario): EvidenceEntry => {
    const entries = evidence.entries.filter(
      (entry) => entry.phase === "required" && entry.scenario === scenario,
    );
    if (entries.length !== 1) fail(`${scenario} required count is not 1`);
    const entry = entries[0];
    if (!entry) fail(`${scenario} evidence is missing`);
    return entry;
  };
  const jwt = required("jwt-revocation");
  if (
    jwt.response.jwtVerified !== true ||
    jwt.response.revokedJwtRejected !== true ||
    jwt.response.changedPasswordRevokedBothSessions !== true
  ) {
    fail("JWT revocation evidence is incomplete");
  }
  if (required("atomic").response.committedRows !== 392) {
    fail("atomic import did not commit all 392 rows");
  }
  if (required("rollback").response.rollbackRows !== 0) {
    fail("rollback left probe rows behind");
  }
}

async function latestEvidencePath(): Promise<string | URL> {
  const { readdir, stat } = await import("node:fs/promises");
  const configured = process.env.CAPABILITY_EVIDENCE_PATH;
  if (configured) return configured;
  const directory = new URL(
    "../../../docs/superpowers/evidence/",
    import.meta.url,
  );
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  if (names.length === 0) fail("no evidence JSON file found");
  const candidates = await Promise.all(
    names.map(async (name) => {
      const url = new URL(name, directory);
      return { url, modified: (await stat(url)).mtimeMs };
    }),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  const latest = candidates[0];
  if (!latest) fail("no evidence JSON file found");
  return latest.url;
}

async function main(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const evidencePath = await latestEvidencePath();
  const evidence = JSON.parse(
    await readFile(evidencePath, "utf8"),
  ) as CapabilityEvidence;
  assertCapabilityEvidence(evidence);
  console.log(`Capability evidence PASS: ${evidence.runId}`);
}

if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("assert-capability-evidence.mts")
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "evidence assertion failed",
    );
    process.exitCode = 1;
  });
}
