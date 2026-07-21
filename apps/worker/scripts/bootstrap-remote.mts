import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { requireWorkersDevOrigin } from "./remote-origin.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Bootstrap requires an interactive terminal.");
}

const baseUrl = requireWorkersDevOrigin(
  await visible("Exact workers.dev URL: "),
);
const loginId = await visible("Bootstrap login ID: ");
const displayName = await visible("Bootstrap display name: ");
const bootstrapTokenPath = resolve(
  import.meta.dirname,
  "../.bootstrap-token.tmp",
);
const bootstrapToken = readFileSync(bootstrapTokenPath, "utf8").trim();
const password = await hidden("Bootstrap password (hidden): ");
const response = await fetch(`${baseUrl}/api/v1/bootstrap`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Bootstrap-Token": bootstrapToken,
  },
  body: JSON.stringify({ loginId, displayName, password }),
});
if (!response.ok) {
  throw new Error(`Bootstrap failed with HTTP ${response.status}.`);
}
rmSync(bootstrapTokenPath);
process.stdout.write(
  "Bootstrap account created. Continue the first-operator handoff in the browser.\n",
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

async function hidden(prompt: string) {
  process.stdout.write(prompt);
  execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "inherit"] });
  let echoDisabled = true;
  const restoreEcho = () => {
    if (!echoDisabled) return;
    execFileSync("stty", ["echo"], {
      stdio: ["inherit", "ignore", "inherit"],
    });
    echoDisabled = false;
  };
  const interrupt = () => {
    restoreEcho();
    process.stdout.write("\n");
    process.exit(130);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question("")).trim();
  } finally {
    readline.close();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    restoreEcho();
    process.stdout.write("\n");
  }
}
