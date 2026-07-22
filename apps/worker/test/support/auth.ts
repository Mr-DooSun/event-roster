import { env, exports } from "cloudflare:workers";
import type { AuthSuccess } from "@event-roster/contracts";
import { BcryptPasswordHasher } from "../../src/auth/password";

const hasher = new BcryptPasswordHasher();

export interface LoginResult {
  response: Response;
  body: AuthSuccess;
  cookie: string;
}

export async function seedUser(
  input: {
    id?: string;
    loginId?: string;
    password?: string;
    mustChange?: boolean;
    isBootstrap?: boolean;
  } = {},
): Promise<void> {
  const id = input.id ?? "user-1";
  const loginId = input.loginId ?? "manager-01";
  const password = input.password ?? "password-1234";
  const now = "2026-07-21T00:00:00.000Z";
  const passwordHash = await hasher.hash(password);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, login_id, login_id_canonical, display_name, role, is_active, is_bootstrap, session_version, created_at, updated_at) VALUES (?, ?, ?, '운영자', 'OPERATOR', 1, ?, 1, ?, ?)",
    ).bind(
      id,
      loginId,
      loginId.toLocaleLowerCase(),
      input.isBootstrap ? 1 : 0,
      now,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO password_credentials (user_id, password_hash, must_change_password, changed_at) VALUES (?, ?, ?, ?)",
    ).bind(id, passwordHash, input.mustChange ? 1 : 0, now),
  ]);
}

export function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", headers.get("Origin") ?? "https://event-roster.test");
  headers.set("CF-Connecting-IP", "203.0.113.7");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return exports.default.fetch(`https://event-roster.test${path}`, {
    ...init,
    headers,
  });
}

export async function login(
  loginId = "manager-01",
  password = "password-1234",
): Promise<LoginResult> {
  const response = await apiRequest("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ loginId, password }),
  });
  const body = await response.clone().json<AuthSuccess>();
  const cookie = response.headers.get("Set-Cookie") ?? "";

  return { response, body, cookie };
}

export function cookieHeader(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

export function authenticatedHeaders(
  auth: Pick<LoginResult, "body">,
): HeadersInit {
  return {
    Authorization: `Bearer ${auth.body.accessToken}`,
    "X-ER-CSRF": auth.body.csrfToken,
  };
}

export async function resetAuthState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER IF EXISTS audit_logs_no_update"),
    env.DB.prepare("DROP TRIGGER IF EXISTS audit_logs_no_delete"),
    env.DB.prepare("DROP TRIGGER IF EXISTS security_events_no_update"),
    env.DB.prepare("DROP TRIGGER IF EXISTS security_events_no_delete"),
    env.DB.prepare("DELETE FROM project_import_runs"),
    env.DB.prepare("DELETE FROM audit_logs"),
    env.DB.prepare("DELETE FROM security_events"),
    env.DB.prepare("DELETE FROM project_expected_snapshots"),
    env.DB.prepare("DELETE FROM project_roster_entries"),
    env.DB.prepare("DELETE FROM project_organizations"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM participants"),
    env.DB.prepare("DELETE FROM refresh_tokens"),
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM recovery_codes"),
    env.DB.prepare("DELETE FROM bootstrap_locks"),
    env.DB.prepare("DELETE FROM login_attempts"),
    env.DB.prepare("DELETE FROM password_credentials"),
    env.DB.prepare("DELETE FROM user_organizations"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM organizations"),
    env.DB.prepare(
      `CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
       BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END`,
    ),
    env.DB.prepare(
      `CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
       BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END`,
    ),
    env.DB.prepare(
      `CREATE TRIGGER security_events_no_update BEFORE UPDATE ON security_events
       BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END`,
    ),
    env.DB.prepare(
      `CREATE TRIGGER security_events_no_delete BEFORE DELETE ON security_events
       BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END`,
    ),
  ]);
}
