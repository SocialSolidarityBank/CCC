-- S7 canonical six-domain consent. Legacy consent columns are observations only.
CREATE TABLE consent_provider_registry_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('institution','institution_recording','institution_private_storage','azure','openai')),
  legal_recipient TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country)=2 AND country NOT GLOB '*[^A-Z]*'),
  approved_at TEXT NOT NULL,
  valid_until TEXT,
  UNIQUE (org_id, provider, approved_at)
);
CREATE INDEX consent_provider_registry_current ON consent_provider_registry_snapshots(org_id, provider, approved_at DESC);

CREATE TABLE consent_disclosure_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  support_case_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('personal_data_collection_use','sensitive_information_processing','counseling_recording','external_stt_processing','external_llm_cross_border_processing','voice_original_retention_period')),
  full_korean_copy TEXT NOT NULL,
  provider TEXT,
  provider_registry_snapshot_id TEXT REFERENCES consent_provider_registry_snapshots(id),
  provider_legal_recipient TEXT,
  provider_country TEXT,
  purpose TEXT,
  retention_profile TEXT NOT NULL CHECK (retention_profile='default_temporary_d85'),
  retention_duration TEXT NOT NULL CHECK (retention_duration='default_temporary_d85'),
  copy_version TEXT NOT NULL,
  copy_hash TEXT NOT NULL CHECK (length(copy_hash)=64 AND copy_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((provider IS NULL)=(provider_registry_snapshot_id IS NULL) AND (provider IS NULL)=(provider_legal_recipient IS NULL) AND (provider IS NULL)=(provider_country IS NULL) AND (provider IS NULL)=(purpose IS NULL))
);
CREATE INDEX consent_disclosures_scope ON consent_disclosure_snapshots(org_id,support_case_id,issuer_id,expires_at);

CREATE TABLE consent_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  beneficiary_id TEXT NOT NULL,
  support_case_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('personal_data_collection_use','sensitive_information_processing','counseling_recording','external_stt_processing','external_llm_cross_border_processing','voice_original_retention_period')),
  decision TEXT NOT NULL CHECK (decision IN ('grant','withdraw','decline','correct')),
  provider TEXT,
  provider_legal_recipient TEXT,
  provider_country TEXT,
  purpose TEXT,
  retention_duration TEXT,
  copy_version TEXT NOT NULL,
  copy_hash TEXT NOT NULL CHECK (length(copy_hash)=64 AND copy_hash NOT GLOB '*[^0-9a-f]*'),
  disclosure_snapshot_id TEXT NOT NULL REFERENCES consent_disclosure_snapshots(id),
  effective_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK (revision>0),
  event_sequence INTEGER NOT NULL CHECK (event_sequence>0),
  correction_of_event_id TEXT REFERENCES consent_events(id),
  provider_registry_snapshot_id TEXT REFERENCES consent_provider_registry_snapshots(id),
  CHECK ((provider IS NULL)=(provider_legal_recipient IS NULL) AND (provider IS NULL)=(provider_country IS NULL) AND (provider IS NULL)=(purpose IS NULL)),
  CHECK ((decision='correct')=(correction_of_event_id IS NOT NULL)),
  UNIQUE(org_id,support_case_id,domain,idempotency_key),
  UNIQUE(org_id,beneficiary_id,support_case_id,domain,revision),
  UNIQUE(org_id,beneficiary_id,support_case_id,event_sequence)
);
CREATE INDEX consent_events_scope_sequence ON consent_events(org_id,beneficiary_id,support_case_id,domain,event_sequence);

CREATE TABLE consent_audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('consent_append','consent_reject','consent_correction','consent_withdraw_race','consent_gate_block')),
  consent_event_id TEXT,
  outcome_code TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX consent_audit_scope ON consent_audit_events(org_id,recorded_at,id);

CREATE TABLE legacy_consent_observations (
  org_id TEXT NOT NULL, source_table TEXT NOT NULL, source_row_id TEXT NOT NULL, source_field TEXT NOT NULL,
  observed_at TEXT NOT NULL, notice_hash TEXT, state TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(state='unconfirmed'),
  PRIMARY KEY(org_id,source_table,source_row_id,source_field)
);
CREATE INDEX legacy_consent_observations_scope ON legacy_consent_observations(org_id,source_table,source_row_id);

INSERT OR IGNORE INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_recording_at',consent_recording_at,NULL FROM support_cases WHERE consent_recording_at IS NOT NULL;
INSERT OR IGNORE INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_text_ai_at',consent_text_ai_at,NULL FROM support_cases WHERE consent_text_ai_at IS NOT NULL;
INSERT OR IGNORE INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_privacy_at',consent_privacy_at,NULL FROM support_cases WHERE consent_privacy_at IS NOT NULL;
INSERT OR IGNORE INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'participant_consent_records',id,'consent_recording_at',consent_recording_at,NULL FROM participant_consent_records WHERE consent_recording_at IS NOT NULL;
INSERT OR IGNORE INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'participant_consent_records',id,'consent_text_ai_at',consent_text_ai_at,NULL FROM participant_consent_records WHERE consent_text_ai_at IS NOT NULL;

CREATE TRIGGER consent_events_no_update BEFORE UPDATE ON consent_events BEGIN SELECT RAISE(ABORT,'consent_events_append_only'); END;
CREATE TRIGGER consent_events_no_delete BEFORE DELETE ON consent_events BEGIN SELECT RAISE(ABORT,'consent_events_append_only'); END;
CREATE TRIGGER consent_disclosures_no_update BEFORE UPDATE ON consent_disclosure_snapshots BEGIN SELECT RAISE(ABORT,'consent_disclosures_immutable'); END;
CREATE TRIGGER consent_disclosures_no_delete BEFORE DELETE ON consent_disclosure_snapshots BEGIN SELECT RAISE(ABORT,'consent_disclosures_immutable'); END;
CREATE TRIGGER consent_registry_no_update BEFORE UPDATE ON consent_provider_registry_snapshots BEGIN SELECT RAISE(ABORT,'consent_registry_immutable'); END;
CREATE TRIGGER consent_registry_no_delete BEFORE DELETE ON consent_provider_registry_snapshots BEGIN SELECT RAISE(ABORT,'consent_registry_immutable'); END;
CREATE TRIGGER consent_audit_no_update BEFORE UPDATE ON consent_audit_events BEGIN SELECT RAISE(ABORT,'consent_audit_append_only'); END;
CREATE TRIGGER consent_audit_no_delete BEFORE DELETE ON consent_audit_events BEGIN SELECT RAISE(ABORT,'consent_audit_append_only'); END;

ALTER TABLE agent_jobs ADD COLUMN consent_revision TEXT;
ALTER TABLE agent_jobs ADD COLUMN consent_receipt_json TEXT;
ALTER TABLE agent_jobs ADD COLUMN stt_engine_id TEXT CHECK(stt_engine_id IS NULL OR stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral'));
