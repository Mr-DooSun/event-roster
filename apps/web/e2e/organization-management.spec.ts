import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("existing manager assignment stays usable at 360px", async ({ page }) => {
  const data = fixture();
  await page.setViewportSize({ width: 360, height: 640 });
  await login(page, data.operator.loginId, data.operator.password);
  await page.getByRole("link", { name: "조직 관리" }).click();
  expect(
    await page
      .locator(".er-organization-facts")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);
  await page.getByRole("link", { name: "E2E 1팀 상세 관리" }).click();

  await page.getByRole("button", { name: "새 담당자 발급" }).click();
  await page.getByLabel("영문 로그인 ID").fill("e2e-tab-candidate");
  await page.getByLabel("표시 이름").fill("E2E 탭 후보");
  await page.getByLabel("조직별 역할").selectOption("MANAGER");
  await page.getByRole("button", { name: "계정 발급 및 지정" }).click();
  await page
    .getByRole("dialog", { name: "임시 비밀번호" })
    .getByRole("button", { name: "닫기" })
    .click();
  await page.getByRole("button", { name: "E2E 탭 후보 담당 해제" }).click();
  await page.getByRole("button", { name: "담당 해제 확인" }).click();

  const trigger = page.getByRole("button", { name: "기존 계정 지정" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "기존 담당자 지정" });

  await expect(
    dialog.getByRole("heading", { name: "계정 찾기" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "담당 범위 설정" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "취소" })).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(
    640,
  );
  const verticalOverflow = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(verticalOverflow.overflowY).toBe("auto");
  expect(verticalOverflow.scrollHeight).toBeGreaterThan(
    verticalOverflow.clientHeight,
  );
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await dialog
      .locator(".er-assignment-search")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);
  expect(
    await dialog
      .locator(".er-assignment-fields")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
  ).toBe(1);

  await dialog.getByRole("button", { name: "검색" }).click();
  await dialog.getByRole("combobox", { name: "지정할 계정" }).selectOption({
    index: 1,
  });
  const actions = dialog.locator(".er-dialog-actions");
  expect(
    await actions.evaluate(
      (element) => getComputedStyle(element).flexDirection,
    ),
  ).toBe("column");
  const cancel = dialog.getByRole("button", { name: "취소" });
  const assign = dialog.getByRole("button", { name: "담당자로 지정" });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  await cancel.focus();
  await page.keyboard.press("Tab");
  await expect(assign).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("link", { name: "조직 관리" }).click();
  expect(
    await page
      .locator(".er-organization-facts dd")
      .first()
      .evaluate((element) => getComputedStyle(element).overflowWrap),
  ).toBe("anywhere");
});

test("operator delegates pre-registration roster entry to an organization leader", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  await page.getByRole("link", { name: "조직 관리" }).click();
  await page.getByRole("button", { name: "새 조직" }).click();
  await page.getByLabel("조직 이름", { exact: true }).fill("E2E 2팀");
  await page.getByRole("button", { name: "조직 만들기" }).click();
  await page.getByRole("link", { name: /E2E 2팀/ }).click();
  await expect(page.getByText("대표 조직장 미지정")).toBeVisible();

  await page.getByRole("button", { name: "새 담당자 발급" }).click();
  await page.getByLabel("영문 로그인 ID").fill("e2e-org-leader");
  await page.getByLabel("표시 이름").fill("E2E 대표 조직장");
  await page.getByLabel("조직별 역할").selectOption("PRIMARY_LEADER");
  await page.getByRole("button", { name: "계정 발급 및 지정" }).click();
  const temporaryPassword = await page.locator(".er-secret-value").innerText();
  expect(temporaryPassword).toHaveLength(20);
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator(".er-secret-value")).toHaveCount(0);

  await page.getByRole("link", { name: "프로젝트" }).click();
  await page.getByRole("link", { name: "E2E 상반기 프로젝트" }).click();
  await page.getByRole("tab", { name: "조직" }).click();
  await page
    .getByRole("combobox", { name: "조직 이름 검색 또는 입력" })
    .fill("E2E 2팀");
  await page.getByRole("option", { name: /E2E 2팀/ }).click();
  await page.getByRole("button", { name: "프로젝트에 추가" }).click();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, "e2e-org-leader", temporaryPassword);
  await page.getByLabel("현재 비밀번호").fill(temporaryPassword);
  await page
    .getByRole("textbox", {
      name: "새 비밀번호 10자 이상, UTF-8 기준 72바이트 이하",
      exact: true,
    })
    .fill(data.organizationManager.password);
  await page
    .getByLabel("새 비밀번호 확인")
    .fill(data.organizationManager.password);
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
  await login(page, "e2e-org-leader", data.organizationManager.password);

  await expect(
    page.getByRole("link", { name: "E2E 상반기 프로젝트" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "E2E 비공개 프로젝트" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "E2E 명단 프로젝트" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "E2E 상반기 프로젝트" }).click();
  await page.getByRole("tab", { name: "조직" }).click();
  await expect(page.getByText("E2E 2팀", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E 1팀", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E 대표 조직장", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page.getByLabel("이름").fill("E2E 조직 참가자");
  await page.getByRole("button", { name: "참가자 생성 후 추가" }).click();
  await expect(
    page.getByText("E2E 조직 참가자", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${data.projectId}`);
  await page.getByRole("button", { name: "진행 시작" }).click();
  await page.getByRole("button", { name: "변경 확인" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await login(page, "e2e-org-leader", data.organizationManager.password);
  await page.goto(`/projects/${data.projectId}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await expect(page.getByText("읽기 전용")).toBeVisible();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toHaveCount(
    0,
  );
});
