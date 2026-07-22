import { expect, it } from "vitest";
import { calculateProjectSummary } from "../src";

it("computes project totals from pre-registration and in-progress entries", () => {
  expect(
    calculateProjectSummary({
      projectId: "project-leadership-camp",
      organizations: [
        { organizationId: "org-a", organizationName: "조직 A" },
        { organizationId: "org-b", organizationName: "조직 B" },
      ],
      expectedSnapshots: [
        { organizationId: "org-a", expectedCount: 2 },
        { organizationId: "org-b", expectedCount: 1 },
      ],
      rosterEntries: [
        {
          organizationId: "org-a",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
        },
        {
          organizationId: "org-a",
          source: "PRE_REGISTRATION",
          status: "CANCELLED",
        },
        {
          organizationId: "org-a",
          source: "IN_PROGRESS",
          status: "ACTIVE",
        },
        {
          organizationId: "org-b",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
        },
        {
          organizationId: "org-b",
          source: "IN_PROGRESS",
          status: "CANCELLED",
        },
      ],
    }),
  ).toEqual({
    projectId: "project-leadership-camp",
    expectedTotal: 3,
    finalTotal: 3,
    deltaTotal: 0,
    organizations: [
      {
        organizationId: "org-a",
        organizationName: "조직 A",
        expected: 2,
        inProgressAdded: 1,
        inProgressCancelled: 1,
        final: 2,
        delta: 0,
      },
      {
        organizationId: "org-b",
        organizationName: "조직 B",
        expected: 1,
        inProgressAdded: 0,
        inProgressCancelled: 0,
        final: 1,
        delta: 0,
      },
    ],
  });
});
