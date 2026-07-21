import { describe, expect, it } from "vitest";
import { validateNormalizedRows } from "../src";

describe("validateNormalizedRows", () => {
  it("normalizes valid rows without calling infrastructure", () => {
    expect(
      validateNormalizedRows([
        { rowNumber: 2, name: "  김민수 ", organizationName: " 조직 A " },
        { rowNumber: 3, name: "이영희", organizationName: "조직 B" },
      ]),
    ).toEqual([
      { rowNumber: 2, name: "김민수", organizationName: "조직 A" },
      { rowNumber: 3, name: "이영희", organizationName: "조직 B" },
    ]);
  });

  it("rejects empty, duplicate, and oversized imports", () => {
    expect(() => validateNormalizedRows([])).toThrowError("VALIDATION_FAILED");
    expect(() =>
      validateNormalizedRows([
        { rowNumber: 2, name: "김민수", organizationName: "조직 A" },
        { rowNumber: 3, name: " 김민수 ", organizationName: "조직 A" },
      ]),
    ).toThrowError("VALIDATION_FAILED");
    expect(() =>
      validateNormalizedRows(
        Array.from({ length: 131 }, (_, index) => ({
          rowNumber: index + 2,
          name: `참가자 ${index}`,
          organizationName: "조직 A",
        })),
      ),
    ).toThrowError("VALIDATION_FAILED");
  });
});
