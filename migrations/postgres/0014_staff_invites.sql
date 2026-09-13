-- Paired with SQLite 0058_staff_invites.sql. D86 staff invites live apart from
-- invite_tokens, which keeps participant links and its historical counselor
-- rows. Only the sha256 of the token is stored; the plaintext exists once, in
-- the issuing response. roles_json is the canonical sorted JSON array of
-- granted roles and '[]' means role-waiting; the CHECK enumerates every
-- canonical array because a CHECK may not contain a subquery.
CREATE TABLE staff_invites (
  id                text PRIMARY KEY,
  org_id            text NOT NULL,
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email_normalized  text NOT NULL
                      CHECK (email_normalized = lower(btrim(email_normalized)) AND length(email_normalized) > 0),
  roles_json        text NOT NULL CHECK (roles_json IN (
                      '[]',
                      '["institution_admin"]',
                      '["institution_technical_admin"]',
                      '["practitioner"]',
                      '["institution_admin","institution_technical_admin"]',
                      '["institution_admin","practitioner"]',
                      '["institution_technical_admin","practitioner"]',
                      '["institution_admin","institution_technical_admin","practitioner"]'
                    )),
  issued_by         text NOT NULL,
  issued_at         text NOT NULL DEFAULT ccc_iso_now(),
  expires_at        text NOT NULL,
  status            text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used', 'revoked')),
  used_at           text,
  used_by_user_id   text,
  revoked_at        text,
  revoked_by        text,
  consumption_id    text UNIQUE,
  CHECK (
    (status = 'issued'
      AND used_at IS NULL AND used_by_user_id IS NULL AND consumption_id IS NULL
      AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'used'
      AND used_at IS NOT NULL AND used_by_user_id IS NOT NULL AND consumption_id IS NOT NULL
      AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'revoked'
      AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL
      AND used_at IS NULL AND used_by_user_id IS NULL AND consumption_id IS NULL)
  )
);

-- Listing an organization's invites, and the duplicate-invite lookup per email.
CREATE INDEX staff_invites_org_status_expiry ON staff_invites (org_id, status, expires_at);
CREATE INDEX staff_invites_org_email_status ON staff_invites (org_id, email_normalized, status);

-- An invite is a one-way record: issued -> used or issued -> revoked, and the
-- issued identity (organization, token hash, email, roles, issuer, validity)
-- never changes. Every other write, including any delete, aborts. The condition
-- is the SQLite trigger's WHEN clause; the shared unconditional abort body is
-- ccc_reject_write, so no new function is introduced.
CREATE TRIGGER staff_invites_transition_guard BEFORE UPDATE ON staff_invites
FOR EACH ROW WHEN (NOT (
  OLD.status = 'issued'
  AND NEW.id = OLD.id
  AND NEW.org_id = OLD.org_id
  AND NEW.token_hash = OLD.token_hash
  AND NEW.email_normalized = OLD.email_normalized
  AND NEW.roles_json = OLD.roles_json
  AND NEW.issued_by = OLD.issued_by
  AND NEW.issued_at = OLD.issued_at
  AND NEW.expires_at = OLD.expires_at
  AND (
    (NEW.status = 'used'
      AND NEW.used_at IS NOT NULL AND NEW.used_by_user_id IS NOT NULL AND NEW.consumption_id IS NOT NULL)
    OR (NEW.status = 'revoked'
      AND NEW.revoked_at IS NOT NULL AND NEW.revoked_by IS NOT NULL)
  )
))
EXECUTE FUNCTION ccc_reject_write('staff_invite_immutable');
CREATE TRIGGER staff_invites_no_delete BEFORE DELETE ON staff_invites
FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('staff_invite_immutable');

-- Issuing, listing and revoking are all organization-scoped; rows are never
-- deleted, so no delete policy and no DELETE grant exist.
ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_staff_invites_select ON staff_invites FOR SELECT TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true));
CREATE POLICY rls_staff_invites_insert ON staff_invites FOR INSERT TO ccc_api
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));
CREATE POLICY rls_staff_invites_update ON staff_invites FOR UPDATE TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND org_id = current_setting('app.org_id', true))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND org_id = current_setting('app.org_id', true));
REVOKE ALL ON TABLE staff_invites FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE staff_invites TO ccc_api;
ALTER TABLE staff_invites OWNER TO ccc_schema_owner;
