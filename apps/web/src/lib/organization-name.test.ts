import { describe, expect, it } from "vitest";
import { canonicalizeOrganizationInput } from "./organization-name";

describe("canonicalizeOrganizationInput", () => {
  it.each([
    ["  성룡사  ", "성룡사"],
    ["Ｅ２Ｅ 1팀", "e2e 1팀"],
    ["Platform TEAM", "platform team"],
  ])("%s를 검색 키 %s로 정규화한다", (value, expected) => {
    expect(canonicalizeOrganizationInput(value)).toBe(expected);
  });
});
