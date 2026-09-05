-- E3-2 / S1: provider-neutral mutation markers and canonical UTC timestamp defaults.
-- Rebuild only legacy-default tables whose immutable guards block an in-place timestamp rewrite.

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;


DROP TRIGGER ai_draft_versions_insert_guard;
DROP TRIGGER ai_evidence_links_insert_guard;
DROP TRIGGER ai_evidence_links_no_delete;
DROP TRIGGER ai_evidence_links_no_update;
DROP TRIGGER ai_provider_activations_no_delete;
DROP TRIGGER ai_provider_activations_only_deactivate;
DROP TRIGGER ai_provider_activations_scope_guard;
DROP TRIGGER ai_provider_configs_no_delete;
DROP TRIGGER ai_provider_configs_no_update;
DROP TRIGGER ai_review_events_insert_guard;
DROP TRIGGER ai_review_events_no_delete;
DROP TRIGGER ai_review_events_no_update;
DROP TRIGGER audit_log_no_delete;
DROP TRIGGER audit_log_no_update;
DROP TRIGGER audit_log_participant_provenance_guard;
DROP TRIGGER beneficiaries_complete_guard;
DROP TRIGGER case_assignees_legacy_delete_unsupported;
DROP TRIGGER case_assignees_legacy_insert_unsupported;
DROP TRIGGER case_assignees_legacy_update_unsupported;
DROP TRIGGER cases_legacy_delete_unsupported;
DROP TRIGGER cases_legacy_insert_unsupported;
DROP TRIGGER cases_legacy_update_unsupported;
DROP TRIGGER invite_tokens_no_double_consume;
DROP TRIGGER invite_tokens_no_revoked_consume;
DROP TRIGGER participant_consent_records_insert_guard;
DROP TRIGGER participant_consent_records_no_delete;
DROP TRIGGER participant_consent_records_no_update;
DROP TRIGGER participant_pii_archives_insert_audit;
DROP TRIGGER participant_pii_archives_insert_guard;
DROP TRIGGER participant_pii_archives_review_audit;
DROP TRIGGER participant_pii_archives_update_guard;
DROP TRIGGER participant_pii_retention_decisions_insert_guard;
DROP TRIGGER participant_pii_vault_cancel_audit;
DROP TRIGGER participant_pii_vault_purge_audit;
DROP TRIGGER participant_pii_vault_retention_guard;
DROP TRIGGER participant_pii_vault_schedule_audit;
DROP TRIGGER sessions_manual_submission_audit;
DROP TRIGGER support_case_assignees_insert_guard;
DROP TRIGGER support_cases_cancel_pii_purge_due;
DROP TRIGGER support_cases_schedule_pii_purge_due;
DROP TRIGGER team_memberships_end_guard;
DROP TRIGGER team_memberships_immutable_guard;
DROP TRIGGER team_memberships_insert_guard;
DROP TRIGGER team_memberships_no_delete;
DROP TRIGGER team_supervisor_grants_immutable_guard;
DROP TRIGGER team_supervisor_grants_insert_guard;
DROP TRIGGER team_supervisor_grants_no_delete;
DROP TRIGGER team_supervisor_grants_revoke_guard;
DROP TRIGGER teams_archive_guard;
DROP TRIGGER teams_immutable_guard;
DROP TRIGGER teams_insert_guard;
DROP TRIGGER teams_no_delete;
DROP TRIGGER user_role_assignments_immutable_guard;
DROP TRIGGER user_role_assignments_insert_guard;
DROP TRIGGER user_role_assignments_no_delete;
DROP TRIGGER user_role_assignments_revoke_guard;
DROP TRIGGER users_last_required_roles_guard;
DROP TRIGGER users_seed_independent_roles_after_insert;
DROP TRIGGER users_sync_independent_roles_after_role_update;

DROP VIEW approved_ai_briefing_v1;
DROP VIEW case_assignees;
DROP VIEW cases;
DROP VIEW grounded_ai_quality_v1;

CREATE TABLE ai_evidence_links_sql_portability_next (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES "ai_draft_versions" (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);

CREATE TABLE ai_provider_activations_sql_portability_next (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL,
  config_id              TEXT NOT NULL REFERENCES ai_provider_configs (id),
  previous_activation_id TEXT REFERENCES ai_provider_activations (id),
  activated_by           TEXT NOT NULL,
  activated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deactivated_at         TEXT,
  CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);

CREATE TABLE ai_provider_configs_sql_portability_next (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  adapter_id          TEXT NOT NULL CHECK (length(trim(adapter_id)) > 0),
  adapter_version     TEXT NOT NULL CHECK (length(trim(adapter_version)) > 0),
  config_hash         TEXT NOT NULL CHECK (length(trim(config_hash)) > 0),
  approval_refs_json  TEXT NOT NULL CHECK (length(trim(approval_refs_json)) > 0),
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (org_id, adapter_id, adapter_version, config_hash)
);

CREATE TABLE ai_review_events_sql_portability_next (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  draft_version_id     TEXT NOT NULL REFERENCES "ai_draft_versions" (id),
  decision             TEXT NOT NULL
                       CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES "ai_draft_versions" (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR
    (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);

CREATE TABLE audit_log_sql_portability_next (
  id                INTEGER PRIMARY KEY,
  org_id            TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  actor_role        TEXT NOT NULL CHECK (actor_role IN ('admin', 'counselor', 'service')),
  action            TEXT NOT NULL,
  target_table      TEXT NOT NULL,
  target_id         TEXT,
  beneficiary_id    TEXT REFERENCES beneficiaries (id),
  support_case_id   TEXT REFERENCES "support_cases" (id),
  case_id           TEXT,
  detail            TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE invite_tokens_sql_portability_next (
  token                   TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('participant', 'counselor')),
  -- participant 초대에 필수(링크가 사업을 정한다), counselor 초대는 NULL.
  program_type            TEXT,
  issued_by               TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used')),
  issued_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at                 TEXT,
  used_by_beneficiary_id  TEXT,
  used_by_user_id         TEXT, revoked_at TEXT,
  CHECK (kind != 'participant' OR program_type IS NOT NULL)
);

CREATE TABLE participant_consent_records_sql_portability_next (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  consent_recording_at  TEXT,                                 -- 녹음·음성 분석 동의 시각 (NULL = 미동의, D15)
  consent_text_ai_at    TEXT,                                 -- 텍스트 AI 정리 동의 시각 (NULL = 미동의, D15)
  recorded_by           TEXT NOT NULL,                        -- 기록자 (Access 사용자)
  recorded_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, consent_privacy_at TEXT, privacy_notice_version TEXT, privacy_notice_sha256 TEXT, privacy_evidence_ref TEXT);

CREATE TABLE team_memberships_sql_portability_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  team_id    TEXT NOT NULL REFERENCES "teams" (id),
  user_id    TEXT NOT NULL REFERENCES "users" (id),
  added_by   TEXT NOT NULL REFERENCES "users" (id),
  joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at   TEXT
);

CREATE TABLE team_supervisor_grants_sql_portability_next (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  team_id            TEXT NOT NULL REFERENCES "teams" (id),
  supervisor_user_id TEXT NOT NULL REFERENCES "users" (id),
  granted_by         TEXT NOT NULL REFERENCES "users" (id),
  granted_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at         TEXT
);

CREATE TABLE teams_sql_portability_next (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by  TEXT NOT NULL REFERENCES "users" (id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE user_role_assignments_sql_portability_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES "users" (id),
  role       TEXT NOT NULL CHECK (role IN (
               'institution_admin',
               'institution_technical_admin',
               'practitioner'
             )),
  source     TEXT NOT NULL CHECK (source IN ('legacy', 'manual')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  CHECK (
    (source = 'legacy' AND granted_by IS NULL)
    OR
    (source = 'manual' AND granted_by IS NOT NULL)
  )
);

INSERT INTO ai_evidence_links_sql_portability_next (id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at)
SELECT id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END FROM ai_evidence_links;

INSERT INTO ai_provider_activations_sql_portability_next (id, org_id, config_id, previous_activation_id, activated_by, activated_at, deactivated_at)
SELECT id, org_id, config_id, previous_activation_id, activated_by, CASE WHEN activated_at GLOB '????-??-?? ??:??:??' THEN substr(activated_at, 1, 10) || 'T' || substr(activated_at, 12, 8) || '.000Z' ELSE activated_at END, CASE WHEN deactivated_at GLOB '????-??-?? ??:??:??' THEN substr(deactivated_at, 1, 10) || 'T' || substr(deactivated_at, 12, 8) || '.000Z' ELSE deactivated_at END FROM ai_provider_activations;

INSERT INTO ai_provider_configs_sql_portability_next (id, org_id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, created_at)
SELECT id, org_id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END FROM ai_provider_configs;

INSERT INTO ai_review_events_sql_portability_next (id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at)
SELECT id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END FROM ai_review_events;

INSERT INTO audit_log_sql_portability_next (id, org_id, actor_id, actor_role, action, target_table, target_id, beneficiary_id, support_case_id, case_id, detail, created_at)
SELECT id, org_id, actor_id, actor_role, action, target_table, target_id, beneficiary_id, support_case_id, case_id, detail, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END FROM audit_log;

INSERT INTO invite_tokens_sql_portability_next (token, org_id, kind, program_type, issued_by, status, issued_at, used_at, used_by_beneficiary_id, used_by_user_id, revoked_at)
SELECT token, org_id, kind, program_type, issued_by, status, CASE WHEN issued_at GLOB '????-??-?? ??:??:??' THEN substr(issued_at, 1, 10) || 'T' || substr(issued_at, 12, 8) || '.000Z' ELSE issued_at END, CASE WHEN used_at GLOB '????-??-?? ??:??:??' THEN substr(used_at, 1, 10) || 'T' || substr(used_at, 12, 8) || '.000Z' ELSE used_at END, used_by_beneficiary_id, used_by_user_id, CASE WHEN revoked_at GLOB '????-??-?? ??:??:??' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END FROM invite_tokens;

INSERT INTO participant_consent_records_sql_portability_next (id, org_id, beneficiary_id, support_case_id, consent_recording_at, consent_text_ai_at, recorded_by, recorded_at, created_at, consent_privacy_at, privacy_notice_version, privacy_notice_sha256, privacy_evidence_ref)
SELECT id, org_id, beneficiary_id, support_case_id, CASE WHEN consent_recording_at GLOB '????-??-?? ??:??:??' THEN substr(consent_recording_at, 1, 10) || 'T' || substr(consent_recording_at, 12, 8) || '.000Z' ELSE consent_recording_at END, CASE WHEN consent_text_ai_at GLOB '????-??-?? ??:??:??' THEN substr(consent_text_ai_at, 1, 10) || 'T' || substr(consent_text_ai_at, 12, 8) || '.000Z' ELSE consent_text_ai_at END, recorded_by, CASE WHEN recorded_at GLOB '????-??-?? ??:??:??' THEN substr(recorded_at, 1, 10) || 'T' || substr(recorded_at, 12, 8) || '.000Z' ELSE recorded_at END, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END, CASE WHEN consent_privacy_at GLOB '????-??-?? ??:??:??' THEN substr(consent_privacy_at, 1, 10) || 'T' || substr(consent_privacy_at, 12, 8) || '.000Z' ELSE consent_privacy_at END, privacy_notice_version, privacy_notice_sha256, privacy_evidence_ref FROM participant_consent_records;

INSERT INTO team_memberships_sql_portability_next (id, org_id, team_id, user_id, added_by, joined_at, ended_at)
SELECT id, org_id, team_id, user_id, added_by, CASE WHEN joined_at GLOB '????-??-?? ??:??:??' THEN substr(joined_at, 1, 10) || 'T' || substr(joined_at, 12, 8) || '.000Z' ELSE joined_at END, CASE WHEN ended_at GLOB '????-??-?? ??:??:??' THEN substr(ended_at, 1, 10) || 'T' || substr(ended_at, 12, 8) || '.000Z' ELSE ended_at END FROM team_memberships;

INSERT INTO team_supervisor_grants_sql_portability_next (id, org_id, team_id, supervisor_user_id, granted_by, granted_at, revoked_at)
SELECT id, org_id, team_id, supervisor_user_id, granted_by, CASE WHEN granted_at GLOB '????-??-?? ??:??:??' THEN substr(granted_at, 1, 10) || 'T' || substr(granted_at, 12, 8) || '.000Z' ELSE granted_at END, CASE WHEN revoked_at GLOB '????-??-?? ??:??:??' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END FROM team_supervisor_grants;

INSERT INTO teams_sql_portability_next (id, org_id, name, created_by, created_at, archived_at)
SELECT id, org_id, name, created_by, CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END, CASE WHEN archived_at GLOB '????-??-?? ??:??:??' THEN substr(archived_at, 1, 10) || 'T' || substr(archived_at, 12, 8) || '.000Z' ELSE archived_at END FROM teams;

INSERT INTO user_role_assignments_sql_portability_next (id, org_id, user_id, role, source, granted_by, granted_at, revoked_at)
SELECT id, org_id, user_id, role, source, granted_by, CASE WHEN granted_at GLOB '????-??-?? ??:??:??' THEN substr(granted_at, 1, 10) || 'T' || substr(granted_at, 12, 8) || '.000Z' ELSE granted_at END, CASE WHEN revoked_at GLOB '????-??-?? ??:??:??' THEN substr(revoked_at, 1, 10) || 'T' || substr(revoked_at, 12, 8) || '.000Z' ELSE revoked_at END FROM user_role_assignments;

DROP TABLE ai_evidence_links;
DROP TABLE ai_provider_activations;
DROP TABLE ai_provider_configs;
DROP TABLE ai_review_events;
DROP TABLE audit_log;
DROP TABLE invite_tokens;
DROP TABLE participant_consent_records;
DROP TABLE team_memberships;
DROP TABLE team_supervisor_grants;
DROP TABLE teams;
DROP TABLE user_role_assignments;

ALTER TABLE user_role_assignments_sql_portability_next RENAME TO user_role_assignments;
ALTER TABLE teams_sql_portability_next RENAME TO teams;
ALTER TABLE team_supervisor_grants_sql_portability_next RENAME TO team_supervisor_grants;
ALTER TABLE team_memberships_sql_portability_next RENAME TO team_memberships;
ALTER TABLE participant_consent_records_sql_portability_next RENAME TO participant_consent_records;
ALTER TABLE invite_tokens_sql_portability_next RENAME TO invite_tokens;
ALTER TABLE audit_log_sql_portability_next RENAME TO audit_log;
ALTER TABLE ai_review_events_sql_portability_next RENAME TO ai_review_events;
ALTER TABLE ai_provider_configs_sql_portability_next RENAME TO ai_provider_configs;
ALTER TABLE ai_provider_activations_sql_portability_next RENAME TO ai_provider_activations;
ALTER TABLE ai_evidence_links_sql_portability_next RENAME TO ai_evidence_links;

ALTER TABLE support_cases ADD COLUMN operation_marker TEXT;
ALTER TABLE support_case_assignees ADD COLUMN operation_marker TEXT;
ALTER TABLE participant_pii_vault ADD COLUMN operation_marker TEXT;
ALTER TABLE counseling_schedules ADD COLUMN operation_marker TEXT;
ALTER TABLE sessions ADD COLUMN operation_marker TEXT;
ALTER TABLE action_items ADD COLUMN operation_marker TEXT;
ALTER TABLE invite_tokens ADD COLUMN consumption_id TEXT;


CREATE INDEX idx_ai_evidence_links_draft
  ON ai_evidence_links (draft_version_id, claim_key);

CREATE INDEX idx_ai_provider_activations_org
  ON ai_provider_activations (org_id, activated_at DESC);

CREATE INDEX idx_ai_provider_configs_org
  ON ai_provider_configs (org_id, adapter_id, created_at DESC);

CREATE INDEX idx_ai_review_events_work
  ON ai_review_events (work_item_id, created_at DESC);

CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);

CREATE INDEX idx_audit_beneficiary ON audit_log (beneficiary_id, created_at);

CREATE INDEX idx_audit_support_case ON audit_log (support_case_id, created_at);

CREATE INDEX idx_invite_tokens_org ON invite_tokens (org_id, kind, status);

CREATE INDEX idx_participant_consent_records_scope
  ON participant_consent_records (org_id, beneficiary_id, support_case_id, recorded_at DESC);

CREATE INDEX idx_team_memberships_user
  ON team_memberships (org_id, user_id, team_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_team_supervisor_grants_supervisor
  ON team_supervisor_grants (org_id, supervisor_user_id, team_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_teams_org
  ON teams (org_id, archived_at, name);

CREATE INDEX idx_user_role_assignments_role
  ON user_role_assignments (org_id, role, user_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_ai_provider_activations_one_active_org
  ON ai_provider_activations (org_id)
  WHERE deactivated_at IS NULL;

CREATE UNIQUE INDEX uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id)
  WHERE decision = 'approved';

CREATE UNIQUE INDEX uq_ai_review_events_terminal_draft
  ON ai_review_events (draft_version_id);

CREATE UNIQUE INDEX uq_team_memberships_active
  ON team_memberships (org_id, team_id, user_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX uq_team_supervisor_grants_active
  ON team_supervisor_grants (org_id, team_id, supervisor_user_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_user_role_assignments_active
  ON user_role_assignments (org_id, user_id, role)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_support_cases_operation_marker ON support_cases (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_operation_marker ON support_case_assignees (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_participant_pii_vault_operation_marker ON participant_pii_vault (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_counseling_schedules_operation_marker ON counseling_schedules (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_sessions_operation_marker ON sessions (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_action_items_operation_marker ON action_items (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_invite_tokens_consumption_id ON invite_tokens (consumption_id) WHERE consumption_id IS NOT NULL;


UPDATE beneficiaries
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE organization_settings
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
  updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END
WHERE created_at GLOB '????-??-?? ??:??:??' OR updated_at GLOB '????-??-?? ??:??:??';

UPDATE participant_support_case_cutover_manifest
SET   completed_at = CASE WHEN completed_at GLOB '????-??-?? ??:??:??' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END
WHERE completed_at GLOB '????-??-?? ??:??:??';

UPDATE schedule_custom_questions
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE schedule_session_goals
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE session_life_area_snapshots
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

UPDATE users
SET   created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END
WHERE created_at GLOB '????-??-?? ??:??:??';

CREATE TRIGGER beneficiaries_normalize_timestamp_after_insert
AFTER INSERT ON beneficiaries
WHEN NEW.created_at GLOB '????-??-?? ??:??:??' OR NEW.updated_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE beneficiaries SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
    updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER organization_settings_normalize_timestamp_after_insert
AFTER INSERT ON organization_settings
WHEN NEW.created_at GLOB '????-??-?? ??:??:??' OR NEW.updated_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE organization_settings SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END,
    updated_at = CASE WHEN updated_at GLOB '????-??-?? ??:??:??' THEN substr(updated_at, 1, 10) || 'T' || substr(updated_at, 12, 8) || '.000Z' ELSE updated_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER participant_support_case_cutover_manifest_normalize_timestamp_after_insert
AFTER INSERT ON participant_support_case_cutover_manifest
WHEN NEW.completed_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE participant_support_case_cutover_manifest SET completed_at = CASE WHEN completed_at GLOB '????-??-?? ??:??:??' THEN substr(completed_at, 1, 10) || 'T' || substr(completed_at, 12, 8) || '.000Z' ELSE completed_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER schedule_custom_questions_normalize_timestamp_after_insert
AFTER INSERT ON schedule_custom_questions
WHEN NEW.created_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE schedule_custom_questions SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER schedule_session_goals_normalize_timestamp_after_insert
AFTER INSERT ON schedule_session_goals
WHEN NEW.created_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE schedule_session_goals SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER session_life_area_snapshots_normalize_timestamp_after_insert
AFTER INSERT ON session_life_area_snapshots
WHEN NEW.created_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE session_life_area_snapshots SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER users_normalize_timestamp_after_insert
AFTER INSERT ON users
WHEN NEW.created_at GLOB '????-??-?? ??:??:??'
BEGIN
  UPDATE users SET created_at = CASE WHEN created_at GLOB '????-??-?? ??:??:??' THEN substr(created_at, 1, 10) || 'T' || substr(created_at, 12, 8) || '.000Z' ELSE created_at END WHERE rowid = NEW.rowid;
END;

CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.support_case_id AS support_case_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  support_case.beneficiary_id AS beneficiary_id,
  support_case.program_type AS support_case_program_type,
  support_case.status AS support_case_status,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.claims_json AS claims_json,
  draft.questions_json AS questions_json,
  draft.one_liner AS one_liner,
  draft.summary_text AS ai_summary,
  draft.source_snapshot_id AS source_snapshot_id,
  draft.source_snapshot_hash AS source_snapshot_hash,
  draft.consent_evidence_id AS consent_evidence_id,
  draft.provider_config_id AS provider_config_id,
  draft.model_id AS model_id,
  draft.prompt_version AS prompt_version,
  draft.schema_version AS schema_version,
  draft.origin AS origin,
  draft.creation_mode AS creation_mode,
  draft.grounding_status AS grounding_status,
  draft.created_by AS draft_created_by,
  draft.created_at AS draft_created_at,
  review.id AS review_event_id,
  review.actor_id AS approved_by,
  review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work ON work.id = review.work_item_id
JOIN support_cases AS support_case ON support_case.id = work.support_case_id
JOIN ai_draft_versions AS draft ON draft.id = review.draft_version_id
                             AND draft.work_item_id = work.id
WHERE review.decision = 'approved'
  AND draft.origin <> 'fixture_generated';

CREATE VIEW case_assignees AS
SELECT
  assignment.id,
  assignment.org_id,
  support_case.legacy_case_id AS case_id,
  assignment.user_id,
  assignment.role,
  assignment.assigned_at,
  assignment.unassigned_at
FROM support_case_assignees AS assignment
JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
WHERE support_case.legacy_case_id IS NOT NULL
  AND assignment.status = 'active';

CREATE VIEW cases AS
SELECT
  support_case.legacy_case_id AS id,
  support_case.org_id,
  support_case.program_type,
  support_case.status,
  support_case.intake_at,
  support_case.consent_recording_at,
  support_case.consent_text_ai_at,
  support_case.closed_at,
  support_case.closed_reason,
  vault.purge_due,
  support_case.extra,
  support_case.created_at,
  support_case.updated_at
FROM support_cases AS support_case
LEFT JOIN participant_pii_vault AS vault
  ON vault.beneficiary_id = support_case.beneficiary_id
 AND vault.org_id = support_case.org_id
WHERE support_case.legacy_case_id IS NOT NULL;

CREATE VIEW grounded_ai_quality_v1 AS
SELECT * FROM approved_ai_briefing_v1
WHERE origin = 'generated' AND grounding_status = 'grounded';

CREATE TRIGGER ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((SELECT MAX(version) + 1 FROM ai_draft_versions
                                 WHERE work_item_id = NEW.work_item_id), 1);
  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
     OR (NEW.version > 1 AND NOT EXISTS (
       SELECT 1 FROM ai_draft_versions AS parent
       WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
         AND parent.version = NEW.version - 1
     ));
  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.questions_json) AS question
    WHERE CASE question.type
      WHEN 'text' THEN length(trim(question.value)) = 0
      WHEN 'object' THEN NOT (
        json_type(question.value, '$.title') = 'text'
        AND length(trim(json_extract(question.value, '$.title'))) > 0
        AND json_type(question.value, '$.reason') = 'text'
        AND length(trim(json_extract(question.value, '$.reason'))) > 0
        AND (SELECT COUNT(*) FROM json_each(question.value)) = 2
      )
      ELSE 1
    END
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.questions_json) AS question
    GROUP BY CASE question.type
      WHEN 'object' THEN json_extract(question.value, '$.title')
      ELSE question.value
    END
    HAVING COUNT(*) > 1
  )
  OR (
    NEW.origin = 'fixture_generated'
    AND EXISTS (
      SELECT 1 FROM json_each(NEW.questions_json) AS question
      WHERE question.type <> 'object'
    )
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM ai_review_events
                WHERE draft_version_id = NEW.parent_version_id);
  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = NEW.source_snapshot_hash
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id = NEW.consent_evidence_id AND evidence.org_id = work.org_id
     AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NEW.consent_evidence_id IS NOT (
    SELECT evidence.id
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.org_id = work.org_id AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
      AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'human_edited' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
      AND parent.origin = 'generated' AND parent.provider_config_id IS NEW.provider_config_id
      AND parent.source_snapshot_id IS NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
      AND parent.questions_json IS NEW.questions_json AND parent.model_id IS NEW.model_id
      AND parent.prompt_version IS NEW.prompt_version AND parent.schema_version IS NEW.schema_version
  );
  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'provider_generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id = config.id
                                                AND activation.org_id = work.org_id
    WHERE work.id = NEW.work_item_id AND activation.deactivated_at IS NULL
  );
END;

CREATE TRIGGER ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.origin IN ('generated', 'fixture_generated')
      AND draft.grounding_status = 'grounded'
  );
  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id
     AND (
       -- 주 재료(단수 컬럼). 레거시 초안은 재료 표에 행이 없으므로 이 길로만 통과한다.
       (snapshot.id = draft.source_snapshot_id AND snapshot.sha256 = draft.source_snapshot_hash)
       -- 이 초안이 실제로 실은 재료(D69 · ADR-0036 재료 다중화).
       OR EXISTS (
         SELECT 1 FROM ai_draft_source_materials AS material
         WHERE material.draft_version_id = draft.id
           AND material.snapshot_id = snapshot.id
           AND material.snapshot_sha256 = snapshot.sha256
       )
     )
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256 AND item.org_id = work.org_id
     AND item.support_case_id = work.support_case_id AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.draft_version_id)
     OR EXISTS (
       SELECT 1
       FROM ai_draft_versions AS newer
       JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
       WHERE newer.work_item_id = draft.work_item_id AND newer.version > draft.version
     );
END;

CREATE TRIGGER ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_provider_activations_no_delete
BEFORE DELETE ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activations are append-only');
END;

CREATE TRIGGER ai_provider_activations_only_deactivate
BEFORE UPDATE ON ai_provider_activations
WHEN NEW.id IS NOT OLD.id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.config_id IS NOT OLD.config_id
  OR NEW.previous_activation_id IS NOT OLD.previous_activation_id
  OR NEW.activated_by IS NOT OLD.activated_by
  OR NEW.activated_at IS NOT OLD.activated_at
  OR OLD.deactivated_at IS NOT NULL
  OR NEW.deactivated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider activation is immutable except retirement');
END;

CREATE TRIGGER ai_provider_activations_scope_guard
BEFORE INSERT ON ai_provider_activations
BEGIN
  SELECT RAISE(ABORT, 'phase1: provider configuration organization mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_provider_configs AS config
    WHERE config.id = NEW.config_id
      AND config.org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'phase1: prior provider activation must be retired in the same organization')
  WHERE NEW.previous_activation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ai_provider_activations AS prior
      WHERE prior.id = NEW.previous_activation_id
        AND prior.org_id = NEW.org_id
        AND prior.deactivated_at IS NOT NULL
    );
END;

CREATE TRIGGER ai_provider_configs_no_delete
BEFORE DELETE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TRIGGER ai_provider_configs_no_update
BEFORE UPDATE ON ai_provider_configs
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI provider configurations are append-only');
END;

CREATE TRIGGER ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.work_item_id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected') AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS newer
    JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
    WHERE newer.work_item_id = NEW.work_item_id AND newer.version > draft.version
  );
  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded' AND NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE draft.id = NEW.draft_version_id AND replacement.work_item_id = draft.work_item_id
      AND replacement.version = draft.version + 1
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS later
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE later.work_item_id = NEW.work_item_id AND later.version > replacement.version
  );
  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1
    FROM ai_review_events
    WHERE draft_version_id = NEW.replacement_draft_id
  );
  SELECT RAISE(ABORT, 'phase1: fixture draft approval is prohibited')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'fixture_generated'
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);
  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ai_evidence_links
    WHERE draft_version_id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ai_evidence_links
    WHERE draft_version_id = NEW.draft_version_id
      AND claim_key NOT GLOB 'question_[0-9]*'
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
      AND EXISTS (
        SELECT 1
        FROM json_each(draft.questions_json) AS question
        WHERE NOT EXISTS (
          SELECT 1
          FROM ai_evidence_links AS evidence
          WHERE evidence.draft_version_id = draft.id
            AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1)
        )
      )
  );
END;

CREATE TRIGGER ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'D14: audit_log is append-only'); END;

CREATE TRIGGER audit_log_participant_provenance_guard
BEFORE INSERT ON audit_log
WHEN NEW.beneficiary_id IS NOT NULL OR NEW.support_case_id IS NOT NULL
  OR NEW.action IN ('purge_pii_noop', 'reveal_participant_pii')
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'purge_pii_noop' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.support_case_id IS NULL
    AND NEW.detail = '{"reason":"not_eligible_or_already_purged"}'
    AND EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND org_id = NEW.org_id
                AND active = 1 AND role = 'admin')
    AND EXISTS (SELECT 1 FROM participant_pii_vault WHERE beneficiary_id = NEW.beneficiary_id
                AND (
                  purged_at IS NOT NULL
                  OR purge_due IS NULL
                  OR purge_due > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  OR EXISTS (
                    SELECT 1 FROM support_cases
                    WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
                  )
                ))
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'reveal_participant_pii' AND NOT (
    NEW.target_table = 'participant_pii_vault' AND NEW.target_id = NEW.beneficiary_id
    AND NEW.detail = '{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id
        AND active = 1 AND role = NEW.actor_role
        AND role IN ('admin', 'counselor')
    )
    AND (
      NEW.actor_role = 'admin'
      OR EXISTS (
        SELECT 1 FROM support_case_assignees
        WHERE support_case_id = NEW.support_case_id AND org_id = NEW.org_id
          AND user_id = NEW.actor_id AND unassigned_at IS NULL
      )
    )
    AND EXISTS (SELECT 1 FROM support_cases WHERE id = NEW.support_case_id
                AND org_id = NEW.org_id AND beneficiary_id = NEW.beneficiary_id
                AND status = 'active')
  );
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;

CREATE TRIGGER case_assignees_legacy_delete_unsupported
INSTEAD OF DELETE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER case_assignees_legacy_insert_unsupported
INSTEAD OF INSERT ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER case_assignees_legacy_update_unsupported
INSTEAD OF UPDATE ON case_assignees
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER cases_legacy_delete_unsupported
INSTEAD OF DELETE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER cases_legacy_insert_unsupported
INSTEAD OF INSERT ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER cases_legacy_update_unsupported
INSTEAD OF UPDATE ON cases
BEGIN SELECT RAISE(ABORT, 'legacy_case_write_unsupported'); END;

CREATE TRIGGER invite_tokens_no_double_consume
BEFORE UPDATE ON invite_tokens
WHEN NEW.status = 'used' AND OLD.status <> 'issued'
BEGIN
  SELECT RAISE(ABORT, 'invite_token_already_used');
END;

CREATE TRIGGER invite_tokens_no_revoked_consume
BEFORE UPDATE ON invite_tokens
WHEN NEW.status = 'used' AND OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invite_token_revoked');
END;

CREATE TRIGGER participant_consent_records_insert_guard
BEFORE INSERT ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.recorded_by <> 'self' AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.consent_recording_at IS NOT NULL AND NEW.consent_recording_at <> NEW.recorded_at)
     OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at <> NEW.recorded_at)
     OR (NEW.consent_privacy_at IS NOT NULL AND NEW.consent_privacy_at <> NEW.recorded_at);

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (
    NEW.consent_privacy_at IS NOT NULL
    AND (
      NEW.privacy_notice_version IS NULL
      OR length(NEW.privacy_notice_version) < 3
      OR NEW.privacy_notice_sha256 IS NULL
      OR length(NEW.privacy_notice_sha256) <> 64
      OR NEW.privacy_notice_sha256 GLOB '*[^0-9a-f]*'
      OR NEW.privacy_evidence_ref IS NULL
      OR NEW.privacy_evidence_ref NOT GLOB 'offline://*'
    )
  )
  OR (
    NEW.consent_privacy_at IS NULL
    AND (
      NEW.privacy_notice_version IS NOT NULL
      OR NEW.privacy_notice_sha256 IS NOT NULL
      OR NEW.privacy_evidence_ref IS NOT NULL
    )
  );
END;

CREATE TRIGGER participant_consent_records_no_delete
BEFORE DELETE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;

CREATE TRIGGER participant_consent_records_no_update
BEFORE UPDATE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;

CREATE TRIGGER participant_pii_archives_insert_audit
AFTER INSERT ON participant_pii_archives
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  VALUES (
    NEW.org_id, NEW.archived_by, 'service', 'archive_pii',
    'participant_pii_archives', NEW.beneficiary_id, NEW.beneficiary_id, NULL,
    '{"reviewStatus":"pending"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER participant_pii_archives_insert_guard
BEFORE INSERT ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE length(trim(NEW.id)) = 0
     OR NEW.review_status <> 'pending'
     OR NEW.archived_by <> 'system:retention'
     OR NEW.state_changed_by <> 'system:retention'
     OR NEW.state_changed_by_role <> 'service'
     OR NEW.review_due_at IS NOT NEW.archived_at
;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM participant_pii_vault AS vault
    WHERE vault.beneficiary_id = NEW.beneficiary_id
      AND vault.org_id = NEW.org_id
      AND vault.purged_at IS NULL
      AND vault.purge_due IS NOT NULL
      AND min(
        julianday(vault.purge_due),
        COALESCE(
          (
            SELECT julianday(
              CASE strftime('%m-%d', context_case.closed_at)
                WHEN '02-29' THEN strftime('%Y-%m-%dT%H:%M:%fZ', context_case.closed_at, '+5 years', '-1 day')
                ELSE strftime('%Y-%m-%dT%H:%M:%fZ', context_case.closed_at, '+5 years')
              END
            )
            FROM support_cases AS context_case
            WHERE context_case.beneficiary_id = vault.beneficiary_id
              AND context_case.org_id = vault.org_id
              AND context_case.status = 'closed'
              AND context_case.closed_at IS NOT NULL
            ORDER BY julianday(context_case.closed_at) DESC, context_case.id DESC
            LIMIT 1
          ),
          julianday(vault.purge_due)
        )
      ) <= julianday(NEW.archived_at)
      AND vault.key_version = NEW.key_version
      AND vault.enc_name IS NEW.enc_name
      AND vault.enc_phone IS NEW.enc_phone
      AND vault.enc_account IS NEW.enc_account
      AND vault.enc_email IS NEW.enc_email
      AND vault.enc_birth_date IS NEW.enc_birth_date
      AND vault.enc_region IS NEW.enc_region
      AND vault.enc_emergency_contact IS NEW.enc_emergency_contact
      AND vault.enc_gender IS NEW.enc_gender
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
  );
END;

CREATE TRIGGER participant_pii_archives_review_audit
AFTER UPDATE OF review_status ON participant_pii_archives
WHEN OLD.review_status IS NOT NEW.review_status AND NEW.review_status <> 'purged'
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  VALUES (
    NEW.org_id, NEW.state_changed_by, NEW.state_changed_by_role,
    CASE NEW.review_status
      WHEN 'retained' THEN 'retain_archived_pii'
      WHEN 'pending' THEN 'requeue_pii_retention'
      WHEN 'approved' THEN 'approve_pii_purge'
    END,
    'participant_pii_archives', NEW.beneficiary_id, NEW.beneficiary_id, NULL,
    CASE NEW.review_status
      WHEN 'retained' THEN json_object('reasonKind', NEW.review_reason_kind)
      ELSE NULL
    END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;

CREATE TRIGGER participant_pii_archives_update_guard
BEFORE UPDATE ON participant_pii_archives
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.id IS NOT OLD.id
     OR NEW.org_id IS NOT OLD.org_id
     OR NEW.key_version IS NOT OLD.key_version
     OR NEW.archived_at IS NOT OLD.archived_at
     OR NEW.archived_by IS NOT OLD.archived_by
     OR NEW.retention_cap_due_at IS NOT OLD.retention_cap_due_at
     OR NEW.created_at IS NOT OLD.created_at;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'retained'
    AND NEW.review_reason_kind IS NOT NULL
    AND NEW.review_reason IS NOT NULL AND length(trim(NEW.review_reason)) BETWEEN 1 AND 500
    AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_at IS NOT NULL
    AND NEW.review_due_at > NEW.reviewed_at
    AND NEW.state_changed_by = NEW.reviewed_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.reviewed_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'retain'
        AND decision.reason_kind = NEW.review_reason_kind
        AND decision.reason = NEW.review_reason
        AND decision.retain_until = NEW.review_due_at
        AND decision.decided_by = NEW.reviewed_by
        AND decision.decided_at = NEW.reviewed_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.reviewed_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND (
      NEW.review_reason_kind = 'legal_requirement'
      OR julianday(NEW.review_due_at) <= julianday(NEW.retention_cap_due_at)
    )
  ) AND NOT (
    OLD.review_status = 'retained' AND NEW.review_status = 'pending'
    AND julianday(OLD.review_due_at) <= julianday(NEW.state_changed_at)
    AND NEW.review_due_at = NEW.state_changed_at
    AND NEW.state_changed_by = 'system:retention' AND NEW.state_changed_by_role = 'service'
    AND NEW.review_reason_kind IS NULL AND NEW.review_reason IS NULL
    AND NEW.reviewed_by IS NULL AND NEW.reviewed_at IS NULL
  ) AND NOT (
    OLD.review_status = 'pending' AND NEW.review_status = 'approved'
    AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
    AND NEW.state_changed_by = NEW.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.approved_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_retention_decisions AS decision
      WHERE decision.archive_id = NEW.id
        AND decision.org_id = NEW.org_id
        AND decision.beneficiary_id = NEW.beneficiary_id
        AND decision.decision = 'purge'
        AND decision.decided_by = NEW.approved_by
        AND decision.decided_at = NEW.approved_at
    )
    AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.approved_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id AND status = 'active'
    )
  ) AND NOT (
    OLD.review_status = 'approved' AND NEW.review_status = 'purged'
    AND NEW.purged_at IS NOT NULL
    AND NEW.state_changed_by = OLD.approved_by AND NEW.state_changed_by_role = 'admin'
    AND NEW.state_changed_at = NEW.purged_at
    AND EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
        AND purged_at IS NOT NULL
    )
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.review_status <> 'purged' AND (
    NEW.enc_name IS NOT OLD.enc_name OR NEW.enc_phone IS NOT OLD.enc_phone
    OR NEW.enc_account IS NOT OLD.enc_account OR NEW.enc_email IS NOT OLD.enc_email
    OR NEW.enc_birth_date IS NOT OLD.enc_birth_date OR NEW.enc_region IS NOT OLD.enc_region
    OR NEW.enc_emergency_contact IS NOT OLD.enc_emergency_contact
    OR NEW.enc_gender IS NOT OLD.enc_gender
  );
END;

CREATE TRIGGER participant_pii_retention_decisions_insert_guard
BEFORE INSERT ON participant_pii_retention_decisions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM participant_pii_archives AS archive
    WHERE archive.id = NEW.archive_id
      AND archive.beneficiary_id = NEW.beneficiary_id
      AND archive.org_id = NEW.org_id
      AND archive.review_status = 'pending'
  );
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS role_assignment
    JOIN users ON users.id = role_assignment.user_id
    WHERE role_assignment.user_id = NEW.decided_by
      AND role_assignment.org_id = NEW.org_id
      AND role_assignment.role = 'institution_admin'
      AND role_assignment.revoked_at IS NULL
      AND users.org_id = NEW.org_id
      AND users.active = 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.decision = 'retain' AND (
    julianday(NEW.retain_until) <= julianday(NEW.decided_at)
    OR (
      NEW.reason_kind <> 'legal_requirement'
      AND julianday(NEW.retain_until) > (
        SELECT julianday(retention_cap_due_at)
        FROM participant_pii_archives
        WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
      )
    )
  );
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  VALUES (NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
          NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL AND NEW.purge_due IS NOT NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NULL AND OLD.purge_due IS NOT NULL AND NEW.purge_due IS NULL
    AND NEW.enc_name IS NULL AND NEW.enc_phone IS NULL AND NEW.enc_account IS NULL
    AND NEW.purged_at IS NOT NULL AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii' AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at AND NEW.version = OLD.version + 1
  ) AND NOT (
    OLD.purged_at IS NOT NULL AND NEW.purge_due IS NULL AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL AND NEW.enc_phone IS NOT NULL AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL AND NEW.version = OLD.version + 1
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role IN ('admin', 'counselor'));
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.retention_changed_by
                    AND org_id = NEW.org_id AND active = 1 AND role = 'admin');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.retention_context_support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id AND status = 'active');
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT min(
      strftime('%Y-%m-%dT%H:%M:%fZ',
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id),
        '+' || (SELECT pii_purge_grace_days
                FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
      ),
      CASE strftime(
        '%m-%d',
        (SELECT closed_at FROM support_cases
         WHERE id = NEW.retention_context_support_case_id)
      )
        WHEN '02-29' THEN strftime('%Y-%m-%dT%H:%M:%fZ',
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years', '-1 day'
        )
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ',
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years'
        )
      END
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1
      FROM user_role_assignments AS role_assignment
      JOIN users ON users.id = role_assignment.user_id
      WHERE role_assignment.user_id = NEW.purged_by
        AND role_assignment.org_id = NEW.org_id
        AND role_assignment.role = 'institution_admin'
        AND role_assignment.revoked_at IS NULL
        AND users.org_id = NEW.org_id AND users.active = 1
    )
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND EXISTS (
    SELECT 1 FROM support_cases WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND min(
      julianday(OLD.purge_due),
      COALESCE(
        (
          SELECT julianday(retention_cap_due_at)
          FROM participant_pii_archives
          WHERE beneficiary_id = OLD.beneficiary_id AND org_id = OLD.org_id
        ),
        julianday(OLD.purge_due)
      )
    ) > julianday('now');
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id,
                         beneficiary_id, support_case_id, detail, created_at)
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER sessions_manual_submission_audit
AFTER INSERT ON sessions
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT session.org_id, session.submitted_by, users.role,
         'submit_manual_record', 'sessions', session.id,
         support_case.beneficiary_id, session.support_case_id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM sessions AS session
  JOIN support_cases AS support_case ON support_case.id = session.support_case_id
  JOIN users ON users.id = session.submitted_by
  WHERE session.id = NEW.id;
END;

CREATE TRIGGER support_case_assignees_insert_guard
BEFORE INSERT ON support_case_assignees
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users
    JOIN user_role_assignments AS practitioner_role
      ON practitioner_role.user_id = users.id
     AND practitioner_role.org_id = users.org_id
     AND practitioner_role.role = 'practitioner'
     AND practitioner_role.revoked_at IS NULL
    WHERE users.id = NEW.user_id
      AND users.org_id = NEW.org_id
      AND users.active = 1
      AND users.role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND creation_kind = 'subsequent'
  )
    AND NOT EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
    )
    AND (
      NEW.role <> 'primary'
      OR NEW.user_id <> (
        SELECT initial_assignee_user_id
        FROM support_cases
        WHERE id = NEW.support_case_id
      )
    );
END;

CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET enc_name = COALESCE((
           SELECT enc_name FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_name),
         enc_phone = COALESCE((
           SELECT enc_phone FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_phone),
         enc_account = COALESCE((
           SELECT enc_account FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_account),
         enc_email = COALESCE((
           SELECT enc_email FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_email),
         enc_birth_date = COALESCE((
           SELECT enc_birth_date FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_birth_date),
         enc_region = COALESCE((
           SELECT enc_region FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_region),
         enc_emergency_contact = COALESCE((
           SELECT enc_emergency_contact FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_emergency_contact),
         enc_gender = COALESCE((
           SELECT enc_gender FROM participant_pii_archives
           WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
             AND review_status <> 'purged'
         ), enc_gender),
         purge_due = NULL, version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NOT NULL;

  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT NEW.org_id, NEW.created_by_actor_id, users.role,
         'restore_archived_pii', 'participant_pii_archives', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users
  WHERE users.id = NEW.created_by_actor_id
    AND EXISTS (
      SELECT 1 FROM participant_pii_archives
      WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
        AND review_status <> 'purged'
    );

  DELETE FROM participant_pii_archives
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND review_status <> 'purged';
END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
  AND NOT EXISTS (
    SELECT 1 FROM support_cases AS active_case
    WHERE active_case.beneficiary_id = NEW.beneficiary_id
      AND active_case.org_id = NEW.org_id
      AND active_case.status = 'active'
  )
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = min(
           strftime('%Y-%m-%dT%H:%M:%fZ',
             NEW.closed_at,
             '+' || COALESCE(
               (SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = NEW.org_id),
               365
             ) || ' days'
           ),
           CASE strftime('%m-%d', NEW.closed_at)
             WHEN '02-29' THEN strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closed_at, '+5 years', '-1 day')
             ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.closed_at, '+5 years')
           END
         ),
         version = version + 1,
         retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NULL;
END;

CREATE TRIGGER team_memberships_end_guard
BEFORE UPDATE OF ended_at ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_membership_immutable')
  WHERE OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL;
END;

CREATE TRIGGER team_memberships_immutable_guard
BEFORE UPDATE OF id, org_id, team_id, user_id, added_by, joined_at
ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_membership_immutable');
END;

CREATE TRIGGER team_memberships_insert_guard
BEFORE INSERT ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = NEW.team_id
      AND org_id = NEW.org_id
      AND archived_at IS NULL
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS member_role
    JOIN users AS member ON member.id = member_role.user_id
    WHERE member_role.org_id = NEW.org_id
      AND member_role.user_id = NEW.user_id
      AND member_role.role = 'practitioner'
      AND member_role.revoked_at IS NULL
      AND member.org_id = NEW.org_id
      AND member.active = 1
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS grantor_role
    JOIN users AS grantor ON grantor.id = grantor_role.user_id
    WHERE grantor_role.org_id = NEW.org_id
      AND grantor_role.user_id = NEW.added_by
      AND grantor_role.role = 'institution_admin'
      AND grantor_role.revoked_at IS NULL
      AND grantor.org_id = NEW.org_id
      AND grantor.active = 1
  );
END;

CREATE TRIGGER team_memberships_no_delete
BEFORE DELETE ON team_memberships
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_memberships_are_append_only');
END;

CREATE TRIGGER team_supervisor_grants_immutable_guard
BEFORE UPDATE OF id, org_id, team_id, supervisor_user_id, granted_by, granted_at
ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grant_immutable');
END;

CREATE TRIGGER team_supervisor_grants_insert_guard
BEFORE INSERT ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = NEW.team_id
      AND org_id = NEW.org_id
      AND archived_at IS NULL
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.supervisor_user_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS grantor_role
    JOIN users AS grantor ON grantor.id = grantor_role.user_id
    WHERE grantor_role.org_id = NEW.org_id
      AND grantor_role.user_id = NEW.granted_by
      AND grantor_role.role = 'institution_admin'
      AND grantor_role.revoked_at IS NULL
      AND grantor.org_id = NEW.org_id
      AND grantor.active = 1
  );
END;

CREATE TRIGGER team_supervisor_grants_no_delete
BEFORE DELETE ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grants_are_append_only');
END;

CREATE TRIGGER team_supervisor_grants_revoke_guard
BEFORE UPDATE OF revoked_at ON team_supervisor_grants
BEGIN
  SELECT RAISE(ABORT, 'authorization_supervisor_grant_immutable')
  WHERE OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL;
END;

CREATE TRIGGER teams_archive_guard
BEFORE UPDATE OF archived_at ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_immutable')
  WHERE OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL;
END;

CREATE TRIGGER teams_immutable_guard
BEFORE UPDATE OF id, org_id, name, created_by, created_at ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_team_immutable');
END;

CREATE TRIGGER teams_insert_guard
BEFORE INSERT ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_role_assignments AS creator_role
    JOIN users AS creator ON creator.id = creator_role.user_id
    WHERE creator_role.org_id = NEW.org_id
      AND creator_role.user_id = NEW.created_by
      AND creator_role.role = 'institution_admin'
      AND creator_role.revoked_at IS NULL
      AND creator.org_id = NEW.org_id
      AND creator.active = 1
  );
END;

CREATE TRIGGER teams_no_delete
BEFORE DELETE ON teams
BEGIN
  SELECT RAISE(ABORT, 'authorization_teams_are_append_only');
END;

CREATE TRIGGER user_role_assignments_immutable_guard
BEFORE UPDATE OF id, org_id, user_id, role, source, granted_by, granted_at
ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignment_immutable');
END;

CREATE TRIGGER user_role_assignments_insert_guard
BEFORE INSERT ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id
      AND org_id = NEW.org_id
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NEW.source = 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.user_id
        AND org_id = NEW.org_id
        AND active = 1
        AND role IN ('admin', 'counselor')
    );

  SELECT RAISE(ABORT, 'authorization_scope_violation')
  WHERE NEW.source = 'manual'
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS grantor_role
      JOIN users AS grantor ON grantor.id = grantor_role.user_id
      WHERE grantor_role.org_id = NEW.org_id
        AND grantor_role.user_id = NEW.granted_by
        AND grantor_role.role = 'institution_admin'
        AND grantor_role.revoked_at IS NULL
        AND grantor.org_id = NEW.org_id
        AND grantor.active = 1
    );
END;

CREATE TRIGGER user_role_assignments_no_delete
BEFORE DELETE ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignments_are_append_only');
END;

CREATE TRIGGER user_role_assignments_revoke_guard
BEFORE UPDATE OF revoked_at ON user_role_assignments
BEGIN
  SELECT RAISE(ABORT, 'authorization_role_assignment_immutable')
  WHERE OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL;

  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE OLD.role IN ('institution_admin', 'institution_technical_admin')
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = OLD.role
        AND replacement.id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );
END;

CREATE TRIGGER users_last_required_roles_guard
BEFORE UPDATE OF active ON users
WHEN OLD.active = 1 AND NEW.active = 0
BEGIN
  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );

  SELECT RAISE(ABORT, 'last_required_institution_role')
  WHERE EXISTS (
    SELECT 1 FROM user_role_assignments
    WHERE org_id = OLD.org_id
      AND user_id = OLD.id
      AND role = 'institution_technical_admin'
      AND revoked_at IS NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM user_role_assignments AS replacement
      JOIN users AS replacement_user ON replacement_user.id = replacement.user_id
      WHERE replacement.org_id = OLD.org_id
        AND replacement.role = 'institution_technical_admin'
        AND replacement.user_id <> OLD.id
        AND replacement.revoked_at IS NULL
        AND replacement_user.org_id = OLD.org_id
        AND replacement_user.active = 1
    );
END;

CREATE TRIGGER users_seed_independent_roles_after_insert
AFTER INSERT ON users
WHEN NEW.role IN ('admin', 'counselor')
BEGIN
  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at)
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_technical_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at)
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'practitioner',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at)
  WHERE NEW.role = 'counselor';
END;

CREATE TRIGGER users_sync_independent_roles_after_role_update
AFTER UPDATE OF role ON users
WHEN NEW.role IS NOT OLD.role
BEGIN
  UPDATE user_role_assignments
  SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE org_id = NEW.org_id
    AND user_id = NEW.id
    AND source = 'legacy'
    AND revoked_at IS NULL;

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'institution_technical_admin',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'admin';

  INSERT INTO user_role_assignments (
    id, org_id, user_id, role, source, granted_by, granted_at
  )
  SELECT
    lower(hex(randomblob(16))),
    NEW.org_id,
    NEW.id,
    'practitioner',
    'legacy',
    NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.role = 'counselor';
END;

PRAGMA legacy_alter_table = OFF;
