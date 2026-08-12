import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("preserves organizations while adding nullable deletion metadata", async () => {
  const priorMigrationNames = [
    "0001_initial.sql",
    "0002_project_model.sql",
    "0003_organization_leadership.sql",
    "0004_automatic_project_preregistration.sql",
    "0005_roster_participant_profiles.sql",
    "0006_project_soft_deletion.sql",
    "0006_roster_gender.sql",
  ];
  const priorMigrations = priorMigrationNames.map((name) =>
    env.TEST_MIGRATIONS.find((migration) => migration.name === name),
  );
  const organizationSoftDeletion = env.TEST_MIGRATIONS.find(
    (migration) => migration.name === "0007_organization_soft_deletion.sql",
  );
  if (
    priorMigrations.some((migration) => !migration) ||
    !organizationSoftDeletion
  ) {
    throw new Error("expected migrations before organization soft deletion");
  }

  await applyD1Migrations(
    env.MIGRATION_DB,
    priorMigrations.filter((migration) => migration !== undefined),
  );
  await seedMigrationUserAndOrganizations();
  const before = await countOrganizations();

  await applyD1Migrations(env.MIGRATION_DB, [organizationSoftDeletion]);

  expect(
    await env.MIGRATION_DB.prepare(
      `SELECT deleted_at, deleted_by FROM organizations
       WHERE id = 'pre-0007-active'`,
    ).first(),
  ).toEqual({ deleted_at: null, deleted_by: null });
  expect(await countOrganizations()).toBe(before);
  expect(
    (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});

async function seedMigrationUserAndOrganizations() {
  await env.MIGRATION_DB.prepare(
    `INSERT INTO users
     (id, login_id, login_id_canonical, display_name, role, is_active,
      is_bootstrap, session_version, created_at, updated_at)
     VALUES ('pre-0007-user', 'pre-0007-user', 'pre-0007-user', '기존 운영자',
      'OPERATOR', 1, 0, 1, '2026-08-03T00:00:00.000Z',
      '2026-08-03T00:00:00.000Z')`,
  ).run();
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(
      `INSERT INTO organizations
       (id, name, canonical_name, is_active, created_at, updated_at)
       VALUES ('pre-0007-active', '기존 활성 조직', '기존 활성 조직', 1,
        '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')`,
    ),
    env.MIGRATION_DB.prepare(
      `INSERT INTO organizations
       (id, name, canonical_name, is_active, created_at, updated_at)
       VALUES ('pre-0007-inactive', '기존 비활성 조직', '기존 비활성 조직', 0,
        '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')`,
    ),
  ]);
}

async function countOrganizations() {
  const row = await env.MIGRATION_DB.prepare(
    "SELECT COUNT(*) AS count FROM organizations",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}
