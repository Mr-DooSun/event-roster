import { DomainError, toKstDate } from "@event-roster/domain";
import { runGuardedAtomic } from "../db/atomic";
import type { Env } from "../env";

export async function closeExpiredProject(
  env: Env,
  projectId: string,
  now = new Date(),
): Promise<boolean> {
  const today = toKstDate(now);
  const project = await env.DB.prepare(
    `SELECT revision FROM projects
     WHERE id = ? AND status <> 'CLOSED'
       AND end_date IS NOT NULL AND end_date < ?`,
  )
    .bind(projectId, today)
    .first<{ revision: number }>();
  if (!project) return false;

  const guardId = crypto.randomUUID();
  const timestamp = now.toISOString();
  try {
    await runGuardedAtomic(env.DB, {
      guardId,
      guardStatement: env.DB.prepare(
        `INSERT INTO operation_guards (id, ok)
           VALUES (?, CASE WHEN EXISTS (
             SELECT 1 FROM projects
             WHERE id = ? AND revision = ? AND status <> 'CLOSED'
               AND end_date IS NOT NULL AND end_date < ?
           ) THEN 1 ELSE 0 END)`,
      ).bind(guardId, projectId, project.revision, today),
      statements: [
        env.DB.prepare(
          `UPDATE projects
           SET status = 'CLOSED', revision = revision + 1,
               closed_at = ?, closed_by = NULL, close_reason = 'SCHEDULED',
               updated_at = ?
           WHERE id = ?`,
        ).bind(timestamp, timestamp, projectId),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
           VALUES (?, NULL, 'PROJECT_AUTO_CLOSED', 'PROJECT', ?, ?, '{}')`,
        ).bind(crypto.randomUUID(), projectId, timestamp),
      ],
      failureCode: "CONFLICT",
    });
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "CONFLICT") return false;
    throw error;
  }
}

export async function closeExpiredProjects(
  env: Env,
  now = new Date(),
  limit = 50,
): Promise<number> {
  const cappedLimit = Math.max(0, Math.min(Math.trunc(limit), 50));
  if (cappedLimit === 0) return 0;

  const rows = (
    await env.DB.prepare(
      `SELECT id FROM projects
       WHERE status <> 'CLOSED' AND end_date IS NOT NULL AND end_date < ?
       ORDER BY created_at, id
       LIMIT ?`,
    )
      .bind(toKstDate(now), cappedLimit)
      .all<{ id: string }>()
  ).results;

  let closed = 0;
  for (const row of rows) {
    if (await closeExpiredProject(env, row.id, now)) closed += 1;
  }
  return closed;
}
