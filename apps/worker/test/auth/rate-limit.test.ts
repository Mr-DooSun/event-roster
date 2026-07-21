import { describe, expect, it } from "vitest";
import {
  createIpRateLimitKey,
  createLoginRateLimitKey,
} from "../../src/auth/rate-limit";
import { getClientIp } from "../../src/http/request-context";

const hmacKey = "test-ip-hash-key-that-is-at-least-32-bytes";

describe("rate-limit privacy primitives", () => {
  it("creates stable, scoped HMAC keys without exposing raw values", async () => {
    const loginKey = await createLoginRateLimitKey(hmacKey, " Manager-01 ");
    const sameLoginKey = await createLoginRateLimitKey(hmacKey, "manager-01");
    const ipKey = await createIpRateLimitKey(hmacKey, "203.0.113.7");

    expect(loginKey).toBe(sameLoginKey);
    expect(loginKey).not.toBe(ipKey);
    expect(loginKey).not.toContain("manager-01");
    expect(ipKey).not.toContain("203.0.113.7");
  });

  it("trusts CF-Connecting-IP and never X-Forwarded-For", () => {
    const request = new Request("https://event-roster.test", {
      headers: {
        "CF-Connecting-IP": "203.0.113.7",
        "X-Forwarded-For": "198.51.100.9",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.7");
    expect(
      getClientIp(
        new Request("https://event-roster.test", {
          headers: { "X-Forwarded-For": "198.51.100.9" },
        }),
      ),
    ).toBeNull();
  });
});
