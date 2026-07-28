ALTER TABLE project_roster_entries
ADD COLUMN participant_role_snapshot TEXT;

ALTER TABLE project_roster_entries
ADD COLUMN student_grade_snapshot TEXT;

CREATE TRIGGER project_roster_entries_profile_insert
BEFORE INSERT ON project_roster_entries
WHEN (
  (NEW.participant_role_snapshot IS NULL
    AND NEW.student_grade_snapshot IS NULL)
  OR
  (NEW.participant_role_snapshot = 'STUDENT'
    AND NEW.student_grade_snapshot IN ('M1', 'M2', 'M3', 'H1', 'H2', 'H3'))
  OR
  (NEW.participant_role_snapshot = 'TEACHER'
    AND NEW.student_grade_snapshot IS NULL)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_PROFILE');
END;

CREATE TRIGGER project_roster_entries_profile_update
BEFORE UPDATE OF participant_role_snapshot, student_grade_snapshot
ON project_roster_entries
WHEN (
  (NEW.participant_role_snapshot IS NULL
    AND NEW.student_grade_snapshot IS NULL)
  OR
  (NEW.participant_role_snapshot = 'STUDENT'
    AND NEW.student_grade_snapshot IN ('M1', 'M2', 'M3', 'H1', 'H2', 'H3'))
  OR
  (NEW.participant_role_snapshot = 'TEACHER'
    AND NEW.student_grade_snapshot IS NULL)
) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ROSTER_PROFILE');
END;
