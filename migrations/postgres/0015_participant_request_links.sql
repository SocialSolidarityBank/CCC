ALTER TABLE invite_tokens ADD COLUMN expires_at text;

CREATE INDEX idx_invite_tokens_expiry
ON invite_tokens (org_id, kind, status, expires_at);

CREATE TRIGGER invite_tokens_no_expired_consume
BEFORE UPDATE ON invite_tokens
FOR EACH ROW WHEN (
  NEW.status = 'used'
  AND OLD.expires_at IS NOT NULL
  AND OLD.expires_at <= NEW.used_at
)
EXECUTE FUNCTION ccc_reject_write('invite_token_expired');
