import type { Role } from "@event-roster/contracts";

export interface UserAdminRecord {
  id: string;
  loginId: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  organizationIds: string[];
}

export interface UserAdminState extends UserAdminRecord {
  sessionVersion: number;
  passwordHash: string;
}

export async function listUsers(db: D1Database): Promise<UserAdminRecord[]> {
  const rows = (
    await db
      .prepare(
        `SELECT u.id, u.login_id, u.display_name, u.role, u.is_active,
                GROUP_CONCAT(uo.organization_id) AS organization_ids
         FROM users u LEFT JOIN user_organizations uo ON uo.user_id = u.id
         WHERE u.is_bootstrap = 0
         GROUP BY u.id ORDER BY u.display_name`,
      )
      .all<{
        id: string;
        login_id: string;
        display_name: string;
        role: Role;
        is_active: number;
        organization_ids: string | null;
      }>()
  ).results;
  return rows.map((row) => ({
    id: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    organizationIds: row.organization_ids?.split(",") ?? [],
  }));
}

export async function findAdminUserState(
  db: D1Database,
  id: string,
): Promise<UserAdminState | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.login_id, u.display_name, u.role, u.is_active,
              u.session_version, p.password_hash,
              GROUP_CONCAT(uo.organization_id) AS organization_ids
       FROM users u
       JOIN password_credentials p ON p.user_id = u.id
       LEFT JOIN user_organizations uo ON uo.user_id = u.id
       WHERE u.id = ? AND u.is_bootstrap = 0
       GROUP BY u.id`,
    )
    .bind(id)
    .first<{
      id: string;
      login_id: string;
      display_name: string;
      role: Role;
      is_active: number;
      session_version: number;
      password_hash: string;
      organization_ids: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    organizationIds: row.organization_ids?.split(",") ?? [],
    sessionVersion: row.session_version,
    passwordHash: row.password_hash,
  };
}
