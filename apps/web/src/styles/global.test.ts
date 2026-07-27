import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("stacks roster filters at the existing medium-screen breakpoint", () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), "src/styles/global.css"),
    "utf8",
  );
  const mediumBreakpoint = stylesheet
    .split("@media (max-width: 60rem) {")[1]
    ?.split("@media ")[0];

  expect(mediumBreakpoint).toMatch(
    /\.er-roster-filters \{\s*grid-template-columns: 1fr;\s*\}/,
  );
  expect(stylesheet).not.toContain("@media (max-width: 54rem)");
});
