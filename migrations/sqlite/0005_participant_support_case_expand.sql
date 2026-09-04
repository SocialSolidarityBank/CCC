-- ============================================================================
-- Migration 0005 — participant / SupportCase expand (runtime routes remain off)
--
-- This is an additive compatibility migration. It creates and deterministically
-- backfills the participant graph, but does not replace the legacy case graph;
-- 0006 performs that FK-on cutover. Every failure uses a fixed, content-free
-- error string so neither PII nor submitted record content can escape SQL.
-- ============================================================================

-- Organization-wide retention and IANA time-zone configuration. There is no
-- guessed default: canonical runtime writes fail until an explicit setting exists.
CREATE TABLE organization_settings (
  org_id                TEXT PRIMARY KEY,
  time_zone             TEXT NOT NULL
                          CHECK (
                            length(trim(time_zone)) BETWEEN 3 AND 255
                            AND time_zone NOT GLOB '*[^A-Za-z0-9_+./-]*'
                            AND (time_zone = 'UTC' OR instr(time_zone, '/') > 0)
                          ),
  pii_purge_grace_days  INTEGER NOT NULL
                          CHECK (pii_purge_grace_days BETWEEN 1 AND 3660),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE users ADD COLUMN time_zone TEXT
  CHECK (
    time_zone IS NULL OR (
      length(trim(time_zone)) BETWEEN 3 AND 255
      AND time_zone NOT GLOB '*[^A-Za-z0-9_+./-]*'
      AND (time_zone = 'UTC' OR instr(time_zone, '/') > 0)
    )
  );

-- A beneficiary is the permanent participant identity. `A` plus at least three digits is never reused
-- for another participant or case.
CREATE TABLE beneficiaries (
  id                   TEXT PRIMARY KEY
                       CHECK (id GLOB 'A[0-9][0-9][0-9]*' AND substr(id, 2) NOT GLOB '*[^0-9]*'),
  org_id               TEXT NOT NULL,
  initialization_state TEXT NOT NULL DEFAULT 'pending'
                       CHECK (initialization_state IN ('pending', 'complete')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_beneficiaries_org_initialization
  ON beneficiaries (org_id, initialization_state, id);

-- SupportCase is the canonical owner for records and AI provenance. A legacy
-- case has exactly one deterministic legacy-import SupportCase during expand.
CREATE TABLE support_cases (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  beneficiary_id           TEXT NOT NULL REFERENCES beneficiaries (id),
  legacy_case_id           TEXT UNIQUE,
  program_type             TEXT NOT NULL DEFAULT 'financial_support_v1',
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'closed')),
  intake_at                TEXT,
  consent_recording_at     TEXT,
  consent_text_ai_at       TEXT,
  closed_at                TEXT,
  closed_reason            TEXT,
  closed_by_actor_id       TEXT,
  extra                    TEXT,
  creation_kind            TEXT NOT NULL
                           CHECK (creation_kind IN ('legacy_import', 'initial', 'subsequent')),
  creation_submission_id   TEXT,
  creation_payload_hash    TEXT
                           CHECK (
                             creation_payload_hash IS NULL OR
                             (length(creation_payload_hash) = 64
                              AND creation_payload_hash NOT GLOB '*[^0-9a-f]*')
                           ),
  created_by_actor_id      TEXT,
  source_support_case_id   TEXT REFERENCES support_cases (id),
  initial_assignee_user_id TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (creation_kind IN ('legacy_import', 'initial')
      AND creation_submission_id IS NULL
      AND creation_payload_hash IS NULL
      AND created_by_actor_id IS NULL
      AND source_support_case_id IS NULL
      AND initial_assignee_user_id IS NULL)
    OR
    (creation_kind = 'subsequent'
      AND length(trim(creation_submission_id)) > 0
      AND creation_payload_hash IS NOT NULL
      AND length(trim(created_by_actor_id)) > 0
      AND length(trim(initial_assignee_user_id)) > 0)
  ),
  CHECK (
    (creation_kind = 'legacy_import' AND legacy_case_id IS NOT NULL)
    OR (creation_kind <> 'legacy_import' AND legacy_case_id IS NULL)
  ),
  CHECK (
    creation_kind = 'legacy_import'
    OR (status = 'active' AND closed_at IS NULL AND closed_reason IS NULL AND closed_by_actor_id IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL
     AND closed_by_actor_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_support_cases_one_initial_per_beneficiary
  ON support_cases (beneficiary_id) WHERE creation_kind = 'initial';
CREATE UNIQUE INDEX uq_support_cases_actor_submission
  ON support_cases (org_id, created_by_actor_id, creation_submission_id)
  WHERE creation_submission_id IS NOT NULL;
CREATE INDEX idx_support_cases_beneficiary_status
  ON support_cases (beneficiary_id, status, created_at DESC);

-- PII belongs to the beneficiary, not a case. Ciphertext is copied byte-for-byte
-- from legacy storage; this table never contains plaintext or retention context
-- that reveals a date/value in audit detail.
CREATE TABLE participant_pii_vault (
  beneficiary_id                    TEXT PRIMARY KEY REFERENCES beneficiaries (id),
  org_id                            TEXT NOT NULL,
  enc_name                          TEXT,
  enc_phone                         TEXT,
  enc_account                       TEXT,
  key_version                       INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  version                           INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  purge_due                         TEXT,
  purged_at                         TEXT,
  purged_by                         TEXT,
  purged_by_role                    TEXT CHECK (purged_by_role IN ('admin', 'service')),
  retention_changed_by              TEXT,
  retention_context_support_case_id TEXT REFERENCES support_cases (id),
  retention_change_kind             TEXT NOT NULL
                                    CHECK (retention_change_kind IN (
                                      'legacy_import', 'create',
                                      'schedule_pii_purge_due',
                                      'cancel_pii_purge_due', 'purge_pii',
                                      're_register_pii'
                                    )),
  retention_changed_at              TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (purged_at IS NULL AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (retention_change_kind = 'legacy_import' AND purged_at IS NOT NULL
      AND purged_by IS NULL AND purged_by_role IS NULL)
    OR
    (purged_at IS NOT NULL AND purged_by IS NOT NULL AND purged_by_role IN ('admin', 'service'))
  ),
  CHECK (
    retention_change_kind = 'legacy_import'
    OR purged_at IS NULL
    OR (enc_name IS NULL AND enc_phone IS NULL AND enc_account IS NULL)
  )
);
CREATE INDEX idx_participant_pii_vault_due
  ON participant_pii_vault (purge_due) WHERE purged_at IS NULL AND purge_due IS NOT NULL;

CREATE TABLE support_case_assignees (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'primary'
                  CHECK (role IN ('primary', 'secondary')),
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at   TEXT
);
CREATE UNIQUE INDEX uq_support_case_assignees_active
  ON support_case_assignees (support_case_id, user_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_support_case_assignees_user
  ON support_case_assignees (user_id) WHERE unassigned_at IS NULL;

CREATE TABLE counseling_schedules (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  scheduled_at          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_session_id  TEXT,
  created_by_actor_id   TEXT NOT NULL,
  updated_by_actor_id   TEXT,
  completed_by_actor_id TEXT,
  completed_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (status IN ('scheduled', 'cancelled', 'no_show') AND completed_session_id IS NULL
      AND completed_by_actor_id IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND completed_session_id IS NOT NULL
      AND completed_by_actor_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX idx_counseling_schedules_support_case
  ON counseling_schedules (support_case_id, status, scheduled_at);

-- New audit provenance is additive during expand. 0006 rewrites legacy audit
-- rows into these fields without issuing UPDATE against append-only audit_log.
ALTER TABLE audit_log ADD COLUMN beneficiary_id TEXT;
ALTER TABLE audit_log ADD COLUMN support_case_id TEXT;

-- Deterministic legacy backfill. These INSERTs run before runtime guards so a
-- historical row may be complete/legacy_import without fabricating actors,
-- submissions, receipts, approvals, hashes, or PII retention provenance.
INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
SELECT id, org_id, 'complete', created_at, updated_at
FROM cases;

INSERT INTO support_cases (
  id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
  consent_recording_at, consent_text_ai_at, closed_at, closed_reason,
  closed_by_actor_id, extra, creation_kind, creation_submission_id,
  creation_payload_hash, created_by_actor_id, source_support_case_id,
  initial_assignee_user_id, created_at, updated_at
)
SELECT
  'legacy-support-case:' || id, org_id, id, id, program_type, status, intake_at,
  consent_recording_at, consent_text_ai_at, closed_at, closed_reason,
  NULL, extra, 'legacy_import', NULL, NULL, NULL, NULL, NULL, created_at, updated_at
FROM cases;

INSERT INTO participant_pii_vault (
  beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
  purge_due, purged_at, purged_by, purged_by_role, retention_changed_by,
  retention_context_support_case_id, retention_change_kind, retention_changed_at,
  created_at, updated_at
)
SELECT
  vault.case_id, vault.org_id, vault.enc_name, vault.enc_phone, vault.enc_account,
  vault.key_version, 1, legacy_case.purge_due, vault.purged_at, NULL, NULL, NULL,
  NULL, 'legacy_import', vault.updated_at, vault.created_at, vault.updated_at
FROM pii_vault AS vault
JOIN cases AS legacy_case ON legacy_case.id = vault.case_id;

INSERT INTO support_case_assignees (
  id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
)
SELECT
  assignee.id, assignee.org_id, support_case.id, assignee.user_id, assignee.role,
  assignee.assigned_at, assignee.unassigned_at
FROM case_assignees AS assignee
JOIN support_cases AS support_case
  ON support_case.legacy_case_id = assignee.case_id;

-- Runtime guards are installed only after the historical copy has completed.
CREATE TRIGGER beneficiaries_insert_pending_guard
BEFORE INSERT ON beneficiaries
WHEN NEW.initialization_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
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

CREATE TRIGGER support_cases_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'initial' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND initialization_state = 'pending'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND initialization_state = 'complete'
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NOT EXISTS (
    SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent' AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_actor_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.initial_assignee_user_id
        AND org_id = NEW.org_id
        AND active = 1
        AND role IN ('admin', 'counselor')
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'counselor'
    AND (
      NEW.source_support_case_id IS NULL
      OR NEW.initial_assignee_user_id <> NEW.created_by_actor_id
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind = 'subsequent'
    AND (SELECT role FROM users WHERE id = NEW.created_by_actor_id) = 'admin'
    AND NEW.source_support_case_id IS NOT NULL;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.source_support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases AS source_case
    WHERE source_case.id = NEW.source_support_case_id
      AND source_case.org_id = NEW.org_id
      AND source_case.beneficiary_id = NEW.beneficiary_id
  );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.creation_kind IN ('initial', 'subsequent') AND NEW.status <> 'active';
END;

CREATE TRIGGER support_cases_immutable_identity_guard
BEFORE UPDATE OF id, org_id, beneficiary_id, legacy_case_id, creation_kind,
                 creation_submission_id, creation_payload_hash, created_by_actor_id,
                 source_support_case_id, initial_assignee_user_id ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER support_cases_close_guard
BEFORE UPDATE OF status, closed_at, closed_reason, closed_by_actor_id ON support_cases
WHEN NEW.status IS NOT OLD.status
  OR NEW.closed_at IS NOT OLD.closed_at
  OR NEW.closed_reason IS NOT OLD.closed_reason
  OR NEW.closed_by_actor_id IS NOT OLD.closed_by_actor_id
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.status <> 'active' OR NEW.status <> 'closed'
     OR NEW.closed_at IS NULL OR NEW.closed_reason IS NULL OR NEW.closed_by_actor_id IS NULL;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.closed_by_actor_id
      AND org_id = NEW.org_id
      AND active = 1
      AND role IN ('admin', 'counselor')
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
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND creation_kind = 'subsequent'
  )
    AND NEW.role = 'primary'
    AND EXISTS (
      SELECT 1 FROM support_case_assignees
      WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND creation_kind = 'subsequent'
      AND NOT EXISTS (
        SELECT 1 FROM support_case_assignees
        WHERE support_case_id = NEW.support_case_id AND unassigned_at IS NULL
      )
    )
    AND (NEW.role <> 'primary' OR NEW.user_id <> (
      SELECT initial_assignee_user_id FROM support_cases WHERE id = NEW.support_case_id
    ));
END;

CREATE TRIGGER support_case_assignees_unassign_guard
BEFORE UPDATE OF id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
ON support_case_assignees
WHEN NEW.id IS NOT OLD.id
  OR NEW.org_id IS NOT OLD.org_id
  OR NEW.support_case_id IS NOT OLD.support_case_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.role IS NOT OLD.role
  OR NEW.assigned_at IS NOT OLD.assigned_at
  OR OLD.unassigned_at IS NOT NULL
  OR NEW.unassigned_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER counseling_schedules_insert_guard
BEFORE INSERT ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_actor_id AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

CREATE TRIGGER counseling_schedules_update_guard
BEFORE UPDATE ON counseling_schedules
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.org_id IS NOT OLD.org_id
     OR NEW.beneficiary_id IS NOT OLD.beneficiary_id
     OR NEW.support_case_id IS NOT OLD.support_case_id
     OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
     OR NEW.version <> OLD.version + 1;
END;

CREATE TRIGGER participant_pii_vault_insert_guard
BEFORE INSERT ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind <> 'create';
END;

CREATE TRIGGER participant_pii_vault_retention_guard
BEFORE UPDATE OF purge_due, purged_at, purged_by, purged_by_role,
                 retention_changed_by, retention_context_support_case_id,
                 retention_change_kind, retention_changed_at ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT (
    OLD.purge_due IS NULL
    AND NEW.purge_due IS NOT NULL
    AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purge_due IS NOT NULL
    AND NEW.purge_due IS NULL
    AND NEW.purged_at IS NULL
    AND NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purged_at IS NULL
    AND OLD.purge_due IS NOT NULL
    AND NEW.purge_due IS OLD.purge_due
    AND NEW.purged_at IS NOT NULL
    AND NEW.purged_by IS NOT NULL
    AND NEW.purged_by_role IN ('admin', 'service')
    AND NEW.retention_change_kind = 'purge_pii'
    AND NEW.retention_changed_by = NEW.purged_by
    AND NEW.retention_changed_at = NEW.purged_at
    AND NEW.version = OLD.version + 1
  )
  AND NOT (
    OLD.purged_at IS NOT NULL
    AND NEW.purge_due IS NULL
    AND NEW.purged_at IS NULL
    AND NEW.purged_by IS NULL
    AND NEW.purged_by_role IS NULL
    AND NEW.enc_name IS NOT NULL
    AND NEW.enc_phone IS NOT NULL
    AND NEW.enc_account IS NOT NULL
    AND NEW.key_version >= OLD.key_version
    AND NEW.retention_change_kind = 're_register_pii'
    AND NEW.retention_changed_by IS NOT NULL
    AND NEW.retention_context_support_case_id IS NOT NULL
    AND NEW.retention_changed_at IS NOT NULL
    AND NEW.version = OLD.version + 1
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.retention_changed_by AND org_id = NEW.org_id
        AND active = 1 AND role IN ('admin', 'counselor')
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.retention_changed_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind IN ('schedule_pii_purge_due', 'cancel_pii_purge_due')
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 're_register_pii'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
        AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'schedule_pii_purge_due'
    AND NEW.purge_due IS NOT datetime(
      (SELECT closed_at FROM support_cases
       WHERE id = NEW.retention_context_support_case_id),
      '+' || (SELECT pii_purge_grace_days
              FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'cancel_pii_purge_due'
    AND NOT EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.retention_context_support_case_id AND status = 'active'
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii' AND NOT (
    (NEW.purged_by_role = 'admin' AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.purged_by AND org_id = NEW.org_id
        AND active = 1 AND role = 'admin'
    ))
    OR
    (NEW.purged_by_role = 'service' AND NEW.purged_by = 'system:purge')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE beneficiary_id = NEW.beneficiary_id AND status <> 'closed'
    );
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.retention_change_kind = 'purge_pii'
    AND OLD.purge_due > datetime('now');
END;

CREATE TRIGGER participant_pii_vault_no_revive_guard
BEFORE UPDATE ON participant_pii_vault
WHEN OLD.purged_at IS NOT NULL AND NEW.retention_change_kind <> 're_register_pii'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER support_cases_schedule_pii_purge_due
AFTER UPDATE OF status ON support_cases
WHEN OLD.status = 'active' AND NEW.status = 'closed'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE EXISTS (
    SELECT 1 FROM participant_pii_vault
    WHERE beneficiary_id = NEW.beneficiary_id AND purged_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM organization_settings WHERE org_id = NEW.org_id
  );

  UPDATE participant_pii_vault
     SET purge_due = datetime(
           NEW.closed_at,
           '+' || (SELECT pii_purge_grace_days
                   FROM organization_settings WHERE org_id = NEW.org_id) || ' days'
         ),
         version = version + 1,
         retention_changed_by = NEW.closed_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'schedule_pii_purge_due',
         retention_changed_at = NEW.closed_at,
         updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id
     AND purged_at IS NULL
     AND purge_due IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM support_cases
       WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
     );
END;

CREATE TRIGGER support_cases_cancel_pii_purge_due
AFTER INSERT ON support_cases
WHEN NEW.creation_kind = 'subsequent'
BEGIN
  UPDATE participant_pii_vault
     SET purge_due = NULL,
         version = version + 1,
         retention_changed_by = NEW.created_by_actor_id,
         retention_context_support_case_id = NEW.id,
         retention_change_kind = 'cancel_pii_purge_due',
         retention_changed_at = NEW.created_at,
         updated_at = datetime('now')
   WHERE beneficiary_id = NEW.beneficiary_id
     AND purged_at IS NULL
     AND purge_due IS NOT NULL;
END;

CREATE TRIGGER participant_pii_vault_schedule_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'schedule_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'schedule_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"all_support_cases_closed"}'
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_cancel_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'cancel_pii_purge_due'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  SELECT NEW.org_id, NEW.retention_changed_by, users.role,
         'cancel_pii_purge_due', 'participant_pii_vault', NEW.beneficiary_id,
         NEW.beneficiary_id, NEW.retention_context_support_case_id,
         '{"reason":"support_case_created"}'
  FROM users WHERE users.id = NEW.retention_changed_by;
END;

CREATE TRIGGER participant_pii_vault_purge_audit
AFTER UPDATE ON participant_pii_vault
WHEN NEW.retention_change_kind = 'purge_pii'
 AND OLD.retention_change_kind IS NOT NEW.retention_change_kind
BEGIN
  INSERT INTO audit_log (
    org_id, actor_id, actor_role, action, target_table, target_id,
    beneficiary_id, support_case_id, detail
  )
  VALUES (
    NEW.org_id, NEW.purged_by, NEW.purged_by_role, 'purge_pii', 'participant_pii_vault',
    NEW.beneficiary_id, NEW.beneficiary_id, NULL, NULL
  );
END;

CREATE TRIGGER audit_log_participant_provenance_guard
BEFORE INSERT ON audit_log
WHEN NEW.beneficiary_id IS NOT NULL
  OR NEW.support_case_id IS NOT NULL
  OR NEW.action IN ('purge_pii_noop', 'reveal_participant_pii')
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.beneficiary_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM beneficiaries
    WHERE id = NEW.beneficiary_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.support_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'purge_pii_noop' AND NOT (
    NEW.target_table = 'participant_pii_vault'
    AND NEW.target_id = NEW.beneficiary_id
    AND NEW.support_case_id IS NULL
    AND NEW.detail = '{"reason":"not_eligible_or_already_purged"}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id AND active = 1 AND role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM participant_pii_vault
      WHERE beneficiary_id = NEW.beneficiary_id
        AND (
          purged_at IS NOT NULL
          OR purge_due IS NULL
          OR purge_due > datetime('now')
          OR EXISTS (
            SELECT 1 FROM support_cases
            WHERE beneficiary_id = NEW.beneficiary_id AND status = 'active'
          )
        )
    )
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.action = 'reveal_participant_pii' AND NOT (
    NEW.target_table = 'participant_pii_vault'
    AND NEW.target_id = NEW.beneficiary_id
    AND NEW.detail = '{"purpose":"active_support_case_counseling","fields":["name","phone","account"]}'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.actor_id AND org_id = NEW.org_id AND active = 1 AND role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM support_cases
      WHERE id = NEW.support_case_id
        AND org_id = NEW.org_id
        AND beneficiary_id = NEW.beneficiary_id
        AND status = 'active'
    )
  );
END;
