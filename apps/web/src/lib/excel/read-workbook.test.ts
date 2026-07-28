import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeSheet,
  type ParsedWorkbook,
  readWorkbook,
} from "./read-workbook";

it("rejects a workbook before reading when the source exceeds 10 MiB", async () => {
  const arrayBuffer = vi.fn();
  const oversized = {
    size: 10 * 1024 * 1024 + 1,
    arrayBuffer,
  } as unknown as File;

  await expect(readWorkbook(oversized)).rejects.toThrow("WORKBOOK_TOO_LARGE");
  expect(arrayBuffer).not.toHaveBeenCalled();
});

it("rejects sheets with more than 130 data rows", async () => {
  const rows = Array.from({ length: 131 }, (_, index) => ({
    이름: `참가자 ${index + 1}`,
    조직: "1팀",
  }));

  await expect(readWorkbook(workbookFile(rows))).rejects.toThrow(
    "WORKSHEET_TOO_LARGE",
  );
});

it("accepts the bounded 130-row workbook", async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    이름: `참가자 ${index + 1}`,
    조직: "1팀",
  }));

  await expect(readWorkbook(workbookFile(rows))).resolves.toMatchObject({
    sheetNames: ["참가자"],
  });
});

it("normalizes exact participant role and grade labels", () => {
  const parsed = parsedWorkbook([
    {
      이름: "학생 1",
      조직: "성룡사",
      "참가자 구분": "학생",
      학년: "중1",
    },
    {
      이름: "교사 1",
      조직: "성룡사",
      "참가자 구분": "담당교사",
      학년: "",
    },
  ]);

  expect(
    normalizeSheet(parsed, "참가자", {
      name: "이름",
      organization: "조직",
      role: "참가자 구분",
      grade: "학년",
    }),
  ).toEqual([
    {
      rowNumber: 2,
      name: "학생 1",
      organizationName: "성룡사",
      role: "STUDENT",
      grade: "M1",
    },
    {
      rowNumber: 3,
      name: "교사 1",
      organizationName: "성룡사",
      role: "TEACHER",
      grade: null,
    },
  ]);
});

it("reports missing participant profile columns by Korean name", () => {
  const parsed = parsedWorkbook([{ 이름: "학생 1", 조직: "성룡사" }]);

  expect(() =>
    normalizeSheet(parsed, "참가자", {
      name: "이름",
      organization: "조직",
      role: "참가자 구분",
      grade: "학년",
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "MISSING_REQUIRED_COLUMNS",
      missingColumns: ["참가자 구분", "학년"],
    }),
  );
});

it.each([
  {
    label: "unknown role",
    role: "교사",
    grade: "",
    field: "role",
  },
  {
    label: "role alias",
    role: "teacher",
    grade: "",
    field: "role",
  },
  {
    label: "unknown grade",
    role: "학생",
    grade: "중4",
    field: "grade",
  },
  {
    label: "grade range",
    role: "학생",
    grade: "중1~중3",
    field: "grade",
  },
  {
    label: "teacher grade",
    role: "담당교사",
    grade: "중1",
    field: "grade",
  },
])(
  "reports $label as a row-specific invalid value",
  ({ role, grade, field }) => {
    const parsed = parsedWorkbook([
      {
        이름: "참가자 1",
        조직: "성룡사",
        "참가자 구분": role,
        학년: grade,
      },
    ]);

    expect(() =>
      normalizeSheet(parsed, "참가자", {
        name: "이름",
        organization: "조직",
        role: "참가자 구분",
        grade: "학년",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_IMPORT_VALUE",
        rowNumber: 2,
        field,
      }),
    );
  },
);

function workbookFile(rows: Array<Record<string, string>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "참가자",
  );
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "roster.xlsx",
  );
}

function parsedWorkbook(rows: Array<Record<string, string>>): ParsedWorkbook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "참가자",
  );
  return { workbook, sheetNames: ["참가자"] };
}
