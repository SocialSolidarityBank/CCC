-- Migration 0048 - E5-1a unified Agent job contract v2.
--
-- `agent_jobs` is the single mutable state row for audio and text processing. Existing sessions and
-- ai_text_work_queue rows remain business/source records, but no longer own claim state. Claim tokens
-- are stored only as SHA-256 hashes. Raw mask dictionary values are never persisted here.

CREATE TABLE ner_release_qualification_receipts (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  model_id       TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  label_set_hash TEXT NOT NULL CHECK (length(label_set_hash) = 64),
  corpus_hash    TEXT NOT NULL CHECK (length(corpus_hash) = 64),
  result_hash    TEXT NOT NULL CHECK (length(result_hash) = 64),
  validated_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status = 'passed'),
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_ner_release_receipts_org_expiry
  ON ner_release_qualification_receipts (org_id, expires_at, id);

CREATE TRIGGER ner_release_receipts_immutable
BEFORE UPDATE ON ner_release_qualification_receipts
BEGIN
  SELECT RAISE(ABORT, 'NER release qualification receipts are immutable');
END;

CREATE TRIGGER ner_release_receipts_no_delete
BEFORE DELETE ON ner_release_qualification_receipts
BEGIN
  SELECT RAISE(ABORT, 'NER release qualification receipts are append-only');
END;

CREATE TABLE agent_jobs (
  id                               TEXT PRIMARY KEY,
  org_id                           TEXT NOT NULL,
  support_case_id                  TEXT NOT NULL REFERENCES support_cases (id),
  session_id                       TEXT NOT NULL REFERENCES sessions (id),
  source_text_work_item_id         TEXT REFERENCES ai_text_work_queue (id),
  kind                             TEXT NOT NULL CHECK (kind IN ('audio', 'text')),
  state                            TEXT NOT NULL CHECK (state IN (
                                     'pending', 'leased', 'blocked', 'succeeded',
                                     'cancelled', 'expired', 'failed'
                                   )),
  enqueued_at                      TEXT NOT NULL,
  route                            TEXT CHECK (route IS NULL OR route IN (
                                     'community-cloud-agent', 'local-single-agent', 'local-office-agent'
                                   )),
  stt_engine                       TEXT CHECK (stt_engine IS NULL OR stt_engine IN ('local', 'azure')),
  required_consent                 TEXT NOT NULL,
  attempt                          INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  lease_owner                      TEXT,
  claim_token_hash                 TEXT CHECK (claim_token_hash IS NULL OR length(claim_token_hash) = 64),
  claimed_at                       TEXT,
  lease_expires_at                 TEXT,
  ner_attestation_id               TEXT,
  ner_model_id                     TEXT,
  ner_model_revision               TEXT,
  ner_label_set_hash               TEXT CHECK (
                                     ner_label_set_hash IS NULL OR length(ner_label_set_hash) = 64
                                   ),
  ner_corpus_hash                  TEXT CHECK (
                                     ner_corpus_hash IS NULL OR length(ner_corpus_hash) = 64
                                   ),
  ner_attestation_result_hash      TEXT CHECK (
                                     ner_attestation_result_hash IS NULL OR length(ner_attestation_result_hash) = 64
                                   ),
  ner_attestation_validated_at     TEXT,
  ner_attestation_expires_at       TEXT,
  release_qualification_receipt_id TEXT REFERENCES ner_release_qualification_receipts (id),
  terminal_failure_code            TEXT,
  result_id                        TEXT,
  result_payload_sha256            TEXT CHECK (
                                     result_payload_sha256 IS NULL OR length(result_payload_sha256) = 64
                                   ),
  result_accepted_at               TEXT,
  audio_generation_id              TEXT,
  client_asserted_sha256           TEXT CHECK (
                                     client_asserted_sha256 IS NULL OR length(client_asserted_sha256) = 64
                                   ),
  agent_computed_sha256            TEXT CHECK (
                                     agent_computed_sha256 IS NULL OR length(agent_computed_sha256) = 64
                                   ),
  raw_audio_sha256                 TEXT CHECK (raw_audio_sha256 IS NULL OR length(raw_audio_sha256) = 64),
  retention_hard_cap_at            TEXT,
  processing_deadline_at           TEXT,
  mask_dictionary_id               TEXT,
  mask_dictionary_issued_at        TEXT,
  mask_dictionary_expires_at       TEXT,
  mask_dictionary_consumed_at      TEXT,
  updated_at                       TEXT NOT NULL,
  CHECK (
    state <> 'leased' OR (
      lease_owner IS NOT NULL AND claim_token_hash IS NOT NULL
      AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND ner_attestation_id IS NOT NULL AND ner_model_id IS NOT NULL
      AND ner_model_revision IS NOT NULL AND ner_label_set_hash IS NOT NULL
      AND ner_corpus_hash IS NOT NULL AND ner_attestation_result_hash IS NOT NULL
      AND ner_attestation_validated_at IS NOT NULL AND ner_attestation_expires_at IS NOT NULL
      AND release_qualification_receipt_id IS NOT NULL
    )
  ),
  CHECK (
    state = 'leased' OR (
      lease_owner IS NULL AND claim_token_hash IS NULL
      AND claimed_at IS NULL AND lease_expires_at IS NULL
    )
  ),
  CHECK (
    kind = 'audio' OR (
      stt_engine IS NULL AND audio_generation_id IS NULL
      AND client_asserted_sha256 IS NULL AND agent_computed_sha256 IS NULL
      AND raw_audio_sha256 IS NULL AND retention_hard_cap_at IS NULL
      AND processing_deadline_at IS NULL
    )
  ),
  CHECK ((kind = 'text' AND source_text_work_item_id IS NOT NULL) OR kind = 'audio'),
  CHECK (
    state <> 'succeeded' OR (
      result_id IS NOT NULL AND result_payload_sha256 IS NOT NULL AND result_accepted_at IS NOT NULL
    )
  ),
  CHECK (result_payload_sha256 IS NULL OR state = 'succeeded')
);

-- 원본 큐 행 하나에 열린 작업은 1건이다. 취소·실패·만료 뒤 같은 회차를 다시 공식화하면
-- 새 작업이 생겨야 하므로 terminal 행은 이 유일성에서 빠진다.
CREATE UNIQUE INDEX uq_agent_jobs_open_text_source
  ON agent_jobs (source_text_work_item_id)
  WHERE source_text_work_item_id IS NOT NULL AND state IN ('pending', 'leased', 'blocked');
CREATE UNIQUE INDEX uq_agent_jobs_open_audio_session
  ON agent_jobs (org_id, session_id)
  WHERE kind = 'audio' AND state IN ('pending', 'leased', 'blocked');
CREATE INDEX idx_agent_jobs_claim
  ON agent_jobs (org_id, state, kind, enqueued_at, id);
CREATE INDEX idx_agent_jobs_session
  ON agent_jobs (org_id, session_id, kind, enqueued_at, id);

CREATE TABLE agent_job_egress_records (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL,
  job_id                TEXT NOT NULL REFERENCES agent_jobs (id),
  attempt               INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  claim_token_hash      TEXT NOT NULL CHECK (length(claim_token_hash) = 64),
  raw_audio_sha256      TEXT NOT NULL CHECK (length(raw_audio_sha256) = 64),
  consent_revision      TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider = 'azure'),
  status                TEXT NOT NULL CHECK (status IN ('authorized', 'in_flight', 'completed', 'revoked', 'expired')),
  authorized_at         TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  started_at            TEXT,
  completed_at          TEXT,
  UNIQUE (org_id, job_id, attempt, provider),
  CHECK (status <> 'in_flight' OR started_at IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX idx_agent_job_egress_job
  ON agent_job_egress_records (org_id, job_id, attempt, status);

-- 결과 수락은 이 표에 한 행을 남긴다. BEFORE INSERT 트리거가 "그 순간 그 claim 이 살아
-- 있는가" 를 검사하므로, 검증과 batch 사이에 임대가 넘어가거나 동의가 철회되면 batch 전체가
-- abort 된다 — 마스킹 스냅샷도 남지 않는다(R3 · S5 §2.2 원자 경계).
CREATE TABLE agent_job_result_acceptances (
  job_id           TEXT PRIMARY KEY REFERENCES agent_jobs (id),
  attempt          INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  claim_token_hash TEXT NOT NULL CHECK (length(claim_token_hash) = 64),
  payload_sha256   TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  accepted_at      TEXT NOT NULL
);

CREATE TRIGGER agent_job_result_acceptances_live_claim_guard
BEFORE INSERT ON agent_job_result_acceptances
BEGIN
  SELECT RAISE(ABORT, 'agent job result requires the live claim')
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_jobs AS job
    WHERE job.id = NEW.job_id
      AND job.state = 'leased'
      AND job.claim_token_hash = NEW.claim_token_hash
      AND job.attempt = NEW.attempt
  );
END;

CREATE TRIGGER agent_job_result_acceptances_immutable
BEFORE UPDATE ON agent_job_result_acceptances
BEGIN
  SELECT RAISE(ABORT, 'agent job result acceptances are immutable');
END;

CREATE TRIGGER agent_job_result_acceptances_no_delete
BEFORE DELETE ON agent_job_result_acceptances
BEGIN
  SELECT RAISE(ABORT, 'agent job result acceptances are append-only');
END;

-- v1 임대 상태는 v2 가 소유한다. 열려 있던 `processing` 원본 행은 `pending` 으로 되돌리고
-- 임대 필드를 비운다. 그러지 않으면 작업이 terminal 이 된 뒤 재공식화가 열린 원본 행을
-- 찾지 못해 같은 회차를 다시 큐에 올릴 수 없다(완료 행은 그대로 둔다).
UPDATE ai_text_work_queue
SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL
WHERE status = 'processing';

-- A v2 claim restarts unfinished v1 text leases at attempt zero. Completed history stays only in the
-- append-only v1 source table and is not reprocessed.
INSERT INTO agent_jobs (
  id, org_id, support_case_id, session_id, source_text_work_item_id, kind, state,
  enqueued_at, required_consent, attempt, updated_at
)
SELECT
  queue.id, queue.org_id, queue.support_case_id, queue.session_id, queue.id, 'text', 'pending',
  queue.enqueued_at, '["text_ai"]', 0, queue.enqueued_at
FROM ai_text_work_queue AS queue
WHERE queue.status IN ('pending', 'processing');

-- Existing uploaded audio has no SG8 generation or retention receipt. Preserve it as pending but leave
-- the audio binding empty so claim fails closed until E5-6 reconciles the AudioStore object.
INSERT INTO agent_jobs (
  id, org_id, support_case_id, session_id, kind, state, enqueued_at,
  required_consent, attempt, updated_at
)
SELECT
  'audio-job-' || session.id, session.org_id, session.support_case_id, session.id, 'audio', 'pending',
  session.updated_at, '["recording_ai"]', 0, session.updated_at
FROM sessions AS session
WHERE session.audio_r2_key IS NOT NULL AND session.ai_status IN ('uploaded', 'processing');
