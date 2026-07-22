import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  authedRequest,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { resetAuthState } from "./support/auth";

beforeEach(resetAuthState);
afterEach(() => vi.useRealTimers());

it("creates duplicate-name projects and validates date order", async () => {
  const operator = await seedOperator();
  const body = {
    name: "리더십 캠프",
    startDate: "2026-05-22",
    endDate: "2026-05-23",
  };
  const first = await authedRequest(operator, "/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const second = await authedRequest(operator, "/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({
    ...body,
    status: "PREPARING",
    createdBy: operator.userId,
    closedBy: null,
  });
  expect(second.status).toBe(201);
  expect(
    (
      await authedRequest(operator, "/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "역전",
          startDate: "2026-05-24",
          endDate: "2026-05-23",
        }),
      })
    ).status,
  ).toBe(422);
});

it("returns project detail and orders open projects before recently closed projects", async () => {
  const operator = await seedOperator();
  const undated = await seedProject(operator, { name: "미정" });
  const dated = await seedProject(operator, {
    name: "예정",
    startDate: "2026-08-01",
  });
  let closing = await seedProject(operator, { name: "종료 대상" });
  closing = await transition(operator, closing, "PRE_REGISTRATION");
  closing = await transition(operator, closing, "IN_PROGRESS");
  const closed = await transition(operator, closing, "CLOSED");

  const detail = await authedRequest(operator, `/api/v1/projects/${closed.id}`);
  expect(await detail.json()).toMatchObject({
    id: closed.id,
    closedBy: operator.userId,
    closeReason: "MANUAL",
  });
  const list = await (await authedRequest(operator, "/api/v1/projects")).json<
    Array<{ id: string }>
  >();
  expect(list.map((project) => project.id)).toEqual([
    dated.id,
    undated.id,
    closed.id,
  ]);
});

it("clears optional dates and rejects a stale patch", async () => {
  const operator = await seedOperator();
  const project = await seedProject(operator, {
    startDate: "2099-05-22",
    endDate: "2099-05-23",
  });
  const cleared = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        startDate: null,
        endDate: null,
        expectedRevision: project.revision,
      }),
    },
  );
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toMatchObject({
    startDate: null,
    endDate: null,
    revision: 1,
  });
  expect(
    (
      await authedRequest(operator, `/api/v1/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: "stale",
          expectedRevision: project.revision,
        }),
      })
    ).status,
  ).toBe(409);
});

it("freezes expected snapshots on IN_PROGRESS and requires a valid reopen date", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-23T14:59:59.999Z"));
  const operator = await seedOperator();
  await seedOrganization();
  const project = await seedProject(operator, { endDate: "2026-05-23" });
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, 'org-1', 1, ?, ?, ?)`)
    .bind(
      project.id,
      "2026-05-01T00:00:00.000Z",
      operator.userId,
      operator.userId,
    )
    .run();
  const pre = await transition(operator, project, "PRE_REGISTRATION");
  const active = await transition(operator, pre, "IN_PROGRESS");
  expect(
    (
      await env.DB.prepare(
        "SELECT expected_count FROM project_expected_snapshots WHERE project_id=? AND organization_id='org-1'",
      )
        .bind(project.id)
        .first<{ expected_count: number }>()
    )?.expected_count,
  ).toBe(0);
  const closed = await transition(operator, active, "CLOSED");
  const closedNamePatch = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "종료 후 변경",
        expectedRevision: closed.revision,
      }),
    },
  );
  expect(closedNamePatch.status).toBe(409);
  expect(await closedNamePatch.json()).toMatchObject({
    code: "PROJECT_CLOSED",
    message: "종료된 프로젝트는 변경할 수 없습니다.",
  });
  vi.setSystemTime(new Date("2026-05-23T15:00:00.000Z"));
  expect(
    (
      await authedRequest(
        operator,
        `/api/v1/projects/${project.id}/transition`,
        {
          method: "POST",
          body: JSON.stringify({
            targetStatus: "IN_PROGRESS",
            expectedRevision: closed.revision,
          }),
        },
      )
    ).status,
  ).toBe(409);
  const cleared = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        endDate: null,
        expectedRevision: closed.revision,
      }),
    },
  );
  expect(cleared.status).toBe(200);
  const clearedProject = await cleared.json<{ id: string; revision: number }>();
  expect(
    (await transition(operator, clearedProject, "IN_PROGRESS")).status,
  ).toBe("IN_PROGRESS");
});

async function transition(
  operator: Awaited<ReturnType<typeof seedOperator>>,
  project: { id: string; revision: number },
  targetStatus: "PRE_REGISTRATION" | "IN_PROGRESS" | "CLOSED",
) {
  const response = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus,
        expectedRevision: project.revision,
      }),
    },
  );
  if (!response.ok) throw new Error(`transition failed: ${response.status}`);
  return response.json<{ id: string; revision: number; status: string }>();
}
