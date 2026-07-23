import { env } from "cloudflare:workers";
import type { SeededLogin } from "./admin";
import { seedOperator, seedOrganization } from "./admin";
import { login, seedUser } from "./auth";

export interface LeadershipFixture {
  operator: SeededLogin;
  manager: SeededLogin;
  organizationIds: ["org-1", "org-2"];
  projectIds: ["project-active", "project-closed"];
}

export async function seedLeadershipFixture(): Promise<LeadershipFixture> {
  const operator = await seedOperator();
  await seedOrganization("org-1", "1팀");
  await seedOrganization("org-2", "2팀");
  for (const [id, loginId, displayName] of [
    ["leader-1", "leader-01", "대표 조직장"],
    ["manager-2", "manager-02", "추가 관리자 1"],
    ["manager-3", "manager-03", "추가 관리자 2"],
  ] as const) {
    await seedUser({ id, loginId, password: "manager-password-123" });
    await env.DB.prepare(
      "UPDATE users SET role='ORGANIZATION_MANAGER', display_name=? WHERE id=?",
    )
      .bind(displayName, id)
      .run();
  }
  const now = "2026-07-23T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('leader-1', 'org-1', 'PRIMARY_LEADER', ?, ?)`).bind(
      operator.userId,
      now,
    ),
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('manager-2', 'org-1', 'MANAGER', ?, ?)`).bind(
      operator.userId,
      now,
    ),
    env.DB.prepare(`INSERT INTO user_organizations
      (user_id, organization_id, assignment_role, assigned_by, assigned_at)
      VALUES ('manager-3', 'org-1', 'MANAGER', ?, ?)`).bind(
      operator.userId,
      now,
    ),
    env.DB.prepare(`INSERT INTO projects
      (id, name, status, revision, created_by, created_at, updated_at)
      VALUES ('project-active', '진행 프로젝트', 'PRE_REGISTRATION', 0, ?, ?, ?)`).bind(
      operator.userId,
      now,
      now,
    ),
    env.DB.prepare(`INSERT INTO projects
      (id, name, status, revision, created_by, created_at, updated_at,
       closed_at, closed_by, close_reason)
      VALUES ('project-closed', '종료 프로젝트', 'CLOSED', 1, ?, ?, ?, ?, ?, 'MANUAL')`).bind(
      operator.userId,
      now,
      now,
      now,
      operator.userId,
    ),
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES ('project-active', 'org-1', 1, ?, ?, ?)`).bind(
      now,
      operator.userId,
      operator.userId,
    ),
    env.DB.prepare(`INSERT INTO project_organizations
      (project_id, organization_id, is_active, added_at, added_by, updated_by)
      VALUES ('project-closed', 'org-1', 1, ?, ?, ?)`).bind(
      now,
      operator.userId,
      operator.userId,
    ),
  ]);
  const managerLogin = await login("leader-01", "manager-password-123");
  return {
    operator,
    manager: { ...managerLogin, userId: "leader-1" },
    organizationIds: ["org-1", "org-2"],
    projectIds: ["project-active", "project-closed"],
  };
}
