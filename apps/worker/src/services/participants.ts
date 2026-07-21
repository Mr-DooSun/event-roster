import { DomainError } from "@event-roster/domain";
import { findOrganization } from "../db/admin";
import { runGuardedAtomic } from "../db/atomic";
import type { Env } from "../env";
import type { Actor } from "../middleware/authentication";

interface ParticipantRecord {
  id: string;
  participantId: string;
  name: string;
  organizationId: string;
  revision: number;
}

export async function getParticipants(env: Env, actor: Actor) {
  const manager = actor.session.user.role === "ORGANIZATION_MANAGER";
  if (manager && actor.session.user.organizationIds.length === 0) return [];
  const sql = manager
    ? `SELECT id, participant_id, name, organization_id, revision FROM participants
       WHERE organization_id IN (${actor.session.user.organizationIds.map(() => "?").join(",")})
       ORDER BY name`
    : "SELECT id, participant_id, name, organization_id, revision FROM participants ORDER BY name";
  const rows = (
    await env.DB.prepare(sql)
      .bind(...(manager ? actor.session.user.organizationIds : []))
      .all<{
        id: string;
        participant_id: string;
        name: string;
        organization_id: string;
        revision: number;
      }>()
  ).results;
  return rows.map(mapParticipant);
}

export async function createParticipant(
  env: Env,
  actor: Actor,
  input: { name: string; organizationId: string },
) {
  assertActorScope(actor, input.organizationId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = crypto.randomUUID();
    const participantId = `P-${crypto.randomUUID().toUpperCase()}`;
    const now = new Date().toISOString();
    const guardId = crypto.randomUUID();
    try {
      await runGuardedAtomic(env.DB, {
        guardId,
        guardStatement: participantGuard(
          env.DB,
          guardId,
          actor,
          input.organizationId,
          `EXISTS (
             SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
           )`,
          [input.organizationId],
        ),
        statements: [
          env.DB.prepare(
            `INSERT INTO participants
           (id, participant_id, name, organization_id, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          ).bind(id, participantId, input.name, input.organizationId, now, now),
          env.DB.prepare(
            `INSERT INTO audit_logs
           (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
           VALUES (?, ?, 'PARTICIPANT_CREATED', 'PARTICIPANT', ?, ?, '{}')`,
          ).bind(crypto.randomUUID(), actor.session.user.id, id, now),
        ],
        failureCode: "CONFLICT",
      });
      return { id, participantId, ...input, revision: 0 };
    } catch (error) {
      if (!isConstraint(error) || attempt === 1) throw error;
    }
  }
  throw new DomainError("CONFLICT");
}

export async function updateParticipant(
  env: Env,
  actor: Actor,
  id: string,
  input: {
    name?: string | undefined;
    organizationId?: string | undefined;
    expectedRevision: number;
  },
) {
  const current = await findParticipant(env.DB, id);
  if (!current) throw new DomainError("NOT_FOUND");
  assertActorScope(actor, current.organizationId);
  const nextOrganization = input.organizationId ?? current.organizationId;
  if (
    nextOrganization !== current.organizationId &&
    (await isOnDayOfRoster(env.DB, current.id))
  ) {
    throw new DomainError("CONFLICT");
  }
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    nextOrganization !== current.organizationId
  ) {
    throw new DomainError("FORBIDDEN");
  }
  const organization = await findOrganization(env.DB, nextOrganization);
  if (!organization?.isActive) throw new DomainError("CONFLICT");
  const now = new Date().toISOString();
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE participants SET name = ?, organization_id = ?,
       revision = revision + 1, updated_at = ? WHERE id = ?`,
    ).bind(input.name ?? current.name, nextOrganization, now, id),
    env.DB.prepare(
      `UPDATE event_roster_entries
       SET participant_name_snapshot = ?, updated_at = ?, revision = revision + 1
       WHERE participant_id = ? AND event_id IN (
         SELECT id FROM events WHERE status IN ('PRE_REGISTRATION', 'DAY_OF')
       )`,
    ).bind(input.name ?? current.name, now, id),
  ];
  if (nextOrganization !== current.organizationId) {
    statements.push(
      env.DB.prepare(
        `UPDATE event_roster_entries
         SET organization_id = ?, organization_name_snapshot = ?,
             updated_at = ?
         WHERE participant_id = ? AND event_id IN (
           SELECT id FROM events WHERE status = 'PRE_REGISTRATION'
         )`,
      ).bind(nextOrganization, organization.name, now, id),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE events SET revision = revision + 1, updated_at = ?
       WHERE status IN ('PRE_REGISTRATION', 'DAY_OF') AND id IN (
         SELECT event_id FROM event_roster_entries WHERE participant_id = ?
       )`,
    ).bind(now, id),
    env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
       VALUES (?, ?, 'PARTICIPANT_UPDATED', 'PARTICIPANT', ?, ?, '{}')`,
    ).bind(crypto.randomUUID(), actor.session.user.id, id, now),
  );
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: participantGuard(
        env.DB,
        guardId,
        actor,
        current.organizationId,
        `EXISTS (
           SELECT 1 FROM participants WHERE id = ? AND revision = ?
         ) AND EXISTS (
           SELECT 1 FROM organizations WHERE id = ? AND is_active = 1
         ) AND (? = ? OR NOT EXISTS (
           SELECT 1 FROM event_roster_entries r
           JOIN events e ON e.id = r.event_id
           WHERE r.participant_id = ? AND e.status = 'DAY_OF'
         ))`,
        [
          id,
          input.expectedRevision,
          nextOrganization,
          current.organizationId,
          nextOrganization,
          id,
        ],
      ),
      statements,
      failureCode: "STALE_REVISION",
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "STALE_REVISION") {
      throw await classifyParticipantGuardFailure(
        env.DB,
        actor,
        id,
        current.organizationId,
        nextOrganization,
        input.expectedRevision,
      );
    }
    throw error;
  }
  return {
    ...current,
    name: input.name ?? current.name,
    organizationId: nextOrganization,
    revision: input.expectedRevision + 1,
  };
}

async function findParticipant(db: D1Database, id: string) {
  const row = await db
    .prepare(
      "SELECT id, participant_id, name, organization_id, revision FROM participants WHERE id = ?",
    )
    .bind(id)
    .first<{
      id: string;
      participant_id: string;
      name: string;
      organization_id: string;
      revision: number;
    }>();
  return row ? mapParticipant(row) : null;
}

async function isOnDayOfRoster(db: D1Database, participantId: string) {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM event_roster_entries r
       JOIN events e ON e.id = r.event_id
       WHERE r.participant_id = ? AND e.status = 'DAY_OF' LIMIT 1`,
    )
    .bind(participantId)
    .first<{ found: number }>();
  return row?.found === 1;
}

function participantGuard(
  db: D1Database,
  guardId: string,
  actor: Actor,
  organizationId: string,
  operationPredicate: string,
  operationBindings: Array<string | number>,
) {
  return db
    .prepare(
      `INSERT INTO operation_guards (id, ok)
       VALUES (?, CASE WHEN EXISTS (
         SELECT 1 FROM users u
         JOIN auth_sessions s ON s.user_id = u.id
         WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL
           AND u.is_active = 1 AND s.kind = 'FULL'
           AND u.session_version = ? AND s.session_version = ?
           AND (
             u.role = 'OPERATOR' OR EXISTS (
               SELECT 1 FROM user_organizations uo
               WHERE uo.user_id = u.id AND uo.organization_id = ?
             )
           )
       ) AND (${operationPredicate}) THEN 1 ELSE 0 END)`,
    )
    .bind(
      guardId,
      actor.session.user.id,
      actor.session.id,
      actor.claims.sv,
      actor.claims.sv,
      organizationId,
      ...operationBindings,
    );
}

async function classifyParticipantGuardFailure(
  db: D1Database,
  actor: Actor,
  participantId: string,
  currentOrganizationId: string,
  nextOrganizationId: string,
  expectedRevision: number,
): Promise<DomainError> {
  const currentActor = await db
    .prepare(
      `SELECT u.role, u.is_active, u.session_version AS user_version,
              s.session_version, s.kind, s.revoked_at
       FROM users u JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ? AND s.id = ?`,
    )
    .bind(actor.session.user.id, actor.session.id)
    .first<{
      role: "OPERATOR" | "ORGANIZATION_MANAGER";
      is_active: number;
      user_version: number;
      session_version: number;
      kind: "FULL" | "MUST_CHANGE_PASSWORD";
      revoked_at: string | null;
    }>();
  if (
    currentActor?.is_active !== 1 ||
    currentActor.revoked_at ||
    currentActor.kind !== "FULL" ||
    currentActor.user_version !== actor.claims.sv ||
    currentActor.session_version !== actor.claims.sv
  ) {
    return new DomainError("AUTHENTICATION_REQUIRED");
  }
  if (currentActor.role === "ORGANIZATION_MANAGER") {
    const linked = await db
      .prepare(
        `SELECT 1 AS found FROM user_organizations
         WHERE user_id = ? AND organization_id = ?`,
      )
      .bind(actor.session.user.id, currentOrganizationId)
      .first<{ found: number }>();
    if (!linked) return new DomainError("FORBIDDEN");
  }
  const organization = await findOrganization(db, nextOrganizationId);
  if (!organization?.isActive) return new DomainError("CONFLICT");
  const participant = await findParticipant(db, participantId);
  if (!participant) return new DomainError("NOT_FOUND");
  if (participant.revision !== expectedRevision) {
    return new DomainError("STALE_REVISION");
  }
  if (
    nextOrganizationId !== currentOrganizationId &&
    (await isOnDayOfRoster(db, participantId))
  ) {
    return new DomainError("CONFLICT");
  }
  return new DomainError("CONFLICT");
}

function assertActorScope(actor: Actor, organizationId: string) {
  if (
    actor.session.user.role === "ORGANIZATION_MANAGER" &&
    !actor.session.user.organizationIds.includes(organizationId)
  ) {
    throw new DomainError("FORBIDDEN");
  }
}

function mapParticipant(row: {
  id: string;
  participant_id: string;
  name: string;
  organization_id: string;
  revision: number;
}): ParticipantRecord {
  return {
    id: row.id,
    participantId: row.participant_id,
    name: row.name,
    organizationId: row.organization_id,
    revision: row.revision,
  };
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("SQLITE_CONSTRAINT");
}
