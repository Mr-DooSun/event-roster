import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("defines every spacing token used by the global stylesheet", () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), "src/styles/global.css"),
    "utf8",
  );
  const tokens = readFileSync(
    resolve(process.cwd(), "src/styles/tokens.css"),
    "utf8",
  );
  const usedSpacingTokens = new Set(
    [...stylesheet.matchAll(/var\((--er-space-\d+)\)/g)].map(
      (match) => match[1],
    ),
  );

  for (const token of usedSpacingTokens) {
    expect(tokens, `${token} is not defined`).toMatch(
      new RegExp(`${token}:\\s*[^;]+;`),
    );
  }
});

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

it("stacks the portal organization listbox above dialogs", () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), "src/styles/global.css"),
    "utf8",
  );

  expect(stylesheet).toMatch(
    /\.er-combobox-list--portal\s*\{[^}]*z-index:\s*110;/s,
  );
});
