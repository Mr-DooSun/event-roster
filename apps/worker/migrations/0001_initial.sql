PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL,
  login_id_canonical TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OPERATOR', 'ORGANIZATION_MANAGER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_bootstrap INTEGER NOT NULL DEFAULT 0 CHECK (is_bootstrap IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX users_single_bootstrap
ON users (is_bootstrap)
WHERE is_bootstrap = 1;

CREATE TABLE user_organizations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_version INTEGER NOT NULL CHECK (session_version >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('FULL', 'MUST_CHANGE_PASSWORD')),
  csrf_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  replaced_by_id TEXT REFERENCES refresh_tokens(id) ON DELETE RESTRICT
);

CREATE INDEX refresh_tokens_session_id ON refresh_tokens (session_id);

CREATE TABLE login_attempts (
  key_hash TEXT NOT NULL,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('LOGIN_ID', 'IP')),
  window_started_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, key_kind)
);

CREATE TABLE security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  session_id TEXT REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE bootstrap_locks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bootstrap_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consumed_at TEXT
);

CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX recovery_codes_user_id ON recovery_codes (user_id);

CREATE TABLE operation_guards (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER operation_guards_abort_invalid
BEFORE INSERT ON operation_guards
WHEN NEW.ok <> 1
BEGIN
  SELECT RAISE(ABORT, 'GUARD_FAILED');
END;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX participants_organization_id ON participants (organization_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  half TEXT NOT NULL CHECK (half IN ('H1', 'H2')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PRE_REGISTRATION', 'DAY_OF', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (year, half)
);

CREATE TABLE event_roster_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('PRE_EVENT', 'DAY_OF')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, participant_id)
);

CREATE INDEX event_roster_entries_event_id
ON event_roster_entries (event_id, organization_id, status);

CREATE TABLE event_expected_snapshots (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (event_id, organization_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 130),
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;

CREATE TRIGGER security_events_no_update
BEFORE UPDATE ON security_events
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;

CREATE TRIGGER security_events_no_delete
BEFORE DELETE ON security_events
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;
