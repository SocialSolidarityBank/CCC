-- F4B: extend the existing egress ledger for OpenAI while preserving Azure tuple semantics.
PRAGMA foreign_keys = OFF;

CREATE TABLE agent_job_egress_records_v2 (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  job_id                   TEXT REFERENCES agent_jobs (id),
  attempt                  INTEGER CHECK (attempt IS NULL OR attempt BETWEEN 1 AND 3),
  claim_token_hash         TEXT CHECK (claim_token_hash IS NULL OR length(claim_token_hash) = 64),
  raw_audio_sha256         TEXT CHECK (raw_audio_sha256 IS NULL OR length(raw_audio_sha256) = 64),
  consent_revision         TEXT NOT NULL,
  provider                 TEXT NOT NULL CHECK (provider IN ('azure','openai')),
  status                   TEXT NOT NULL CHECK (status IN ('authorized','in_flight','completed','revoked','expired')),
  authorized_at            TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  started_at               TEXT,
  completed_at             TEXT,
  support_case_id          TEXT,
  session_id               TEXT,
  work_item_id             TEXT,
  actor_id                 TEXT,
  operation                TEXT,
  config_hash              TEXT,
  material_refs_json       TEXT,
  material_proof_fingerprints_json TEXT,
  binding_fingerprints_json TEXT,
  UNIQUE (org_id, job_id, attempt, provider),
  CHECK (status <> 'in_flight' OR started_at IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK (
    (provider = 'azure' AND job_id IS NOT NULL AND attempt IS NOT NULL AND claim_token_hash IS NOT NULL
      AND raw_audio_sha256 IS NOT NULL AND support_case_id IS NULL AND session_id IS NULL
      AND operation IS NULL AND config_hash IS NULL AND material_refs_json IS NULL
      AND material_proof_fingerprints_json IS NULL AND binding_fingerprints_json IS NULL)
    OR
    (provider = 'openai' AND job_id IS NULL AND attempt IS NULL AND claim_token_hash IS NULL
      AND raw_audio_sha256 IS NULL AND support_case_id IS NOT NULL AND session_id IS NOT NULL
      AND actor_id IS NOT NULL AND operation IS NOT NULL AND operation IN ('generate','regenerate','detect_discrepancies')
      AND config_hash IS NOT NULL AND length(config_hash)=64 AND material_refs_json IS NOT NULL
      AND material_proof_fingerprints_json IS NOT NULL AND binding_fingerprints_json IS NOT NULL)
  )
);

INSERT INTO agent_job_egress_records_v2(
  id,org_id,job_id,attempt,claim_token_hash,raw_audio_sha256,consent_revision,provider,status,
  authorized_at,expires_at,started_at,completed_at
) SELECT id,org_id,job_id,attempt,claim_token_hash,raw_audio_sha256,consent_revision,provider,status,
  authorized_at,expires_at,started_at,completed_at
  FROM agent_job_egress_records;

DROP TABLE agent_job_egress_records;
ALTER TABLE agent_job_egress_records_v2 RENAME TO agent_job_egress_records;
CREATE INDEX idx_agent_job_egress_job ON agent_job_egress_records(org_id,job_id,attempt,status);
CREATE INDEX idx_agent_job_egress_openai
  ON agent_job_egress_records(org_id,support_case_id,session_id,work_item_id,operation,provider)
  WHERE provider='openai';
PRAGMA foreign_keys = ON;
