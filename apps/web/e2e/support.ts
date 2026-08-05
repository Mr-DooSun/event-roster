import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";

export interface E2eFixture {
  baseUrl: string;
  bootstrapToken: string;
  bootstrap: { loginId: string; displayName: string; password: string };
  operator: { loginId: string; displayName: string; password: string };
  temporaryUser: { loginId: string; displayName: string; password: string };
  organizationManager: { password: string };
  organizationId: string;
  projectId: string;
  rosterProjectId: string;
}

export function fixture() {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, ".local-e2e-env.json"), "utf8"),
  ) as E2eFixture;
}

export async function login(page: Page, loginId: string, password: string) {
  await page.goto("/");
  await page.getByLabel("로그인 ID").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/auth/login") &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "로그인" }).click(),
  ]);
  await page.getByLabel("로그인 ID").waitFor({ state: "hidden" });
}

export interface E2eCleanupResource {
  id: string;
  name: string;
}

export interface E2eCleanupFailure {
  resource: "project" | "organization" | "api";
  id: string;
  operation: string;
  status?: number;
  message?: string;
}

export async function cleanupE2eResources(input: {
  api: APIRequestContext;
  headers: Record<string, string>;
  project: E2eCleanupResource | null;
  organizations: E2eCleanupResource[];
}): Promise<E2eCleanupFailure[]> {
  const failures: E2eCleanupFailure[] = [];

  if (input.project) {
    try {
      const latestProjectResponse = await input.api.get(
        `/api/v1/projects/${input.project.id}`,
        { headers: input.headers },
      );
      if (latestProjectResponse.status() === 404) {
        // Already absent is a successful cleanup outcome.
      } else if (!latestProjectResponse.ok()) {
        failures.push({
          resource: "project",
          id: input.project.id,
          operation: "read latest state",
          status: latestProjectResponse.status(),
        });
      } else {
        let latestProject = (await latestProjectResponse.json()) as {
          id: string;
          status: "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED";
          revision: number;
        };

        if (latestProject.status === "PRE_REGISTRATION") {
          const transitioned = await input.api.post(
            `/api/v1/projects/${input.project.id}/transition`,
            {
              headers: input.headers,
              data: {
                targetStatus: "IN_PROGRESS",
                expectedRevision: latestProject.revision,
              },
            },
          );
          if (!transitioned.ok()) {
            failures.push({
              resource: "project",
              id: input.project.id,
              operation: "transition to IN_PROGRESS",
              status: transitioned.status(),
            });
          } else {
            latestProject = (await transitioned.json()) as typeof latestProject;
          }
        }

        if (
          latestProject.status === "IN_PROGRESS" &&
          !failures.some(
            (failure) =>
              failure.resource === "project" &&
              failure.id === input.project?.id,
          )
        ) {
          const transitioned = await input.api.post(
            `/api/v1/projects/${input.project.id}/transition`,
            {
              headers: input.headers,
              data: {
                targetStatus: "CLOSED",
                expectedRevision: latestProject.revision,
              },
            },
          );
          if (!transitioned.ok()) {
            failures.push({
              resource: "project",
              id: input.project.id,
              operation: "transition to CLOSED",
              status: transitioned.status(),
            });
          } else {
            latestProject = (await transitioned.json()) as typeof latestProject;
          }
        }

        if (
          latestProject.status === "CLOSED" &&
          !failures.some(
            (failure) =>
              failure.resource === "project" &&
              failure.id === input.project?.id,
          )
        ) {
          const deleteProjectResponse = await input.api.delete(
            `/api/v1/projects/${input.project.id}`,
            {
              headers: input.headers,
              data: {
                confirmationName: input.project.name,
                expectedRevision: latestProject.revision,
              },
            },
          );
          if (
            !deleteProjectResponse.ok() &&
            deleteProjectResponse.status() !== 404
          ) {
            failures.push({
              resource: "project",
              id: input.project.id,
              operation: "delete",
              status: deleteProjectResponse.status(),
            });
          }
        }
      }
    } catch (error) {
      failures.push({
        resource: "project",
        id: input.project.id,
        operation: "cleanup",
        message: cleanupErrorMessage(error),
      });
    }
  }

  for (const organization of [...input.organizations].reverse()) {
    try {
      const deleteOrganizationResponse = await input.api.delete(
        `/api/v1/organizations/${organization.id}`,
        {
          headers: input.headers,
          data: { confirmationName: organization.name },
        },
      );
      if (
        !deleteOrganizationResponse.ok() &&
        deleteOrganizationResponse.status() !== 404
      ) {
        failures.push({
          resource: "organization",
          id: organization.id,
          operation: "delete",
          status: deleteOrganizationResponse.status(),
        });
      }
    } catch (error) {
      failures.push({
        resource: "organization",
        id: organization.id,
        operation: "delete",
        message: cleanupErrorMessage(error),
      });
    }
  }

  return failures;
}

export function describeE2eCleanupFailures(failures: E2eCleanupFailure[]) {
  return failures
    .map((failure) => {
      const detail =
        failure.status === undefined
          ? (failure.message ?? "unknown error")
          : `HTTP ${failure.status}`;
      return `${failure.resource} ${failure.id} ${failure.operation}: ${detail}`;
    })
    .join("; ");
}

function cleanupErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
