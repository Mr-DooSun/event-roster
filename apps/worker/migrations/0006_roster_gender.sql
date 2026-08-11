ALTER TABLE project_roster_entries ADD COLUMN gender_snapshot TEXT;

CREATE TRIGGER project_roster_entries_gender_insert
BEFORE INSERT ON project_roster_entries
WHEN NEW.gender_snapshot IS NOT NULL
  AND NEW.gender_snapshot NOT IN ('MALE', 'FEMALE')
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_GENDER');
END;

CREATE TRIGGER project_roster_entries_gender_update
BEFORE UPDATE OF gender_snapshot ON project_roster_entries
WHEN NEW.gender_snapshot IS NOT NULL
  AND NEW.gender_snapshot NOT IN ('MALE', 'FEMALE')
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_GENDER');
END;
