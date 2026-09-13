-- Paired with SQLite 0060. Replace in place to retain grants and all six
-- INSTEAD OF write-reject triggers. Underlying tenant policies remain enforced.
CREATE OR REPLACE VIEW case_assignees WITH (security_invoker = true) AS
SELECT assignment.id, assignment.org_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  assignment.user_id, assignment.role, assignment.assigned_at, assignment.unassigned_at
FROM support_case_assignees AS assignment
JOIN support_cases AS support_case
  ON support_case.id = assignment.support_case_id AND support_case.org_id = assignment.org_id
WHERE (support_case.legacy_case_id IS NOT NULL OR support_case.creation_kind = 'initial')
  AND assignment.status = 'active';

CREATE OR REPLACE VIEW cases WITH (security_invoker = true) AS
SELECT COALESCE(support_case.legacy_case_id, support_case.id) AS id,
  support_case.org_id, support_case.program_type, support_case.status,
  support_case.intake_at, support_case.consent_recording_at, support_case.consent_text_ai_at,
  support_case.closed_at, support_case.closed_reason, vault.purge_due,
  support_case.extra, support_case.created_at, support_case.updated_at
FROM support_cases AS support_case
LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id = support_case.beneficiary_id AND vault.org_id = support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL OR support_case.creation_kind = 'initial';

ALTER VIEW case_assignees OWNER TO ccc_schema_owner;
ALTER VIEW cases OWNER TO ccc_schema_owner;
