-- E3-2 / S1: normalize legacy timestamps in tables not rebuilt by 0046.
-- Update-side guards and audit triggers are removed and restored inside this migration only.


DROP TRIGGER agent_installations_identity_immutable;
DROP TRIGGER agent_installations_revocation_guard;
DROP TRIGGER ai_draft_contrast_axes_no_update;
DROP TRIGGER ai_draft_source_materials_no_update;
DROP TRIGGER ai_draft_versions_no_update;
DROP TRIGGER ai_masked_source_evidence_items_no_update;
DROP TRIGGER ai_masked_source_snapshots_no_update;
DROP TRIGGER ai_text_work_queue_done_is_final;
DROP TRIGGER ai_work_items_no_update;
DROP TRIGGER auth_revocations_no_update;
DROP TRIGGER beneficiaries_complete_guard;
DROP TRIGGER counseling_schedules_update_guard;
DROP TRIGGER goal_revisions_no_update;
DROP TRIGGER goals_no_reopen;
DROP TRIGGER participant_pii_archive_re_register_cleanup;
DROP TRIGGER participant_pii_archives_approved_purge;
DROP TRIGGER participant_pii_archives_review_audit;
DROP TRIGGER participant_pii_archives_update_guard;
DROP TRIGGER participant_pii_retention_decisions_no_update;
DROP TRIGGER participant_pii_vault_archived_write_guard;
DROP TRIGGER participant_pii_vault_cancel_audit;
DROP TRIGGER participant_pii_vault_no_revive_guard;
DROP TRIGGER participant_pii_vault_purge_audit;
DROP TRIGGER participant_pii_vault_retention_guard;
DROP TRIGGER participant_pii_vault_reviewed_purge_guard;
DROP TRIGGER participant_pii_vault_schedule_audit;
DROP TRIGGER pilot_text_ai_consent_evidence_no_update;
DROP TRIGGER recording_result_commits_immutable;
DROP TRIGGER session_discrepancies_content_immutable;
DROP TRIGGER sessions_approved_ai_compatibility_immutable;
DROP TRIGGER sessions_direct_ai_approval_update_guard;
DROP TRIGGER support_case_assignees_lifecycle_update_guard;
DROP TRIGGER support_case_assignees_unassign_guard;
DROP TRIGGER support_cases_close_guard;
DROP TRIGGER support_cases_emergency_registration_immutable_guard;
DROP TRIGGER support_cases_immutable_identity_guard;
DROP TRIGGER support_cases_schedule_pii_purge_due;
DROP TRIGGER users_last_required_roles_guard;
DROP TRIGGER users_sync_independent_roles_after_role_update;

UPDATE action_items
SET   resolved_at = CASE WHEN resolved_at GLOB '????-??-?? ??:??:??' THEN substr(resolved_at, 1, 10) || 'T' || substr(resolved_at, 12, 8) || '.000Z' ELSE resolved_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  resolution_at = CASE WHEN resolution_at GLOB '????-??-?? ??:??:??' THEN substr(resolution_at, 1, 10) || 'T' || substr(resolution_at, 12, 8) || '.000Z' ELSE resolution_at END
WHERE resolved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR resolution_at GLOB '????-??-?? ??:??:??';

UPDATE agent_installations
SET   paired_at = CASE WHEN paired_at GLOB '????-??-?? ??:??:??' THEN substr(paired_at, 1, 10) || 'T' || substr(paired_at, 12, 8) || '.000Z' ELSE paired_at END,
  revoked_at = CASE WHEN revoked_at GLOB '????-??-?? ??:??:??' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE paired_at GLOB '????-??-?? ??:??:??' OR revoked_at GLOB '????-??-?? ??:??:??';

UPDATE ai_draft_contrast_axes
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_draft_source_materials
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_draft_versions
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_gas_evidence
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_masked_source_evidence_items
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_masked_source_snapshots
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE ai_text_work_queue
SET   enqueued_at = CASE WHEN enqueued_at GLOB '????-??-?? ??:??:??' THEN substr(enqueued_at, 1, 10) || 'T' || substr(enqueued_at, 12, 8) || '.000Z' ELSE enqueued_at END,
  completed_at = CASE WHEN completed_at GLOB '????-??-?? ??:??:??' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END,
  lease_expires_at = CASE WHEN lease_expires_at GLOB '????-??-?? ??:??:??' THEN substr(lease_expires_at, 1, 10) || 'T' || substr(lease_expires_at, 12, 8) || '.000Z' ELSE lease_expires_at END
WHERE enqueued_at GLOB '????-??-?? ??:??:??' OR completed_at GLOB '????-??-?? ??:??:??' OR lease_expires_at GLOB '????-??-?? ??:??:??';

UPDATE ai_work_items
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE auth_revocations
SET   revoked_at = CASE WHEN revoked_at GLOB '????-??-?? ??:??:??' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END
WHERE revoked_at GLOB '????-??-?? ??:??:??';

UPDATE beneficiaries
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE counseling_schedules
SET   scheduled_at = CASE WHEN scheduled_at GLOB '????-??-?? ??:??:??' THEN substr(scheduled_at, 1, 10) || 'T' || substr(scheduled_at, 12, 8) || '.000Z' ELSE scheduled_at END,
  completed_at = CASE WHEN completed_at GLOB '????-??-?? ??:??:??' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE scheduled_at GLOB '????-??-?? ??:??:??' OR completed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE flags
SET   reviewed_at = CASE WHEN reviewed_at GLOB '????-??-?? ??:??:??' THEN substr(reviewed_at, 1, 10) || 'T' || substr(reviewed_at, 12, 8) || '.000Z' ELSE reviewed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE reviewed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??';

UPDATE goal_revisions
SET   edited_at = CASE WHEN edited_at GLOB '????-??-?? ??:??:??' THEN substr(edited_at, 1, 10) || 'T' || substr(edited_at, 12, 8) || '.000Z' ELSE edited_at END
WHERE edited_at GLOB '????-??-?? ??:??:??';

UPDATE goals
SET   closed_at = CASE WHEN closed_at GLOB '????-??-?? ??:??:??' THEN substr(closed_at, 1, 10) || 'T' || substr(closed_at, 12, 8) || '.000Z' ELSE closed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE closed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??';

UPDATE organization_settings
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE participant_pii_archives
SET   archived_at = CASE WHEN archived_at GLOB '????-??-?? ??:??:??' THEN substr(archived_at, 1, 10) || 'T' || substr(archived_at, 12, 8) || '.000Z' ELSE archived_at END,
  retention_cap_due_at = CASE WHEN retention_cap_due_at GLOB '????-??-?? ??:??:??' THEN substr(retention_cap_due_at, 1, 10) || 'T' || substr(retention_cap_due_at, 12, 8) || '.000Z' ELSE retention_cap_due_at END,
  review_due_at = CASE WHEN review_due_at GLOB '????-??-?? ??:??:??' THEN substr(review_due_at, 1, 10) || 'T' || substr(review_due_at, 12, 8) || '.000Z' ELSE review_due_at END,
  reviewed_at = CASE WHEN reviewed_at GLOB '????-??-?? ??:??:??' THEN substr(reviewed_at, 1, 10) || 'T' || substr(reviewed_at, 12, 8) || '.000Z' ELSE reviewed_at END,
  approved_at = CASE WHEN approved_at GLOB '????-??-?? ??:??:??' THEN substr(approved_at, 1, 10) || 'T' || substr(approved_at, 12, 8) || '.000Z' ELSE approved_at END,
  purged_at = CASE WHEN purged_at GLOB '????-??-?? ??:??:??' THEN substr(purged_at, 1, 10) || 'T' || substr(purged_at, 12, 8) || '.000Z' ELSE purged_at END,
  state_changed_at = CASE WHEN state_changed_at GLOB '????-??-?? ??:??:??' THEN substr(state_changed_at, 1, 10) || 'T' || substr(state_changed_at, 12, 8) || '.000Z' ELSE state_changed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE archived_at GLOB '????-??-?? ??:??:??' OR retention_cap_due_at GLOB '????-??-?? ??:??:??' OR review_due_at GLOB '????-??-?? ??:??:??' OR reviewed_at GLOB '????-??-?? ??:??:??' OR approved_at GLOB '????-??-?? ??:??:??' OR purged_at GLOB '????-??-?? ??:??:??' OR state_changed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE participant_pii_retention_decisions
SET   decided_at = CASE WHEN decided_at GLOB '????-??-?? ??:??:??' THEN substr(decided_at, 1, 10) || 'T' || substr(decided_at, 12, 8) || '.000Z' ELSE decided_at END
WHERE decided_at GLOB '????-??-?? ??:??:??';

UPDATE participant_pii_vault
SET   purge_due = CASE WHEN purge_due GLOB '????-??-?? ??:??:??' THEN substr(purge_due, 1, 10) || 'T' || substr(purge_due, 12, 8) || '.000Z' ELSE purge_due END,
  purged_at = CASE WHEN purged_at GLOB '????-??-?? ??:??:??' THEN substr(purged_at, 1, 10) || 'T' || substr(purged_at, 12, 8) || '.000Z' ELSE purged_at END,
  retention_changed_at = CASE WHEN retention_changed_at GLOB '????-??-?? ??:??:??' THEN substr(retention_changed_at, 1, 10) || 'T' || substr(retention_changed_at, 12, 8) || '.000Z' ELSE retention_changed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE purge_due GLOB '????-??-?? ??:??:??' OR purged_at GLOB '????-??-?? ??:??:??' OR retention_changed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE participant_support_case_cutover_manifest
SET   completed_at = CASE WHEN completed_at GLOB '????-??-?? ??:??:??' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END
WHERE completed_at GLOB '????-??-?? ??:??:??';

UPDATE pilot_text_ai_consent_evidence
SET   effective_at = CASE WHEN effective_at GLOB '????-??-?? ??:??:??' THEN substr(effective_at, 1, 10) || 'T' || substr(effective_at, 12, 8) || '.000Z' ELSE effective_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE effective_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??';

UPDATE recording_result_commits
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  downstream_claimed_at = CASE WHEN downstream_claimed_at GLOB '????-??-?? ??:??:??' THEN substr(downstream_claimed_at, 1, 10) || 'T' || substr(downstream_claimed_at, 12, 8) || '.000Z' ELSE downstream_claimed_at END,
  finalized_at = CASE WHEN finalized_at GLOB '????-??-?? ??:??:??' THEN substr(finalized_at, 1, 10) || 'T' || substr(finalized_at, 12, 8) || '.000Z' ELSE finalized_at END
WHERE created_at GLOB '????-??-?? ??:??:??' OR downstream_claimed_at GLOB '????-??-?? ??:??:??' OR finalized_at GLOB '????-??-?? ??:??:??';

UPDATE schedule_custom_questions
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE schedule_session_goals
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE session_discrepancies
SET   detected_at = CASE WHEN detected_at GLOB '????-??-?? ??:??:??' THEN substr(detected_at, 1, 10) || 'T' || substr(detected_at, 12, 8) || '.000Z' ELSE detected_at END,
  resolved_at = CASE WHEN resolved_at GLOB '????-??-?? ??:??:??' THEN substr(resolved_at, 1, 10) || 'T' || substr(resolved_at, 12, 8) || '.000Z' ELSE resolved_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE detected_at GLOB '????-??-?? ??:??:??' OR resolved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??';

UPDATE session_goal_scores
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE session_life_area_snapshots
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE sessions
SET   held_at = CASE WHEN held_at GLOB '????-??-?? ??:??:??' THEN substr(held_at, 1, 10) || 'T' || substr(held_at, 12, 8) || '.000Z' ELSE held_at END,
  speaker_mapping_confirmed_at = CASE WHEN speaker_mapping_confirmed_at GLOB '????-??-?? ??:??:??' THEN substr(speaker_mapping_confirmed_at, 1, 10) || 'T' || substr(speaker_mapping_confirmed_at, 12, 8) || '.000Z' ELSE speaker_mapping_confirmed_at END,
  approved_at = CASE WHEN approved_at GLOB '????-??-?? ??:??:??' THEN substr(approved_at, 1, 10) || 'T' || substr(approved_at, 12, 8) || '.000Z' ELSE approved_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE held_at GLOB '????-??-?? ??:??:??' OR speaker_mapping_confirmed_at GLOB '????-??-?? ??:??:??' OR approved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE support_case_assignees
SET   assigned_at = CASE WHEN assigned_at GLOB '????-??-?? ??:??:??' THEN substr(assigned_at, 1, 10) || 'T' || substr(assigned_at, 12, 8) || '.000Z' ELSE assigned_at END,
  unassigned_at = CASE WHEN unassigned_at GLOB '????-??-?? ??:??:??' THEN substr(unassigned_at, 1, 10) || 'T' || substr(unassigned_at, 12, 8) || '.000Z' ELSE unassigned_at END,
  accepted_at = CASE WHEN accepted_at GLOB '????-??-?? ??:??:??' THEN substr(accepted_at, 1, 10) || 'T' || substr(accepted_at, 12, 8) || '.000Z' ELSE accepted_at END,
  notified_at = CASE WHEN notified_at GLOB '????-??-?? ??:??:??' THEN substr(notified_at, 1, 10) || 'T' || substr(notified_at, 12, 8) || '.000Z' ELSE notified_at END
WHERE assigned_at GLOB '????-??-?? ??:??:??' OR unassigned_at GLOB '????-??-?? ??:??:??' OR accepted_at GLOB '????-??-?? ??:??:??' OR notified_at GLOB '????-??-?? ??:??:??';

UPDATE support_cases
SET   intake_at = CASE WHEN intake_at GLOB '????-??-?? ??:??:??' THEN substr(intake_at, 1, 10) || 'T' || substr(intake_at, 12, 8) || '.000Z' ELSE intake_at END,
  consent_recording_at = CASE WHEN consent_recording_at GLOB '????-??-?? ??:??:??' THEN substr(consent_recording_at, 1, 10) || 'T' || substr(consent_recording_at, 12, 8) || '.000Z' ELSE consent_recording_at END,
  consent_text_ai_at = CASE WHEN consent_text_ai_at GLOB '????-??-?? ??:??:??' THEN substr(consent_text_ai_at, 1, 10) || 'T' || substr(consent_text_ai_at, 12, 8) || '.000Z' ELSE consent_text_ai_at END,
  closed_at = CASE WHEN closed_at GLOB '????-??-?? ??:??:??' THEN substr(closed_at, 1, 10) || 'T' || substr(closed_at, 12, 8) || '.000Z' ELSE closed_at END,
  created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END,
  consent_privacy_at = CASE WHEN consent_privacy_at GLOB '????-??-?? ??:??:??' THEN substr(consent_privacy_at, 1, 10) || 'T' || substr(consent_privacy_at, 12, 8) || '.000Z' ELSE consent_privacy_at END,
  emergency_registration_at = CASE WHEN emergency_registration_at GLOB '????-??-?? ??:??:??' THEN substr(emergency_registration_at, 1, 10) || 'T' || substr(emergency_registration_at, 12, 8) || '.000Z' ELSE emergency_registration_at END,
  consent_privacy_due_at = CASE WHEN consent_privacy_due_at GLOB '????-??-?? ??:??:??' THEN substr(consent_privacy_due_at, 1, 10) || 'T' || substr(consent_privacy_due_at, 12, 8) || '.000Z' ELSE consent_privacy_due_at END
WHERE intake_at GLOB '????-??-?? ??:??:??' OR consent_recording_at GLOB '????-??-?? ??:??:??' OR consent_text_ai_at GLOB '????-??-?? ??:??:??' OR closed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??' OR consent_privacy_at GLOB '????-??-?? ??:??:??' OR emergency_registration_at GLOB '????-??-?? ??:??:??' OR consent_privacy_due_at GLOB '????-??-?? ??:??:??';

UPDATE users
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

CREATE TRIGGER agent_installations_identity_immutable
BEFORE UPDATE OF installation_id, org_id, actor_user_id, paired_at ON agent_installations
BEGIN
  SELECT RAISE(ABORT, 'agent_installation_identity_immutable');
END;

CREATE TRIGGER agent_installations_revocation_guard
BEFORE UPDATE OF revoked_at ON agent_installations
WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'agent_installation_revocation_immutable');
END;

CREATE TRIGGER ai_draft_contrast_axes_no_update
BEFORE UPDATE ON ai_draft_contrast_axes
BEGIN SELECT RAISE(ABORT, 'ccc102: contrast axes are append-only'); END;

CREATE TRIGGER ai_draft_source_materials_no_update
BEFORE UPDATE ON ai_draft_source_materials
BEGIN SELECT RAISE(ABORT, 'ccc102: draft source materials are append-only'); END;

CREATE TRIGGER ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

CREATE TRIGGER ai_masked_source_evidence_items_no_update
BEFORE UPDATE ON ai_masked_source_evidence_items
BEGIN SELECT RAISE(ABORT, 'phase1: masked source evidence items are append-only'); END;

CREATE TRIGGER ai_masked_source_snapshots_no_update
BEFORE UPDATE ON ai_masked_source_snapshots
BEGIN SELECT RAISE(ABORT, 'phase1: masked source snapshots are append-only'); END;

CREATE TRIGGER ai_text_work_queue_done_is_final
BEFORE UPDATE ON ai_text_work_queue
WHEN OLD.status = 'done'
BEGIN
  SELECT RAISE(ABORT, 'completed text work items are immutable');
END;

CREATE TRIGGER ai_work_items_no_update
BEFORE UPDATE ON ai_work_items
BEGIN SELECT RAISE(ABORT, 'phase1: AI work items are append-only'); END;

CREATE TRIGGER auth_revocations_no_update
BEFORE UPDATE ON auth_revocations
BEGIN
  SELECT RAISE(ABORT, 'auth_revocations_are_append_only');
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;

CREATE TRIGGER counseling_schedules_update_guard
BEFORE UPDATE ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
     OR NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.support_case_id IS NOT OLD.support_case_id
     OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
     OR NEW.version <> OLD.version + 1;
END;

CREATE TRIGGER goal_revisions_no_update
BEFORE UPDATE ON goal_revisions
BEGIN SELECT RAISE(ABORT, 'D62: goal_revisions is append-only'); END;

CREATE TRIGGER goals_no_reopen
BEFORE UPDATE OF status ON goals
WHEN OLD.status = 'closed' AND NEW.status = 'active'
BEGIN SELECT RAISE(ABORT, 'D62: a closed goal cannot be reopened'); END;

CREATE TRIGGER participant_pii_archive_re_register_cleanup
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 're_register_pii'
BEGIN
  DELETE FROM participant_pii_archives
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status = 'purged';
END;

CREATE TRIGGER participant_pii_archives_approved_purge
AFTER UPDATE OF review_status ON participant_pii_archives
WHEN OLD.review_status = 'pending' AND NEW.review_status = 'approved'
BEGIN
  UPDATE participant_pii_vault
     SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
         enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL,
         purge_due = NULL, purged_at = NEW.approved_at,
         purged_by = NEW.approved_by, purged_by_role = 'admin',
         retention_changed_by = NEW.approved_by,
         retention_change_kind = 'purge_pii',
         retention_changed_at = NEW.approved_at,
         version = version + 1, updated_at = NEW.approved_at
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NOT NULL
     AND min(
       julianday(purge_due),
       COALESCE(
         (
           SELECT julianday(retention_cap_due_at)
           FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
         ),
         julianday(purge_due)
       )
     ) <= julianday('now')
     AND NOT EXISTS (
       SELECT 1 FROM support_cases
       WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
     );

  UPDATE participant_pii_archives
     SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
         enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL,
         review_status = 'purged', purged_at = NEW.approved_at,
         state_changed_by = NEW.approved_by, state_changed_by_role = 'admin',
         state_changed_at = NEW.approved_at, updated_at = NEW.approved_at
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status = 'approved'
     AND EXISTS (
       SELECT 1 FROM participant_pii_vault
       WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
         AND purged_at = NEW.approved_at
     );
END;

CREATE TRIGGER participant_pii_archives_review_audit
AFTER UPDATE OF review_status ON participant_pii_archives
WHEN OLD.review_status IS NOT NEW.review_status AND NEW.review_status <> 'purged'
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  VALUES (
    NEW.org_id, NEW.state_changed_by, NEW.state_changed_by_role,
    CASE NEW.review_status
      WHEN 'retained' THEN 'retain_archived_pii'
      WHEN 'pending' THEN 'requeue_pii_retention'
      WHEN 'approved' THEN 'approve_pii_purge'
    END,
    'participant_pii_archives', NEW.beneficiary_id, NEW.beneficiary_id, NULL,
    CASE NEW.review_status
      WHEN 'retained' THEN json_object('reasonKind', NEW.review_reason_kind)
      ELSE NULL
    END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER participant_pii_archives_update_guard
BEFORE UPDATE ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.id IS NOT OLD.id
     OR NEW.org_id IS NOT OLD.org_id
     OR NEW.key_version IS NOT OLD.key_version
     OR NEW.archived_at IS NOT OLD.archived_at
     OR NEW.archived_by IS NOT OLD.archived_by
     OR NEW.retention_cap_due_at IS NOT OLD.retention_cap_due_at
     OR NEW.created_at IS NOT OLD.created_at;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'retained'
    AND NEW.review_reason_kind IS NOT NULL
    AND NEW.review_reason IS NOT NULL AND length(trim(NEW.review_reason)) BETWEEN 1 AND 500
    AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_at IS NOT NULL
    AND NEW.review_due_at > NEW.reviewed_at
    AND NEW.state_changed_by = NEW.reviewed_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.reviewed_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'retain'
        AND decision.reason_kind = NEW.review_reason_kind
        AND decision.reason = NEW.review_reason
        AND decision.retain_until = NEW.review_due_at
        AND decision.decided_by = NEW.reviewed_by
        AND decision.decided_at = NEW.reviewed_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.reviewed_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND (
      NEW.review_reason_kind = 'legal_requirement'
      OR julianday(NEW.review_due_at) <= julianday(NEW.retention_cap_due_at)
    )
  ) AND NOT (
    OLD.review_status = 'retained' AND NEW.review_status = 'pending'
    AND julianday(OLD.review_due_at) <= julianday(NEW.state_changed_at)
    AND NEW.review_due_at = NEW.state_changed_at
    AND NEW.state_changed_by = 'system:retention' AND NEW.state_changed_by_role = 'service'
    AND NEW.review_reason_kind IS NULL AND NEW.review_reason IS NULL
    AND NEW.reviewed_by IS NULL AND NEW.reviewed_at IS NULL
  ) AND NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'approved'
    AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
    AND NEW.state_changed_by = NEW.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.approved_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'purge'
        AND decision.decided_by = NEW.approved_by
        AND decision.decided_at = NEW.approved_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.approved_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
    )
  ) AND NOT (
    OLD.review_status = 'approved' AND NEW.review_status = 'purged'
    AND NEW.purged_at IS NOT NULL
    AND NEW.state_changed_by = OLD.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.purged_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
        AND purged_at IS NOT NULL
    )
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.review_status <> 'purged' AND (
    NEW.enc_name IS NOT OLD.enc_name OR NEW.enc_phone IS NOT OLD.enc_phone
    OR NEW.enc_account IS NOT OLD.enc_account OR NEW.enc_email IS NOT OLD.enc_email
    OR NEW.enc_birth_date IS NOT OLD.enc_birth_date OR NEW.enc_region IS NOT OLD.enc_region
    OR NEW.enc_emergency_contact IS NOT OLD.enc_emergency_contact
    OR NEW.enc_gender IS NOT OLD.enc_gender
  );
END;

CREATE TRIGGER participant_pii_retention_decisions_no_update
BEFORE UPDATE ON participant_pii_retention_decisions
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER participant_pii_vault_archived_write_guard
BEFORE UPDATE OF enc_name, enc_phone, enc_account, enc_email, enc_birth_date,
                 enc_region, enc_emergency_contact, enc_gender
ON participant_pii_vault
WHEN EXISTS (
  SELECT 1 FROM participant_pii_archives
  WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
    AND review_status <> 'purged'
)
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.version <> OLD.version + 1
     OR NOT (
       (
         NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
         AND NEW.enc_email IS NULL AND NEW.enc_birth_date IS NULL AND NEW.enc_region IS NULL
         AND NEW.enc_emergency_contact IS NULL AND NEW.enc_gender IS NULL
       )
       OR
       (
         NEW.retention_change_kind = 'cancel_pii_purge_due'
         AND EXISTS (
           SELECT 1 FROM participant_pii_archives AS archive
           WHERE archive.beneficiary_id = OLD.beneficiary_id AND archive.org_id = OLD.org_id
             AND archive.review_status <> 'purged'
             AND NEW.enc_name IS archive.enc_name
             AND NEW.enc_phone IS archive.enc_phone
             AND NEW.enc_account IS archive.enc_account
             AND NEW.enc_email IS archive.enc_email
             AND NEW.enc_birth_date IS archive.enc_birth_date
             AND NEW.enc_region IS archive.enc_region
             AND NEW.enc_emergency_contact IS archive.enc_emergency_contact
             AND NEW.enc_gender IS archive.enc_gender
         )
       )
     );
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_no_revive_guard
BEFORE UPDATE ON participant_pii_vault
WHEN OLD.purged_at IS NOT NULL AND NEW.retention_change_kind <> 're_register_pii'
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  VALUES (NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
          NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL AND NEW.purge_due IS NOT NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NULL AND OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL
    AND NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
    AND NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii' AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL AND NEW.enc_phone IS NOT NULL AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role = 'admin');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id AND status = 'active');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT min(
      strftime('%Y-%m-%dT%H:%M:%fZ',
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id),
        '+' || (SELECT pii_purge_grace_days
                FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
      ),
      CASE strftime(
        '%m-%d',
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id)
      )
        WHEN '02-29' THEN strftime('%Y-%m-%dT%H:%M:%fZ',
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years', '-1 day'
        )
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years'
        )
      END
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.purged_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND EXISTS (
    SELECT 1 FROM support_cases WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND min(
      julianday(OLD.purge_due),
      COALESCE(
        (
          SELECT julianday(retention_cap_due_at)
          FROM participant_pii_archives
          WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
        ),
        julianday(OLD.purge_due)
      )
    ) > julianday('now');
END;

CREATE TRIGGER participant_pii_vault_reviewed_purge_guard
BEFORE UPDATE OF purged_at ON participant_pii_vault
WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM participant_pii_archives
    WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
      AND review_status = 'approved' AND approved_by = NEW.purged_by
  );
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER pilot_text_ai_consent_evidence_no_update
BEFORE UPDATE ON pilot_text_ai_consent_evidence
BEGIN SELECT RAISE(ABORT, 'phase1: pilot text-AI consent evidence is append-only'); END;

CREATE TRIGGER recording_result_commits_immutable
BEFORE UPDATE ON recording_result_commits
WHEN NEW.session_id IS NOT OLD.session_id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.result_sha256 IS NOT OLD.result_sha256
  OR NEW.emotion_scores IS NOT OLD.emotion_scores
  OR NEW.transcript_quality IS NOT OLD.transcript_quality
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.finalized_at IS NOT NULL AND (
    NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.downstream_claimed_at IS NOT OLD.downstream_claimed_at
  ))
BEGIN
  SELECT RAISE(ABORT, 'recording result commits are immutable except finalization');
END;

CREATE TRIGGER session_discrepancies_content_immutable
BEFORE UPDATE ON session_discrepancies
WHEN OLD.id <> NEW.id
  OR OLD.org_id <> NEW.org_id
  OR OLD.support_case_id <> NEW.support_case_id
  OR OLD.kind <> NEW.kind
  OR OLD.trigger_session_id <> NEW.trigger_session_id
  OR OLD.left_session_id <> NEW.left_session_id
  OR OLD.left_quote <> NEW.left_quote
  OR OLD.right_session_id <> NEW.right_session_id
  OR OLD.right_quote <> NEW.right_quote
  OR OLD.detected_at <> NEW.detected_at
  OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'session_discrepancies: detected content is immutable');
END;

CREATE TRIGGER sessions_approved_ai_compatibility_immutable
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN OLD.approved_at IS NOT NULL
 AND (NEW.ai_status IS NOT OLD.ai_status OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
BEGIN SELECT RAISE(ABORT, 'phase1: approved session AI compatibility fields are immutable'); END;

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
 AND NOT (
   NEW.ai_status = 'approved' AND NEW.approved_at IS NOT NULL AND EXISTS (
     SELECT 1 FROM approved_ai_briefing_v1 AS briefing
     WHERE briefing.session_id = NEW.id AND briefing.summary_text IS NEW.ai_summary
       AND briefing.approved_by IS NEW.approved_by AND briefing.approved_at IS NEW.approved_at
   )
 )
BEGIN SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review'); END;

CREATE TRIGGER support_case_assignees_lifecycle_update_guard
BEFORE UPDATE OF
  status, acceptance_requested_by, accepted_at, transfer_reason, notified_by, notified_at
ON support_case_assignees
WHEN
  NEW.acceptance_requested_by IS NOT OLD.acceptance_requested_by
  OR NEW.notified_by IS NOT OLD.notified_by
  OR NEW.notified_at IS NOT OLD.notified_at
  OR (
    NEW.status IS NOT OLD.status
    AND NOT (
      (OLD.status = 'requested' AND NEW.status = 'active'
       AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
       AND NEW.unassigned_at IS NULL)
      OR
      (OLD.status IN ('requested', 'active') AND NEW.status = 'ended'
       AND OLD.unassigned_at IS NULL AND NEW.unassigned_at IS NOT NULL)
    )
  )
  OR (
    NEW.accepted_at IS NOT OLD.accepted_at
    AND NOT (
      OLD.status = 'requested' AND NEW.status = 'active'
      AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
    )
  )
  OR (
    NEW.transfer_reason IS NOT OLD.transfer_reason
    AND NOT (
      OLD.status IN ('requested', 'active') AND NEW.status = 'ended'
      AND OLD.unassigned_at IS NULL AND NEW.unassigned_at IS NOT NULL
      AND OLD.transfer_reason IS NULL
      AND NEW.transfer_reason IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'assignment_lifecycle_immutable');
END;

CREATE TRIGGER support_case_assignees_unassign_guard
BEFORE UPDATE OF id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
ON support_case_assignees
WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.role IS NOT OLD.role OR NEW.assigned_at IS NOT OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL OR NEW.unassigned_at IS NULL
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed' OR NEW.closed_at IS NULL
     OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.closed_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER support_cases_emergency_registration_immutable_guard
BEFORE UPDATE OF emergency_registration_at, emergency_registration_reason, consent_privacy_due_at
ON support_cases
WHEN NEW.emergency_registration_at IS NOT OLD.emergency_registration_at
  OR NEW.emergency_registration_reason IS NOT OLD.emergency_registration_reason
  OR NEW.consent_privacy_due_at IS NOT OLD.consent_privacy_due_at
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id, org_id, beneficiary_id, legacy_case_id, creation_kind,
                 creation_submission_id, creation_payload_hash, created_by_actor_id,
                 source_support_case_id, initial_assignee_user_id ON support_cases
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM support_cases AS active_case
    WHERE active_case.beneficiary_id = NEW.beneficiary_id
      AND active_case.org_id = NEW.org_id
      AND active_case.status = 'active'
  )
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = min(
           strftime('%Y-%m-%dT%H:%M:%fZ',
             NEW.closed_at,
             '+' || COALESCE(
               (SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = NEW.org_id),
               365
             ) || ' days'
           ),
           CASE strftime('%m-%d', NEW.closed_at)
             WHEN '02-29' THEN strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closed_at, '+5 years', '-1 day')
             ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closed_at, '+5 years')
           END
         ),
         version = version + 1,
         retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NULL;
END;

CREATE TRIGGER users_last_required_roles_guard
BEFORE UPDATE OF active ON users
WHEN OLD.active = 1 AND NEW.active = 0
BEGIN
  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );

  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_technical_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_technical_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );
END;

CREATE TRIGGER users_sync_independent_roles_after_role_update
AFTER UPDATE OF role ON users
WHEN NEW.role IS NOT OLD.role
BEGIN
  UPDATE user_role_assignments
  SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE org_id = NEW.org_id
    AND user_id = NEW.id
    AND source = 'legacy'
    AND revoked_at IS NULL;

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_technical_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'practitioner',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'counselor';
END;

CREATE TABLE sql_timestamp_normalization_assertions (
  table_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'action_items', CASE WHEN EXISTS (SELECT 1 FROM action_items WHERE resolved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR resolution_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'agent_installations', CASE WHEN EXISTS (SELECT 1 FROM agent_installations WHERE paired_at GLOB '????-??-?? ??:??:??' OR revoked_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_draft_contrast_axes', CASE WHEN EXISTS (SELECT 1 FROM ai_draft_contrast_axes WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_draft_source_materials', CASE WHEN EXISTS (SELECT 1 FROM ai_draft_source_materials WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_draft_versions', CASE WHEN EXISTS (SELECT 1 FROM ai_draft_versions WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_evidence_links', CASE WHEN EXISTS (SELECT 1 FROM ai_evidence_links WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_gas_evidence', CASE WHEN EXISTS (SELECT 1 FROM ai_gas_evidence WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_masked_source_evidence_items', CASE WHEN EXISTS (SELECT 1 FROM ai_masked_source_evidence_items WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_masked_source_snapshots', CASE WHEN EXISTS (SELECT 1 FROM ai_masked_source_snapshots WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_provider_activations', CASE WHEN EXISTS (SELECT 1 FROM ai_provider_activations WHERE activated_at GLOB '????-??-?? ??:??:??' OR deactivated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_provider_configs', CASE WHEN EXISTS (SELECT 1 FROM ai_provider_configs WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_review_events', CASE WHEN EXISTS (SELECT 1 FROM ai_review_events WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_text_work_queue', CASE WHEN EXISTS (SELECT 1 FROM ai_text_work_queue WHERE enqueued_at GLOB '????-??-?? ??:??:??' OR completed_at GLOB '????-??-?? ??:??:??' OR lease_expires_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'ai_work_items', CASE WHEN EXISTS (SELECT 1 FROM ai_work_items WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'audit_log', CASE WHEN EXISTS (SELECT 1 FROM audit_log WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'auth_revocations', CASE WHEN EXISTS (SELECT 1 FROM auth_revocations WHERE revoked_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'beneficiaries', CASE WHEN EXISTS (SELECT 1 FROM beneficiaries WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'counseling_schedules', CASE WHEN EXISTS (SELECT 1 FROM counseling_schedules WHERE scheduled_at GLOB '????-??-?? ??:??:??' OR completed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'flags', CASE WHEN EXISTS (SELECT 1 FROM flags WHERE reviewed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'goal_revisions', CASE WHEN EXISTS (SELECT 1 FROM goal_revisions WHERE edited_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'goals', CASE WHEN EXISTS (SELECT 1 FROM goals WHERE closed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'invite_tokens', CASE WHEN EXISTS (SELECT 1 FROM invite_tokens WHERE issued_at GLOB '????-??-?? ??:??:??' OR used_at GLOB '????-??-?? ??:??:??' OR revoked_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'organization_settings', CASE WHEN EXISTS (SELECT 1 FROM organization_settings WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'participant_consent_records', CASE WHEN EXISTS (SELECT 1 FROM participant_consent_records WHERE consent_recording_at GLOB '????-??-?? ??:??:??' OR consent_text_ai_at GLOB '????-??-?? ??:??:??' OR recorded_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR consent_privacy_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'participant_pii_archives', CASE WHEN EXISTS (SELECT 1 FROM participant_pii_archives WHERE archived_at GLOB '????-??-?? ??:??:??' OR retention_cap_due_at GLOB '????-??-?? ??:??:??' OR review_due_at GLOB '????-??-?? ??:??:??' OR reviewed_at GLOB '????-??-?? ??:??:??' OR approved_at GLOB '????-??-?? ??:??:??' OR purged_at GLOB '????-??-?? ??:??:??' OR state_changed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'participant_pii_retention_decisions', CASE WHEN EXISTS (SELECT 1 FROM participant_pii_retention_decisions WHERE decided_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'participant_pii_vault', CASE WHEN EXISTS (SELECT 1 FROM participant_pii_vault WHERE purge_due GLOB '????-??-?? ??:??:??' OR purged_at GLOB '????-??-?? ??:??:??' OR retention_changed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'participant_support_case_cutover_manifest', CASE WHEN EXISTS (SELECT 1 FROM participant_support_case_cutover_manifest WHERE completed_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'pilot_text_ai_consent_evidence', CASE WHEN EXISTS (SELECT 1 FROM pilot_text_ai_consent_evidence WHERE effective_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'recording_result_commits', CASE WHEN EXISTS (SELECT 1 FROM recording_result_commits WHERE created_at GLOB '????-??-?? ??:??:??' OR downstream_claimed_at GLOB '????-??-?? ??:??:??' OR finalized_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'schedule_custom_questions', CASE WHEN EXISTS (SELECT 1 FROM schedule_custom_questions WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'schedule_session_goals', CASE WHEN EXISTS (SELECT 1 FROM schedule_session_goals WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'session_discrepancies', CASE WHEN EXISTS (SELECT 1 FROM session_discrepancies WHERE detected_at GLOB '????-??-?? ??:??:??' OR resolved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'session_goal_scores', CASE WHEN EXISTS (SELECT 1 FROM session_goal_scores WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'session_life_area_snapshots', CASE WHEN EXISTS (SELECT 1 FROM session_life_area_snapshots WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'sessions', CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE held_at GLOB '????-??-?? ??:??:??' OR speaker_mapping_confirmed_at GLOB '????-??-?? ??:??:??' OR approved_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'support_case_assignees', CASE WHEN EXISTS (SELECT 1 FROM support_case_assignees WHERE assigned_at GLOB '????-??-?? ??:??:??' OR unassigned_at GLOB '????-??-?? ??:??:??' OR accepted_at GLOB '????-??-?? ??:??:??' OR notified_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'support_cases', CASE WHEN EXISTS (SELECT 1 FROM support_cases WHERE intake_at GLOB '????-??-?? ??:??:??' OR consent_recording_at GLOB '????-??-?? ??:??:??' OR consent_text_ai_at GLOB '????-??-?? ??:??:??' OR closed_at GLOB '????-??-?? ??:??:??' OR created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??' OR consent_privacy_at GLOB '????-??-?? ??:??:??' OR emergency_registration_at GLOB '????-??-?? ??:??:??' OR consent_privacy_due_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'team_memberships', CASE WHEN EXISTS (SELECT 1 FROM team_memberships WHERE joined_at GLOB '????-??-?? ??:??:??' OR ended_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'team_supervisor_grants', CASE WHEN EXISTS (SELECT 1 FROM team_supervisor_grants WHERE granted_at GLOB '????-??-?? ??:??:??' OR revoked_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'teams', CASE WHEN EXISTS (SELECT 1 FROM teams WHERE created_at GLOB '????-??-?? ??:??:??' OR archived_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'user_role_assignments', CASE WHEN EXISTS (SELECT 1 FROM user_role_assignments WHERE granted_at GLOB '????-??-?? ??:??:??' OR revoked_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

INSERT INTO sql_timestamp_normalization_assertions (table_name, ok)
SELECT 'users', CASE WHEN EXISTS (SELECT 1 FROM users WHERE created_at GLOB '????-??-?? ??:??:??') THEN 0 ELSE 1 END;

DROP TABLE sql_timestamp_normalization_assertions;
