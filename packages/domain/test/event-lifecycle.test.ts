import { describe, expect, it } from "vitest";
import { transitionEvent } from "../src";

describe("transitionEvent", () => {
  it("allows only the approved forward event transitions", () => {
    expect(transitionEvent("DRAFT", "PRE_REGISTRATION", "OPERATOR")).toBe(
      "PRE_REGISTRATION",
    );
    expect(transitionEvent("PRE_REGISTRATION", "DAY_OF", "OPERATOR")).toBe(
      "DAY_OF",
    );
    expect(transitionEvent("DAY_OF", "CLOSED", "OPERATOR")).toBe("CLOSED");
  });

  it("allows only an operator to reopen a closed event to day-of", () => {
    expect(transitionEvent("CLOSED", "DAY_OF", "OPERATOR")).toBe("DAY_OF");
    expect(() =>
      transitionEvent("CLOSED", "DAY_OF", "ORGANIZATION_MANAGER"),
    ).toThrowError("FORBIDDEN");
  });

  it("rejects unapproved transitions", () => {
    expect(() => transitionEvent("CLOSED", "DRAFT", "OPERATOR")).toThrowError(
      "INVALID_TRANSITION",
    );
    expect(() =>
      transitionEvent("DRAFT", "PRE_REGISTRATION", "ORGANIZATION_MANAGER"),
    ).toThrowError("FORBIDDEN");
  });
});
