-- Counterpart of immutable SQLite 0061. Cloud has no credential route or table grants.
CREATE TABLE office_accounts (
  user_id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  salt text NOT NULL,
  roles text NOT NULL,
  mfa_secret text,
  mfa_required bigint NOT NULL DEFAULT 0,
  enabled bigint NOT NULL DEFAULT 1,
  failed_attempts bigint NOT NULL DEFAULT 0,
  locked_until text,
  created_at text NOT NULL DEFAULT ccc_iso_now(),
  updated_at text NOT NULL DEFAULT ccc_iso_now()
);
CREATE INDEX office_accounts_username ON office_accounts(username);
CREATE INDEX office_accounts_locked ON office_accounts(locked_until) WHERE locked_until IS NOT NULL;

-- SQLite NOCASE folds ASCII only. Do not replace it with Unicode case folding.
-- Serialize equal folded usernames before checking, including concurrent inserts.
CREATE FUNCTION office_account_username_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE folded text;
BEGIN
  folded := translate(NEW.username, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  PERFORM pg_advisory_xact_lock(hashtextextended(folded, 0));
  IF EXISTS (
    SELECT 1 FROM office_accounts a
    WHERE translate(a.username, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') = folded
      AND (TG_OP = 'INSERT' OR a.user_id IS DISTINCT FROM OLD.user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='office_username_exists', CONSTRAINT='office_accounts_username_key';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER office_account_username_guard BEFORE INSERT OR UPDATE OF username, user_id ON office_accounts
FOR EACH ROW EXECUTE FUNCTION office_account_username_guard();

ALTER TABLE office_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE office_accounts FROM PUBLIC, ccc_api;
REVOKE ALL ON FUNCTION office_account_username_guard() FROM PUBLIC;
ALTER TABLE office_accounts OWNER TO ccc_schema_owner;
DO $$
DECLARE browser_role text;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE office_accounts FROM %I', browser_role);
  END LOOP;
END;
$$;
ALTER FUNCTION office_account_username_guard() OWNER TO ccc_schema_owner;
