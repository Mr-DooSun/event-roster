import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCapabilityPass, type CapabilityEvidence } from "../src/evidence";

const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../docs/superpowers/evidence",
);
const requestedPath = process.argv[2];
let path = requestedPath;
if (requestedPath === "--latest") {
  const latest = (await readdir(evidenceDirectory))
    .filter((entry) => /^workers-bcrypt-.*\.json$/u.test(entry))
    .sort()
    .at(-1);
  if (!latest) throw new Error("no Workers bcrypt evidence exists");
  path = resolve(evidenceDirectory, latest);
}

if (!path) throw new Error("provide an evidence path or --latest");
const evidence = JSON.parse(await readFile(path, "utf8")) as CapabilityEvidence;
assertCapabilityPass(evidence);
console.log(`Evidence passed: ${path}`);
