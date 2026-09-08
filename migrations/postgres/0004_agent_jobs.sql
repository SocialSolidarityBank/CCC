-- S1 logical pair: SQLite 0048_agent_jobs.sql. Applied after timestamp normalization.
-- Nullable UNIQUE keys preserve SQLite rowid-table TEXT PRIMARY KEY nullability.
CREATE TABLE ner_release_qualification_receipts (
  id text UNIQUE, org_id text NOT NULL, model_id text NOT NULL, model_revision text NOT NULL,
  label_set_hash text NOT NULL CHECK (length(label_set_hash)=64),
  corpus_hash text NOT NULL CHECK (length(corpus_hash)=64), result_hash text NOT NULL CHECK (length(result_hash)=64),
  validated_at text NOT NULL, expires_at text NOT NULL, status text NOT NULL CHECK (status='passed'), created_at text NOT NULL
);
CREATE INDEX idx_ner_release_receipts_org_expiry ON ner_release_qualification_receipts(org_id,expires_at,id);
CREATE TRIGGER ner_release_receipts_immutable BEFORE UPDATE ON ner_release_qualification_receipts FOR EACH ROW
  EXECUTE FUNCTION ccc_reject_write('NER release qualification receipts are immutable');
CREATE TRIGGER ner_release_receipts_no_delete BEFORE DELETE ON ner_release_qualification_receipts FOR EACH ROW
  EXECUTE FUNCTION ccc_reject_write('NER release qualification receipts are append-only');
CREATE TABLE agent_jobs (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  source_text_work_item_id text REFERENCES ai_text_work_queue(id), kind text NOT NULL CHECK (kind IN ('audio','text')),
  state text NOT NULL CHECK (state IN ('pending','leased','blocked','succeeded','cancelled','expired','failed')), enqueued_at text NOT NULL,
  route text CHECK (route IS NULL OR route IN ('community-cloud-agent','local-single-agent','local-office-agent')),
  stt_engine text CHECK (stt_engine IS NULL OR stt_engine IN ('local','azure')), required_consent text NOT NULL,
  attempt bigint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3), lease_owner text,
  claim_token_hash text CHECK (claim_token_hash IS NULL OR length(claim_token_hash)=64), claimed_at text, lease_expires_at text,
  ner_attestation_id text, ner_model_id text, ner_model_revision text,
  ner_label_set_hash text CHECK (ner_label_set_hash IS NULL OR length(ner_label_set_hash)=64),
  ner_corpus_hash text CHECK (ner_corpus_hash IS NULL OR length(ner_corpus_hash)=64),
  ner_attestation_result_hash text CHECK (ner_attestation_result_hash IS NULL OR length(ner_attestation_result_hash)=64),
  ner_attestation_validated_at text, ner_attestation_expires_at text,
  release_qualification_receipt_id text REFERENCES ner_release_qualification_receipts(id), terminal_failure_code text, result_id text,
  result_payload_sha256 text CHECK (result_payload_sha256 IS NULL OR length(result_payload_sha256)=64), result_accepted_at text,
  audio_generation_id text, client_asserted_sha256 text CHECK (client_asserted_sha256 IS NULL OR length(client_asserted_sha256)=64),
  agent_computed_sha256 text CHECK (agent_computed_sha256 IS NULL OR length(agent_computed_sha256)=64),
  raw_audio_sha256 text CHECK (raw_audio_sha256 IS NULL OR length(raw_audio_sha256)=64), retention_hard_cap_at text, processing_deadline_at text,
  mask_dictionary_id text, mask_dictionary_issued_at text, mask_dictionary_expires_at text, mask_dictionary_consumed_at text, updated_at text NOT NULL,
  CHECK (state<>'leased' OR (lease_owner IS NOT NULL AND claim_token_hash IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL
    AND ner_attestation_id IS NOT NULL AND ner_model_id IS NOT NULL AND ner_model_revision IS NOT NULL AND ner_label_set_hash IS NOT NULL
    AND ner_corpus_hash IS NOT NULL AND ner_attestation_result_hash IS NOT NULL AND ner_attestation_validated_at IS NOT NULL
    AND ner_attestation_expires_at IS NOT NULL AND release_qualification_receipt_id IS NOT NULL)),
  CHECK (state='leased' OR (lease_owner IS NULL AND claim_token_hash IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)),
  CHECK (kind='audio' OR (stt_engine IS NULL AND audio_generation_id IS NULL AND client_asserted_sha256 IS NULL
    AND agent_computed_sha256 IS NULL AND raw_audio_sha256 IS NULL AND retention_hard_cap_at IS NULL AND processing_deadline_at IS NULL)),
  CHECK ((kind='text' AND source_text_work_item_id IS NOT NULL) OR kind='audio'),
  CHECK (state<>'succeeded' OR (result_id IS NOT NULL AND result_payload_sha256 IS NOT NULL AND result_accepted_at IS NOT NULL)),
  CHECK (result_payload_sha256 IS NULL OR state='succeeded')
);
CREATE UNIQUE INDEX uq_agent_jobs_open_text_source ON agent_jobs(source_text_work_item_id)
  WHERE source_text_work_item_id IS NOT NULL AND state IN ('pending','leased','blocked');
CREATE UNIQUE INDEX uq_agent_jobs_open_audio_session ON agent_jobs(org_id,session_id)
  WHERE kind='audio' AND state IN ('pending','leased','blocked');
CREATE INDEX idx_agent_jobs_claim ON agent_jobs(org_id,state,kind,enqueued_at,id);
CREATE INDEX idx_agent_jobs_session ON agent_jobs(org_id,session_id,kind,enqueued_at,id);
CREATE TABLE agent_job_egress_records (
  id text UNIQUE, org_id text NOT NULL, job_id text NOT NULL REFERENCES agent_jobs(id),
  attempt bigint NOT NULL CHECK (attempt BETWEEN 1 AND 3), claim_token_hash text NOT NULL CHECK (length(claim_token_hash)=64),
  raw_audio_sha256 text NOT NULL CHECK (length(raw_audio_sha256)=64), consent_revision text NOT NULL,
  provider text NOT NULL CHECK (provider='azure'), status text NOT NULL CHECK (status IN ('authorized','in_flight','completed','revoked','expired')),
  authorized_at text NOT NULL, expires_at text NOT NULL, started_at text, completed_at text,
  UNIQUE(org_id,job_id,attempt,provider), CHECK (status<>'in_flight' OR started_at IS NOT NULL), CHECK (status<>'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX idx_agent_job_egress_job ON agent_job_egress_records(org_id,job_id,attempt,status);
CREATE TABLE agent_job_result_acceptances (
  job_id text UNIQUE REFERENCES agent_jobs(id), attempt bigint NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  claim_token_hash text NOT NULL CHECK (length(claim_token_hash)=64), payload_sha256 text NOT NULL CHECK (length(payload_sha256)=64), accepted_at text NOT NULL
);
CREATE FUNCTION agent_job_result_acceptances_live_claim_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock the live job until result acceptance commits, the PostgreSQL equivalent of SQLite's writer boundary.
  PERFORM 1 FROM agent_jobs AS job WHERE job.id=NEW.job_id AND job.state='leased'
    AND job.claim_token_hash=NEW.claim_token_hash AND job.attempt=NEW.attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='agent job result requires the live claim';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_job_result_acceptances_live_claim_guard BEFORE INSERT ON agent_job_result_acceptances FOR EACH ROW
  EXECUTE FUNCTION agent_job_result_acceptances_live_claim_guard_fn();
CREATE TRIGGER agent_job_result_acceptances_immutable BEFORE UPDATE ON agent_job_result_acceptances FOR EACH ROW
  EXECUTE FUNCTION ccc_reject_write('agent job result acceptances are immutable');
CREATE TRIGGER agent_job_result_acceptances_no_delete BEFORE DELETE ON agent_job_result_acceptances FOR EACH ROW
  EXECUTE FUNCTION ccc_reject_write('agent job result acceptances are append-only');

-- Restart unfinished v1 leases; completed source rows and their history remain untouched.
UPDATE ai_text_work_queue SET status='pending',lease_owner=NULL,lease_expires_at=NULL WHERE status='processing';
INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,source_text_work_item_id,kind,state,enqueued_at,required_consent,attempt,updated_at)
SELECT queue.id,queue.org_id,queue.support_case_id,queue.session_id,queue.id,'text','pending',queue.enqueued_at,'["text_ai"]',0,queue.enqueued_at
FROM ai_text_work_queue AS queue WHERE queue.status IN ('pending','processing');
-- Unreconciled audio deliberately has no generation/hash/retention receipt: claiming remains fail-closed.
INSERT INTO agent_jobs(id,org_id,support_case_id,session_id,kind,state,enqueued_at,required_consent,attempt,updated_at)
SELECT 'audio-job-'||session.id,session.org_id,session.support_case_id,session.id,'audio','pending',session.updated_at,'["recording_ai"]',0,session.updated_at
FROM sessions AS session WHERE session.audio_r2_key IS NOT NULL AND session.ai_status IN ('uploaded','processing');

COMMENT ON CONSTRAINT ner_release_qualification_receipts_id_key ON ner_release_qualification_receipts IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT agent_jobs_id_key ON agent_jobs IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT agent_job_egress_records_id_key ON agent_job_egress_records IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT agent_job_result_acceptances_job_id_key ON agent_job_result_acceptances IS 'ccc:sqlite-primary-key';
