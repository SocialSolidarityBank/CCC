-- Logical pair: SQLite 0070_openai_egress.sql.
-- F4B: extend the existing egress ledger for OpenAI while preserving Azure tuple semantics.
ALTER TABLE agent_job_egress_records
  ALTER COLUMN job_id DROP NOT NULL,
  ALTER COLUMN attempt DROP NOT NULL,
  ALTER COLUMN claim_token_hash DROP NOT NULL,
  ALTER COLUMN raw_audio_sha256 DROP NOT NULL;
ALTER TABLE agent_job_egress_records
  DROP CONSTRAINT IF EXISTS agent_job_egress_records_provider_check;
ALTER TABLE agent_job_egress_records
  ADD COLUMN support_case_id text,
  ADD COLUMN session_id text,
  ADD COLUMN work_item_id text,
  ADD COLUMN actor_id text,
  ADD COLUMN operation text,
  ADD COLUMN config_hash text,
  ADD COLUMN material_refs_json text,
  ADD COLUMN material_proof_fingerprints_json text,
  ADD COLUMN binding_fingerprints_json text;
ALTER TABLE agent_job_egress_records
  ADD CONSTRAINT agent_job_egress_records_provider_shape CHECK (
    (provider='azure' AND job_id IS NOT NULL AND attempt IS NOT NULL AND claim_token_hash IS NOT NULL
      AND raw_audio_sha256 IS NOT NULL AND support_case_id IS NULL AND session_id IS NULL
      AND operation IS NULL AND config_hash IS NULL AND material_refs_json IS NULL
      AND material_proof_fingerprints_json IS NULL AND binding_fingerprints_json IS NULL)
    OR
    (provider='openai' AND job_id IS NULL AND attempt IS NULL AND claim_token_hash IS NULL
      AND raw_audio_sha256 IS NULL AND support_case_id IS NOT NULL AND session_id IS NOT NULL
      AND actor_id IS NOT NULL AND operation IS NOT NULL AND operation IN ('generate','regenerate','detect_discrepancies')
      AND config_hash IS NOT NULL AND length(config_hash)=64 AND material_refs_json IS NOT NULL
      AND material_proof_fingerprints_json IS NOT NULL AND binding_fingerprints_json IS NOT NULL)
  );
CREATE INDEX idx_agent_job_egress_openai
  ON agent_job_egress_records(org_id,support_case_id,session_id,work_item_id,operation,provider)
  WHERE provider='openai';
