import { readFileSync } from "node:fs";
import { expect, request, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { fixture, login } from "./support";

test("import and export profile preserves mixed and canceled roster rows", async ({
  page,
}) => {
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
  const linkedResponse = await api.post(
    `/api/v1/projects/${project.id}/organizations`,
    {
      headers,
      data: {
        organizationId: data.organizationId,
        expectedProjectRevision: project.revision,
      },
    },
  );
  expect(linkedResponse.ok()).toBe(true);
  await api.dispose();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${project.id}/import`);
  const oldWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    oldWorkbook,
    XLSX.utils.json_to_sheet([{ 이름: "E2E 구형 참가자", 조직: "E2E 1팀" }]),
    "참가자",
  );
  await page.getByLabel("엑셀 파일").setInputFiles({
    name: "old-participants.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      XLSX.write(oldWorkbook, { type: "array", bookType: "xlsx" }),
    ),
  });
  await page.getByRole("button", { name: "서버 검증" }).click();
  await expect(
    page.getByText("필수 열이 없습니다: 참가자 구분, 학년"),
  ).toBeVisible();

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        이름: "E2E 활성 학생",
        조직: "E2E 1팀",
        "참가자 구분": "학생",
        학년: "중2",
      },
      {
        이름: "E2E 취소 학생",
        조직: "E2E 1팀",
        "참가자 구분": "학생",
        학년: "중3",
      },
      {
        이름: "E2E 담당교사",
        조직: "E2E 1팀",
        "참가자 구분": "담당교사",
        학년: "",
      },
    ]),
    "참가자",
  );
  await page.getByLabel("엑셀 파일").setInputFiles({
    name: "mixed-participants.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
    ),
  });
  await page.getByRole("button", { name: "서버 검증" }).click();
  await expect(page.getByText("검증 완료")).toBeVisible();
  await page.getByRole("button", { name: "명단 확정" }).click();
  await expect(page.getByText("3개 행을 확정했습니다.")).toBeVisible();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  const cancelledStudentRow = page.getByRole("row", { name: /E2E 취소 학생/ });
  await cancelledStudentRow
    .getByRole("button", { name: "E2E 취소 학생 취소" })
    .click();
  await expect(
    cancelledStudentRow.getByRole("cell", { name: "취소" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "참가자 구분 필터" })
    .selectOption("TEACHER");
  await expect(page.getByRole("row", { name: /E2E 담당교사/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E 활성 학생/ })).toBeHidden();

  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.getByRole("button", { name: "엑셀 내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "엑셀 명단 내보내기" });
  await expect(dialog).toBeVisible();
  expect(downloads).toHaveLength(0);
  await expect(
    dialog.locator("dl div").filter({ hasText: "전체" }),
  ).toContainText("3명");
  await expect(
    dialog.locator("dl div").filter({ hasText: "참석" }),
  ).toContainText("2명");
  await expect(
    dialog.locator("dl div").filter({ hasText: "취소" }),
  ).toContainText("1명");
  await expect(
    dialog.locator("dl div").filter({ hasText: "학생" }),
  ).toContainText("1명");
  await expect(
    dialog.locator("dl div").filter({ hasText: "교사" }),
  ).toContainText("1명");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "엑셀 내보내기" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "E2E 가져오기 프로젝트-프로젝트-명단.xlsx",
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedWorkbook = XLSX.read(readFileSync(downloadPath as string), {
    type: "buffer",
  });
  expect(exportedWorkbook.SheetNames).toEqual(["프로젝트 집계", "참가 명단"]);
  const rosterSheet = exportedWorkbook.Sheets["참가 명단"];
  expect(rosterSheet).toBeDefined();
  const rosterRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
    rosterSheet as XLSX.WorkSheet,
  );
  expect(rosterRows).toHaveLength(3);
  const rosterHeaders = XLSX.utils.sheet_to_json<string[]>(
    rosterSheet as XLSX.WorkSheet,
    {
      header: 1,
    },
  )[0];
  expect(rosterHeaders).toEqual(
    expect.arrayContaining(["참가자 구분", "학년", "등록 시점"]),
  );
  const activeStudent = rosterRows.find((row) => row.이름 === "E2E 활성 학생");
  const cancelledStudent = rosterRows.find(
    (row) => row.이름 === "E2E 취소 학생",
  );
  const teacher = rosterRows.find((row) => row.이름 === "E2E 담당교사");
  expect(activeStudent).toMatchObject({
    이름: "E2E 활성 학생",
    조직: "E2E 1팀",
    "참가자 구분": "학생",
    학년: "중2",
    "등록 시점": "사전",
    상태: "참석",
  });
  expect(cancelledStudent).toMatchObject({
    이름: "E2E 취소 학생",
    조직: "E2E 1팀",
    "참가자 구분": "학생",
    학년: "중3",
    "등록 시점": "사전",
    상태: "취소",
  });
  expect(teacher).toMatchObject({
    이름: "E2E 담당교사",
    조직: "E2E 1팀",
    "참가자 구분": "담당교사",
    학년: "",
    "등록 시점": "사전",
    상태: "참석",
  });

  const summarySheet = exportedWorkbook.Sheets["프로젝트 집계"];
  expect(summarySheet).toBeDefined();
  expect(
    XLSX.utils.sheet_to_json<Record<string, string | number>>(
      summarySheet as XLSX.WorkSheet,
    ),
  ).toEqual([
    expect.objectContaining({
      조직: "E2E 1팀",
      예상: 2,
      최종: 2,
    }),
  ]);
});
