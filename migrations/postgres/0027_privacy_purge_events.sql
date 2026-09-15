-- Logical pair: SQLite 0071_privacy_purge_events.sql.
-- F5: durable, content-free privacy purge authority shared with CCC-224/E3-7 restore.
CREATE TABLE privacy_purge_events (
  event_id text CONSTRAINT privacy_purge_events_nullable_pk UNIQUE,
  org_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  approval_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('intent','complete')),
  actor_id text NOT NULL,
  occurred_at text NOT NULL,
  beneficiary_id text NOT NULL,
  lifecycle_id text NOT NULL,
  support_case_ids_json text NOT NULL CHECK (jsonb_typeof(support_case_ids_json::jsonb)='array'),
  namespace_ids_json text NOT NULL CHECK (jsonb_typeof(namespace_ids_json::jsonb)='array'),
  source_ids_json text NOT NULL CHECK (jsonb_typeof(source_ids_json::jsonb)='array'),
  previous_event_digest text CHECK (previous_event_digest IS NULL OR previous_event_digest ~ '^[0-9a-f]{64}$'),
  metadata_digest text NOT NULL CHECK (metadata_digest ~ '^[0-9a-f]{64}$'),
  scope_envelope text NOT NULL CHECK (length(scope_envelope)>0),
  key_version bigint NOT NULL CHECK (key_version BETWEEN 1 AND 9007199254740991),
  UNIQUE (org_id,sequence),
  UNIQUE (approval_id,phase)
);
COMMENT ON CONSTRAINT privacy_purge_events_nullable_pk ON privacy_purge_events IS 'ccc:sqlite-primary-key';
CREATE INDEX privacy_purge_events_scope
  ON privacy_purge_events(org_id,beneficiary_id,lifecycle_id,sequence);

CREATE FUNCTION ccc_privacy_purge_events_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_digest text;
BEGIN
  SELECT metadata_digest INTO previous_digest FROM privacy_purge_events
    WHERE org_id=NEW.org_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> COALESCE((SELECT MAX(sequence)+1 FROM privacy_purge_events WHERE org_id=NEW.org_id),1)
     OR NEW.previous_event_digest IS DISTINCT FROM previous_digest THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='privacy_purge_events_chain_invalid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND org_id=NEW.org_id AND active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='privacy_purge_events_actor_invalid';
  END IF;
  IF NEW.phase='complete' AND NOT EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=NEW.org_id AND intent.approval_id=NEW.approval_id AND intent.phase='intent'
      AND intent.actor_id=NEW.actor_id AND intent.beneficiary_id=NEW.beneficiary_id
      AND intent.lifecycle_id=NEW.lifecycle_id
      AND intent.support_case_ids_json=NEW.support_case_ids_json
      AND intent.namespace_ids_json=NEW.namespace_ids_json
      AND intent.source_ids_json=NEW.source_ids_json
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='privacy_purge_events_complete_invalid';
  END IF;
  IF NEW.phase='complete' AND (
    EXISTS(
      SELECT 1 FROM support_cases
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (legacy_case_id IS NOT NULL OR intake_at IS NOT NULL
          OR consent_recording_at IS NOT NULL OR consent_text_ai_at IS NOT NULL
          OR extra IS NOT NULL OR overall_goal IS NOT NULL
          OR entity_map_lease_family IS NOT NULL OR entity_map_lease_job_id IS NOT NULL
          OR entity_map_lease_attempt IS NOT NULL OR entity_map_lease_expires_at IS NOT NULL)
    )
    OR EXISTS(
      SELECT 1 FROM sessions
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM support_case_assignees
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM ai_text_work_queue
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM agent_jobs
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM counseling_memory_cases
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM participant_pii_vault
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (purged_at IS NULL OR enc_name IS NOT NULL OR enc_phone IS NOT NULL OR enc_account IS NOT NULL
          OR enc_email IS NOT NULL OR enc_birth_date IS NOT NULL OR enc_region IS NOT NULL
          OR enc_emergency_contact IS NOT NULL OR enc_gender IS NOT NULL)
    )
    OR EXISTS(
      SELECT 1 FROM participant_pii_archives
      WHERE org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id
        AND (review_status<>'purged' OR enc_name IS NOT NULL OR enc_phone IS NOT NULL OR enc_account IS NOT NULL
          OR enc_email IS NOT NULL OR enc_birth_date IS NOT NULL OR enc_region IS NOT NULL
          OR enc_emergency_contact IS NOT NULL OR enc_gender IS NOT NULL)
    )
    OR EXISTS(
      SELECT 1 FROM consent_events
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM consent_disclosure_snapshots
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM participant_consent_records
      WHERE org_id=NEW.org_id AND NEW.support_case_ids_json::jsonb ? support_case_id
    )
    OR EXISTS(
      SELECT 1 FROM agent_job_egress_records
      WHERE org_id=NEW.org_id AND id IN (
        SELECT substr(value,8) FROM jsonb_array_elements_text(NEW.source_ids_json::jsonb)
        WHERE value LIKE 'egress:%'
      )
  )) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='privacy_purge_events_residual_scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_purge_events_insert_guard BEFORE INSERT ON privacy_purge_events
FOR EACH ROW EXECUTE FUNCTION ccc_privacy_purge_events_insert_guard();
CREATE TRIGGER privacy_purge_events_no_update BEFORE UPDATE ON privacy_purge_events
FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('privacy_purge_events_append_only');
CREATE TRIGGER privacy_purge_events_no_delete BEFORE DELETE ON privacy_purge_events
FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('privacy_purge_events_append_only');

DROP TRIGGER participant_pii_archives_approved_purge ON participant_pii_archives;

CREATE FUNCTION ccc_manual_revision_privacy_purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM sessions
    JOIN privacy_purge_events AS intent
      ON intent.org_id=sessions.org_id AND intent.phase='intent'
     AND intent.beneficiary_id=(SELECT beneficiary_id FROM support_cases WHERE id=sessions.support_case_id)
    WHERE sessions.id=OLD.session_id
      AND intent.support_case_ids_json::jsonb ? sessions.support_case_id
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='manual_history_immutable';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER manual_record_revisions_no_delete ON manual_record_revisions;
CREATE TRIGGER manual_record_revisions_no_delete BEFORE DELETE ON manual_record_revisions
FOR EACH ROW EXECUTE FUNCTION ccc_manual_revision_privacy_purge_guard();


CREATE FUNCTION ccc_text_work_privacy_purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
      AND intent.support_case_ids_json::jsonb ? OLD.support_case_id
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='text work items are append-only';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER ai_text_work_queue_no_delete ON ai_text_work_queue;
CREATE TRIGGER ai_text_work_queue_no_delete BEFORE DELETE ON ai_text_work_queue
FOR EACH ROW EXECUTE FUNCTION ccc_text_work_privacy_purge_guard();

CREATE FUNCTION ccc_consent_privacy_purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
      AND intent.support_case_ids_json::jsonb ? OLD.support_case_id
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='consent_history_immutable';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER participant_consent_records_no_delete ON participant_consent_records;
CREATE TRIGGER participant_consent_records_no_delete BEFORE DELETE ON participant_consent_records
FOR EACH ROW EXECUTE FUNCTION ccc_consent_privacy_purge_guard();
DROP TRIGGER consent_events_no_delete ON consent_events;
CREATE TRIGGER consent_events_no_delete BEFORE DELETE ON consent_events
FOR EACH ROW EXECUTE FUNCTION ccc_consent_privacy_purge_guard();
DROP TRIGGER consent_disclosures_no_delete ON consent_disclosure_snapshots;
CREATE TRIGGER consent_disclosures_no_delete BEFORE DELETE ON consent_disclosure_snapshots
FOR EACH ROW EXECUTE FUNCTION ccc_consent_privacy_purge_guard();

CREATE OR REPLACE FUNCTION cm_sessions_delete_fn() RETURNS trigger LANGUAGE plpgsql AS $memory$
BEGIN
  IF EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
      AND intent.support_case_ids_json::jsonb ? OLD.support_case_id
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN RETURN NULL;
  END IF;
  INSERT INTO counseling_memory_cases(support_case_id,org_id)
    VALUES(OLD.support_case_id,OLD.org_id) ON CONFLICT(support_case_id) DO NOTHING;
  INSERT INTO counseling_memory_sources(org_id,support_case_id,kind,source_id,deleted)
    VALUES(OLD.org_id,OLD.support_case_id,'session',OLD.id,1)
    ON CONFLICT(org_id,support_case_id,kind,source_id)
    DO UPDATE SET revision=counseling_memory_sources.revision+1,dirty=1,deleted=1;
  UPDATE counseling_memory_materials SET valid=0,lease_token=NULL
    WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id;
  UPDATE counseling_memory_items SET valid=0
    WHERE (item_json::jsonb ->> 'correctedAt') IS NULL
      AND id IN(SELECT item_id FROM counseling_memory_links
        WHERE org_id=OLD.org_id AND support_case_id=OLD.support_case_id AND kind='session' AND source_id=OLD.id);
  UPDATE counseling_memory_cases
    SET generation=generation+1,status='updating',request_json=NULL,egress=NULL,lease_token=NULL,
        not_before=to_char((statement_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
    WHERE support_case_id=OLD.support_case_id AND org_id=OLD.org_id;
  RETURN NULL;
END
$memory$;

CREATE OR REPLACE FUNCTION support_cases_close_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
      AND intent.support_case_ids_json::jsonb ? OLD.id
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    OR NEW.closed_reason IS DISTINCT FROM OLD.closed_reason OR NEW.closed_by_actor_id IS DISTINCT FROM OLD.closed_by_actor_id THEN
    IF OLD.status<>'active' OR NEW.status<>'closed' OR NEW.closed_at IS NULL
      OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL
      OR NOT EXISTS(
        SELECT 1 FROM users
        WHERE id=NEW.closed_by_actor_id AND org_id=NEW.org_id AND active=1
          AND role IN ('admin','counselor')
      ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ccc_support_case_privacy_purge_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM privacy_purge_events AS intent
    WHERE intent.org_id=OLD.org_id AND intent.phase='intent'
      AND intent.support_case_ids_json::jsonb ? OLD.id
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
      AND NEW.beneficiary_id IS NOT DISTINCT FROM OLD.beneficiary_id
      AND NEW.creation_kind IS NOT DISTINCT FROM OLD.creation_kind
      AND NEW.creation_submission_id IS NOT DISTINCT FROM OLD.creation_submission_id
      AND NEW.creation_payload_hash IS NOT DISTINCT FROM OLD.creation_payload_hash
      AND NEW.created_by_actor_id IS NOT DISTINCT FROM OLD.created_by_actor_id
      AND NEW.source_support_case_id IS NOT DISTINCT FROM OLD.source_support_case_id
      AND NEW.initial_assignee_user_id IS NOT DISTINCT FROM OLD.initial_assignee_user_id
      AND NEW.legacy_case_id IS NULL
      AND NOT EXISTS(
        SELECT 1 FROM privacy_purge_events AS complete
        WHERE complete.org_id=intent.org_id AND complete.approval_id=intent.approval_id
          AND complete.phase='complete'
      )
  ) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
END $$;
DROP TRIGGER support_cases_immutable_identity_guard ON support_cases;
CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id,org_id,beneficiary_id,legacy_case_id,creation_kind,
  creation_submission_id,creation_payload_hash,created_by_actor_id,
  source_support_case_id,initial_assignee_user_id ON support_cases
FOR EACH ROW EXECUTE FUNCTION ccc_support_case_privacy_purge_identity_guard();
ALTER TABLE privacy_purge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_purge_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_purge_events FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_schema_owner') THEN
    EXECUTE 'ALTER TABLE privacy_purge_events OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_privacy_purge_events_insert_guard() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_manual_revision_privacy_purge_guard() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_text_work_privacy_purge_guard() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_consent_privacy_purge_guard() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION cm_sessions_delete_fn() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION support_cases_close_guard_fn() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_support_case_privacy_purge_identity_guard() OWNER TO ccc_schema_owner';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_api') THEN
    EXECUTE 'GRANT SELECT,INSERT ON privacy_purge_events TO ccc_api';
    EXECUTE 'CREATE POLICY privacy_purge_events_scope ON privacy_purge_events TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_privacy_purge_events_insert_guard() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_manual_revision_privacy_purge_guard() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_text_work_privacy_purge_guard() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION cm_sessions_delete_fn() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_consent_privacy_purge_guard() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION support_cases_close_guard_fn() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_support_case_privacy_purge_identity_guard() TO ccc_api';
  END IF;
END
$$;
