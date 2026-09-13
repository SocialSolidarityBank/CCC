-- Paired with SQLite 0059_participant_request_links.sql. D86 participant
-- request links expire (7 days by default) and are consumed exactly once.
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

-- Self signup through a request link records the six consent events with
-- recorded_by = 'self' (S7 §3): the participant is the recorder and is not a
-- directory actor, while the public route runs under the runtime's directory
-- actor context. Every other insert keeps the actor binding from 0007.
DROP POLICY consent_events_insert ON consent_events;
CREATE POLICY consent_events_insert ON consent_events FOR INSERT TO ccc_api
  WITH CHECK (org_id = current_setting('app.org_id', true)
              AND (recorded_by = current_setting('app.actor_id', true) OR recorded_by = 'self'));
