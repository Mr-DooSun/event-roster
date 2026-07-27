import { describe, expect, it } from "vitest";
import { transitionProject } from "../src";

describe("transitionProject", () => {
  it.each([
    ["PRE_REGISTRATION", "IN_PROGRESS"],
    ["IN_PROGRESS", "CLOSED"],
    ["CLOSED", "IN_PROGRESS"],
  ] as const)("allows OPERATOR %s -> %s", (current, target) => {
    expect(transitionProject(current, target, "OPERATOR")).toBe(target);
  });

  it("rejects skipped and organization-manager transitions", () => {
    expect(() =>
      transitionProject("PRE_REGISTRATION", "CLOSED", "OPERATOR"),
    ).toThrow("INVALID_TRANSITION");
    expect(() =>
      transitionProject(
        "PRE_REGISTRATION",
        "IN_PROGRESS",
        "ORGANIZATION_MANAGER",
      ),
    ).toThrow("FORBIDDEN");
  });
});
