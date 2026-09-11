-- Paired with SQLite 0061_agent_credentials.sql. E6-4 Agent pairing credentials.
-- S2 §2.2 L64/L96: the server keeps only the sha256 of a credential plus its
-- installation binding; the plaintext exists once, in the issuing response.
-- agent_installations gains no column. Lifetimes (S2 §2.4 L135-136) are values,
-- not schema: pairing_code 10 minutes single use, refresh 30 days rotate-on-use,
-- bearer 900 seconds. The 15-minute bearer idle limit needs no column because the
-- absolute lifetime is the same 900 seconds.
CREATE TABLE agent_credentials (
  id              text PRIMARY KEY,
  installation_id text NOT NULL REFERENCES agent_installations (installation_id),
  kind            text NOT NULL CHECK (kind IN ('pairing_code', 'refresh', 'bearer')),
  token_hash      text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at       text NOT NULL,
  expires_at      text NOT NULL,
  consumed_at     text,
  revoked_at      text
);

-- The installation-wide revocation path (pairing revoke, refresh reuse) reads this.
CREATE INDEX idx_agent_credentials_installation
  ON agent_credentials (installation_id, kind, revoked_at);

-- Credential identity is immutable and consumed_at/revoked_at are written once.
-- The condition is the SQLite trigger's WHEN clause with null-safe comparison;
-- the abort body is the shared ccc_reject_write, so no new function appears.
CREATE TRIGGER agent_credentials_transition_guard BEFORE UPDATE ON agent_credentials
FOR EACH ROW WHEN (NOT (
  NEW.id = OLD.id
  AND NEW.installation_id = OLD.installation_id
  AND NEW.kind = OLD.kind
  AND NEW.token_hash = OLD.token_hash
  AND NEW.issued_at = OLD.issued_at
  AND NEW.expires_at = OLD.expires_at
  AND (OLD.consumed_at IS NULL OR NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at)
  AND (OLD.revoked_at IS NULL OR NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at)
))
EXECUTE FUNCTION ccc_reject_write('agent_credential_immutable');
CREATE TRIGGER agent_credentials_no_delete BEFORE DELETE ON agent_credentials
FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('agent_credential_immutable');

-- No org_id: the tenant scope is the protected parent installation, the same
-- parent-existence pattern 0006 uses for agent_job_result_acceptances. Rows are
-- never deleted, so there is no delete policy and no DELETE grant.
ALTER TABLE agent_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_agent_credentials ON agent_credentials FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM agent_installations AS install
                     WHERE install.installation_id = agent_credentials.installation_id
                       AND install.org_id = current_setting('app.org_id', true)))
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM agent_installations AS install
                          WHERE install.installation_id = agent_credentials.installation_id
                            AND install.org_id = current_setting('app.org_id', true)));
REVOKE ALL ON TABLE agent_credentials FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE agent_credentials TO ccc_api;
ALTER TABLE agent_credentials OWNER TO ccc_schema_owner;

-- 설치 폐기와 refresh 재사용은 `auth_revocations` 에 주체 `agent:<installation_id>` 를
-- 남긴다(S2 §2.4 L136). 0006 의 actor 정책은 주체가 `users` 행일 때만 허용하므로 이
-- 주체는 거부된다 — 그래서 자격 테이블과 같은 부모(설치) 기준 정책을 여기서 더한다.
-- 정책은 permissive 라 OR 로 합쳐진다: users 주체 규칙은 그대로 있고 agent 주체만 열린다.
CREATE POLICY rls_auth_revocations_agent_select ON auth_revocations FOR SELECT TO ccc_api
  USING (kind = 'actor'
         AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM agent_installations AS install
                     WHERE auth_revocations.subject = 'agent:' || install.installation_id
                       AND install.org_id = current_setting('app.org_id', true)));
CREATE POLICY rls_auth_revocations_agent_insert ON auth_revocations FOR INSERT TO ccc_api
  WITH CHECK (kind = 'actor'
              AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM agent_installations AS install
                          WHERE auth_revocations.subject = 'agent:' || install.installation_id
                            AND install.org_id = current_setting('app.org_id', true)));
