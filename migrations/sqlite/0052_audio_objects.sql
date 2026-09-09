-- S8 generation-bound original-audio lifecycle and STT readiness.
CREATE TABLE stt_agent_readiness (
  org_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  stt_mode TEXT NOT NULL CHECK(stt_mode IN ('off','local','azure')),
  stt_engine_id TEXT CHECK(stt_engine_id IS NULL OR stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral')),
  state TEXT NOT NULL CHECK(state IN ('ready','unavailable')),
  capacity INTEGER NOT NULL CHECK(capacity IN (0,1)),
  received_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY(org_id,agent_id),
  CHECK((stt_mode='off' AND stt_engine_id IS NULL AND state='unavailable' AND capacity=0) OR (stt_mode='local' AND stt_engine_id='qwen3-asr') OR (stt_mode='azure' AND stt_engine_id='azure-speech-koreacentral')),
  CHECK(state='ready' OR capacity=0)
);
CREATE INDEX stt_readiness_current ON stt_agent_readiness(org_id,stt_mode,stt_engine_id,state,expires_at,capacity);

CREATE TABLE audio_objects (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, session_id TEXT NOT NULL, support_case_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL CHECK(length(key_hash)=64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('pending_upload','available','claimed','processing','deletion_pending','processed_deleted','unprocessed_expired','upload_abandoned','retention_capped')),
  generation_id TEXT NOT NULL, stt_route TEXT NOT NULL CHECK(stt_route IN ('local','azure')),
  stt_engine_id TEXT NOT NULL CHECK(stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral')),
  audio_delivery TEXT NOT NULL CHECK(audio_delivery IN ('api-stream','protected-get')),
  content_length INTEGER NOT NULL CHECK(content_length BETWEEN 1 AND 209715200),
  content_type TEXT NOT NULL CHECK(content_type IN ('audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/webm','audio/x-m4a')),
  client_asserted_sha256 TEXT,
  storage_sha256 TEXT CHECK(storage_sha256 IS NULL OR (length(storage_sha256)=64 AND storage_sha256 NOT GLOB '*[^0-9a-f]*')),
  object_sha256 TEXT,
  consent_gate_receipt_revision TEXT NOT NULL, consent_gate_receipt_json TEXT NOT NULL,
  eligible_after TEXT NOT NULL, uploaded_at TEXT, upload_expires_at TEXT NOT NULL,
  upload_completion_id TEXT,
  retention_hard_cap_at TEXT NOT NULL, first_agent_available_at TEXT, processing_deadline_at TEXT,
  claim_id TEXT, claim_agent_id TEXT, claim_expires_at TEXT,
  processing_attempt_id TEXT, processing_started_at TEXT, processed_at TEXT,
  download_target_issued_at TEXT, download_target_agent_id TEXT, download_target_expires_at TEXT,
  deletion_reason TEXT CHECK(deletion_reason IS NULL OR deletion_reason IN ('processed','unprocessed_expiry','rejected_upload','hash_mismatch','upload_abandoned','consent_withdrawal','processing_failed','retry_exhausted','retention_hard_cap')),
  deletion_attempt_id TEXT, next_attempt_at TEXT, retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),
  incident_outbox_key TEXT, manual_note_outbox_key TEXT, deleted_at TEXT, deletion_evidence TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((state='deletion_pending')=(deletion_reason IS NOT NULL) OR state IN ('processed_deleted','unprocessed_expired','upload_abandoned','retention_capped'))
);
CREATE UNIQUE INDEX audio_objects_open_session ON audio_objects(org_id,session_id) WHERE state NOT IN ('processed_deleted','unprocessed_expired','upload_abandoned','retention_capped');
CREATE INDEX audio_objects_claim ON audio_objects(org_id,state,eligible_after,retention_hard_cap_at,created_at,id);
CREATE INDEX audio_objects_reconcile ON audio_objects(state,next_attempt_at,retention_hard_cap_at,id);

CREATE TABLE audio_deletion_attempts (
  id TEXT PRIMARY KEY, deletion_attempt_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('requested','verification')),
  org_id TEXT NOT NULL, audio_object_id TEXT NOT NULL REFERENCES audio_objects(id),
  generation_id TEXT NOT NULL, reason TEXT NOT NULL,
  requested_at TEXT NOT NULL, provider_delete_accepted_at TEXT, deleted_at TEXT,
  delete_succeeded INTEGER CHECK(delete_succeeded IS NULL OR delete_succeeded IN (0,1)),
  absent_from_list INTEGER CHECK(absent_from_list IS NULL OR absent_from_list IN (0,1)),
  absent_from_metadata INTEGER CHECK(absent_from_metadata IS NULL OR absent_from_metadata IN (0,1)),
  direct_read_absent INTEGER CHECK(direct_read_absent IS NULL OR direct_read_absent IN (0,1)),
  verification_method TEXT CHECK(verification_method IS NULL OR verification_method IN ('authenticated-get-404','filesystem-stat-enoent','r2-head-absent')),
  provider_status INTEGER, verified_at TEXT, evidence_json TEXT, created_at TEXT NOT NULL,
  UNIQUE(deletion_attempt_id,phase,id)
);
CREATE INDEX audio_deletion_attempts_object ON audio_deletion_attempts(org_id,audio_object_id,created_at,id);
CREATE TRIGGER audio_deletion_attempts_no_update BEFORE UPDATE ON audio_deletion_attempts BEGIN SELECT RAISE(ABORT,'audio_deletion_attempts_append_only'); END;
CREATE TRIGGER audio_deletion_attempts_no_delete BEFORE DELETE ON audio_deletion_attempts BEGIN SELECT RAISE(ABORT,'audio_deletion_attempts_append_only'); END;

CREATE TABLE audio_lifecycle_outbox (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, audio_object_id TEXT NOT NULL REFERENCES audio_objects(id),
  kind TEXT NOT NULL CHECK(kind IN ('incident','manual_note')), reason TEXT NOT NULL,
  created_at TEXT NOT NULL, delivered_at TEXT,
  UNIQUE(org_id,audio_object_id,kind,reason)
);
CREATE INDEX audio_lifecycle_outbox_pending ON audio_lifecycle_outbox(org_id,kind,delivered_at,created_at);

CREATE TABLE audio_download_target_mints (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, audio_object_id TEXT NOT NULL REFERENCES audio_objects(id),
  job_id TEXT NOT NULL REFERENCES agent_jobs(id), generation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, claim_token_hash TEXT NOT NULL, attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','issued','failed')),
  requested_at TEXT NOT NULL, issued_at TEXT, expires_at TEXT, failed_at TEXT
);
CREATE INDEX audio_download_target_mints_job ON audio_download_target_mints(org_id,job_id,attempt,requested_at,id);

ALTER TABLE agent_jobs ADD COLUMN audio_object_id TEXT REFERENCES audio_objects(id);

CREATE TRIGGER agent_job_result_audio_lifecycle_guard
BEFORE INSERT ON agent_job_result_acceptances
WHEN EXISTS(SELECT 1 FROM agent_jobs WHERE id=NEW.job_id AND kind='audio')
BEGIN
  SELECT RAISE(ABORT,'agent job audio result requires live lifecycle')
  WHERE NOT EXISTS(
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
        SELECT 1 FROM json_each(audio.consent_gate_receipt_json,'$.required') AS receipt
        WHERE NOT EXISTS(
          SELECT 1 FROM consent_events AS current
          WHERE current.id=json_extract(receipt.value,'$.eventId')
            AND current.revision=json_extract(receipt.value,'$.revision')
            AND current.event_sequence=json_extract(receipt.value,'$.eventSequence')
            AND current.domain=json_extract(receipt.value,'$.domain')
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
  );
END;

CREATE TRIGGER agent_job_audio_success_lifecycle_guard
BEFORE UPDATE OF state ON agent_jobs
WHEN OLD.kind='audio' AND NEW.state='succeeded'
BEGIN
  SELECT RAISE(ABORT,'agent job audio success requires committed deletion intent')
  WHERE NOT EXISTS(
    SELECT 1 FROM audio_objects AS audio
    WHERE audio.id=OLD.audio_object_id AND audio.org_id=OLD.org_id
      AND audio.generation_id=OLD.audio_generation_id
      AND audio.state='deletion_pending' AND audio.deletion_reason='processed'
      AND audio.deletion_attempt_id IS NOT NULL
      AND audio.processing_attempt_id=OLD.id || ':' || OLD.attempt
      AND audio.processed_at=NEW.result_accepted_at
  );
END;
