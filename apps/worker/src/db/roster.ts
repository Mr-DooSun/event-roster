import type { RosterSource, RosterStatus } from "@event-roster/contracts";

export interface RosterRecord {
  id: string;
  projectId: string;
  participantId: string;
  participantNumber: string;
  organizationId: string;
  participantName: string;
  organizationName: string;
  source: RosterSource;
  status: RosterStatus;
  wasExpectedAtStart: boolean;
  revision: number;
  updatedAt: string;
}

interface RosterRow {
  id: string;
  project_id: string;
  participant_id: string;
  participant_number: string;
  organization_id: string;
  participant_name_snapshot: string;
  organization_name_snapshot: string;
  source: RosterSource;
  status: RosterStatus;
  was_expected_at_start: number;
  revision: number;
  updated_at: string;
}

const SELECT_ROSTER = `SELECT r.id, r.project_id, r.participant_id,
  p.participant_id AS participant_number, r.organization_id,
  r.participant_name_snapshot, r.organization_name_snapshot, r.source,
  r.status, r.was_expected_at_start, r.revision, r.updated_at
  FROM project_roster_entries r
  JOIN participants p ON p.id = r.participant_id`;

export async function findRosterByParticipant(
  db: D1Database,
  projectId: string,
  participantId: string,
): Promise<RosterRecord | null> {
  const row = await db
    .prepare(`${SELECT_ROSTER} WHERE r.project_id = ? AND r.participant_id = ?`)
    .bind(projectId, participantId)
    .first<RosterRow>();
  return row ? mapRoster(row) : null;
}

export async function findRosterById(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<RosterRecord | null> {
  const row = await db
    .prepare(`${SELECT_ROSTER} WHERE r.project_id = ? AND r.id = ?`)
    .bind(projectId, id)
    .first<RosterRow>();
  return row ? mapRoster(row) : null;
}

export async function listRoster(
  db: D1Database,
  projectId: string,
  organizationIds?: string[],
): Promise<RosterRecord[]> {
  if (organizationIds?.length === 0) return [];
  const scope = organizationIds
    ? ` AND r.organization_id IN (${organizationIds.map(() => "?").join(",")})`
    : "";
  const rows = (
    await db
      .prepare(
        `${SELECT_ROSTER} WHERE r.project_id = ?${scope}
         ORDER BY r.participant_name_snapshot, r.organization_name_snapshot,
                  participant_number, r.id`,
      )
      .bind(projectId, ...(organizationIds ?? []))
      .all<RosterRow>()
  ).results;
  return rows.map(mapRoster);
}

function mapRoster(row: RosterRow): RosterRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    participantId: row.participant_id,
    participantNumber: row.participant_number,
    organizationId: row.organization_id,
    participantName: row.participant_name_snapshot,
    organizationName: row.organization_name_snapshot,
    source: row.source,
    status: row.status,
    wasExpectedAtStart: row.was_expected_at_start === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
