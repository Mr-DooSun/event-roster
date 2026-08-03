import { env } from "cloudflare:workers";
import type { OrganizationDetail } from "@event-roster/contracts";
import { afterEach, beforeEach, expect, it } from "vitest";
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
import { addRoster, setupPreRegistration } from "./support/roster";

beforeEach(resetAuthState);
afterEach(async () => {
  await env.DB.prepare(
    `UPDATE organizations
     SET deleted_at = NULL, deleted_by = NULL
     WHERE deleted_at IS NOT NULL`,
  ).run();
});

const deletionTimestamp = "2026-08-03T00:00:00.000Z";

async function markOrganizationDeleted(
  organizationId: string,
  actorId: string,
) {
  await env.DB.prepare(
    `UPDATE organizations
     SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(deletionTimestamp, actorId, deletionTimestamp, organizationId)
    .run();
}

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

async function seedOrganizationWithEveryDeletionReference(isActive = true) {
  const operator = await seedOperator();
  await seedOrganization("blocked-delete", "삭제 차단 조직", isActive);
  await seedManager("blocked-delete");
  const project = await seedProject(operator, { name: "삭제 차단 이력" });
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

async function countReferences(organizationId: string) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM user_organizations
        WHERE organization_id = ?) AS manager_assignments,
       (SELECT COUNT(*) FROM participants
        WHERE organization_id = ?) AS participants,
       (SELECT COUNT(*) FROM project_organizations
        WHERE organization_id = ?) AS project_links,
       (SELECT COUNT(*) FROM project_roster_entries
        WHERE organization_id = ?) AS roster_entries,
       (SELECT COUNT(*) FROM project_expected_snapshots
        WHERE organization_id = ?) AS expected_snapshots`,
  )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
    )
    .first<{
      manager_assignments: number;
      participants: number;
      project_links: number;
      roster_entries: number;
      expected_snapshots: number;
    }>();
  return {
    managerAssignments: row?.manager_assignments ?? 0,
    participants: row?.participants ?? 0,
    projectLinks: row?.project_links ?? 0,
    rosterEntries: row?.roster_entries ?? 0,
    expectedSnapshots: row?.expected_snapshots ?? 0,
  };
}

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

it("retains deleted project links in the temporary blocker projection", async () => {
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
  expect(detail.deletionEligibility.blockers.projectLinks).toBe(1);
  expect(detail.deletionEligibility.canDelete).toBe(false);
});

it("retains the temporary blocker projection for the organization detail UI", async () => {
  const { operator } = await seedOrganizationWithEveryDeletionReference(false);

  const detail = await (
    await authedRequest(operator, "/api/v1/organizations/blocked-delete")
  ).json<OrganizationDetail>();

  expect(detail.deletionEligibility).toEqual({
    canDelete: false,
    blockers: {
      managerAssignments: 1,
      participants: 1,
      projectLinks: 1,
      rosterEntries: 1,
      expectedSnapshots: 1,
    },
  });
});

it("soft-deletes an active organization while preserving every reference", async () => {
  const { operator } = await seedOrganizationWithEveryDeletionReference();

  const deleteResponse = await authedRequest(
    operator,
    "/api/v1/organizations/blocked-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "삭제 차단 조직" }),
    },
  );

  expect(deleteResponse.status).toBe(204);
  expect(await deleteResponse.text()).toBe("");
  expect(
    await env.DB.prepare(
      `SELECT is_active, deleted_at, deleted_by
       FROM organizations WHERE id = ?`,
    )
      .bind("blocked-delete")
      .first(),
  ).toMatchObject({
    is_active: 0,
    deleted_at: expect.any(String),
    deleted_by: operator.userId,
  });
  expect(await countReferences("blocked-delete")).toEqual({
    managerAssignments: 1,
    participants: 1,
    projectLinks: 1,
    rosterEntries: 1,
    expectedSnapshots: 1,
  });
});

it("requires the exact current name and rejects a repeated delete", async () => {
  const operator = await seedOperator();
  await seedOrganization("name-delete", "정확한 이름", false);

  const mismatchedNameResponse = await authedRequest(
    operator,
    "/api/v1/organizations/name-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: " 정확한 이름 " }),
    },
  );
  expect(mismatchedNameResponse.status).toBe(409);

  expect(
    (
      await authedRequest(operator, "/api/v1/organizations/name-delete", {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "정확한 이름" }),
      })
    ).status,
  ).toBe(204);

  const repeated = await authedRequest(
    operator,
    "/api/v1/organizations/name-delete",
    {
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "정확한 이름" }),
    },
  );
  expect(repeated.status).toBe(409);
});

it("restores a deleted organization as inactive and audits both lifecycle changes", async () => {
  const operator = await seedOperator();
  await seedOrganization("restore-org", "복구 조직", true);

  expect(
    (
      await authedRequest(operator, "/api/v1/organizations/restore-org", {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "복구 조직" }),
      })
    ).status,
  ).toBe(204);

  const restoreResponse = await authedRequest(
    operator,
    "/api/v1/organizations/restore-org/restore",
    { method: "POST" },
  );
  expect(restoreResponse.status).toBe(200);
  expect(await restoreResponse.json<OrganizationDetail>()).toMatchObject({
    id: "restore-org",
    name: "복구 조직",
    isActive: false,
    isDeleted: false,
    deletedAt: null,
  });
  expect(
    await env.DB.prepare(
      `SELECT is_active, deleted_at, deleted_by
       FROM organizations WHERE id = 'restore-org'`,
    ).first(),
  ).toEqual({ is_active: 0, deleted_at: null, deleted_by: null });

  const audits = (
    await env.DB.prepare(
      `SELECT action, details_json FROM audit_logs
       WHERE entity_type = 'ORGANIZATION' AND entity_id = 'restore-org'
       ORDER BY rowid`,
    ).all<{ action: string; details_json: string }>()
  ).results.map((row) => ({
    action: row.action,
    details: JSON.parse(row.details_json),
  }));
  expect(audits).toEqual([
    {
      action: "ORGANIZATION_DELETED",
      details: {
        before: { name: "복구 조직", isActive: true, isDeleted: false },
        after: {
          name: "복구 조직",
          isActive: false,
          isDeleted: true,
          deletedAt: expect.any(String),
        },
      },
    },
    {
      action: "ORGANIZATION_RESTORED",
      details: {
        before: { name: "복구 조직", isActive: false, isDeleted: true },
        after: { name: "복구 조직", isActive: false, isDeleted: false },
      },
    },
  ]);

  expect(
    (
      await authedRequest(
        operator,
        "/api/v1/organizations/restore-org/restore",
        { method: "POST" },
      )
    ).status,
  ).toBe(409);
});

it("preserves manager assignments but revokes deleted and restored-inactive organization authority", async () => {
  const fixture = await setupPreRegistration();
  const manager = await seedManager("org-1");

  expect(manager.body.session.user.organizationIds).toContain("org-1");
  expect(
    (await authedRequest(manager, `/api/v1/projects/${fixture.project.id}`))
      .status,
  ).toBe(200);

  expect(
    (
      await authedRequest(fixture.operator, "/api/v1/organizations/org-1", {
        method: "DELETE",
        body: JSON.stringify({ confirmationName: "1팀" }),
      })
    ).status,
  ).toBe(204);

  const deletedSession = await login("manager-02", "manager-password-123");
  expect(deletedSession.body.session.user.organizationIds).not.toContain(
    "org-1",
  );
  expect(
    (
      await authedRequest(
        deletedSession,
        `/api/v1/projects/${fixture.project.id}`,
      )
    ).status,
  ).toBe(403);
  expect(
    await env.DB.prepare(
      `SELECT 1 AS assigned FROM user_organizations
       WHERE user_id = ? AND organization_id = ?`,
    )
      .bind(manager.userId, "org-1")
      .first(),
  ).toEqual({ assigned: 1 });

  expect(
    (
      await authedRequest(
        fixture.operator,
        "/api/v1/organizations/org-1/restore",
        { method: "POST" },
      )
    ).status,
  ).toBe(200);
  const restoredSession = await login("manager-02", "manager-password-123");
  expect(restoredSession.body.session.user.organizationIds).not.toContain(
    "org-1",
  );
  expect(
    (
      await authedRequest(
        restoredSession,
        `/api/v1/projects/${fixture.project.id}`,
      )
    ).status,
  ).toBe(403);

  expect(
    (
      await authedRequest(fixture.operator, "/api/v1/organizations/org-1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      })
    ).status,
  ).toBe(200);
  const reactivatedSession = await login("manager-02", "manager-password-123");
  expect(reactivatedSession.body.session.user.organizationIds).toContain(
    "org-1",
  );
  expect(
    (
      await authedRequest(
        reactivatedSession,
        `/api/v1/projects/${fixture.project.id}`,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await addRoster(
        {
          ...fixture,
          operator: { ...reactivatedSession, userId: manager.userId },
        },
        fixture.firstParticipant.id,
      )
    ).status,
  ).toBe(201);
});

it("rejects adding or reactivating a deleted organization in a project", async () => {
  const fixture = await setupPreRegistration();
  await env.DB.prepare(
    `UPDATE project_organizations SET is_active = 0
     WHERE project_id = ? AND organization_id = 'org-1'`,
  )
    .bind(fixture.project.id)
    .run();
  const secondProject = await seedProject(fixture.operator, {
    name: "삭제 조직 연결 차단",
  });
  await markOrganizationDeleted("org-1", fixture.operator.userId);

  const add = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${secondProject.id}/organizations`,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: "org-1",
        expectedProjectRevision: secondProject.revision,
      }),
    },
  );
  expect(add.status).toBe(409);

  const reactivate = await authedRequest(
    fixture.operator,
    `/api/v1/projects/${fixture.project.id}/organizations/org-1`,
    {
      method: "PATCH",
      body: JSON.stringify({
        isActive: true,
        expectedProjectRevision: fixture.project.revision,
      }),
    },
  );
  expect(reactivate.status).toBe(409);
});

it("requires administrative full-session protections for delete and restore", async () => {
  const operator = await seedOperator();
  await seedOrganization("manager-scope", "담당 범위 조직");
  const manager = await seedManager("manager-scope");
  await seedOrganization("delete-auth", "삭제 권한 조직", false);
  await seedOrganization("restore-auth", "복구 권한 조직", false);
  await markOrganizationDeleted("restore-auth", operator.userId);

  const endpoints: Array<{
    path: string;
    method: "DELETE" | "POST";
    body?: string;
  }> = [
    {
      path: "/api/v1/organizations/delete-auth",
      method: "DELETE",
      body: JSON.stringify({ confirmationName: "삭제 권한 조직" }),
    },
    {
      path: "/api/v1/organizations/restore-auth/restore",
      method: "POST",
    },
  ];

  await seedUser({
    id: "must-change-operator",
    loginId: "must-change-op",
    password: "temporary-password-123",
    mustChange: true,
  });
  const mustChange = await login("must-change-op", "temporary-password-123");
  await seedUser({
    id: "bootstrap-operator",
    loginId: "bootstrap-operator",
    password: "bootstrap-password-123",
    isBootstrap: true,
  });
  const bootstrap = await login("bootstrap-operator", "bootstrap-password-123");

  for (const endpoint of endpoints) {
    const requestBody =
      endpoint.body === undefined ? {} : { body: endpoint.body };
    expect(
      (
        await apiRequest(endpoint.path, {
          method: endpoint.method,
          headers: {
            Authorization: `Bearer ${operator.body.accessToken}`,
            "X-ER-CSRF": "",
          },
          ...requestBody,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await apiRequest(endpoint.path, {
          method: endpoint.method,
          headers: {
            ...authenticatedHeaders(operator),
            Origin: "https://evil.example",
          },
          ...requestBody,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedRequest(manager, endpoint.path, {
          method: endpoint.method,
          ...requestBody,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedRequest(mustChange, endpoint.path, {
          method: endpoint.method,
          ...requestBody,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authedRequest(bootstrap, endpoint.path, {
          method: endpoint.method,
          ...requestBody,
        })
      ).status,
    ).toBe(403);
  }

  expect(
    await env.DB.prepare(
      `SELECT deleted_at FROM organizations WHERE id = 'delete-auth'`,
    ).first(),
  ).toEqual({ deleted_at: null });
  expect(
    await env.DB.prepare(
      `SELECT deleted_at FROM organizations WHERE id = 'restore-auth'`,
    ).first(),
  ).toEqual({ deleted_at: deletionTimestamp });
});

it("rolls back deletion metadata when the delete audit insert fails", async () => {
  const operator = await seedOperator();
  await seedOrganization("audit-failure-delete", "감사 실패 조직", true);
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
        body: JSON.stringify({ confirmationName: "감사 실패 조직" }),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        `SELECT is_active, deleted_at, deleted_by
         FROM organizations WHERE id = 'audit-failure-delete'`,
      ).first(),
    ).toEqual({ is_active: 1, deleted_at: null, deleted_by: null });
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS fail_organization_delete_audit",
    ).run();
  }
});

it("rolls back restoration when the restore audit insert fails", async () => {
  const operator = await seedOperator();
  await seedOrganization("audit-failure-restore", "복구 감사 실패 조직", false);
  await markOrganizationDeleted("audit-failure-restore", operator.userId);
  await env.DB.prepare(
    `CREATE TRIGGER fail_organization_restore_audit
     BEFORE INSERT ON audit_logs
     WHEN NEW.action = 'ORGANIZATION_RESTORED'
     BEGIN
       SELECT RAISE(ABORT, 'AUDIT_INSERT_FAILED');
     END`,
  ).run();

  try {
    const response = await authedRequest(
      operator,
      "/api/v1/organizations/audit-failure-restore/restore",
      { method: "POST" },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        `SELECT is_active, deleted_at, deleted_by
         FROM organizations WHERE id = 'audit-failure-restore'`,
      ).first(),
    ).toEqual({
      is_active: 0,
      deleted_at: deletionTimestamp,
      deleted_by: operator.userId,
    });
  } finally {
    await env.DB.prepare(
      "DROP TRIGGER IF EXISTS fail_organization_restore_audit",
    ).run();
  }
});

it("allows only one concurrent delete for the observed organization state", async () => {
  const operator = await seedOperator();
  await seedOrganization("concurrent-delete", "동시 삭제 조직", true);
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

  expect(responses.map(({ status }) => status).sort()).toEqual([204, 409]);
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action = 'ORGANIZATION_DELETED'
           AND entity_id = 'concurrent-delete'`,
      ).first<{ count: number }>()
    )?.count,
  ).toBe(1);
  expect(
    await env.DB.prepare(
      `SELECT is_active, deleted_at, deleted_by
       FROM organizations WHERE id = 'concurrent-delete'`,
    ).first(),
  ).toMatchObject({
    is_active: 0,
    deleted_at: expect.any(String),
    deleted_by: operator.userId,
  });
});

it("reserves a deleted organization's canonical name for normal creation", async () => {
  const operator = await seedOperator();
  await seedOrganization("reserved-name", "예약 조직", false);
  await markOrganizationDeleted("reserved-name", operator.userId);

  const response = await authedRequest(operator, "/api/v1/organizations", {
    method: "POST",
    body: JSON.stringify({ name: "  예약 조직  " }),
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "ORGANIZATION_NAME_RESERVED",
    details: { organizationId: "reserved-name" },
  });
  expect(
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM organizations
         WHERE canonical_name = '예약 조직'`,
      ).first<{ count: number }>()
    )?.count,
  ).toBe(1);
});
