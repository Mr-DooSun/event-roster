import { expect, it } from "vitest";
import { issueSessionJwt, verifySessionJwt } from "../src/jwt";

it("rejects a token after its signing key changes", async () => {
  const token = await issueSessionJwt(
    { sub: "user-1", sid: "session-1", sv: 1, kind: "FULL" },
    "test-signing-key",
    new Date("2026-07-20T00:00:00.000Z"),
  );
  await expect(
    verifySessionJwt(
      token,
      "test-signing-key",
      new Date("2026-07-20T01:00:00.000Z"),
    ),
  ).resolves.toMatchObject({ sub: "user-1", sv: 1 });
  await expect(
    verifySessionJwt(
      token,
      "different-signing-key",
      new Date("2026-07-20T01:00:00.000Z"),
    ),
  ).rejects.toThrow();
});
