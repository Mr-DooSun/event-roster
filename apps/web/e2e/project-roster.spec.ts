import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator moves a pre-registration project in progress and updates its roster summary", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  const summaryUrl = `${data.baseUrl}/api/v1/projects/${data.rosterProjectId}/summary`;
  const summaryResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === summaryUrl && response.request().method() === "GET",
  );
  await page.goto(`/projects/${data.rosterProjectId}`);
  const summaryResponse = await summaryResponsePromise;
  expect(summaryResponse.url()).toBe(summaryUrl);
  expect(summaryResponse.ok()).toBe(true);
  expect(await summaryResponse.json()).toMatchObject({
    projectId: data.rosterProjectId,
    expectedTotal: 0,
  });
  await expect(
    page.getByRole("heading", { name: "E2E 명단 프로젝트" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "개요" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "조직" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "참가 명단" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "변경 이력" })).toBeVisible();
  await expect(page.getByText("예상 0명")).toBeVisible();

  await page.getByRole("tab", { name: "조직" }).click();
  const organizationSearch = page.getByRole("combobox", {
    name: "조직 이름 검색 또는 입력",
  });
  await organizationSearch.fill("황룡사");
  await page
    .getByRole("option", { name: "“황룡사” 새 조직 생성 후 추가" })
    .click();
  await page.getByRole("button", { name: "생성 후 추가" }).click();
  await expect(page.getByText("황룡사", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 일괄 참가자 A\nE2E 일괄 참가자 B");
  await expect(page.getByText("등록 예정 2명 / 최대 30명")).toBeVisible();
  await page.getByRole("button", { name: "2명 명단에 추가" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E 일괄 참가자 A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "E2E 일괄 참가자 B", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2명을 명단에 추가했습니다.")).toBeVisible();

  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 동명이인\nE2E 동명이인");
  await page.getByRole("button", { name: "2명 명단에 추가" }).click();
  await expect(
    page.getByText("입력 목록에 같은 이름이 있습니다.").first(),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "중복 이름을 확인했습니다" })
    .check();
  await page.getByRole("button", { name: "2명 명단에 추가" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E 동명이인", exact: true }),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "진행 시작" }).click();
  await page.getByRole("button", { name: "변경 확인" }).click();
  await expect(page.getByText("진행 중", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "참가자 추가" })).toBeVisible();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 진행 참가자");
  await page.getByRole("button", { name: "1명 명단에 추가" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E 진행 참가자", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("진행 중 추가", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "개요" }).click();
  await expect(page.getByText("예상 4명")).toBeVisible();
  await expect(page.getByText("실제 5명")).toBeVisible();
  await expect(page.getByText("+1명")).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "E2E 진행 참가자 취소" }).click();
  await expect(
    page.getByRole("row", { name: /E2E 진행 참가자.*취소/ }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "개요" }).click();
  await expect(page.getByText("예상 4명")).toBeVisible();
  await expect(page.getByText("실제 4명")).toBeVisible();
  await expect(page.getByText("0명", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.setViewportSize({ width: 900, height: 480 });
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  const organization = page.getByRole("combobox", { name: "소속 조직" });
  await organization.fill("황룡사");
  await expect(page.getByRole("listbox")).toBeVisible();
  const anchorGeometry = await organization.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
  }));
  const geometry = await page.getByRole("listbox").evaluate((element) => ({
    parent: element.parentElement === document.body,
    placement: element.dataset.placement,
    zIndex: Number(getComputedStyle(element).zIndex),
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
    viewport: window.innerHeight,
  }));
  expect(geometry).toMatchObject({
    parent: true,
    placement: "bottom",
    zIndex: 110,
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
  expect(
    Math.abs(geometry.top - (anchorGeometry.bottom + 4)),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("option", { name: "황룡사" }).click();
  await page.getByLabel("이름").fill("최근 조직 참가자");
  await page.getByRole("button", { name: "1명 명단에 추가" }).click();
  await expect(
    page.getByRole("cell", { name: "최근 조직 참가자", exact: true }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await expect(page.getByRole("combobox", { name: "소속 조직" })).toHaveValue(
    "황룡사",
  );
});
