import { env } from "cloudflare:workers";
import type { OrganizationDetail } from "@event-roster/contracts";
import { beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import {
  authedRequest,
  seedManager,
  seedOperator,
  seedOrganization,
  seedProject,
} from "./support/admin";
import {
  apiRequest,
  authenticatedHeaders,
  login,
  resetAuthState,
  seedUser,
} from "./support/auth";

beforeEach(resetAuthState);

async function markProjectDeleted(
  projectId: string,
  actorId: string,
  revision: number,
) {
  const timestamp = "2026-07-29T00:00:00.000Z";
  await env.DB.prepare(
    `UPDATE projects
     SET status = 'CLOSED', revision = ?, updated_at = ?,
         closed_at = ?, closed_by = ?, close_reason = 'MANUAL',
         deleted_at = ?, deleted_by = ?, deleted_revision = ?
     WHERE id = ?`,
  )
    .bind(
      revision + 1,
      timestamp,
      timestamp,
      actorId,
      timestamp,
      actorId,
      revision + 1,
      projectId,
    )
    .run();
}

it("does not count deleted project links as organization blockers", async () => {
  const operator = await seedOperator();
  await seedOrganization("deleted-link-org", "삭제 프로젝트 조직", false);
  const project = await seedProject(operator, { name: "삭제된 연결" });
  const timestamp = "2026-07-29T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO project_organizations
     (project_id, organization_id, is_active, added_at, deactivated_at,
      added_by, updated_by)
     VALUES (?, 'deleted-link-org', 0, ?, ?, ?, ?)`,
  )
    .bind(project.id, timestamp, timestamp, operator.userId, operator.userId)
    .run();
  await markProjectDeleted(project.id, operator.userId, project.revision);

  const detail = await (
    await authedRequest(operator, "/api/v1/organizations/deleted-link-org")
  ).json<OrganizationDetail>();
  expect(detail.projects).toEqual([]);
  expect(detail.deletionEligibility.blockers.projectLinks).toBe(0);
});

function synchronizeFirstBatches(
  db: D1Database,
  participantCount: number,
): D1Database {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          arrivals += 1;
          if (arrivals === participantCount) release?.();
          await allArrived;
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

it("requires an administrative full session, exact origin, and csrf", async () => {
  const operator = await seedOperator();
  await seedOrganization("manager-scope", "담당 범위 조직");
  const manager = await seedManager("manager-scope");
  await seedOrganization("delete-auth", "삭제 권한 조직", false);

  const missingCsrf = await apiRequest("/api/v1/organizations/delete-auth", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${operator.body.accessToken}`,
      "X-ER-CSRF": "",
    },
    body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
  });
  expect(missingCsrf.status).toBe(403);

  const managerResponse = await authedRequest(
    manager,
    "/api/v1/organizations/delete-auth",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
    },
  );
  expect(managerResponse.status).toBe(403);

  const evilOrigin = await apiRequest("/api/v1/organizations/delete-auth", {
    method: "DELETE",
    headers: {
      ...authenticatedHeaders(operator),
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
  });
  expect(evilOrigin.status).toBe(403);

  await seedUser({
    id: "must-change-operator",
    loginId: "must-change-op",
    password: "temporary-password-123",
    mustChange: true,
  });
  const mustChange = await login("must-change-op", "temporary-password-123");
  const mustChangeResponse = await authedRequest(
    mustChange,
    "/api/v1/organizations/delete-auth",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
    },
  );
  expect(mustChangeResponse.status).toBe(403);

  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'delete-auth'",
    ).first(),
  ).not.toBeNull();
});

it("rejects active organizations and mismatched exact names", async () => {
  const operator = await seedOperator();
  await seedOrganization("active-delete", "활성 삭제 조직", true);
  await seedOrganization("name-delete", "정확한 이름", false);

  const activeResponse = await authedRequest(
    operator,
    "/api/v1/organizations/active-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "활성 삭제 조직" }),
    },
  );
  expect(activeResponse.status).toBe(409);

  const mismatchedNameResponse = await authedRequest(
    operator,
    "/api/v1/organizations/name-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: " 정확한 이름 " }),
    },
  );
  expect(mismatchedNameResponse.status).toBe(409);
});

async function seedOrganizationWithEveryDeletionBlocker() {
  const operator = await seedOperator();
  await seedOrganization("blocked-delete", "삭제 차단 조직", false);
  await seedManager("blocked-delete");
  const project = await seedProject(operator, {
    name: "삭제 차단 이력",
  });
  const now = "2026-07-29T00:00:00.000Z";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('blocked-participant', 'P-BLOCKED', '차단 참가자',
               'blocked-delete', 0, ?, ?)`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO project_organizations
       (project_id, organization_id, is_active, added_at, deactivated_at,
        added_by, updated_by)
       VALUES (?, 'blocked-delete', 0, ?, ?, ?, ?)`,
    ).bind(project.id, now, now, operator.userId, operator.userId),
    env.DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot,
        participant_role_snapshot, student_grade_snapshot,
        source, status, was_expected_at_start, revision,
        created_by, updated_by, created_at, updated_at)
       VALUES ('blocked-roster', ?, 'blocked-participant', 'blocked-delete',
               '차단 참가자', '삭제 차단 조직', 'STUDENT', 'M1',
               'PRE_REGISTRATION', 'CANCELLED', 0, 0, ?, ?, ?, ?)`,
    ).bind(project.id, operator.userId, operator.userId, now, now),
    env.DB.prepare(
      `INSERT INTO project_expected_snapshots
       (project_id, organization_id, expected_count, captured_at)
       VALUES (?, 'blocked-delete', 1, ?)`,
    ).bind(project.id, now),
  ]);

  return { operator, project };
}

it("blocks deletion for every full-history reference type", async () => {
  const { operator } = await seedOrganizationWithEveryDeletionBlocker();
  const detail = await (
    await authedRequest(operator, "/api/v1/organizations/blocked-delete")
  ).json<OrganizationDetail>();
  const deleteResponse = await authedRequest(
    operator,
    "/api/v1/organizations/blocked-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "삭제 차단 조직" }),
    },
  );

  expect(detail.deletionEligibility.blockers).toEqual({
    managerAssignments: 1,
    participants: 1,
    projectLinks: 1,
    rosterEntries: 1,
    expectedSnapshots: 1,
  });
  expect(deleteResponse.status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'blocked-delete'",
    ).first(),
  ).not.toBeNull();
});

it("rechecks blockers atomically after a stale eligible detail read", async () => {
  const operator = await seedOperator();
  await seedOrganization("stale-delete", "오래된 삭제 화면", false);

  const detail = await (
    await authedRequest(operator, "/api/v1/organizations/stale-delete")
  ).json<OrganizationDetail>();
  expect(detail.deletionEligibility.canDelete).toBe(true);

  const project = await seedProject(operator, { name: "뒤늦은 이력" });
  const now = "2026-07-29T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO project_organizations
     (project_id, organization_id, is_active, added_at, deactivated_at,
      added_by, updated_by)
     VALUES (?, 'stale-delete', 0, ?, ?, ?, ?)`,
  )
    .bind(project.id, now, now, operator.userId, operator.userId)
    .run();

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/stale-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "오래된 삭제 화면" }),
    },
  );
  expect(response.status).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'stale-delete'",
    ).first(),
  ).not.toBeNull();
});

it("rolls back deletion when the audit insert fails", async () => {
  const operator = await seedOperator();
  await seedOrganization("audit-failure-delete", "감사 실패 조직", false);
  await env.DB.prepare(
    `CREATE TRIGGER fail_organization_delete_audit
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'ORGANIZATION_DELETED'
     BEGIN
       SELECT RAISE(ABORT, 'AUDIT_INSERT_FAILED');
     END`,
  ).run();

  try {
    const response = await authedRequest(
      operator,
      "/api/v1/organizations/audit-failure-delete",
      {
        method: "DELETE",
        body: JSON.stringify({
          confirmationName: "감사 실패 조직",
        }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        "SELECT id FROM organizations WHERE id = 'audit-failure-delete'",
      ).first(),
    ).not.toBeNull();
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS fail_organization_delete_audit",
    ).run();
  }
});

it("keeps an audit-trigger foreign-key failure as an internal error", async () => {
  const operator = await seedOperator();
  await seedOrganization("audit-fk-delete", "감사 FK 실패 조직", false);
  await env.DB.prepare(
    `CREATE TRIGGER fail_organization_delete_audit_with_foreign_key
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'ORGANIZATION_DELETED'
     BEGIN
       INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('audit-fk-participant', 'P-AUDIT-FK', '감사 FK 참가자',
               'missing-organization', 0, '2026-07-29T00:00:00.000Z',
               '2026-07-29T00:00:00.000Z');
     END`,
  ).run();

  try {
    const response = await authedRequest(
      operator,
      "/api/v1/organizations/audit-fk-delete",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "감사 FK 실패 조직" }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        "SELECT id FROM organizations WHERE id = 'audit-fk-delete'",
      ).first(),
    ).not.toBeNull();
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS fail_organization_delete_audit_with_foreign_key",
    ).run();
  }
});

it("rolls back when audit introduces a reference after the authoritative guard", async () => {
  const operator = await seedOperator();
  await seedOrganization("fk-race-delete", "FK 경쟁 조직", false);
  await env.DB.prepare(
    `CREATE TRIGGER create_post_guard_organization_reference
     AFTER INSERT ON audit_logs
     WHEN NEW.action = 'ORGANIZATION_DELETED'
       AND NEW.entity_id = 'fk-race-delete'
     BEGIN
       INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES ('fk-race-participant', 'P-FK-RACE', 'FK 경쟁 참가자',
               NEW.entity_id, 0, '2026-07-29T00:00:00.000Z',
               '2026-07-29T00:00:00.000Z');
     END`,
  ).run();

  try {
    const response = await authedRequest(
      operator,
      "/api/v1/organizations/fk-race-delete",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "FK 경쟁 조직" }),
      },
    );
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT id FROM organizations WHERE id = 'fk-race-delete'",
      ).first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT id FROM participants WHERE id = 'fk-race-participant'",
      ).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        `SELECT id FROM audit_logs
         WHERE action = 'ORGANIZATION_DELETED'
           AND entity_id = 'fk-race-delete'`,
      ).first(),
    ).toBeNull();
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS create_post_guard_organization_reference",
    ).run();
  }
});

it("returns not found to the loser when two deletes pass preflight", async () => {
  const operator = await seedOperator();
  await seedOrganization("concurrent-delete", "동시 삭제 조직", false);
  const synchronizedEnv = Object.assign(Object.create(env), {
    DB: synchronizeFirstBatches(env.DB, 2),
  }) as Env;
  const app = createApp();
  const request = () =>
    app.fetch(
      new Request(
        "https://event-roster.test/api/v1/organizations/concurrent-delete",
        {
          method: "DELETE",
          headers: {
            ...authenticatedHeaders(operator),
            "Content-Type": "application/json",
            Origin: "https://event-roster.test",
          },
          body: JSON.stringify({ confirmationName: "동시 삭제 조직" }),
        },
      ),
      synchronizedEnv,
    );

  const responses = await Promise.all([request(), request()]);

  expect(responses.map(({ status }) => status).sort()).toEqual([204, 404]);
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'concurrent-delete'",
    ).first(),
  ).toBeNull();
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action = 'ORGANIZATION_DELETED'
           AND entity_id = 'concurrent-delete'`,
      ).first<{ count: number }>()
    )?.count,
  ).toBe(1);
});

it("atomically audits and deletes an inactive empty organization", async () => {
  const operator = await seedOperator();
  await seedOrganization("empty-delete", "재사용 이름", false);

  const response = await authedRequest(
    operator,
    "/api/v1/organizations/empty-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "재사용 이름" }),
    },
  );
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(
    await env.DB.prepare(
      "SELECT id FROM organizations WHERE id = 'empty-delete'",
    ).first(),
  ).toBeNull();
  expect(
    (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM operation_guards",
      ).first<{ count: number }>()
    )?.count,
  ).toBe(0);

  const audit = await env.DB.prepare(
    `SELECT actor_user_id, details_json FROM audit_logs
     WHERE action = 'ORGANIZATION_DELETED'
       AND entity_type = 'ORGANIZATION'
       AND entity_id = 'empty-delete'`,
  ).first<{ actor_user_id: string; details_json: string }>();
  expect(audit?.actor_user_id).toBe(operator.userId);
  expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
    before: { name: "재사용 이름", isActive: false },
    after: { name: null, isActive: null },
    deletionEligibility: {
      managerAssignments: 0,
      participants: 0,
      projectLinks: 0,
      rosterEntries: 0,
      expectedSnapshots: 0,
    },
  });

  const recreated = await authedRequest(operator, "/api/v1/organizations", {
    method: "POST",
    body: JSON.stringify({ name: "재사용 이름" }),
  });
  expect(recreated.status).toBe(201);
  expect((await recreated.json<{ id: string }>()).id).not.toBe("empty-delete");

  const secondDelete = await authedRequest(
    operator,
    "/api/v1/organizations/empty-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "재사용 이름" }),
    },
  );
  expect(secondDelete.status).toBe(404);
});
