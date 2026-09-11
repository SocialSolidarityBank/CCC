-- Initial canonical registrations no longer set legacy_case_id. Match the
-- gateway's existing COALESCE identity without exposing subsequent cases.
DROP VIEW case_assignees;
DROP VIEW cases;

CREATE VIEW case_assignees AS
SELECT assignment.id, assignment.org_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  assignment.user_id, assignment.role, assignment.assigned_at, assignment.unassigned_at
FROM support_case_assignees AS assignment
JOIN support_cases AS support_case
  ON support_case.id = assignment.support_case_id AND support_case.org_id = assignment.org_id
WHERE (support_case.legacy_case_id IS NOT NULL OR support_case.creation_kind = 'initial')
  AND assignment.status = 'active';

CREATE VIEW cases AS
SELECT COALESCE(support_case.legacy_case_id, support_case.id) AS id,
  support_case.org_id, support_case.program_type, support_case.status,
  support_case.intake_at, support_case.consent_recording_at, support_case.consent_text_ai_at,
  support_case.closed_at, support_case.closed_reason, vault.purge_due,
  support_case.extra, support_case.created_at, support_case.updated_at
FROM support_cases AS support_case
LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id = support_case.beneficiary_id AND vault.org_id = support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL OR support_case.creation_kind = 'initial';

-- DROP VIEW removes its INSTEAD OF triggers; preserve every write prohibition.
CREATE TRIGGER case_assignees_legacy_delete_unsupported INSTEAD OF DELETE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_insert_unsupported INSTEAD OF INSERT ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER case_assignees_legacy_update_unsupported INSTEAD OF UPDATE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_delete_unsupported INSTEAD OF DELETE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_insert_unsupported INSTEAD OF INSERT ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
CREATE TRIGGER cases_legacy_update_unsupported INSTEAD OF UPDATE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;
