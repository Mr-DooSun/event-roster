CREATE TABLE probe_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE probe_participants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  participant_number TEXT NOT NULL,
  UNIQUE(run_id, participant_number)
);
CREATE TABLE probe_roster_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  participant_number TEXT NOT NULL,
  UNIQUE(run_id, participant_number)
);
CREATE TABLE probe_audit_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id),
  action TEXT NOT NULL
);
CREATE TABLE probe_import_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL
);
CREATE TABLE probe_users (
  id TEXT PRIMARY KEY,
  session_version INTEGER NOT NULL
);
CREATE TABLE probe_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES probe_users(id),
  session_version INTEGER NOT NULL,
  revoked_at TEXT
);
