ALTER TABLE invite_tokens ADD COLUMN expires_at TEXT;

CREATE INDEX idx_invite_tokens_expiry
ON invite_tokens (org_id, kind, status, expires_at);

CREATE TRIGGER invite_tokens_no_expired_consume
BEFORE UPDATE ON invite_tokens
WHEN NEW.status = 'used'
  AND OLD.expires_at IS NOT NULL
  AND OLD.expires_at <= NEW.used_at
BEGIN
  SELECT RAISE(ABORT, 'invite_token_expired');
END;
