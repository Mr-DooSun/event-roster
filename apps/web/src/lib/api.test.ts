import { afterEach, expect, it, vi } from "vitest";
import { createApiClient } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sends an optional json body and csrf header with DELETE", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createApiClient({
    getAuth: () => ({
      accessToken: "access",
      csrfToken: "csrf",
      session: {
        sessionKind: "FULL",
        user: {
          id: "operator",
          loginId: "operator",
          displayName: "운영자",
          role: "OPERATOR",
          organizationIds: [],
          isBootstrap: false,
        },
      },
    }),
    refresh: async () => null,
  });

  await client.delete("/organizations/org-1", {
    confirmationName: "황룡사",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/organizations/org-1",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "황룡사" }),
      headers: expect.any(Headers),
    }),
  );
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("X-ER-CSRF")).toBe("csrf");

  await client.delete("/organizations/org-1/managers/user-1");
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/v1/organizations/org-1/managers/user-1",
    expect.not.objectContaining({ body: expect.anything() }),
  );
});
