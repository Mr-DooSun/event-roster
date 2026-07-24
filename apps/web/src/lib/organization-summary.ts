import type { OrganizationSummary } from "@event-roster/contracts";

type OrganizationManagerSummary = Pick<
  OrganizationSummary,
  "managerCount" | "primaryLeader"
>;

export function getTotalOrganizationManagerCount(
  organization: OrganizationManagerSummary,
): number {
  return organization.managerCount + (organization.primaryLeader ? 1 : 0);
}
