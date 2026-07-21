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

it("returns generic 404 for malformed JSON and missing or invalid run IDs before bcrypt", async () => {
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

  for (const url of [
    "https://probe.test/probe",
    "https://probe.test/probe?run=not-a-uuid",
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
  ]) {
    const response = await app.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": "probe-token",
      },
      body: url.endsWith("0001") ? "{" : JSON.stringify({ operation: "dummy" }),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(validDummyHash);
  }
  expect(passwordSpy.verify).not.toHaveBeenCalled();
});

it("returns the fixed semantic response shape for every accepted operation", async () => {
  const validDummyHash = await hashPassword("event-roster-dummy-account-v1");
  const passwordSpy = {
    hash: vi.fn(async () => validDummyHash),
    verify: vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false),
    assertCostTwelveHash: vi.fn(assertCostTwelveHash),
  };
  const app = createProbeApp(
    {
      DUMMY_BCRYPT_HASH: validDummyHash,
      CAPABILITY_PROBE_TOKEN: "probe-token",
    },
    { password: passwordSpy },
  );
  const request = (operation: "hash" | "correct" | "wrong" | "dummy") =>
    app.request(
      "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-ER-Probe-Token": "probe-token",
        },
        body: JSON.stringify({ operation }),
      },
    );

  await expect((await request("hash")).json()).resolves.toEqual({
    hashed: true,
  });
  await expect((await request("correct")).json()).resolves.toEqual({
    verified: true,
  });
  await expect((await request("wrong")).json()).resolves.toEqual({
    verified: false,
  });
  await expect((await request("dummy")).json()).resolves.toEqual({
    verified: false,
  });
  expect(passwordSpy.hash).toHaveBeenCalledTimes(1);
  expect(passwordSpy.verify).toHaveBeenCalledTimes(3);
});

it("does not expose configured hash or token when configuration fails", async () => {
  const configuredHash = "invalid-dummy-hash";
  const configuredToken = "probe-token-must-not-leak";
  const app = createProbeApp({
    DUMMY_BCRYPT_HASH: configuredHash,
    CAPABILITY_PROBE_TOKEN: configuredToken,
  });
  const response = await app.request(
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": configuredToken,
      },
      body: JSON.stringify({ operation: "dummy" }),
    },
  );

  expect(response.status).toBe(500);
  const body = await response.text();
  expect(body).not.toContain(configuredHash);
  expect(body).not.toContain(configuredToken);
});

it("returns a generic 500 without bcrypt error details", async () => {
  const validDummyHash = await hashPassword("event-roster-dummy-account-v1");
  const bcryptError = "bcrypt-internal-detail-must-not-leak";
  const app = createProbeApp(
    {
      DUMMY_BCRYPT_HASH: validDummyHash,
      CAPABILITY_PROBE_TOKEN: "probe-token",
    },
    {
      password: {
        hash: vi.fn(async () => {
          throw new Error(bcryptError);
        }),
        verify: vi.fn(),
        assertCostTwelveHash: vi.fn(assertCostTwelveHash),
      },
    },
  );
  const response = await app.request(
    "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-ER-Probe-Token": "probe-token",
      },
      body: JSON.stringify({ operation: "hash" }),
    },
  );

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(bcryptError);
});

it("returns a generic 500 without logging thrown bcrypt secrets", async () => {
  const validDummyHash = await hashPassword("event-roster-dummy-account-v1");
  const configuredToken = "probe-token-must-not-be-logged";
  const bcryptError = "bcrypt-throw-marker-must-not-be-logged";
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createProbeApp(
    {
      DUMMY_BCRYPT_HASH: validDummyHash,
      CAPABILITY_PROBE_TOKEN: configuredToken,
    },
    {
      password: {
        hash: vi.fn(async () => {
          throw new Error(bcryptError);
        }),
        verify: vi.fn(),
        assertCostTwelveHash: vi.fn(assertCostTwelveHash),
      },
    },
  );

  try {
    const response = await app.request(
      "https://probe.test/probe?run=00000000-0000-4000-8000-000000000001",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-ER-Probe-Token": configuredToken,
        },
        body: JSON.stringify({ operation: "hash" }),
      },
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    const capturedLogs = consoleError.mock.calls
      .flat()
      .map((value) => String(value))
      .join("\n");
    expect(consoleError).not.toHaveBeenCalled();
    expect(body).toBe('{"error":"capability probe unavailable"}');
    for (const secret of [bcryptError, configuredToken, validDummyHash]) {
      expect(body).not.toContain(secret);
      expect(capturedLogs).not.toContain(secret);
    }
  } finally {
    consoleError.mockRestore();
  }
});
