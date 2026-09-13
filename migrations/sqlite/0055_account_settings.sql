-- Account mutations serialize on organization_settings, then recheck authority
-- and expected roles inside the same atomic batch. Successful guards are deleted.
CREATE TABLE account_mutation_guards (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  valid INTEGER NOT NULL CONSTRAINT account_state_changed CHECK (valid = 1)
);
