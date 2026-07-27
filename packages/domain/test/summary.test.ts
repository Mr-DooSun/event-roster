import { expect, it } from "vitest";
import { calculateProjectSummary } from "../src";

function organization(
  organizationId: string,
  organizationName: string,
  overrides: Partial<{
    isActive: boolean;
    masterIsActive: boolean;
  }> = {},
) {
  return {
    organizationId,
    organizationName,
    isActive: true,
    masterIsActive: true,
    ...overrides,
  };
}

it("computes project totals from pre-registration and in-progress entries", () => {
  expect(
    calculateProjectSummary({
      projectId: "project-leadership-camp",
      organizations: [
        organization("org-a", "조직 A"),
        organization("org-b", "조직 B"),
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
        isActive: true,
        masterIsActive: true,
        expected: 2,
        inProgressAdded: 1,
        inProgressCancelled: 1,
        final: 2,
        delta: 0,
      },
      {
        organizationId: "org-b",
        organizationName: "조직 B",
        isActive: true,
        masterIsActive: true,
        expected: 1,
        inProgressAdded: 0,
        inProgressCancelled: 0,
        final: 1,
        delta: 0,
      },
    ],
  });
});

it("keeps an active zero-count organization", () => {
  const summary = calculateProjectSummary({
    projectId: "project-1",
    organizations: [organization("org-active", "활성 조직")],
    expectedSnapshots: [],
    rosterEntries: [],
  });

  expect(summary.organizations).toEqual([
    expect.objectContaining({
      organizationId: "org-active",
      isActive: true,
      masterIsActive: true,
      expected: 0,
      final: 0,
    }),
  ]);
});

it("hides inactive zero-count organizations but preserves inactive history", () => {
  const summary = calculateProjectSummary({
    projectId: "project-1",
    organizations: [
      organization("org-empty", "빈 비활성", { isActive: false }),
      organization("org-history", "이력 비활성", {
        masterIsActive: false,
      }),
    ],
    expectedSnapshots: [{ organizationId: "org-history", expectedCount: 2 }],
    rosterEntries: [],
  });

  expect(summary).toMatchObject({
    expectedTotal: 2,
    finalTotal: 0,
    deltaTotal: -2,
    organizations: [
      {
        organizationId: "org-history",
        organizationName: "이력 비활성",
        isActive: true,
        masterIsActive: false,
        expected: 2,
        final: 0,
        delta: -2,
      },
    ],
  });
});
