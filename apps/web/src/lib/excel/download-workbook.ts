import * as XLSX from "xlsx";

export interface ExportData {
  명단: Array<Record<string, string | number | boolean | null>>;
  집계: Array<Record<string, string | number | boolean | null>>;
}

const summarySheetName = "프로젝트 집계";
const rosterSheetName = "참가 명단";

export function buildExportWorkbook(data: ExportData) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(data.집계),
    summarySheetName,
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(data.명단),
    rosterSheetName,
  );
  return workbook;
}

export function sanitizeFilename(value: string) {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "-").trim();
  return sanitized || "프로젝트";
}

export function projectRosterFilename(projectName: string) {
  return `${sanitizeFilename(projectName)}-프로젝트-명단.xlsx`;
}

export function downloadExportWorkbook(
  data: ExportData,
  filename: string,
  writeFile: typeof XLSX.writeFile = XLSX.writeFile,
) {
  writeFile(buildExportWorkbook(data), filename);
}
