import type { Project, ProjectStatus } from "@event-roster/contracts";
import { MANAGER_PROJECT_MEMBERSHIP_SCOPE } from "./project-organizations";

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
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_revision: number | null;
}

export type ProjectRecord = Project;

const SELECT_PROJECT = `SELECT id, name, start_date, end_date, status, revision,
  created_by, created_at, updated_at, closed_at, closed_by, close_reason,
  deleted_at, deleted_by, deleted_revision FROM projects`;

export interface ProjectListOptions {
  actorUserId?: string;
  includeDeleted?: boolean;
}

export async function findProject(
  db: D1Database,
  id: string,
): Promise<ProjectRecord | null> {
  return findProjectByDeletionScope(db, id, false);
}

export async function findProjectIncludingDeleted(
  db: D1Database,
  id: string,
): Promise<ProjectRecord | null> {
  return findProjectByDeletionScope(db, id, true);
}

async function findProjectByDeletionScope(
  db: D1Database,
  id: string,
  includeDeleted: boolean,
): Promise<ProjectRecord | null> {
  const row = await db
    .prepare(
      `${SELECT_PROJECT} WHERE id = ?${
        includeDeleted ? "" : " AND deleted_at IS NULL"
      }`,
    )
    .bind(id)
    .first<ProjectRow>();
  return row ? mapProject(row) : null;
}

export async function listProjects(
  db: D1Database,
  options: ProjectListOptions = {},
): Promise<ProjectRecord[]> {
  const predicates: string[] = [];
  const bindings: string[] = [];
  if (!options.includeDeleted) {
    predicates.push("projects.deleted_at IS NULL");
  }
  if (options.actorUserId) {
    predicates.push(`EXISTS (
          SELECT 1 FROM project_organizations po
          JOIN user_organizations uo
            ON uo.organization_id = po.organization_id
          JOIN organizations o ON o.id = po.organization_id
          WHERE po.project_id = projects.id
            AND uo.user_id = ?
            AND o.is_active = 1
            AND o.deleted_at IS NULL
            AND ${MANAGER_PROJECT_MEMBERSHIP_SCOPE}
        )`);
    bindings.push(options.actorUserId);
  }
  const where =
    predicates.length === 0 ? "" : ` WHERE ${predicates.join(" AND ")}`;
  const rows = (
    await db
      .prepare(`${SELECT_PROJECT}${where} ORDER BY
        CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END,
        CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN 1 ELSE 0 END,
        CASE WHEN status <> 'CLOSED' THEN start_date END,
        CASE WHEN status <> 'CLOSED' AND start_date IS NULL THEN created_at END DESC,
        CASE WHEN status = 'CLOSED' THEN closed_at END DESC`)
      .bind(...bindings)
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
    isDeleted: row.deleted_at !== null,
    deletedAt: row.deleted_at,
  };
}
