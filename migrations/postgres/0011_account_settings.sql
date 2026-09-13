-- Same short-lived transaction guard as SQLite. No account data is stored here.
CREATE TABLE account_mutation_guards (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  valid bigint NOT NULL CONSTRAINT account_state_changed CHECK (valid = 1)
);
ALTER TABLE account_mutation_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mutation_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_account_mutation_guards ON account_mutation_guards FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));
REVOKE ALL ON TABLE account_mutation_guards FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE account_mutation_guards TO ccc_api;
ALTER TABLE account_mutation_guards OWNER TO ccc_schema_owner;
