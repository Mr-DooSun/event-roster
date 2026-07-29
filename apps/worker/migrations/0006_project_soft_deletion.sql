ALTER TABLE projects ADD COLUMN deleted_at TEXT;

ALTER TABLE projects
ADD COLUMN deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE projects
ADD COLUMN deleted_revision INTEGER
CHECK (deleted_revision IS NULL OR deleted_revision >= 0);

CREATE INDEX projects_deleted_status_order
ON projects(deleted_at, status, start_date, created_at, closed_at);

CREATE TRIGGER projects_deletion_state_insert
BEFORE INSERT ON projects
WHEN (
  (NEW.deleted_at IS NULL
    AND NEW.deleted_by IS NULL
    AND NEW.deleted_revision IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.deleted_revision = NEW.revision
    AND NEW.status = 'CLOSED')
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PROJECT_DELETION_STATE');
END;

CREATE TRIGGER projects_deletion_state_update
BEFORE UPDATE OF deleted_at, deleted_by, deleted_revision, revision, status
ON projects
WHEN (
  (NEW.deleted_at IS NULL
    AND NEW.deleted_by IS NULL
    AND NEW.deleted_revision IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.deleted_revision = NEW.revision
    AND NEW.status = 'CLOSED')
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PROJECT_DELETION_STATE');
END;
