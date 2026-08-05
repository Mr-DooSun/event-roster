import { expect, request, test } from "@playwright/test";
import * as XLSX from "xlsx";
import {
  cleanupE2eResources,
  describeE2eCleanupFailures,
  type E2eCleanupFailure,
  fixture,
  login,
} from "./support";

interface AuthTokens {
  accessToken: string;
  csrfToken: string;
}

interface ProjectView {
  id: string;
  name: string;
  revision: number;
  status: "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED";
  closedAt: string | null;
  closedBy: string | null;
  closeReason: "MANUAL" | "SCHEDULED" | null;
}

interface ProjectSummaryView {
  expectedTotal: number;
  finalTotal: number;
  deltaTotal: number;
}

test("operator corrects closed history while an organization manager stays read-only", async ({
  page,
}, testInfo) => {
  const data = fixture();
  const projectName = "E2E 종료 이력 보정 프로젝트";
  const activeOrganizationName = "E2E 보정 기준 조직";
  const inactiveOrganizationName = "E2E 보정 사용 중지 조직";
  const baselineParticipantName = "E2E 보정 기존 학생";
  const editedParticipantName = "E2E 보정 당시 학생";
  const addedStudentName = "E2E 보정 추가 학생";
  const addedTeacherName = "E2E 보정 추가 교사";
  const importedParticipantName = "E2E 보정 엑셀 학생";
  const managerLoginId = "e2e-closed-correction-manager";
  const inactiveManagerLoginId = "e2e-inactive-correction-manager";
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  let cleanupAuth: AuthTokens | null = null;
  let cleanupProject: { id: string; name: string } | null = null;
  const cleanupOrganizations: Array<{ id: string; name: string }> = [];
  let bodyFailed = false;
  let bodyError: unknown;

  try {
    const operatorAuth = await authenticate(
      api,
      data.operator.loginId,
      data.operator.password,
    );
    cleanupAuth = operatorAuth;
    const operatorHeaders = authHeaders(operatorAuth);

    const activeOrganizationResponse = await api.post("/api/v1/organizations", {
      headers: operatorHeaders,
      data: { name: activeOrganizationName },
    });
    expect(activeOrganizationResponse.ok()).toBe(true);
    const activeOrganization = (await activeOrganizationResponse.json()) as {
      id: string;
    };
    cleanupOrganizations.push({
      id: activeOrganization.id,
      name: activeOrganizationName,
    });

    const inactiveOrganizationResponse = await api.post(
      "/api/v1/organizations",
      {
        headers: operatorHeaders,
        data: { name: inactiveOrganizationName },
      },
    );
    expect(inactiveOrganizationResponse.ok()).toBe(true);
    const inactiveOrganization =
      (await inactiveOrganizationResponse.json()) as { id: string };
    cleanupOrganizations.push({
      id: inactiveOrganization.id,
      name: inactiveOrganizationName,
    });

    const managerResponse = await api.post(
      `/api/v1/organizations/${activeOrganization.id}/managers`,
      {
        headers: operatorHeaders,
        data: {
          kind: "NEW",
          loginId: managerLoginId,
          displayName: "E2E 종료 이력 조직장",
          assignmentRole: "MANAGER",
        },
      },
    );
    expect(managerResponse.ok()).toBe(true);
    const manager = (await managerResponse.json()) as {
      temporaryPassword: string;
    };
    const temporaryManagerAuth = await authenticate(
      api,
      managerLoginId,
      manager.temporaryPassword,
    );
    const passwordChangeResponse = await api.post(
      "/api/v1/auth/change-password",
      {
        headers: authHeaders(temporaryManagerAuth),
        data: {
          currentPassword: manager.temporaryPassword,
          newPassword: data.organizationManager.password,
        },
      },
    );
    expect(passwordChangeResponse.ok()).toBe(true);

    const inactiveManagerResponse = await api.post(
      `/api/v1/organizations/${inactiveOrganization.id}/managers`,
      {
        headers: operatorHeaders,
        data: {
          kind: "NEW",
          loginId: inactiveManagerLoginId,
          displayName: "E2E 사용 중지 이력 조직장",
          assignmentRole: "MANAGER",
        },
      },
    );
    expect(inactiveManagerResponse.ok()).toBe(true);
    const inactiveManager = (await inactiveManagerResponse.json()) as {
      temporaryPassword: string;
    };
    const temporaryInactiveManagerAuth = await authenticate(
      api,
      inactiveManagerLoginId,
      inactiveManager.temporaryPassword,
    );
    const inactiveManagerPasswordChangeResponse = await api.post(
      "/api/v1/auth/change-password",
      {
        headers: authHeaders(temporaryInactiveManagerAuth),
        data: {
          currentPassword: inactiveManager.temporaryPassword,
          newPassword: data.organizationManager.password,
        },
      },
    );
    expect(inactiveManagerPasswordChangeResponse.ok()).toBe(true);

    const projectResponse = await api.post("/api/v1/projects", {
      headers: operatorHeaders,
      data: { name: projectName },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = (await projectResponse.json()) as ProjectView;
    cleanupProject = { id: project.id, name: project.name };

    const linkResponse = await api.post(
      `/api/v1/projects/${project.id}/organizations`,
      {
        headers: operatorHeaders,
        data: {
          organizationId: activeOrganization.id,
          expectedProjectRevision: project.revision,
        },
      },
    );
    expect(linkResponse.ok()).toBe(true);
    const link = (await linkResponse.json()) as { projectRevision: number };

    const baselineRosterResponse = await api.post(
      `/api/v1/projects/${project.id}/roster/bulk`,
      {
        headers: operatorHeaders,
        data: {
          organizationId: activeOrganization.id,
          participants: [
            {
              name: baselineParticipantName,
              role: "STUDENT",
              grade: "M1",
            },
          ],
          confirmDuplicateNames: false,
          expectedRevision: link.projectRevision,
        },
      },
    );
    expect(baselineRosterResponse.ok()).toBe(true);
    const baselineRoster = (await baselineRosterResponse.json()) as {
      projectRevision: number;
    };

    const inProgressResponse = await api.post(
      `/api/v1/projects/${project.id}/transition`,
      {
        headers: operatorHeaders,
        data: {
          targetStatus: "IN_PROGRESS",
          expectedRevision: baselineRoster.projectRevision,
        },
      },
    );
    expect(inProgressResponse.ok()).toBe(true);
    const inProgressProject = (await inProgressResponse.json()) as ProjectView;

    const expectedSnapshotResponse = await api.get(
      `/api/v1/projects/${project.id}/summary`,
      { headers: operatorHeaders },
    );
    expect(expectedSnapshotResponse.ok()).toBe(true);
    const expectedSnapshot =
      (await expectedSnapshotResponse.json()) as ProjectSummaryView;
    expect(expectedSnapshot).toMatchObject({
      expectedTotal: 1,
      finalTotal: 1,
      deltaTotal: 0,
    });

    const closeResponse = await api.post(
      `/api/v1/projects/${project.id}/transition`,
      {
        headers: operatorHeaders,
        data: {
          targetStatus: "CLOSED",
          expectedRevision: inProgressProject.revision,
        },
      },
    );
    expect(closeResponse.ok()).toBe(true);
    const closedProject = (await closeResponse.json()) as ProjectView;
    expect(closedProject).toMatchObject({
      status: "CLOSED",
      closeReason: "MANUAL",
    });
    expect(closedProject.closedAt).not.toBeNull();
    expect(closedProject.closedBy).not.toBeNull();

    const deactivateOrganizationResponse = await api.patch(
      `/api/v1/organizations/${inactiveOrganization.id}`,
      {
        headers: operatorHeaders,
        data: { isActive: false },
      },
    );
    expect(deactivateOrganizationResponse.ok()).toBe(true);

    await login(page, data.operator.loginId, data.operator.password);
    await page.goto(`/projects/${project.id}`);
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
    await expect(page.getByText("종료", { exact: true })).toBeVisible();
    await expect(page.getByText("예상 1명", { exact: true })).toBeVisible();
    await expect(page.getByText("실제 1명", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "이력 보정 시작" }).click();
    await expect(page.getByLabel("종료 후 이력 보정")).toBeVisible();

    await page.getByRole("tab", { name: "조직" }).click();
    const organizationSearch = page.getByRole("combobox", {
      name: "조직 이름 검색 또는 입력",
    });
    await organizationSearch.fill(inactiveOrganizationName);
    await page
      .getByRole("option", {
        name: `${inactiveOrganizationName} · 사용 중지`,
      })
      .click();
    await page.getByRole("button", { name: "프로젝트에 추가" }).click();
    const inactiveMembership = page
      .getByRole("listitem")
      .filter({ hasText: inactiveOrganizationName });
    await expect(inactiveMembership).toBeVisible();
    await expect(
      inactiveMembership.getByText("사용 중지", { exact: true }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "참가 명단" }).click();
    await page.getByRole("button", { name: "참가자 추가" }).click();
    const participantDialog = page.getByRole("dialog", {
      name: "참가자 추가",
    });
    await participantDialog.getByRole("button", { name: "새 참가자" }).click();
    const organizationInput = participantDialog.getByRole("combobox", {
      name: "소속 조직",
    });
    await organizationInput.fill(inactiveOrganizationName);
    await page
      .getByRole("option", {
        name: `${inactiveOrganizationName} · 사용 중지`,
      })
      .click();
    await participantDialog
      .getByRole("button", { name: "참가자 추가" })
      .click();
    await participantDialog
      .getByRole("textbox", { name: "1번 이름" })
      .fill(addedStudentName);
    await participantDialog
      .getByRole("combobox", { name: "1번 학년" })
      .selectOption("M2");
    await participantDialog
      .getByRole("button", { name: "참가자 추가" })
      .click();
    await participantDialog
      .getByRole("textbox", { name: "2번 이름" })
      .fill(addedTeacherName);
    await participantDialog
      .getByRole("combobox", { name: "2번 참가자 구분" })
      .selectOption("TEACHER");
    await participantDialog
      .getByRole("button", { name: "2명 명단에 추가" })
      .click();
    await expect(page.getByText("2명을 명단에 추가했습니다.")).toBeVisible();
    const addedStudentRow = page.getByRole("row", {
      name: new RegExp(addedStudentName),
    });
    const addedTeacherRow = page.getByRole("row", {
      name: new RegExp(addedTeacherName),
    });
    await expect(
      addedStudentRow.getByRole("cell", { name: "학생", exact: true }),
    ).toBeVisible();
    await expect(
      addedTeacherRow.getByRole("cell", {
        name: "담당교사",
        exact: true,
      }),
    ).toBeVisible();

    const baselineRow = page.getByRole("row", {
      name: new RegExp(baselineParticipantName),
    });
    await baselineRow.getByRole("button", { name: "정보 수정" }).click();
    const editDialog = page.getByRole("dialog", {
      name: "참가자 정보 수정",
    });
    await editDialog
      .getByRole("textbox", { name: "이름" })
      .fill(editedParticipantName);
    await editDialog.getByRole("combobox", { name: "학년" }).selectOption("M3");
    await editDialog.getByRole("button", { name: "정보 저장" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(editedParticipantName) }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("row", { name: new RegExp(editedParticipantName) })
        .getByRole("cell", { name: "중3", exact: true }),
    ).toBeVisible();
    await addedStudentRow
      .getByRole("button", { name: `${addedStudentName} 취소` })
      .click();
    await expect(
      addedStudentRow.getByRole("cell", { name: "취소", exact: true }),
    ).toBeVisible();
    await addedStudentRow
      .getByRole("button", { name: `${addedStudentName} 복원` })
      .click();
    await expect(
      addedStudentRow.getByRole("cell", { name: "참석", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "엑셀 가져오기" }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/projects/${project.id.replaceAll("-", "\\-")}/import\\?mode=history-correction$`,
      ),
    );
    await expect(page.getByLabel("종료 후 이력 보정")).toBeVisible();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          이름: importedParticipantName,
          조직: inactiveOrganizationName,
          "참가자 구분": "학생",
          학년: "고1",
        },
      ]),
      "참가자",
    );
    await page.getByLabel("엑셀 파일").setInputFiles({
      name: "closed-history-correction.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(
        XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
      ),
    });
    await page.getByRole("button", { name: "서버 검증" }).click();
    await expect(page.getByText("검증 완료")).toBeVisible();
    await page.getByRole("button", { name: "명단 확정" }).click();
    await expect(page.getByText("1개 행을 확정했습니다.")).toBeVisible();
    await page.getByRole("link", { name: "명단으로 돌아가기" }).click();

    await expect(page.getByLabel("종료 후 이력 보정")).toHaveCount(0);
    await page.getByRole("tab", { name: "참가 명단" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(importedParticipantName) }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "개요" }).click();
    await expect(page.getByText("예상 1명", { exact: true })).toBeVisible();
    await expect(page.getByText("실제 4명", { exact: true })).toBeVisible();
    await expect(page.getByText("+3명", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "변경 이력" }).click();
    await expect(page.getByText("종료 후 조직 이력 보정")).toBeVisible();
    await expect(
      page.getByText("종료 후 명단 이력 보정").first(),
    ).toBeVisible();
    await expect(page.getByText("종료 후 엑셀 이력 보정")).toBeVisible();

    await page.getByRole("button", { name: "이력 보정 시작" }).click();
    await expect(page.getByLabel("종료 후 이력 보정")).toBeVisible();
    await page.getByRole("button", { name: "이력 보정 종료" }).click();
    await expect(page.getByLabel("종료 후 이력 보정")).toHaveCount(0);
    await page.getByRole("tab", { name: "조직" }).click();
    await expect(
      page.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "프로젝트에서 제외" }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "참가 명단" }).click();
    await expect(page.getByRole("button", { name: "참가자 추가" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "엑셀 가져오기" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "정보 수정" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: `${addedStudentName} 취소` }),
    ).toHaveCount(0);

    const projectAfterCorrectionResponse = await api.get(
      `/api/v1/projects/${project.id}`,
      { headers: operatorHeaders },
    );
    expect(projectAfterCorrectionResponse.ok()).toBe(true);
    const projectAfterCorrection =
      (await projectAfterCorrectionResponse.json()) as ProjectView;
    expect(projectAfterCorrection).toMatchObject({
      status: "CLOSED",
      closedAt: closedProject.closedAt,
      closedBy: closedProject.closedBy,
      closeReason: closedProject.closeReason,
    });
    const summaryAfterCorrectionResponse = await api.get(
      `/api/v1/projects/${project.id}/summary`,
      { headers: operatorHeaders },
    );
    expect(summaryAfterCorrectionResponse.ok()).toBe(true);
    expect(await summaryAfterCorrectionResponse.json()).toMatchObject({
      expectedTotal: expectedSnapshot.expectedTotal,
      finalTotal: 4,
      deltaTotal: 3,
    });

    const inactiveManagerAuth = await authenticate(
      api,
      inactiveManagerLoginId,
      data.organizationManager.password,
    );
    const inactiveManagerHeaders = authHeaders(inactiveManagerAuth);
    const inactiveManagerProjectsResponse = await api.get("/api/v1/projects", {
      headers: inactiveManagerHeaders,
    });
    expect(inactiveManagerProjectsResponse.ok()).toBe(true);
    const inactiveManagerProjects =
      (await inactiveManagerProjectsResponse.json()) as Array<{ id: string }>;
    expect(inactiveManagerProjects).not.toContainEqual(
      expect.objectContaining({ id: project.id }),
    );
    const inactiveManagerProjectResponse = await api.get(
      `/api/v1/projects/${project.id}`,
      { headers: inactiveManagerHeaders },
    );
    expect(inactiveManagerProjectResponse.status()).toBe(403);
    const inactiveManagerCorrectionRead = await api.get(
      `/api/v1/projects/${project.id}/history-corrections/candidates`,
      { headers: inactiveManagerHeaders },
    );
    expect(inactiveManagerCorrectionRead.status()).toBe(403);
    const inactiveManagerCorrectionWrite = await api.post(
      `/api/v1/projects/${project.id}/history-corrections/organizations`,
      {
        headers: inactiveManagerHeaders,
        data: {
          organizationId: inactiveOrganization.id,
          expectedProjectRevision: projectAfterCorrection.revision,
        },
      },
    );
    expect(inactiveManagerCorrectionWrite.status()).toBe(403);

    const managerAuth = await authenticate(
      api,
      managerLoginId,
      data.organizationManager.password,
    );
    const managerHeaders = authHeaders(managerAuth);
    const managerCorrectionRead = await api.get(
      `/api/v1/projects/${project.id}/history-corrections/candidates`,
      { headers: managerHeaders },
    );
    expect(managerCorrectionRead.status()).toBe(403);
    const managerCorrectionWrite = await api.post(
      `/api/v1/projects/${project.id}/history-corrections/organizations`,
      {
        headers: managerHeaders,
        data: {
          organizationId: inactiveOrganization.id,
          expectedProjectRevision: projectAfterCorrection.revision,
        },
      },
    );
    expect(managerCorrectionWrite.status()).toBe(403);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(
      page,
      inactiveManagerLoginId,
      data.organizationManager.password,
    );
    await expect(page.getByRole("link", { name: projectName })).toHaveCount(0);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await login(page, managerLoginId, data.organizationManager.password);
    await expect(page.getByRole("link", { name: projectName })).toBeVisible();
    await page.getByRole("link", { name: projectName }).click();
    await expect(page.getByText("종료", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "이력 보정 시작" }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "조직" }).click();
    await expect(
      page.getByRole("combobox", { name: "조직 이름 검색 또는 입력" }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "참가 명단" }).click();
    await expect(page.getByText("읽기 전용").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "참가자 추가" })).toHaveCount(
      0,
    );
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  const cleanupFailures: E2eCleanupFailure[] = [];
  if (cleanupAuth) {
    try {
      cleanupFailures.push(
        ...(await cleanupE2eResources({
          api,
          headers: authHeaders(cleanupAuth),
          project: cleanupProject,
          organizations: cleanupOrganizations,
        })),
      );
    } catch (error) {
      cleanupFailures.push({
        resource: "api",
        id: "request-context",
        operation: "cleanup orchestration",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  try {
    await api.dispose();
  } catch (error) {
    cleanupFailures.push({
      resource: "api",
      id: "request-context",
      operation: "dispose",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (cleanupFailures.length > 0) {
    const description = describeE2eCleanupFailures(cleanupFailures);
    testInfo.annotations.push({ type: "cleanup failure", description });
  }
  if (bodyFailed) throw bodyError;
  if (cleanupFailures.length > 0) {
    throw new Error(
      `E2E cleanup failed: ${describeE2eCleanupFailures(cleanupFailures)}`,
    );
  }
});

test("cleanup closes and deletes a pre-registration project before deleting every organization", async () => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  let headers: Record<string, string> | null = null;
  let cleanupProject: { id: string; name: string } | null = null;
  const cleanupOrganizations: Array<{ id: string; name: string }> = [];

  try {
    headers = authHeaders(
      await authenticate(api, data.operator.loginId, data.operator.password),
    );
    for (const name of ["E2E 정리 검증 조직 1", "E2E 정리 검증 조직 2"]) {
      const response = await api.post("/api/v1/organizations", {
        headers,
        data: { name },
      });
      expect(response.ok()).toBe(true);
      const organization = (await response.json()) as { id: string };
      cleanupOrganizations.push({ id: organization.id, name });
    }

    const projectResponse = await api.post("/api/v1/projects", {
      headers,
      data: { name: "E2E 정리 검증 프로젝트" },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = (await projectResponse.json()) as ProjectView;
    expect(project.status).toBe("PRE_REGISTRATION");
    cleanupProject = { id: project.id, name: project.name };

    const failures = await cleanupE2eResources({
      api,
      headers,
      project: cleanupProject,
      organizations: cleanupOrganizations,
    });
    expect(failures).toEqual([]);

    const deletedProjectResponse = await api.get(
      `/api/v1/projects/${project.id}`,
      { headers },
    );
    expect(deletedProjectResponse.status()).toBe(404);
    const organizationsResponse = await api.get("/api/v1/organizations", {
      headers,
    });
    expect(organizationsResponse.ok()).toBe(true);
    const organizations = (await organizationsResponse.json()) as Array<{
      id: string;
    }>;
    expect(
      organizations.some((organization) =>
        cleanupOrganizations.some(
          (cleanupOrganization) => cleanupOrganization.id === organization.id,
        ),
      ),
    ).toBe(false);
  } finally {
    try {
      if (headers) {
        await cleanupE2eResources({
          api,
          headers,
          project: cleanupProject,
          organizations: cleanupOrganizations,
        });
      }
    } catch {
      // Emergency cleanup must not replace the test's assertion error.
    }
    try {
      await api.dispose();
    } catch {
      // Disposal must not replace the test's assertion error.
    }
  }
});

test("cleanup records one organization failure and still deletes the next organization", async () => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  let headers: Record<string, string> | null = null;
  const createdOrganizations: Array<{ id: string; name: string }> = [];

  try {
    headers = authHeaders(
      await authenticate(api, data.operator.loginId, data.operator.password),
    );
    for (const name of ["E2E 독립 정리 후속 조직", "E2E 독립 정리 실패 조직"]) {
      const response = await api.post("/api/v1/organizations", {
        headers,
        data: { name },
      });
      expect(response.ok()).toBe(true);
      const organization = (await response.json()) as { id: string };
      createdOrganizations.push({ id: organization.id, name });
    }

    const [deletedAfterFailure, failedOrganization] = createdOrganizations;
    if (!deletedAfterFailure || !failedOrganization) {
      throw new Error("organization cleanup fixtures were not created");
    }
    const failures = await cleanupE2eResources({
      api,
      headers,
      project: null,
      organizations: [
        deletedAfterFailure,
        { ...failedOrganization, name: "잘못된 확인 이름" },
      ],
    });
    expect(failures).toEqual([
      {
        resource: "organization",
        id: failedOrganization.id,
        operation: "delete",
        status: 409,
      },
    ]);

    const organizationsResponse = await api.get("/api/v1/organizations", {
      headers,
    });
    expect(organizationsResponse.ok()).toBe(true);
    const organizations = (await organizationsResponse.json()) as Array<{
      id: string;
    }>;
    expect(
      organizations.some(
        (organization) => organization.id === deletedAfterFailure.id,
      ),
    ).toBe(false);
    expect(
      organizations.some(
        (organization) => organization.id === failedOrganization.id,
      ),
    ).toBe(true);
  } finally {
    try {
      if (headers) {
        await cleanupE2eResources({
          api,
          headers,
          project: null,
          organizations: createdOrganizations,
        });
      }
    } catch {
      // Emergency cleanup must not replace the test's assertion error.
    }
    try {
      await api.dispose();
    } catch {
      // Disposal must not replace the test's assertion error.
    }
  }
});

async function authenticate(
  api: Awaited<ReturnType<typeof request.newContext>>,
  loginId: string,
  password: string,
) {
  const response = await api.post("/api/v1/auth/login", {
    data: { loginId, password },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as AuthTokens;
}

function authHeaders(auth: AuthTokens) {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-ER-CSRF": auth.csrfToken,
  };
}
