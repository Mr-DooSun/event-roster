import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("preserves projects while adding nullable soft-deletion metadata", async () => {
  const [
    initial,
    projectModel,
    organizationLeadership,
    automaticPreregistration,
    participantProfiles,
    projectSoftDeletion,
  ] = env.TEST_MIGRATIONS;
  if (
    !initial ||
    !projectModel ||
    !organizationLeadership ||
    !automaticPreregistration ||
    !participantProfiles ||
    !projectSoftDeletion
  ) {
    throw new Error("expected migrations 0001 through 0006");
  }

  await applyD1Migrations(env.MIGRATION_DB, [
    initial,
    projectModel,
    organizationLeadership,
    automaticPreregistration,
    participantProfiles,
  ]);
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active,
       is_bootstrap, session_version, created_at, updated_at)
      VALUES ('pre-0006-user', 'pre-0006-user', 'pre-0006-user', '기존 운영자',
       'OPERATOR', 1, 0, 1, '2026-07-29T00:00:00.000Z',
       '2026-07-29T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO projects
      (id, name, start_date, end_date, status, revision, created_by,
       created_at, updated_at, closed_at, closed_by, close_reason)
      VALUES ('pre-0006-project', '기존 종료 프로젝트', NULL, NULL, 'CLOSED', 3,
       'pre-0006-user', '2026-07-29T00:00:00.000Z',
       '2026-07-29T00:00:00.000Z', '2026-07-29T01:00:00.000Z',
       'pre-0006-user', 'MANUAL')`),
  ]);
  const before = await countProjects();

  await applyD1Migrations(env.MIGRATION_DB, [projectSoftDeletion]);

  expect(
    await env.MIGRATION_DB.prepare(
      `SELECT deleted_at, deleted_by, deleted_revision
       FROM projects WHERE id = 'pre-0006-project'`,
    ).first(),
  ).toEqual({
    deleted_at: null,
    deleted_by: null,
    deleted_revision: null,
  });
  expect(await countProjects()).toBe(before);
  expect(
    (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});

async function countProjects() {
  const row = await env.MIGRATION_DB.prepare(
    "SELECT COUNT(*) AS count FROM projects",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}
