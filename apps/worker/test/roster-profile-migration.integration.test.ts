import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { listRoster } from "../src/db/roster";

it("preserves legacy roster profiles and validates new participant profile snapshots", async () => {
  const [
    initial,
    projectModel,
    organizationLeadership,
    automaticPreregistration,
    participantProfiles,
  ] = env.TEST_MIGRATIONS;
  if (
    !initial ||
    !projectModel ||
    !organizationLeadership ||
    !automaticPreregistration ||
    !participantProfiles
  ) {
    throw new Error("expected migrations 0001 through 0005");
  }

  await applyD1Migrations(env.MIGRATION_DB, [
    initial,
    projectModel,
    organizationLeadership,
    automaticPreregistration,
  ]);
  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO organizations
      (id, name, canonical_name, is_active, created_at, updated_at)
      VALUES ('legacy-profile-org', '기존 프로필 조직', '기존 프로필 조직', 1,
        '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active,
       is_bootstrap, session_version, created_at, updated_at)
      VALUES ('legacy-profile-user', 'legacy-profile-user', 'legacy-profile-user',
       '기존 프로필 운영자', 'OPERATOR', 1, 0, 1,
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO projects
      (id, name, start_date, end_date, status, revision, created_by,
       created_at, updated_at)
      VALUES ('legacy-profile-project', '기존 프로필 프로젝트', NULL, NULL,
       'PRE_REGISTRATION', 0, 'legacy-profile-user',
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO participants
      (id, participant_id, name, organization_id, revision, created_at, updated_at)
      VALUES ('legacy-profile-participant', 'P-LEGACY-PROFILE', '기존 프로필 참가자',
       'legacy-profile-org', 0, '2026-07-28T00:00:00.000Z',
       '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO project_roster_entries
      (id, project_id, participant_id, organization_id,
       participant_name_snapshot, organization_name_snapshot, source, status,
       was_expected_at_start, revision, created_by, updated_by, created_at,
       updated_at)
      VALUES ('legacy-profile-entry', 'legacy-profile-project',
       'legacy-profile-participant', 'legacy-profile-org', '기존 프로필 참가자',
       '기존 프로필 조직', 'PRE_REGISTRATION', 'ACTIVE', 0, 0,
       'legacy-profile-user', 'legacy-profile-user',
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
  ]);

  await applyD1Migrations(env.MIGRATION_DB, [participantProfiles]);

  expect(
    await env.MIGRATION_DB.prepare(
      `SELECT participant_role_snapshot, student_grade_snapshot
       FROM project_roster_entries WHERE id = 'legacy-profile-entry'`,
    ).first(),
  ).toEqual({
    participant_role_snapshot: null,
    student_grade_snapshot: null,
  });

  await env.MIGRATION_DB.batch([
    env.MIGRATION_DB.prepare(`INSERT INTO organizations
      (id, name, canonical_name, is_active, created_at, updated_at)
      VALUES ('profile-org', '프로필 조직', '프로필 조직', 1,
        '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO users
      (id, login_id, login_id_canonical, display_name, role, is_active,
       is_bootstrap, session_version, created_at, updated_at)
      VALUES ('profile-user', 'profile-user', 'profile-user', '프로필 운영자',
       'OPERATOR', 1, 0, 1, '2026-07-28T00:00:00.000Z',
       '2026-07-28T00:00:00.000Z')`),
    env.MIGRATION_DB.prepare(`INSERT INTO projects
      (id, name, start_date, end_date, status, revision, created_by,
       created_at, updated_at)
      VALUES ('profile-project', '프로필 프로젝트', NULL, NULL,
       'PRE_REGISTRATION', 0, 'profile-user',
       '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`),
  ]);

  async function insertProfile(
    id: string,
    role: "STUDENT" | "TEACHER",
    grade: "M1" | "M2" | "M3" | "H1" | "H2" | "H3" | null,
  ) {
    await env.MIGRATION_DB.prepare(
      `INSERT INTO participants
       (id, participant_id, name, organization_id, revision, created_at, updated_at)
       VALUES (?, ?, ?, 'profile-org', 0,
         '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z')`,
    )
      .bind(`participant-${id}`, `P-${id}`, id)
      .run();
    return env.MIGRATION_DB.prepare(
      `INSERT INTO project_roster_entries
       (id, project_id, participant_id, organization_id,
        participant_name_snapshot, organization_name_snapshot, source, status,
        was_expected_at_start, revision, created_by, updated_by, created_at,
        updated_at, participant_role_snapshot, student_grade_snapshot)
       VALUES (?, 'profile-project', ?, 'profile-org', ?, '프로필 조직',
         'PRE_REGISTRATION', 'ACTIVE', 0, 0, 'profile-user', 'profile-user',
         '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z', ?, ?)`,
    )
      .bind(id, `participant-${id}`, id, role, grade)
      .run();
  }

  await expect(insertProfile("student-ok", "STUDENT", "M1")).resolves.toBeDefined();
  await expect(insertProfile("teacher-ok", "TEACHER", null)).resolves.toBeDefined();
  await expect(insertProfile("student-bad", "STUDENT", null)).rejects.toThrow(
    /INVALID_ROSTER_PROFILE/,
  );
  await expect(insertProfile("teacher-bad", "TEACHER", "H2")).rejects.toThrow(
    /INVALID_ROSTER_PROFILE/,
  );

  await expect(
    env.MIGRATION_DB.prepare(
      `UPDATE project_roster_entries
       SET student_grade_snapshot = 'H3' WHERE id = 'teacher-ok'`,
    ).run(),
  ).rejects.toThrow(/INVALID_ROSTER_PROFILE/);

  await expect(
    listRoster(env.MIGRATION_DB, "legacy-profile-project"),
  ).resolves.toEqual([
    expect.objectContaining({
      id: "legacy-profile-entry",
      role: null,
      grade: null,
    }),
  ]);
  await expect(listRoster(env.MIGRATION_DB, "profile-project")).resolves.toEqual([
    expect.objectContaining({ id: "student-ok", role: "STUDENT", grade: "M1" }),
    expect.objectContaining({ id: "teacher-ok", role: "TEACHER", grade: null }),
  ]);

  expect(
    (await env.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});
