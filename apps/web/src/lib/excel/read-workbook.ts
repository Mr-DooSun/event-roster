import type { NormalizedImportRow } from "@event-roster/contracts";
import * as XLSX from "xlsx";

export interface ParsedWorkbook {
  workbook: XLSX.WorkBook;
  sheetNames: string[];
}

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS_WITH_HEADER = 131;
const MAX_SHEET_COLUMNS = 100;
const MAX_SHEET_CELLS = MAX_SHEET_ROWS_WITH_HEADER * MAX_SHEET_COLUMNS;

export async function readWorkbook(file: File): Promise<ParsedWorkbook> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new Error("WORKBOOK_TOO_LARGE");
  }
  const sourceBytes = await file.arrayBuffer();
  const workbook = XLSX.read(sourceBytes, {
    type: "array",
    sheetRows: MAX_SHEET_ROWS_WITH_HEADER + 1,
  });
  for (const sheetName of workbook.SheetNames) {
    assertBoundedSheet(workbook.Sheets[sheetName]);
  }
  return { workbook, sheetNames: [...workbook.SheetNames] };
}

export function getSheetHeaders(parsed: ParsedWorkbook, sheetName: string) {
  return sheetMatrix(parsed, sheetName)[0]?.map(cellText) ?? [];
}

export function normalizeSheet(
  parsed: ParsedWorkbook,
  sheetName: string,
  columns: { name: string; organization: string },
): NormalizedImportRow[] {
  const matrix = sheetMatrix(parsed, sheetName);
  const headers = matrix[0]?.map(cellText) ?? [];
  const nameIndex = headers.indexOf(columns.name);
  const organizationIndex = headers.indexOf(columns.organization);
  if (nameIndex < 0 || organizationIndex < 0) return [];
  return matrix
    .slice(1)
    .map((row, index) => ({
      rowNumber: index + 2,
      name: cellText(row[nameIndex]),
      organizationName: cellText(row[organizationIndex]),
    }))
    .filter((row) => row.name.length > 0 || row.organizationName.length > 0);
}

function sheetMatrix(parsed: ParsedWorkbook, sheetName: string): unknown[][] {
  const sheet = parsed.workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
}

function cellText(value: unknown) {
  return String(value ?? "").trim();
}

function assertBoundedSheet(sheet: XLSX.WorkSheet | undefined) {
  const reference = sheet?.["!fullref"] ?? sheet?.["!ref"];
  if (!reference) return;
  const range = XLSX.utils.decode_range(reference);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (
    rows > MAX_SHEET_ROWS_WITH_HEADER ||
    columns > MAX_SHEET_COLUMNS ||
    rows * columns > MAX_SHEET_CELLS
  ) {
    throw new Error("WORKSHEET_TOO_LARGE");
  }
}
