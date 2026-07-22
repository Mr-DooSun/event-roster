import type {
  ProjectSummary,
  RosterSource,
  RosterStatus,
} from "@event-roster/contracts";

export interface ProjectSummaryInput {
  projectId: string;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
  }>;
  expectedSnapshots: Array<{
    organizationId: string;
    expectedCount: number;
  }>;
  rosterEntries: Array<{
    organizationId: string;
    source: RosterSource;
    status: RosterStatus;
  }>;
}

export function calculateProjectSummary(
  input: ProjectSummaryInput,
): ProjectSummary {
  const expectedByOrganization = new Map(
    input.expectedSnapshots.map((snapshot) => [
      snapshot.organizationId,
      snapshot.expectedCount,
    ]),
  );

  const organizations = input.organizations.map((organization) => {
    const entries = input.rosterEntries.filter(
      (entry) => entry.organizationId === organization.organizationId,
    );
    const expected =
      expectedByOrganization.get(organization.organizationId) ?? 0;
    const inProgressAdded = entries.filter(
      (entry) => entry.source === "IN_PROGRESS" && entry.status === "ACTIVE",
    ).length;
    const inProgressCancelled = entries.filter(
      (entry) =>
        entry.source === "PRE_REGISTRATION" && entry.status === "CANCELLED",
    ).length;
    const final = entries.filter((entry) => entry.status === "ACTIVE").length;

    return {
      ...organization,
      expected,
      inProgressAdded,
      inProgressCancelled,
      final,
      delta: final - expected,
    };
  });
  const expectedTotal = organizations.reduce(
    (total, organization) => total + organization.expected,
    0,
  );
  const finalTotal = organizations.reduce(
    (total, organization) => total + organization.final,
    0,
  );
  return {
    projectId: input.projectId,
    expectedTotal,
    finalTotal,
    deltaTotal: finalTotal - expectedTotal,
    organizations,
  };
}
