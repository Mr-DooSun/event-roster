import { expect, request, test } from "@playwright/test";
import { fixture } from "./support";

test("scheduled handler closes an expired project", async () => {
  const data = fixture();
  const api = await request.newContext({
    baseURL: data.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: data.baseUrl },
  });
  const login = await api.post("/api/v1/auth/login", {
    data: { loginId: data.operator.loginId, password: data.operator.password },
  });
  expect(login.ok()).toBe(true);
  const auth = (await login.json()) as {
    accessToken: string;
    csrfToken: string;
  };
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-ER-CSRF": auth.csrfToken,
  };
  const created = await api.post("/api/v1/projects", {
    headers,
    data: { name: "E2E 만료 프로젝트", endDate: "2020-01-01" },
  });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  expect((await api.get("/__scheduled?cron=0+15+*+*+*")).ok()).toBe(true);
  const closed = await api.get(`/api/v1/projects/${project.id}`, { headers });
  expect(await closed.json()).toMatchObject({
    status: "CLOSED",
    closeReason: "SCHEDULED",
  });
  await api.dispose();
});
