import { expect, it, vi } from "vitest";
import { createProbeApp } from "../src/index";
import { assertCostTwelveHash, hashPassword } from "../src/password";

it("returns 404 for a wrong probe token without running bcrypt", async () => {
  const validDummyHash = await hashPassword("event-roster-dummy-account-v1");
  const passwordSpy = {
    hash: vi.fn(),
    verify: vi.fn(),
    assertCostTwelveHash: vi.fn(assertCostTwelveHash),
  };
  const app = createProbeApp(
    {
      DUMMY_BCRYPT_HASH: validDummyHash,
      CAPABILITY_PROBE_TOKEN: "probe-token",
    },
    { password: passwordSpy },
  );
  const response = await app.request(
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": "wrong",
      },
      body: JSON.stringify({ operation: "dummy" }),
    },
  );
  expect(response.status).toBe(404);
  expect(passwordSpy.verify).not.toHaveBeenCalled();
});

it("fails closed without bcrypt comparison when the configured dummy hash is invalid", async () => {
  const passwordSpy = {
    hash: vi.fn(),
    verify: vi.fn(),
    assertCostTwelveHash: vi.fn(() => {
      throw new Error("invalid_bcrypt_policy_hash");
    }),
  };
  const app = createProbeApp(
    { DUMMY_BCRYPT_HASH: "invalid", CAPABILITY_PROBE_TOKEN: "probe-token" },
    { password: passwordSpy },
  );
  const response = await app.request(
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": "probe-token",
      },
      body: JSON.stringify({ operation: "dummy" }),
    },
  );
  expect(response.status).toBe(500);
  expect(passwordSpy.verify).not.toHaveBeenCalled();
});

it("rejects a probe body that includes fields other than operation", async () => {
  const validDummyHash = await hashPassword("event-roster-dummy-account-v1");
  const app = createProbeApp({
    DUMMY_BCRYPT_HASH: validDummyHash,
    CAPABILITY_PROBE_TOKEN: "probe-token",
  });
  const response = await app.request(
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": "probe-token",
      },
      body: JSON.stringify({
        operation: "dummy",
        password: "must-not-be-accepted",
      }),
    },
  );
  expect(response.status).toBe(404);
});
