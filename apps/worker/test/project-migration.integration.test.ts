import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("migrates legacy events and exposes project columns without year or half", async () => {
  const [initial, projectModel] = env.TEST_MIGRATIONS;
  if (!initial || !projectModel)
    throw new Error("expected migrations 0001 and 0002");

  await applyD1Migrations(env.MIGRATION_DB, [initial]);
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap,
       session_version, created_at, updated_at)
      VALUES ('migration-user', 'migration-user', 'migration-user', '이관 사용자',
       'OPERATOR', 1, 0, 1, '2026-01-01', '2026-01-01')`),
    env.MIGRATION_DB.prepare(`INSERT INTO events
      (id, year, half, name, status, revision, created_by, created_at, updated_at)
      VALUES ('legacy-event', 2026, 'H1', '기존 행사', 'DAY_OF', 3,
       'migration-user', '2026-01-01', '2026-05-01')`),
  ]);
  await applyD1Migrations(env.MIGRATION_DB, [projectModel]);

  const columns = (
    await env.MIGRATION_DB.prepare("PRAGMA table_info(projects)").all<{
      name: string;
    }>()
  ).results.map((column) => column.name);
  expect(columns).toEqual(
    expect.arrayContaining([
      "id",
      "name",
      "start_date",
      "end_date",
      "status",
      "revision",
      "created_by",
      "created_at",
      "updated_at",
      "closed_at",
      "closed_by",
      "close_reason",
    ]),
  );
  expect(columns).not.toContain("year");
  expect(columns).not.toContain("half");
  expect(
    await env.MIGRATION_DB.prepare(
      "SELECT id, name, status, revision FROM projects WHERE id='legacy-event'",
    ).first(),
  ).toEqual({
    id: "legacy-event",
    name: "기존 행사",
    status: "IN_PROGRESS",
    revision: 3,
  });
});
