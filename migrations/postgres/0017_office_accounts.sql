-- Counterpart of immutable SQLite 0061. Cloud has no credential route or table grants.
CREATE TABLE office_accounts (
  user_id text PRIMARY KEY,
  username text NOT NULL,
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
CREATE UNIQUE INDEX office_accounts_username_key ON office_accounts
  (translate(username, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));

ALTER TABLE office_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE office_accounts FROM PUBLIC, ccc_api;
ALTER TABLE office_accounts OWNER TO ccc_schema_owner;
DO $$
DECLARE browser_role text;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE office_accounts FROM %I', browser_role);
  END LOOP;
END;
$$;
