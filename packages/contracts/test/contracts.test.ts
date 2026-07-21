import { describe, expect, it } from "vitest";
import {
  EventStatusSchema,
  HalfSchema,
  LoginIdSchema,
  PasswordSchema,
} from "../src";

describe("authentication contracts", () => {
  it("accepts only canonical login IDs", () => {
    expect(LoginIdSchema.safeParse("manager-01").success).toBe(true);
    expect(LoginIdSchema.safeParse("Manager 01").success).toBe(false);
    expect(LoginIdSchema.parse("  Manager-01  ")).toBe("manager-01");
    expect(LoginIdSchema.safeParse("01-manager").success).toBe(false);
  });

  it("enforces password length in UTF-8 bytes", () => {
    expect(PasswordSchema.safeParse("safe-pass-01").success).toBe(true);
    expect(PasswordSchema.safeParse("short").success).toBe(false);
    expect(PasswordSchema.safeParse("가".repeat(24)).success).toBe(true);
    expect(PasswordSchema.safeParse(`${"가".repeat(24)}a`).success).toBe(false);
  });
});

describe("event contracts", () => {
  it("accepts only the fixed lifecycle and half-year values", () => {
    expect(EventStatusSchema.options).toEqual([
      "DRAFT",
      "PRE_REGISTRATION",
      "DAY_OF",
      "CLOSED",
    ]);
    expect(HalfSchema.options).toEqual(["H1", "H2"]);
    expect(HalfSchema.safeParse("Q2").success).toBe(false);
  });
});
