import { describe, expect, it } from "vitest";
import {
  CreateProjectRequestSchema,
  EventStatusSchema,
  HalfSchema,
  LoginIdSchema,
  PasswordSchema,
  UpdateProjectRequestSchema,
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

it("accepts duplicate-name project payloads with independently optional dates", () => {
  expect(
    CreateProjectRequestSchema.parse({
      name: "상반기 리더십 캠프",
      endDate: "2026-05-23",
    }),
  ).toEqual({ name: "상반기 리더십 캠프", endDate: "2026-05-23" });
  expect(() =>
    CreateProjectRequestSchema.parse({
      name: "기간 역전",
      startDate: "2026-05-24",
      endDate: "2026-05-23",
    }),
  ).toThrow();
  expect(
    UpdateProjectRequestSchema.parse({
      startDate: null,
      endDate: null,
      expectedRevision: 2,
    }),
  ).toEqual({ startDate: null, endDate: null, expectedRevision: 2 });
});
