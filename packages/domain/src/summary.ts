import type {
  ParticipantRole,
  ProjectSummary,
  ProjectSummaryOrganization,
  RosterSource,
  RosterStatus,
} from "@event-roster/contracts";

export interface ProjectSummaryInput {
  projectId: string;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    isActive: boolean;
    masterIsActive: boolean;
  }>;
  expectedSnapshots: Array<{
    organizationId: string;
    expectedCount: number;
  }>;
  rosterEntries: Array<{
    organizationId: string;
    source: RosterSource;
    status: RosterStatus;
    role: ParticipantRole | null;
  }>;
}

export function shouldIncludeProjectSummaryOrganization(
  organization: Pick<
    ProjectSummaryOrganization,
    | "isActive"
    | "masterIsActive"
    | "expected"
    | "inProgressAdded"
    | "inProgressCancelled"
    | "final"
  >,
): boolean {
  if (organization.isActive && organization.masterIsActive) return true;
  return (
    organization.expected !== 0 ||
    organization.inProgressAdded !== 0 ||
    organization.inProgressCancelled !== 0 ||
    organization.final !== 0
  );
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

  const organizations = input.organizations
    .map((organization) => {
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
      const studentCount = entries.filter(
        (entry) => entry.status === "ACTIVE" && entry.role === "STUDENT",
      ).length;
      const teacherCount = entries.filter(
        (entry) => entry.status === "ACTIVE" && entry.role === "TEACHER",
      ).length;

      return {
        ...organization,
        expected,
        inProgressAdded,
        inProgressCancelled,
        final,
        delta: final - expected,
        studentCount,
        teacherCount,
      };
    })
    .filter(shouldIncludeProjectSummaryOrganization);
  const expectedTotal = organizations.reduce(
    (total, organization) => total + organization.expected,
    0,
  );
  const finalTotal = organizations.reduce(
    (total, organization) => total + organization.final,
    0,
  );
  const studentTotal = organizations.reduce(
    (total, organization) => total + organization.studentCount,
    0,
  );
  const teacherTotal = organizations.reduce(
    (total, organization) => total + organization.teacherCount,
    0,
  );
  return {
    projectId: input.projectId,
    expectedTotal,
    finalTotal,
    deltaTotal: finalTotal - expectedTotal,
    studentTotal,
    teacherTotal,
    organizations,
  };
}
