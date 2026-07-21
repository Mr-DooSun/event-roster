import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCapabilityPass, type CapabilityEvidence } from "../src/evidence";
import { selectLatestEvidenceFile } from "../src/evidence-file-selection";

const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../docs/superpowers/evidence",
);
const requestedPath = process.argv[2];
let path = requestedPath;
if (requestedPath === "--latest") {
  const filenames = (await readdir(evidenceDirectory)).filter((entry) =>
    /^workers-bcrypt-.*\.json$/u.test(entry),
  );
  const latest = selectLatestEvidenceFile(
    await Promise.all(
      filenames.map(async (name) => ({
        name,
        modifiedTimeMs: (await stat(resolve(evidenceDirectory, name))).mtimeMs,
      })),
    ),
  );
  path = resolve(evidenceDirectory, latest.name);
}

if (!path) throw new Error("provide an evidence path or --latest");
const evidence = JSON.parse(await readFile(path, "utf8")) as CapabilityEvidence;
assertCapabilityPass(evidence);
console.log(`Evidence passed: ${path}`);
