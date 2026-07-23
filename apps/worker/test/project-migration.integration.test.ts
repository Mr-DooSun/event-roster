import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("preserves legacy project, roster, snapshot, import, audit, and organization assignments", async () => {
  const [initial, projectModel, organizationLeadership] = env.TEST_MIGRATIONS;
  if (!initial || !projectModel || !organizationLeadership)
    throw new Error("expected migrations 0001, 0002 and 0003");
  const legacyInProgressStatus = ["DAY", "OF"].join("_");
  const legacyPreRegistrationSource = ["PRE", "EVENT"].join("_");

  await applyD1Migrations(env.MIGRATION_DB, [initial]);
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO organizations
      (id, name, canonical_name, is_active, created_at, updated_at)
      VALUES ('migration-org', '이관 조직', '이관 조직', 1, '2026-01-01', '2026-01-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
       session_version, created_at, updated_at)
      VALUES ('migration-user', 'migration-user', 'migration-user', '이관 사용자',
       'OPERATOR', 1, 0, 1, '2026-01-01', '2026-01-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
       session_version, created_at, updated_at)
      VALUES ('migration-manager', 'migration-manager', 'migration-manager', '이관 담당자',
       'ORGANIZATION_MANAGER', 1, 0, 1, '2026-01-01', '2026-01-01')`),
    env.MIGRATION_DB.prepare(
      "INSERT INTO user_organizations (user_id, organization_id) VALUES ('migration-manager', 'migration-org')",
    ),
    env.MIGRATION_DB.prepare(`INSERT INTO participants
      (id, participant_id, name, organization_id, revision, created_at, updated_at)
      VALUES ('migration-person', 'P-MIGRATION', '이관 참가자', 'migration-org', 2,
       '2026-01-01', '2026-05-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO events
      (id, year, half, name, status, revision, created_by, created_at, updated_at)
      VALUES ('legacy-project', 2026, 'H1', '기존 프로젝트', ?, 3,
       'migration-user', '2026-01-01', '2026-05-01')`).bind(
      legacyInProgressStatus,
    ),
    env.MIGRATION_DB.prepare(`INSERT INTO event_roster_entries
      (id, event_id, participant_id, organization_id, participant_name_snapshot,
       organization_name_snapshot, source, status, was_expected_at_day_of, revision,
       created_by, updated_by, created_at, updated_at)
      VALUES ('migration-entry', 'legacy-project', 'migration-person', 'migration-org',
       '옛 참가자', '옛 조직', ?, 'CANCELLED', 1, 4,
       'migration-user', 'migration-user', '2026-01-01', '2026-05-01')`).bind(
      legacyPreRegistrationSource,
    ),
    env.MIGRATION_DB.prepare(`INSERT INTO event_expected_snapshots
      (event_id, organization_id, expected_count, captured_at)
      VALUES ('legacy-project', 'migration-org', 7, '2026-05-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO import_runs
      (id, event_id, actor_user_id, row_count, created_at, details_json)
      VALUES ('migration-import', 'legacy-project', 'migration-user', 1,
       '2026-04-01', '{"kept":true}')`),
    env.MIGRATION_DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('migration-audit', 'migration-user', 'EVENT_TRANSITIONED', 'EVENT',
       'legacy-project', '2026-05-01', '{}')`),
    env.MIGRATION_DB.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
      VALUES ('malformed-audit', 'migration-user', 'TEST', 'OTHER',
       'legacy-project', '2026-05-01', 'not-json')`),
  ]);
  const legacyCounts = {
    projects: await countMigrationRows("events"),
    roster: await countMigrationRows("event_roster_entries"),
    snapshots: await countMigrationRows("event_expected_snapshots"),
    imports: await countMigrationRows("import_runs"),
  };

  await applyD1Migrations(env.MIGRATION_DB, [projectModel, organizationLeadership]);

  expect(
    await env.MIGRATION_DB.prepare(`SELECT assignment_role, assigned_by,
      assigned_at IS NOT NULL AS has_assigned_at FROM user_organizations
      WHERE user_id='migration-manager' AND organization_id='migration-org'`).first(),
  ).toEqual({
    assignment_role: "MANAGER",
    assigned_by: null,
    has_assigned_at: 1,
  });

  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT id, name, status, revision FROM projects WHERE id='legacy-project'",
    ).first(),
  ).toEqual({
    id: "legacy-project",
    name: "기존 프로젝트",
    status: "IN_PROGRESS",
    revision: 3,
  });
  expect(
    await env.MIGRATION_DB.prepare(
      `SELECT project_id, source, status, was_expected_at_start, revision
       FROM project_roster_entries WHERE id='migration-entry'`,
    ).first(),
  ).toEqual({
    project_id: "legacy-project",
    source: "PRE_REGISTRATION",
    status: "CANCELLED",
    was_expected_at_start: 1,
    revision: 4,
  });
  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT COUNT(*) AS count FROM project_expected_snapshots",
    ).first(),
  ).toEqual({ count: legacyCounts.snapshots });
  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT COUNT(*) AS count FROM project_import_runs",
    ).first(),
  ).toEqual({ count: legacyCounts.imports });
  expect(await countMigrationRows("projects")).toBe(legacyCounts.projects);
  expect(await countMigrationRows("project_roster_entries")).toBe(
    legacyCounts.roster,
  );
  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT entity_type, action FROM audit_logs WHERE id='migration-audit'",
    ).first(),
  ).toEqual({ entity_type: "PROJECT", action: "PROJECT_TRANSITIONED" });
  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT details_json FROM audit_logs WHERE id='malformed-audit'",
    ).first(),
  ).toEqual({ details_json: "not-json" });
  expect(
    (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
  for (const legacyTable of [
    "events",
    "event_roster_entries",
    "event_expected_snapshots",
    "import_runs",
  ]) {
    expect(
      await env.MIGRATION_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
        .bind(legacyTable)
        .first(),
    ).toBeNull();
  }
});

async function countMigrationRows(table: string) {
  const row = await env.MIGRATION_DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>();
  return row?.count ?? 0;
}
