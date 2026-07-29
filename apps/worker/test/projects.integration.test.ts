import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./support/admin";
import { login, resetAuthState, seedUser } from "./support/auth";

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
  const project = await first.json<{ id: string; revision: number }>();
  expect(project).toMatchObject({
    ...body,
    status: "PRE_REGISTRATION",
    createdBy: operator.userId,
    closedBy: null,
  });
  expect(second.status).toBe(201);
  const invalid = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/transition`,
    {
      method: "POST",
      body: JSON.stringify({
        targetStatus: "PREPARING",
        expectedRevision: project.revision,
      }),
    },
  );
  expect(invalid.status).toBe(422);
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

it("soft-deletes and restores a closed project while preserving one audit per action", async () => {
  const operator = await seedOperator();
  let project = await seedProject(operator, { name: "1회 수련 법회" });
  project = await transition(operator, project, "IN_PROGRESS");
  project = await transition(operator, project, "CLOSED");

  const deleted = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        confirmationName: "1회 수련 법회",
        expectedRevision: project.revision,
      }),
    },
  );
  expect(deleted.status).toBe(200);
  const deletedProject = await deleted.json<{
    id: string;
    revision: number;
    status: string;
    isDeleted: boolean;
    deletedAt: string | null;
  }>();
  expect(deletedProject).toMatchObject({
    id: project.id,
    revision: project.revision + 1,
    status: "CLOSED",
    isDeleted: true,
  });
  expect(deletedProject.deletedAt).not.toBeNull();
  expect(
    (await authedRequest(operator, `/api/v1/projects/${project.id}`)).status,
  ).toBe(404);
  expect(
    (
      await authedRequest(
        operator,
        `/api/v1/projects/${project.id}?includeDeleted=true`,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await (
        await authedRequest(operator, "/api/v1/projects")
      ).json<Array<{ id: string }>>()
    ).map(({ id }) => id),
  ).not.toContain(project.id);
  expect(
    (
      await (
        await authedRequest(operator, "/api/v1/projects?includeDeleted=true")
      ).json<Array<{ id: string }>>()
    ).map(({ id }) => id),
  ).toContain(project.id);

  const repeatedDelete = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        confirmationName: "1회 수련 법회",
        expectedRevision: project.revision,
      }),
    },
  );
  expect(repeatedDelete.status).toBe(404);

  const staleRestore = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/restore`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: deletedProject.revision - 1,
      }),
    },
  );
  expect(staleRestore.status).toBe(409);
  expect(await staleRestore.json()).toMatchObject({ code: "STALE_REVISION" });

  const restored = await authedRequest(
    operator,
    `/api/v1/projects/${project.id}/restore`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: deletedProject.revision,
      }),
    },
  );
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    id: project.id,
    status: "CLOSED",
    revision: deletedProject.revision + 1,
    isDeleted: false,
    deletedAt: null,
  });
  expect(
    (
      await env.DB.prepare(
        `SELECT action, COUNT(*) AS count FROM audit_logs
         WHERE entity_id = ?
           AND action IN ('PROJECT_DELETED', 'PROJECT_RESTORED')
         GROUP BY action ORDER BY action`,
      )
        .bind(project.id)
        .all()
    ).results,
  ).toEqual([
    { action: "PROJECT_DELETED", count: 1 },
    { action: "PROJECT_RESTORED", count: 1 },
  ]);
});

it("rejects unsafe project deletion confirmation, state, and revisions", async () => {
  const operator = await seedOperator();
  const open = await seedProject(operator, { name: "삭제 확인 프로젝트" });
  const openDelete = await authedRequest(
    operator,
    `/api/v1/projects/${open.id}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        confirmationName: "삭제 확인 프로젝트",
        expectedRevision: open.revision,
      }),
    },
  );
  expect(await openDelete.json()).toMatchObject({
    code: "PROJECT_NOT_CLOSED",
  });

  let closed = await transition(operator, open, "IN_PROGRESS");
  closed = await transition(operator, closed, "CLOSED");
  for (const confirmationName of [
    "삭제 확인 프로젝트 ",
    "삭제 확인 프로젝트".normalize("NFD"),
  ]) {
    const mismatch = await authedRequest(
      operator,
      `/api/v1/projects/${closed.id}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          confirmationName,
          expectedRevision: closed.revision,
        }),
      },
    );
    expect(await mismatch.json()).toMatchObject({
      code: "CONFIRMATION_MISMATCH",
    });
  }
  const stale = await authedRequest(operator, `/api/v1/projects/${closed.id}`, {
    method: "DELETE",
    body: JSON.stringify({
      confirmationName: "삭제 확인 프로젝트",
      expectedRevision: closed.revision - 1,
    }),
  });
  expect(await stale.json()).toMatchObject({ code: "STALE_REVISION" });
});

it("limits deleted-project reads and lifecycle actions to administrative operators", async () => {
  const operator = await seedOperator();
  await seedOrganization();
  const manager = await seedManager();
  await seedUser({
    id: "bootstrap-user",
    loginId: "bootstrap-user",
    password: "bootstrap-password-123",
    isBootstrap: true,
  });
  const bootstrap = await login("bootstrap-user", "bootstrap-password-123");
  let project = await seedProject(operator, { name: "권한 프로젝트" });
  project = await transition(operator, project, "IN_PROGRESS");
  project = await transition(operator, project, "CLOSED");

  expect(
    (await authedRequest(manager, "/api/v1/projects?includeDeleted=true"))
      .status,
  ).toBe(403);
  for (const actor of [manager, bootstrap]) {
    expect(
      (
        await authedRequest(actor, `/api/v1/projects/${project.id}`, {
          method: "DELETE",
          body: JSON.stringify({
            confirmationName: "권한 프로젝트",
            expectedRevision: project.revision,
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedRequest(actor, `/api/v1/projects/${project.id}/restore`, {
          method: "POST",
          body: JSON.stringify({ expectedRevision: project.revision }),
        })
      ).status,
    ).toBe(403);
  }
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
  const pre = await seedProject(operator, { endDate: "2026-05-23" });
  await env.DB.prepare(`INSERT INTO project_organizations
    (project_id, organization_id, is_active, added_at, added_by, updated_by)
    VALUES (?, 'org-1', 1, ?, ?, ?)`)
    .bind(pre.id, "2026-05-01T00:00:00.000Z", operator.userId, operator.userId)
    .run();
  const active = await transition(operator, pre, "IN_PROGRESS");
  expect(
    (
      await env.DB.prepare(
        "SELECT expected_count FROM project_expected_snapshots WHERE project_id=? AND organization_id='org-1'",
      )
        .bind(pre.id)
        .first<{ expected_count: number }>()
    )?.expected_count,
  ).toBe(0);
  const closed = await transition(operator, active, "CLOSED");
  const closedNamePatch = await authedRequest(
    operator,
    `/api/v1/projects/${pre.id}`,
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
      await authedRequest(operator, `/api/v1/projects/${pre.id}/transition`, {
        method: "POST",
        body: JSON.stringify({
          targetStatus: "IN_PROGRESS",
          expectedRevision: closed.revision,
        }),
      })
    ).status,
  ).toBe(409);
  const cleared = await authedRequest(operator, `/api/v1/projects/${pre.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      endDate: null,
      expectedRevision: closed.revision,
    }),
  });
  expect(cleared.status).toBe(200);
  const clearedProject = await cleared.json<{ id: string; revision: number }>();
  expect(
    (await transition(operator, clearedProject, "IN_PROGRESS")).status,
  ).toBe("IN_PROGRESS");
});

it("returns PROJECT_CLOSED after request-time auto-close instead of applying a stale date-only patch", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T01:00:00.000Z"));
  const operator = await seedOperator();
  const expired = await seedProject(operator, { endDate: "2026-07-21" });
  const response = await authedRequest(
    operator,
    `/api/v1/projects/${expired.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        endDate: null,
        expectedRevision: expired.revision,
      }),
    },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "PROJECT_CLOSED" });
  expect(
    await env.DB.prepare(
      "SELECT status, end_date, revision FROM projects WHERE id = ?",
    )
      .bind(expired.id)
      .first(),
  ).toEqual({
    status: "CLOSED",
    end_date: "2026-07-21",
    revision: expired.revision + 1,
  });

  const closedPatch = await authedRequest(
    operator,
    `/api/v1/projects/${expired.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        endDate: null,
        expectedRevision: expired.revision + 1,
      }),
    },
  );
  expect(closedPatch.status).toBe(200);
  expect(await closedPatch.json()).toMatchObject({
    status: "CLOSED",
    endDate: null,
    revision: expired.revision + 2,
  });
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
