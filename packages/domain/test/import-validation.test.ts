import { describe, expect, it } from "vitest";
import { validateNormalizedRows } from "../src";

describe("validateNormalizedRows", () => {
  it("normalizes valid rows without calling infrastructure", () => {
    expect(
      validateNormalizedRows([
        {
          rowNumber: 2,
          name: "  김민수 ",
          organizationName: " 조직 A ",
          role: "STUDENT",
          grade: "H1",
        },
        {
          rowNumber: 3,
          name: "이영희",
          organizationName: "조직 B",
          role: "TEACHER",
          grade: null,
        },
      ]),
    ).toEqual([
      {
        rowNumber: 2,
        name: "김민수",
        organizationName: "조직 A",
        role: "STUDENT",
        grade: "H1",
      },
      {
        rowNumber: 3,
        name: "이영희",
        organizationName: "조직 B",
        role: "TEACHER",
        grade: null,
      },
    ]);
  });

  it.each([
    { role: "STUDENT" as const, grade: null },
    { role: "TEACHER" as const, grade: "H1" as const },
  ])("rejects an invalid $role grade pairing with row details", (profile) => {
    expect(() =>
      validateNormalizedRows([
        {
          rowNumber: 2,
          name: "잘못된 프로필",
          organizationName: "조직 A",
          ...profile,
        },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        details: { rowNumber: 2, field: "grade" },
      }),
    );
  });

  it("rejects empty, duplicate, and oversized imports", () => {
    expect(() => validateNormalizedRows([])).toThrowError("VALIDATION_FAILED");
    expect(() =>
      validateNormalizedRows([
        {
          rowNumber: 2,
          name: "김민수",
          organizationName: "조직 A",
          role: "STUDENT",
          grade: "M1",
        },
        {
          rowNumber: 3,
          name: " 김민수 ",
          organizationName: "조직 A",
          role: "TEACHER",
          grade: null,
        },
      ]),
    ).toThrowError("VALIDATION_FAILED");
    expect(() =>
      validateNormalizedRows(
        Array.from({ length: 131 }, (_, index) => ({
          rowNumber: index + 2,
          name: `참가자 ${index}`,
          organizationName: "조직 A",
          role: "STUDENT" as const,
          grade: "M1" as const,
        })),
      ),
    ).toThrowError("VALIDATION_FAILED");
  });
});
