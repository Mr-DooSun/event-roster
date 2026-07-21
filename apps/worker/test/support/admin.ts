import { env } from "cloudflare:workers";
import type { LoginResult } from "./auth";
import { apiRequest, authenticatedHeaders, login, seedUser } from "./auth";

export async function seedOrganization(
  id = "org-1",
  name = "1팀",
  isActive = true,
): Promise<void> {
  const now = "2026-07-21T00:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO organizations
       (id, name, canonical_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      name,
      name.normalize("NFKC").toLocaleLowerCase(),
      isActive ? 1 : 0,
      now,
      now,
    )
    .run();
}

export async function seedOperator(): Promise<LoginResult> {
  await seedUser();
  return login();
}

export async function seedManager(
  organizationId = "org-1",
): Promise<LoginResult> {
  await seedUser({
    id: "manager-user",
    loginId: "manager-02",
    password: "manager-password-123",
  });
  await env.DB.prepare(
    "UPDATE users SET role = 'ORGANIZATION_MANAGER' WHERE id = 'manager-user'",
  ).run();
  await env.DB.prepare(
    "INSERT INTO user_organizations (user_id, organization_id) VALUES ('manager-user', ?)",
  )
    .bind(organizationId)
    .run();
  return login("manager-02", "manager-password-123");
}

export function authedRequest(
  auth: LoginResult,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return apiRequest(path, {
    ...init,
    headers: { ...authenticatedHeaders(auth), ...init.headers },
  });
}
