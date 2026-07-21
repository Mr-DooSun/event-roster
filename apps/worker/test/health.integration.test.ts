import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves the health API from the Worker origin", async () => {
  const response = await exports.default.fetch(
    "https://event-roster.test/api/v1/health",
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
