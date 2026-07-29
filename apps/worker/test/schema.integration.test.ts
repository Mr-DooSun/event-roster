import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  findProject,
  findProjectIncludingDeleted,
} from "../src/db/projects";
import { countRows, insertOrganization } from "./support/database";
import { IDS } from "./support/ids";

describe("initial D1 schema", () => {
  it("enforces a consistent closed project deletion state", async () => {
    await env.DB.prepare(
      `INSERT INTO users
       (id, login_id, login_id_canonical, display_name, role, is_active,
        is_bootstrap, session_version, created_at, updated_at)
       VALUES ('deletion-user', 'deletion-user', 'deletion-user', '삭제 운영자',
        'OPERATOR', 1, 0, 1, '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO projects
       (id, name, status, revision, created_by, created_at, updated_at,
        closed_at, closed_by, close_reason)
       VALUES ('deletion-project', '삭제 프로젝트', 'CLOSED', 2,
        'deletion-user', '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:00.000Z', '2026-07-29T00:30:00.000Z',
        'deletion-user', 'MANUAL')`,
    ).run();

    const columns = (
      await env.DB.prepare("PRAGMA table_info(projects)").all<{
        name: string;
        notnull: number;
      }>()
    ).results;
    expect(columns.map(({ name, notnull }) => ({ name, notnull }))).toEqual(
      expect.arrayContaining([
        { name: "deleted_at", notnull: 0 },
        { name: "deleted_by", notnull: 0 },
        { name: "deleted_revision", notnull: 0 },
      ]),
    );

    await expect(
      env.DB.prepare(
        `UPDATE projects
         SET deleted_at = '2026-07-29T01:00:00.000Z'
         WHERE id = 'deletion-project'`,
      ).run(),
    ).rejects.toThrow(/INVALID_PROJECT_DELETION_STATE/);

    await env.DB.prepare(
      `UPDATE projects
       SET revision = 3, deleted_revision = 3,
           deleted_at = '2026-07-29T01:00:00.000Z',
           deleted_by = 'deletion-user'
       WHERE id = 'deletion-project'`,
    ).run();
    expect(await findProject(env.DB, "deletion-project")).toBeNull();
    expect(
      await findProjectIncludingDeleted(env.DB, "deletion-project"),
    ).toMatchObject({
      id: "deletion-project",
      isDeleted: true,
      deletedAt: "2026-07-29T01:00:00.000Z",
    });
  });

  it("includes nullable participant profile snapshots on roster entries", async () => {
    const columns = (
      await env.DB.prepare("PRAGMA table_info(project_roster_entries)").all<{
        name: string;
        notnull: number;
      }>()
    ).results;

    expect(columns.map(({ name, notnull }) => ({ name, notnull }))).toEqual(
      expect.arrayContaining([
        { name: "participant_role_snapshot", notnull: 0 },
        { name: "student_grade_snapshot", notnull: 0 },
      ]),
    );
  });

  it("keeps the legacy PREPARING value in the physical project status check", async () => {
    const projectTable = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    ).first<{ sql: string }>();

    expect(projectTable?.sql).toContain(
      "'PREPARING', 'PRE_REGISTRATION', 'IN_PROGRESS', 'CLOSED'",
    );
  });

  it("rejects duplicate canonical login IDs and validates project date order", async () => {
    await insertOrganization(IDS.organization, "조직 A");
    await env.DB.prepare(
      "INSERT INTO users (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPERATOR', 1, 0, 1, ?, ?)",
    )
      .bind(IDS.user, "minsu", "minsu", "김민수", "2026-07-21", "2026-07-21")
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO users (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap, session_version, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPERATOR', 1, 0, 1, ?, ?)",
      )
        .bind(
          IDS.secondUser,
          "MinSu",
          "minsu",
          "다른 사용자",
          "2026-07-21",
          "2026-07-21",
        )
        .run(),
    ).rejects.toThrow();

    for (const id of [IDS.project, "project-2"]) {
      await env.DB.prepare(
        `INSERT INTO projects
         (id, name, start_date, end_date, status, revision, created_by,
          created_at, updated_at)
         VALUES (?, '같은 이름', '2026-05-22', '2026-05-23',
                 'PRE_REGISTRATION', 0, ?, ?, ?)`,
      )
        .bind(id, IDS.user, "2026-07-21", "2026-07-21")
        .run();
    }
    await expect(
      env.DB.prepare(
        `INSERT INTO projects
         (id, name, start_date, end_date, status, revision, created_by,
          created_at, updated_at)
         VALUES ('project-invalid', '역전', '2026-05-24', '2026-05-23',
                 'PRE_REGISTRATION', 0, ?, ?, ?)`,
      )
        .bind(IDS.user, "2026-07-21", "2026-07-21")
        .run(),
    ).rejects.toThrow();
  });

  it("enforces foreign keys and append-only logs", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO user_organizations
         (user_id, organization_id, assignment_role, assigned_by, assigned_at)
         VALUES ('missing-user', 'missing-org', 'MANAGER', NULL, '2026-07-23T00:00:00.000Z')`,
      ).run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json) VALUES (?, NULL, 'TEST', 'schema', 'schema', ?, '{}')",
    )
      .bind(IDS.audit, "2026-07-21")
      .run();
    expect(await countRows("audit_logs")).toBe(1);

    await expect(
      env.DB.prepare("UPDATE audit_logs SET action = 'MUTATED' WHERE id = ?")
        .bind(IDS.audit)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM audit_logs WHERE id = ?")
        .bind(IDS.audit)
        .run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      "INSERT INTO security_events (id, event_type, occurred_at, details_json) VALUES ('security-1', 'TEST', ?, '{}')",
    )
      .bind("2026-07-21")
      .run();
    expect(await countRows("security_events")).toBe(1);
    await expect(
      env.DB.prepare(
        "UPDATE security_events SET event_type = 'MUTATED' WHERE id = 'security-1'",
      ).run(),
    ).rejects.toThrow();
  });

  it("allows managers and enforces one primary leader per organization", async () => {
    const organizationId = "organization-leadership";
    await insertOrganization(organizationId, "조직 대표");
    for (const [id, loginId, displayName] of [
      ["primary-leader", "primary-leader", "대표 담당자"],
      ["manager-leader", "manager-leader", "추가 담당자"],
    ]) {
      await env.DB.prepare(
        `INSERT INTO users
         (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
          session_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ORGANIZATION_MANAGER', 1, 0, 1, ?, ?)`,
      )
        .bind(
          id,
          loginId,
          loginId,
          displayName,
          "2026-07-23T00:00:00.000Z",
          "2026-07-23T00:00:00.000Z",
        )
        .run();
    }

    await env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES (?, ?, 'PRIMARY_LEADER', NULL, ?)`,
    )
      .bind("primary-leader", organizationId, "2026-07-23T00:00:00.000Z")
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO user_organizations
         (user_id, organization_id, assignment_role, assigned_by, assigned_at)
         VALUES (?, ?, 'PRIMARY_LEADER', NULL, ?)`,
      )
        .bind("manager-leader", organizationId, "2026-07-23T00:00:00.000Z")
        .run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      `INSERT INTO user_organizations
       (user_id, organization_id, assignment_role, assigned_by, assigned_at)
       VALUES (?, ?, 'MANAGER', NULL, ?)`,
    )
      .bind("manager-leader", organizationId, "2026-07-23T00:00:00.000Z")
      .run();
  });
});
