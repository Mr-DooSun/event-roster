PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  start_date TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('PREPARING', 'PRE_REGISTRATION', 'IN_PROGRESS', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('MANUAL', 'SCHEDULED')),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK ((status = 'CLOSED') = (close_reason IS NOT NULL))
);

INSERT INTO projects
  (id, name, start_date, end_date, status, revision, created_by, created_at, updated_at, closed_at, closed_by, close_reason)
SELECT id, name, NULL, NULL,
  CASE status
    WHEN 'DRAFT' THEN 'PREPARING'
    WHEN 'PRE_REGISTRATION' THEN 'PRE_REGISTRATION'
    WHEN 'DAY_OF' THEN 'IN_PROGRESS'
    WHEN 'CLOSED' THEN 'CLOSED'
  END,
  revision, created_by, created_at, updated_at,
  CASE WHEN status = 'CLOSED' THEN updated_at END,
  CASE WHEN status = 'CLOSED' THEN created_by END,
  CASE WHEN status = 'CLOSED' THEN 'MANUAL' END
FROM events;

CREATE INDEX projects_status_dates ON projects (status, end_date, start_date, created_at);

CREATE TABLE project_organizations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  added_at TEXT NOT NULL,
  deactivated_at TEXT,
  added_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (project_id, organization_id)
);

INSERT INTO project_organizations
  (project_id, organization_id, is_active, added_at, deactivated_at, added_by, updated_by)
SELECT e.id, referenced.organization_id, 1, e.created_at, NULL, e.created_by, e.created_by
FROM events e
JOIN (
  SELECT event_id, organization_id FROM event_roster_entries
  UNION
  SELECT event_id, organization_id FROM event_expected_snapshots
) referenced ON referenced.event_id = e.id;

CREATE TABLE project_expected_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (project_id, organization_id)
);

INSERT INTO project_expected_snapshots
SELECT event_id, organization_id, expected_count, captured_at
FROM event_expected_snapshots;
