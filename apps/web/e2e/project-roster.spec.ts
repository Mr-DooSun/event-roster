import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator moves a pre-registration project in progress and updates its roster summary", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  const summaryUrl = `${data.baseUrl}/api/v1/projects/${data.projectId}/summary`;
  const summaryResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === summaryUrl && response.request().method() === "GET",
  );
  await page.goto(`/projects/${data.projectId}`);
  const summaryResponse = await summaryResponsePromise;
  expect(summaryResponse.url()).toBe(summaryUrl);
  expect(summaryResponse.ok()).toBe(true);
  expect(await summaryResponse.json()).toMatchObject({
    projectId: data.projectId,
    expectedTotal: 0,
  });
  await expect(
    page.getByRole("heading", { name: "E2E 상반기 프로젝트" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "개요" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "조직" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "참가 명단" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "변경 이력" })).toBeVisible();
  await expect(page.getByText("예상 0명")).toBeVisible();

  await page.getByRole("button", { name: "진행 시작" }).click();
  await page.getByRole("button", { name: "변경 확인" }).click();
  await expect(page.getByText("진행 중", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toBeVisible();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 진행 참가자");
  await page.getByRole("button", { name: "참가자 생성 후 추가" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E 진행 참가자", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("진행 중 추가", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "개요" }).click();
  await expect(page.getByText("실제 1명")).toBeVisible();
  await expect(page.getByText("+1명")).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "E2E 진행 참가자 취소" }).click();
  await expect(
    page.getByRole("row", { name: /E2E 진행 참가자.*취소/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "개요" }).click();
  await expect(page.getByText("예상 0명")).toBeVisible();
  await expect(page.getByText("실제 0명")).toBeVisible();
  await expect(page.getByText("0명", { exact: true })).toBeVisible();
});
