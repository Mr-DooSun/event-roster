import { describe, expect, it } from "vitest";
import { assertCapabilityPass, CapabilityGateError } from "../src/gate-result";

const pass = {
  bundleGzipBytes: 3_145_727,
  correct50: true,
  wrong50: true,
  nonexistent50: true,
  cpuP95Ms: { correct: 6, wrong: 6, nonexistent: 6 },
  exceededCpuCount: 0,
  jwtAndRevocation: true,
  atomic130RowImport: true,
  rollbackClean: true,
  concurrentRequestsClean: true,
};

describe("assertCapabilityPass", () => {
  it("accepts complete evidence within the Free tier gate", () => {
    expect(() => assertCapabilityPass(pass)).not.toThrow();
  });

  it("rejects a CPU result above the 6ms safety target", () => {
    expect(() =>
      assertCapabilityPass({
        ...pass,
        cpuP95Ms: { ...pass.cpuP95Ms, wrong: 6.01 },
      }),
    ).toThrow(CapabilityGateError);
  });

  it("rejects a bundle at or above the 3MiB gzip limit", () => {
    expect(() =>
      assertCapabilityPass({ ...pass, bundleGzipBytes: 3 * 1024 * 1024 }),
    ).toThrow(CapabilityGateError);
  });
});
