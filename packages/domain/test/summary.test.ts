import { expect, it } from "vitest";
import {
  calculateProjectSummary,
  shouldIncludeProjectSummaryOrganization,
} from "../src";

function organization(
  organizationId: string,
  organizationName: string,
  overrides: Partial<{
    isActive: boolean;
    masterIsActive: boolean;
    masterIsDeleted: boolean;
  }> = {},
) {
  return {
    organizationId,
    organizationName,
    isActive: true,
    masterIsActive: true,
    masterIsDeleted: false,
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
          role: "STUDENT",
        },
        {
          organizationId: "org-a",
          source: "PRE_REGISTRATION",
          status: "CANCELLED",
          role: "STUDENT",
        },
        {
          organizationId: "org-a",
          source: "IN_PROGRESS",
          status: "ACTIVE",
          role: "TEACHER",
        },
        {
          organizationId: "org-b",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          role: "STUDENT",
        },
        {
          organizationId: "org-b",
          source: "IN_PROGRESS",
          status: "CANCELLED",
          role: "TEACHER",
        },
      ],
    }),
  ).toEqual({
    projectId: "project-leadership-camp",
    expectedTotal: 3,
    finalTotal: 3,
    deltaTotal: 0,
    studentTotal: 2,
    teacherTotal: 1,
    organizations: [
      {
        organizationId: "org-a",
        organizationName: "조직 A",
        isActive: true,
        masterIsActive: true,
        masterIsDeleted: false,
        expected: 2,
        inProgressAdded: 1,
        inProgressCancelled: 1,
        final: 2,
        delta: 0,
        studentCount: 1,
        teacherCount: 1,
      },
      {
        organizationId: "org-b",
        organizationName: "조직 B",
        isActive: true,
        masterIsActive: true,
        masterIsDeleted: false,
        expected: 1,
        inProgressAdded: 0,
        inProgressCancelled: 0,
        final: 1,
        delta: 0,
        studentCount: 1,
        teacherCount: 0,
      },
    ],
  });
});

it("counts only active student and teacher profiles without inferring legacy rows", () => {
  expect(
    calculateProjectSummary({
      projectId: "project-roles",
      organizations: [organization("org-1", "조직 1")],
      expectedSnapshots: [{ organizationId: "org-1", expectedCount: 2 }],
      rosterEntries: [
        {
          organizationId: "org-1",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          role: "STUDENT",
        },
        {
          organizationId: "org-1",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          role: "TEACHER",
        },
        {
          organizationId: "org-1",
          source: "PRE_REGISTRATION",
          status: "ACTIVE",
          role: null,
        },
        {
          organizationId: "org-1",
          source: "PRE_REGISTRATION",
          status: "CANCELLED",
          role: "STUDENT",
        },
      ],
    }),
  ).toMatchObject({
    studentTotal: 1,
    teacherTotal: 1,
    finalTotal: 3,
    organizations: [{ studentCount: 1, teacherCount: 1 }],
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
      masterIsDeleted: false,
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
        masterIsDeleted: false,
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

it("preserves deleted organizations only when they have project history", () => {
  expect(
    shouldIncludeProjectSummaryOrganization({
      isActive: true,
      masterIsActive: false,
      masterIsDeleted: true,
      expected: 1,
      inProgressAdded: 0,
      inProgressCancelled: 0,
      final: 1,
    }),
  ).toBe(true);

  expect(
    shouldIncludeProjectSummaryOrganization({
      isActive: true,
      masterIsActive: false,
      masterIsDeleted: true,
      expected: 0,
      inProgressAdded: 0,
      inProgressCancelled: 0,
      final: 0,
    }),
  ).toBe(false);
});
