import { expect, it } from "vitest";
import { calculateEventSummary, calculateProjectSummary } from "../src";

it("computes expected and final totals from snapshot, source, and status", () => {
  expect(
    calculateEventSummary({
      eventId: "event-h1-2026",
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
          source: "PRE_EVENT",
          status: "ACTIVE",
        },
        {
          organizationId: "org-a",
          source: "PRE_EVENT",
          status: "CANCELLED",
        },
        {
          organizationId: "org-a",
          source: "DAY_OF",
          status: "ACTIVE",
        },
        {
          organizationId: "org-b",
          source: "PRE_EVENT",
          status: "ACTIVE",
        },
        {
          organizationId: "org-b",
          source: "DAY_OF",
          status: "CANCELLED",
        },
      ],
    }),
  ).toEqual({
    eventId: "event-h1-2026",
    expectedTotal: 3,
    finalTotal: 3,
    deltaTotal: 0,
    organizations: [
      {
        organizationId: "org-a",
        organizationName: "조직 A",
        expected: 2,
        dayOfAdded: 1,
        dayOfCancelled: 1,
        final: 2,
        delta: 0,
      },
      {
        organizationId: "org-b",
        organizationName: "조직 B",
        expected: 1,
        dayOfAdded: 0,
        dayOfCancelled: 0,
        final: 1,
        delta: 0,
      },
    ],
  });
});

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
