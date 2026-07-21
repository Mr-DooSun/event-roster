import { env } from "cloudflare:workers";

export async function countRows(table: "audit_logs" | "security_events") {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>();

  return row?.count ?? 0;
}

export async function insertOrganization(
  id: string,
  name: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, canonical_name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  )
    .bind(id, name, name.toLocaleLowerCase(), "2026-07-21", "2026-07-21")
    .run();
}
