import { describe, expect, it } from "vitest";
import {
  clearRefreshCookie,
  createRefreshCookie,
  createRefreshToken,
  hashRefreshToken,
} from "../../src/auth/refresh-token";

describe("refresh tokens", () => {
  it("creates 32 random bytes as unpadded base64url", () => {
    const calls: number[] = [];
    const token = createRefreshToken((length) => {
      calls.push(length);
      return Uint8Array.from({ length }, (_, index) => index);
    });

    expect(calls).toEqual([32]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("=");
  });

  it("hashes the raw token deterministically without retaining it", async () => {
    const first = await hashRefreshToken("raw-refresh-token");
    const second = await hashRefreshToken("raw-refresh-token");

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("raw-refresh-token");
  });

  it("creates only the secure host refresh cookie", () => {
    expect(createRefreshCookie("raw-token")).toBe(
      "__Host-er_refresh=raw-token; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Strict",
    );
    expect(clearRefreshCookie()).toBe(
      "__Host-er_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
    );
    expect(() => createRefreshCookie("raw-token; SameSite=None")).toThrow(
      "INVALID_REFRESH_TOKEN",
    );
  });
});
