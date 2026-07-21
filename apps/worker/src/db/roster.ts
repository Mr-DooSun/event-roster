import type { RosterSource, RosterStatus } from "@event-roster/contracts";

export interface RosterRecord {
  id: string;
  eventId: string;
  participantId: string;
  participantNumber: string;
  organizationId: string;
  participantName: string;
  organizationName: string;
  source: RosterSource;
  status: RosterStatus;
  wasExpectedAtDayOf: boolean;
  revision: number;
  updatedAt: string;
}

interface RosterRow {
  id: string;
  event_id: string;
  participant_id: string;
  participant_number: string;
  organization_id: string;
  participant_name_snapshot: string;
  organization_name_snapshot: string;
  source: RosterSource;
  status: RosterStatus;
  was_expected_at_day_of: number;
  revision: number;
  updated_at: string;
}

const SELECT_ROSTER = `SELECT id, event_id, participant_id, organization_id,
  participant_name_snapshot, organization_name_snapshot, source, status,
  was_expected_at_day_of, revision, updated_at,
  (SELECT participant_id FROM participants p
   WHERE p.id = event_roster_entries.participant_id) AS participant_number
  FROM event_roster_entries`;

export async function findRosterByParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<RosterRecord | null> {
  const row = await db
    .prepare(`${SELECT_ROSTER} WHERE event_id = ? AND participant_id = ?`)
    .bind(eventId, participantId)
    .first<RosterRow>();
  return row ? mapRoster(row) : null;
}

export async function findRosterById(
  db: D1Database,
  eventId: string,
  id: string,
): Promise<RosterRecord | null> {
  const row = await db
    .prepare(`${SELECT_ROSTER} WHERE event_id = ? AND id = ?`)
    .bind(eventId, id)
    .first<RosterRow>();
  return row ? mapRoster(row) : null;
}

export async function listRoster(
  db: D1Database,
  eventId: string,
  organizationIds?: string[],
): Promise<RosterRecord[]> {
  if (organizationIds?.length === 0) return [];
  const scope = organizationIds
    ? ` AND organization_id IN (${organizationIds.map(() => "?").join(",")})`
    : "";
  const rows = (
    await db
      .prepare(
        `${SELECT_ROSTER} WHERE event_id = ?${scope}
         ORDER BY participant_name_snapshot, organization_name_snapshot,
                  participant_number, id`,
      )
      .bind(eventId, ...(organizationIds ?? []))
      .all<RosterRow>()
  ).results;
  return rows.map(mapRoster);
}

function mapRoster(row: RosterRow): RosterRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    participantId: row.participant_id,
    participantNumber: row.participant_number,
    organizationId: row.organization_id,
    participantName: row.participant_name_snapshot,
    organizationName: row.organization_name_snapshot,
    source: row.source,
    status: row.status,
    wasExpectedAtDayOf: row.was_expected_at_day_of === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
