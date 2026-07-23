PRAGMA foreign_keys = ON;

ALTER TABLE user_organizations RENAME TO user_organizations_legacy;

CREATE TABLE user_organizations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL CHECK (assignment_role IN ('PRIMARY_LEADER', 'MANAGER')),
  assigned_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, organization_id)
);

INSERT INTO user_organizations
  (user_id, organization_id, assignment_role, assigned_by, assigned_at)
SELECT user_id, organization_id, 'MANAGER', NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM user_organizations_legacy;

DROP TABLE user_organizations_legacy;

CREATE UNIQUE INDEX user_organizations_one_primary
ON user_organizations (organization_id)
WHERE assignment_role = 'PRIMARY_LEADER';

CREATE INDEX user_organizations_by_organization
ON user_organizations (organization_id, assignment_role, assigned_at);

PRAGMA foreign_key_check;
