import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { generateDummyBcryptHash } from "./generate-dummy-bcrypt.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Secret configuration requires an interactive terminal.");
}
const confirmation = await visible(
  "Type event-roster to configure five production Worker Secrets: ",
);
if (confirmation !== "event-roster") throw new Error("Secret setup cancelled.");

const workerRoot = resolve(import.meta.dirname, "..");
const bootstrapTokenPath = resolve(workerRoot, ".bootstrap-token.tmp");
const bootstrapToken = randomBytes(32).toString("base64url");
writeFileSync(bootstrapTokenPath, `${bootstrapToken}\n`, {
  mode: 0o600,
  flag: "wx",
});
const secrets = new Map<string, string>([
  ["JWT_SIGNING_KEY", randomBytes(48).toString("base64url")],
  ["DUMMY_BCRYPT_HASH", await generateDummyBcryptHash()],
  ["IP_HASH_KEY", randomBytes(32).toString("base64url")],
  ["RECOVERY_CODE_PEPPER", randomBytes(32).toString("base64url")],
  ["BOOTSTRAP_TOKEN", bootstrapToken],
]);
const wrangler = resolve(
  workerRoot,
  `node_modules/.bin/wrangler${process.platform === "win32" ? ".cmd" : ""}`,
);
for (const [name, value] of secrets) {
  execFileSync(
    wrangler,
    ["secret", "put", name, "--config", "wrangler.jsonc"],
    {
      cwd: workerRoot,
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}
process.stdout.write(
  "Configured five secrets without printing values. Keep .bootstrap-token.tmp until bootstrap succeeds.\n",
);

async function visible(prompt: string) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}
