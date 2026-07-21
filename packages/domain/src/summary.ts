import type {
  EventSummary,
  RosterSource,
  RosterStatus,
} from "@event-roster/contracts";

export interface EventSummaryInput {
  eventId: string;
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

export function calculateEventSummary(input: EventSummaryInput): EventSummary {
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
    const dayOfAdded = entries.filter(
      (entry) => entry.source === "DAY_OF" && entry.status === "ACTIVE",
    ).length;
    const dayOfCancelled = entries.filter(
      (entry) => entry.source === "PRE_EVENT" && entry.status === "CANCELLED",
    ).length;
    const final = entries.filter((entry) => entry.status === "ACTIVE").length;

    return {
      ...organization,
      expected,
      dayOfAdded,
      dayOfCancelled,
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
    eventId: input.eventId,
    expectedTotal,
    finalTotal,
    deltaTotal: finalTotal - expectedTotal,
    organizations,
  };
}
