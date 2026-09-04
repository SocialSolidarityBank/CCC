-- E3-2 / S1 logical pair for SQLite 0046_sql_portability.sql.
-- Applies after PostgreSQL 0001_baseline.sql, which E3-4 owns.

ALTER TABLE support_cases ADD COLUMN operation_marker text;
ALTER TABLE support_case_assignees ADD COLUMN operation_marker text;
ALTER TABLE participant_pii_vault ADD COLUMN operation_marker text;
ALTER TABLE counseling_schedules ADD COLUMN operation_marker text;
ALTER TABLE sessions ADD COLUMN operation_marker text;
ALTER TABLE action_items ADD COLUMN operation_marker text;
ALTER TABLE invite_tokens ADD COLUMN consumption_id text;

CREATE UNIQUE INDEX uq_support_cases_operation_marker ON support_cases (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_support_case_assignees_operation_marker ON support_case_assignees (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_participant_pii_vault_operation_marker ON participant_pii_vault (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_counseling_schedules_operation_marker ON counseling_schedules (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_sessions_operation_marker ON sessions (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_action_items_operation_marker ON action_items (operation_marker) WHERE operation_marker IS NOT NULL;
CREATE UNIQUE INDEX uq_invite_tokens_consumption_id ON invite_tokens (consumption_id) WHERE consumption_id IS NOT NULL;


ALTER TABLE ai_evidence_links ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE ai_provider_activations ALTER COLUMN activated_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE ai_provider_configs ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE ai_review_events ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE audit_log ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE beneficiaries ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE beneficiaries ALTER COLUMN updated_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE invite_tokens ALTER COLUMN issued_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE organization_settings ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE organization_settings ALTER COLUMN updated_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE participant_consent_records ALTER COLUMN recorded_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE participant_consent_records ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE participant_support_case_cutover_manifest ALTER COLUMN completed_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE schedule_custom_questions ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE schedule_session_goals ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE session_life_area_snapshots ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE team_memberships ALTER COLUMN joined_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE team_supervisor_grants ALTER COLUMN granted_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE teams ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE user_role_assignments ALTER COLUMN granted_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

ALTER TABLE users ALTER COLUMN created_at SET DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');


-- E3-4 baseline trigger functions must write the same UTC ISO text expression; guard:migration-parity verifies the live catalog.
