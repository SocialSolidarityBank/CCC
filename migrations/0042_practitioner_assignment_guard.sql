-- Migration 0042 - D74 practitioner role required for case assignment.
--
-- An active case assignment is counseling authority, not an administrator
-- shortcut. Existing active assignees are backfilled as practitioners before
-- the insert guard is tightened so deployed assignments keep working.

INSERT INTO user_role_assignments (
  id, org_id, user_id, role, source, granted_by, granted_at
)
SELECT
  'assignment-practitioner:' || assignment.org_id || ':' || assignment.user_id,
  assignment.org_id,
  assignment.user_id,
  'practitioner',
  'legacy',
  NULL,
  MIN(assignment.assigned_at)
FROM support_case_assignees AS assignment
JOIN users AS user
  ON user.id = assignment.user_id
 AND user.org_id = assignment.org_id
 AND user.active = 1
WHERE assignment.unassigned_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS practitioner_role
    WHERE practitioner_role.org_id = assignment.org_id
      AND practitioner_role.user_id = assignment.user_id
      AND practitioner_role.role = 'practitioner'
      AND practitioner_role.revoked_at IS NULL
  )
GROUP BY assignment.org_id, assignment.user_id;

DROP TRIGGER support_case_assignees_insert_guard;

CREATE TRIGGER support_case_assignees_insert_guard
BEFORE INSERT ON support_case_assignees
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users
    JOIN user_role_assignments AS practitioner_role
      ON practitioner_role.user_id = users.id
     AND practitioner_role.org_id = users.org_id
     AND practitioner_role.role = 'practitioner'
     AND practitioner_role.revoked_at IS NULL
    WHERE users.id = NEW.user_id
      AND users.org_id = NEW.org_id
      AND users.active = 1
      AND users.role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND creation_kind = 'subsequent'
  )
    AND NOT EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
    )
    AND (
      NEW.role <> 'primary'
      OR NEW.user_id <> (
        SELECT initial_assignee_user_id
        FROM support_cases
        WHERE id = NEW.support_case_id
      )
    );
END;
