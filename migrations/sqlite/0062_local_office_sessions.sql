-- Local-only authentication storage. 0061 remains byte-for-byte unchanged.
-- Directory role grants, not a credential JSON copy, authorize business access.
ALTER TABLE office_accounts DROP COLUMN roles;
ALTER TABLE office_accounts ADD COLUMN last_totp_counter INTEGER NOT NULL DEFAULT -1;

CREATE TABLE office_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  session_hash TEXT NOT NULL UNIQUE CHECK (length(session_hash) = 64),
  user_id TEXT NOT NULL REFERENCES office_accounts(user_id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  mfa_verified_at TEXT,
  mfa_counter INTEGER,
  revoked_at TEXT
);
CREATE INDEX office_sessions_user ON office_sessions(user_id);

CREATE TRIGGER office_credentials_revoke_sessions
AFTER UPDATE OF password_hash, salt, mfa_secret, mfa_required, enabled ON office_accounts
WHEN OLD.password_hash IS NOT NEW.password_hash OR OLD.salt IS NOT NEW.salt
  OR OLD.mfa_secret IS NOT NEW.mfa_secret OR OLD.mfa_required IS NOT NEW.mfa_required
  OR OLD.enabled IS NOT NEW.enabled
BEGIN
  UPDATE office_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = NEW.user_id AND revoked_at IS NULL;
END;

CREATE TRIGGER office_mfa_counter_guard
BEFORE UPDATE OF mfa_verified_at ON office_sessions
WHEN NEW.mfa_verified_at IS NOT NULL AND (
  OLD.mfa_verified_at IS NOT NULL OR NEW.mfa_counter IS NULL
  OR NEW.mfa_counter <= (SELECT last_totp_counter FROM office_accounts WHERE user_id = NEW.user_id)
)
BEGIN
  SELECT RAISE(ABORT, 'account_state_changed');
END;

CREATE TRIGGER office_mfa_counter_and_audit
AFTER UPDATE OF mfa_verified_at ON office_sessions
WHEN OLD.mfa_verified_at IS NULL AND NEW.mfa_verified_at IS NOT NULL
BEGIN
  UPDATE office_accounts
  SET last_totp_counter = NEW.mfa_counter, failed_attempts = 0, locked_until = NULL
  WHERE user_id = NEW.user_id;
  INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, detail, created_at)
  SELECT org_id, NEW.user_id, 'service', 'update', 'office_sessions', NEW.session_id,
    '{"event":"mfa_verified"}', NEW.mfa_verified_at FROM users WHERE id = NEW.user_id;
END;
