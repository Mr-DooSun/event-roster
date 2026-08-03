ALTER TABLE organizations ADD COLUMN deleted_at TEXT;

ALTER TABLE organizations
ADD COLUMN deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX organizations_deleted_name
ON organizations(deleted_at, name, id);

CREATE TRIGGER organizations_deletion_state_insert
BEFORE INSERT ON organizations
WHEN (
  (NEW.deleted_at IS NULL AND NEW.deleted_by IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.is_active = 0)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ORGANIZATION_DELETION_STATE');
END;

CREATE TRIGGER organizations_deletion_state_update
BEFORE UPDATE OF is_active, deleted_at, deleted_by ON organizations
WHEN (
  (NEW.deleted_at IS NULL AND NEW.deleted_by IS NULL)
  OR
  (NEW.deleted_at IS NOT NULL
    AND NEW.deleted_by IS NOT NULL
    AND NEW.is_active = 0)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ORGANIZATION_DELETION_STATE');
END;
