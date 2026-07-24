import { describe, expect, it } from "vitest";
import { getTotalOrganizationManagerCount } from "./organization-summary";

describe("getTotalOrganizationManagerCount", () => {
  it.each([
    {
      label: "대표와 추가 관리자가 모두 없음",
      value: { primaryLeader: null, managerCount: 0 },
      expected: 0,
    },
    {
      label: "대표만 있음",
      value: {
        primaryLeader: { userId: "leader-1", displayName: "김대표" },
        managerCount: 0,
      },
      expected: 1,
    },
    {
      label: "대표와 추가 관리자 둘이 있음",
      value: {
        primaryLeader: { userId: "leader-1", displayName: "김대표" },
        managerCount: 2,
      },
      expected: 3,
    },
  ])("$label", ({ value, expected }) => {
    expect(getTotalOrganizationManagerCount(value)).toBe(expected);
  });
});
