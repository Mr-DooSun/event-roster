import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { readWorkbook } from "./read-workbook";

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
