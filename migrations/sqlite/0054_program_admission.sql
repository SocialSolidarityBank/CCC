-- D87 program admission schema. Legacy rows are linked to an unconfirmed,
-- undecided deterministic program; no production data is confirmed by migration.
PRAGMA foreign_keys = ON;

CREATE TABLE programs (
  id                                      TEXT PRIMARY KEY NOT NULL,
  org_id                                  TEXT NOT NULL,
  display_name                            TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 120),
  status                                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  program_type                            TEXT NOT NULL DEFAULT 'financial_support_v1'
                                            CHECK (program_type IN ('financial_support_v1')),
  storage_mode                            TEXT NOT NULL DEFAULT 'undecided'
                                            CHECK (storage_mode IN ('supabase_seoul', 'naver_public', 'local_encrypted', 'undecided')),
  processing_mode                         TEXT NOT NULL DEFAULT 'undecided'
                                            CHECK (processing_mode IN ('external_allowed', 'internal_only', 'undecided')),
  version                                 INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  admission_confirmed_by                  TEXT,
  admission_confirmed_at                  TEXT,
  admission_confirmed_storage_mode        TEXT CHECK (admission_confirmed_storage_mode IS NULL OR admission_confirmed_storage_mode IN ('supabase_seoul', 'naver_public', 'local_encrypted')),
  admission_confirmed_processing_mode     TEXT CHECK (admission_confirmed_processing_mode IS NULL OR admission_confirmed_processing_mode IN ('external_allowed', 'internal_only')),
  admission_copy_version                  TEXT CHECK (admission_copy_version IS NULL OR length(trim(admission_copy_version)) > 0),
  admission_copy_hash                     TEXT CHECK (admission_copy_hash IS NULL OR (length(admission_copy_hash) = 64 AND admission_copy_hash NOT GLOB '*[^0-9a-f]*')),
  admission_installation_config_hash      TEXT CHECK (admission_installation_config_hash IS NULL OR (length(admission_installation_config_hash) = 64 AND admission_installation_config_hash NOT GLOB '*[^0-9a-f]*')),
  admission_installation_policy_version   INTEGER CHECK (admission_installation_policy_version IS NULL OR admission_installation_policy_version > 0),
  created_at                              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, org_id),
  CHECK (
    (admission_confirmed_by IS NULL
      AND admission_confirmed_at IS NULL
      AND admission_confirmed_storage_mode IS NULL
      AND admission_confirmed_processing_mode IS NULL
      AND admission_copy_version IS NULL
      AND admission_copy_hash IS NULL
      AND admission_installation_config_hash IS NULL
      AND admission_installation_policy_version IS NULL)
    OR
    (length(trim(admission_confirmed_by)) > 0
      AND admission_confirmed_by IS NOT NULL
      AND length(trim(admission_confirmed_at)) > 0
      AND admission_confirmed_at IS NOT NULL
      AND admission_confirmed_storage_mode IS NOT NULL
      AND admission_confirmed_processing_mode IS NOT NULL
      AND admission_copy_version IS NOT NULL
      AND admission_copy_hash IS NOT NULL
      AND admission_installation_config_hash IS NOT NULL
      AND admission_installation_policy_version IS NOT NULL)
  )
);
CREATE INDEX idx_programs_org ON programs (org_id, id);

CREATE UNIQUE INDEX idx_users_id_org ON users (id, org_id);
CREATE TABLE program_staff (
  org_id         TEXT NOT NULL,
  program_id     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  is_responsible INTEGER NOT NULL DEFAULT 0 CHECK (is_responsible IN (0, 1)),
  PRIMARY KEY (org_id, program_id, user_id),
  FOREIGN KEY (program_id, org_id) REFERENCES programs (id, org_id),
  FOREIGN KEY (user_id, org_id) REFERENCES users (id, org_id)
);

-- The installation policy is versioned independently of its values. This
-- closes the ABA hole where STT/LLM settings leave the same hash after a
-- change-and-restore sequence.
CREATE TABLE program_admission_policies (
  org_id       TEXT PRIMARY KEY NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  stt_mode     TEXT NOT NULL DEFAULT 'off' CHECK (stt_mode IN ('off', 'local', 'azure')),
  llm_mode     TEXT NOT NULL DEFAULT 'off' CHECK (llm_mode IN ('off', 'openai')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE program_admission_guards (
  id       TEXT PRIMARY KEY NOT NULL,
  org_id   TEXT NOT NULL,
  valid    INTEGER NOT NULL CONSTRAINT program_admission_required CHECK (valid = 1)
);

-- Preserve every organization represented by the old settings/case/invite
-- graph. A missing settings row has no display name, rather than an invented
-- business label.
WITH legacy_orgs AS (
  SELECT org_id, program_display_name FROM organization_settings
  UNION ALL
  SELECT org_id, NULL FROM support_cases
  UNION ALL
  SELECT org_id, NULL FROM invite_tokens
)
INSERT INTO programs (id, org_id, display_name, program_type, storage_mode, processing_mode, version)
SELECT 'legacy-program:' || org_id, org_id, MAX(program_display_name), 'financial_support_v1', 'undecided', 'undecided', 1
FROM legacy_orgs
GROUP BY org_id;
INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode)
SELECT org_id, 1, 'off', 'off' FROM programs GROUP BY org_id;
ALTER TABLE organization_settings ADD COLUMN initial_program_id TEXT;
UPDATE organization_settings
SET initial_program_id = 'legacy-program:' || org_id
WHERE initial_program_id IS NULL;
CREATE TRIGGER organization_settings_initial_program_insert
BEFORE INSERT ON organization_settings
WHEN NEW.initial_program_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.initial_program_id AND programs.org_id = NEW.org_id
  )
BEGIN
  SELECT RAISE(ABORT, 'organization_initial_program_invalid');
END;
CREATE TRIGGER organization_settings_initial_program_update
BEFORE UPDATE OF initial_program_id, org_id ON organization_settings
WHEN NEW.initial_program_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.initial_program_id AND programs.org_id = NEW.org_id
  )
BEGIN
  SELECT RAISE(ABORT, 'organization_initial_program_invalid');
END;

ALTER TABLE support_cases ADD COLUMN program_id TEXT;
UPDATE support_cases
SET program_id = 'legacy-program:' || org_id
WHERE program_id IS NULL;

ALTER TABLE invite_tokens ADD COLUMN program_id TEXT;
UPDATE invite_tokens
SET program_id = CASE WHEN kind = 'participant' THEN 'legacy-program:' || org_id ELSE NULL END
WHERE program_id IS NULL;

-- SQLite cannot add a composite FK without rebuilding these long-lived tables.
-- These fail-closed triggers provide the same required non-null and same-org
-- link invariant while preserving the historical table layout.
CREATE TRIGGER support_cases_program_required_insert
BEFORE INSERT ON support_cases
WHEN NEW.program_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
  )
BEGIN
  SELECT RAISE(ABORT, 'support_case_program_invalid');
END;
CREATE TRIGGER support_cases_program_required_update
BEFORE UPDATE OF program_id, org_id ON support_cases
WHEN NEW.program_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
  )
BEGIN
  SELECT RAISE(ABORT, 'support_case_program_invalid');
END;
CREATE TRIGGER support_cases_program_immutable
BEFORE UPDATE OF program_id ON support_cases
WHEN NEW.program_id IS NOT OLD.program_id
BEGIN
  SELECT RAISE(ABORT, 'support_case_program_immutable');
END;

CREATE TRIGGER invite_tokens_program_immutable
BEFORE UPDATE OF program_id ON invite_tokens
WHEN NEW.program_id IS NOT OLD.program_id
BEGIN
  SELECT RAISE(ABORT, 'invite_program_immutable');
END;

CREATE TRIGGER invite_tokens_program_scope_insert
BEFORE INSERT ON invite_tokens
WHEN (NEW.kind = 'participant' AND (
        NEW.program_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM programs
          WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
        )))
  OR (NEW.kind = 'counselor' AND NEW.program_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invite_program_invalid');
END;
CREATE TRIGGER invite_tokens_program_scope_update
BEFORE UPDATE OF program_id, kind, org_id ON invite_tokens
WHEN (NEW.kind = 'participant' AND (
        NEW.program_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM programs
          WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
        )))
  OR (NEW.kind = 'counselor' AND NEW.program_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'invite_program_invalid');
END;

-- Keep parent rows from being changed out from under the trigger-enforced
-- references. PostgreSQL's composite foreign keys provide the same RESTRICT
-- behavior.
CREATE TRIGGER programs_referenced_update
BEFORE UPDATE OF id, org_id ON programs
WHEN (NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id)
  AND (EXISTS (
    SELECT 1 FROM support_cases
    WHERE support_cases.program_id = OLD.id AND support_cases.org_id = OLD.org_id
  )
  OR EXISTS (
    SELECT 1 FROM invite_tokens
    WHERE invite_tokens.program_id = OLD.id AND invite_tokens.org_id = OLD.org_id
  )
  OR EXISTS (
    SELECT 1 FROM organization_settings
    WHERE organization_settings.initial_program_id = OLD.id AND organization_settings.org_id = OLD.org_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'program_referenced');
END;
CREATE TRIGGER programs_referenced_delete
BEFORE DELETE ON programs
WHEN EXISTS (
    SELECT 1 FROM support_cases
    WHERE support_cases.program_id = OLD.id AND support_cases.org_id = OLD.org_id
  )
  OR EXISTS (
    SELECT 1 FROM invite_tokens
    WHERE invite_tokens.program_id = OLD.id AND invite_tokens.org_id = OLD.org_id
  )
  OR EXISTS (
    SELECT 1 FROM organization_settings
    WHERE organization_settings.initial_program_id = OLD.id AND organization_settings.org_id = OLD.org_id
  )
BEGIN
  SELECT RAISE(ABORT, 'program_referenced');
END;
CREATE INDEX idx_support_cases_program ON support_cases (org_id, program_id);
CREATE INDEX idx_invite_tokens_program ON invite_tokens (org_id, program_id);
