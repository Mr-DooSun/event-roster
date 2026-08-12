import { expect, request, test } from "@playwright/test";
import {
  addProjectOrganizations,
  fixture,
  login,
  selectRosterFilter,
} from "./support";

test("operator adds two selected organization candidates to a project at once", async ({
  page,
}) => {
  const data = fixture();
  const candidateNames = ["E2E 일괄 추가 후보 알파", "E2E 일괄 추가 후보 베타"];
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
  for (const name of candidateNames) {
    const created = await api.post("/api/v1/organizations", {
      headers,
      data: { name },
    });
    expect(created.ok()).toBe(true);
  }
  await api.dispose();

  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${data.rosterProjectId}`);
  await page.getByRole("tab", { name: "조직" }).click();
  const bulkAddResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${data.baseUrl}/api/v1/projects/${data.rosterProjectId}/organizations/bulk` &&
      response.request().method() === "POST",
  );
  await addProjectOrganizations(page, candidateNames);
  expect((await bulkAddResponse).ok()).toBe(true);

  const projectOrganizations = page
    .locator(".er-panel")
    .filter({ has: page.getByRole("heading", { name: "프로젝트 조직" }) });
  for (const name of candidateNames) {
    await expect(
      projectOrganizations.getByText(name, { exact: true }),
    ).toBeVisible();
  }
});

test("participant profile rows support exact editing and filtering", async ({
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
    data: { name: "E2E 참가자 프로필 프로젝트" },
  });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string; revision: number };
  const linked = await api.post(
    `/api/v1/projects/${project.id}/organizations`,
    {
      headers,
      data: {
        organizationId: data.organizationId,
        expectedProjectRevision: project.revision,
      },
    },
  );
  expect(linked.ok()).toBe(true);
  await api.dispose();

  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page
    .getByRole("textbox", { name: "1번 이름" })
    .fill("E2E 프로필 중학생");
  await page
    .getByRole("combobox", { name: "1번 학년" })
    .selectOption({ label: "중2" });
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page
    .getByRole("textbox", { name: "2번 이름" })
    .fill("E2E 프로필 담당교사");
  await page
    .getByRole("combobox", { name: "2번 참가자 구분" })
    .selectOption({ label: "담당교사" });
  await expect(page.getByRole("combobox", { name: "2번 학년" })).toBeDisabled();
  await page.getByRole("button", { name: "2명 명단에 추가" }).click();

  const studentRow = page.getByRole("row", { name: /E2E 프로필 중학생/ });
  const teacherRow = page.getByRole("row", { name: /E2E 프로필 담당교사/ });
  await expect(
    studentRow.getByRole("cell", { name: "학생", exact: true }),
  ).toBeVisible();
  await expect(
    studentRow.getByRole("cell", { name: "중2", exact: true }),
  ).toBeVisible();
  await expect(
    teacherRow.getByRole("cell", { name: "담당교사", exact: true }),
  ).toBeVisible();
  await expect(
    teacherRow.getByRole("cell", { name: "-", exact: true }),
  ).toBeVisible();

  await studentRow.getByRole("button", { name: "정보 수정" }).click();
  await page
    .getByRole("dialog", { name: "참가자 정보 수정" })
    .getByRole("combobox", { name: "학년" })
    .selectOption({ label: "중3" });
  await page.getByRole("button", { name: "정보 저장" }).click();
  await expect(
    studentRow.getByRole("cell", { name: "중3", exact: true }),
  ).toBeVisible();

  await teacherRow
    .getByRole("button", { name: "E2E 프로필 담당교사 취소" })
    .click();
  await expect(
    teacherRow.getByRole("cell", { name: "취소", exact: true }),
  ).toBeVisible();

  await selectRosterFilter(page, "참가자 구분", "TEACHER");
  await expect(studentRow).toBeHidden();
  await expect(teacherRow).toBeVisible();

  await selectRosterFilter(page, "참가자 구분", "ALL");
  await selectRosterFilter(page, "학년", "M3");
  await expect(studentRow).toBeVisible();
  await expect(teacherRow).toBeHidden();
});

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
  await page.getByRole("textbox", { name: "새 조직 이름" }).fill("황룡사");
  await page.getByRole("button", { name: "새 조직 생성 후 추가" }).click();
  await page
    .getByRole("dialog", { name: "새 조직 생성 후 추가" })
    .getByRole("button", { name: "생성 후 추가" })
    .click();
  await expect(page.getByText("황룡사", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page
    .getByRole("textbox", { name: "1번 이름" })
    .fill("E2E 일괄 참가자 A");
  await page.getByRole("combobox", { name: "1번 학년" }).selectOption("M1");
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page
    .getByRole("textbox", { name: "2번 이름" })
    .fill("E2E 일괄 참가자 B");
  await page.getByRole("combobox", { name: "2번 학년" }).selectOption("M1");
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
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page.getByRole("textbox", { name: "1번 이름" }).fill("E2E 동명이인");
  await page.getByRole("combobox", { name: "1번 학년" }).selectOption("M1");
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page.getByRole("textbox", { name: "2번 이름" }).fill("E2E 동명이인");
  await page.getByRole("combobox", { name: "2번 학년" }).selectOption("M1");
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
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
  await page.getByRole("textbox", { name: "1번 이름" }).fill("E2E 진행 참가자");
  await page.getByRole("combobox", { name: "1번 학년" }).selectOption("M1");
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
  await page
    .getByRole("dialog", { name: "참가자 추가" })
    .getByRole("button", { name: "참가자 추가" })
    .click();
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
  await page
    .getByRole("textbox", { name: "1번 이름" })
    .fill("최근 조직 참가자");
  await page.getByRole("combobox", { name: "1번 학년" }).selectOption("M1");
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
