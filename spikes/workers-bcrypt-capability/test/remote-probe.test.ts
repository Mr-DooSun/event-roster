import { expect, it, vi } from "vitest";
import {
  collectProbeAttempts,
  type ProbeDriverOptions,
} from "../src/remote-probe";

const runId = "00000000-0000-4000-8000-000000000001";

function responseFor(operation: string): Response {
  return new Response(
    JSON.stringify(
      operation === "hash"
        ? { hashed: true }
        : { verified: operation === "correct" },
    ),
    { status: 200 },
  );
}

function options(fetch: typeof globalThis.fetch): ProbeDriverOptions {
  let now = 0;
  return {
    baseUrl: "https://probe.example.test/base-path",
    probeToken: "test-probe-token",
    runId,
    fetch,
    now: () => {
      now += 10;
      return now;
    },
  };
}

it("schedules exactly 238 probe operations with one run ID and captures each semantic response", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { operation: string };
    expect(new URL(String(input)).searchParams.get("run")).toBe(runId);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "X-ER-Probe-Token": "test-probe-token",
    });
    return responseFor(body.operation);
  });

  const attempts = await collectProbeAttempts(options(fetch));

  expect(fetch).toHaveBeenCalledTimes(238);
  expect(attempts).toHaveLength(238);
  expect(
    attempts.slice(0, 3).map((entry) => [entry.phase, entry.operation]),
  ).toEqual([
    ["warmup", "hash"],
    ["warmup", "hash"],
    ["warmup", "hash"],
  ]);
  expect(attempts.filter((entry) => entry.phase === "warmup")).toHaveLength(12);
  expect(
    attempts.filter(
      (entry) => entry.phase === "sequential" && entry.operation === "hash",
    ),
  ).toHaveLength(50);
  expect(
    attempts.filter(
      (entry) => entry.phase === "sequential" && entry.operation === "correct",
    ),
  ).toHaveLength(50);
  expect(
    attempts.filter(
      (entry) => entry.phase === "sequential" && entry.operation === "wrong",
    ),
  ).toHaveLength(50);
  expect(
    attempts.filter(
      (entry) => entry.phase === "sequential" && entry.operation === "dummy",
    ),
  ).toHaveLength(50);
  expect(
    attempts.filter(
      (entry) => entry.phase === "concurrent" && entry.operation === "correct",
    ),
  ).toHaveLength(13);
  expect(
    attempts.filter(
      (entry) => entry.phase === "concurrent" && entry.operation === "hash",
    ),
  ).toHaveLength(13);
  expect(
    attempts.find((entry) => entry.operation === "hash")?.response,
  ).toEqual({
    hashed: true,
  });
  expect(
    attempts.find((entry) => entry.operation === "correct")?.response,
  ).toEqual({ verified: true });
  expect(
    attempts.find((entry) => entry.operation === "wrong")?.response,
  ).toEqual({
    verified: false,
  });
  expect(
    attempts.find((entry) => entry.operation === "dummy")?.response,
  ).toEqual({
    verified: false,
  });
});

it("records actual HTTP and transport failures without retries or padded attempts", async () => {
  let calls = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const operation = (JSON.parse(String(init?.body)) as { operation: string })
      .operation;
    if (calls === 4) throw new Error("transport failed");
    if (calls === 5)
      return new Response(JSON.stringify({ hashed: true }), { status: 503 });
    expect(new URL(String(input)).searchParams.get("run")).toBe(runId);
    return responseFor(operation);
  });

  const attempts = await collectProbeAttempts(options(fetch));

  expect(fetch).toHaveBeenCalledTimes(238);
  expect(attempts).toHaveLength(238);
  expect(attempts[3]).toMatchObject({ status: 0, response: {} });
  expect(attempts[4]).toMatchObject({
    status: 503,
    response: { hashed: true },
  });
});
