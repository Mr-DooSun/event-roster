import { describe, expect, it } from "vitest";
import {
  createCsrfToken,
  hashCsrfToken,
  verifyCsrfToken,
} from "../../src/auth/csrf";
import { assertExactOrigin } from "../../src/http/origin";

describe("CSRF and Origin primitives", () => {
  it("creates and hashes a 32-byte memory token", async () => {
    const token = createCsrfToken((length) =>
      Uint8Array.from({ length }, (_, index) => 255 - index),
    );
    const hash = await hashCsrfToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(verifyCsrfToken(token, hash)).resolves.toBe(true);
    await expect(verifyCsrfToken("different-token", hash)).resolves.toBe(false);
  });

  it("requires an exact same origin", () => {
    const request = new Request(
      "https://event-roster.test/api/v1/auth/logout",
      {
        method: "POST",
        headers: { Origin: "https://event-roster.test" },
      },
    );

    expect(() =>
      assertExactOrigin(request, "https://event-roster.test"),
    ).not.toThrow();
    expect(() =>
      assertExactOrigin(request, "https://other-event-roster.test"),
    ).toThrow("INVALID_CSRF");
    expect(() =>
      assertExactOrigin(
        new Request(request.url, { method: "POST" }),
        "https://event-roster.test",
      ),
    ).toThrow("INVALID_CSRF");
  });
});
