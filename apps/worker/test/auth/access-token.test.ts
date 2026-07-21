import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  issueAccessToken,
  verifyAccessToken,
} from "../../src/auth/access-token";

const signingKey = "test-signing-key-that-is-at-least-32-bytes";
const epoch = new Date("2026-07-21T00:00:00.000Z");

describe("access tokens", () => {
  it("issues a 15-minute JWT with the required session claims", async () => {
    const token = await issueAccessToken(
      { sub: "user-1", sid: "session-1", sv: 3, kind: "FULL" },
      signingKey,
      epoch,
    );
    const claims = await verifyAccessToken(
      token,
      signingKey,
      new Date(epoch.getTime() + 899_000),
    );

    expect(claims).toMatchObject({
      sub: "user-1",
      sid: "session-1",
      sv: 3,
      kind: "FULL",
      iss: "event-roster",
      aud: "event-roster-web",
    });
    expect(claims.exp - claims.iat).toBe(900);
  });

  it("rejects expiry and an invalid signature", async () => {
    const token = await issueAccessToken(
      { sub: "user-1", sid: "session-1", sv: 3, kind: "FULL" },
      signingKey,
      epoch,
    );

    await expect(
      verifyAccessToken(token, signingKey, new Date(epoch.getTime() + 901_000)),
    ).rejects.toThrow();
    await expect(
      verifyAccessToken(token, "different-signing-key-32-bytes-long", epoch),
    ).rejects.toThrow();
  });

  it("rejects invalid issuer, audience, and session claims", async () => {
    const invalidTokens = await Promise.all([
      signRawToken(
        { sid: "session-1", sv: 3, kind: "FULL" },
        "wrong-issuer",
        "event-roster-web",
      ),
      signRawToken(
        { sid: "session-1", sv: 3, kind: "FULL" },
        "event-roster",
        "wrong-audience",
      ),
      signRawToken({ sv: 3, kind: "FULL" }, "event-roster", "event-roster-web"),
      signRawToken(
        { sid: "session-1", sv: 3, kind: "ADMIN" },
        "event-roster",
        "event-roster-web",
      ),
    ]);

    for (const token of invalidTokens) {
      await expect(
        verifyAccessToken(token, signingKey, epoch),
      ).rejects.toThrow();
    }
  });

  it("refuses to issue a token with invalid session claims", async () => {
    await expect(
      issueAccessToken(
        { sub: "", sid: "session-1", sv: 3, kind: "FULL" },
        signingKey,
        epoch,
      ),
    ).rejects.toThrow("INVALID_ACCESS_TOKEN_SUBJECT");
    await expect(
      issueAccessToken(
        { sub: "user-1", sid: "", sv: 3, kind: "FULL" },
        signingKey,
        epoch,
      ),
    ).rejects.toThrow("INVALID_ACCESS_TOKEN_SUBJECT");
    await expect(
      issueAccessToken(
        { sub: "user-1", sid: "session-1", sv: 0, kind: "FULL" },
        signingKey,
        epoch,
      ),
    ).rejects.toThrow("INVALID_ACCESS_TOKEN_SUBJECT");
    await expect(
      issueAccessToken(
        {
          sub: "user-1",
          sid: "session-1",
          sv: 3,
          kind: "ADMIN" as "FULL",
        },
        signingKey,
        epoch,
      ),
    ).rejects.toThrow("INVALID_ACCESS_TOKEN_SUBJECT");
  });

  it("rejects a non-positive session version", async () => {
    const token = await signRawToken(
      { sid: "session-1", sv: 0, kind: "FULL" },
      "event-roster",
      "event-roster-web",
    );

    await expect(verifyAccessToken(token, signingKey, epoch)).rejects.toThrow(
      "INVALID_ACCESS_TOKEN",
    );
  });
});

async function signRawToken(
  payload: Record<string, unknown>,
  issuer: string,
  audience: string,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("user-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(Math.floor(epoch.getTime() / 1000))
    .setExpirationTime(Math.floor(epoch.getTime() / 1000) + 900)
    .sign(new TextEncoder().encode(signingKey));
}
