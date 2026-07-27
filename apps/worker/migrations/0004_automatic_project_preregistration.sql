PRAGMA foreign_keys = ON;

INSERT INTO audit_logs
  (id, actor_user_id, action, entity_type, entity_id, occurred_at, details_json)
SELECT
  'migration-0004-auto-preregistration:' || id,
  NULL,
  'PROJECT_AUTO_PREREGISTERED',
  'PROJECT',
  id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  json_object(
    'fromStatus', 'PREPARING',
    'toStatus', 'PRE_REGISTRATION'
  )
FROM projects
WHERE status = 'PREPARING';

UPDATE projects
SET status = 'PRE_REGISTRATION',
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'PREPARING';

CREATE TRIGGER IF NOT EXISTS projects_no_preparing_insert
BEFORE INSERT ON projects
WHEN NEW.status = 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'PREPARING_STATUS_DISABLED');
END;

CREATE TRIGGER IF NOT EXISTS projects_no_preparing_update
BEFORE UPDATE ON projects
WHEN NEW.status = 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'PREPARING_STATUS_DISABLED');
END;

PRAGMA foreign_key_check;
