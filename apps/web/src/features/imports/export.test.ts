import { expect, it, vi } from "vitest";
import {
  buildExportWorkbook,
  downloadExportWorkbook,
  projectRosterFilename,
} from "../../lib/excel/download-workbook";

const fixture = {
  명단: [
    {
      "고유 ID": "P-001",
      이름: "박민수",
      조직: "1팀",
      구분: "PRE_REGISTRATION",
      상태: "ACTIVE",
      "최종 수정": "2026-07-21T00:00:00.000Z",
    },
  ],
  집계: [
    {
      조직: "1팀",
      예상: 1,
      "진행 중 추가": 0,
      "진행 중 취소": 0,
      최종: 1,
      증감: 0,
    },
  ],
};

it("creates exactly the project summary and participant roster sheets", () => {
  expect(buildExportWorkbook(fixture).SheetNames).toEqual([
    "프로젝트 집계",
    "참가 명단",
  ]);
});

it("writes the project-named workbook only in the browser", () => {
  const writeFile = vi.fn();
  downloadExportWorkbook(fixture, "상반기-프로젝트-명단.xlsx", writeFile);
  expect(writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      SheetNames: ["프로젝트 집계", "참가 명단"],
    }),
    "상반기-프로젝트-명단.xlsx",
  );
});

it("builds a sanitized project roster filename", () => {
  expect(projectRosterFilename("상반기/리더십")).toBe(
    "상반기-리더십-프로젝트-명단.xlsx",
  );
});
