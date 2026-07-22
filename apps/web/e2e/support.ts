import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

export interface E2eFixture {
  operator: { loginId: string; password: string };
  temporaryUser: { loginId: string; password: string };
  projectRosterProjectId: string;
  importProjectId: string;
}

export function fixture() {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, ".local-e2e-env.json"), "utf8"),
  ) as E2eFixture;
}

export async function login(page: Page, loginId: string, password: string) {
  await page.goto("/");
  await page.getByLabel("로그인 ID").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/auth/login") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "로그인" }).click(),
  ]);
  await page.getByLabel("로그인 ID").waitFor({ state: "hidden" });
}
