-- A verified Bearer session must observe its own revocation on every request.
-- 0006 intentionally exposes no session markers to an ordinary tenant context.
-- The Identity composition now supplies app.session_id only after signature and
-- MFA verification. Database.forActor resets it transaction-locally, including
-- an explicit empty value for contexts without a verified session. No browser
-- role receives access and no tenant-wide session listing becomes available.
CREATE POLICY rls_auth_revocations_current_session_select
ON auth_revocations FOR SELECT TO ccc_api
USING (
  kind = 'session'
  AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
  AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL
  AND NULLIF(current_setting('app.session_id', true), '') IS NOT NULL
  AND subject = current_setting('app.session_id', true)
);
