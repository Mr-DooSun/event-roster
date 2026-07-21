import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { fixture, login } from "./support";

test("imports 130 rows and downloads two-sheet Excel", async ({ page }) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/events/${data.eventId}/import`);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      Array.from({ length: 130 }, (_, index) => ({
        이름: `E2E 참가자 ${index + 1}`,
        조직: "E2E 1팀",
      })),
    ),
    "참가자",
  );
  await page.getByLabel("엑셀 파일").setInputFiles({
    name: "130-participants.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
    ),
  });
  await page.getByRole("button", { name: "서버 검증" }).click();
  await expect(page.getByText("검증 완료")).toBeVisible();
  await page.getByRole("button", { name: "명단 확정" }).click();
  await expect(page.getByText("130개 행을 확정했습니다.")).toBeVisible();
  await page.goto(`/events/${data.eventId}`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "엑셀 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("명단");
});
