import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "https://127.0.0.1:8787",
    ignoreHTTPSErrors: true,
    trace: "off",
  },
  webServer: {
    command:
      "corepack pnpm@10.28.1 --filter @event-roster/worker run e2e:serve",
    cwd: "../..",
    url: "https://127.0.0.1:8787/api/v1/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
