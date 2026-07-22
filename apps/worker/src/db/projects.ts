import type { Project, ProjectStatus } from "@event-roster/contracts";

interface ProjectRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  close_reason: "MANUAL" | "SCHEDULED" | null;
}

export type ProjectRecord = Project;

const SELECT_PROJECT = `SELECT id, name, start_date, end_date, status, revision,
  created_by, created_at, updated_at, closed_at, closed_by, close_reason FROM projects`;

export async function findProject(
  db: D1Database,
  id: string,
): Promise<ProjectRecord | null> {
  const row = await db
    .prepare(`${SELECT_PROJECT} WHERE id = ?`)
    .bind(id)
    .first<ProjectRow>();
  return row ? mapProject(row) : null;
}

export async function listProjects(db: D1Database): Promise<ProjectRecord[]> {
  const rows = (
    await db
      .prepare(`${SELECT_PROJECT} ORDER BY
        CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END,
        CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN 1 ELSE 0 END,
        CASE WHEN status <> 'CLOSED' THEN start_date END,
        CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN created_at END DESC,
        CASE WHEN status = 'CLOSED' THEN closed_at END DESC`)
      .all<ProjectRow>()
  ).results;
  return rows.map(mapProject);
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    closeReason: row.close_reason,
  };
}
