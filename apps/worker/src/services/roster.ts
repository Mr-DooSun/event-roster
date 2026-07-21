import type { EventStatus, RosterStatus } from "@event-roster/contracts";
import { DomainError } from "@event-roster/domain";
import { encodeBase64Url } from "../auth/refresh-token";
import { findOrganization } from "../db/admin";
import { runGuardedAtomic } from "../db/atomic";
import { findEvent } from "../db/events";
import {
  findRosterById,
  findRosterByParticipant,
  listRoster,
  type RosterRecord,
} from "../db/roster";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";

export async function getRoster(env: Env, actor: Actor, eventId: string) {
  await requireEvent(env.DB, eventId);
  return listRoster(
    env.DB,
    eventId,
    actor.session.user.role === "OPERATOR"
      ? undefined
      : actor.session.user.organizationIds,
  );
}

export async function addRosterEntry(
  env: Env,
  actor: Actor,
  eventId: string,
  participantId: string,
  expectedRevision: number,
) {
  const event = await requireMutableEvent(env.DB, eventId);
  const participant = await env.DB.prepare(
    "SELECT id, participant_id, name, organization_id FROM participants WHERE id = ?",
  )
    .bind(participantId)
    .first<{
      id: string;
      participant_id: string;
      name: string;
      organization_id: string;
    }>();
  if (!participant) throw new DomainError("NOT_FOUND");
  assertActorScope(actor, participant.organization_id, event.status);
  const organization = await findOrganization(
    env.DB,
    participant.organization_id,
  );
  if (!organization?.isActive) throw new DomainError("CONFLICT");
  const existing = await findRosterByParticipant(
    env.DB,
    eventId,
    participantId,
  );
  if (existing?.status === "ACTIVE") throw new DomainError("CONFLICT");
  const source = event.status === "PRE_REGISTRATION" ? "PRE_EVENT" : "DAY_OF";
  const nextSource =
    existing && event.status === "DAY_OF" && !existing.wasExpectedAtDayOf
      ? "DAY_OF"
      : (existing?.source ?? source);
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const operationPredicate = existing
    ? `EXISTS (
         SELECT 1 FROM event_roster_entries
         WHERE id = ? AND event_id = ? AND status = 'CANCELLED' AND revision = ?
       )`
    : `NOT EXISTS (
         SELECT 1 FROM event_roster_entries WHERE event_id = ? AND participant_id = ?
       ) AND EXISTS (
         SELECT 1 FROM participants WHERE id = ? AND organization_id = ?
       )`;
  const operationBindings = existing
    ? [existing.id, eventId, existing.revision]
    : [eventId, participantId, participantId, participant.organization_id];
  const statements: D1PreparedStatement[] = existing
    ? [
        env.DB.prepare(
          `UPDATE event_roster_entries SET status = 'ACTIVE', source = ?,
           revision = revision + 1,
           updated_by = ?, updated_at = ? WHERE id = ?
           RETURNING id, event_id, participant_id, organization_id,
             participant_name_snapshot, organization_name_snapshot, source, status,
             was_expected_at_day_of, revision`,
        ).bind(nextSource, actor.session.user.id, now, existing.id),
      ]
    : [
        env.DB.prepare(
          `INSERT INTO event_roster_entries
           (id, event_id, participant_id, organization_id, participant_name_snapshot,
            organization_name_snapshot, source, status, was_expected_at_day_of, revision,
            created_by, updated_by, created_at, updated_at)
           SELECT ?, ?, p.id, p.organization_id, p.name, o.name, ?, 'ACTIVE', 0, 0,
                  ?, ?, ?, ?
           FROM participants p JOIN organizations o ON o.id = p.organization_id
           WHERE p.id = ?
           RETURNING id, event_id, participant_id, organization_id,
             participant_name_snapshot, organization_name_snapshot, source, status,
             was_expected_at_day_of, revision`,
        ).bind(
          id,
          eventId,
          source,
          actor.session.user.id,
          actor.session.user.id,
          now,
          now,
          participantId,
        ),
      ];
  statements.push(
    incrementEvent(env.DB, eventId, now),
    rosterAudit(
      env.DB,
      actor,
      existing ? "ROSTER_REACTIVATED" : "ROSTER_ADDED",
      id,
      eventId,
      participant.organization_id,
      now,
    ),
  );
  const results = await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: rosterGuard(
      env.DB,
      guardId,
      actor,
      participant.organization_id,
      eventId,
      event.status,
      expectedRevision,
      operationPredicate,
      operationBindings,
    ),
    statements,
    failureCode: "STALE_REVISION",
  });
  const committed = mapReturnedRoster(
    results[1]?.results[0],
    participant.participant_id,
    now,
  );
  return {
    ...committed,
    eventRevision: expectedRevision + 1,
  };
}

export async function updateRosterEntry(
  env: Env,
  actor: Actor,
  eventId: string,
  entryId: string,
  input: {
    status: RosterStatus;
    expectedRevision: number;
    expectedEntryRevision: number;
  },
) {
  const event = await requireMutableEvent(env.DB, eventId);
  const entry = await findRosterById(env.DB, eventId, entryId);
  if (!entry) throw new DomainError("NOT_FOUND");
  assertActorScope(actor, entry.organizationId, event.status);
  if (entry.status === input.status) throw new DomainError("CONFLICT");
  const organization = await findOrganization(env.DB, entry.organizationId);
  if (!organization?.isActive) throw new DomainError("CONFLICT");
  const now = new Date().toISOString();
  const nextSource =
    input.status === "ACTIVE" &&
    event.status === "DAY_OF" &&
    !entry.wasExpectedAtDayOf
      ? "DAY_OF"
      : entry.source;
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: rosterGuard(
      env.DB,
      guardId,
      actor,
      entry.organizationId,
      eventId,
      event.status,
      input.expectedRevision,
      `EXISTS (
         SELECT 1 FROM event_roster_entries
         WHERE id = ? AND event_id = ? AND revision = ? AND status = ?
       )`,
      [entryId, eventId, input.expectedEntryRevision, entry.status],
    ),
    statements: [
      env.DB.prepare(
        `UPDATE event_roster_entries SET status = ?, source = ?, revision = revision + 1,
         updated_by = ?, updated_at = ? WHERE id = ?`,
      ).bind(input.status, nextSource, actor.session.user.id, now, entryId),
      incrementEvent(env.DB, eventId, now),
      rosterAudit(
        env.DB,
        actor,
        input.status === "CANCELLED"
          ? "ROSTER_CANCELLED"
          : "ROSTER_REACTIVATED",
        entryId,
        eventId,
        entry.organizationId,
        now,
      ),
    ],
    failureCode: "STALE_REVISION",
  });
  return {
    ...entry,
    status: input.status,
    source: nextSource,
    revision: input.expectedEntryRevision + 1,
    updatedAt: now,
    eventRevision: input.expectedRevision + 1,
  };
}

export async function getSummary(env: Env, actor: Actor, eventId: string) {
  const scope =
    actor.session.user.role === "OPERATOR"
      ? undefined
      : actor.session.user.organizationIds;
  if (scope?.length === 0) {
    await requireEvent(env.DB, eventId);
    return emptySummary(eventId);
  }
  const scopeSql = scope
    ? ` AND o.id IN (${scope.map(() => "?").join(",")})`
    : "";
  const rows = (
    await env.DB.prepare(
      `WITH selected_event AS (
         SELECT id, status FROM events WHERE id = ?
       ), relevant_organizations AS (
         SELECT organization_id FROM event_expected_snapshots WHERE event_id = ?
         UNION
         SELECT organization_id FROM event_roster_entries WHERE event_id = ?
       ), summary_rows AS (
       SELECT o.id AS organization_id, o.name AS organization_name,
         CASE WHEN e.status = 'PRE_REGISTRATION'
           THEN SUM(CASE WHEN r.source = 'PRE_EVENT' AND r.status = 'ACTIVE' THEN 1 ELSE 0 END)
           ELSE COALESCE(s.expected_count, 0)
         END AS expected,
         SUM(CASE WHEN r.source = 'DAY_OF' AND r.status = 'ACTIVE' THEN 1 ELSE 0 END) AS day_of_added,
         SUM(CASE WHEN r.source = 'PRE_EVENT' AND r.status = 'CANCELLED'
                        AND r.was_expected_at_day_of = 1 THEN 1 ELSE 0 END) AS day_of_cancelled,
         SUM(CASE WHEN r.status = 'ACTIVE' THEN 1 ELSE 0 END) AS final
       FROM selected_event e
       JOIN relevant_organizations relevant ON 1 = 1
       JOIN organizations o ON o.id = relevant.organization_id
       LEFT JOIN event_expected_snapshots s
         ON s.event_id = e.id AND s.organization_id = o.id
       LEFT JOIN event_roster_entries r
         ON r.event_id = e.id AND r.organization_id = o.id
       WHERE 1 = 1${scopeSql}
       GROUP BY o.id, o.name, e.status, s.expected_count
       )
       SELECT organization_id, organization_name, expected, day_of_added,
              day_of_cancelled, final FROM summary_rows
       UNION ALL
       SELECT NULL, NULL, 0, 0, 0, 0 FROM selected_event
       WHERE NOT EXISTS (SELECT 1 FROM summary_rows)
       ORDER BY organization_name`,
    )
      .bind(eventId, eventId, eventId, ...(scope ?? []))
      .all<{
        organization_id: string | null;
        organization_name: string | null;
        expected: number;
        day_of_added: number;
        day_of_cancelled: number;
        final: number;
      }>()
  ).results;
  if (rows.length === 0) throw new DomainError("NOT_FOUND");
  const organizations = rows
    .filter(
      (
        row,
      ): row is typeof row & {
        organization_id: string;
        organization_name: string;
      } => row.organization_id !== null && row.organization_name !== null,
    )
    .map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      expected: row.expected,
      dayOfAdded: row.day_of_added,
      dayOfCancelled: row.day_of_cancelled,
      final: row.final,
      delta: row.final - row.expected,
    }));
  const expectedTotal = organizations.reduce(
    (sum, row) => sum + row.expected,
    0,
  );
  const finalTotal = organizations.reduce((sum, row) => sum + row.final, 0);
  return {
    eventId,
    expectedTotal,
    finalTotal,
    deltaTotal: finalTotal - expectedTotal,
    organizations,
  };
}

export async function getAuditPage(
  env: Env,
  actor: Actor,
  eventId: string,
  limit: number,
  cursor: string | null,
) {
  await requireEvent(env.DB, eventId);
  const decoded = cursor ? decodeCursor(cursor) : null;
  const scope =
    actor.session.user.role === "OPERATOR"
      ? undefined
      : actor.session.user.organizationIds;
  if (scope?.length === 0) return { items: [], nextCursor: null };
  const cursorSql = decoded
    ? " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))"
    : "";
  const scopeSql = scope
    ? ` AND json_extract(details_json, '$.organizationId') IN (${scope.map(() => "?").join(",")})`
    : "";
  const bindings: Array<string | number> = [eventId, eventId];
  if (decoded)
    bindings.push(decoded.occurredAt, decoded.occurredAt, decoded.id);
  bindings.push(...(scope ?? []), limit + 1);
  const rows = (
    await env.DB.prepare(
      `SELECT id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json
       FROM audit_logs
       WHERE ((entity_type = 'EVENT' AND entity_id = ?)
          OR json_extract(details_json, '$.eventId') = ?)${cursorSql}${scopeSql}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    )
      .bind(...bindings)
      .all<{
        id: string;
        actor_user_id: string | null;
        action: string;
        entity_type: string;
        entity_id: string;
        occurred_at: string;
        details_json: string;
      }>()
  ).results;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurredAt: row.occurred_at,
      details: sanitizeAuditDetails(row.details_json),
    })),
    nextCursor:
      hasMore && last
        ? encodeBase64Url(
            new TextEncoder().encode(
              JSON.stringify({ occurredAt: last.occurred_at, id: last.id }),
            ),
          )
        : null,
  };
}

async function requireEvent(db: D1Database, eventId: string) {
  const event = await findEvent(db, eventId);
  if (!event) throw new DomainError("NOT_FOUND");
  return event;
}

async function requireMutableEvent(db: D1Database, eventId: string) {
  const event = await requireEvent(db, eventId);
  if (event.status === "CLOSED") throw new DomainError("EVENT_CLOSED");
  if (event.status !== "PRE_REGISTRATION" && event.status !== "DAY_OF") {
    throw new DomainError("CONFLICT");
  }
  return event;
}

function assertActorScope(
  actor: Actor,
  organizationId: string,
  eventStatus: EventStatus,
) {
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    (!actor.session.user.organizationIds.includes(organizationId) ||
      eventStatus !== "PRE_REGISTRATION")
  ) {
    throw new DomainError("FORBIDDEN");
  }
}

function rosterGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  organizationId: string,
  eventId: string,
  eventStatus: EventStatus,
  expectedRevision: number,
  operationPredicate: string,
  operationBindings: Array<string | number>,
) {
  return db
    .prepare(
      `INSERT INTO operation_guards (id, ok)
     VALUES (?, CASE WHEN EXISTS (
       SELECT 1 FROM users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.kind = 'FULL'
         AND u.is_active = 1 AND u.session_version = ? AND s.session_version = ?
         AND (u.role = 'OPERATOR' OR (? = 'PRE_REGISTRATION' AND EXISTS (
           SELECT 1 FROM user_organizations uo
           WHERE uo.user_id = u.id AND uo.organization_id = ?
         )))
     ) AND EXISTS (
       SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
     ) AND EXISTS (
       SELECT 1 FROM events WHERE id = ? AND status = ? AND revision = ?
     ) AND (${operationPredicate}) THEN 1 ELSE 0 END)`,
    )
    .bind(
      guardId,
      actor.session.user.id,
      actor.session.id,
      actor.claims.sv,
      actor.claims.sv,
      eventStatus,
      organizationId,
      organizationId,
      eventId,
      eventStatus,
      expectedRevision,
      ...operationBindings,
    );
}

function incrementEvent(db: D1Database, eventId: string, now: string) {
  return db
    .prepare(
      "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?",
    )
    .bind(now, eventId);
}

function rosterAudit(
  db: D1Database,
  actor: Actor,
  action: string,
  entryId: string,
  eventId: string,
  organizationId: string,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
     (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
     VALUES (?, ?, ?, 'ROSTER_ENTRY', ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actor.session.user.id,
      action,
      entryId,
      now,
      JSON.stringify({ eventId, organizationId }),
    );
}

function decodeCursor(cursor: string): { occurredAt: string; id: string } {
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
      ),
    ) as {
      occurredAt?: unknown;
      id?: unknown;
    };
    if (typeof value.occurredAt !== "string" || typeof value.id !== "string")
      throw new Error();
    return { occurredAt: value.occurredAt, id: value.id };
  } catch {
    throw new DomainError("VALIDATION_FAILED");
  }
}

function sanitizeAuditDetails(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const details: Record<string, string> = {};
    for (const key of ["eventId", "organizationId"] as const) {
      if (typeof parsed[key] === "string") details[key] = parsed[key];
    }
    return details;
  } catch {
    return {};
  }
}

function mapReturnedRoster(
  value: unknown,
  participantNumber: string,
  updatedAt: string,
): RosterRecord {
  if (!value || typeof value !== "object") {
    throw new DomainError("INTERNAL_ERROR");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.event_id !== "string" ||
    typeof row.participant_id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.participant_name_snapshot !== "string" ||
    typeof row.organization_name_snapshot !== "string" ||
    (row.source !== "PRE_EVENT" && row.source !== "DAY_OF") ||
    (row.status !== "ACTIVE" && row.status !== "CANCELLED") ||
    typeof row.was_expected_at_day_of !== "number" ||
    typeof row.revision !== "number"
  ) {
    throw new DomainError("INTERNAL_ERROR");
  }
  return {
    id: row.id,
    eventId: row.event_id,
    participantId: row.participant_id,
    participantNumber,
    organizationId: row.organization_id,
    participantName: row.participant_name_snapshot,
    organizationName: row.organization_name_snapshot,
    source: row.source,
    status: row.status,
    wasExpectedAtDayOf: row.was_expected_at_day_of === 1,
    revision: row.revision,
    updatedAt,
  };
}

function emptySummary(eventId: string) {
  return {
    eventId,
    expectedTotal: 0,
    finalTotal: 0,
    deltaTotal: 0,
    organizations: [],
  };
}
