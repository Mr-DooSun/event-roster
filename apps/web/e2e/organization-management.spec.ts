import { expect, request, test } from "@playwright/test";
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
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page.getByRole("textbox", { name: "1번 이름" }).fill("E2E 조직 참가자");
  await page.getByRole("combobox", { name: "1번 학년" }).selectOption("M1");
  await page.getByRole("button", { name: "1명 명단에 추가" }).click();
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

test("operator preserves organization history through deletion, restoration, and reactivation", async ({
  page,
}) => {
  const data = fixture();
  const organizationName = "E2E 삭제 이력 조직";
  const managerLoginId = "e2e-lifecycle-manager";
  const managerDisplayName = "E2E 삭제 이력 조직장";
  const projectName = "E2E 조직 삭제 이력 프로젝트";
  const participantName = "E2E 보존 참가자";
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });

  try {
    const operatorLogin = await api.post("/api/v1/auth/login", {
      data: {
        loginId: data.operator.loginId,
        password: data.operator.password,
      },
    });
    expect(operatorLogin.ok()).toBe(true);
    const operatorAuth = (await operatorLogin.json()) as {
      accessToken: string;
      csrfToken: string;
    };
    const operatorHeaders = {
      Authorization: `Bearer ${operatorAuth.accessToken}`,
      "X-ER-CSRF": operatorAuth.csrfToken,
    };

    const organizationResponse = await api.post("/api/v1/organizations", {
      headers: operatorHeaders,
      data: { name: organizationName },
    });
    expect(organizationResponse.ok()).toBe(true);
    const organization = (await organizationResponse.json()) as {
      id: string;
    };

    const managerResponse = await api.post(
      `/api/v1/organizations/${organization.id}/managers`,
      {
        headers: operatorHeaders,
        data: {
          kind: "NEW",
          loginId: managerLoginId,
          displayName: managerDisplayName,
          assignmentRole: "PRIMARY_LEADER",
        },
      },
    );
    expect(managerResponse.ok()).toBe(true);
    const manager = (await managerResponse.json()) as {
      temporaryPassword: string;
    };
    const managerLogin = await api.post("/api/v1/auth/login", {
      data: {
        loginId: managerLoginId,
        password: manager.temporaryPassword,
      },
    });
    expect(managerLogin.ok()).toBe(true);
    const managerAuth = (await managerLogin.json()) as {
      accessToken: string;
      csrfToken: string;
    };
    const passwordChange = await api.post("/api/v1/auth/change-password", {
      headers: {
        Authorization: `Bearer ${managerAuth.accessToken}`,
        "X-ER-CSRF": managerAuth.csrfToken,
      },
      data: {
        currentPassword: manager.temporaryPassword,
        newPassword: data.organizationManager.password,
      },
    });
    expect(passwordChange.ok()).toBe(true);

    const projectResponse = await api.post("/api/v1/projects", {
      headers: operatorHeaders,
      data: { name: projectName },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = (await projectResponse.json()) as {
      id: string;
      revision: number;
    };
    const linkResponse = await api.post(
      `/api/v1/projects/${project.id}/organizations`,
      {
        headers: operatorHeaders,
        data: {
          organizationId: organization.id,
          expectedProjectRevision: project.revision,
        },
      },
    );
    expect(linkResponse.ok()).toBe(true);
    const link = (await linkResponse.json()) as { projectRevision: number };
    const rosterResponse = await api.post(
      `/api/v1/projects/${project.id}/roster/bulk`,
      {
        headers: operatorHeaders,
        data: {
          organizationId: organization.id,
          participants: [
            { name: participantName, role: "STUDENT", grade: "M1" },
          ],
          confirmDuplicateNames: false,
          expectedRevision: link.projectRevision,
        },
      },
    );
    expect(rosterResponse.ok()).toBe(true);

    await login(page, data.operator.loginId, data.operator.password);
    await page.goto(`/organizations/${organization.id}`);
    await expect(
      page.getByRole("heading", { name: organizationName }),
    ).toBeVisible();
    await page.getByRole("button", { name: "조직 삭제" }).click();
    const deletionDialog = page.getByRole("dialog", { name: "조직 삭제" });
    await deletionDialog
      .getByLabel("확인을 위해 조직 이름을 입력하세요.")
      .fill(organizationName);
    await deletionDialog.getByRole("button", { name: "조직 삭제" }).click();

    await expect(page).toHaveURL(/\/organizations$/);
    await expect(page.getByText(organizationName, { exact: true })).toHaveCount(
      0,
    );

    await page.getByRole("checkbox", { name: "삭제된 조직 보기" }).check();
    const deletedOrganizationLink = page.getByRole("link", {
      name: `${organizationName} 상세 관리`,
    });
    await expect(deletedOrganizationLink).toBeVisible();
    const deletedOrganizationCard = page
      .locator(".er-organization-summary-card")
      .filter({ has: deletedOrganizationLink });
    await expect(
      deletedOrganizationCard.getByText("삭제됨", { exact: true }),
    ).toBeVisible();
    await deletedOrganizationLink.click();

    await expect(
      page.locator(".er-project-meta").getByText("삭제됨", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(managerDisplayName, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: projectName })).toBeVisible();

    await page.goto(`/projects/${project.id}`);
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
    const summaryRow = page
      .getByRole("row")
      .filter({ hasText: organizationName });
    await expect(summaryRow.getByText("삭제됨", { exact: true })).toBeVisible();
    await expect(summaryRow.getByRole("cell").nth(3)).toHaveText("1");

    await page.getByRole("tab", { name: "참가 명단" }).click();
    const rosterRow = page
      .getByRole("row")
      .filter({ hasText: participantName });
    await expect(rosterRow).toBeVisible();
    await expect(
      rosterRow.getByText(organizationName, { exact: true }),
    ).toBeVisible();
    await expect(rosterRow.getByText("삭제됨", { exact: true })).toBeVisible();

    await page.goto(`/organizations/${organization.id}`);
    await page.getByRole("button", { name: "조직 복구" }).click();
    await expect(
      page.getByText("조직을 사용 중지 상태로 복구했습니다."),
    ).toBeVisible();
    await expect(
      page.locator(".er-project-meta").getByText("사용 중지", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(managerDisplayName, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: projectName })).toBeVisible();

    await page.getByRole("button", { name: "조직 다시 사용" }).click();
    await page.getByRole("button", { name: "상태 변경 확인" }).click();
    await expect(
      page.locator(".er-project-meta").getByText("사용 중", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(page, managerLoginId, data.organizationManager.password);
    await expect(page.getByRole("link", { name: projectName })).toBeVisible();
    await page.getByRole("link", { name: projectName }).click();
    await page.getByRole("tab", { name: "참가 명단" }).click();
    await expect(
      page.getByText(participantName, { exact: true }),
    ).toBeVisible();
  } finally {
    await api.dispose();
  }
});
