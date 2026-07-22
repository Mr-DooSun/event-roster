import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { request } from "@playwright/test";

interface Fixture {
  baseUrl: string;
  bootstrapToken: string;
  bootstrap: { loginId: string; displayName: string; password: string };
  operator: { loginId: string; displayName: string; password: string };
  temporaryUser: { loginId: string; displayName: string; password?: string };
  organizationId?: string;
  projectId?: string;
}

export default async function globalSetup() {
  const fixturePath = resolve(import.meta.dirname, ".local-e2e-env.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  const api = await request.newContext({
    baseURL: fixture.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: fixture.baseUrl },
  });
  await ok(
    await api.post("/api/v1/bootstrap", {
      headers: { "X-Bootstrap-Token": fixture.bootstrapToken },
      data: fixture.bootstrap,
    }),
  );
  const bootstrapAuth = await login(
    api,
    fixture.bootstrap.loginId,
    fixture.bootstrap.password,
  );
  const operatorCreation = await api.post("/api/v1/bootstrap/first-operator", {
    headers: authHeaders(bootstrapAuth),
    data: {
      loginId: fixture.operator.loginId,
      displayName: fixture.operator.displayName,
    },
  });
  await ok(operatorCreation);
  const operatorTemporary = (await operatorCreation.json()) as {
    temporaryPassword: string;
  };
  const temporaryAuth = await login(
    api,
    fixture.operator.loginId,
    operatorTemporary.temporaryPassword,
  );
  const changed = await api.post("/api/v1/auth/change-password", {
    headers: authHeaders(temporaryAuth),
    data: {
      currentPassword: operatorTemporary.temporaryPassword,
      newPassword: fixture.operator.password,
    },
  });
  await ok(changed);
  const operatorAuth = await login(
    api,
    fixture.operator.loginId,
    fixture.operator.password,
  );
  const organization = await api.post("/api/v1/organizations", {
    headers: authHeaders(operatorAuth),
    data: { name: "E2E 1팀" },
  });
  await ok(organization);
  const organizationId = ((await organization.json()) as { id: string }).id;
  fixture.organizationId = organizationId;
  const projectResponse = await api.post("/api/v1/projects", {
    headers: authHeaders(operatorAuth),
    data: {
      name: "E2E 상반기 프로젝트",
      startDate: "2029-05-22",
      endDate: "2029-05-23",
    },
  });
  await ok(projectResponse);
  const project = (await projectResponse.json()) as {
    id: string;
    revision: number;
  };
  await ok(
    await api.post(`/api/v1/projects/${project.id}/organizations`, {
      headers: authHeaders(operatorAuth),
      data: { organizationId: fixture.organizationId },
    }),
  );
  await ok(
    await api.post(`/api/v1/projects/${project.id}/transition`, {
      headers: authHeaders(operatorAuth),
      data: {
        targetStatus: "PRE_REGISTRATION",
        expectedRevision: project.revision,
      },
    }),
  );
  fixture.projectId = project.id;
  const temporaryUser = await api.post("/api/v1/users", {
    headers: authHeaders(operatorAuth),
    data: {
      loginId: fixture.temporaryUser.loginId,
      displayName: fixture.temporaryUser.displayName,
      role: "OPERATOR",
      organizationIds: [],
    },
  });
  await ok(temporaryUser);
  fixture.temporaryUser.password = (
    (await temporaryUser.json()) as { temporaryPassword: string }
  ).temporaryPassword;
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, {
    mode: 0o600,
  });
  await api.dispose();
}

async function login(
  api: Awaited<ReturnType<typeof request.newContext>>,
  loginId: string,
  password: string,
) {
  const response = await api.post("/api/v1/auth/login", {
    data: { loginId, password },
  });
  await ok(response);
  return (await response.json()) as { accessToken: string; csrfToken: string };
}

function authHeaders(auth: { accessToken: string; csrfToken: string }) {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "X-ER-CSRF": auth.csrfToken,
  };
}

async function ok(response: {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
}) {
  if (!response.ok()) {
    throw new Error(`E2E setup request failed with HTTP ${response.status()}`);
  }
}
