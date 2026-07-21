import type { NormalizedImportRow } from "@event-roster/contracts";
import { DomainError, validateNormalizedRows } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import { findEvent } from "../db/events";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard } from "./admin";
import { getRoster, getSummary } from "./roster";

const PARTICIPANT_CHUNK_SIZE = 15;
const ROSTER_CHUNK_SIZE = 11;
const AUDIT_CHUNK_SIZE = 45;

interface ResolvedImportRow {
  rowNumber: number;
  name: string;
  expectedParticipantName: string;
  organizationId: string;
  organizationName: string;
  organizationCanonicalName: string;
  participantId: string;
  participantRevision: number;
  entryId: string;
  createParticipant: boolean;
  organizationParticipantCountAfterInsert: number;
  organizationParticipantRevisionSum: number;
  mutateRoster: boolean;
}

export function buildImportQueryPlan(rows: NormalizedImportRow[]) {
  const participantChunks = Math.ceil(rows.length / PARTICIPANT_CHUNK_SIZE);
  const rosterChunks = Math.ceil(rows.length / ROSTER_CHUNK_SIZE);
  const auditChunks = Math.ceil(rows.length / AUDIT_CHUNK_SIZE);
  return {
    rows,
    queryCount:
      3 + 1 + participantChunks + rosterChunks + auditChunks + 1 + 1 + 1,
    bindingCounts: [
      1,
      0,
      1,
      6 * Math.min(PARTICIPANT_CHUNK_SIZE, rows.length),
      8 * Math.min(ROSTER_CHUNK_SIZE, rows.length) + 5,
      2 * Math.min(AUDIT_CHUNK_SIZE, rows.length) + 2,
      2,
      5,
      1,
    ],
  };
}

export async function validateImport(
  env: Env,
  eventId: string,
  rows: NormalizedImportRow[],
) {
  const normalized = validateNormalizedRows(rows);
  const event = await findEvent(env.DB, eventId);
  if (!event) throw new DomainError("NOT_FOUND");
  if (event.status !== "PRE_REGISTRATION") throw new DomainError("CONFLICT");
  const resolved = await resolveRows(env.DB, eventId, normalized);
  return {
    eventRevision: event.revision,
    rows: resolved.map((row) => ({
      rowNumber: row.input.rowNumber,
      name: row.input.name,
      organizationName: row.input.organizationName,
      issues: row.issues,
      candidates: row.candidates.map((candidate) => ({
        participantId: candidate.id,
        participantNumber: candidate.participant_id,
        name: candidate.name,
      })),
    })),
  };
}

export async function commitImport(
  env: Env,
  actor: Actor,
  eventId: string,
  rows: NormalizedImportRow[],
  expectedEventRevision: number,
) {
  const normalized = validateNormalizedRows(rows);
  const event = await findEvent(env.DB, eventId);
  if (!event) throw new DomainError("NOT_FOUND");
  if (event.status !== "PRE_REGISTRATION") throw new DomainError("CONFLICT");
  const resolution = await resolveRows(env.DB, eventId, normalized);
  if (resolution.some((row) => row.issues.length > 0)) {
    throw new DomainError("VALIDATION_FAILED", {
      rows: resolution.map((row) => ({
        rowNumber: row.input.rowNumber,
        issues: row.issues,
      })),
    });
  }
  const createdByOrganization = new Map<string, number>();
  for (const row of resolution) {
    if (!selectCandidate(row.input, row.candidates)) {
      const organizationId = row.organizationId as string;
      createdByOrganization.set(
        organizationId,
        (createdByOrganization.get(organizationId) ?? 0) + 1,
      );
    }
  }
  const resolved: ResolvedImportRow[] = resolution.map((row) => {
    const selected = selectCandidate(row.input, row.candidates);
    const organizationId = row.organizationId as string;
    return {
      rowNumber: row.input.rowNumber,
      name: row.input.name,
      expectedParticipantName: selected?.name ?? row.input.name,
      organizationId,
      organizationName: row.organizationName as string,
      organizationCanonicalName: row.organizationCanonicalName as string,
      participantId: selected?.id ?? crypto.randomUUID(),
      participantRevision: selected?.revision ?? 0,
      entryId: row.existingEntryId ?? crypto.randomUUID(),
      createParticipant: !selected,
      organizationParticipantCountAfterInsert:
        row.organizationParticipantCount +
        (createdByOrganization.get(organizationId) ?? 0),
      organizationParticipantRevisionSum:
        row.organizationParticipantRevisionSum,
      mutateRoster: selected?.entry_status !== "ACTIVE",
    };
  });
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const newParticipants = resolved.filter((row) => row.createParticipant);
  for (const chunk of chunks(newParticipants, PARTICIPANT_CHUNK_SIZE)) {
    statements.push(participantInsert(env.DB, chunk, now));
  }
  for (const chunk of chunks(resolved, ROSTER_CHUNK_SIZE)) {
    statements.push(
      rosterUpsert(env.DB, chunk, eventId, actor.session.user.id, now),
    );
  }
  const rosterMutations = resolved.filter((row) => row.mutateRoster);
  for (const chunk of chunks(rosterMutations, AUDIT_CHUNK_SIZE)) {
    statements.push(
      importAuditInsert(env.DB, chunk, eventId, actor.session.user.id, now),
    );
  }
  statements.push(
    env.DB.prepare(
      "UPDATE events SET revision = revision + 1, updated_at = ? WHERE id = ?",
    ).bind(now, eventId),
    env.DB.prepare(
      `INSERT INTO import_runs
       (id, event_id, actor_user_id, row_count, created_at, details_json)
       VALUES (?, ?, ?, ?, ?, '{}')`,
    ).bind(
      crypto.randomUUID(),
      eventId,
      actor.session.user.id,
      resolved.length,
      now,
    ),
  );
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        `EXISTS (
           SELECT 1 FROM events WHERE id = ? AND status = 'PRE_REGISTRATION' AND revision = ?
         )`,
        [eventId, expectedEventRevision],
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        "NOT NULL constraint failed: event_roster_entries.organization_id",
      )
    ) {
      throw new DomainError("STALE_REVISION");
    }
    throw error;
  }
  return {
    importedCount: resolved.length,
    eventRevision: expectedEventRevision + 1,
  };
}

export async function getExportData(env: Env, actor: Actor, eventId: string) {
  const [roster, summary] = await Promise.all([
    getRoster(env, actor, eventId),
    getSummary(env, actor, eventId),
  ]);
  return {
    명단: roster.map((row) => ({
      "고유 ID": row.participantNumber,
      이름: row.participantName,
      조직: row.organizationName,
      구분: row.source,
      상태: row.status,
      "최종 수정": row.updatedAt,
    })),
    집계: summary.organizations.map((row) => ({
      조직: row.organizationName,
      예상: row.expected,
      "당일 추가": row.dayOfAdded,
      "당일 취소": row.dayOfCancelled,
      최종: row.final,
      증감: row.delta,
    })),
  };
}

async function resolveRows(
  db: D1Database,
  eventId: string,
  rows: NormalizedImportRow[],
) {
  const organizations = (
    await db
      .prepare("SELECT id, name, canonical_name, is_active FROM organizations")
      .all<{
        id: string;
        name: string;
        canonical_name: string;
        is_active: number;
      }>()
  ).results;
  const participantRows = (
    await db
      .prepare(
        `SELECT p.id, p.participant_id, p.name, p.organization_id, p.revision,
              r.id AS entry_id, r.status AS entry_status
       FROM participants p
       LEFT JOIN event_roster_entries r ON r.participant_id = p.id AND r.event_id = ?`,
      )
      .bind(eventId)
      .all<{
        id: string;
        participant_id: string;
        name: string;
        organization_id: string;
        revision: number;
        entry_id: string | null;
        entry_status: string | null;
      }>()
  ).results;
  return rows.map((input) => {
    const organization = organizations.find(
      (item) => item.canonical_name === canonical(input.organizationName),
    );
    const candidates = organization
      ? participantRows.filter(
          (item) =>
            item.organization_id === organization.id &&
            canonical(item.name) === canonical(input.name),
        )
      : [];
    const issues: string[] = [];
    if (organization?.is_active !== 1) issues.push("UNKNOWN_ORGANIZATION");
    if (candidates.length > 1 && !selectCandidate(input, candidates)) {
      issues.push("AMBIGUOUS_PARTICIPANT");
    }
    if (input.resolvedParticipantId && !selectCandidate(input, candidates)) {
      issues.push("INVALID_CANDIDATE");
    }
    const selected = selectCandidate(input, candidates);
    return {
      input,
      organizationId: organization?.id,
      organizationName: organization?.name,
      organizationCanonicalName: organization?.canonical_name,
      organizationParticipantCount: organization
        ? participantRows.filter(
            (participant) => participant.organization_id === organization.id,
          ).length
        : 0,
      organizationParticipantRevisionSum: organization
        ? participantRows
            .filter(
              (participant) => participant.organization_id === organization.id,
            )
            .reduce((sum, participant) => sum + participant.revision, 0)
        : 0,
      candidates,
      issues,
      existingEntryId: selected?.entry_id ?? undefined,
    };
  });
}

function selectCandidate<T extends { id: string }>(
  input: NormalizedImportRow,
  candidates: T[],
): T | undefined {
  if (input.resolvedParticipantId) {
    return candidates.find(
      (candidate) => candidate.id === input.resolvedParticipantId,
    );
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function participantInsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  now: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, 0, ?, ?)").join(",");
  const bindings = rows.flatMap((row) => [
    row.participantId,
    `P-${crypto.randomUUID().toUpperCase()}`,
    row.name,
    row.organizationId,
    now,
    now,
  ]);
  return db
    .prepare(
      `INSERT INTO participants
     (id, participant_id, name, organization_id, revision, created_at, updated_at)
     VALUES ${values}`,
    )
    .bind(...bindings);
}

function rosterUpsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  eventId: string,
  actorId: string,
  now: string,
) {
  const values = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
  return db
    .prepare(
      `WITH incoming(
         entry_id, participant_id, expected_name, expected_organization_id,
         expected_revision, expected_organization_canonical,
         expected_organization_participant_count,
         expected_organization_revision_sum
       ) AS (VALUES ${values})
       INSERT INTO event_roster_entries
         (id, event_id, participant_id, organization_id, participant_name_snapshot,
          organization_name_snapshot, source, status, was_expected_at_day_of, revision,
          created_by, updated_by, created_at, updated_at)
       SELECT i.entry_id, ?, p.id,
              CASE WHEN p.name = i.expected_name
                         AND p.organization_id = i.expected_organization_id
                         AND p.revision = i.expected_revision
                         AND o.is_active = 1
                         AND o.canonical_name = i.expected_organization_canonical
                         AND (SELECT COUNT(*) FROM participants candidate
                              WHERE candidate.organization_id = i.expected_organization_id)
                             = i.expected_organization_participant_count
                         AND (SELECT COALESCE(SUM(candidate.revision), 0)
                              FROM participants candidate
                              WHERE candidate.organization_id = i.expected_organization_id)
                             = i.expected_organization_revision_sum
                   THEN p.organization_id ELSE NULL END,
              p.name, o.name,
              'PRE_EVENT', 'ACTIVE', 0, 0, ?, ?, ?, ?
       FROM incoming i JOIN participants p ON p.id = i.participant_id
       JOIN organizations o ON o.id = p.organization_id
       WHERE 1 = 1
       ON CONFLICT(event_id, participant_id) DO UPDATE SET
         status = CASE WHEN event_roster_entries.status = 'CANCELLED'
                       THEN 'ACTIVE' ELSE event_roster_entries.status END,
         updated_by = CASE WHEN event_roster_entries.status = 'CANCELLED'
                           THEN excluded.updated_by ELSE event_roster_entries.updated_by END,
         updated_at = CASE WHEN event_roster_entries.status = 'CANCELLED'
                           THEN excluded.updated_at ELSE event_roster_entries.updated_at END,
         revision = event_roster_entries.revision +
                    CASE WHEN event_roster_entries.status = 'CANCELLED' THEN 1 ELSE 0 END`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.entryId,
        row.participantId,
        row.expectedParticipantName,
        row.organizationId,
        row.participantRevision,
        row.organizationCanonicalName,
        row.organizationParticipantCountAfterInsert,
        row.organizationParticipantRevisionSum,
      ]),
      eventId,
      actorId,
      actorId,
      now,
      now,
    );
}

function importAuditInsert(
  db: D1Database,
  rows: ResolvedImportRow[],
  eventId: string,
  actorId: string,
  now: string,
) {
  const values = rows.map(() => "(?, ?)").join(",");
  return db
    .prepare(
      `WITH incoming(entry_id, details_json) AS (VALUES ${values})
     INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
     SELECT lower(hex(randomblob(16))), ?, 'ROSTER_IMPORTED', 'ROSTER_ENTRY',
            entry_id, ?, details_json
     FROM incoming`,
    )
    .bind(
      ...rows.flatMap((row) => [
        row.entryId,
        JSON.stringify({ eventId, organizationId: row.organizationId }),
      ]),
      actorId,
      now,
    );
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function canonical(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}
