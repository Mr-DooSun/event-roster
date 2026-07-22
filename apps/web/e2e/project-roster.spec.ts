import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator opens the project roster and sees server summary", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${data.projectRosterProjectId}`);
  await expect(
    page.getByRole("heading", { name: "E2E 명단 프로젝트" }),
  ).toBeVisible();
  await expect(page.getByText("예상 0명")).toBeVisible();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toBeVisible();
});
