-- D87 program admission schema. Legacy rows remain undecided and unconfirmed;
-- this migration never treats historical data as an institution confirmation.

CREATE TABLE programs (
  id                                    text PRIMARY KEY,
  org_id                                text NOT NULL,
  display_name                          text CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 120),
  status                                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  program_type                          text NOT NULL DEFAULT 'financial_support_v1'
                                          CHECK (program_type IN ('financial_support_v1')),
  storage_mode                          text NOT NULL DEFAULT 'undecided'
                                          CHECK (storage_mode IN ('supabase_seoul', 'naver_public', 'local_encrypted', 'undecided')),
  processing_mode                       text NOT NULL DEFAULT 'undecided'
                                          CHECK (processing_mode IN ('external_allowed', 'internal_only', 'undecided')),
  version                               bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  admission_confirmed_by                text,
  admission_confirmed_at                text,
  admission_confirmed_storage_mode      text CHECK (admission_confirmed_storage_mode IS NULL OR admission_confirmed_storage_mode IN ('supabase_seoul', 'naver_public', 'local_encrypted')),
  admission_confirmed_processing_mode   text CHECK (admission_confirmed_processing_mode IS NULL OR admission_confirmed_processing_mode IN ('external_allowed', 'internal_only')),
  admission_copy_version                text CHECK (admission_copy_version IS NULL OR length(trim(admission_copy_version)) > 0),
  admission_copy_hash                   text CHECK (admission_copy_hash IS NULL OR (length(admission_copy_hash) = 64 AND admission_copy_hash !~ '[^0-9a-f]')),
  admission_installation_config_hash    text CHECK (admission_installation_config_hash IS NULL OR (length(admission_installation_config_hash) = 64 AND admission_installation_config_hash !~ '[^0-9a-f]')),
  admission_installation_policy_version bigint CHECK (admission_installation_policy_version IS NULL OR admission_installation_policy_version > 0),
  created_at                            text NOT NULL DEFAULT ccc_iso_now(),
  updated_at                            text NOT NULL DEFAULT ccc_iso_now(),
  CONSTRAINT programs_id_org_unique UNIQUE (id, org_id),
  CONSTRAINT programs_admission_confirmation_all_or_none CHECK (
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
  org_id         text NOT NULL,
  program_id     text NOT NULL,
  user_id        text NOT NULL,
  is_responsible bigint NOT NULL DEFAULT 0 CHECK (is_responsible IN (0, 1)),
  PRIMARY KEY (org_id, program_id, user_id),
  FOREIGN KEY (program_id, org_id) REFERENCES programs (id, org_id),
  FOREIGN KEY (user_id, org_id) REFERENCES users (id, org_id)
);

-- Version is durable even when settings change away and back to the same
-- values, preventing an admission snapshot from surviving an ABA transition.
CREATE TABLE program_admission_policies (
  org_id     text PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  stt_mode   text NOT NULL DEFAULT 'off' CHECK (stt_mode IN ('off', 'local', 'azure')),
  llm_mode   text NOT NULL DEFAULT 'off' CHECK (llm_mode IN ('off', 'openai')),
  created_at text NOT NULL DEFAULT ccc_iso_now(),
  updated_at text NOT NULL DEFAULT ccc_iso_now()
);

CREATE TABLE program_admission_guards (
  id     text PRIMARY KEY,
  org_id text NOT NULL,
  valid  bigint NOT NULL CONSTRAINT program_admission_required CHECK (valid = 1)
);

WITH legacy_orgs AS (
  SELECT org_id, program_display_name FROM organization_settings
  UNION ALL
  SELECT org_id, NULL::text FROM support_cases
  UNION ALL
  SELECT org_id, NULL::text FROM invite_tokens
)
INSERT INTO programs (id, org_id, display_name, program_type, storage_mode, processing_mode, version)
SELECT 'legacy-program:' || org_id, org_id, max(program_display_name), 'financial_support_v1', 'undecided', 'undecided', 1
FROM legacy_orgs
GROUP BY org_id;
INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode)
SELECT org_id, 1, 'off', 'off' FROM programs GROUP BY org_id;
ALTER TABLE organization_settings ADD COLUMN initial_program_id text;
UPDATE organization_settings
SET initial_program_id = 'legacy-program:' || org_id
WHERE initial_program_id IS NULL;

ALTER TABLE support_cases ADD COLUMN program_id text;
UPDATE support_cases
SET program_id = 'legacy-program:' || org_id
WHERE program_id IS NULL;

ALTER TABLE invite_tokens ADD COLUMN program_id text;
UPDATE invite_tokens
SET program_id = CASE WHEN kind = 'participant' THEN 'legacy-program:' || org_id ELSE NULL END
WHERE program_id IS NULL;

CREATE INDEX idx_support_cases_program ON support_cases (org_id, program_id);
CREATE INDEX idx_invite_tokens_program ON invite_tokens (org_id, program_id);

-- New tenant tables are explicit because 0006's inventory predates them.
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_programs ON programs FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));

ALTER TABLE program_admission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_admission_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_program_admission_policies ON program_admission_policies FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));

ALTER TABLE program_admission_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_admission_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_program_admission_guards ON program_admission_guards FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));

ALTER TABLE program_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_staff FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_program_staff ON program_staff FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));

REVOKE ALL ON TABLE programs, program_staff, program_admission_policies, program_admission_guards FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE programs, program_staff, program_admission_policies, program_admission_guards TO ccc_api;
ALTER TABLE programs OWNER TO ccc_schema_owner;
ALTER TABLE program_admission_policies OWNER TO ccc_schema_owner;
ALTER TABLE program_admission_guards OWNER TO ccc_schema_owner;
ALTER TABLE program_staff OWNER TO ccc_schema_owner;

-- Trigger-enforced links match SQLite physical columns and logical invariants.
CREATE FUNCTION ccc_organization_settings_initial_program_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_program_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.initial_program_id AND programs.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='organization_initial_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_settings_initial_program_insert BEFORE INSERT ON organization_settings
FOR EACH ROW EXECUTE FUNCTION ccc_organization_settings_initial_program_insert();
REVOKE ALL ON FUNCTION ccc_organization_settings_initial_program_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_organization_settings_initial_program_insert() TO ccc_api;
ALTER FUNCTION ccc_organization_settings_initial_program_insert() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_organization_settings_initial_program_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_program_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.initial_program_id AND programs.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='organization_initial_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_settings_initial_program_update BEFORE UPDATE OF initial_program_id, org_id ON organization_settings
FOR EACH ROW EXECUTE FUNCTION ccc_organization_settings_initial_program_update();
REVOKE ALL ON FUNCTION ccc_organization_settings_initial_program_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_organization_settings_initial_program_update() TO ccc_api;
ALTER FUNCTION ccc_organization_settings_initial_program_update() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_support_cases_program_required_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.program_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='support_case_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_program_required_insert BEFORE INSERT ON support_cases
FOR EACH ROW EXECUTE FUNCTION ccc_support_cases_program_required_insert();
REVOKE ALL ON FUNCTION ccc_support_cases_program_required_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_support_cases_program_required_insert() TO ccc_api;
ALTER FUNCTION ccc_support_cases_program_required_insert() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_support_cases_program_required_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.program_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM programs
    WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='support_case_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_program_required_update BEFORE UPDATE OF program_id, org_id ON support_cases
FOR EACH ROW EXECUTE FUNCTION ccc_support_cases_program_required_update();
REVOKE ALL ON FUNCTION ccc_support_cases_program_required_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_support_cases_program_required_update() TO ccc_api;
ALTER FUNCTION ccc_support_cases_program_required_update() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_support_cases_program_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.program_id IS DISTINCT FROM OLD.program_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='support_case_program_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_program_immutable BEFORE UPDATE OF program_id ON support_cases
FOR EACH ROW EXECUTE FUNCTION ccc_support_cases_program_immutable();
REVOKE ALL ON FUNCTION ccc_support_cases_program_immutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_support_cases_program_immutable() TO ccc_api;
ALTER FUNCTION ccc_support_cases_program_immutable() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_invite_tokens_program_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.program_id IS DISTINCT FROM OLD.program_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invite_program_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invite_tokens_program_immutable BEFORE UPDATE OF program_id ON invite_tokens
FOR EACH ROW EXECUTE FUNCTION ccc_invite_tokens_program_immutable();
REVOKE ALL ON FUNCTION ccc_invite_tokens_program_immutable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_invite_tokens_program_immutable() TO ccc_api;
ALTER FUNCTION ccc_invite_tokens_program_immutable() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_invite_tokens_program_scope_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind = 'participant' AND (
        NEW.program_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM programs
          WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
        )))
  OR (NEW.kind = 'counselor' AND NEW.program_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invite_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invite_tokens_program_scope_insert BEFORE INSERT ON invite_tokens
FOR EACH ROW EXECUTE FUNCTION ccc_invite_tokens_program_scope_insert();
REVOKE ALL ON FUNCTION ccc_invite_tokens_program_scope_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_invite_tokens_program_scope_insert() TO ccc_api;
ALTER FUNCTION ccc_invite_tokens_program_scope_insert() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_invite_tokens_program_scope_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind = 'participant' AND (
        NEW.program_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM programs
          WHERE programs.id = NEW.program_id AND programs.org_id = NEW.org_id
        )))
  OR (NEW.kind = 'counselor' AND NEW.program_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='invite_program_invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invite_tokens_program_scope_update BEFORE UPDATE OF program_id, kind, org_id ON invite_tokens
FOR EACH ROW EXECUTE FUNCTION ccc_invite_tokens_program_scope_update();
REVOKE ALL ON FUNCTION ccc_invite_tokens_program_scope_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_invite_tokens_program_scope_update() TO ccc_api;
ALTER FUNCTION ccc_invite_tokens_program_scope_update() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_programs_referenced_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id)
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
  )) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='program_referenced';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programs_referenced_update BEFORE UPDATE OF id, org_id ON programs
FOR EACH ROW EXECUTE FUNCTION ccc_programs_referenced_update();
REVOKE ALL ON FUNCTION ccc_programs_referenced_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_programs_referenced_update() TO ccc_api;
ALTER FUNCTION ccc_programs_referenced_update() OWNER TO ccc_schema_owner;

CREATE FUNCTION ccc_programs_referenced_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
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
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='program_referenced';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER programs_referenced_delete BEFORE DELETE ON programs
FOR EACH ROW EXECUTE FUNCTION ccc_programs_referenced_delete();
REVOKE ALL ON FUNCTION ccc_programs_referenced_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ccc_programs_referenced_delete() TO ccc_api;
ALTER FUNCTION ccc_programs_referenced_delete() OWNER TO ccc_schema_owner;

-- A verified Bearer session must observe its own revocation on every request.
-- 0006 intentionally exposes no session markers to an ordinary tenant context.
-- The Identity composition now supplies app.session_id only after signature and
-- MFA verification. Database.forActor resets it transaction-locally, including
-- an explicit empty value for contexts without a verified session. No browser
-- role receives access and no tenant-wide session listing becomes available.
CREATE POLICY rls_auth_revocations_current_session_select
ON auth_revocations FOR SELECT TO ccc_api
USING (
  kind = 'session'
  AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
  AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL
  AND NULLIF(current_setting('app.session_id', true), '') IS NOT NULL
  AND subject = current_setting('app.session_id', true)
);
