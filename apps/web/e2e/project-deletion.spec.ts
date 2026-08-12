import { expect, request, test } from "@playwright/test";
import { addProjectOrganizations, fixture, login } from "./support";

test("operator excludes and re-adds an organization, then deletes and restores a closed project", async ({
  page,
}) => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });

  try {
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

    const exclusionResponse = await api.post("/api/v1/projects", {
      headers,
      data: { name: "E2E 조직 제외 프로젝트" },
    });
    expect(exclusionResponse.ok()).toBe(true);
    const exclusionProject = (await exclusionResponse.json()) as {
      id: string;
      name: string;
      revision: number;
    };
    const linkResponse = await api.post(
      `/api/v1/projects/${exclusionProject.id}/organizations`,
      {
        headers,
        data: {
          organizationId: data.organizationId,
          expectedProjectRevision: exclusionProject.revision,
        },
      },
    );
    expect(linkResponse.ok()).toBe(true);

    const deletionResponse = await api.post("/api/v1/projects", {
      headers,
      data: { name: "E2E 삭제 복구 프로젝트" },
    });
    expect(deletionResponse.ok()).toBe(true);
    let closedProject = (await deletionResponse.json()) as {
      id: string;
      name: string;
      revision: number;
      status: string;
    };
    const inProgressResponse = await api.post(
      `/api/v1/projects/${closedProject.id}/transition`,
      {
        headers,
        data: {
          targetStatus: "IN_PROGRESS",
          expectedRevision: closedProject.revision,
        },
      },
    );
    expect(inProgressResponse.ok()).toBe(true);
    closedProject = (await inProgressResponse.json()) as typeof closedProject;
    const closedResponse = await api.post(
      `/api/v1/projects/${closedProject.id}/transition`,
      {
        headers,
        data: {
          targetStatus: "CLOSED",
          expectedRevision: closedProject.revision,
        },
      },
    );
    expect(closedResponse.ok()).toBe(true);
    closedProject = (await closedResponse.json()) as typeof closedProject;

    await login(page, data.operator.loginId, data.operator.password);

    await page.goto(`/projects/${exclusionProject.id}`);
    await page.getByRole("tab", { name: "조직" }).click();
    const projectOrganizations = page
      .locator(".er-panel")
      .filter({ has: page.getByRole("heading", { name: "프로젝트 조직" }) });
    await page.getByRole("button", { name: "프로젝트에서 제외" }).click();
    await page.getByRole("button", { name: "제외하기" }).click();
    await expect(
      projectOrganizations.getByText("E2E 1팀", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("연결된 조직이 없습니다.")).toBeVisible();

    await addProjectOrganizations(page, ["E2E 1팀"]);
    await expect(
      projectOrganizations.getByText("E2E 1팀", { exact: true }),
    ).toBeVisible();

    await page.goto(`/projects/${closedProject.id}`);
    await page.getByRole("button", { name: "프로젝트 삭제" }).click();
    await page
      .getByRole("textbox", { name: "삭제할 프로젝트 이름" })
      .fill(closedProject.name);
    await page
      .getByRole("dialog", { name: "프로젝트 삭제" })
      .getByRole("button", { name: "프로젝트 삭제" })
      .click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByText(closedProject.name, { exact: true }),
    ).toBeHidden();

    await page.getByRole("checkbox", { name: "삭제된 프로젝트 포함" }).check();
    await page
      .getByRole("link", { name: new RegExp(closedProject.name) })
      .click();
    await expect(
      page.getByText("삭제된 프로젝트", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "프로젝트 복구" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${closedProject.id.replaceAll("-", "\\-")}$`),
    );
    await expect(page.getByText("종료", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: closedProject.name }),
    ).toBeVisible();
  } finally {
    await api.dispose();
  }
});
