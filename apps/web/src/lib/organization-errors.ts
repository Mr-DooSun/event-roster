import { ApiError } from "./api";

export function getReservedOrganizationId(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem?.code !== "ORGANIZATION_NAME_RESERVED") return null;
  const details = error.problem.details;
  if (!details || typeof details !== "object") return null;
  const id = (details as Record<string, unknown>).organizationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
