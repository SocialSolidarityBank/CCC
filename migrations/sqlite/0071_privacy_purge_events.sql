-- F5: durable, content-free privacy purge authority shared with CCC-224/E3-7 restore.
CREATE TABLE privacy_purge_events (
  event_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  approval_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('intent','complete')),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  beneficiary_id TEXT NOT NULL,
  lifecycle_id TEXT NOT NULL,
  support_case_ids_json TEXT NOT NULL CHECK (json_valid(support_case_ids_json) AND json_type(support_case_ids_json)='array'),
  namespace_ids_json TEXT NOT NULL CHECK (json_valid(namespace_ids_json) AND json_type(namespace_ids_json)='array'),
  source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json) AND json_type(source_ids_json)='array'),
  previous_event_digest TEXT CHECK (previous_event_digest IS NULL OR (length(previous_event_digest)=64 AND previous_event_digest NOT GLOB '*[^0-9a-f]*')),
  metadata_digest TEXT NOT NULL CHECK (length(metadata_digest)=64 AND metadata_digest NOT GLOB '*[^0-9a-f]*'),
  scope_envelope TEXT NOT NULL CHECK (length(scope_envelope)>0),
  key_version INTEGER NOT NULL CHECK (key_version BETWEEN 1 AND 9007199254740991),
  UNIQUE (org_id, sequence),
  UNIQUE (approval_id, phase)
);
CREATE INDEX privacy_purge_events_scope
  ON privacy_purge_events(org_id,beneficiary_id,lifecycle_id,sequence);

CREATE TRIGGER privacy_purge_events_insert_guard
BEFORE INSERT ON privacy_purge_events
BEGIN
  SELECT RAISE(ABORT,'privacy_purge_events_sequence_invalid')
  WHERE NEW.sequence <> COALESCE((SELECT MAX(sequence)+1 FROM privacy_purge_events WHERE org_id=NEW.org_id),1);
  SELECT RAISE(ABORT,'privacy_purge_events_chain_invalid')
  WHERE NEW.previous_event_digest IS NOT (
    SELECT metadata_digest FROM privacy_purge_events WHERE org_id=NEW.org_id ORDER BY sequence DESC LIMIT 1
  );
  SELECT RAISE(ABORT,'privacy_purge_events_actor_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id=NEW.actor_id AND org_id=NEW.org_id AND active=1
  );
  SELECT RAISE(ABORT,'privacy_purge_events_complete_invalid')
  WHERE NEW.phase='complete' AND NOT EXISTS (
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=NEW.org_id AND intent.approval_id=NEW.approval_id AND intent.phase='intent'
      AND intent.actor_id=NEW.actor_id AND intent.beneficiary_id=NEW.beneficiary_id
      AND intent.lifecycle_id=NEW.lifecycle_id
      AND intent.support_case_ids_json=NEW.support_case_ids_json
      AND intent.namespace_ids_json=NEW.namespace_ids_json
      AND intent.source_ids_json=NEW.source_ids_json
  );
  SELECT RAISE(ABORT,'privacy_purge_events_residual_scope')
  WHERE NEW.phase='complete' AND (
    EXISTS (
      SELECT 1 FROM support_cases
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (legacy_case_id IS NOT NULL OR intake_at IS NOT NULL
          OR consent_recording_at IS NOT NULL OR consent_text_ai_at IS NOT NULL
          OR extra IS NOT NULL OR overall_goal IS NOT NULL
          OR entity_map_lease_family IS NOT NULL OR entity_map_lease_job_id IS NOT NULL
          OR entity_map_lease_attempt IS NOT NULL OR entity_map_lease_expires_at IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1 FROM sessions
      WHERE org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=sessions.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=support_case_assignees.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM ai_text_work_queue
      WHERE org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=ai_text_work_queue.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM agent_jobs
      WHERE org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=agent_jobs.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM counseling_memory_cases
      WHERE org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=counseling_memory_cases.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (purged_at IS NULL OR enc_name IS NOT NULL OR enc_phone IS NOT NULL OR enc_account IS NOT NULL
          OR enc_email IS NOT NULL OR enc_birth_date IS NOT NULL OR enc_region IS NOT NULL
          OR enc_emergency_contact IS NOT NULL OR enc_gender IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1 FROM participant_pii_archives
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (review_status<>'purged' OR enc_name IS NOT NULL OR enc_phone IS NOT NULL OR enc_account IS NOT NULL
          OR enc_email IS NOT NULL OR enc_birth_date IS NOT NULL OR enc_region IS NOT NULL
          OR enc_emergency_contact IS NOT NULL OR enc_gender IS NOT NULL)
    )
    OR EXISTS (
      SELECT 1 FROM consent_events AS consent
      WHERE consent.org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=consent.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM consent_disclosure_snapshots AS disclosure
      WHERE disclosure.org_id=NEW.org_id
        AND EXISTS (SELECT 1 FROM json_each(NEW.support_case_ids_json) WHERE value=disclosure.support_case_id)
    )
    OR EXISTS (
      SELECT 1 FROM participant_consent_records AS legacy_consent
      WHERE legacy_consent.org_id=NEW.org_id
        AND EXISTS (
          SELECT 1 FROM json_each(NEW.support_case_ids_json)
          WHERE value=legacy_consent.support_case_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM agent_job_egress_records AS egress
      WHERE egress.org_id=NEW.org_id
        AND EXISTS (
          SELECT 1 FROM json_each(NEW.source_ids_json)
          WHERE value='egress:' || egress.id
        )
    )
  );
END;
CREATE TRIGGER privacy_purge_events_no_update
BEFORE UPDATE ON privacy_purge_events
BEGIN SELECT RAISE(ABORT,'privacy_purge_events_append_only'); END;
CREATE TRIGGER privacy_purge_events_no_delete
BEFORE DELETE ON privacy_purge_events
BEGIN SELECT RAISE(ABORT,'privacy_purge_events_append_only'); END;

-- Final purge is now gateway-owned so intent and residual verification bracket the mutation.
DROP TRIGGER participant_pii_archives_approved_purge;

-- Historical manual revisions remain immutable except inside an open F5 intent
-- whose plaintext scope contains the owning support case.
DROP TRIGGER manual_record_revisions_no_delete;
CREATE TRIGGER manual_record_revisions_no_delete
BEFORE DELETE ON manual_record_revisions
WHEN NOT EXISTS (
  SELECT 1
  FROM sessions
  JOIN privacy_purge_events AS intent
    ON intent.org_id=sessions.org_id AND intent.phase='intent'
   AND intent.beneficiary_id=(SELECT beneficiary_id FROM support_cases WHERE id=sessions.support_case_id)
  WHERE sessions.id=OLD.session_id
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=sessions.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'manual_history_immutable'); END;

DROP TRIGGER ai_text_work_queue_no_delete;
CREATE TRIGGER ai_text_work_queue_no_delete
BEFORE DELETE ON ai_text_work_queue
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'text work items are append-only'); END;

DROP TRIGGER participant_consent_records_no_delete;
CREATE TRIGGER participant_consent_records_no_delete
BEFORE DELETE ON participant_consent_records
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'D23: participant consent records are append-only'); END;

DROP TRIGGER consent_events_no_delete;
CREATE TRIGGER consent_events_no_delete
BEFORE DELETE ON consent_events
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'consent_events_append_only'); END;

DROP TRIGGER consent_disclosures_no_delete;
CREATE TRIGGER consent_disclosures_no_delete
BEFORE DELETE ON consent_disclosure_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'consent_disclosures_immutable'); END;

DROP TRIGGER cm_sessions_delete;
CREATE TRIGGER cm_sessions_delete
AFTER DELETE ON sessions
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.support_case_id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN
  INSERT INTO counseling_memory_cases(support_case_id,org_id)
    VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
  INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted)
    VALUES(OLD.org_id,OLD.support_case_id,'session',OLD.id,1)
    ON CONFLICT(org_id,support_case_id,kind,source_id)
    DO UPDATE SET revision=revision+1,dirty=1,deleted=1;
  UPDATE counseling_memory_materials SET valid=0,lease_token=NULL
    WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id;
  UPDATE counseling_memory_items SET valid=0
    WHERE json_extract(item_json,'$.correctedAt') IS NULL
      AND id IN(SELECT item_id FROM counseling_memory_links
        WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id);
  UPDATE counseling_memory_cases
    SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,
        not_before=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds')
    WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;
END;

DROP TRIGGER support_cases_close_guard;
CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status,closed_at,closed_reason,closed_by_actor_id ON support_cases
WHEN (
  NEW.status IS NOT OLD.status OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
) AND NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.id)
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN
  SELECT RAISE(ABORT,'participant_schema_violation')
  WHERE OLD.status<>'active' OR NEW.status<>'closed' OR NEW.closed_at IS NULL
     OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;
  SELECT RAISE(ABORT,'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id=NEW.closed_by_actor_id AND org_id=NEW.org_id
      AND active=1 AND role IN ('admin','counselor')
  );
END;

DROP TRIGGER support_cases_immutable_identity_guard;
CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id,org_id,beneficiary_id,legacy_case_id,creation_kind,
                 creation_submission_id,creation_payload_hash,created_by_actor_id,
                 source_support_case_id,initial_assignee_user_id ON support_cases
WHEN NOT EXISTS (
  SELECT 1 FROM privacy_purge_events AS intent
  WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
    AND EXISTS (SELECT 1 FROM json_each(intent.support_case_ids_json) WHERE value=OLD.id)
    AND NEW.id IS OLD.id AND NEW.org_id IS OLD.org_id AND NEW.beneficiary_id IS OLD.beneficiary_id
    AND NEW.creation_kind IS OLD.creation_kind
    AND NEW.creation_submission_id IS OLD.creation_submission_id
    AND NEW.creation_payload_hash IS OLD.creation_payload_hash
    AND NEW.created_by_actor_id IS OLD.created_by_actor_id
    AND NEW.source_support_case_id IS OLD.source_support_case_id
    AND NEW.initial_assignee_user_id IS OLD.initial_assignee_user_id
    AND NEW.legacy_case_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM privacy_purge_events AS complete
      WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
        AND complete.phase='complete'
    )
)
BEGIN SELECT RAISE(ABORT,'participant_schema_violation'); END;
