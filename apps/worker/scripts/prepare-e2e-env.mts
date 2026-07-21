import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDummyBcryptHash } from "./generate-dummy-bcrypt.mjs";

const workerRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(workerRoot, "../..");
const stateDirectory = resolve(workerRoot, ".wrangler/e2e-state");
const fixturePath = resolve(workspaceRoot, "apps/web/e2e/.local-e2e-env.json");
const baseUrl = "https://127.0.0.1:8787";
const bootstrapPassword = `E2e-${randomBytes(18).toString("base64url")}`;
const bootstrapToken = randomBytes(32).toString("base64url");
const values = {
  APP_ORIGIN: baseUrl,
  JWT_SIGNING_KEY: randomBytes(48).toString("base64url"),
  DUMMY_BCRYPT_HASH: await generateDummyBcryptHash(),
  IP_HASH_KEY: randomBytes(32).toString("base64url"),
  RECOVERY_CODE_PEPPER: randomBytes(32).toString("base64url"),
  BOOTSTRAP_TOKEN: bootstrapToken,
};

rmSync(stateDirectory, { recursive: true, force: true });
mkdirSync(stateDirectory, { recursive: true });
mkdirSync(resolve(workspaceRoot, "apps/web/e2e"), { recursive: true });
writeFileSync(
  resolve(workerRoot, ".dev.vars"),
  `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`,
  { mode: 0o600 },
);
writeFileSync(
  fixturePath,
  `${JSON.stringify(
    {
      baseUrl,
      bootstrapToken,
      bootstrap: {
        loginId: "e2e-bootstrap",
        displayName: "E2E 초기 계정",
        password: bootstrapPassword,
      },
      operator: {
        loginId: "e2e-operator",
        displayName: "E2E 운영자",
        password: `E2e-Full-${randomBytes(16).toString("base64url")}`,
      },
      temporaryUser: {
        loginId: "e2e-temporary",
        displayName: "E2E 임시 사용자",
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const wrangler = resolve(
  workerRoot,
  `node_modules/.bin/wrangler${process.platform === "win32" ? ".cmd" : ""}`,
);
execFileSync(
  wrangler,
  [
    "d1",
    "migrations",
    "apply",
    "event-roster-e2e",
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    resolve(workerRoot, "wrangler.e2e.jsonc"),
  ],
  { cwd: workerRoot, stdio: "ignore" },
);
process.stdout.write(
  "Prepared isolated local E2E state without printing secrets.\n",
);
