import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findProject } from "../src/db/projects";
import worker from "../src/index";
import {
  closeExpiredProject,
  closeExpiredProjects,
} from "../src/services/project-expiration";
import { authedRequest, seedOperator } from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);
afterEach(() => vi.useRealTimers());

it("uses the KST date boundary when deciding expiration", async () => {
  const operator = await seedOperator();
  await insertProject(operator.userId, "project-boundary", "2026-05-23");

  expect(
    await closeExpiredProject(
      env,
      "project-boundary",
      new Date("2026-05-23T14:59:59.999Z"),
    ),
  ).toBe(false);
  expect(
    await closeExpiredProject(
      env,
      "project-boundary",
      new Date("2026-05-23T15:00:00.000Z"),
    ),
  ).toBe(true);
});

it("closes an expired project once with one SYSTEM audit row", async () => {
  const operator = await seedOperator();
  await insertProject(operator.userId, "project-expired", "2026-05-23");

  const now = new Date("2026-05-23T15:00:00.000Z");
  expect(await closeExpiredProject(env, "project-expired", now)).toBe(true);
  expect(await closeExpiredProject(env, "project-expired", now)).toBe(false);

  const row = await env.DB.prepare(
    "SELECT status, close_reason, revision FROM projects WHERE id = 'project-expired'",
  ).first<{ status: string; close_reason: string; revision: number }>();
  expect(row).toEqual({
    status: "CLOSED",
    close_reason: "SCHEDULED",
    revision: 1,
  });
  const audits = (
    await env.DB.prepare(
      "SELECT actor_user_id, action FROM audit_logs WHERE entity_id = 'project-expired'",
    ).all<{ actor_user_id: string | null; action: string }>()
  ).results;
  expect(audits).toEqual([
    { actor_user_id: null, action: "PROJECT_AUTO_CLOSED" },
  ]);
});

it("rolls the project close back when the SYSTEM audit insert fails", async () => {
  const operator = await seedOperator();
  await insertProject(operator.userId, "project-atomic", "2026-05-23");
  await env.DB.prepare(`CREATE TRIGGER reject_project_auto_close
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'PROJECT_AUTO_CLOSED'
    BEGIN SELECT RAISE(ABORT, 'AUDIT_REJECTED'); END`).run();

  await expect(
    closeExpiredProject(
      env,
      "project-atomic",
      new Date("2026-05-23T15:00:00.000Z"),
    ),
  ).rejects.toThrow("AUDIT_REJECTED");
  await env.DB.prepare("DROP TRIGGER reject_project_auto_close").run();

  expect(await findProject(env.DB, "project-atomic")).toMatchObject({
    status: "IN_PROGRESS",
    revision: 0,
    closeReason: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = 'project-atomic'",
    ).first<{ count: number }>(),
  ).toEqual({ count: 0 });
});

it("processes only the oldest fifty expired projects", async () => {
  const operator = await seedOperator();
  await env.DB.batch(
    Array.from({ length: 51 }, (_, index) =>
      projectInsert(
        operator.userId,
        `project-${index.toString().padStart(2, "0")}`,
        "2026-05-23",
        `2026-05-01T00:00:${index.toString().padStart(2, "0")}.000Z`,
      ),
    ),
  );

  expect(
    await closeExpiredProjects(env, new Date("2026-05-23T15:00:00.000Z"), 100),
  ).toBe(50);
  expect(await findProject(env.DB, "project-49")).toMatchObject({
    status: "CLOSED",
  });
  expect(await findProject(env.DB, "project-50")).toMatchObject({
    status: "IN_PROGRESS",
  });
});

it("auto-closes before an ordinary HTTP mutation and rejects the mutation", async () => {
  const operator = await seedOperator();
  await insertProject(operator.userId, "project-mutation", "2026-05-23");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-23T15:00:00.000Z"));

  const response = await authedRequest(
    operator,
    "/api/v1/projects/project-mutation",
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "차단되어야 함",
        expectedRevision: 0,
      }),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json<{ code: string }>()).toMatchObject({
    code: "PROJECT_CLOSED",
  });
  expect(await findProject(env.DB, "project-mutation")).toMatchObject({
    name: "만료 프로젝트",
    status: "CLOSED",
    revision: 1,
  });
});

it("runs expiration from the Worker scheduled export", async () => {
  const operator = await seedOperator();
  await insertProject(operator.userId, "project-scheduled", "2000-01-01");
  const ctx = createExecutionContext();

  worker.scheduled(
    createScheduledController({
      cron: "0 15 * * *",
      scheduledTime: Date.now(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(await findProject(env.DB, "project-scheduled")).toMatchObject({
    status: "CLOSED",
    closeReason: "SCHEDULED",
  });
});

async function insertProject(
  operatorId: string,
  projectId: string,
  endDate: string,
): Promise<void> {
  await projectInsert(operatorId, projectId, endDate).run();
}

function projectInsert(
  operatorId: string,
  projectId: string,
  endDate: string,
  createdAt = "2026-05-01T00:00:00.000Z",
): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO projects
    (id, name, end_date, status, revision, created_by, created_at, updated_at)
    VALUES (?, '만료 프로젝트', ?, 'IN_PROGRESS', 0, ?, ?, ?)`).bind(
    projectId,
    endDate,
    operatorId,
    createdAt,
    createdAt,
  );
}
