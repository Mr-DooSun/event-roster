import { expect, it } from "vitest";
import { isProjectExpired, toKstDate } from "../src";

it("uses the KST calendar boundary", () => {
  expect(toKstDate(new Date("2026-05-23T14:59:59.999Z"))).toBe("2026-05-23");
  expect(toKstDate(new Date("2026-05-23T15:00:00.000Z"))).toBe("2026-05-24");
  expect(
    isProjectExpired("2026-05-23", new Date("2026-05-23T15:00:00.000Z")),
  ).toBe(true);
  expect(isProjectExpired(null, new Date("2026-05-23T15:00:00.000Z"))).toBe(
    false,
  );
});
