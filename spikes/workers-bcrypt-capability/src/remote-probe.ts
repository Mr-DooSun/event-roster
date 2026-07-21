import type {
  EvidenceAttempt,
  EvidencePhase,
  ProbeOperation,
} from "./evidence";

export type ProbeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ProbeDriverOptions {
  baseUrl: string;
  probeToken: string;
  runId: string;
  fetch: ProbeFetch;
  now?: () => number;
}

const operations = ["hash", "correct", "wrong", "dummy"] as const;

function responseBooleans(value: unknown): EvidenceAttempt["response"] {
  if (typeof value !== "object" || value === null) return {};
  const body = value as Record<string, unknown>;
  const response: EvidenceAttempt["response"] = {};
  if (typeof body.hashed === "boolean") response.hashed = body.hashed;
  if (typeof body.verified === "boolean") response.verified = body.verified;
  return response;
}

export async function collectProbeAttempt(
  options: ProbeDriverOptions,
  phase: EvidencePhase,
  operation: ProbeOperation,
): Promise<EvidenceAttempt> {
  const url = new URL("/probe", options.baseUrl);
  url.searchParams.set("run", options.runId);
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  try {
    const response = await options.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": options.probeToken,
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
      milliseconds: now() - startedAt,
      response: responseBooleans(body),
    };
  } catch {
    return {
      phase,
      operation,
      status: 0,
      milliseconds: now() - startedAt,
      response: {},
    };
  }
}

export async function collectProbeAttempts(
  options: ProbeDriverOptions,
): Promise<EvidenceAttempt[]> {
  const attempts: EvidenceAttempt[] = [];
  for (const operation of operations) {
    for (let count = 0; count < 3; count += 1) {
      attempts.push(await collectProbeAttempt(options, "warmup", operation));
    }
    for (let count = 0; count < 50; count += 1) {
      attempts.push(
        await collectProbeAttempt(options, "sequential", operation),
      );
    }
  }
  attempts.push(
    ...(await Promise.all(
      Array.from({ length: 13 }, () =>
        collectProbeAttempt(options, "concurrent", "correct"),
      ),
    )),
    ...(await Promise.all(
      Array.from({ length: 13 }, () =>
        collectProbeAttempt(options, "concurrent", "hash"),
      ),
    )),
  );
  return attempts;
}
