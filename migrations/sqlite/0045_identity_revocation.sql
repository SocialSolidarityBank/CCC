-- Migration 0045 - E4-1 canonical Identity storage and append-only revocation.
--
-- Access currently identifies people by email/common_name. Local accounts and Supabase Auth need a
-- stable user row without a required email, so users.email becomes nullable and auth_subject is the
-- nullable external-auth key. Existing rows and D74 authorization behavior are preserved.
--
-- SQLite has no ALTER COLUMN DROP NOT NULL. The five-table D74 identity component is rebuilt inside
-- one deferred-foreign-key transaction. Only triggers that reference this component are dropped, then
-- recreated from the exact schema produced by migrations 0001-0044. Contract tests compare their SQL
-- before/after, preserve linked rows, and run foreign_key_check.

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER audit_log_participant_provenance_guard;
DROP TRIGGER counseling_schedules_insert_guard;
DROP TRIGGER goal_revisions_insert_guard;
DROP TRIGGER participant_consent_records_insert_guard;
DROP TRIGGER participant_pii_archives_update_guard;
DROP TRIGGER participant_pii_retention_decisions_insert_guard;
DROP TRIGGER participant_pii_vault_cancel_audit;
DROP TRIGGER participant_pii_vault_retention_guard;
DROP TRIGGER participant_pii_vault_schedule_audit;
DROP TRIGGER schedule_custom_questions_insert_guard;
DROP TRIGGER schedule_session_goals_insert_guard;
DROP TRIGGER sessions_manual_submission_audit;
DROP TRIGGER sessions_manual_submission_guard;
DROP TRIGGER support_case_assignees_insert_guard;
DROP TRIGGER support_cases_cancel_pii_purge_due;
DROP TRIGGER support_cases_close_guard;
DROP TRIGGER support_cases_insert_guard;
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

CREATE TABLE users_identity_next (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  email             TEXT,
  role              TEXT NOT NULL CHECK (role IN ('admin', 'counselor', 'service')),
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  time_zone         TEXT CHECK (
                      time_zone IS NULL OR (
                        length(trim(time_zone)) BETWEEN 3 AND 255
                        AND time_zone NOT GLOB '*[^A-Za-z0-9_+./-]*'
                        AND (time_zone = 'UTC' OR instr(time_zone, '/') > 0)
                      )
                    ),
  name              TEXT,
  last_program_type TEXT,
  auth_subject      TEXT CHECK (auth_subject IS NULL OR length(trim(auth_subject)) > 0)
);

CREATE TABLE user_role_assignments_identity_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users_identity_next (id),
  role       TEXT NOT NULL CHECK (role IN (
               'institution_admin',
               'institution_technical_admin',
               'practitioner'
             )),
  source     TEXT NOT NULL CHECK (source IN ('legacy', 'manual')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  CHECK (
    (source = 'legacy' AND granted_by IS NULL)
    OR
    (source = 'manual' AND granted_by IS NOT NULL)
  )
);

CREATE TABLE teams_identity_next (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by  TEXT NOT NULL REFERENCES users_identity_next (id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE team_memberships_identity_next (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  team_id    TEXT NOT NULL REFERENCES teams_identity_next (id),
  user_id    TEXT NOT NULL REFERENCES users_identity_next (id),
  added_by   TEXT NOT NULL REFERENCES users_identity_next (id),
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

CREATE TABLE team_supervisor_grants_identity_next (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  team_id            TEXT NOT NULL REFERENCES teams_identity_next (id),
  supervisor_user_id TEXT NOT NULL REFERENCES users_identity_next (id),
  granted_by         TEXT NOT NULL REFERENCES users_identity_next (id),
  granted_at         TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at         TEXT
);

INSERT INTO users_identity_next (id, org_id, email, role, active, created_at, time_zone, name, last_program_type, auth_subject)
SELECT id, org_id, email, role, active, created_at, time_zone, name, last_program_type, NULL FROM users;

INSERT INTO user_role_assignments_identity_next (id, org_id, user_id, role, source, granted_by, granted_at, revoked_at)
SELECT id, org_id, user_id, role, source, granted_by, granted_at, revoked_at FROM user_role_assignments;

INSERT INTO teams_identity_next (id, org_id, name, created_by, created_at, archived_at)
SELECT id, org_id, name, created_by, created_at, archived_at FROM teams;

INSERT INTO team_memberships_identity_next (id, org_id, team_id, user_id, added_by, joined_at, ended_at)
SELECT id, org_id, team_id, user_id, added_by, joined_at, ended_at FROM team_memberships;

INSERT INTO team_supervisor_grants_identity_next (id, org_id, team_id, supervisor_user_id, granted_by, granted_at, revoked_at)
SELECT id, org_id, team_id, supervisor_user_id, granted_by, granted_at, revoked_at FROM team_supervisor_grants;

DROP TABLE team_memberships;
DROP TABLE team_supervisor_grants;
DROP TABLE teams;
DROP TABLE user_role_assignments;
DROP TABLE users;

ALTER TABLE users_identity_next RENAME TO users;
ALTER TABLE user_role_assignments_identity_next RENAME TO user_role_assignments;
ALTER TABLE teams_identity_next RENAME TO teams;
ALTER TABLE team_memberships_identity_next RENAME TO team_memberships;
ALTER TABLE team_supervisor_grants_identity_next RENAME TO team_supervisor_grants;

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

CREATE INDEX idx_users_org ON users (org_id, active);

CREATE UNIQUE INDEX uq_team_memberships_active
  ON team_memberships (org_id, team_id, user_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX uq_team_supervisor_grants_active
  ON team_supervisor_grants (org_id, team_id, supervisor_user_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_user_role_assignments_active
  ON user_role_assignments (org_id, user_id, role)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_users_email
  ON users (email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_users_auth_subject
  ON users (auth_subject)
  WHERE auth_subject IS NOT NULL;

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
                  OR purge_due > datetime('now')
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

CREATE TRIGGER counseling_schedules_insert_guard
BEFORE INSERT ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM support_cases
                    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
                      AND beneficiary_id = NEW.beneficiary_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM users
                    WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
                      AND active = 1 AND role IN ('admin', 'counselor'));
END;

CREATE TRIGGER goal_revisions_insert_guard
BEFORE INSERT ON goal_revisions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.goal_id IS NOT NULL
    AND (
      NEW.title IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM goals
        WHERE id = NEW.goal_id
          AND org_id = NEW.org_id
          AND support_case_id = NEW.support_case_id
      )
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.edited_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
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
         '{"reason":"support_case_created"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
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
      datetime(
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
        WHEN '02-29' THEN datetime(
          (SELECT closed_at FROM support_cases
           WHERE id = NEW.retention_context_support_case_id),
          '+5 years', '-1 day'
        )
        ELSE datetime(
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
         '{"reason":"all_support_cases_closed"}', datetime('now')
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER schedule_custom_questions_insert_guard
BEFORE INSERT ON schedule_custom_questions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER schedule_session_goals_insert_guard
BEFORE INSERT ON schedule_session_goals
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.case_goal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM goals
      WHERE id = NEW.case_goal_id
        AND org_id = NEW.org_id
        AND support_case_id = NEW.support_case_id
        AND status = 'active'
    );
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
         support_case.beneficiary_id, session.support_case_id, NULL, datetime('now')
  FROM sessions AS session
  JOIN support_cases AS support_case ON support_case.id = session.support_case_id
  JOIN users ON users.id = session.submitted_by
  WHERE session.id = NEW.id;
END;

CREATE TRIGGER sessions_manual_submission_guard
BEFORE INSERT ON sessions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.submission_id IS NULL OR NEW.submission_hash IS NULL OR NEW.submitted_by IS NULL
     OR NEW.counselor_id <> NEW.submitted_by;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases AS support_case
    JOIN beneficiaries AS beneficiary ON beneficiary.id = support_case.beneficiary_id
    WHERE support_case.id = NEW.support_case_id
      AND support_case.org_id = NEW.org_id
      AND support_case.status = 'active'
      AND beneficiary.initialization_state = 'complete'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.submitted_by
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.submitted_by AND role = 'admin'
  )
    AND NOT EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id
        AND user_id = NEW.submitted_by
        AND unassigned_at IS NULL
    );
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
         retention_changed_at = NEW.created_at, updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id AND org_id = NEW.org_id
     AND purged_at IS NULL AND purge_due IS NOT NULL;

  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail, created_at
  )
  SELECT NEW.org_id, NEW.created_by_actor_id, users.role,
         'restore_archived_pii', 'participant_pii_archives', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.id, NULL, datetime('now')
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

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed' OR NEW.closed_at IS NULL
     OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.closed_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER support_cases_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'legacy_import';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM beneficiaries
                    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'initial' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'pending'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries WHERE id = NEW.beneficiary_id AND initialization_state = 'complete'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.initial_assignee_user_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND (NEW.source_support_case_id IS NULL OR NEW.initial_assignee_user_id <> NEW.created_by_actor_id);
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'admin'
    AND NEW.source_support_case_id IS NOT NULL;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases AS source_case
    WHERE source_case.id = NEW.source_support_case_id AND source_case.org_id = NEW.org_id
      AND source_case.beneficiary_id = NEW.beneficiary_id
      AND source_case.status = 'active'
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND NOT EXISTS (
      SELECT 1
      FROM support_cases AS source_case
      JOIN support_case_assignees AS assignment
        ON assignment.support_case_id = source_case.id
       AND assignment.org_id = source_case.org_id
      WHERE source_case.id = NEW.source_support_case_id
        AND source_case.org_id = NEW.org_id
        AND source_case.beneficiary_id = NEW.beneficiary_id
        AND source_case.status = 'active'
        AND assignment.user_id = NEW.created_by_actor_id
        AND assignment.unassigned_at IS NULL
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NEW.status <> 'active';
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
    NEW.created_at
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
    NEW.created_at
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
    NEW.created_at
  WHERE NEW.role = 'counselor';
END;

CREATE TRIGGER users_sync_independent_roles_after_role_update
AFTER UPDATE OF role ON users
WHEN NEW.role IS NOT OLD.role
BEGIN
  UPDATE user_role_assignments
  SET revoked_at = datetime('now')
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
    datetime('now')
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
    datetime('now')
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
    datetime('now')
  WHERE NEW.role = 'counselor';
END;

-- Identity adapters never write the following tables directly; packages/core gateway functions own writes.
CREATE TABLE auth_revocations (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('session', 'actor')),
  subject    TEXT NOT NULL CHECK (length(trim(subject)) > 0),
  revoked_at TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'logout',
               'password-reset',
               'mfa-reset',
               'admin-disable',
               'pairing-revoked',
               'security-event'
             ))
);

CREATE INDEX idx_auth_revocations_subject
  ON auth_revocations (kind, subject, revoked_at);

CREATE TRIGGER auth_revocations_no_update
BEFORE UPDATE ON auth_revocations
BEGIN
  SELECT RAISE(ABORT, 'auth_revocations_are_append_only');
END;

CREATE TRIGGER auth_revocations_no_delete
BEFORE DELETE ON auth_revocations
BEGIN
  SELECT RAISE(ABORT, 'auth_revocations_are_append_only');
END;

CREATE TABLE agent_installations (
  installation_id TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  actor_user_id    TEXT NOT NULL REFERENCES users (id),
  paired_at        TEXT NOT NULL,
  revoked_at       TEXT
);

CREATE INDEX idx_agent_installations_actor
  ON agent_installations (org_id, actor_user_id, revoked_at);

CREATE TRIGGER agent_installations_insert_guard
BEFORE INSERT ON agent_installations
BEGIN
  SELECT RAISE(ABORT, 'agent_installation_identity_mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.actor_user_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role = 'service'
  );
END;

CREATE TRIGGER agent_installations_identity_immutable
BEFORE UPDATE OF installation_id, org_id, actor_user_id, paired_at ON agent_installations
BEGIN
  SELECT RAISE(ABORT, 'agent_installation_identity_immutable');
END;

CREATE TRIGGER agent_installations_revocation_guard
BEFORE UPDATE OF revoked_at ON agent_installations
WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'agent_installation_revocation_immutable');
END;

CREATE TRIGGER agent_installations_no_delete
BEFORE DELETE ON agent_installations
BEGIN
  SELECT RAISE(ABORT, 'agent_installations_are_append_only');
END;
