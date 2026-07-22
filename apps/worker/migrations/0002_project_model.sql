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

CREATE TABLE project_roster_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  participant_name_snapshot TEXT NOT NULL,
  organization_name_snapshot TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('PRE_REGISTRATION', 'IN_PROGRESS')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
  was_expected_at_start INTEGER NOT NULL DEFAULT 0 CHECK (was_expected_at_start IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, participant_id)
);

INSERT INTO project_roster_entries
SELECT id, event_id, participant_id, organization_id,
  participant_name_snapshot, organization_name_snapshot,
  CASE source
    WHEN 'PRE_EVENT' THEN 'PRE_REGISTRATION'
    WHEN 'DAY_OF' THEN 'IN_PROGRESS'
  END,
  status, was_expected_at_day_of, revision, created_by, updated_by,
  created_at, updated_at
FROM event_roster_entries;

CREATE INDEX project_roster_entries_scope
ON project_roster_entries (project_id, organization_id, status);

CREATE TABLE project_import_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 130),
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO project_import_runs
SELECT id, event_id, actor_user_id, row_count, created_at, details_json
FROM import_runs;

DROP TRIGGER audit_logs_no_update;

UPDATE audit_logs SET
  entity_type = CASE WHEN entity_type = 'EVENT' THEN 'PROJECT' ELSE entity_type END,
  action = CASE
    WHEN action = 'EVENT_CREATED' THEN 'PROJECT_CREATED'
    WHEN action = 'EVENT_UPDATED' THEN 'PROJECT_UPDATED'
    WHEN action = 'EVENT_TRANSITIONED' THEN 'PROJECT_TRANSITIONED'
    WHEN action = 'EVENT_REOPENED' THEN 'PROJECT_REOPENED'
    ELSE action
  END,
  details_json = CASE WHEN json_valid(details_json) THEN
    CASE WHEN json_type(details_json, '$.eventId') = 'text' THEN
        json_set(
          json_remove(details_json, '$.eventId'),
          '$.projectId',
          json_extract(details_json, '$.eventId')
        )
      ELSE details_json
    END
  ELSE details_json
  END;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;

DROP TABLE import_runs;
DROP TABLE event_expected_snapshots;
DROP TABLE event_roster_entries;
DROP TABLE events;

PRAGMA foreign_key_check;
