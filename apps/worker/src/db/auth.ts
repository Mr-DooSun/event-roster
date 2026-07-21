import type { Role, SessionKind } from "@event-roster/contracts";

export interface AuthUserRecord {
  id: string;
  loginId: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  isBootstrap: boolean;
  sessionVersion: number;
  passwordHash: string;
  mustChangePassword: boolean;
  organizationIds: string[];
}

export interface SessionRecord {
  id: string;
  userId: string;
  sessionVersion: number;
  kind: SessionKind;
  csrfHash: string;
  expiresAt: string;
  revokedAt: string | null;
  user: AuthUserRecord;
}

export interface RefreshRecord {
  id: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  session: SessionRecord;
}

interface UserRow {
  id: string;
  login_id: string;
  display_name: string;
  role: Role;
  is_active: number;
  is_bootstrap: number;
  session_version: number;
  password_hash: string;
  must_change_password: number;
}

export async function findUserByLoginId(
  db: D1Database,
  canonicalLoginId: string,
): Promise<AuthUserRecord | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.login_id, u.display_name, u.role, u.is_active,
              u.is_bootstrap, u.session_version, p.password_hash,
              p.must_change_password
       FROM users u
       JOIN password_credentials p ON p.user_id = u.id
       WHERE u.login_id_canonical = ?`,
    )
    .bind(canonicalLoginId)
    .first<UserRow>();

  return row ? mapUser(db, row) : null;
}

export async function findUserById(
  db: D1Database,
  userId: string,
): Promise<AuthUserRecord | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.login_id, u.display_name, u.role, u.is_active,
              u.is_bootstrap, u.session_version, p.password_hash,
              p.must_change_password
       FROM users u
       JOIN password_credentials p ON p.user_id = u.id
       WHERE u.id = ?`,
    )
    .bind(userId)
    .first<UserRow>();

  return row ? mapUser(db, row) : null;
}

export async function findSessionById(
  db: D1Database,
  sessionId: string,
): Promise<SessionRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, session_version, kind, csrf_hash, expires_at, revoked_at
       FROM auth_sessions WHERE id = ?`,
    )
    .bind(sessionId)
    .first<{
      id: string;
      user_id: string;
      session_version: number;
      kind: SessionKind;
      csrf_hash: string;
      expires_at: string;
      revoked_at: string | null;
    }>();
  if (!row) return null;
  const user = await findUserById(db, row.user_id);
  if (!user) return null;

  return {
    id: row.id,
    userId: row.user_id,
    sessionVersion: row.session_version,
    kind: row.kind,
    csrfHash: row.csrf_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    user,
  };
}

export async function findRefreshByHash(
  db: D1Database,
  tokenHash: string,
): Promise<RefreshRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, session_id, token_hash, expires_at, rotated_at, revoked_at
       FROM refresh_tokens WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      session_id: string;
      token_hash: string;
      expires_at: string;
      rotated_at: string | null;
      revoked_at: string | null;
    }>();
  if (!row) return null;
  const session = await findSessionById(db, row.session_id);
  if (!session) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    rotatedAt: row.rotated_at,
    revokedAt: row.revoked_at,
    session,
  };
}

export async function revokeSessionFamily(
  db: D1Database,
  sessionId: string,
  now: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?",
      )
      .bind(now, sessionId),
    db
      .prepare(
        "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE session_id = ?",
      )
      .bind(now, sessionId),
  ]);
}

export async function revokeUserSessions(
  db: D1Database,
  userId: string,
  now: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?",
      )
      .bind(now, userId),
    db
      .prepare(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
         WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id = ?)`,
      )
      .bind(now, userId),
  ]);
}

async function mapUser(db: D1Database, row: UserRow): Promise<AuthUserRecord> {
  const organizations = await db
    .prepare(
      "SELECT organization_id FROM user_organizations WHERE user_id = ? ORDER BY organization_id",
    )
    .bind(row.id)
    .all<{ organization_id: string }>();

  return {
    id: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active === 1,
    isBootstrap: row.is_bootstrap === 1,
    sessionVersion: row.session_version,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password === 1,
    organizationIds: organizations.results.map((item) => item.organization_id),
  };
}
