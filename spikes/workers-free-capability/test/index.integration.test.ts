import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const bindings = {
  DB: env.DB,
  PASSWORD_PEPPER: "local-password-pepper",
  JWT_SIGNING_KEY: "local-jwt-signing-key",
  CAPABILITY_PROBE_SECRET: "local-probe-secret",
};

function request(scenario: string, secret?: string) {
  const init = secret ? { headers: { "X-ER-Capability-Secret": secret } } : {};
  return worker.request(
    `https://example.test/__capability?scenario=${scenario}&runId=http-${scenario}`,
    init,
    bindings,
  );
}

describe("capability Worker", () => {
  it("rejects when the configured secret is absent", async () => {
    const response = await worker.request(
      "https://example.test/__capability?scenario=correct&runId=no-secret",
      {},
      { ...bindings, CAPABILITY_PROBE_SECRET: undefined },
    );
    expect(response.status).toBe(404);
  });

  it("rejects an absent or mismatched request secret", async () => {
    await expect(request("correct")).resolves.toMatchObject({ status: 404 });
    await expect(request("correct", "wrong-secret")).resolves.toMatchObject({
      status: 404,
    });
  });

  it.each([
    ["correct", true],
    ["wrong", false],
    ["nonexistent", false],
  ] as const)(
    "returns the expected password result for %s",
    async (scenario, passwordVerified) => {
      const response = await request(scenario, "local-probe-secret");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        scenario,
        scenarioPassed: true,
        passwordVerified,
      });
    },
  );
});
