-- S1 / CCC-216: SQLite 0001..0045 cumulative schema, authored for PostgreSQL.
-- Do not fold operation markers, timestamp normalization, Agent jobs or memory into this boundary.
-- SQLite rowid-table TEXT PRIMARY KEY permits NULL: UNIQUE preserves that behavior and is a
-- valid PostgreSQL foreign-key target. bigint rowid keys retain their non-null primary keys.
-- Timestamp storage is text. Legacy defaults and trigger clocks stay space-form until 0003.
CREATE FUNCTION ccc_legacy_now() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
$$;
CREATE FUNCTION ccc_iso_now() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
-- JSON remains text, including whitespace, duplicate keys and numeric spelling.
CREATE FUNCTION ccc_json_valid(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  PERFORM value::json;
  RETURN true;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
CREATE FUNCTION ccc_json_type(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  RETURN json_typeof(value::json);
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;
CREATE FUNCTION ccc_json_array_length(value text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF json_typeof(value::json) = 'array' THEN RETURN json_array_length(value::json); END IF;
  RETURN 0;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;
-- Schema-only Julian/ISO decoding. SQLite normalizes days 29..31 past short months,
-- accepts time-only values on 2000-01-01, and rounds Julian arithmetic to milliseconds.
-- Reject PostgreSQL-only input such as named months, infinity and relative date words.
CREATE FUNCTION ccc_timestamp(value text) RETURNS timestamp LANGUAGE plpgsql STABLE STRICT SET timezone = 'UTC' AS $$
DECLARE
  parts text[];
  result timestamp;
  year_number integer;
  month_number integer;
  day_number integer;
  hour_number integer;
  minute_number integer;
  second_number numeric;
  zone_value text;
  zone_hours integer;
  zone_minutes integer;
BEGIN
  IF value='now' THEN RETURN date_trunc('milliseconds',statement_timestamp() AT TIME ZONE 'UTC'); END IF;
  IF trim(value) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN
    IF value::numeric<0 OR value::numeric>=5373484.5 THEN RETURN NULL; END IF;
    RETURN timestamp '2000-01-01 12:00:00'+round((value::numeric-2451545)*86400000)*interval '1 millisecond';
  END IF;
  IF value ~ '^[0-9]{2}:[0-9]{2}' THEN value:='2000-01-01T'||value; END IF;
  parts:=regexp_match(value,'^([0-9]{4})-([0-9]{2})-([0-9]{2})([ T]+([0-9]{2}):([0-9]{2})(:([0-9]{2}([.][0-9]+)?))?([ ]*(Z|[+-][0-9]{2}:[0-9]{2}))?)?[ ]*$');
  IF parts IS NULL THEN RETURN NULL; END IF;
  year_number:=parts[1]::integer; month_number:=parts[2]::integer; day_number:=parts[3]::integer;
  hour_number:=COALESCE(parts[5]::integer,0); minute_number:=COALESCE(parts[6]::integer,0);
  second_number:=COALESCE(parts[8]::numeric,0); zone_value:=parts[11];
  IF month_number NOT BETWEEN 1 AND 12 OR day_number NOT BETWEEN 1 AND 31
    OR hour_number NOT BETWEEN 0 AND 24 OR minute_number NOT BETWEEN 0 AND 59 OR second_number>=60 THEN RETURN NULL; END IF;
  result:=make_date(CASE year_number WHEN 0 THEN -1 ELSE year_number END,month_number,1)::timestamp
    +(day_number-1)*interval '1 day'+hour_number*interval '1 hour'+minute_number*interval '1 minute'
    +round(second_number*1000)*interval '1 millisecond';
  IF zone_value IS NOT NULL AND zone_value<>'Z' THEN
    zone_hours:=substr(zone_value,2,2)::integer; zone_minutes:=substr(zone_value,5,2)::integer;
    IF zone_hours>14 OR zone_minutes>59 THEN RETURN NULL; END IF;
    result:=result-(CASE substr(zone_value,1,1) WHEN '-' THEN -1 ELSE 1 END)
      *(zone_hours*interval '1 hour'+zone_minutes*interval '1 minute');
  END IF;
  IF result<timestamp '0001-01-01 BC' OR result>=timestamp '10000-01-01' THEN RETURN NULL; END IF;
  RETURN result;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;
CREATE TABLE users (
  id text UNIQUE, org_id text NOT NULL, email text,
  role text NOT NULL CHECK (role IN ('admin','counselor','service')),
  active bigint NOT NULL DEFAULT 1, created_at text NOT NULL DEFAULT ccc_legacy_now(),
  time_zone text CHECK (time_zone IS NULL OR (length(trim(time_zone)) BETWEEN 3 AND 255
    AND time_zone !~ '[^A-Za-z0-9_+./-]' AND (time_zone = 'UTC' OR position('/' in time_zone) > 0))),
  name text, last_program_type text,
  auth_subject text CHECK (auth_subject IS NULL OR length(trim(auth_subject)) > 0)
);
CREATE TABLE beneficiaries (
  id text UNIQUE CHECK (id ~ '^A[0-9]{3,}$' OR id ~ '^[a-z]+-[0-9]{3,}$'),
  org_id text NOT NULL, initialization_state text NOT NULL DEFAULT 'pending'
    CHECK (initialization_state IN ('pending','complete')),
  created_at text NOT NULL DEFAULT ccc_legacy_now(), updated_at text NOT NULL DEFAULT ccc_legacy_now()
);
CREATE TABLE organization_settings (
  org_id text UNIQUE,
  time_zone text NOT NULL CHECK (length(trim(time_zone)) BETWEEN 3 AND 255
    AND time_zone !~ '[^A-Za-z0-9_+./-]' AND (time_zone = 'UTC' OR position('/' in time_zone) > 0)),
  pii_purge_grace_days bigint NOT NULL CHECK (pii_purge_grace_days BETWEEN 1 AND 3660),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at text NOT NULL DEFAULT ccc_legacy_now(), updated_at text NOT NULL DEFAULT ccc_legacy_now(),
  org_name text CHECK (org_name IS NULL OR length(trim(org_name)) BETWEEN 1 AND 80),
  program_display_name text CHECK (program_display_name IS NULL OR length(trim(program_display_name)) BETWEEN 1 AND 120)
);
CREATE TABLE support_cases (
  id text UNIQUE, org_id text NOT NULL, beneficiary_id text NOT NULL REFERENCES beneficiaries(id),
  legacy_case_id text UNIQUE, program_type text NOT NULL DEFAULT 'financial_support_v1' CHECK (program_type IN ('financial_support_v1')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  intake_at text, consent_recording_at text, consent_text_ai_at text, closed_at text,
  closed_reason text, closed_by_actor_id text, extra text,
  creation_kind text NOT NULL CHECK (creation_kind IN ('legacy_import','initial','subsequent')),
  creation_submission_id text,
  creation_payload_hash text CHECK (creation_payload_hash IS NULL OR (length(creation_payload_hash)=64 AND creation_payload_hash !~ '[^0-9a-f]')),
  created_by_actor_id text, source_support_case_id text REFERENCES support_cases(id), initial_assignee_user_id text,
  created_at text NOT NULL, updated_at text NOT NULL, consent_privacy_at text, overall_goal text,
  emergency_registration_at text, emergency_registration_reason text, consent_privacy_due_at text,
  CHECK ((creation_kind IN ('legacy_import','initial') AND creation_submission_id IS NULL AND creation_payload_hash IS NULL
    AND created_by_actor_id IS NULL AND source_support_case_id IS NULL AND initial_assignee_user_id IS NULL)
    OR (creation_kind='subsequent' AND length(trim(creation_submission_id))>0 AND creation_payload_hash IS NOT NULL
      AND length(trim(created_by_actor_id))>0 AND length(trim(initial_assignee_user_id))>0)),
  CHECK ((creation_kind='legacy_import' AND legacy_case_id IS NOT NULL)
    OR (creation_kind='initial' AND (legacy_case_id IS NULL OR legacy_case_id=beneficiary_id))
    OR (creation_kind='subsequent' AND legacy_case_id IS NULL)),
  CHECK (creation_kind='legacy_import'
    OR (status='active' AND closed_at IS NULL AND closed_reason IS NULL AND closed_by_actor_id IS NULL)
    OR (status='closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL AND closed_by_actor_id IS NOT NULL))
);
CREATE TABLE support_case_assignees (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary','secondary')), assigned_at text NOT NULL, unassigned_at text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('requested','active','ended')),
  acceptance_requested_by text, accepted_at text, transfer_reason text, notified_by text, notified_at text
);
CREATE TABLE participant_pii_vault (
  beneficiary_id text UNIQUE REFERENCES beneficiaries(id), org_id text NOT NULL,
  enc_name text, enc_phone text, enc_account text, key_version bigint NOT NULL CHECK (key_version>0),
  version bigint NOT NULL CHECK (version>0), purge_due text, purged_at text, purged_by text,
  purged_by_role text CHECK (purged_by_role IN ('admin','service')), retention_changed_by text,
  retention_context_support_case_id text REFERENCES support_cases(id),
  retention_change_kind text NOT NULL CHECK (retention_change_kind IN ('legacy_import','create','schedule_pii_purge_due','cancel_pii_purge_due','purge_pii','re_register_pii')),
  retention_changed_at text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
  enc_email text, enc_birth_date text, enc_region text, enc_emergency_contact text, enc_gender text,
  CHECK ((purged_at IS NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR (retention_change_kind='legacy_import' AND purged_at IS NOT NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR (purged_at IS NOT NULL AND purged_by IS NOT NULL AND purged_by_role IN ('admin','service'))),
  CHECK (retention_change_kind='legacy_import' OR purged_at IS NULL OR (enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL))
);
CREATE TABLE sessions (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), counselor_id text NOT NULL,
  held_at text NOT NULL, channel text NOT NULL CHECK (channel IN ('in_person','phone','video')), memo text, submission_id text,
  submission_hash text CHECK (submission_hash IS NULL OR (length(submission_hash)=64 AND submission_hash !~ '[^0-9a-f]')),
  submitted_by text, ai_status text NOT NULL CHECK (ai_status IN ('none','uploaded','processing','review_ready','approved')),
  transcript text, audio_r2_key text, ai_summary text, ai_schema text, ai_contrast text, emotion_scores text,
  speaker_mapping_confirmed_at text, approved_at text, approved_by text, extra text, created_at text NOT NULL, updated_at text NOT NULL,
  kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','intake')), intake_details text, record_details text,
  CHECK ((submission_id IS NULL AND submission_hash IS NULL AND submitted_by IS NULL)
    OR (length(trim(submission_id))>0 AND submission_hash IS NOT NULL AND length(trim(submitted_by))>0))
);
CREATE TABLE goals (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), title text NOT NULL,
  scale_criteria text, status text NOT NULL CHECK (status IN ('active','closed')), closed_reason text, closed_at text,
  replaced_by_goal_id text REFERENCES goals(id), created_at text NOT NULL
);
CREATE TABLE goal_revisions (
  id bigint PRIMARY KEY, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  goal_id text REFERENCES goals(id), title text, edited_by text NOT NULL, edited_at text NOT NULL
);
CREATE TABLE counseling_schedules (
  id text UNIQUE, org_id text NOT NULL, beneficiary_id text NOT NULL REFERENCES beneficiaries(id),
  support_case_id text NOT NULL REFERENCES support_cases(id), scheduled_at text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','completed','cancelled','no_show')), version bigint NOT NULL CHECK (version>0),
  completed_session_id text REFERENCES sessions(id), created_by_actor_id text NOT NULL, updated_by_actor_id text,
  completed_by_actor_id text, completed_at text, created_at text NOT NULL, updated_at text NOT NULL,
  session_kind text NOT NULL DEFAULT 'regular' CHECK (session_kind IN ('regular','intake')),
  channel text NOT NULL DEFAULT 'in_person' CHECK (channel IN ('in_person')),
  CHECK ((status IN ('scheduled','cancelled','no_show') AND completed_session_id IS NULL AND completed_by_actor_id IS NULL AND completed_at IS NULL)
    OR (status='completed' AND completed_session_id IS NOT NULL AND completed_by_actor_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TABLE action_items (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text REFERENCES sessions(id),
  description text NOT NULL, owner text NOT NULL CHECK (owner IN ('counselor','beneficiary','org')), due_date text,
  resolved_at text, resolved_by text, created_at text NOT NULL,
  resolution_status text CHECK (resolution_status IN ('done','in_progress','not_done','hold')),
  resolution_note text, resolution_at text, resolution_session_id text REFERENCES sessions(id)
);
CREATE TABLE flags (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text REFERENCES sessions(id),
  flag_type text NOT NULL CHECK (flag_type IN ('crisis_utterance','contact_loss_risk','housing_livelihood_shock','debt_deterioration','repeated_noncompliance','violence_exploitation')),
  quote text, source text NOT NULL CHECK (source IN ('ai','counselor')),
  review_status text NOT NULL CHECK (review_status IN ('pending','confirmed','rejected')), reviewed_by text, reviewed_at text,
  created_at text NOT NULL, CHECK (source='counselor' OR quote IS NOT NULL)
);
CREATE TABLE session_goal_scores (
  id text UNIQUE, org_id text NOT NULL, session_id text NOT NULL REFERENCES sessions(id), goal_id text NOT NULL REFERENCES goals(id),
  score bigint NOT NULL CHECK (score BETWEEN -2 AND 2), evidence_quote text, scored_by text NOT NULL, created_at text NOT NULL,
  UNIQUE(session_id,goal_id)
);
CREATE TABLE ai_gas_evidence (
  id text UNIQUE, org_id text NOT NULL, session_id text NOT NULL REFERENCES sessions(id), goal_id text NOT NULL REFERENCES goals(id),
  quote text NOT NULL, created_at text NOT NULL
);
CREATE TABLE session_life_area_snapshots (
  id text UNIQUE, org_id text NOT NULL, session_id text NOT NULL REFERENCES sessions(id),
  area_key text NOT NULL CHECK (area_key IN ('economy','housing','employment','health','mental_health','family')),
  status text NOT NULL CHECK (status IN ('okay','strained','crisis','not_applicable','declined')), note text,
  created_at text NOT NULL DEFAULT ccc_legacy_now(), UNIQUE(session_id,area_key)
);
CREATE TABLE session_discrepancies (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  kind text NOT NULL CHECK (kind IN ('cross_session','within_session')), trigger_session_id text NOT NULL REFERENCES sessions(id),
  left_session_id text NOT NULL REFERENCES sessions(id), left_quote text NOT NULL CHECK (length(trim(left_quote)) BETWEEN 1 AND 500),
  right_session_id text NOT NULL REFERENCES sessions(id), right_quote text NOT NULL CHECK (length(trim(right_quote)) BETWEEN 1 AND 500),
  detected_at text NOT NULL, resolution_status text CHECK (resolution_status IN ('situation_changed','record_error','confirmed')),
  resolved_by text, resolved_at text, created_at text NOT NULL,
  CHECK (kind<>'within_session' OR left_session_id=right_session_id), CHECK (kind<>'cross_session' OR left_session_id<>right_session_id),
  CHECK ((resolution_status IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (resolution_status IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE TABLE schedule_custom_questions (
  id text UNIQUE, org_id text NOT NULL, schedule_id text NOT NULL REFERENCES counseling_schedules(id),
  support_case_id text NOT NULL REFERENCES support_cases(id), body text NOT NULL, ordinal bigint NOT NULL, created_by text NOT NULL,
  created_at text NOT NULL DEFAULT ccc_legacy_now(), UNIQUE(schedule_id,ordinal)
);
CREATE TABLE schedule_session_goals (
  id text UNIQUE, org_id text NOT NULL, schedule_id text NOT NULL REFERENCES counseling_schedules(id),
  support_case_id text NOT NULL REFERENCES support_cases(id), case_goal_id text REFERENCES goals(id), body text NOT NULL,
  ordinal bigint NOT NULL, created_by text NOT NULL, created_at text NOT NULL DEFAULT ccc_legacy_now(), UNIQUE(schedule_id,ordinal)
);
CREATE TABLE invite_tokens (
  token text UNIQUE, org_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('participant','counselor')), program_type text,
  issued_by text NOT NULL, status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','used')),
  issued_at text NOT NULL DEFAULT ccc_legacy_now(), used_at text, used_by_beneficiary_id text, used_by_user_id text, revoked_at text,
  CHECK (kind<>'participant' OR program_type IS NOT NULL)
);
CREATE TABLE participant_consent_records (
  id text UNIQUE, org_id text NOT NULL, beneficiary_id text NOT NULL REFERENCES beneficiaries(id),
  support_case_id text NOT NULL REFERENCES support_cases(id), consent_recording_at text, consent_text_ai_at text,
  recorded_by text NOT NULL, recorded_at text NOT NULL DEFAULT ccc_legacy_now(), created_at text NOT NULL DEFAULT ccc_legacy_now(),
  consent_privacy_at text, privacy_notice_version text, privacy_notice_sha256 text, privacy_evidence_ref text
);
CREATE TABLE audit_log (
  id bigint PRIMARY KEY, org_id text NOT NULL, actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('admin','counselor','service')), action text NOT NULL, target_table text NOT NULL,
  target_id text, beneficiary_id text REFERENCES beneficiaries(id), support_case_id text REFERENCES support_cases(id),
  case_id text, detail text, created_at text NOT NULL DEFAULT ccc_legacy_now()
);
CREATE TABLE participant_support_case_cutover_manifest (
  migration_id text UNIQUE CHECK (migration_id='0006_participant_support_case_cutover'),
  beneficiary_count bigint NOT NULL, support_case_count bigint NOT NULL, session_count bigint NOT NULL, approved_ai_count bigint NOT NULL,
  pii_vault_count bigint NOT NULL, legacy_case_map_count bigint NOT NULL, completed_at text NOT NULL DEFAULT ccc_legacy_now()
);
CREATE TABLE teams (
  id text UNIQUE, org_id text NOT NULL, name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by text NOT NULL REFERENCES users(id), created_at text NOT NULL DEFAULT ccc_legacy_now(), archived_at text
);
CREATE TABLE team_memberships (
  id text UNIQUE, org_id text NOT NULL, team_id text NOT NULL REFERENCES teams(id), user_id text NOT NULL REFERENCES users(id),
  added_by text NOT NULL REFERENCES users(id), joined_at text NOT NULL DEFAULT ccc_legacy_now(), ended_at text
);
CREATE TABLE team_supervisor_grants (
  id text UNIQUE, org_id text NOT NULL, team_id text NOT NULL REFERENCES teams(id), supervisor_user_id text NOT NULL REFERENCES users(id),
  granted_by text NOT NULL REFERENCES users(id), granted_at text NOT NULL DEFAULT ccc_legacy_now(), revoked_at text
);
CREATE TABLE user_role_assignments (
  id text UNIQUE, org_id text NOT NULL, user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('institution_admin','institution_technical_admin','practitioner')),
  source text NOT NULL CHECK (source IN ('legacy','manual')), granted_by text,
  granted_at text NOT NULL DEFAULT ccc_legacy_now(), revoked_at text,
  CHECK ((source='legacy' AND granted_by IS NULL) OR (source='manual' AND granted_by IS NOT NULL))
);
CREATE TABLE agent_installations (
  installation_id text UNIQUE, org_id text NOT NULL, actor_user_id text NOT NULL REFERENCES users(id), paired_at text NOT NULL, revoked_at text
);
CREATE TABLE auth_revocations (
  id text UNIQUE, kind text NOT NULL CHECK (kind IN ('session','actor')), subject text NOT NULL CHECK (length(trim(subject))>0),
  revoked_at text NOT NULL, reason text NOT NULL CHECK (reason IN ('logout','password-reset','mfa-reset','admin-disable','pairing-revoked','security-event'))
);

CREATE TABLE ai_provider_configs (
  id text UNIQUE, org_id text NOT NULL, adapter_id text NOT NULL CHECK (length(trim(adapter_id))>0),
  adapter_version text NOT NULL CHECK (length(trim(adapter_version))>0), config_hash text NOT NULL CHECK (length(trim(config_hash))>0),
  approval_refs_json text NOT NULL CHECK (length(trim(approval_refs_json))>0), created_by text NOT NULL,
  created_at text NOT NULL DEFAULT ccc_legacy_now(), UNIQUE(org_id,adapter_id,adapter_version,config_hash)
);
CREATE TABLE ai_provider_activations (
  id text UNIQUE, org_id text NOT NULL, config_id text NOT NULL REFERENCES ai_provider_configs(id),
  previous_activation_id text REFERENCES ai_provider_activations(id), activated_by text NOT NULL,
  activated_at text NOT NULL DEFAULT ccc_legacy_now(), deactivated_at text,
  CHECK (deactivated_at IS NULL OR deactivated_at>=activated_at)
);
CREATE TABLE pilot_text_ai_consent_evidence (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  notice_version text NOT NULL CHECK (length(trim(notice_version))>0), notice_sha256 text NOT NULL CHECK (length(trim(notice_sha256))>0),
  evidence_ref text NOT NULL CHECK (length(trim(evidence_ref))>0), evidence_sha256 text NOT NULL CHECK (length(trim(evidence_sha256))>0),
  captured_by text NOT NULL, effective_at text NOT NULL, created_at text NOT NULL
);
CREATE TABLE ai_masked_source_snapshots (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  masked_text text NOT NULL CHECK (length(masked_text)>0), sha256 text NOT NULL CHECK (length(sha256)=64 AND sha256 !~ '[^0-9a-f]'),
  masking_pipeline_version text NOT NULL CHECK (length(trim(masking_pipeline_version))>0), created_by text NOT NULL, created_at text NOT NULL
);
CREATE TABLE ai_masked_source_evidence_items (
  id text UNIQUE, snapshot_id text NOT NULL REFERENCES ai_masked_source_snapshots(id), org_id text NOT NULL,
  support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  source_ref text NOT NULL CHECK (length(trim(source_ref))>0),
  source_sha256 text NOT NULL CHECK (length(source_sha256)=64 AND source_sha256 !~ '[^0-9a-f]'),
  evidence_quote text NOT NULL CHECK (length(evidence_quote)>0), source_start bigint NOT NULL CHECK (source_start>=0),
  source_end bigint NOT NULL CHECK (source_end>source_start), created_at text NOT NULL, UNIQUE(snapshot_id,source_ref,source_start,source_end)
);
CREATE TABLE ai_work_items (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  kind text NOT NULL CHECK (kind='text_ai_briefing'), created_at text NOT NULL, UNIQUE(session_id,kind)
);
CREATE TABLE ai_draft_versions (
  id text UNIQUE, work_item_id text NOT NULL REFERENCES ai_work_items(id), version bigint NOT NULL CHECK (version>0),
  parent_version_id text REFERENCES ai_draft_versions(id), summary_text text NOT NULL,
  questions_json text NOT NULL CHECK (ccc_json_valid(questions_json) AND ccc_json_type(questions_json)='array'),
  source_snapshot_id text REFERENCES ai_masked_source_snapshots(id), source_snapshot_hash text,
  consent_evidence_id text REFERENCES pilot_text_ai_consent_evidence(id), provider_config_id text REFERENCES ai_provider_configs(id),
  model_id text, prompt_version text, schema_version text,
  origin text NOT NULL CHECK (origin IN ('generated','legacy_import','fixture_generated')),
  creation_mode text NOT NULL CHECK (creation_mode IN ('provider_generated','human_edited','legacy_import','fixture_generated')),
  grounding_status text NOT NULL CHECK (grounding_status IN ('grounded','legacy_unverified')),
  created_by text, created_at text NOT NULL, one_liner text,
  claims_json text NOT NULL DEFAULT '[]' CHECK (ccc_json_valid(claims_json) AND ccc_json_type(claims_json)='array'),
  UNIQUE(work_item_id,version),
  CHECK (
    (origin='generated' AND creation_mode IN ('provider_generated','human_edited') AND grounding_status='grounded'
      AND source_snapshot_id IS NOT NULL AND source_snapshot_hash IS NOT NULL AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL AND model_id IS NOT NULL AND prompt_version IS NOT NULL
      AND schema_version IS NOT NULL AND created_by IS NOT NULL) AND ccc_json_array_length(questions_json) BETWEEN 2 AND 3
    OR (origin='legacy_import' AND creation_mode='legacy_import' AND grounding_status='legacy_unverified'
      AND source_snapshot_id IS NULL AND source_snapshot_hash IS NULL AND consent_evidence_id IS NULL AND provider_config_id IS NULL
      AND model_id IS NULL AND prompt_version IS NULL AND schema_version IS NULL AND created_by IS NULL) AND ccc_json_array_length(questions_json)=0
    OR (origin='fixture_generated' AND creation_mode='fixture_generated' AND version=1 AND parent_version_id IS NULL
      AND grounding_status='grounded' AND source_snapshot_id IS NOT NULL AND source_snapshot_hash IS NOT NULL
      AND consent_evidence_id IS NOT NULL AND provider_config_id IS NULL AND model_id IS NULL
      AND prompt_version IS NOT NULL AND schema_version IS NOT NULL AND created_by IS NOT NULL) AND ccc_json_array_length(questions_json) BETWEEN 2 AND 3)
);
CREATE TABLE ai_evidence_links (
  id text UNIQUE, draft_version_id text NOT NULL REFERENCES ai_draft_versions(id),
  source_evidence_item_id text NOT NULL REFERENCES ai_masked_source_evidence_items(id), claim_key text NOT NULL CHECK (length(trim(claim_key))>0),
  evidence_quote text NOT NULL, source_ref text NOT NULL CHECK (length(trim(source_ref))>0),
  source_start bigint NOT NULL CHECK (source_start>=0), source_end bigint NOT NULL CHECK (source_end>source_start),
  created_at text NOT NULL DEFAULT ccc_legacy_now(), UNIQUE(draft_version_id,claim_key,source_evidence_item_id)
);
CREATE TABLE ai_review_events (
  id text UNIQUE, work_item_id text NOT NULL REFERENCES ai_work_items(id), draft_version_id text NOT NULL REFERENCES ai_draft_versions(id),
  decision text NOT NULL CHECK (decision IN ('approved','rejected','superseded')), replacement_draft_id text REFERENCES ai_draft_versions(id),
  actor_id text, created_at text NOT NULL DEFAULT ccc_legacy_now(),
  CHECK ((decision='superseded' AND replacement_draft_id IS NOT NULL) OR (decision IN ('approved','rejected') AND replacement_draft_id IS NULL))
);
CREATE TABLE ai_draft_source_materials (
  id text UNIQUE, draft_version_id text NOT NULL REFERENCES ai_draft_versions(id), org_id text NOT NULL,
  support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  kind text NOT NULL CHECK (kind IN ('transcript','text_context')), snapshot_id text NOT NULL REFERENCES ai_masked_source_snapshots(id),
  snapshot_sha256 text NOT NULL CHECK (length(snapshot_sha256)=64 AND snapshot_sha256 !~ '[^0-9a-f]'),
  created_at text NOT NULL, UNIQUE(draft_version_id,kind), UNIQUE(draft_version_id,snapshot_id)
);
CREATE TABLE ai_draft_contrast_axes (
  id text UNIQUE, draft_version_id text NOT NULL REFERENCES ai_draft_versions(id), org_id text NOT NULL,
  support_case_id text NOT NULL REFERENCES support_cases(id),
  axis text NOT NULL CHECK (axis IN ('missing_from_memo','missing_from_transcript','undiscussed_session_goal')),
  status text NOT NULL CHECK (status IN ('applied','no_transcript','no_text','no_session_goal')),
  findings_json text NOT NULL CHECK (ccc_json_valid(findings_json) AND ccc_json_type(findings_json)='array'),
  created_at text NOT NULL, UNIQUE(draft_version_id,axis), CHECK (status='applied' OR ccc_json_array_length(findings_json)=0)
);
CREATE TABLE ai_text_work_queue (
  id text UNIQUE, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id), session_id text NOT NULL REFERENCES sessions(id),
  reason text NOT NULL CHECK (reason IN ('manual_record','ai_draft_approved','goal_revised')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done')), enqueued_at text NOT NULL, completed_at text,
  lease_owner text, lease_expires_at text, attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  completed_snapshot_id text REFERENCES ai_masked_source_snapshots(id),
  CHECK ((status='done')=(completed_at IS NOT NULL)),
  CHECK (status<>'pending' OR (lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK (status<>'processing' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (completed_snapshot_id IS NULL OR status='done')
);
CREATE TABLE recording_result_commits (
  session_id text UNIQUE REFERENCES sessions(id), org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  snapshot_id text NOT NULL REFERENCES ai_masked_source_snapshots(id),
  result_sha256 text NOT NULL CHECK (length(result_sha256)=64 AND result_sha256 !~ '[^0-9a-f]'),
  emotion_scores text NOT NULL CHECK (ccc_json_valid(emotion_scores) AND ccc_json_type(emotion_scores)='object'),
  created_by text NOT NULL, created_at text NOT NULL, downstream_claimed_at text, finalized_at text,
  transcript_quality text CHECK (transcript_quality IS NULL OR (ccc_json_valid(transcript_quality) AND ccc_json_type(transcript_quality)='object'))
);
CREATE TABLE participant_pii_archives (
  id text NOT NULL UNIQUE, beneficiary_id text UNIQUE REFERENCES participant_pii_vault(beneficiary_id), org_id text NOT NULL,
  enc_name text, enc_phone text, enc_account text, enc_email text, enc_birth_date text, enc_region text, enc_emergency_contact text, enc_gender text,
  key_version bigint NOT NULL CHECK (key_version>0), archived_at text NOT NULL, archived_by text NOT NULL, retention_cap_due_at text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('pending','retained','approved','purged')), review_due_at text NOT NULL,
  review_reason_kind text CHECK (review_reason_kind IN ('extended_consent','active_work','legal_requirement')), review_reason text,
  reviewed_by text, reviewed_at text, approved_by text, approved_at text, purged_at text, state_changed_by text NOT NULL,
  state_changed_by_role text NOT NULL CHECK (state_changed_by_role IN ('admin','service')), state_changed_at text NOT NULL,
  created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(org_id,beneficiary_id),
  CHECK (ccc_timestamp(retention_cap_due_at) IS NOT NULL AND ccc_timestamp(archived_at) IS NOT NULL),
  CHECK ((review_status='pending' AND review_reason_kind IS NULL AND review_reason IS NULL AND reviewed_by IS NULL
      AND reviewed_at IS NULL AND approved_by IS NULL AND approved_at IS NULL AND purged_at IS NULL)
    OR (review_status='retained' AND review_reason_kind IS NOT NULL AND review_reason IS NOT NULL AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL AND approved_by IS NULL AND approved_at IS NULL AND purged_at IS NULL)
    OR (review_status='approved' AND review_reason_kind IS NULL AND review_reason IS NULL AND reviewed_by IS NULL
      AND reviewed_at IS NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND purged_at IS NULL)
    OR (review_status='purged' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND purged_at IS NOT NULL
      AND enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL AND enc_email IS NULL AND enc_birth_date IS NULL
      AND enc_region IS NULL AND enc_emergency_contact IS NULL AND enc_gender IS NULL))
);
CREATE TABLE participant_pii_retention_decisions (
  id text UNIQUE, archive_id text NOT NULL, org_id text NOT NULL, beneficiary_id text NOT NULL REFERENCES beneficiaries(id),
  decision text NOT NULL CHECK (decision IN ('retain','purge')),
  reason_kind text CHECK (reason_kind IN ('extended_consent','active_work','legal_requirement')), reason text, retain_until text,
  decided_by text NOT NULL, decided_at text NOT NULL, UNIQUE(id,org_id),
  CHECK ((decision='retain' AND reason_kind IS NOT NULL AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500 AND retain_until IS NOT NULL)
    OR (decision='purge' AND reason_kind IS NULL AND reason IS NULL AND retain_until IS NULL))
);

CREATE INDEX idx_actions_open ON action_items(support_case_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_agent_installations_actor ON agent_installations(org_id,actor_user_id,revoked_at);
CREATE INDEX idx_ai_draft_contrast_axes_draft ON ai_draft_contrast_axes(draft_version_id,axis);
CREATE INDEX idx_ai_draft_source_materials_draft ON ai_draft_source_materials(draft_version_id,kind);
CREATE INDEX idx_ai_draft_versions_provider_config ON ai_draft_versions(provider_config_id) WHERE provider_config_id IS NOT NULL;
CREATE INDEX idx_ai_draft_versions_source_snapshot ON ai_draft_versions(source_snapshot_id) WHERE source_snapshot_id IS NOT NULL;
CREATE INDEX idx_ai_draft_versions_work ON ai_draft_versions(work_item_id,version DESC);
CREATE INDEX idx_ai_evidence_links_draft ON ai_evidence_links(draft_version_id,claim_key);
CREATE INDEX idx_ai_masked_source_evidence_items_scope ON ai_masked_source_evidence_items(org_id,support_case_id,session_id,snapshot_id,source_start);
CREATE INDEX idx_ai_masked_source_snapshots_scope ON ai_masked_source_snapshots(org_id,support_case_id,session_id,created_at DESC);
CREATE INDEX idx_ai_provider_activations_org ON ai_provider_activations(org_id,activated_at DESC);
CREATE INDEX idx_ai_provider_configs_org ON ai_provider_configs(org_id,adapter_id,created_at DESC);
CREATE INDEX idx_ai_review_events_work ON ai_review_events(work_item_id,created_at DESC);
CREATE UNIQUE INDEX idx_ai_text_work_queue_one_open_per_session ON ai_text_work_queue(org_id,session_id) WHERE status IN ('pending','processing');
CREATE INDEX idx_ai_text_work_queue_pending ON ai_text_work_queue(org_id,status,enqueued_at);
CREATE INDEX idx_ai_work_items_org_support_case ON ai_work_items(org_id,support_case_id,created_at DESC);
CREATE INDEX idx_ai_work_items_session ON ai_work_items(session_id,kind);
CREATE INDEX idx_audit_actor ON audit_log(actor_id,created_at);
CREATE INDEX idx_audit_beneficiary ON audit_log(beneficiary_id,created_at);
CREATE INDEX idx_audit_support_case ON audit_log(support_case_id,created_at);
CREATE INDEX idx_auth_revocations_subject ON auth_revocations(kind,subject,revoked_at);
CREATE INDEX idx_beneficiaries_org_initialization ON beneficiaries(org_id,initialization_state,id);
CREATE INDEX idx_counseling_schedules_support_case ON counseling_schedules(support_case_id,status,scheduled_at);
CREATE INDEX idx_flags_support_case ON flags(support_case_id,review_status);
CREATE INDEX idx_gas_evidence_session ON ai_gas_evidence(session_id);
CREATE INDEX idx_goal_revisions_case ON goal_revisions(support_case_id,id);
CREATE INDEX idx_goal_revisions_goal ON goal_revisions(goal_id,id) WHERE goal_id IS NOT NULL;
CREATE INDEX idx_goals_support_case ON goals(support_case_id,status);
CREATE INDEX idx_invite_tokens_org ON invite_tokens(org_id,kind,status);
CREATE INDEX idx_life_area_session ON session_life_area_snapshots(session_id);
CREATE INDEX idx_participant_consent_records_scope ON participant_consent_records(org_id,beneficiary_id,support_case_id,recorded_at DESC);
CREATE INDEX idx_participant_pii_archives_review ON participant_pii_archives(org_id,review_status,review_due_at);
CREATE INDEX idx_participant_pii_retention_decisions_archive ON participant_pii_retention_decisions(archive_id,decision,decided_at);
CREATE INDEX idx_participant_pii_retention_decisions_history ON participant_pii_retention_decisions(org_id,beneficiary_id,decided_at);
CREATE INDEX idx_participant_pii_vault_due ON participant_pii_vault(purge_due) WHERE purged_at IS NULL AND purge_due IS NOT NULL;
CREATE INDEX idx_pilot_text_ai_consent_support_case ON pilot_text_ai_consent_evidence(org_id,support_case_id,effective_at DESC);
CREATE UNIQUE INDEX idx_recording_result_commits_snapshot ON recording_result_commits(snapshot_id);
CREATE INDEX idx_schedule_custom_questions_schedule ON schedule_custom_questions(schedule_id,ordinal);
CREATE INDEX idx_schedule_session_goals_schedule ON schedule_session_goals(schedule_id,ordinal);
CREATE INDEX idx_scores_goal ON session_goal_scores(goal_id);
CREATE INDEX idx_session_discrepancies_case ON session_discrepancies(org_id,support_case_id,resolution_status);
CREATE INDEX idx_session_discrepancies_trigger ON session_discrepancies(org_id,trigger_session_id);
CREATE INDEX idx_sessions_pending ON sessions(support_case_id) WHERE ai_status='review_ready';
CREATE INDEX idx_sessions_support_case ON sessions(support_case_id,held_at DESC);
CREATE INDEX idx_support_case_assignees_status ON support_case_assignees(org_id,status,unassigned_at);
CREATE INDEX idx_support_case_assignees_user ON support_case_assignees(user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_support_cases_beneficiary_status ON support_cases(beneficiary_id,status,created_at DESC);
CREATE INDEX idx_support_cases_privacy_consent_followup ON support_cases(org_id,consent_privacy_at,consent_privacy_due_at);
CREATE INDEX idx_team_memberships_user ON team_memberships(org_id,user_id,team_id) WHERE ended_at IS NULL;
CREATE INDEX idx_team_supervisor_grants_supervisor ON team_supervisor_grants(org_id,supervisor_user_id,team_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_teams_org ON teams(org_id,archived_at,name);
CREATE INDEX idx_user_role_assignments_role ON user_role_assignments(org_id,role,user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_users_org ON users(org_id,active);
CREATE UNIQUE INDEX uq_ai_provider_activations_one_active_org ON ai_provider_activations(org_id) WHERE deactivated_at IS NULL;
CREATE UNIQUE INDEX uq_ai_review_events_approved_work ON ai_review_events(work_item_id) WHERE decision='approved';
CREATE UNIQUE INDEX uq_ai_review_events_terminal_draft ON ai_review_events(draft_version_id);
CREATE UNIQUE INDEX uq_sessions_manual_submission ON sessions(org_id,support_case_id,submission_id) WHERE submission_id IS NOT NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_active ON support_case_assignees(support_case_id,user_id) WHERE unassigned_at IS NULL AND status IN ('requested','active');
CREATE UNIQUE INDEX uq_support_case_assignees_primary_active ON support_case_assignees(support_case_id) WHERE role='primary' AND unassigned_at IS NULL AND status='active';
CREATE UNIQUE INDEX uq_support_cases_actor_submission ON support_cases(org_id,created_by_actor_id,creation_submission_id) WHERE creation_submission_id IS NOT NULL;
CREATE UNIQUE INDEX uq_support_cases_one_initial_per_beneficiary ON support_cases(beneficiary_id) WHERE creation_kind='initial';
CREATE UNIQUE INDEX uq_team_memberships_active ON team_memberships(org_id,team_id,user_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_team_supervisor_grants_active ON team_supervisor_grants(org_id,team_id,supervisor_user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_user_role_assignments_active ON user_role_assignments(org_id,user_id,role) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_users_auth_subject ON users(auth_subject) WHERE auth_subject IS NOT NULL;
CREATE UNIQUE INDEX uq_users_email ON users(email) WHERE email IS NOT NULL;

CREATE VIEW approved_ai_briefing_v1 AS
SELECT work.id AS work_item_id, work.org_id, work.support_case_id,
  COALESCE(support_case.legacy_case_id,support_case.id) AS case_id, support_case.beneficiary_id,
  support_case.program_type AS support_case_program_type, support_case.status AS support_case_status,
  work.session_id, work.kind, draft.id AS draft_version_id, draft.version AS draft_version,
  draft.summary_text, draft.claims_json, draft.questions_json, draft.one_liner, draft.summary_text AS ai_summary,
  draft.source_snapshot_id, draft.source_snapshot_hash, draft.consent_evidence_id, draft.provider_config_id,
  draft.model_id, draft.prompt_version, draft.schema_version, draft.origin, draft.creation_mode, draft.grounding_status,
  draft.created_by AS draft_created_by, draft.created_at AS draft_created_at, review.id AS review_event_id,
  review.actor_id AS approved_by, review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work ON work.id=review.work_item_id
JOIN support_cases AS support_case ON support_case.id=work.support_case_id
JOIN ai_draft_versions AS draft ON draft.id=review.draft_version_id AND draft.work_item_id=work.id
WHERE review.decision='approved' AND draft.origin<>'fixture_generated';
CREATE VIEW grounded_ai_quality_v1 AS SELECT * FROM approved_ai_briefing_v1 WHERE origin='generated' AND grounding_status='grounded';
CREATE VIEW case_assignees AS
SELECT assignment.id,assignment.org_id,support_case.legacy_case_id AS case_id,assignment.user_id,
  assignment.role,assignment.assigned_at,assignment.unassigned_at
FROM support_case_assignees AS assignment JOIN support_cases AS support_case ON support_case.id=assignment.support_case_id
WHERE support_case.legacy_case_id IS NOT NULL AND assignment.status='active';
CREATE VIEW cases AS
SELECT support_case.legacy_case_id AS id,support_case.org_id,support_case.program_type,support_case.status,
  support_case.intake_at,support_case.consent_recording_at,support_case.consent_text_ai_at,support_case.closed_at,
  support_case.closed_reason,vault.purge_due,support_case.extra,support_case.created_at,support_case.updated_at
FROM support_cases AS support_case LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id=support_case.beneficiary_id AND vault.org_id=support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL;

-- Shared body only for unconditional aborts; each source trigger keeps its own event/name.
CREATE FUNCTION ccc_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE=TG_ARGV[0]; END;
$$;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D14: audit_log is append-only');
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D14: audit_log is append-only');
CREATE TRIGGER goal_revisions_no_delete BEFORE DELETE ON goal_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D62: goal_revisions is append-only');
CREATE TRIGGER goal_revisions_no_update BEFORE UPDATE ON goal_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D62: goal_revisions is append-only');
CREATE TRIGGER auth_revocations_no_delete BEFORE DELETE ON auth_revocations FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('auth_revocations_are_append_only');
CREATE TRIGGER auth_revocations_no_update BEFORE UPDATE ON auth_revocations FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('auth_revocations_are_append_only');
CREATE TRIGGER agent_installations_no_delete BEFORE DELETE ON agent_installations FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('agent_installations_are_append_only');
CREATE TRIGGER agent_installations_identity_immutable BEFORE UPDATE OF installation_id,org_id,actor_user_id,paired_at ON agent_installations FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('agent_installation_identity_immutable');
CREATE TRIGGER ai_draft_contrast_axes_no_delete BEFORE DELETE ON ai_draft_contrast_axes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('ccc102: contrast axes are append-only');
CREATE TRIGGER ai_draft_contrast_axes_no_update BEFORE UPDATE ON ai_draft_contrast_axes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('ccc102: contrast axes are append-only');
CREATE TRIGGER ai_draft_source_materials_no_delete BEFORE DELETE ON ai_draft_source_materials FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('ccc102: draft source materials are append-only');
CREATE TRIGGER ai_draft_source_materials_no_update BEFORE UPDATE ON ai_draft_source_materials FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('ccc102: draft source materials are append-only');
CREATE TRIGGER ai_draft_versions_no_delete BEFORE DELETE ON ai_draft_versions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI draft versions are append-only');
CREATE TRIGGER ai_draft_versions_no_update BEFORE UPDATE ON ai_draft_versions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI draft versions are append-only');
CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard BEFORE INSERT ON ai_draft_versions FOR EACH ROW WHEN (NEW.origin='legacy_import') EXECUTE FUNCTION ccc_reject_write('phase1: runtime legacy AI import is prohibited');
CREATE TRIGGER ai_evidence_links_no_delete BEFORE DELETE ON ai_evidence_links FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI evidence links are append-only');
CREATE TRIGGER ai_evidence_links_no_update BEFORE UPDATE ON ai_evidence_links FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI evidence links are append-only');
CREATE TRIGGER ai_masked_source_evidence_items_no_delete BEFORE DELETE ON ai_masked_source_evidence_items FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: masked source evidence items are append-only');
CREATE TRIGGER ai_masked_source_evidence_items_no_update BEFORE UPDATE ON ai_masked_source_evidence_items FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: masked source evidence items are append-only');
CREATE TRIGGER ai_masked_source_snapshots_no_delete BEFORE DELETE ON ai_masked_source_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: masked source snapshots are append-only');
CREATE TRIGGER ai_masked_source_snapshots_no_update BEFORE UPDATE ON ai_masked_source_snapshots FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: masked source snapshots are append-only');
CREATE TRIGGER ai_provider_activations_no_delete BEFORE DELETE ON ai_provider_activations FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: provider activations are append-only');
CREATE TRIGGER ai_provider_configs_no_delete BEFORE DELETE ON ai_provider_configs FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI provider configurations are append-only');
CREATE TRIGGER ai_provider_configs_no_update BEFORE UPDATE ON ai_provider_configs FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI provider configurations are append-only');
CREATE TRIGGER ai_review_events_no_delete BEFORE DELETE ON ai_review_events FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI review events are append-only');
CREATE TRIGGER ai_review_events_no_update BEFORE UPDATE ON ai_review_events FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI review events are append-only');
CREATE TRIGGER ai_text_work_queue_no_delete BEFORE DELETE ON ai_text_work_queue FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('text work items are append-only');
CREATE TRIGGER ai_text_work_queue_done_is_final BEFORE UPDATE ON ai_text_work_queue FOR EACH ROW WHEN (OLD.status='done') EXECUTE FUNCTION ccc_reject_write('completed text work items are immutable');
CREATE TRIGGER ai_work_items_no_delete BEFORE DELETE ON ai_work_items FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI work items are append-only');
CREATE TRIGGER ai_work_items_no_update BEFORE UPDATE ON ai_work_items FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: AI work items are append-only');
CREATE TRIGGER participant_consent_records_no_delete BEFORE DELETE ON participant_consent_records FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D23: participant consent records are append-only');
CREATE TRIGGER participant_consent_records_no_update BEFORE UPDATE ON participant_consent_records FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('D23: participant consent records are append-only');
CREATE TRIGGER participant_pii_retention_decisions_no_delete BEFORE DELETE ON participant_pii_retention_decisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER participant_pii_retention_decisions_no_update BEFORE UPDATE ON participant_pii_retention_decisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER pilot_text_ai_consent_evidence_no_delete BEFORE DELETE ON pilot_text_ai_consent_evidence FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: pilot text-AI consent evidence is append-only');
CREATE TRIGGER pilot_text_ai_consent_evidence_no_update BEFORE UPDATE ON pilot_text_ai_consent_evidence FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('phase1: pilot text-AI consent evidence is append-only');
CREATE TRIGGER recording_result_commits_no_delete BEFORE DELETE ON recording_result_commits FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('recording result commits are append-only');
CREATE TRIGGER case_assignees_legacy_delete_unsupported INSTEAD OF DELETE ON case_assignees FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER case_assignees_legacy_insert_unsupported INSTEAD OF INSERT ON case_assignees FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER case_assignees_legacy_update_unsupported INSTEAD OF UPDATE ON case_assignees FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER cases_legacy_delete_unsupported INSTEAD OF DELETE ON cases FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER cases_legacy_insert_unsupported INSTEAD OF INSERT ON cases FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER cases_legacy_update_unsupported INSTEAD OF UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('legacy_case_write_unsupported');
CREATE TRIGGER support_cases_immutable_identity_guard BEFORE UPDATE OF id,org_id,beneficiary_id,legacy_case_id,creation_kind,creation_submission_id,creation_payload_hash,created_by_actor_id,source_support_case_id,initial_assignee_user_id ON support_cases FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER beneficiaries_insert_pending_guard BEFORE INSERT ON beneficiaries FOR EACH ROW WHEN (NEW.initialization_state<>'pending') EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER goals_no_reopen BEFORE UPDATE OF status ON goals FOR EACH ROW WHEN (OLD.status='closed' AND NEW.status='active') EXECUTE FUNCTION ccc_reject_write('D62: a closed goal cannot be reopened');
CREATE TRIGGER invite_tokens_no_double_consume BEFORE UPDATE ON invite_tokens FOR EACH ROW WHEN (NEW.status='used' AND OLD.status<>'issued') EXECUTE FUNCTION ccc_reject_write('invite_token_already_used');
CREATE TRIGGER invite_tokens_no_revoked_consume BEFORE UPDATE ON invite_tokens FOR EACH ROW WHEN (NEW.status='used' AND OLD.revoked_at IS NOT NULL) EXECUTE FUNCTION ccc_reject_write('invite_token_revoked');
CREATE TRIGGER participant_pii_vault_no_revive_guard BEFORE UPDATE ON participant_pii_vault FOR EACH ROW WHEN (OLD.purged_at IS NOT NULL AND NEW.retention_change_kind<>'re_register_pii') EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER session_discrepancies_resolved_no_delete BEFORE DELETE ON session_discrepancies FOR EACH ROW WHEN (OLD.resolution_status IS NOT NULL) EXECUTE FUNCTION ccc_reject_write('session_discrepancies: resolved rows are retained history');
CREATE TRIGGER team_memberships_no_delete BEFORE DELETE ON team_memberships FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_team_memberships_are_append_only');
CREATE TRIGGER team_memberships_immutable_guard BEFORE UPDATE OF id,org_id,team_id,user_id,added_by,joined_at ON team_memberships FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_team_membership_immutable');
CREATE TRIGGER team_memberships_end_guard BEFORE UPDATE OF ended_at ON team_memberships FOR EACH ROW WHEN (OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL) EXECUTE FUNCTION ccc_reject_write('authorization_team_membership_immutable');
CREATE TRIGGER team_supervisor_grants_no_delete BEFORE DELETE ON team_supervisor_grants FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_supervisor_grants_are_append_only');
CREATE TRIGGER team_supervisor_grants_immutable_guard BEFORE UPDATE OF id,org_id,team_id,supervisor_user_id,granted_by,granted_at ON team_supervisor_grants FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_supervisor_grant_immutable');
CREATE TRIGGER team_supervisor_grants_revoke_guard BEFORE UPDATE OF revoked_at ON team_supervisor_grants FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) EXECUTE FUNCTION ccc_reject_write('authorization_supervisor_grant_immutable');
CREATE TRIGGER teams_no_delete BEFORE DELETE ON teams FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_teams_are_append_only');
CREATE TRIGGER teams_immutable_guard BEFORE UPDATE OF id,org_id,name,created_by,created_at ON teams FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_team_immutable');
CREATE TRIGGER teams_archive_guard BEFORE UPDATE OF archived_at ON teams FOR EACH ROW WHEN (OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL) EXECUTE FUNCTION ccc_reject_write('authorization_team_immutable');
CREATE TRIGGER user_role_assignments_no_delete BEFORE DELETE ON user_role_assignments FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_role_assignments_are_append_only');
CREATE TRIGGER user_role_assignments_immutable_guard BEFORE UPDATE OF id,org_id,user_id,role,source,granted_by,granted_at ON user_role_assignments FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('authorization_role_assignment_immutable');
CREATE TRIGGER agent_installations_revocation_guard BEFORE UPDATE OF revoked_at ON agent_installations FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) EXECUTE FUNCTION ccc_reject_write('agent_installation_revocation_immutable');

-- SQLite INTEGER PRIMARY KEY allocates max(rowid)+1, including explicit NULL inserts.
-- Serialize allocation (including explicit IDs) rather than a sequence that can lag imported IDs.
CREATE FUNCTION ccc_rowid_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(TG_RELID::bigint);
  IF NEW.id IS NULL THEN
    EXECUTE format('SELECT COALESCE(max(id),0)+1 FROM %I.%I',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ccc_audit_rowid BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ccc_rowid_insert();
CREATE TRIGGER ccc_goal_revision_rowid BEFORE INSERT ON goal_revisions FOR EACH ROW EXECUTE FUNCTION ccc_rowid_insert();

CREATE FUNCTION action_items_session_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_items_session_scope_guard BEFORE INSERT ON action_items FOR EACH ROW EXECUTE FUNCTION action_items_session_scope_guard_fn();
CREATE TRIGGER flags_session_scope_guard BEFORE INSERT ON flags FOR EACH ROW EXECUTE FUNCTION action_items_session_scope_guard_fn();
CREATE FUNCTION session_goal_scores_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions AS session JOIN goals AS goal ON goal.id=NEW.goal_id
    WHERE session.id=NEW.session_id AND session.org_id=NEW.org_id AND goal.org_id=NEW.org_id AND session.support_case_id=goal.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_goal_scores_scope_guard BEFORE INSERT ON session_goal_scores FOR EACH ROW EXECUTE FUNCTION session_goal_scores_scope_guard_fn();
CREATE TRIGGER ai_gas_evidence_scope_guard BEFORE INSERT ON ai_gas_evidence FOR EACH ROW EXECUTE FUNCTION session_goal_scores_scope_guard_fn();
CREATE FUNCTION agent_installations_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_user_id AND org_id=NEW.org_id AND active=1 AND role='service') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='agent_installation_identity_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_installations_insert_guard BEFORE INSERT ON agent_installations FOR EACH ROW EXECUTE FUNCTION agent_installations_insert_guard_fn();
CREATE FUNCTION ai_work_items_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: AI work item case or session scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_work_items_scope_guard BEFORE INSERT ON ai_work_items FOR EACH ROW EXECUTE FUNCTION ai_work_items_scope_guard_fn();
CREATE FUNCTION ai_masked_source_snapshots_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: masked source snapshot scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_masked_source_snapshots_scope_guard BEFORE INSERT ON ai_masked_source_snapshots FOR EACH ROW EXECUTE FUNCTION ai_masked_source_snapshots_scope_guard_fn();
CREATE FUNCTION ai_masked_source_evidence_items_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_masked_source_snapshots AS snapshot JOIN sessions
    ON sessions.id=snapshot.session_id AND sessions.org_id=snapshot.org_id AND sessions.support_case_id=snapshot.support_case_id
    WHERE snapshot.id=NEW.snapshot_id AND snapshot.org_id=NEW.org_id AND snapshot.support_case_id=NEW.support_case_id AND snapshot.session_id=NEW.session_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: masked source evidence scope mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_masked_source_snapshots WHERE id=NEW.snapshot_id AND sha256=NEW.source_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: masked source evidence hash mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_masked_source_snapshots WHERE id=NEW.snapshot_id AND NEW.source_end<=length(masked_text)
    AND substr(masked_text,(NEW.source_start+1)::integer,(NEW.source_end-NEW.source_start)::integer)=NEW.evidence_quote) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: masked source evidence span mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_masked_source_evidence_items_insert_guard BEFORE INSERT ON ai_masked_source_evidence_items FOR EACH ROW EXECUTE FUNCTION ai_masked_source_evidence_items_insert_guard_fn();
CREATE FUNCTION ai_provider_activations_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_provider_configs WHERE id=NEW.config_id AND org_id=NEW.org_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: provider configuration organization mismatch';
  END IF;
  IF NEW.previous_activation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_provider_activations
    WHERE id=NEW.previous_activation_id AND org_id=NEW.org_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: prior provider activation must be retired in the same organization';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_provider_activations_scope_guard BEFORE INSERT ON ai_provider_activations FOR EACH ROW EXECUTE FUNCTION ai_provider_activations_scope_guard_fn();
CREATE TRIGGER ai_provider_activations_only_deactivate BEFORE UPDATE ON ai_provider_activations FOR EACH ROW
WHEN (NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.config_id IS DISTINCT FROM OLD.config_id
  OR NEW.previous_activation_id IS DISTINCT FROM OLD.previous_activation_id OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
  OR NEW.activated_at IS DISTINCT FROM OLD.activated_at OR OLD.deactivated_at IS NOT NULL OR NEW.deactivated_at IS NULL)
EXECUTE FUNCTION ccc_reject_write('phase1: provider activation is immutable except retirement');
CREATE TRIGGER ai_draft_one_liner_format_guard BEFORE INSERT ON ai_draft_versions FOR EACH ROW
WHEN (NEW.one_liner IS NOT NULL AND (length(trim(NEW.one_liner))=0 OR position(chr(10) in NEW.one_liner)>0))
EXECUTE FUNCTION ccc_reject_write('ccc38: AI one-liner must be a non-empty single line');

CREATE FUNCTION ai_draft_source_materials_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft JOIN ai_work_items AS work ON work.id=draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot ON snapshot.id=NEW.snapshot_id AND snapshot.org_id=work.org_id
      AND snapshot.support_case_id=work.support_case_id AND snapshot.session_id=work.session_id AND snapshot.sha256=NEW.snapshot_sha256
    WHERE draft.id=NEW.draft_version_id AND work.org_id=NEW.org_id AND work.support_case_id=NEW.support_case_id AND work.session_id=NEW.session_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ccc102: draft source material scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_draft_source_materials_scope_guard BEFORE INSERT ON ai_draft_source_materials FOR EACH ROW EXECUTE FUNCTION ai_draft_source_materials_scope_guard_fn();
CREATE FUNCTION ai_draft_contrast_axes_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft JOIN ai_work_items AS work ON work.id=draft.work_item_id
    WHERE draft.id=NEW.draft_version_id AND work.org_id=NEW.org_id AND work.support_case_id=NEW.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ccc102: contrast axis scope mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM json_array_elements(NEW.findings_json::json) AS finding(value)
    WHERE json_typeof(value)<>'object' OR NOT (
      json_typeof(value->'description')='string' AND length(trim(value->>'description'))>0
      AND json_typeof(value->'materialKind')='string' AND value->>'materialKind' IN ('transcript','text_context')
      AND json_typeof(value->'sourceRef')='string' AND length(trim(value->>'sourceRef'))>0
      AND json_typeof(value->'quote')='string' AND length(trim(value->>'quote'))>0
      AND (SELECT count(*) FROM json_each(CASE WHEN json_typeof(value)='object' THEN value ELSE '{}'::json END))=4)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ccc102: contrast finding shape is invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM json_array_elements(NEW.findings_json::json) AS finding(value)
    WHERE NOT EXISTS (SELECT 1 FROM ai_draft_source_materials AS material
      WHERE material.draft_version_id=NEW.draft_version_id AND material.kind=value->>'materialKind' AND material.snapshot_id=value->>'sourceRef')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ccc102: contrast finding cites a material the draft did not use';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_draft_contrast_axes_insert_guard BEFORE INSERT ON ai_draft_contrast_axes FOR EACH ROW EXECUTE FUNCTION ai_draft_contrast_axes_insert_guard_fn();

CREATE FUNCTION ai_draft_versions_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version<>COALESCE((SELECT max(version)+1 FROM ai_draft_versions WHERE work_item_id=NEW.work_item_id),1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF (NEW.version=1 AND NEW.parent_version_id IS NOT NULL) OR (NEW.version>1 AND NOT EXISTS
    (SELECT 1 FROM ai_draft_versions WHERE id=NEW.parent_version_id AND work_item_id=NEW.work_item_id AND version=NEW.version-1)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: AI draft parent must be the prior version in the same work item';
  END IF;
  IF EXISTS (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value)
    WHERE CASE json_typeof(value)
      WHEN 'string' THEN length(trim(value#>>'{}'))=0
      WHEN 'object' THEN NOT (json_typeof(value->'title')='string' AND length(trim(value->>'title'))>0
        AND json_typeof(value->'reason')='string' AND length(trim(value->>'reason'))>0
        AND (SELECT count(*) FROM json_each(value))=2)
      ELSE true END)
    OR EXISTS (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value)
      GROUP BY CASE json_typeof(value) WHEN 'object' THEN value->>'title' ELSE value#>>'{}' END HAVING count(*)>1)
    OR (NEW.origin='fixture_generated' AND EXISTS
      (SELECT 1 FROM json_array_elements(NEW.questions_json::json) AS question(value) WHERE json_typeof(value)<>'object')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: AI draft questions are invalid';
  END IF;
  IF NEW.parent_version_id IS NOT NULL AND EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id=NEW.parent_version_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NOT EXISTS
    (SELECT 1 FROM ai_work_items AS work JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id=NEW.source_snapshot_id AND snapshot.org_id=work.org_id AND snapshot.support_case_id=work.support_case_id
      AND snapshot.session_id=work.session_id AND snapshot.sha256=NEW.source_snapshot_hash WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft source snapshot scope or hash mismatch';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NOT EXISTS
    (SELECT 1 FROM ai_work_items AS work JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id=NEW.consent_evidence_id AND evidence.org_id=work.org_id AND evidence.support_case_id=work.support_case_id
      WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft consent evidence scope mismatch';
  END IF;
  IF NEW.origin IN ('generated','fixture_generated') AND NEW.consent_evidence_id IS DISTINCT FROM
    (SELECT evidence.id FROM ai_work_items AS work JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.org_id=work.org_id AND evidence.support_case_id=work.support_case_id
      WHERE work.id=NEW.work_item_id AND evidence.effective_at<=ccc_iso_now()
      ORDER BY evidence.effective_at DESC,evidence.created_at DESC,evidence.id DESC NULLS LAST LIMIT 1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.origin='generated' AND NOT EXISTS (SELECT 1 FROM ai_work_items AS work JOIN ai_provider_configs AS config
    ON config.id=NEW.provider_config_id AND config.org_id=work.org_id WHERE work.id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated draft provider configuration scope mismatch';
  END IF;
  IF NEW.origin='generated' AND NEW.creation_mode='human_edited' AND NOT EXISTS (SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id=NEW.parent_version_id AND parent.work_item_id=NEW.work_item_id AND parent.origin='generated'
      AND parent.provider_config_id IS NOT DISTINCT FROM NEW.provider_config_id
      AND parent.source_snapshot_id IS NOT DISTINCT FROM NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NOT DISTINCT FROM NEW.source_snapshot_hash
      AND parent.questions_json IS NOT DISTINCT FROM NEW.questions_json AND parent.model_id IS NOT DISTINCT FROM NEW.model_id
      AND parent.prompt_version IS NOT DISTINCT FROM NEW.prompt_version AND parent.schema_version IS NOT DISTINCT FROM NEW.schema_version) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: human-edited draft must retain parent provenance';
  END IF;
  IF NEW.origin='generated' AND NEW.creation_mode='provider_generated' AND NOT EXISTS (SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id=NEW.provider_config_id AND config.org_id=work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id=config.id AND activation.org_id=work.org_id
    WHERE work.id=NEW.work_item_id AND activation.deactivated_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: provider-generated draft requires the active provider configuration';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_draft_versions_insert_guard BEFORE INSERT ON ai_draft_versions FOR EACH ROW EXECUTE FUNCTION ai_draft_versions_insert_guard_fn();

CREATE FUNCTION ai_evidence_links_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_draft_versions WHERE id=NEW.draft_version_id
    AND origin IN ('generated','fixture_generated') AND grounding_status='grounded') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: evidence links require a generated grounded draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft JOIN ai_work_items AS work ON work.id=draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot ON snapshot.org_id=work.org_id AND snapshot.support_case_id=work.support_case_id
      AND snapshot.session_id=work.session_id AND ((snapshot.id=draft.source_snapshot_id AND snapshot.sha256=draft.source_snapshot_hash)
        OR EXISTS (SELECT 1 FROM ai_draft_source_materials AS material WHERE material.draft_version_id=draft.id
          AND material.snapshot_id=snapshot.id AND material.snapshot_sha256=snapshot.sha256))
    JOIN ai_masked_source_evidence_items AS item ON item.id=NEW.source_evidence_item_id AND item.snapshot_id=snapshot.id
      AND item.source_sha256=snapshot.sha256 AND item.org_id=work.org_id AND item.support_case_id=work.support_case_id
      AND item.session_id=work.session_id AND item.source_ref=NEW.source_ref AND item.evidence_quote=NEW.evidence_quote
      AND item.source_start=NEW.source_start AND item.source_end=NEW.source_end WHERE draft.id=NEW.draft_version_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: evidence link must match its attested source item';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id=NEW.draft_version_id)
    OR EXISTS (SELECT 1 FROM ai_draft_versions AS newer JOIN ai_draft_versions AS draft ON draft.id=NEW.draft_version_id
      WHERE newer.work_item_id=draft.work_item_id AND newer.version>draft.version) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_evidence_links_insert_guard BEFORE INSERT ON ai_evidence_links FOR EACH ROW EXECUTE FUNCTION ai_evidence_links_insert_guard_fn();
CREATE FUNCTION ai_review_events_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_draft_versions WHERE id=NEW.draft_version_id AND work_item_id=NEW.work_item_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: review event draft and work item mismatch';
  END IF;
  IF NEW.decision IN ('approved','rejected') AND EXISTS (SELECT 1 FROM ai_draft_versions AS newer
    JOIN ai_draft_versions AS draft ON draft.id=NEW.draft_version_id WHERE newer.work_item_id=NEW.work_item_id AND newer.version>draft.version) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.decision='superseded' AND NOT EXISTS (SELECT 1 FROM ai_draft_versions AS draft
    JOIN ai_draft_versions AS replacement ON replacement.id=NEW.replacement_draft_id
    WHERE draft.id=NEW.draft_version_id AND replacement.work_item_id=draft.work_item_id AND replacement.version=draft.version+1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: supersession must name the next draft version in the same work item';
  END IF;
  IF NEW.decision='superseded' AND EXISTS (SELECT 1 FROM ai_draft_versions AS later
    JOIN ai_draft_versions AS replacement ON replacement.id=NEW.replacement_draft_id
    WHERE later.work_item_id=NEW.work_item_id AND later.version>replacement.version) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='stale_draft_version';
  END IF;
  IF NEW.decision='superseded' AND EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id=NEW.replacement_draft_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: replacement draft is already terminal';
  END IF;
  IF NEW.decision='approved' AND EXISTS (SELECT 1 FROM ai_draft_versions WHERE id=NEW.draft_version_id AND origin='fixture_generated') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: fixture draft approval is prohibited';
  END IF;
  IF NEW.decision='approved' AND EXISTS (SELECT 1 FROM ai_draft_versions WHERE id=NEW.draft_version_id AND origin='generated') THEN
    IF NEW.actor_id IS NULL OR length(trim(NEW.actor_id))=0 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated approval requires a human actor';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ai_evidence_links WHERE draft_version_id=NEW.draft_version_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated approval requires immutable evidence';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ai_evidence_links WHERE draft_version_id=NEW.draft_version_id AND claim_key !~ '^question_[0-9]') THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated approval requires grounded summary evidence';
    END IF;
    IF EXISTS (SELECT 1 FROM ai_draft_versions AS draft
      CROSS JOIN LATERAL json_array_elements(draft.questions_json::json) WITH ORDINALITY AS question(value,ordinal)
      WHERE draft.id=NEW.draft_version_id AND draft.origin='generated' AND NOT EXISTS
        (SELECT 1 FROM ai_evidence_links AS evidence WHERE evidence.draft_version_id=draft.id AND evidence.claim_key='question_'||question.ordinal)) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: generated approval requires grounded briefing questions';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_review_events_insert_guard BEFORE INSERT ON ai_review_events FOR EACH ROW EXECUTE FUNCTION ai_review_events_insert_guard_fn();

CREATE FUNCTION beneficiaries_complete_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.initialization_state<>NEW.initialization_state THEN
    IF OLD.initialization_state<>'pending' OR NEW.initialization_state<>'complete'
      OR (SELECT count(*) FROM support_cases WHERE beneficiary_id=NEW.id AND creation_kind='initial')<>1
      OR (SELECT count(*) FROM support_case_assignees AS assignment JOIN support_cases AS support_case ON support_case.id=assignment.support_case_id
        WHERE support_case.beneficiary_id=NEW.id AND support_case.creation_kind='initial' AND assignment.role='primary' AND assignment.unassigned_at IS NULL)<>1 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
    IF (SELECT count(*) FROM audit_log WHERE beneficiary_id=NEW.id AND (
      (action='create' AND target_table='beneficiaries' AND target_id=NEW.id AND support_case_id IS NULL)
      OR (action='create' AND target_table='support_cases' AND target_id=(SELECT id FROM support_cases WHERE beneficiary_id=NEW.id AND creation_kind='initial') AND support_case_id=target_id)
      OR (action='assign' AND target_table='support_case_assignees' AND target_id=(
        SELECT assignment.id FROM support_case_assignees AS assignment JOIN support_cases AS support_case ON support_case.id=assignment.support_case_id
        WHERE support_case.beneficiary_id=NEW.id AND support_case.creation_kind='initial' AND assignment.role='primary' AND assignment.unassigned_at IS NULL)
        AND support_case_id=(SELECT id FROM support_cases WHERE beneficiary_id=NEW.id AND creation_kind='initial'))))<>3
      OR (SELECT count(*) FROM audit_log WHERE beneficiary_id=NEW.id)<>3 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER beneficiaries_complete_guard BEFORE UPDATE OF initialization_state ON beneficiaries FOR EACH ROW EXECUTE FUNCTION beneficiaries_complete_guard_fn();
CREATE FUNCTION audit_log_participant_provenance_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.beneficiary_id IS NOT NULL OR NEW.support_case_id IS NOT NULL OR NEW.action IN ('purge_pii_noop','reveal_participant_pii') THEN
    IF NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM beneficiaries WHERE id=NEW.beneficiary_id AND org_id=NEW.org_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
    IF NEW.support_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
    IF NEW.action='purge_pii_noop' AND NOT (
      NEW.target_table='participant_pii_vault' AND NEW.target_id=NEW.beneficiary_id AND NEW.support_case_id IS NULL
      AND NEW.detail='{"reason":"not_eligible_or_already_purged"}'
      AND EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND org_id=NEW.org_id AND active=1 AND role='admin')
      AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id=NEW.beneficiary_id
        AND (purged_at IS NOT NULL OR purge_due IS NULL OR purge_due>ccc_legacy_now()
          OR EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND status='active')))) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
    IF NEW.action='reveal_participant_pii' AND NOT (
      NEW.target_table='participant_pii_vault' AND NEW.target_id=NEW.beneficiary_id
      AND NEW.detail='{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
      AND EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND org_id=NEW.org_id AND active=1 AND role=NEW.actor_role AND role IN ('admin','counselor'))
      AND (NEW.actor_role='admin' OR EXISTS (SELECT 1 FROM support_case_assignees WHERE support_case_id=NEW.support_case_id AND org_id=NEW.org_id AND user_id=NEW.actor_id AND unassigned_at IS NULL))
      AND EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id AND status='active')) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_log_participant_provenance_guard BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_participant_provenance_guard_fn();
CREATE FUNCTION counseling_schedules_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.created_by_actor_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER counseling_schedules_insert_guard BEFORE INSERT ON counseling_schedules FOR EACH ROW EXECUTE FUNCTION counseling_schedules_insert_guard_fn();
CREATE TRIGGER counseling_schedules_update_guard BEFORE UPDATE ON counseling_schedules FOR EACH ROW
WHEN (NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id
  OR NEW.support_case_id IS DISTINCT FROM OLD.support_case_id OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.version<>OLD.version+1)
EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE FUNCTION goal_revisions_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id)
    OR (NEW.goal_id IS NOT NULL AND (NEW.title IS NULL OR NOT EXISTS (SELECT 1 FROM goals
      WHERE id=NEW.goal_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id)))
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.edited_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER goal_revisions_insert_guard BEFORE INSERT ON goal_revisions FOR EACH ROW EXECUTE FUNCTION goal_revisions_insert_guard_fn();
CREATE FUNCTION participant_consent_records_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id)
    OR (NEW.recorded_by<>'self' AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.recorded_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')))
    OR (NEW.consent_recording_at IS NOT NULL AND NEW.consent_recording_at<>NEW.recorded_at)
    OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at<>NEW.recorded_at)
    OR (NEW.consent_privacy_at IS NOT NULL AND NEW.consent_privacy_at<>NEW.recorded_at) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF (NEW.consent_privacy_at IS NOT NULL AND (NEW.privacy_notice_version IS NULL OR length(NEW.privacy_notice_version)<3
    OR NEW.privacy_notice_sha256 IS NULL OR length(NEW.privacy_notice_sha256)<>64 OR NEW.privacy_notice_sha256 ~ '[^0-9a-f]'
    OR NEW.privacy_evidence_ref IS NULL OR NEW.privacy_evidence_ref !~ '^offline://'))
    OR (NEW.consent_privacy_at IS NULL AND (NEW.privacy_notice_version IS NOT NULL OR NEW.privacy_notice_sha256 IS NOT NULL OR NEW.privacy_evidence_ref IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_consent_records_insert_guard BEFORE INSERT ON participant_consent_records FOR EACH ROW EXECUTE FUNCTION participant_consent_records_insert_guard_fn();
CREATE FUNCTION schedule_custom_questions_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.created_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_custom_questions_insert_guard BEFORE INSERT ON schedule_custom_questions FOR EACH ROW EXECUTE FUNCTION schedule_custom_questions_insert_guard_fn();
CREATE FUNCTION schedule_session_goals_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM counseling_schedules WHERE id=NEW.schedule_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.created_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
    OR (NEW.case_goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM goals
      WHERE id=NEW.case_goal_id AND org_id=NEW.org_id AND support_case_id=NEW.support_case_id AND status='active')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_session_goals_insert_guard BEFORE INSERT ON schedule_session_goals FOR EACH ROW EXECUTE FUNCTION schedule_session_goals_insert_guard_fn();
CREATE TRIGGER session_discrepancies_content_immutable BEFORE UPDATE ON session_discrepancies FOR EACH ROW
WHEN (OLD.id<>NEW.id OR OLD.org_id<>NEW.org_id OR OLD.support_case_id<>NEW.support_case_id OR OLD.kind<>NEW.kind
  OR OLD.trigger_session_id<>NEW.trigger_session_id OR OLD.left_session_id<>NEW.left_session_id OR OLD.left_quote<>NEW.left_quote
  OR OLD.right_session_id<>NEW.right_session_id OR OLD.right_quote<>NEW.right_quote OR OLD.detected_at<>NEW.detected_at OR OLD.created_at<>NEW.created_at)
EXECUTE FUNCTION ccc_reject_write('session_discrepancies: detected content is immutable');
CREATE TRIGGER sessions_approved_ai_compatibility_immutable BEFORE UPDATE OF ai_status,ai_summary,approved_at,approved_by ON sessions FOR EACH ROW
WHEN (OLD.approved_at IS NOT NULL AND (NEW.ai_status IS DISTINCT FROM OLD.ai_status OR NEW.ai_summary IS DISTINCT FROM OLD.ai_summary
  OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by))
EXECUTE FUNCTION ccc_reject_write('phase1: approved session AI compatibility fields are immutable');
CREATE TRIGGER sessions_direct_ai_approval_insert_guard BEFORE INSERT ON sessions FOR EACH ROW
WHEN (NEW.ai_status='approved' OR NEW.ai_summary IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL)
EXECUTE FUNCTION ccc_reject_write('phase1: direct session AI approval is prohibited');
CREATE FUNCTION sessions_direct_ai_approval_update_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.ai_status='approved' OR NEW.ai_summary IS DISTINCT FROM OLD.ai_summary OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by)
    AND NOT (NEW.ai_status='approved' AND NEW.approved_at IS NOT NULL AND EXISTS (SELECT 1 FROM approved_ai_briefing_v1 AS briefing
      WHERE briefing.session_id=NEW.id AND briefing.summary_text IS NOT DISTINCT FROM NEW.ai_summary
        AND briefing.approved_by IS NOT DISTINCT FROM NEW.approved_by AND briefing.approved_at IS NOT DISTINCT FROM NEW.approved_at)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase1: session AI approval requires an immutable approved review';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_direct_ai_approval_update_guard BEFORE UPDATE OF ai_status,ai_summary,approved_at,approved_by ON sessions FOR EACH ROW EXECUTE FUNCTION sessions_direct_ai_approval_update_guard_fn();
CREATE FUNCTION sessions_manual_submission_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.submission_id IS NULL OR NEW.submission_hash IS NULL OR NEW.submitted_by IS NULL OR NEW.counselor_id<>NEW.submitted_by
    OR NOT EXISTS (SELECT 1 FROM support_cases AS support_case JOIN beneficiaries AS beneficiary ON beneficiary.id=support_case.beneficiary_id
      WHERE support_case.id=NEW.support_case_id AND support_case.org_id=NEW.org_id AND support_case.status='active' AND beneficiary.initialization_state='complete')
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.submitted_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
    OR (NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.submitted_by AND role='admin') AND NOT EXISTS
      (SELECT 1 FROM support_case_assignees WHERE support_case_id=NEW.support_case_id AND user_id=NEW.submitted_by AND unassigned_at IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_manual_submission_guard BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION sessions_manual_submission_guard_fn();
CREATE FUNCTION sessions_manual_submission_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  SELECT session.org_id,session.submitted_by,users.role,'submit_manual_record','sessions',session.id,
    support_case.beneficiary_id,session.support_case_id,NULL,ccc_legacy_now()
  FROM sessions AS session JOIN support_cases AS support_case ON support_case.id=session.support_case_id
  JOIN users ON users.id=session.submitted_by WHERE session.id=NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER sessions_manual_submission_audit AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION sessions_manual_submission_audit_fn();
CREATE TRIGGER recording_result_commits_immutable BEFORE UPDATE ON recording_result_commits FOR EACH ROW
WHEN (NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
  OR NEW.support_case_id IS DISTINCT FROM OLD.support_case_id OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
  OR NEW.result_sha256 IS DISTINCT FROM OLD.result_sha256 OR NEW.emotion_scores IS DISTINCT FROM OLD.emotion_scores
  OR NEW.transcript_quality IS DISTINCT FROM OLD.transcript_quality OR NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.finalized_at IS NOT NULL
    AND (NEW.finalized_at IS DISTINCT FROM OLD.finalized_at OR NEW.downstream_claimed_at IS DISTINCT FROM OLD.downstream_claimed_at)))
EXECUTE FUNCTION ccc_reject_write('recording result commits are immutable except finalization');
CREATE FUNCTION recording_result_commits_scope_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions AS session JOIN ai_masked_source_snapshots AS snapshot
    ON snapshot.id=NEW.snapshot_id AND snapshot.session_id=session.id AND snapshot.org_id=session.org_id AND snapshot.support_case_id=session.support_case_id
    WHERE session.id=NEW.session_id AND session.org_id=NEW.org_id AND session.support_case_id=NEW.support_case_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='recording result scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recording_result_commits_scope_guard BEFORE INSERT ON recording_result_commits FOR EACH ROW EXECUTE FUNCTION recording_result_commits_scope_guard_fn();

CREATE FUNCTION support_case_assignees_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND org_id=NEW.org_id)
    OR NOT EXISTS (SELECT 1 FROM users JOIN user_role_assignments AS practitioner_role
      ON practitioner_role.user_id=users.id AND practitioner_role.org_id=users.org_id
        AND practitioner_role.role='practitioner' AND practitioner_role.revoked_at IS NULL
      WHERE users.id=NEW.user_id AND users.org_id=NEW.org_id AND users.active=1 AND users.role IN ('admin','counselor')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.support_case_id AND creation_kind='subsequent')
    AND NOT EXISTS (SELECT 1 FROM support_case_assignees WHERE support_case_id=NEW.support_case_id AND unassigned_at IS NULL)
    AND (NEW.role<>'primary' OR NEW.user_id<>(SELECT initial_assignee_user_id FROM support_cases WHERE id=NEW.support_case_id)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_case_assignees_insert_guard BEFORE INSERT ON support_case_assignees FOR EACH ROW EXECUTE FUNCTION support_case_assignees_insert_guard_fn();
CREATE TRIGGER support_case_assignees_unassign_guard BEFORE UPDATE OF id,org_id,support_case_id,user_id,role,assigned_at,unassigned_at ON support_case_assignees FOR EACH ROW
WHEN (NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.support_case_id IS DISTINCT FROM OLD.support_case_id
  OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL OR NEW.unassigned_at IS NULL) EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER support_case_assignees_lifecycle_update_guard
BEFORE UPDATE OF status,acceptance_requested_by,accepted_at,transfer_reason,notified_by,notified_at ON support_case_assignees FOR EACH ROW
WHEN (NEW.acceptance_requested_by IS DISTINCT FROM OLD.acceptance_requested_by OR NEW.notified_by IS DISTINCT FROM OLD.notified_by
  OR NEW.notified_at IS DISTINCT FROM OLD.notified_at
  OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='requested' AND NEW.status='active' AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL AND NEW.unassigned_at IS NULL)
    OR (OLD.status IN ('requested','active') AND NEW.status='ended' AND OLD.unassigned_at IS NULL AND NEW.unassigned_at IS NOT NULL)))
  OR (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at AND NOT (
    OLD.status='requested' AND NEW.status='active' AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL))
  OR (NEW.transfer_reason IS DISTINCT FROM OLD.transfer_reason AND NOT (
    OLD.status IN ('requested','active') AND NEW.status='ended' AND OLD.unassigned_at IS NULL AND NEW.unassigned_at IS NOT NULL
    AND OLD.transfer_reason IS NULL AND NEW.transfer_reason IS NOT NULL)))
EXECUTE FUNCTION ccc_reject_write('assignment_lifecycle_immutable');
CREATE FUNCTION support_cases_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.creation_kind='legacy_import'
    OR NOT EXISTS (SELECT 1 FROM beneficiaries WHERE id=NEW.beneficiary_id AND org_id=NEW.org_id)
    OR (NEW.creation_kind='initial' AND NOT EXISTS (SELECT 1 FROM beneficiaries WHERE id=NEW.beneficiary_id AND initialization_state='pending'))
    OR (NEW.creation_kind='subsequent' AND NOT EXISTS (SELECT 1 FROM beneficiaries WHERE id=NEW.beneficiary_id AND initialization_state='complete'))
    OR NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id=NEW.org_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.creation_kind='subsequent' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.created_by_actor_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.initial_assignee_user_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
      OR ((SELECT role FROM users WHERE id=NEW.created_by_actor_id)='counselor' AND (NEW.source_support_case_id IS NULL OR NEW.initial_assignee_user_id<>NEW.created_by_actor_id))
      OR ((SELECT role FROM users WHERE id=NEW.created_by_actor_id)='admin' AND NEW.source_support_case_id IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
    IF (SELECT role FROM users WHERE id=NEW.created_by_actor_id)='counselor' AND NOT EXISTS (
      SELECT 1 FROM support_cases AS source_case JOIN support_case_assignees AS assignment
        ON assignment.support_case_id=source_case.id AND assignment.org_id=source_case.org_id
      WHERE source_case.id=NEW.source_support_case_id AND source_case.org_id=NEW.org_id AND source_case.beneficiary_id=NEW.beneficiary_id
        AND source_case.status='active' AND assignment.user_id=NEW.created_by_actor_id AND assignment.unassigned_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  IF (NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.source_support_case_id
      AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id AND status='active'))
    OR (NEW.creation_kind IN ('initial','subsequent') AND NEW.status<>'active') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_insert_guard BEFORE INSERT ON support_cases FOR EACH ROW EXECUTE FUNCTION support_cases_insert_guard_fn();
CREATE FUNCTION support_cases_close_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    OR NEW.closed_reason IS DISTINCT FROM OLD.closed_reason OR NEW.closed_by_actor_id IS DISTINCT FROM OLD.closed_by_actor_id THEN
    IF OLD.status<>'active' OR NEW.status<>'closed' OR NEW.closed_at IS NULL OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.closed_by_actor_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_close_guard BEFORE UPDATE OF status,closed_at,closed_reason,closed_by_actor_id ON support_cases FOR EACH ROW EXECUTE FUNCTION support_cases_close_guard_fn();
CREATE TRIGGER support_cases_emergency_registration_immutable_guard BEFORE UPDATE OF emergency_registration_at,emergency_registration_reason,consent_privacy_due_at ON support_cases FOR EACH ROW
WHEN (NEW.emergency_registration_at IS DISTINCT FROM OLD.emergency_registration_at
  OR NEW.emergency_registration_reason IS DISTINCT FROM OLD.emergency_registration_reason OR NEW.consent_privacy_due_at IS DISTINCT FROM OLD.consent_privacy_due_at)
EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');
CREATE TRIGGER support_cases_emergency_registration_insert_guard BEFORE INSERT ON support_cases FOR EACH ROW
WHEN ((NEW.emergency_registration_at IS NULL)<>(NEW.consent_privacy_due_at IS NULL)
  OR (NEW.emergency_registration_at IS NULL)<>(NEW.emergency_registration_reason IS NULL)
  OR (NEW.emergency_registration_at IS NOT NULL AND (trim(NEW.emergency_registration_reason)='' OR NEW.consent_privacy_at IS NOT NULL)))
EXECUTE FUNCTION ccc_reject_write('participant_schema_violation');

CREATE FUNCTION teams_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_role_assignments AS creator_role JOIN users AS creator ON creator.id=creator_role.user_id
    WHERE creator_role.org_id=NEW.org_id AND creator_role.user_id=NEW.created_by AND creator_role.role='institution_admin'
      AND creator_role.revoked_at IS NULL AND creator.org_id=NEW.org_id AND creator.active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_scope_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER teams_insert_guard BEFORE INSERT ON teams FOR EACH ROW EXECUTE FUNCTION teams_insert_guard_fn();
CREATE FUNCTION team_memberships_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id=NEW.team_id AND org_id=NEW.org_id AND archived_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM user_role_assignments AS member_role JOIN users AS member ON member.id=member_role.user_id
      WHERE member_role.org_id=NEW.org_id AND member_role.user_id=NEW.user_id AND member_role.role='practitioner'
        AND member_role.revoked_at IS NULL AND member.org_id=NEW.org_id AND member.active=1)
    OR NOT EXISTS (SELECT 1 FROM user_role_assignments AS grantor_role JOIN users AS grantor ON grantor.id=grantor_role.user_id
      WHERE grantor_role.org_id=NEW.org_id AND grantor_role.user_id=NEW.added_by AND grantor_role.role='institution_admin'
        AND grantor_role.revoked_at IS NULL AND grantor.org_id=NEW.org_id AND grantor.active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_scope_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_memberships_insert_guard BEFORE INSERT ON team_memberships FOR EACH ROW EXECUTE FUNCTION team_memberships_insert_guard_fn();
CREATE FUNCTION team_supervisor_grants_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id=NEW.team_id AND org_id=NEW.org_id AND archived_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.supervisor_user_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
    OR NOT EXISTS (SELECT 1 FROM user_role_assignments AS grantor_role JOIN users AS grantor ON grantor.id=grantor_role.user_id
      WHERE grantor_role.org_id=NEW.org_id AND grantor_role.user_id=NEW.granted_by AND grantor_role.role='institution_admin'
        AND grantor_role.revoked_at IS NULL AND grantor.org_id=NEW.org_id AND grantor.active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_scope_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_supervisor_grants_insert_guard BEFORE INSERT ON team_supervisor_grants FOR EACH ROW EXECUTE FUNCTION team_supervisor_grants_insert_guard_fn();
CREATE FUNCTION user_role_assignments_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND org_id=NEW.org_id AND role IN ('admin','counselor'))
    OR (NEW.source='manual' AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor')))
    OR (NEW.source='manual' AND NOT EXISTS (SELECT 1 FROM user_role_assignments AS grantor_role JOIN users AS grantor ON grantor.id=grantor_role.user_id
      WHERE grantor_role.org_id=NEW.org_id AND grantor_role.user_id=NEW.granted_by AND grantor_role.role='institution_admin'
        AND grantor_role.revoked_at IS NULL AND grantor.org_id=NEW.org_id AND grantor.active=1)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_scope_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_role_assignments_insert_guard BEFORE INSERT ON user_role_assignments FOR EACH ROW EXECUTE FUNCTION user_role_assignments_insert_guard_fn();
CREATE FUNCTION user_role_assignments_revoke_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_role_assignment_immutable';
  END IF;
  IF OLD.role IN ('institution_admin','institution_technical_admin') AND NOT EXISTS (
    SELECT 1 FROM user_role_assignments AS replacement JOIN users AS replacement_user ON replacement_user.id=replacement.user_id
    WHERE replacement.org_id=OLD.org_id AND replacement.role=OLD.role AND replacement.id<>OLD.id
      AND replacement.revoked_at IS NULL AND replacement_user.org_id=OLD.org_id AND replacement_user.active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='last_required_institution_role';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_role_assignments_revoke_guard BEFORE UPDATE OF revoked_at ON user_role_assignments FOR EACH ROW EXECUTE FUNCTION user_role_assignments_revoke_guard_fn();
CREATE FUNCTION users_last_required_roles_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active=1 AND NEW.active=0 AND EXISTS (
    SELECT 1 FROM user_role_assignments AS held_role WHERE held_role.org_id=OLD.org_id AND held_role.user_id=OLD.id
      AND held_role.role IN ('institution_admin','institution_technical_admin') AND held_role.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_role_assignments AS replacement JOIN users AS replacement_user ON replacement_user.id=replacement.user_id
        WHERE replacement.org_id=OLD.org_id AND replacement.role=held_role.role AND replacement.user_id<>OLD.id
          AND replacement.revoked_at IS NULL AND replacement_user.org_id=OLD.org_id AND replacement_user.active=1)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='last_required_institution_role';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_last_required_roles_guard BEFORE UPDATE OF active ON users FOR EACH ROW EXECUTE FUNCTION users_last_required_roles_guard_fn();
CREATE FUNCTION users_seed_independent_roles_after_insert_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_role_assignments(id,org_id,user_id,role,source,granted_by,granted_at)
  SELECT replace(gen_random_uuid()::text,'-',''),NEW.org_id,NEW.id,role,'legacy',NULL,NEW.created_at
  FROM (VALUES ('institution_admin'),('institution_technical_admin'),('practitioner')) AS roles(role)
  WHERE (NEW.role='admin' AND role IN ('institution_admin','institution_technical_admin')) OR (NEW.role='counselor' AND role='practitioner');
  RETURN NULL;
END;
$$;
CREATE TRIGGER users_seed_independent_roles_after_insert AFTER INSERT ON users FOR EACH ROW WHEN (NEW.role IN ('admin','counselor')) EXECUTE FUNCTION users_seed_independent_roles_after_insert_fn();
CREATE FUNCTION users_sync_independent_roles_after_role_update_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE user_role_assignments SET revoked_at=ccc_legacy_now()
  WHERE org_id=NEW.org_id AND user_id=NEW.id AND source='legacy' AND revoked_at IS NULL;
  INSERT INTO user_role_assignments(id,org_id,user_id,role,source,granted_by,granted_at)
  SELECT replace(gen_random_uuid()::text,'-',''),NEW.org_id,NEW.id,role,'legacy',NULL,ccc_legacy_now()
  FROM (VALUES ('institution_admin'),('institution_technical_admin'),('practitioner')) AS roles(role)
  WHERE (NEW.role='admin' AND role IN ('institution_admin','institution_technical_admin')) OR (NEW.role='counselor' AND role='practitioner');
  RETURN NULL;
END;
$$;
CREATE TRIGGER users_sync_independent_roles_after_role_update AFTER UPDATE OF role ON users FOR EACH ROW
WHEN (NEW.role IS DISTINCT FROM OLD.role) EXECUTE FUNCTION users_sync_independent_roles_after_role_update_fn();

-- PostgreSQL clamps February 29 + five years to February 28; that is exactly the
-- source's SQLite overflow-to-March-1 then -one-day branch. Do not subtract again.
CREATE FUNCTION ccc_retention_cap(closed_at text) RETURNS timestamp LANGUAGE sql STABLE STRICT AS $$
  SELECT date_trunc('second',ccc_timestamp(closed_at)+interval '5 years')
$$;
CREATE FUNCTION ccc_nullable_least(a timestamp,b timestamp) RETURNS timestamp LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT LEAST(a,b)
$$;
CREATE FUNCTION ccc_retention_due(closed_at text,grace_days bigint) RETURNS text LANGUAGE sql STABLE STRICT AS $$
  SELECT to_char(ccc_nullable_least(ccc_timestamp(closed_at)+grace_days*interval '1 day',ccc_retention_cap(closed_at)),'YYYY-MM-DD HH24:MI:SS')
$$;
CREATE FUNCTION participant_pii_vault_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM beneficiaries WHERE id=NEW.beneficiary_id AND org_id=NEW.org_id) OR NEW.retention_change_kind<>'create' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_vault_insert_guard BEFORE INSERT ON participant_pii_vault FOR EACH ROW EXECUTE FUNCTION participant_pii_vault_insert_guard_fn();
CREATE FUNCTION participant_pii_vault_retention_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.purge_due IS NULL AND NEW.purge_due IS NOT NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind='schedule_pii_purge_due' AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL AND NEW.retention_changed_at IS NOT NULL AND NEW.version=OLD.version+1)
    AND NOT (OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
      AND NEW.retention_change_kind='cancel_pii_purge_due' AND NEW.retention_changed_by IS NOT NULL
      AND NEW.retention_context_support_case_id IS NOT NULL AND NEW.retention_changed_at IS NOT NULL AND NEW.version=OLD.version+1)
    AND NOT (OLD.purged_at IS NULL AND OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL
      AND NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
      AND NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL AND NEW.purged_by_role IN ('admin','service')
      AND NEW.retention_change_kind='purge_pii' AND NEW.retention_changed_by=NEW.purged_by
      AND NEW.retention_changed_at=NEW.purged_at AND NEW.version=OLD.version+1)
    AND NOT (OLD.purged_at IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL AND NEW.purged_by IS NULL AND NEW.purged_by_role IS NULL
      AND NEW.enc_name IS NOT NULL AND NEW.enc_phone IS NOT NULL AND NEW.enc_account IS NOT NULL AND NEW.key_version>=OLD.key_version
      AND NEW.retention_change_kind='re_register_pii' AND NEW.retention_changed_by IS NOT NULL
      AND NEW.retention_context_support_case_id IS NOT NULL AND NEW.retention_changed_at IS NOT NULL AND NEW.version=OLD.version+1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.retention_change_kind IN ('schedule_pii_purge_due','cancel_pii_purge_due') THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.retention_changed_by AND org_id=NEW.org_id AND active=1 AND role IN ('admin','counselor'))
      OR NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.retention_context_support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  IF NEW.retention_change_kind='re_register_pii' AND (
    NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.retention_changed_by AND org_id=NEW.org_id AND active=1 AND role='admin')
    OR NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.retention_context_support_case_id AND org_id=NEW.org_id AND beneficiary_id=NEW.beneficiary_id AND status='active')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.retention_change_kind='schedule_pii_purge_due' AND (
    EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND status='active')
    OR NEW.purge_due IS DISTINCT FROM ccc_retention_due(
      (SELECT closed_at FROM support_cases WHERE id=NEW.retention_context_support_case_id),
      (SELECT pii_purge_grace_days FROM organization_settings WHERE org_id=NEW.org_id))) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.retention_change_kind='cancel_pii_purge_due' AND NOT EXISTS (SELECT 1 FROM support_cases WHERE id=NEW.retention_context_support_case_id AND status='active') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.retention_change_kind='purge_pii' THEN
    IF NOT (NEW.purged_by_role='admin' AND EXISTS (
      SELECT 1 FROM user_role_assignments AS role_assignment JOIN users ON users.id=role_assignment.user_id
      WHERE role_assignment.user_id=NEW.purged_by AND role_assignment.org_id=NEW.org_id AND role_assignment.role='institution_admin'
        AND role_assignment.revoked_at IS NULL AND users.org_id=NEW.org_id AND users.active=1))
      OR EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND status<>'closed')
      OR ccc_nullable_least(ccc_timestamp(OLD.purge_due),COALESCE(
        (SELECT ccc_timestamp(retention_cap_due_at) FROM participant_pii_archives WHERE beneficiary_id=OLD.beneficiary_id AND org_id=OLD.org_id),
        ccc_timestamp(OLD.purge_due)))>ccc_timestamp('now') THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_vault_retention_guard BEFORE UPDATE OF purge_due,purged_at,purged_by,purged_by_role,
  retention_changed_by,retention_context_support_case_id,retention_change_kind,retention_changed_at ON participant_pii_vault
FOR EACH ROW EXECUTE FUNCTION participant_pii_vault_retention_guard_fn();
CREATE FUNCTION participant_pii_vault_reviewed_purge_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM participant_pii_archives
    WHERE beneficiary_id=OLD.beneficiary_id AND org_id=OLD.org_id AND review_status='approved' AND approved_by=NEW.purged_by) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_vault_reviewed_purge_guard BEFORE UPDATE OF purged_at ON participant_pii_vault FOR EACH ROW EXECUTE FUNCTION participant_pii_vault_reviewed_purge_guard_fn();
CREATE FUNCTION participant_pii_vault_archived_write_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM participant_pii_archives WHERE beneficiary_id=OLD.beneficiary_id AND org_id=OLD.org_id AND review_status<>'purged') THEN
    IF NEW.version<>OLD.version+1 OR NOT (
      (NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL AND NEW.enc_email IS NULL
        AND NEW.enc_birth_date IS NULL AND NEW.enc_region IS NULL AND NEW.enc_emergency_contact IS NULL AND NEW.enc_gender IS NULL)
      OR (NEW.retention_change_kind='cancel_pii_purge_due' AND EXISTS (SELECT 1 FROM participant_pii_archives AS archive
        WHERE archive.beneficiary_id=OLD.beneficiary_id AND archive.org_id=OLD.org_id AND archive.review_status<>'purged'
          AND NEW.enc_name IS NOT DISTINCT FROM archive.enc_name AND NEW.enc_phone IS NOT DISTINCT FROM archive.enc_phone
          AND NEW.enc_account IS NOT DISTINCT FROM archive.enc_account AND NEW.enc_email IS NOT DISTINCT FROM archive.enc_email
          AND NEW.enc_birth_date IS NOT DISTINCT FROM archive.enc_birth_date AND NEW.enc_region IS NOT DISTINCT FROM archive.enc_region
          AND NEW.enc_emergency_contact IS NOT DISTINCT FROM archive.enc_emergency_contact AND NEW.enc_gender IS NOT DISTINCT FROM archive.enc_gender))) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_vault_archived_write_guard BEFORE UPDATE OF enc_name,enc_phone,enc_account,enc_email,enc_birth_date,enc_region,enc_emergency_contact,enc_gender
ON participant_pii_vault FOR EACH ROW EXECUTE FUNCTION participant_pii_vault_archived_write_guard_fn();
CREATE FUNCTION participant_pii_vault_schedule_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  SELECT NEW.org_id,NEW.retention_changed_by,users.role,'schedule_pii_purge_due','participant_pii_vault',NEW.beneficiary_id,
    NEW.beneficiary_id,NEW.retention_context_support_case_id,'{"reason":"all_support_cases_closed"}',ccc_legacy_now()
  FROM users WHERE users.id=NEW.retention_changed_by;
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_vault_schedule_audit AFTER UPDATE ON participant_pii_vault FOR EACH ROW
WHEN (NEW.retention_change_kind='schedule_pii_purge_due' AND OLD.retention_change_kind IS DISTINCT FROM NEW.retention_change_kind)
EXECUTE FUNCTION participant_pii_vault_schedule_audit_fn();
CREATE FUNCTION participant_pii_vault_cancel_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  SELECT NEW.org_id,NEW.retention_changed_by,users.role,'cancel_pii_purge_due','participant_pii_vault',NEW.beneficiary_id,
    NEW.beneficiary_id,NEW.retention_context_support_case_id,'{"reason":"support_case_created"}',ccc_legacy_now()
  FROM users WHERE users.id=NEW.retention_changed_by;
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_vault_cancel_audit AFTER UPDATE ON participant_pii_vault FOR EACH ROW
WHEN (NEW.retention_change_kind='cancel_pii_purge_due' AND OLD.retention_change_kind IS DISTINCT FROM NEW.retention_change_kind)
EXECUTE FUNCTION participant_pii_vault_cancel_audit_fn();
CREATE FUNCTION participant_pii_vault_purge_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  VALUES(NEW.org_id,NEW.purged_by,NEW.purged_by_role,'purge_pii','participant_pii_vault',NEW.beneficiary_id,NEW.beneficiary_id,NULL,NULL,ccc_legacy_now());
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_vault_purge_audit AFTER UPDATE ON participant_pii_vault FOR EACH ROW
WHEN (NEW.retention_change_kind='purge_pii' AND OLD.retention_change_kind IS DISTINCT FROM NEW.retention_change_kind)
EXECUTE FUNCTION participant_pii_vault_purge_audit_fn();
CREATE FUNCTION participant_pii_archive_re_register_cleanup_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status='purged';
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_archive_re_register_cleanup AFTER UPDATE ON participant_pii_vault FOR EACH ROW
WHEN (NEW.retention_change_kind='re_register_pii') EXECUTE FUNCTION participant_pii_archive_re_register_cleanup_fn();
CREATE FUNCTION participant_pii_archives_delete_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.review_status='purged' AND NOT EXISTS (SELECT 1 FROM participant_pii_vault
    WHERE beneficiary_id=OLD.beneficiary_id AND org_id=OLD.org_id AND retention_change_kind='re_register_pii'))
    OR (OLD.review_status<>'purged' AND NOT EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=OLD.beneficiary_id AND org_id=OLD.org_id AND status='active')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER participant_pii_archives_delete_guard BEFORE DELETE ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION participant_pii_archives_delete_guard_fn();
CREATE FUNCTION participant_pii_archives_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF length(trim(NEW.id))=0 OR NEW.review_status<>'pending' OR NEW.archived_by<>'system:retention'
    OR NEW.state_changed_by<>'system:retention' OR NEW.state_changed_by_role<>'service'
    OR NEW.review_due_at IS DISTINCT FROM NEW.archived_at OR ccc_timestamp(NEW.archived_at)>ccc_timestamp('now') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM participant_pii_vault AS vault WHERE vault.beneficiary_id=NEW.beneficiary_id AND vault.org_id=NEW.org_id
    AND vault.purged_at IS NULL AND vault.purge_due IS NOT NULL
    AND ccc_nullable_least(ccc_timestamp(vault.purge_due),COALESCE(
      (SELECT ccc_retention_cap(context_case.closed_at) FROM support_cases AS context_case
        WHERE context_case.beneficiary_id=vault.beneficiary_id AND context_case.org_id=vault.org_id
          AND context_case.status='closed' AND context_case.closed_at IS NOT NULL
        ORDER BY ccc_timestamp(context_case.closed_at) DESC NULLS LAST,context_case.id DESC NULLS LAST LIMIT 1),
      ccc_timestamp(vault.purge_due)))<=ccc_timestamp('now')
    AND vault.key_version=NEW.key_version
    AND vault.enc_name IS NOT DISTINCT FROM NEW.enc_name AND vault.enc_phone IS NOT DISTINCT FROM NEW.enc_phone
    AND vault.enc_account IS NOT DISTINCT FROM NEW.enc_account AND vault.enc_email IS NOT DISTINCT FROM NEW.enc_email
    AND vault.enc_birth_date IS NOT DISTINCT FROM NEW.enc_birth_date AND vault.enc_region IS NOT DISTINCT FROM NEW.enc_region
    AND vault.enc_emergency_contact IS NOT DISTINCT FROM NEW.enc_emergency_contact AND vault.enc_gender IS NOT DISTINCT FROM NEW.enc_gender)
    OR EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND status='active') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_archives_insert_guard BEFORE INSERT ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION participant_pii_archives_insert_guard_fn();
CREATE FUNCTION participant_pii_archives_insert_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  VALUES(NEW.org_id,NEW.archived_by,'service','archive_pii','participant_pii_archives',NEW.beneficiary_id,NEW.beneficiary_id,NULL,'{"reviewStatus":"pending"}',ccc_legacy_now());
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_archives_insert_audit AFTER INSERT ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION participant_pii_archives_insert_audit_fn();
CREATE FUNCTION participant_pii_retention_decisions_insert_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM participant_pii_archives WHERE id=NEW.archive_id AND beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status='pending') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_role_assignments AS role_assignment JOIN users ON users.id=role_assignment.user_id
    WHERE role_assignment.user_id=NEW.decided_by AND role_assignment.org_id=NEW.org_id AND role_assignment.role='institution_admin'
      AND role_assignment.revoked_at IS NULL AND users.org_id=NEW.org_id AND users.active=1) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='authorization_scope_violation';
  END IF;
  IF NEW.decision='retain' AND (ccc_timestamp(NEW.retain_until)<=ccc_timestamp(NEW.decided_at)
    OR (NEW.reason_kind<>'legal_requirement' AND ccc_timestamp(NEW.retain_until)>
      (SELECT ccc_timestamp(retention_cap_due_at) FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id))) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_retention_decisions_insert_guard BEFORE INSERT ON participant_pii_retention_decisions FOR EACH ROW EXECUTE FUNCTION participant_pii_retention_decisions_insert_guard_fn();
CREATE FUNCTION participant_pii_archives_update_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.key_version IS DISTINCT FROM OLD.key_version OR NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
    OR NEW.retention_cap_due_at IS DISTINCT FROM OLD.retention_cap_due_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NOT (OLD.review_status='pending' AND NEW.review_status='retained'
    AND NEW.review_reason_kind IS NOT NULL AND NEW.review_reason IS NOT NULL AND length(trim(NEW.review_reason)) BETWEEN 1 AND 500
    AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_at IS NOT NULL AND NEW.review_due_at>NEW.reviewed_at
    AND NEW.state_changed_by=NEW.reviewed_by AND NEW.state_changed_by_role='admin' AND NEW.state_changed_at=NEW.reviewed_at
    AND EXISTS (SELECT 1 FROM participant_pii_retention_decisions AS decision WHERE decision.archive_id=NEW.id
      AND decision.org_id=NEW.org_id AND decision.beneficiary_id=NEW.beneficiary_id AND decision.decision='retain'
      AND decision.reason_kind=NEW.review_reason_kind AND decision.reason=NEW.review_reason AND decision.retain_until=NEW.review_due_at
      AND decision.decided_by=NEW.reviewed_by AND decision.decided_at=NEW.reviewed_at)
    AND EXISTS (SELECT 1 FROM user_role_assignments AS role_assignment JOIN users ON users.id=role_assignment.user_id
      WHERE role_assignment.user_id=NEW.reviewed_by AND role_assignment.org_id=NEW.org_id AND role_assignment.role='institution_admin'
        AND role_assignment.revoked_at IS NULL AND users.org_id=NEW.org_id AND users.active=1)
    AND (NEW.review_reason_kind='legal_requirement' OR ccc_timestamp(NEW.review_due_at)<=ccc_timestamp(NEW.retention_cap_due_at)))
    AND NOT (OLD.review_status='retained' AND NEW.review_status='pending'
      AND ccc_timestamp(OLD.review_due_at)<=ccc_timestamp(NEW.state_changed_at) AND NEW.review_due_at=NEW.state_changed_at
      AND NEW.state_changed_by='system:retention' AND NEW.state_changed_by_role='service'
      AND NEW.review_reason_kind IS NULL AND NEW.review_reason IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_at IS NULL)
    AND NOT (OLD.review_status='pending' AND NEW.review_status='approved' AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
      AND NEW.state_changed_by=NEW.approved_by AND NEW.state_changed_by_role='admin' AND NEW.state_changed_at=NEW.approved_at
      AND EXISTS (SELECT 1 FROM participant_pii_retention_decisions AS decision WHERE decision.archive_id=NEW.id
        AND decision.org_id=NEW.org_id AND decision.beneficiary_id=NEW.beneficiary_id AND decision.decision='purge'
        AND decision.decided_by=NEW.approved_by AND decision.decided_at=NEW.approved_at)
      AND EXISTS (SELECT 1 FROM user_role_assignments AS role_assignment JOIN users ON users.id=role_assignment.user_id
        WHERE role_assignment.user_id=NEW.approved_by AND role_assignment.org_id=NEW.org_id AND role_assignment.role='institution_admin'
          AND role_assignment.revoked_at IS NULL AND users.org_id=NEW.org_id AND users.active=1)
      AND NOT EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND status='active'))
    AND NOT (OLD.review_status='approved' AND NEW.review_status='purged' AND NEW.purged_at IS NOT NULL
      AND NEW.state_changed_by=OLD.approved_by AND NEW.state_changed_by_role='admin' AND NEW.state_changed_at=NEW.purged_at
      AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND purged_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  IF NEW.review_status<>'purged' AND (NEW.enc_name IS DISTINCT FROM OLD.enc_name OR NEW.enc_phone IS DISTINCT FROM OLD.enc_phone
    OR NEW.enc_account IS DISTINCT FROM OLD.enc_account OR NEW.enc_email IS DISTINCT FROM OLD.enc_email
    OR NEW.enc_birth_date IS DISTINCT FROM OLD.enc_birth_date OR NEW.enc_region IS DISTINCT FROM OLD.enc_region
    OR NEW.enc_emergency_contact IS DISTINCT FROM OLD.enc_emergency_contact OR NEW.enc_gender IS DISTINCT FROM OLD.enc_gender) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='participant_schema_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER participant_pii_archives_update_guard BEFORE UPDATE ON participant_pii_archives FOR EACH ROW EXECUTE FUNCTION participant_pii_archives_update_guard_fn();
CREATE FUNCTION participant_pii_archives_review_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  VALUES(NEW.org_id,NEW.state_changed_by,NEW.state_changed_by_role,
    CASE NEW.review_status WHEN 'retained' THEN 'retain_archived_pii' WHEN 'pending' THEN 'requeue_pii_retention' WHEN 'approved' THEN 'approve_pii_purge' END,
    'participant_pii_archives',NEW.beneficiary_id,NEW.beneficiary_id,NULL,
    CASE NEW.review_status WHEN 'retained' THEN '{"reasonKind":'||to_json(NEW.review_reason_kind)::text||'}' ELSE NULL END,ccc_legacy_now());
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_archives_review_audit AFTER UPDATE OF review_status ON participant_pii_archives FOR EACH ROW
WHEN (OLD.review_status IS DISTINCT FROM NEW.review_status AND NEW.review_status<>'purged') EXECUTE FUNCTION participant_pii_archives_review_audit_fn();
CREATE FUNCTION participant_pii_archives_approved_purge_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participant_pii_vault SET enc_name=NULL,enc_phone=NULL,enc_account=NULL,enc_email=NULL,enc_birth_date=NULL,enc_region=NULL,
    enc_emergency_contact=NULL,enc_gender=NULL,purge_due=NULL,purged_at=NEW.approved_at,purged_by=NEW.approved_by,purged_by_role='admin',
    retention_changed_by=NEW.approved_by,retention_change_kind='purge_pii',retention_changed_at=NEW.approved_at,version=version+1,updated_at=NEW.approved_at
  WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND purged_at IS NULL AND purge_due IS NOT NULL
    AND ccc_nullable_least(ccc_timestamp(purge_due),COALESCE(
      (SELECT ccc_timestamp(retention_cap_due_at) FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id),
      ccc_timestamp(purge_due)))<=ccc_timestamp('now')
    AND NOT EXISTS (SELECT 1 FROM support_cases WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND status='active');
  UPDATE participant_pii_archives SET enc_name=NULL,enc_phone=NULL,enc_account=NULL,enc_email=NULL,enc_birth_date=NULL,enc_region=NULL,
    enc_emergency_contact=NULL,enc_gender=NULL,review_status='purged',purged_at=NEW.approved_at,state_changed_by=NEW.approved_by,
    state_changed_by_role='admin',state_changed_at=NEW.approved_at,updated_at=NEW.approved_at
  WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status='approved'
    AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND purged_at=NEW.approved_at);
  RETURN NULL;
END;
$$;
CREATE TRIGGER participant_pii_archives_approved_purge AFTER UPDATE OF review_status ON participant_pii_archives FOR EACH ROW
WHEN (OLD.review_status='pending' AND NEW.review_status='approved') EXECUTE FUNCTION participant_pii_archives_approved_purge_fn();

CREATE FUNCTION support_cases_schedule_pii_purge_due_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='active' AND NEW.status='closed' AND NOT EXISTS (SELECT 1 FROM support_cases AS active_case
    WHERE active_case.beneficiary_id=NEW.beneficiary_id AND active_case.org_id=NEW.org_id AND active_case.status='active') THEN
    UPDATE participant_pii_vault SET purge_due=ccc_retention_due(NEW.closed_at,
      COALESCE((SELECT pii_purge_grace_days FROM organization_settings WHERE org_id=NEW.org_id),365)),
      version=version+1,retention_changed_by=NEW.closed_by_actor_id,retention_context_support_case_id=NEW.id,
      retention_change_kind='schedule_pii_purge_due',retention_changed_at=NEW.closed_at,updated_at=ccc_legacy_now()
    WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND purged_at IS NULL AND purge_due IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER support_cases_schedule_pii_purge_due AFTER UPDATE OF status ON support_cases FOR EACH ROW EXECUTE FUNCTION support_cases_schedule_pii_purge_due_fn();
CREATE FUNCTION support_cases_cancel_pii_purge_due_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE participant_pii_vault SET
    enc_name=COALESCE((SELECT enc_name FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_name),
    enc_phone=COALESCE((SELECT enc_phone FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_phone),
    enc_account=COALESCE((SELECT enc_account FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_account),
    enc_email=COALESCE((SELECT enc_email FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_email),
    enc_birth_date=COALESCE((SELECT enc_birth_date FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_birth_date),
    enc_region=COALESCE((SELECT enc_region FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_region),
    enc_emergency_contact=COALESCE((SELECT enc_emergency_contact FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_emergency_contact),
    enc_gender=COALESCE((SELECT enc_gender FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged'),enc_gender),
    purge_due=NULL,version=version+1,retention_changed_by=NEW.created_by_actor_id,retention_context_support_case_id=NEW.id,
    retention_change_kind='cancel_pii_purge_due',retention_changed_at=NEW.created_at,updated_at=ccc_legacy_now()
  WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND purged_at IS NULL AND purge_due IS NOT NULL;
  INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,beneficiary_id,support_case_id,detail,created_at)
  SELECT NEW.org_id,NEW.created_by_actor_id,users.role,'restore_archived_pii','participant_pii_archives',NEW.beneficiary_id,NEW.beneficiary_id,NEW.id,NULL,ccc_legacy_now()
  FROM users WHERE users.id=NEW.created_by_actor_id AND EXISTS (SELECT 1 FROM participant_pii_archives
    WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged');
  DELETE FROM participant_pii_archives WHERE beneficiary_id=NEW.beneficiary_id AND org_id=NEW.org_id AND review_status<>'purged';
  RETURN NULL;
END;
$$;
CREATE TRIGGER support_cases_cancel_pii_purge_due AFTER INSERT ON support_cases FOR EACH ROW WHEN (NEW.creation_kind='subsequent') EXECUTE FUNCTION support_cases_cancel_pii_purge_due_fn();

-- The source cutover records even an empty fresh database.
INSERT INTO participant_support_case_cutover_manifest(
  migration_id,beneficiary_count,support_case_count,session_count,approved_ai_count,pii_vault_count,legacy_case_map_count
) VALUES ('0006_participant_support_case_cutover',0,0,0,0,0,0);

-- Explicit logical-key metadata, not a naming heuristic. These UNIQUE constraints
-- preserve SQLite TEXT PRIMARY KEY nullability; ordinary UNIQUE keys are unmarked.
COMMENT ON CONSTRAINT users_id_key ON users IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT beneficiaries_id_key ON beneficiaries IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT organization_settings_org_id_key ON organization_settings IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT support_cases_id_key ON support_cases IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT support_case_assignees_id_key ON support_case_assignees IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT participant_pii_vault_beneficiary_id_key ON participant_pii_vault IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT sessions_id_key ON sessions IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT goals_id_key ON goals IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT counseling_schedules_id_key ON counseling_schedules IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT action_items_id_key ON action_items IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT flags_id_key ON flags IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT session_goal_scores_id_key ON session_goal_scores IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_gas_evidence_id_key ON ai_gas_evidence IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT session_life_area_snapshots_id_key ON session_life_area_snapshots IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT session_discrepancies_id_key ON session_discrepancies IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT schedule_custom_questions_id_key ON schedule_custom_questions IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT schedule_session_goals_id_key ON schedule_session_goals IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT invite_tokens_token_key ON invite_tokens IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT participant_consent_records_id_key ON participant_consent_records IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT participant_support_case_cutover_manifest_migration_id_key ON participant_support_case_cutover_manifest IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT teams_id_key ON teams IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT team_memberships_id_key ON team_memberships IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT team_supervisor_grants_id_key ON team_supervisor_grants IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT user_role_assignments_id_key ON user_role_assignments IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT agent_installations_installation_id_key ON agent_installations IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT auth_revocations_id_key ON auth_revocations IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_provider_configs_id_key ON ai_provider_configs IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_provider_activations_id_key ON ai_provider_activations IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT pilot_text_ai_consent_evidence_id_key ON pilot_text_ai_consent_evidence IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_masked_source_snapshots_id_key ON ai_masked_source_snapshots IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_masked_source_evidence_items_id_key ON ai_masked_source_evidence_items IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_work_items_id_key ON ai_work_items IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_draft_versions_id_key ON ai_draft_versions IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_evidence_links_id_key ON ai_evidence_links IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_review_events_id_key ON ai_review_events IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_draft_source_materials_id_key ON ai_draft_source_materials IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_draft_contrast_axes_id_key ON ai_draft_contrast_axes IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT ai_text_work_queue_id_key ON ai_text_work_queue IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT recording_result_commits_session_id_key ON recording_result_commits IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT participant_pii_archives_beneficiary_id_key ON participant_pii_archives IS 'ccc:sqlite-primary-key';
COMMENT ON CONSTRAINT participant_pii_retention_decisions_id_key ON participant_pii_retention_decisions IS 'ccc:sqlite-primary-key';
