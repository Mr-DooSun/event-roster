import { expect, test } from "@playwright/test";
import { fixture, login } from "./support";

test("compact bulk participant dialog scrolls only the card list", async ({
  page,
}) => {
  const data = fixture();
  await page.setViewportSize({ width: 900, height: 600 });
  await login(page, data.operator.loginId, data.operator.password);
  await page.goto(`/projects/${data.rosterProjectId}`);
  await page.getByRole("tab", { name: "참가 명단" }).click();
  await page.getByRole("button", { name: "참가자 추가" }).click();
  await page.getByRole("button", { name: "새 참가자" }).click();

  const dialog = page.getByRole("dialog", { name: "참가자 추가" });
  const addRow = dialog.getByRole("button", {
    name: "참가자 추가",
    exact: true,
  });
  for (let index = 0; index < 8; index += 1) await addRow.click();

  const layout = await dialog.evaluate((element) => {
    const form = element.querySelector(".er-dialog-form--roster-compact");
    const summary = element.querySelector(".er-bulk-participant-summary");
    const rows = element.querySelector(".er-bulk-participant-rows");
    const actions = element.querySelector(".er-dialog-actions");
    const remove = element.querySelector(".er-bulk-participant-row__remove");
    if (!form || !summary || !rows || !actions || !remove) {
      throw new Error("compact dialog layout contract is incomplete");
    }
    const dialogRect = element.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const removeRect = remove.getBoundingClientRect();
    return {
      dialogOverflowY: getComputedStyle(element).overflowY,
      rowsOverflowY: getComputedStyle(rows).overflowY,
      dialogScrollable: element.scrollHeight > element.clientHeight + 1,
      rowsScrollable: rows.scrollHeight > rows.clientHeight + 1,
      actionsInsideDialog:
        actionsRect.top >= dialogRect.top &&
        actionsRect.bottom <= dialogRect.bottom,
      removeWidth: removeRect.width,
      removeHeight: removeRect.height,
    };
  });

  expect(layout).toMatchObject({
    dialogOverflowY: "hidden",
    rowsOverflowY: "auto",
    dialogScrollable: false,
    rowsScrollable: true,
    actionsInsideDialog: true,
  });
  expect(layout.removeWidth).toBeGreaterThanOrEqual(44);
  expect(layout.removeHeight).toBeGreaterThanOrEqual(44);
  await expect(
    dialog.getByRole("heading", { name: "참가자 추가" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "새 참가자" })).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "소속 조직" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "명단에 추가" }),
  ).toBeVisible();
});
