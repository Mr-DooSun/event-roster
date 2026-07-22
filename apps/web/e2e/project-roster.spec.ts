import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator opens the project roster and sees server summary", async ({
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
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toBeVisible();
});
