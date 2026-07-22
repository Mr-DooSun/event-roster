import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("temporary user changes password, is logged out, and logs in again", async ({
  page,
}) => {
  const data = fixture();
  const nextPassword = "E2e-new-password-1234";
  await login(page, data.temporaryUser.loginId, data.temporaryUser.password);
  await expect(
    page.getByRole("heading", { name: "새 비밀번호를 설정하세요." }),
  ).toBeVisible();
  await page.getByLabel("현재 비밀번호").fill(data.temporaryUser.password);
  await page
    .getByRole("textbox", {
      name: "새 비밀번호 10자 이상, UTF-8 기준 72바이트 이하",
      exact: true,
    })
    .fill(nextPassword);
  await page.getByLabel("새 비밀번호 확인").fill(nextPassword);
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(
    page.getByRole("heading", { name: "프로젝트 참가자 명단" }),
  ).toBeVisible();
  await login(page, data.temporaryUser.loginId, nextPassword);
  await expect(page.getByRole("heading", { name: "프로젝트" })).toBeVisible();
});
