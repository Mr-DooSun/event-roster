import type {
  OrganizationDetail,
  OrganizationManager,
  OrganizationSummary,
} from "@event-roster/contracts";

export interface OrganizationListFilters {
  query: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  leaderStatus: "ALL" | "ASSIGNED" | "UNASSIGNED";
  visibleOrganizationIds?: string[];
}

export interface OrganizationState {
  id: string;
  name: string;
  canonicalName: string;
  isActive: boolean;
}

interface OrganizationSummaryRow {
  id: string;
  name: string;
  is_active: number;
  primary_user_id: string | null;
  primary_display_name: string | null;
  manager_count: number;
  project_count: number;
}

const ORGANIZATION_SUMMARY_SELECT = `SELECT o.id, o.name, o.is_active,
  (SELECT u.id
   FROM user_organizations uo JOIN users u ON u.id = uo.user_id
   WHERE uo.organization_id = o.id
     AND uo.assignment_role = 'PRIMARY_LEADER'
   LIMIT 1) AS primary_user_id,
  (SELECT u.display_name
   FROM user_organizations uo JOIN users u ON u.id = uo.user_id
   WHERE uo.organization_id = o.id
     AND uo.assignment_role = 'PRIMARY_LEADER'
   LIMIT 1) AS primary_display_name,
  (SELECT COUNT(*) FROM user_organizations uo
   WHERE uo.organization_id = o.id
     AND uo.assignment_role = 'MANAGER') AS manager_count,
  (SELECT COUNT(*) FROM project_organizations po
   WHERE po.organization_id = o.id) AS project_count
  FROM organizations o`;

export async function listOrganizationSummaries(
  db: D1Database,
  filters: OrganizationListFilters,
): Promise<OrganizationSummary[]> {
  if (filters.visibleOrganizationIds?.length === 0) return [];

  const predicates: string[] = [];
  const bindings: Array<string | number> = [];
  if (filters.query) {
    predicates.push("o.name LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeLike(filters.query)}%`);
  }
  if (filters.status !== "ALL") {
    predicates.push("o.is_active = ?");
    bindings.push(filters.status === "ACTIVE" ? 1 : 0);
  }
  if (filters.leaderStatus !== "ALL") {
    predicates.push(`${
      filters.leaderStatus === "UNASSIGNED" ? "NOT " : ""
    }EXISTS (
      SELECT 1 FROM user_organizations leader
      WHERE leader.organization_id = o.id
        AND leader.assignment_role = 'PRIMARY_LEADER'
    )`);
  }
  if (filters.visibleOrganizationIds) {
    predicates.push(
      `o.id IN (${filters.visibleOrganizationIds.map(() => "?").join(",")})`,
    );
    bindings.push(...filters.visibleOrganizationIds);
  }

  const where =
    predicates.length > 0 ? ` WHERE ${predicates.join(" AND ")}` : "";
  const rows = (
    await db
      .prepare(`${ORGANIZATION_SUMMARY_SELECT}${where} ORDER BY o.name, o.id`)
      .bind(...bindings)
      .all<OrganizationSummaryRow>()
  ).results;
  return rows.map(mapSummary);
}

export async function findOrganizationState(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationState | null> {
  const row = await db
    .prepare(
      `SELECT id, name, canonical_name, is_active
       FROM organizations WHERE id = ?`,
    )
    .bind(organizationId)
    .first<{
      id: string;
      name: string;
      canonical_name: string;
      is_active: number;
    }>();
  return row
    ? {
        id: row.id,
        name: row.name,
        canonicalName: row.canonical_name,
        isActive: row.is_active === 1,
      }
    : null;
}

export async function findOrganizationDetail(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationDetail | null> {
  const summaryRow = await db
    .prepare(`${ORGANIZATION_SUMMARY_SELECT} WHERE o.id = ?`)
    .bind(organizationId)
    .first<OrganizationSummaryRow>();
  if (!summaryRow) return null;

  const [managerResult, projectResult] = await Promise.all([
    db
      .prepare(
        `SELECT u.id AS user_id, u.login_id, u.display_name, u.is_active,
                uo.assignment_role, uo.assigned_at
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
         WHERE uo.organization_id = ?
         ORDER BY CASE uo.assignment_role
                    WHEN 'PRIMARY_LEADER' THEN 0 ELSE 1 END,
                  u.display_name, u.id`,
      )
      .bind(organizationId)
      .all<{
        user_id: string;
        login_id: string;
        display_name: string;
        is_active: number;
        assignment_role: "PRIMARY_LEADER" | "MANAGER";
        assigned_at: string;
      }>(),
    db
      .prepare(
        `SELECT p.id AS project_id, p.name AS project_name,
                p.status AS project_status, po.is_active AS membership_is_active
         FROM project_organizations po
         JOIN projects p ON p.id = po.project_id
         WHERE po.organization_id = ?
         ORDER BY CASE WHEN p.status = 'CLOSED' THEN 1 ELSE 0 END,
                  p.name, p.id`,
      )
      .bind(organizationId)
      .all<{
        project_id: string;
        project_name: string;
        project_status:
          | "PREPARING"
          | "PRE_REGISTRATION"
          | "IN_PROGRESS"
          | "CLOSED";
        membership_is_active: number;
      }>(),
  ]);

  return {
    ...mapSummary(summaryRow),
    managers: managerResult.results.map((row) => ({
      userId: row.user_id,
      loginId: row.login_id,
      displayName: row.display_name,
      isActive: row.is_active === 1,
      assignmentRole: row.assignment_role,
      assignedAt: row.assigned_at,
    })),
    projects: projectResult.results.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      projectStatus: row.project_status,
      membershipIsActive: row.membership_is_active === 1,
    })),
  };
}

export async function listAssignableManagerAccounts(
  db: D1Database,
  organizationId: string,
  query: string,
): Promise<
  Array<
    Pick<OrganizationManager, "userId" | "loginId" | "displayName" | "isActive">
  >
> {
  const escaped = `%${escapeLike(query)}%`;
  const rows = (
    await db
      .prepare(
        `SELECT u.id, u.login_id, u.display_name, u.is_active
         FROM users u
         WHERE u.role = 'ORGANIZATION_MANAGER'
           AND u.is_active = 1 AND u.is_bootstrap = 0
           AND NOT EXISTS (
             SELECT 1 FROM user_organizations uo
             WHERE uo.user_id = u.id AND uo.organization_id = ?
           )
           AND (u.login_id LIKE ? ESCAPE '\\'
             OR u.display_name LIKE ? ESCAPE '\\')
         ORDER BY u.display_name, u.id`,
      )
      .bind(organizationId, escaped, escaped)
      .all<{
        id: string;
        login_id: string;
        display_name: string;
        is_active: number;
      }>()
  ).results;
  return rows.map((row) => ({
    userId: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    isActive: row.is_active === 1,
  }));
}

export interface OrganizationAuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  occurred_at: string;
  details_json: string;
}

export async function listOrganizationAuditRows(
  db: D1Database,
  organizationId: string,
  limit: number,
  cursor: { occurredAt: string; id: string } | null,
): Promise<{ rows: OrganizationAuditRow[]; hasMore: boolean }> {
  const cursorSql = cursor
    ? " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))"
    : "";
  const bindings: Array<string | number> = [organizationId, organizationId];
  if (cursor) {
    bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  bindings.push(limit + 1);
  const rows = (
    await db
      .prepare(
        `SELECT id, actor_user_id, action, entity_type, entity_id,
                occurred_at, details_json
         FROM audit_logs
         WHERE ((entity_type = 'ORGANIZATION' AND entity_id = ?)
           OR CASE WHEN json_valid(details_json) THEN
                json_extract(details_json, '$.organizationId') = ?
              ELSE 0 END)${cursorSql}
         ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      )
      .bind(...bindings)
      .all<OrganizationAuditRow>()
  ).results;
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function mapSummary(row: OrganizationSummaryRow): OrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    primaryLeader:
      row.primary_user_id && row.primary_display_name
        ? {
            userId: row.primary_user_id,
            displayName: row.primary_display_name,
          }
        : null,
    managerCount: row.manager_count,
    projectCount: row.project_count,
  };
}
