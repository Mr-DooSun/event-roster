import type { EventStatus, Half } from "@event-roster/contracts";

export interface EventRecord {
  id: string;
  year: number;
  half: Half;
  name: string;
  status: EventStatus;
  revision: number;
}

interface EventRow {
  id: string;
  year: number;
  half: Half;
  name: string;
  status: EventStatus;
  revision: number;
}

export async function findEvent(
  db: D1Database,
  id: string,
): Promise<EventRecord | null> {
  const row = await db
    .prepare(
      "SELECT id, year, half, name, status, revision FROM events WHERE id = ?",
    )
    .bind(id)
    .first<EventRow>();
  return row ?? null;
}

export async function listEvents(db: D1Database): Promise<EventRecord[]> {
  return (
    await db
      .prepare(
        "SELECT id, year, half, name, status, revision FROM events ORDER BY year DESC, half DESC",
      )
      .all<EventRow>()
  ).results;
}
