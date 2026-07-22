import type { ProjectOrganization } from "@event-roster/contracts";

interface ProjectOrganizationRow {
  organization_id: string;
  name: string;
  is_active: number;
  master_is_active: number;
  active_project_count: number;
  has_history: number;
}

const SELECT_PROJECT_ORGANIZATION = `SELECT
  po.organization_id,
  o.name,
  po.is_active,
  o.is_active AS master_is_active,
  (SELECT COUNT(*) FROM project_organizations active
   WHERE active.organization_id = po.organization_id
     AND active.is_active = 1) AS active_project_count,
  EXISTS (
    SELECT 1 FROM event_roster_entries roster
    WHERE roster.event_id = po.project_id
      AND roster.organization_id = po.organization_id
    UNION ALL
    SELECT 1 FROM project_expected_snapshots snapshot
    WHERE snapshot.project_id = po.project_id
      AND snapshot.organization_id = po.organization_id
  ) AS has_history
FROM project_organizations po
JOIN organizations o ON o.id = po.organization_id`;

export async function listProjectOrganizations(
  db: D1Database,
  projectId: string,
): Promise<ProjectOrganization[]> {
  const rows = (
    await db
      .prepare(
        `${SELECT_PROJECT_ORGANIZATION}
         WHERE po.project_id = ?
         ORDER BY o.name, po.organization_id`,
      )
      .bind(projectId)
      .all<ProjectOrganizationRow>()
  ).results;
  return rows.map(mapProjectOrganization);
}

export async function findProjectOrganization(
  db: D1Database,
  projectId: string,
  organizationId: string,
): Promise<ProjectOrganization | null> {
  const row = await db
    .prepare(
      `${SELECT_PROJECT_ORGANIZATION}
       WHERE po.project_id = ? AND po.organization_id = ?`,
    )
    .bind(projectId, organizationId)
    .first<ProjectOrganizationRow>();
  return row ? mapProjectOrganization(row) : null;
}

export async function listActorProjectOrganizationIds(
  db: D1Database,
  actorUserId: string,
  projectId: string,
  activeOnly: boolean,
): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `SELECT po.organization_id
         FROM project_organizations po
         JOIN user_organizations actor_org
           ON actor_org.organization_id = po.organization_id
         JOIN organizations o ON o.id = po.organization_id
         WHERE actor_org.user_id = ? AND po.project_id = ?
           AND (? = 0 OR (po.is_active = 1 AND o.is_active = 1))
         ORDER BY po.organization_id`,
      )
      .bind(actorUserId, projectId, activeOnly ? 1 : 0)
      .all<{ organization_id: string }>()
  ).results;
  return rows.map((row) => row.organization_id);
}

function mapProjectOrganization(
  row: ProjectOrganizationRow,
): ProjectOrganization {
  return {
    organizationId: row.organization_id,
    name: row.name,
    isActive: row.is_active === 1,
    masterIsActive: row.master_is_active === 1,
    activeProjectCount: row.active_project_count,
    hasHistory: row.has_history === 1,
  };
}
