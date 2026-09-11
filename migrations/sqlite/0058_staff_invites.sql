-- D86 staff invites. Separate from invite_tokens: that table keeps participant
-- links and its historical counselor rows, which stay untouched. A staff invite
-- stores only the sha256 of the token, so a leaked row cannot be redeemed, and
-- the plaintext token exists once in the issuing response.
--
-- roles_json is the canonical sorted JSON array of granted roles; '[]' means the
-- invite is role-waiting (a technical admin invited the person before the roles
-- were decided). CHECK enumerates every canonical array because neither engine
-- allows a subquery inside a CHECK, and the set of roles is schema, not data.
CREATE TABLE staff_invites (
  id                TEXT PRIMARY KEY NOT NULL,
  org_id            TEXT NOT NULL,
  token_hash        TEXT NOT NULL UNIQUE
                      CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  email_normalized  TEXT NOT NULL
                      CHECK (email_normalized = lower(trim(email_normalized)) AND length(email_normalized) > 0),
  roles_json        TEXT NOT NULL CHECK (roles_json IN (
                      '[]',
                      '["institution_admin"]',
                      '["institution_technical_admin"]',
                      '["practitioner"]',
                      '["institution_admin","institution_technical_admin"]',
                      '["institution_admin","practitioner"]',
                      '["institution_technical_admin","practitioner"]',
                      '["institution_admin","institution_technical_admin","practitioner"]'
                    )),
  issued_by         TEXT NOT NULL,
  issued_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used', 'revoked')),
  used_at           TEXT,
  used_by_user_id   TEXT,
  revoked_at        TEXT,
  revoked_by        TEXT,
  consumption_id    TEXT UNIQUE,
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
-- never changes. Every other write, including any delete, aborts.
CREATE TRIGGER staff_invites_transition_guard
BEFORE UPDATE ON staff_invites
WHEN NOT (
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
)
BEGIN SELECT RAISE(ABORT, 'staff_invite_immutable'); END;

CREATE TRIGGER staff_invites_no_delete
BEFORE DELETE ON staff_invites
BEGIN SELECT RAISE(ABORT, 'staff_invite_immutable'); END;
