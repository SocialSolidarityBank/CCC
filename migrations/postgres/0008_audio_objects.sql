-- S8 generation-bound original-audio lifecycle and STT readiness.
CREATE TABLE stt_agent_readiness (
  org_id text NOT NULL, agent_id text NOT NULL,
  schema_version bigint NOT NULL CHECK(schema_version=1),
  stt_mode text NOT NULL CHECK(stt_mode IN ('off','local','azure')),
  stt_engine_id text CHECK(stt_engine_id IS NULL OR stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral')),
  state text NOT NULL CHECK(state IN ('ready','unavailable')),
  capacity bigint NOT NULL CHECK(capacity IN (0,1)), received_at text NOT NULL, expires_at text NOT NULL,
  PRIMARY KEY(org_id,agent_id),
  CHECK((stt_mode='off' AND stt_engine_id IS NULL AND state='unavailable' AND capacity=0) OR (stt_mode='local' AND stt_engine_id='qwen3-asr') OR (stt_mode='azure' AND stt_engine_id='azure-speech-koreacentral')),
  CHECK(state='ready' OR capacity=0)
);
CREATE INDEX stt_readiness_current ON stt_agent_readiness(org_id,stt_mode,stt_engine_id,state,expires_at,capacity);

CREATE TABLE audio_objects (
  id text CONSTRAINT audio_objects_nullable_pk UNIQUE, org_id text NOT NULL, session_id text NOT NULL, support_case_id text NOT NULL,
  key text NOT NULL UNIQUE, key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('pending_upload','available','claimed','processing','deletion_pending','processed_deleted','unprocessed_expired','upload_abandoned','retention_capped')),
  generation_id text NOT NULL, stt_route text NOT NULL CHECK(stt_route IN ('local','azure')),
  stt_engine_id text NOT NULL CHECK(stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral')),
  audio_delivery text NOT NULL CHECK(audio_delivery IN ('api-stream','protected-get')),
  content_length bigint NOT NULL CHECK(content_length BETWEEN 1 AND 209715200),
  content_type text NOT NULL CHECK(content_type IN ('audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/webm','audio/x-m4a')),
  client_asserted_sha256 text,
  storage_sha256 text CHECK(storage_sha256 IS NULL OR storage_sha256 ~ '^[0-9a-f]{64}$'),
  object_sha256 text,
  consent_gate_receipt_revision text NOT NULL, consent_gate_receipt_json text NOT NULL,
  eligible_after text NOT NULL, uploaded_at text, upload_expires_at text NOT NULL,
  upload_completion_id text,
  retention_hard_cap_at text NOT NULL, first_agent_available_at text, processing_deadline_at text,
  claim_id text, claim_agent_id text, claim_expires_at text,
  processing_attempt_id text, processing_started_at text, processed_at text,
  download_target_issued_at text, download_target_agent_id text, download_target_expires_at text,
  deletion_reason text CHECK(deletion_reason IS NULL OR deletion_reason IN ('processed','unprocessed_expiry','rejected_upload','hash_mismatch','upload_abandoned','consent_withdrawal','processing_failed','retry_exhausted','retention_hard_cap')),
  deletion_attempt_id text, next_attempt_at text, retry_count bigint NOT NULL DEFAULT 0 CHECK(retry_count>=0),
  incident_outbox_key text, manual_note_outbox_key text, deleted_at text, deletion_evidence text,
  created_at text NOT NULL, updated_at text NOT NULL,
  CHECK((state='deletion_pending')=(deletion_reason IS NOT NULL) OR state IN ('processed_deleted','unprocessed_expired','upload_abandoned','retention_capped'))
);
CREATE UNIQUE INDEX audio_objects_open_session ON audio_objects(org_id,session_id) WHERE state NOT IN ('processed_deleted','unprocessed_expired','upload_abandoned','retention_capped');
CREATE INDEX audio_objects_claim ON audio_objects(org_id,state,eligible_after,retention_hard_cap_at,created_at,id);
CREATE INDEX audio_objects_reconcile ON audio_objects(state,next_attempt_at,retention_hard_cap_at,id);

CREATE TABLE audio_deletion_attempts (
  id text CONSTRAINT audio_deletion_attempts_nullable_pk UNIQUE, deletion_attempt_id text NOT NULL,
  phase text NOT NULL CHECK(phase IN ('requested','verification')),
  org_id text NOT NULL, audio_object_id text NOT NULL REFERENCES audio_objects(id),
  generation_id text NOT NULL, reason text NOT NULL,
  requested_at text NOT NULL, provider_delete_accepted_at text, deleted_at text,
  delete_succeeded bigint CHECK(delete_succeeded IS NULL OR delete_succeeded IN (0,1)),
  absent_from_list bigint CHECK(absent_from_list IS NULL OR absent_from_list IN (0,1)),
  absent_from_metadata bigint CHECK(absent_from_metadata IS NULL OR absent_from_metadata IN (0,1)),
  direct_read_absent bigint CHECK(direct_read_absent IS NULL OR direct_read_absent IN (0,1)),
  verification_method text CHECK(verification_method IS NULL OR verification_method IN ('authenticated-get-404','filesystem-stat-enoent','r2-head-absent')),
  provider_status bigint, verified_at text, evidence_json text, created_at text NOT NULL,
  UNIQUE(deletion_attempt_id,phase,id)
);
CREATE INDEX audio_deletion_attempts_object ON audio_deletion_attempts(org_id,audio_object_id,created_at,id);
CREATE TRIGGER audio_deletion_attempts_no_update BEFORE UPDATE ON audio_deletion_attempts FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER audio_deletion_attempts_no_delete BEFORE DELETE ON audio_deletion_attempts FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();

CREATE TABLE audio_lifecycle_outbox (
  id text CONSTRAINT audio_lifecycle_outbox_nullable_pk UNIQUE, org_id text NOT NULL, audio_object_id text NOT NULL REFERENCES audio_objects(id),
  kind text NOT NULL CHECK(kind IN ('incident','manual_note')), reason text NOT NULL,
  created_at text NOT NULL, delivered_at text, UNIQUE(org_id,audio_object_id,kind,reason)
);
CREATE INDEX audio_lifecycle_outbox_pending ON audio_lifecycle_outbox(org_id,kind,delivered_at,created_at);
CREATE TABLE audio_download_target_mints (
  id text CONSTRAINT audio_download_target_mints_nullable_pk UNIQUE, org_id text NOT NULL, audio_object_id text NOT NULL REFERENCES audio_objects(id),
  job_id text NOT NULL REFERENCES agent_jobs(id), generation_id text NOT NULL,
  agent_id text NOT NULL, claim_token_hash text NOT NULL, attempt bigint NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','issued','failed')),
  requested_at text NOT NULL, issued_at text, expires_at text, failed_at text
);
CREATE INDEX audio_download_target_mints_job ON audio_download_target_mints(org_id,job_id,attempt,requested_at,id);
COMMENT ON CONSTRAINT audio_objects_nullable_pk ON audio_objects IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT audio_deletion_attempts_nullable_pk ON audio_deletion_attempts IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT audio_lifecycle_outbox_nullable_pk ON audio_lifecycle_outbox IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT audio_download_target_mints_nullable_pk ON audio_download_target_mints IS 'ccc:sqlite-primary-key';
ALTER TABLE agent_jobs ADD COLUMN audio_object_id text REFERENCES audio_objects(id);

CREATE FUNCTION ccc_agent_job_result_audio_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM agent_jobs WHERE id=NEW.job_id AND kind='audio')
     AND NOT EXISTS(
       SELECT 1 FROM agent_jobs AS job
       JOIN audio_objects AS audio ON audio.id=job.audio_object_id AND audio.org_id=job.org_id
       WHERE job.id=NEW.job_id AND job.state='leased' AND job.attempt=NEW.attempt
         AND job.claim_token_hash=NEW.claim_token_hash
         AND job.lease_expires_at>NEW.accepted_at
         AND audio.state='processing' AND audio.generation_id=job.audio_generation_id
         AND audio.processing_attempt_id=job.id || ':' || job.attempt
         AND audio.processing_deadline_at>NEW.accepted_at
         AND audio.retention_hard_cap_at>NEW.accepted_at
         AND audio.consent_gate_receipt_revision=job.consent_revision
         AND NOT EXISTS(
           SELECT 1 FROM jsonb_array_elements((audio.consent_gate_receipt_json::jsonb)->'required') AS receipt(value)
           WHERE NOT EXISTS(
             SELECT 1 FROM consent_events AS current
             WHERE current.id=receipt.value->>'eventId'
               AND current.revision=(receipt.value->>'revision')::bigint
               AND current.event_sequence=(receipt.value->>'eventSequence')::bigint
               AND current.domain=receipt.value->>'domain'
               AND current.decision='grant' AND current.org_id=audio.org_id
               AND current.support_case_id=audio.support_case_id
               AND current.event_sequence=(
                 SELECT MAX(latest.event_sequence) FROM consent_events AS latest
                 WHERE latest.org_id=current.org_id AND latest.beneficiary_id=current.beneficiary_id
                   AND latest.support_case_id=current.support_case_id
                   AND latest.domain=current.domain AND latest.decision<>'correct'
               )
           )
         )
     )
  THEN RAISE EXCEPTION 'agent job audio result requires live lifecycle'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_job_result_audio_lifecycle_guard
BEFORE INSERT ON agent_job_result_acceptances
FOR EACH ROW EXECUTE FUNCTION ccc_agent_job_result_audio_lifecycle_guard();

CREATE FUNCTION ccc_agent_job_audio_success_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind='audio' AND NEW.state='succeeded'
     AND NOT EXISTS(
       SELECT 1 FROM audio_objects AS audio
       WHERE audio.id=OLD.audio_object_id AND audio.org_id=OLD.org_id
         AND audio.generation_id=OLD.audio_generation_id
         AND audio.state='deletion_pending' AND audio.deletion_reason='processed'
         AND audio.deletion_attempt_id IS NOT NULL
         AND audio.processing_attempt_id=OLD.id || ':' || OLD.attempt
         AND audio.processed_at=NEW.result_accepted_at
     )
  THEN RAISE EXCEPTION 'agent job audio success requires committed deletion intent'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_job_audio_success_lifecycle_guard
BEFORE UPDATE OF state ON agent_jobs
FOR EACH ROW EXECUTE FUNCTION ccc_agent_job_audio_success_lifecycle_guard();

ALTER TABLE stt_agent_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE stt_agent_readiness FORCE ROW LEVEL SECURITY;
ALTER TABLE audio_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE audio_deletion_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_deletion_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE audio_lifecycle_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_lifecycle_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE audio_download_target_mints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_download_target_mints FORCE ROW LEVEL SECURITY;
REVOKE ALL ON stt_agent_readiness,audio_objects,audio_deletion_attempts,audio_lifecycle_outbox,audio_download_target_mints FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_schema_owner') THEN
    EXECUTE 'ALTER TABLE stt_agent_readiness OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE audio_objects OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE audio_deletion_attempts OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE audio_lifecycle_outbox OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE audio_download_target_mints OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_agent_job_result_audio_lifecycle_guard() OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_agent_job_audio_success_lifecycle_guard() OWNER TO ccc_schema_owner';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_api') THEN
    EXECUTE 'GRANT SELECT,INSERT,UPDATE ON stt_agent_readiness,audio_objects,audio_lifecycle_outbox,audio_download_target_mints TO ccc_api';
    EXECUTE 'GRANT SELECT,INSERT ON audio_deletion_attempts TO ccc_api';
    EXECUTE 'CREATE POLICY stt_readiness_scope ON stt_agent_readiness TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY audio_objects_scope ON audio_objects TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY audio_deletion_attempts_scope ON audio_deletion_attempts TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY audio_lifecycle_outbox_scope ON audio_lifecycle_outbox TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY audio_download_target_mints_scope ON audio_download_target_mints TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_agent_job_result_audio_lifecycle_guard() TO ccc_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_agent_job_audio_success_lifecycle_guard() TO ccc_api';
  END IF;
END
$$;
