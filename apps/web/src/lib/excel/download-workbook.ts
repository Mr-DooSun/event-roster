import * as XLSX from "xlsx";

export interface ExportData {
  명단: Array<Record<string, string | number | boolean | null>>;
  집계: Array<Record<string, string | number | boolean | null>>;
}

export function buildExportWorkbook(data: ExportData) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(data.명단),
    "명단",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(data.집계),
    "집계",
  );
  return workbook;
}

export function downloadExportWorkbook(
  data: ExportData,
  filename: string,
  writeFile: typeof XLSX.writeFile = XLSX.writeFile,
) {
  writeFile(buildExportWorkbook(data), filename);
}
