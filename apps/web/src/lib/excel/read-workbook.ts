import type {
  NormalizedImportRow,
  ParticipantRole,
  StudentGrade,
} from "@event-roster/contracts";
import * as XLSX from "xlsx";

export interface ParsedWorkbook {
  workbook: XLSX.WorkBook;
  sheetNames: string[];
}

export interface ImportColumns {
  name: string;
  organization: string;
  role: string;
  grade: string;
}

export type WorkbookImportErrorCode =
  | "MISSING_REQUIRED_COLUMNS"
  | "INVALID_IMPORT_VALUE";

export class WorkbookImportError extends Error {
  readonly code: WorkbookImportErrorCode;
  readonly missingColumns?: string[];
  readonly rowNumber?: number;
  readonly field?: "role" | "grade";

  constructor({
    code,
    message,
    missingColumns,
    rowNumber,
    field,
  }: {
    code: WorkbookImportErrorCode;
    message: string;
    missingColumns?: string[];
    rowNumber?: number;
    field?: "role" | "grade";
  }) {
    super(message);
    this.name = "WorkbookImportError";
    this.code = code;
    if (missingColumns !== undefined) this.missingColumns = missingColumns;
    if (rowNumber !== undefined) this.rowNumber = rowNumber;
    if (field !== undefined) this.field = field;
  }
}

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS_WITH_HEADER = 131;
const MAX_SHEET_COLUMNS = 100;
const MAX_SHEET_CELLS = MAX_SHEET_ROWS_WITH_HEADER * MAX_SHEET_COLUMNS;

const REQUIRED_COLUMN_LABEL: Record<keyof ImportColumns, string> = {
  name: "이름",
  organization: "조직",
  role: "참가자 구분",
  grade: "학년",
};

const ROLE_VALUE = {
  학생: "STUDENT",
  담당교사: "TEACHER",
} as const satisfies Record<string, ParticipantRole>;

const GRADE_VALUE = {
  중1: "M1",
  중2: "M2",
  중3: "M3",
  고1: "H1",
  고2: "H2",
  고3: "H3",
} as const satisfies Record<string, StudentGrade>;

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
  columns: ImportColumns,
): NormalizedImportRow[] {
  const matrix = sheetMatrix(parsed, sheetName);
  const headers = matrix[0]?.map(cellText) ?? [];
  const columnIndexes = {
    name: headers.indexOf(columns.name),
    organization: headers.indexOf(columns.organization),
    role: headers.indexOf(columns.role),
    grade: headers.indexOf(columns.grade),
  };
  const missingColumns = (
    Object.keys(columnIndexes) as Array<keyof ImportColumns>
  )
    .filter((field) => !columns[field] || columnIndexes[field] < 0)
    .map((field) => REQUIRED_COLUMN_LABEL[field]);
  if (missingColumns.length > 0) {
    throw new WorkbookImportError({
      code: "MISSING_REQUIRED_COLUMNS",
      message: `필수 열이 없습니다: ${missingColumns.join(", ")}`,
      missingColumns,
    });
  }
  return matrix
    .slice(1)
    .map((row, index) => {
      const rowNumber = index + 2;
      return {
        rowNumber,
        name: cellText(row[columnIndexes.name]),
        organizationName: cellText(row[columnIndexes.organization]),
        roleValue: cellText(row[columnIndexes.role]),
        gradeValue: cellText(row[columnIndexes.grade]),
      };
    })
    .filter(
      (row) =>
        row.name.length > 0 ||
        row.organizationName.length > 0 ||
        row.roleValue.length > 0 ||
        row.gradeValue.length > 0,
    )
    .map(({ rowNumber, name, organizationName, roleValue, gradeValue }) => {
      const role = ROLE_VALUE[roleValue as keyof typeof ROLE_VALUE];
      if (!role) throw invalidImportValue(rowNumber, "role");
      if (role === "TEACHER") {
        if (gradeValue) throw invalidImportValue(rowNumber, "grade");
        return { rowNumber, name, organizationName, role, grade: null };
      }
      const grade = GRADE_VALUE[gradeValue as keyof typeof GRADE_VALUE];
      if (!grade) throw invalidImportValue(rowNumber, "grade");
      return { rowNumber, name, organizationName, role, grade };
    });
}

function invalidImportValue(
  rowNumber: number,
  field: "role" | "grade",
): WorkbookImportError {
  const label = REQUIRED_COLUMN_LABEL[field];
  return new WorkbookImportError({
    code: "INVALID_IMPORT_VALUE",
    message: `${rowNumber}행 ${label} 값이 올바르지 않습니다.`,
    rowNumber,
    field,
  });
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
