-- E3-2 / S1 logical pair for SQLite 0047_timestamp_normalization.sql.
-- User triggers are suspended and restored inside the migration transaction while legacy text is normalized.


ALTER TABLE action_items DISABLE TRIGGER USER;

ALTER TABLE agent_installations DISABLE TRIGGER USER;

ALTER TABLE ai_draft_contrast_axes DISABLE TRIGGER USER;

ALTER TABLE ai_draft_source_materials DISABLE TRIGGER USER;

ALTER TABLE ai_draft_versions DISABLE TRIGGER USER;

ALTER TABLE ai_evidence_links DISABLE TRIGGER USER;

ALTER TABLE ai_gas_evidence DISABLE TRIGGER USER;

ALTER TABLE ai_masked_source_evidence_items DISABLE TRIGGER USER;

ALTER TABLE ai_masked_source_snapshots DISABLE TRIGGER USER;

ALTER TABLE ai_provider_activations DISABLE TRIGGER USER;

ALTER TABLE ai_provider_configs DISABLE TRIGGER USER;

ALTER TABLE ai_review_events DISABLE TRIGGER USER;

ALTER TABLE ai_text_work_queue DISABLE TRIGGER USER;

ALTER TABLE ai_work_items DISABLE TRIGGER USER;

ALTER TABLE audit_log DISABLE TRIGGER USER;

ALTER TABLE auth_revocations DISABLE TRIGGER USER;

ALTER TABLE beneficiaries DISABLE TRIGGER USER;

ALTER TABLE counseling_schedules DISABLE TRIGGER USER;

ALTER TABLE flags DISABLE TRIGGER USER;

ALTER TABLE goal_revisions DISABLE TRIGGER USER;

ALTER TABLE goals DISABLE TRIGGER USER;

ALTER TABLE invite_tokens DISABLE TRIGGER USER;

ALTER TABLE organization_settings DISABLE TRIGGER USER;

ALTER TABLE participant_consent_records DISABLE TRIGGER USER;

ALTER TABLE participant_pii_archives DISABLE TRIGGER USER;

ALTER TABLE participant_pii_retention_decisions DISABLE TRIGGER USER;

ALTER TABLE participant_pii_vault DISABLE TRIGGER USER;

ALTER TABLE participant_support_case_cutover_manifest DISABLE TRIGGER USER;

ALTER TABLE pilot_text_ai_consent_evidence DISABLE TRIGGER USER;

ALTER TABLE recording_result_commits DISABLE TRIGGER USER;

ALTER TABLE schedule_custom_questions DISABLE TRIGGER USER;

ALTER TABLE schedule_session_goals DISABLE TRIGGER USER;

ALTER TABLE session_discrepancies DISABLE TRIGGER USER;

ALTER TABLE session_goal_scores DISABLE TRIGGER USER;

ALTER TABLE session_life_area_snapshots DISABLE TRIGGER USER;

ALTER TABLE sessions DISABLE TRIGGER USER;

ALTER TABLE support_case_assignees DISABLE TRIGGER USER;

ALTER TABLE support_cases DISABLE TRIGGER USER;

ALTER TABLE team_memberships DISABLE TRIGGER USER;

ALTER TABLE team_supervisor_grants DISABLE TRIGGER USER;

ALTER TABLE teams DISABLE TRIGGER USER;

ALTER TABLE user_role_assignments DISABLE TRIGGER USER;

ALTER TABLE users DISABLE TRIGGER USER;

UPDATE action_items
SET   resolved_at = CASE WHEN resolved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(resolved_at, 1, 10) || 'T' || substr(resolved_at, 12, 8) || '.000Z' ELSE resolved_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  resolution_at = CASE WHEN resolution_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(resolution_at, 1, 10) || 'T' || substr(resolution_at, 12, 8) || '.000Z' ELSE resolution_at END
WHERE resolved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR resolution_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE agent_installations
SET   paired_at = CASE WHEN paired_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(paired_at, 1, 10) || 'T' || substr(paired_at, 12, 8) || '.000Z' ELSE paired_at END,
  revoked_at = CASE WHEN revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE paired_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_draft_contrast_axes
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_draft_source_materials
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_draft_versions
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_evidence_links
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_gas_evidence
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_masked_source_evidence_items
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_masked_source_snapshots
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_provider_activations
SET   activated_at = CASE WHEN activated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(activated_at, 1, 10) || 'T' || substr(activated_at, 12, 8) || '.000Z' ELSE activated_at END,
  deactivated_at = CASE WHEN deactivated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(deactivated_at, 1, 10) || 'T' || substr(deactivated_at, 12, 8) || '.000Z' ELSE deactivated_at END
WHERE activated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR deactivated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_provider_configs
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_review_events
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_text_work_queue
SET   enqueued_at = CASE WHEN enqueued_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(enqueued_at, 1, 10) || 'T' || substr(enqueued_at, 12, 8) || '.000Z' ELSE enqueued_at END,
  completed_at = CASE WHEN completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END,
  lease_expires_at = CASE WHEN lease_expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(lease_expires_at, 1, 10) || 'T' || substr(lease_expires_at, 12, 8) || '.000Z' ELSE lease_expires_at END
WHERE enqueued_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR lease_expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE ai_work_items
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE audit_log
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE auth_revocations
SET   revoked_at = CASE WHEN revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE beneficiaries
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE counseling_schedules
SET   scheduled_at = CASE WHEN scheduled_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(scheduled_at, 1, 10) || 'T' || substr(scheduled_at, 12, 8) || '.000Z' ELSE scheduled_at END,
  completed_at = CASE WHEN completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE scheduled_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE flags
SET   reviewed_at = CASE WHEN reviewed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(reviewed_at, 1, 10) || 'T' || substr(reviewed_at, 12, 8) || '.000Z' ELSE reviewed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE reviewed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE goal_revisions
SET   edited_at = CASE WHEN edited_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(edited_at, 1, 10) || 'T' || substr(edited_at, 12, 8) || '.000Z' ELSE edited_at END
WHERE edited_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE goals
SET   closed_at = CASE WHEN closed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(closed_at, 1, 10) || 'T' || substr(closed_at, 12, 8) || '.000Z' ELSE closed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE closed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE invite_tokens
SET   issued_at = CASE WHEN issued_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(issued_at, 1, 10) || 'T' || substr(issued_at, 12, 8) || '.000Z' ELSE issued_at END,
  used_at = CASE WHEN used_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(used_at, 1, 10) || 'T' || substr(used_at, 12, 8) || '.000Z' ELSE used_at END,
  revoked_at = CASE WHEN revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE issued_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR used_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE organization_settings
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE participant_consent_records
SET   consent_recording_at = CASE WHEN consent_recording_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_recording_at, 1, 10) || 'T' || substr(consent_recording_at, 12, 8) || '.000Z' ELSE consent_recording_at END,
  consent_text_ai_at = CASE WHEN consent_text_ai_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_text_ai_at, 1, 10) || 'T' || substr(consent_text_ai_at, 12, 8) || '.000Z' ELSE consent_text_ai_at END,
  recorded_at = CASE WHEN recorded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(recorded_at, 1, 10) || 'T' || substr(recorded_at, 12, 8) || '.000Z' ELSE recorded_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  consent_privacy_at = CASE WHEN consent_privacy_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_privacy_at, 1, 10) || 'T' || substr(consent_privacy_at, 12, 8) || '.000Z' ELSE consent_privacy_at END
WHERE consent_recording_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_text_ai_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR recorded_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_privacy_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE participant_pii_archives
SET   archived_at = CASE WHEN archived_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(archived_at, 1, 10) || 'T' || substr(archived_at, 12, 8) || '.000Z' ELSE archived_at END,
  retention_cap_due_at = CASE WHEN retention_cap_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(retention_cap_due_at, 1, 10) || 'T' || substr(retention_cap_due_at, 12, 8) || '.000Z' ELSE retention_cap_due_at END,
  review_due_at = CASE WHEN review_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(review_due_at, 1, 10) || 'T' || substr(review_due_at, 12, 8) || '.000Z' ELSE review_due_at END,
  reviewed_at = CASE WHEN reviewed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(reviewed_at, 1, 10) || 'T' || substr(reviewed_at, 12, 8) || '.000Z' ELSE reviewed_at END,
  approved_at = CASE WHEN approved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(approved_at, 1, 10) || 'T' || substr(approved_at, 12, 8) || '.000Z' ELSE approved_at END,
  purged_at = CASE WHEN purged_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(purged_at, 1, 10) || 'T' || substr(purged_at, 12, 8) || '.000Z' ELSE purged_at END,
  state_changed_at = CASE WHEN state_changed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(state_changed_at, 1, 10) || 'T' || substr(state_changed_at, 12, 8) || '.000Z' ELSE state_changed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE archived_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR retention_cap_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR review_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR reviewed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR approved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR purged_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR state_changed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE participant_pii_retention_decisions
SET   decided_at = CASE WHEN decided_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(decided_at, 1, 10) || 'T' || substr(decided_at, 12, 8) || '.000Z' ELSE decided_at END
WHERE decided_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE participant_pii_vault
SET   purge_due = CASE WHEN purge_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(purge_due, 1, 10) || 'T' || substr(purge_due, 12, 8) || '.000Z' ELSE purge_due END,
  purged_at = CASE WHEN purged_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(purged_at, 1, 10) || 'T' || substr(purged_at, 12, 8) || '.000Z' ELSE purged_at END,
  retention_changed_at = CASE WHEN retention_changed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(retention_changed_at, 1, 10) || 'T' || substr(retention_changed_at, 12, 8) || '.000Z' ELSE retention_changed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE purge_due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR purged_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR retention_changed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE participant_support_case_cutover_manifest
SET   completed_at = CASE WHEN completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END
WHERE completed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE pilot_text_ai_consent_evidence
SET   effective_at = CASE WHEN effective_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(effective_at, 1, 10) || 'T' || substr(effective_at, 12, 8) || '.000Z' ELSE effective_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE effective_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE recording_result_commits
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  downstream_claimed_at = CASE WHEN downstream_claimed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(downstream_claimed_at, 1, 10) || 'T' || substr(downstream_claimed_at, 12, 8) || '.000Z' ELSE downstream_claimed_at END,
  finalized_at = CASE WHEN finalized_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(finalized_at, 1, 10) || 'T' || substr(finalized_at, 12, 8) || '.000Z' ELSE finalized_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR downstream_claimed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR finalized_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE schedule_custom_questions
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE schedule_session_goals
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE session_discrepancies
SET   detected_at = CASE WHEN detected_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(detected_at, 1, 10) || 'T' || substr(detected_at, 12, 8) || '.000Z' ELSE detected_at END,
  resolved_at = CASE WHEN resolved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(resolved_at, 1, 10) || 'T' || substr(resolved_at, 12, 8) || '.000Z' ELSE resolved_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE detected_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR resolved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE session_goal_scores
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE session_life_area_snapshots
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE sessions
SET   held_at = CASE WHEN held_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(held_at, 1, 10) || 'T' || substr(held_at, 12, 8) || '.000Z' ELSE held_at END,
  speaker_mapping_confirmed_at = CASE WHEN speaker_mapping_confirmed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(speaker_mapping_confirmed_at, 1, 10) || 'T' || substr(speaker_mapping_confirmed_at, 12, 8) || '.000Z' ELSE speaker_mapping_confirmed_at END,
  approved_at = CASE WHEN approved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(approved_at, 1, 10) || 'T' || substr(approved_at, 12, 8) || '.000Z' ELSE approved_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE held_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR speaker_mapping_confirmed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR approved_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE support_case_assignees
SET   assigned_at = CASE WHEN assigned_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(assigned_at, 1, 10) || 'T' || substr(assigned_at, 12, 8) || '.000Z' ELSE assigned_at END,
  unassigned_at = CASE WHEN unassigned_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(unassigned_at, 1, 10) || 'T' || substr(unassigned_at, 12, 8) || '.000Z' ELSE unassigned_at END,
  accepted_at = CASE WHEN accepted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(accepted_at, 1, 10) || 'T' || substr(accepted_at, 12, 8) || '.000Z' ELSE accepted_at END,
  notified_at = CASE WHEN notified_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(notified_at, 1, 10) || 'T' || substr(notified_at, 12, 8) || '.000Z' ELSE notified_at END
WHERE assigned_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR unassigned_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR accepted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR notified_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE support_cases
SET   intake_at = CASE WHEN intake_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(intake_at, 1, 10) || 'T' || substr(intake_at, 12, 8) || '.000Z' ELSE intake_at END,
  consent_recording_at = CASE WHEN consent_recording_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_recording_at, 1, 10) || 'T' || substr(consent_recording_at, 12, 8) || '.000Z' ELSE consent_recording_at END,
  consent_text_ai_at = CASE WHEN consent_text_ai_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_text_ai_at, 1, 10) || 'T' || substr(consent_text_ai_at, 12, 8) || '.000Z' ELSE consent_text_ai_at END,
  closed_at = CASE WHEN closed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(closed_at, 1, 10) || 'T' || substr(closed_at, 12, 8) || '.000Z' ELSE closed_at END,
  created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END,
  consent_privacy_at = CASE WHEN consent_privacy_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_privacy_at, 1, 10) || 'T' || substr(consent_privacy_at, 12, 8) || '.000Z' ELSE consent_privacy_at END,
  emergency_registration_at = CASE WHEN emergency_registration_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(emergency_registration_at, 1, 10) || 'T' || substr(emergency_registration_at, 12, 8) || '.000Z' ELSE emergency_registration_at END,
  consent_privacy_due_at = CASE WHEN consent_privacy_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(consent_privacy_due_at, 1, 10) || 'T' || substr(consent_privacy_due_at, 12, 8) || '.000Z' ELSE consent_privacy_due_at END
WHERE intake_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_recording_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_text_ai_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR closed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR updated_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_privacy_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR emergency_registration_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR consent_privacy_due_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE team_memberships
SET   joined_at = CASE WHEN joined_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(joined_at, 1, 10) || 'T' || substr(joined_at, 12, 8) || '.000Z' ELSE joined_at END,
  ended_at = CASE WHEN ended_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(ended_at, 1, 10) || 'T' || substr(ended_at, 12, 8) || '.000Z' ELSE ended_at END
WHERE joined_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR ended_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE team_supervisor_grants
SET   granted_at = CASE WHEN granted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(granted_at, 1, 10) || 'T' || substr(granted_at, 12, 8) || '.000Z' ELSE granted_at END,
  revoked_at = CASE WHEN revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE granted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE teams
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  archived_at = CASE WHEN archived_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(archived_at, 1, 10) || 'T' || substr(archived_at, 12, 8) || '.000Z' ELSE archived_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR archived_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE user_role_assignments
SET   granted_at = CASE WHEN granted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(granted_at, 1, 10) || 'T' || substr(granted_at, 12, 8) || '.000Z' ELSE granted_at END,
  revoked_at = CASE WHEN revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE granted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' OR revoked_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

UPDATE users
SET   created_at = CASE WHEN created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$';

ALTER TABLE action_items ENABLE TRIGGER USER;

ALTER TABLE agent_installations ENABLE TRIGGER USER;

ALTER TABLE ai_draft_contrast_axes ENABLE TRIGGER USER;

ALTER TABLE ai_draft_source_materials ENABLE TRIGGER USER;

ALTER TABLE ai_draft_versions ENABLE TRIGGER USER;

ALTER TABLE ai_evidence_links ENABLE TRIGGER USER;

ALTER TABLE ai_gas_evidence ENABLE TRIGGER USER;

ALTER TABLE ai_masked_source_evidence_items ENABLE TRIGGER USER;

ALTER TABLE ai_masked_source_snapshots ENABLE TRIGGER USER;

ALTER TABLE ai_provider_activations ENABLE TRIGGER USER;

ALTER TABLE ai_provider_configs ENABLE TRIGGER USER;

ALTER TABLE ai_review_events ENABLE TRIGGER USER;

ALTER TABLE ai_text_work_queue ENABLE TRIGGER USER;

ALTER TABLE ai_work_items ENABLE TRIGGER USER;

ALTER TABLE audit_log ENABLE TRIGGER USER;

ALTER TABLE auth_revocations ENABLE TRIGGER USER;

ALTER TABLE beneficiaries ENABLE TRIGGER USER;

ALTER TABLE counseling_schedules ENABLE TRIGGER USER;

ALTER TABLE flags ENABLE TRIGGER USER;

ALTER TABLE goal_revisions ENABLE TRIGGER USER;

ALTER TABLE goals ENABLE TRIGGER USER;

ALTER TABLE invite_tokens ENABLE TRIGGER USER;

ALTER TABLE organization_settings ENABLE TRIGGER USER;

ALTER TABLE participant_consent_records ENABLE TRIGGER USER;

ALTER TABLE participant_pii_archives ENABLE TRIGGER USER;

ALTER TABLE participant_pii_retention_decisions ENABLE TRIGGER USER;

ALTER TABLE participant_pii_vault ENABLE TRIGGER USER;

ALTER TABLE participant_support_case_cutover_manifest ENABLE TRIGGER USER;

ALTER TABLE pilot_text_ai_consent_evidence ENABLE TRIGGER USER;

ALTER TABLE recording_result_commits ENABLE TRIGGER USER;

ALTER TABLE schedule_custom_questions ENABLE TRIGGER USER;

ALTER TABLE schedule_session_goals ENABLE TRIGGER USER;

ALTER TABLE session_discrepancies ENABLE TRIGGER USER;

ALTER TABLE session_goal_scores ENABLE TRIGGER USER;

ALTER TABLE session_life_area_snapshots ENABLE TRIGGER USER;

ALTER TABLE sessions ENABLE TRIGGER USER;

ALTER TABLE support_case_assignees ENABLE TRIGGER USER;

ALTER TABLE support_cases ENABLE TRIGGER USER;

ALTER TABLE team_memberships ENABLE TRIGGER USER;

ALTER TABLE team_supervisor_grants ENABLE TRIGGER USER;

ALTER TABLE teams ENABLE TRIGGER USER;

ALTER TABLE user_role_assignments ENABLE TRIGGER USER;

ALTER TABLE users ENABLE TRIGGER USER;