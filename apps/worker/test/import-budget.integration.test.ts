import { expect, it } from "vitest";
import { buildImportQueryPlan } from "../src/services/imports";

it("keeps 130 all-new rows within the D1 statement and binding budget", () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    rowNumber: index + 2,
    name: `참가자 ${index + 1}`,
    organizationName: "1팀",
    role: "STUDENT" as const,
    grade: "M1" as const,
  }));
  const plan = buildImportQueryPlan(rows);
  expect(plan.queryCount).toBe(35);
  expect(Math.max(...plan.bindingCounts)).toBe(96);
  expect(plan.bindingCounts.every((count) => count <= 100)).toBe(true);
  expect(plan.rows).toHaveLength(130);
});
