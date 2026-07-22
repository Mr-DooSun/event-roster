import { describe, expect, it } from "vitest";
import { transitionProject } from "../src";

describe("transitionProject", () => {
  it.each([
    ["PREPARING", "PRE_REGISTRATION"],
    ["PRE_REGISTRATION", "IN_PROGRESS"],
    ["IN_PROGRESS", "CLOSED"],
    ["CLOSED", "IN_PROGRESS"],
  ] as const)("allows OPERATOR %s -> %s", (current, target) => {
    expect(transitionProject(current, target, "OPERATOR")).toBe(target);
  });

  it("rejects skipped and organization-manager transitions", () => {
    expect(() =>
      transitionProject("PREPARING", "IN_PROGRESS", "OPERATOR"),
    ).toThrow("INVALID_TRANSITION");
    expect(() =>
      transitionProject(
        "PREPARING",
        "PRE_REGISTRATION",
        "ORGANIZATION_MANAGER",
      ),
    ).toThrow("FORBIDDEN");
  });
});
