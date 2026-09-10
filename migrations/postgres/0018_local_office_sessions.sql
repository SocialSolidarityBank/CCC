-- Counterpart of immutable SQLite 0062. These tables remain unavailable to Cloud actors.
ALTER TABLE office_accounts DROP COLUMN roles;
ALTER TABLE office_accounts ADD COLUMN last_totp_counter bigint NOT NULL DEFAULT -1;
CREATE TABLE office_sessions (
  session_id text PRIMARY KEY,
  session_hash text NOT NULL UNIQUE CHECK (length(session_hash) = 64),
  user_id text NOT NULL REFERENCES office_accounts(user_id),
  issued_at text NOT NULL,
  expires_at text NOT NULL,
  last_used_at text NOT NULL,
  mfa_verified_at text,
  mfa_counter bigint,
  revoked_at text
);
CREATE INDEX office_sessions_user ON office_sessions(user_id);

CREATE FUNCTION office_credentials_revoke_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE office_sessions SET revoked_at = ccc_iso_now()
  WHERE user_id = NEW.user_id AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER office_credentials_revoke_sessions
AFTER UPDATE OF password_hash, salt, mfa_secret, mfa_required, enabled ON office_accounts
FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.salt IS DISTINCT FROM NEW.salt
  OR OLD.mfa_secret IS DISTINCT FROM NEW.mfa_secret OR OLD.mfa_required IS DISTINCT FROM NEW.mfa_required
  OR OLD.enabled IS DISTINCT FROM NEW.enabled)
EXECUTE FUNCTION office_credentials_revoke_sessions();

CREATE FUNCTION office_mfa_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_counter bigint;
BEGIN
  IF NEW.mfa_verified_at IS NOT NULL THEN
    SELECT last_totp_counter INTO last_counter FROM office_accounts WHERE user_id = NEW.user_id FOR UPDATE;
    IF OLD.mfa_verified_at IS NOT NULL OR NEW.mfa_counter IS NULL OR NEW.mfa_counter <= last_counter THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='account_state_changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER office_mfa_counter_guard BEFORE UPDATE OF mfa_verified_at ON office_sessions
FOR EACH ROW EXECUTE FUNCTION office_mfa_counter_guard();

CREATE FUNCTION office_mfa_counter_and_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE office_accounts SET last_totp_counter = NEW.mfa_counter, failed_attempts = 0, locked_until = NULL
  WHERE user_id = NEW.user_id;
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, detail, created_at)
  SELECT org_id, NEW.user_id, 'service', 'update', 'office_sessions', NEW.session_id,
    '{"event":"mfa_verified"}', NEW.mfa_verified_at FROM users WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER office_mfa_counter_and_audit AFTER UPDATE OF mfa_verified_at ON office_sessions
FOR EACH ROW WHEN (OLD.mfa_verified_at IS NULL AND NEW.mfa_verified_at IS NOT NULL)
EXECUTE FUNCTION office_mfa_counter_and_audit();

ALTER TABLE office_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE office_sessions FROM PUBLIC, ccc_api;
REVOKE ALL ON FUNCTION office_credentials_revoke_sessions(), office_mfa_counter_guard(), office_mfa_counter_and_audit() FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE office_sessions FROM %I', browser_role);
  END LOOP;
END;
$$;
ALTER TABLE office_sessions OWNER TO ccc_schema_owner;
ALTER FUNCTION office_credentials_revoke_sessions() OWNER TO ccc_schema_owner;
ALTER FUNCTION office_mfa_counter_guard() OWNER TO ccc_schema_owner;
ALTER FUNCTION office_mfa_counter_and_audit() OWNER TO ccc_schema_owner;
