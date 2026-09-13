-- Paired with SQLite 0057_preregistration_consent.sql. A disclosure snapshot is
-- issued for a program before the participant exists, so support_case_id becomes
-- nullable (NULL = program-scoped, not yet bound to a case). PostgreSQL drops the
-- constraint in place; SQLite rebuilds the table for the same result. Rows,
-- indexes, immutable triggers and child references are untouched.
ALTER TABLE consent_disclosure_snapshots ALTER COLUMN support_case_id DROP NOT NULL;

-- One receipt per (organization, staff actor, idempotency key). request_hash is
-- the canonical hash of the registration request: replay compares hashes, so no
-- name, phone, email, birth date, region or gender is ever stored here. The
-- created identities are referenced by id only, mirroring consent_events.
CREATE TABLE participant_registration_receipts (
  org_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  beneficiary_id text NOT NULL,
  support_case_id text NOT NULL,
  created_at text NOT NULL DEFAULT ccc_iso_now(),
  PRIMARY KEY (org_id, actor_id, idempotency_key)
);
CREATE TRIGGER participant_registration_receipts_no_update BEFORE UPDATE ON participant_registration_receipts
  FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('participant_registration_receipts_immutable');
CREATE TRIGGER participant_registration_receipts_no_delete BEFORE DELETE ON participant_registration_receipts
  FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('participant_registration_receipts_immutable');

-- A receipt belongs to the actor that issued the idempotency key, which is also
-- the key the replay path reads back, so both directions are actor-scoped.
ALTER TABLE participant_registration_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_registration_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_participant_registration_receipts_select ON participant_registration_receipts FOR SELECT TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true)
         AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL
         AND actor_id = current_setting('app.actor_id', true));
CREATE POLICY rls_participant_registration_receipts_insert ON participant_registration_receipts FOR INSERT TO ccc_api
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true)
              AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL
              AND actor_id = current_setting('app.actor_id', true));
REVOKE ALL ON TABLE participant_registration_receipts FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE participant_registration_receipts TO ccc_api;
ALTER TABLE participant_registration_receipts OWNER TO ccc_schema_owner;
