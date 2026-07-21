import { expect, it } from "vitest";
import { requireWorkersDevOrigin } from "../scripts/remote-origin.mjs";

it("accepts only an exact HTTPS workers.dev origin", () => {
  expect(
    requireWorkersDevOrigin("https://event-roster.account.workers.dev/"),
  ).toBe("https://event-roster.account.workers.dev");
  for (const invalid of [
    "http://event-roster.account.workers.dev",
    "https://user:pass@event-roster.account.workers.dev",
    "https://event-roster.account.workers.dev:8443",
    "https://event-roster.account.workers.dev/path",
    "https://event-roster.account.workers.dev?redirect=evil",
    "https://event-roster.account.workers.dev#fragment",
    "https://workers.dev",
  ]) {
    expect(() => requireWorkersDevOrigin(invalid)).toThrow(
      "exact HTTPS workers.dev origin",
    );
  }
});
