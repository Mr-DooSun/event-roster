export interface CapabilityResult {
  bundleGzipBytes: number;
  correct50: boolean;
  wrong50: boolean;
  nonexistent50: boolean;
  cpuP95Ms: {
    correct: number;
    wrong: number;
    nonexistent: number;
  };
  exceededCpuCount: number;
  jwtAndRevocation: boolean;
  atomic130RowImport: boolean;
  rollbackClean: boolean;
  concurrentRequestsClean: boolean;
}

export class CapabilityGateError extends Error {}

export function assertCapabilityPass(result: CapabilityResult): void {
  if (result.bundleGzipBytes >= 3 * 1024 * 1024) {
    throw new CapabilityGateError("gzip bundle exceeds Workers Free limit");
  }
  if (!result.correct50 || !result.wrong50 || !result.nonexistent50) {
    throw new CapabilityGateError("password scenarios were not verified");
  }
  if (
    Object.values(result.cpuP95Ms).some((value) => value > 6) ||
    result.exceededCpuCount !== 0
  ) {
    throw new CapabilityGateError("CPU gate failed");
  }
  if (
    !result.jwtAndRevocation ||
    !result.atomic130RowImport ||
    !result.rollbackClean ||
    !result.concurrentRequestsClean
  ) {
    throw new CapabilityGateError("security or D1 evidence is incomplete");
  }
}
