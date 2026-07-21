import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import app from "../src/index";
import { createPasswordServiceClient } from "../src/kdf-client";

const env: Env = {
  PASSWORD_SERVICE_URL: "https://password-service.example",
  AUTH_KDF_SHARED_SECRET: "shared-test-secret",
  CAPABILITY_PROBE_TOKEN: "probe-only-test-token",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("password service client", () => {
  it("signs the exact raw JSON bytes with the v1 message", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ kdfVersion: 1, phc: "$argon2id$test-output" }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const client = createPasswordServiceClient(env, fetchMock);

    const result = await client.execute({
      operation: "hash",
      password: "temporary-password-123",
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://password-service.example/internal/v1/password/hash",
    );
    expect(init?.body).toBe('{"password":"temporary-password-123"}');
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("x-er-kdf-body-sha256")).toBe(
      "cp8IIcFYUX9uzdHIdASSR5ktc8HDUx1MlIG6eN3FpOY",
    );
    expect(new Headers(init?.headers).get("x-er-kdf-signature")).toBe(
      "PNvLboSpIijs9n_0Zqw5VIRSnOcEcG568y1MUg7uc5s",
    );
  });

  it("intentionally corrupts only the signature for the negative probe", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ detail: "unauthorized" }, { status: 401 }),
    );
    const client = createPasswordServiceClient(env, fetchMock);

    const result = await client.execute({
      operation: "corruptSignature",
      password: "temporary-password-123",
    });

    expect(result.status).toBe(401);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-er-kdf-signature")).toMatch(
      /^invalid-/,
    );
    expect(new Headers(init?.headers).get("x-er-kdf-body-sha256")).toBeTruthy();
  });

  it("aborts the Cloud Run request after eight seconds", async () => {
    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler) => {
        if (typeof handler === "function") {
          handler();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException("", "AbortError"));
      }
      return Promise.resolve(Response.json({ code: "unexpected" }));
    });
    const client = createPasswordServiceClient(env, fetchMock);

    await expect(
      client.execute({ operation: "hash", password: "temporary-password-123" }),
    ).rejects.toThrow("password_service_timeout");
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 8_000);
  });

  it("never forwards the Worker probe token to Cloud Run", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ verified: false }),
    );
    const client = createPasswordServiceClient(env, fetchMock);

    await client.execute({
      operation: "verifyDummy",
      password: "temporary-password-123",
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.has("x-er-probe-token")).toBe(false);
    expect(JSON.stringify(init)).not.toContain(env.CAPABILITY_PROBE_TOKEN);
  });
});

describe("probe Worker", () => {
  it("returns a generic 404 for missing or incorrect probe tokens", async () => {
    const response = await app.request(
      "https://probe.example/probe",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("returns a generic 404 for every route other than POST /probe", async () => {
    const response = await app.request(
      "https://probe.example/healthz",
      { headers: { "x-er-probe-token": env.CAPABILITY_PROBE_TOKEN } },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("accepts the exact probe token and returns the password-service result", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ verified: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      "https://probe.example/probe",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-er-probe-token": env.CAPABILITY_PROBE_TOKEN,
        },
        body: JSON.stringify({
          operation: "verifyDummy",
          password: "temporary-password-123",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 200,
      body: { verified: false },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
