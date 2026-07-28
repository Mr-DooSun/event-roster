import { describe, expect, it } from "vitest";
import { canonicalizeParticipantName, normalizeParticipantName } from "../src";

describe("participant name normalization", () => {
  it.each([
    ["  홍길동  ", "홍길동"],
    ["김\t 민수", "김 민수"],
    ["Ｅ２Ｅ   Leader", "E2E Leader"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeParticipantName(input)).toBe(expected);
  });

  it("uses locale-independent lowercase for duplicate keys", () => {
    expect(canonicalizeParticipantName("  E2E   LEADER ")).toBe("e2e leader");
  });
});
