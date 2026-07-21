import type { EventStatus, Half } from "@event-roster/contracts";
import {
  transitionEvent as assertTransition,
  DomainError,
} from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import { findEvent, listEvents } from "../db/events";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";
import { createOperatorGuard } from "./admin";

export async function getEvents(env: Env) {
  return listEvents(env.DB);
}

export async function createEvent(
  env: Env,
  actor: Actor,
  input: { year: number; half: Half; name: string },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: createOperatorGuard(
        env.DB,
        guardId,
        actor,
        "NOT EXISTS (SELECT 1 FROM events WHERE year = ? AND half = ?)",
        [input.year, input.half],
      ),
      statements: [
        env.DB.prepare(
          `INSERT INTO events
           (id, year, half, name, status, revision, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'DRAFT', 0, ?, ?, ?)`,
        ).bind(
          id,
          input.year,
          input.half,
          input.name,
          actor.session.user.id,
          now,
          now,
        ),
        auditStatement(env.DB, actor.session.user.id, "EVENT_CREATED", id, now),
      ],
      failureCode: "CONFLICT",
    });
  } catch (error) {
    if (isConstraint(error)) throw new DomainError("CONFLICT");
    throw error;
  }
  return { id, ...input, status: "DRAFT" as const, revision: 0 };
}

export async function updateEvent(
  env: Env,
  actor: Actor,
  id: string,
  input: { name: string; expectedRevision: number },
) {
  const current = await findEvent(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  if (current.status !== "DRAFT" && current.status !== "PRE_REGISTRATION") {
    throw new DomainError("INVALID_TRANSITION");
  }
  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM events WHERE id = ? AND revision = ?
           AND status IN ('DRAFT', 'PRE_REGISTRATION')
       )`,
      [id, input.expectedRevision],
    ),
    statements: [
      env.DB.prepare(
        "UPDATE events SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).bind(input.name, now, id),
      auditStatement(env.DB, actor.session.user.id, "EVENT_UPDATED", id, now),
    ],
    failureCode: "STALE_REVISION",
  });
  return { ...current, name: input.name, revision: input.expectedRevision + 1 };
}

export async function changeEventStatus(
  env: Env,
  actor: Actor,
  id: string,
  targetStatus: EventStatus,
  expectedRevision: number,
) {
  const current = await findEvent(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  assertTransition(current.status, targetStatus, actor.session.user.role);
  if (current.revision !== expectedRevision)
    throw new DomainError("STALE_REVISION");

  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE events SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
    ).bind(targetStatus, now, id),
  ];
  if (current.status === "PRE_REGISTRATION" && targetStatus === "DAY_OF") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO event_expected_snapshots
         (event_id, organization_id, expected_count, captured_at)
         SELECT ?, o.id, COUNT(r.id), ?
         FROM organizations o
         LEFT JOIN event_roster_entries r
           ON r.event_id = ? AND r.organization_id = o.id
          AND r.source = 'PRE_EVENT' AND r.status = 'ACTIVE'
         WHERE o.is_active = 1 OR EXISTS (
           SELECT 1 FROM event_roster_entries existing
           WHERE existing.event_id = ? AND existing.organization_id = o.id
             AND existing.source = 'PRE_EVENT' AND existing.status = 'ACTIVE'
         )
         GROUP BY o.id
         ON CONFLICT(event_id, organization_id) DO NOTHING`,
      ).bind(id, now, id, id),
      env.DB.prepare(
        `UPDATE event_roster_entries SET was_expected_at_day_of = 1
         WHERE event_id = ? AND source = 'PRE_EVENT' AND status = 'ACTIVE'`,
      ).bind(id),
    );
  }
  statements.push(
    auditStatement(
      env.DB,
      actor.session.user.id,
      current.status === "CLOSED" ? "EVENT_REOPENED" : "EVENT_TRANSITIONED",
      id,
      now,
    ),
  );
  await runGuardedAtomic(env.DB, {
    guardId,
    guardStatement: createOperatorGuard(
      env.DB,
      guardId,
      actor,
      `EXISTS (
         SELECT 1 FROM events WHERE id = ? AND status = ? AND revision = ?
       )`,
      [id, current.status, expectedRevision],
    ),
    statements,
    failureCode: "STALE_REVISION",
  });
  return { ...current, status: targetStatus, revision: expectedRevision + 1 };
}

function auditStatement(
  db: D1Database,
  actorId: string,
  action: string,
  eventId: string,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_logs
     (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
     VALUES (?, ?, ?, 'EVENT', ?, ?, '{}')`,
    )
    .bind(crypto.randomUUID(), actorId, action, eventId, now);
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SQLITE_CONSTRAINT");
}
