import { expect, it, vi } from "vitest";
import {
  buildExportWorkbook,
  downloadExportWorkbook,
} from "../../lib/excel/download-workbook";

const fixture = {
  명단: [
    {
      "고유 ID": "P-001",
      이름: "박민수",
      조직: "1팀",
      구분: "PRE_EVENT",
      상태: "ACTIVE",
      "최종 수정": "2026-07-21T00:00:00.000Z",
    },
  ],
  집계: [
    {
      조직: "1팀",
      예상: 1,
      "당일 추가": 0,
      "당일 취소": 0,
      최종: 1,
      증감: 0,
    },
  ],
};

it("creates exactly roster and summary sheets", () => {
  expect(buildExportWorkbook(fixture).SheetNames).toEqual(["명단", "집계"]);
});

it("writes the generated workbook only in the browser", () => {
  const writeFile = vi.fn();
  downloadExportWorkbook(fixture, "상반기-명단.xlsx", writeFile);
  expect(writeFile).toHaveBeenCalledWith(
    expect.objectContaining({ SheetNames: ["명단", "집계"] }),
    "상반기-명단.xlsx",
  );
});
