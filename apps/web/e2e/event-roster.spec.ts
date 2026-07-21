import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("operator opens the event roster and sees server summary", async ({
  page,
}) => {
  const data = fixture();
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/events/${data.eventId}`);
  await expect(
    page.getByRole("heading", { name: "E2E 상반기 행사" }),
  ).toBeVisible();
  await expect(page.getByText("예상 0명")).toBeVisible();
  await expect(page.getByRole("button", { name: "참가자 추가" })).toBeVisible();
});
