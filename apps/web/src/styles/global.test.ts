import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("stacks roster filters before their desktop column minima can overflow", () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), "src/styles/global.css"),
    "utf8",
  );

  expect(stylesheet).toMatch(
    /@media \(max-width: 54rem\) \{[\s\S]*?\.er-roster-filters \{\s*grid-template-columns: 1fr;\s*\}/,
  );
});
