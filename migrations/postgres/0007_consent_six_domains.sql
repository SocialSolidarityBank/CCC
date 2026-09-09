-- S7 canonical six-domain consent. Legacy consent columns are observations only.

CREATE TABLE consent_provider_registry_snapshots (
  id text CONSTRAINT consent_provider_registry_snapshots_nullable_pk UNIQUE, org_id text NOT NULL,
  provider text NOT NULL CHECK(provider IN ('institution','institution_recording','institution_private_storage','azure','openai')),
  legal_recipient text NOT NULL, country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
  approved_at text NOT NULL, valid_until text, UNIQUE(org_id,provider,approved_at)
);
CREATE INDEX consent_provider_registry_current ON consent_provider_registry_snapshots(org_id,provider,approved_at DESC);

CREATE TABLE consent_disclosure_snapshots (
  id text CONSTRAINT consent_disclosure_snapshots_nullable_pk UNIQUE, org_id text NOT NULL, program_id text NOT NULL, issuer_id text NOT NULL,
  support_case_id text NOT NULL,
  domain text NOT NULL CHECK(domain IN ('personal_data_collection_use','sensitive_information_processing','counseling_recording','external_stt_processing','external_llm_cross_border_processing','voice_original_retention_period')),
  full_korean_copy text NOT NULL, provider text,
  provider_registry_snapshot_id text REFERENCES consent_provider_registry_snapshots(id),
  provider_legal_recipient text, provider_country text, purpose text,
  retention_profile text NOT NULL CHECK(retention_profile='default_temporary_d85'),
  retention_duration text NOT NULL CHECK(retention_duration='default_temporary_d85'),
  copy_version text NOT NULL, copy_hash text NOT NULL CHECK(copy_hash ~ '^[0-9a-f]{64}$'),
  issued_at text NOT NULL, expires_at text NOT NULL,
  CHECK((provider IS NULL)=(provider_registry_snapshot_id IS NULL) AND (provider IS NULL)=(provider_legal_recipient IS NULL) AND (provider IS NULL)=(provider_country IS NULL) AND (provider IS NULL)=(purpose IS NULL))
);
CREATE INDEX consent_disclosures_scope ON consent_disclosure_snapshots(org_id,support_case_id,issuer_id,expires_at);

CREATE TABLE consent_events (
  id text CONSTRAINT consent_events_nullable_pk UNIQUE, org_id text NOT NULL, beneficiary_id text NOT NULL, support_case_id text NOT NULL,
  domain text NOT NULL CHECK(domain IN ('personal_data_collection_use','sensitive_information_processing','counseling_recording','external_stt_processing','external_llm_cross_border_processing','voice_original_retention_period')),
  decision text NOT NULL CHECK(decision IN ('grant','withdraw','decline','correct')),
  provider text, provider_legal_recipient text, provider_country text, purpose text, retention_duration text,
  copy_version text NOT NULL, copy_hash text NOT NULL CHECK(copy_hash ~ '^[0-9a-f]{64}$'),
  disclosure_snapshot_id text NOT NULL REFERENCES consent_disclosure_snapshots(id),
  effective_at text NOT NULL, recorded_by text NOT NULL, recorded_at text NOT NULL,
  idempotency_key text NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK(revision>0), event_sequence bigint NOT NULL CHECK(event_sequence>0),
  correction_of_event_id text REFERENCES consent_events(id),
  provider_registry_snapshot_id text REFERENCES consent_provider_registry_snapshots(id),
  CHECK((provider IS NULL)=(provider_legal_recipient IS NULL) AND (provider IS NULL)=(provider_country IS NULL) AND (provider IS NULL)=(purpose IS NULL)),
  CHECK((decision='correct')=(correction_of_event_id IS NOT NULL)),
  UNIQUE(org_id,support_case_id,domain,idempotency_key),
  UNIQUE(org_id,beneficiary_id,support_case_id,domain,revision),
  UNIQUE(org_id,beneficiary_id,support_case_id,event_sequence)
);
CREATE INDEX consent_events_scope_sequence ON consent_events(org_id,beneficiary_id,support_case_id,domain,event_sequence);

CREATE TABLE consent_audit_events (
  id text CONSTRAINT consent_audit_events_nullable_pk UNIQUE, org_id text NOT NULL, actor_id text NOT NULL,
  action text NOT NULL CHECK(action IN ('consent_append','consent_reject','consent_correction','consent_withdraw_race','consent_gate_block')),
  consent_event_id text, outcome_code text NOT NULL, recorded_at text NOT NULL
);
CREATE INDEX consent_audit_scope ON consent_audit_events(org_id,recorded_at,id);

CREATE TABLE legacy_consent_observations (
  org_id text NOT NULL, source_table text NOT NULL, source_row_id text NOT NULL, source_field text NOT NULL,
  observed_at text NOT NULL, notice_hash text, state text NOT NULL DEFAULT 'unconfirmed' CHECK(state='unconfirmed'),
  PRIMARY KEY(org_id,source_table,source_row_id,source_field)
);
CREATE INDEX legacy_consent_observations_scope ON legacy_consent_observations(org_id,source_table,source_row_id);

COMMENT ON CONSTRAINT consent_provider_registry_snapshots_nullable_pk ON consent_provider_registry_snapshots IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT consent_disclosure_snapshots_nullable_pk ON consent_disclosure_snapshots IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT consent_events_nullable_pk ON consent_events IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT consent_audit_events_nullable_pk ON consent_audit_events IS 'ccc:sqlite-primary-key';

INSERT INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_recording_at',consent_recording_at,NULL FROM support_cases WHERE consent_recording_at IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_text_ai_at',consent_text_ai_at,NULL FROM support_cases WHERE consent_text_ai_at IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'support_cases',id,'consent_privacy_at',consent_privacy_at,NULL FROM support_cases WHERE consent_privacy_at IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'participant_consent_records',id,'consent_recording_at',consent_recording_at,NULL FROM participant_consent_records WHERE consent_recording_at IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO legacy_consent_observations(org_id,source_table,source_row_id,source_field,observed_at,notice_hash)
SELECT org_id,'participant_consent_records',id,'consent_text_ai_at',consent_text_ai_at,NULL FROM participant_consent_records WHERE consent_text_ai_at IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION ccc_consent_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'consent_append_only'; END $$;
CREATE TRIGGER consent_events_no_update BEFORE UPDATE ON consent_events FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_events_no_delete BEFORE DELETE ON consent_events FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_disclosures_no_update BEFORE UPDATE ON consent_disclosure_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_disclosures_no_delete BEFORE DELETE ON consent_disclosure_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_registry_no_update BEFORE UPDATE ON consent_provider_registry_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_registry_no_delete BEFORE DELETE ON consent_provider_registry_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_audit_no_update BEFORE UPDATE ON consent_audit_events FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();
CREATE TRIGGER consent_audit_no_delete BEFORE DELETE ON consent_audit_events FOR EACH ROW EXECUTE FUNCTION ccc_consent_append_only();

ALTER TABLE agent_jobs ADD COLUMN consent_revision text;
ALTER TABLE agent_jobs ADD COLUMN consent_receipt_json text;
ALTER TABLE agent_jobs ADD COLUMN stt_engine_id text CHECK(stt_engine_id IS NULL OR stt_engine_id IN ('qwen3-asr','azure-speech-koreacentral'));

ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_provider_registry_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_provider_registry_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_disclosure_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_disclosure_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE legacy_consent_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_consent_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON consent_events,consent_disclosure_snapshots,consent_provider_registry_snapshots,consent_audit_events,legacy_consent_observations FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_schema_owner') THEN
    EXECUTE 'ALTER TABLE consent_events OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE consent_disclosure_snapshots OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE consent_provider_registry_snapshots OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE consent_audit_events OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER TABLE legacy_consent_observations OWNER TO ccc_schema_owner';
    EXECUTE 'ALTER FUNCTION ccc_consent_append_only() OWNER TO ccc_schema_owner';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ccc_api') THEN
    EXECUTE 'GRANT SELECT,INSERT ON consent_events,consent_disclosure_snapshots,consent_audit_events,legacy_consent_observations TO ccc_api';
    EXECUTE 'GRANT SELECT ON consent_provider_registry_snapshots TO ccc_api';
    EXECUTE 'CREATE POLICY consent_events_select ON consent_events FOR SELECT TO ccc_api USING(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY consent_events_insert ON consent_events FOR INSERT TO ccc_api WITH CHECK(org_id=current_setting(''app.org_id'',true) AND recorded_by=current_setting(''app.actor_id'',true))';
    EXECUTE 'CREATE POLICY consent_disclosures_scope ON consent_disclosure_snapshots TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY consent_audit_scope_policy ON consent_audit_events TO ccc_api USING(org_id=current_setting(''app.org_id'',true)) WITH CHECK(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY consent_provider_registry_select ON consent_provider_registry_snapshots FOR SELECT TO ccc_api USING(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'CREATE POLICY legacy_observations_select ON legacy_consent_observations FOR SELECT TO ccc_api USING(org_id=current_setting(''app.org_id'',true))';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ccc_consent_append_only() TO ccc_api';
  END IF;
END
$$;
