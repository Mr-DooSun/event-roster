import { readFileSync } from "node:fs";
import { expect, request, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { fixture, login } from "./support";

test("imports 130 rows and downloads two-sheet Excel", async ({ page }) => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  const loginResponse = await api.post("/api/v1/auth/login", {
    data: {
      loginId: data.operator.loginId,
      password: data.operator.password,
    },
  });
  expect(loginResponse.ok()).toBe(true);
  const auth = (await loginResponse.json()) as {
    accessToken: string;
    csrfToken: string;
  };
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-ER-CSRF": auth.csrfToken,
  };
  const created = await api.post("/api/v1/projects", {
    headers,
    data: { name: "E2E 가져오기 프로젝트" },
  });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string; revision: number };
  expect(
    (
      await api.post(`/api/v1/projects/${project.id}/organizations`, {
        headers,
        data: { organizationId: data.organizationId },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await api.post(`/api/v1/projects/${project.id}/transition`, {
        headers,
        data: {
          targetStatus: "PRE_REGISTRATION",
          expectedRevision: project.revision,
        },
      })
    ).ok(),
  ).toBe(true);
  await api.dispose();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${project.id}/import`);
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
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "엑셀 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("프로젝트-명단");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(
    XLSX.read(readFileSync(downloadPath as string), { type: "buffer" })
      .SheetNames,
  ).toEqual(["프로젝트 집계", "참가 명단"]);
});
