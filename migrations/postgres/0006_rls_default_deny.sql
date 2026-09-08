-- CCC-221 / S11 2.4-2.5: the five migrations installed before this point
-- contain the application objects listed below.  Tables with an org_id are
-- direct tenant tables.  These four tables carry no org_id and are scoped via
-- their protected parent: ai_draft_versions -> ai_work_items,
-- ai_evidence_links -> ai_draft_versions -> ai_work_items,
-- ai_review_events -> ai_work_items + ai_draft_versions, and
-- agent_job_result_acceptances -> agent_jobs.  auth_revocations has no
-- org_id, but actor events are scoped through users(subject); session events
-- are append-only operational markers allowed only with a nonempty actor
-- context and are never readable through ccc_api.  The
-- participant_support_case_cutover_manifest is an installation-only
-- historical manifest and is unavailable to ccc_api.
--
-- Direct tenant tables: users, beneficiaries, organization_settings,
-- support_cases, support_case_assignees, participant_pii_vault, sessions,
-- goals, goal_revisions, counseling_schedules, action_items, flags,
-- session_goal_scores, ai_gas_evidence, session_life_area_snapshots,
-- session_discrepancies, schedule_custom_questions, schedule_session_goals,
-- invite_tokens, participant_consent_records, audit_log, teams,
-- team_memberships, team_supervisor_grants, user_role_assignments,
-- agent_installations, ai_provider_configs, ai_provider_activations,
-- pilot_text_ai_consent_evidence, ai_masked_source_snapshots,
-- ai_masked_source_evidence_items, ai_work_items, ai_draft_source_materials,
-- ai_draft_contrast_axes, ai_text_work_queue, recording_result_commits,
-- participant_pii_archives, participant_pii_retention_decisions,
-- ner_release_qualification_receipts, agent_jobs, agent_job_egress_records,
-- counseling_memory_settings, counseling_memory_cases,
-- counseling_memory_sources, counseling_memory_materials,
-- counseling_memory_items, counseling_memory_history, counseling_memory_links,
-- counseling_memory_corrections, counseling_memory_derived,
-- counseling_memory_agents, counseling_memory_draft_context,
-- counseling_memory_guards.

-- The guard migration is deliberately fail-closed for old rows.  Main supplies
-- the already-known actor organization on every new fence insert.
ALTER TABLE counseling_memory_guards ADD COLUMN org_id text NOT NULL DEFAULT '';

-- This shared allocator is non-tenant metadata, like the rowid sequences below.
-- It carries no participant or organization identifiers. RLS must not make
-- separate tenants repeatedly choose an already-used global pseudonym.
CREATE TABLE beneficiary_id_counters (
  animal text NOT NULL PRIMARY KEY,
  last_value bigint NOT NULL CHECK (last_value BETWEEN 0 AND 9007199254740991)
);
INSERT INTO beneficiary_id_counters(animal,last_value)
SELECT split_part(id,'-',1),max(CAST(split_part(id,'-',2) AS bigint))
FROM beneficiaries WHERE position('-' IN id)>0
GROUP BY split_part(id,'-',1);

CREATE FUNCTION beneficiaries_sync_id_counter_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO beneficiary_id_counters(animal,last_value)
  VALUES(split_part(NEW.id,'-',1),CAST(split_part(NEW.id,'-',2) AS bigint))
  ON CONFLICT(animal) DO UPDATE SET last_value=excluded.last_value
  WHERE excluded.last_value>beneficiary_id_counters.last_value;
  RETURN NULL;
END
$$;
CREATE TRIGGER beneficiaries_sync_id_counter AFTER INSERT ON beneficiaries
FOR EACH ROW WHEN (position('-' IN NEW.id)>0)
EXECUTE FUNCTION beneficiaries_sync_id_counter_fn();

-- PostgreSQL's old max(id)+1 trigger was visible only to the current RLS
-- tenant.  Global sequences allocate audit/revision IDs without reading rows
-- from another organization.  Explicit import IDs remain accepted; an import
-- that supplies an ID above the sequence must advance the sequence with
-- setval(..., max(id), true) before subsequent omitted-ID inserts.
CREATE SEQUENCE audit_log_id_seq AS bigint START WITH 1;
CREATE SEQUENCE goal_revisions_id_seq AS bigint START WITH 1;
CREATE OR REPLACE FUNCTION ccc_rowid_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS NULL THEN
    IF TG_TABLE_NAME = 'audit_log' THEN
      NEW.id := nextval('public.audit_log_id_seq'::regclass);
    ELSIF TG_TABLE_NAME = 'goal_revisions' THEN
      NEW.id := nextval('public.goal_revisions_id_seq'::regclass);
    ELSE
      RAISE EXCEPTION 'ccc_rowid_insert is not installed on this table';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);
ALTER TABLE goal_revisions ALTER COLUMN id SET DEFAULT nextval('public.goal_revisions_id_seq'::regclass);
SELECT setval('public.audit_log_id_seq'::regclass,
  GREATEST(COALESCE(max(id), 0), 1), COALESCE(max(id), 0) >= 1) FROM audit_log;
SELECT setval('public.goal_revisions_id_seq'::regclass,
  GREATEST(COALESCE(max(id), 0), 1), COALESCE(max(id), 0) >= 1) FROM goal_revisions;

-- Roles are intentionally created without a tracked password.  The disposable
-- harness supplies a random password in memory after this migration.  Existing
-- role attributes and memberships are checked rather than silently repaired.
DO $$
DECLARE
  owner_oid oid;
  api_oid oid;
  role_record pg_roles;
  browser_role text;
BEGIN
  IF NOT pg_has_role(current_user,
    (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'USAGE') THEN
    RAISE EXCEPTION 'installer must own the public schema';
  END IF;
  SELECT * INTO role_record FROM pg_roles WHERE rolname = 'ccc_schema_owner';
  IF NOT FOUND THEN
    CREATE ROLE ccc_schema_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    IF role_record.rolcanlogin OR role_record.rolsuper OR role_record.rolbypassrls
      OR role_record.rolcreatedb OR role_record.rolcreaterole OR role_record.rolinherit
      OR role_record.rolreplication THEN
      RAISE EXCEPTION 'ccc_schema_owner has unsafe pre-existing attributes';
    END IF;
  END IF;
  SELECT oid INTO owner_oid FROM pg_roles WHERE rolname = 'ccc_schema_owner';
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = owner_oid) THEN
    RAISE EXCEPTION 'ccc_schema_owner has unsafe pre-existing memberships';
  END IF;

  SELECT * INTO role_record FROM pg_roles WHERE rolname = 'ccc_api';
  IF NOT FOUND THEN
    CREATE ROLE ccc_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD NULL;
  ELSE
    IF NOT role_record.rolcanlogin OR role_record.rolsuper OR role_record.rolbypassrls
      OR role_record.rolcreatedb OR role_record.rolcreaterole OR role_record.rolinherit
      OR role_record.rolreplication THEN
      RAISE EXCEPTION 'ccc_api has unsafe pre-existing attributes';
    END IF;
  END IF;
  SELECT oid INTO api_oid FROM pg_roles WHERE rolname = 'ccc_api';
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = api_oid) THEN
    RAISE EXCEPTION 'ccc_api has unsafe pre-existing memberships';
  END IF;
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    IF pg_has_role(browser_role, owner_oid, 'MEMBER') OR pg_has_role(browser_role, api_oid, 'MEMBER') THEN
      RAISE EXCEPTION 'browser role has unsafe pre-existing memberships';
    END IF;
  END LOOP;
  IF current_user IN ('ccc_api', 'anon', 'authenticated') THEN
    RAISE EXCEPTION 'untrusted installer cannot receive schema-owner membership';
  END IF;
  -- ALTER ... OWNER TO requires membership in the target role for a
  -- non-superuser installer.  Grant it only to this trusted migration
  -- executor, never to ccc_api or browser roles.
  EXECUTE format('GRANT ccc_schema_owner TO %I', current_user);
  -- Check inbound and transitive membership too, including memberships that
  -- the installer grant above would newly expose. Failure rolls back the grant.
  IF EXISTS (
    SELECT 1 FROM pg_roles AS principal
    WHERE principal.oid NOT IN (owner_oid, api_oid, current_user::regrole::oid)
      AND NOT principal.rolsuper
      AND (pg_has_role(principal.oid, owner_oid, 'MEMBER')
        OR pg_has_role(principal.oid, api_oid, 'MEMBER'))
  ) THEN
    RAISE EXCEPTION 'unexpected principal has privileged role membership';
  END IF;
END
$$;
-- Ownership transfer and PostgreSQL's owner-executed FK checks require schema
-- access even though application functions remain SECURITY INVOKER.
GRANT USAGE, CREATE ON SCHEMA public TO ccc_schema_owner;

-- Keep every application object owned by the non-login schema owner.  The
-- dynamic inventory is restricted to objects in public created by these
-- migrations, never system catalogs.
DO $$
DECLARE
  object_record record;
BEGIN
  FOR object_record IN
    SELECT c.relkind, c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
  LOOP
    IF object_record.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ccc_schema_owner', object_record.relname);
    ELSE
      EXECUTE format('ALTER TABLE public.%I OWNER TO ccc_schema_owner', object_record.relname);
    END IF;
  END LOOP;
  FOR object_record IN
    SELECT c.relkind, c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    IF object_record.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW public.%I OWNER TO ccc_schema_owner', object_record.relname);
    ELSE
      EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO ccc_schema_owner', object_record.relname);
    END IF;
  END LOOP;
  FOR object_record IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO ccc_schema_owner', object_record.signature);
  END LOOP;
END
$$;
ALTER SEQUENCE audit_log_id_seq OWNED BY audit_log.id;
ALTER SEQUENCE goal_revisions_id_seq OWNED BY goal_revisions.id;

-- No browser, Supabase Auth, or PUBLIC principal receives schema, relation,
-- sequence, or function access.  The fixture may create anon/authenticated;
-- revoke their privileges when present without making hosted Auth a migration
-- prerequisite.
DO $$
DECLARE
  role_name text;
  owner_name text;
  object_kind text;
  schema_scope text;
  grantee text;
  column_record record;
BEGIN
  -- A schema-local REVOKE cannot remove PostgreSQL's global PUBLIC EXECUTE
  -- default. Clear global defaults and any public-schema additions for both
  -- roles that create CCC objects, including provider-installed browser grants.
  FOREACH owner_name IN ARRAY ARRAY[current_user::text, 'ccc_schema_owner'] LOOP
    FOREACH object_kind IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS'] LOOP
      FOREACH schema_scope IN ARRAY ARRAY['', ' IN SCHEMA public'] LOOP
        FOR role_name IN
          SELECT 'PUBLIC'
          UNION
          SELECT role.rolname::text FROM pg_roles AS role
          WHERE role.rolname <> owner_name AND (
            role.rolname IN ('anon', 'authenticated', 'ccc_api')
            OR role.oid IN (
              SELECT privilege.grantee FROM pg_default_acl AS defaults
              CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
              WHERE defaults.defaclrole = owner_name::regrole
                AND defaults.defaclnamespace IN (0, 'public'::regnamespace::oid)
            )
          )
        LOOP
          grantee := CASE WHEN role_name = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END;
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %s CASCADE',
            owner_name, schema_scope, object_kind, grantee);
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  -- Enumerate existing grants instead of assuming provider/legacy roles have
  -- known names. BYPASSRLS services must lose object grants as well.
  FOR role_name IN
    SELECT 'PUBLIC'
    UNION
    SELECT role.rolname::text FROM pg_roles AS role
    WHERE role.rolname NOT IN (current_user, 'ccc_schema_owner')
      AND role.oid <> (SELECT nspowner FROM pg_namespace WHERE nspname = 'public')
      AND (
        role.rolname IN ('anon', 'authenticated', 'ccc_api')
        OR role.oid IN (
          SELECT privilege.grantee FROM pg_class AS relation
          CROSS JOIN LATERAL aclexplode(relation.relacl) AS privilege
          WHERE relation.relnamespace = 'public'::regnamespace
          UNION
          SELECT privilege.grantee FROM pg_attribute AS attribute
          JOIN pg_class AS relation ON relation.oid = attribute.attrelid
          CROSS JOIN LATERAL aclexplode(attribute.attacl) AS privilege
          WHERE relation.relnamespace = 'public'::regnamespace
          UNION
          SELECT privilege.grantee FROM pg_proc AS function
          CROSS JOIN LATERAL aclexplode(function.proacl) AS privilege
          WHERE function.pronamespace = 'public'::regnamespace
          UNION
          SELECT privilege.grantee FROM pg_namespace AS schema
          CROSS JOIN LATERAL aclexplode(schema.nspacl) AS privilege
          WHERE schema.nspname = 'public'
        )
      )
  LOOP
    grantee := CASE WHEN role_name = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(role_name) END;
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %s CASCADE', grantee);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s CASCADE', grantee);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s CASCADE', grantee);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %s CASCADE', grantee);
    -- Relation-level REVOKE does not remove explicit column ACL entries.
    FOR column_record IN
      SELECT relation.relname, attribute.attname FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      WHERE relation.relnamespace = 'public'::regnamespace
        AND attribute.attacl IS NOT NULL AND NOT attribute.attisdropped
    LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %s CASCADE',
        column_record.attname, column_record.relname, grantee);
    END LOOP;
  END LOOP;
END
$$;
GRANT USAGE ON SCHEMA public TO ccc_api;

-- Enable and force RLS for each direct tenant table.  NULL or empty app.org_id
-- is intentionally not a valid scope, so legacy guard rows stay hidden.
DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_record.relname);
    EXECUTE format($policy$
      CREATE POLICY %I ON public.%I FOR ALL TO ccc_api
        USING (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
               AND org_id = current_setting('app.org_id', true))
        WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
                    AND org_id = current_setting('app.org_id', true))
    $policy$, table_record.relname, table_record.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO ccc_api', table_record.relname);
  END LOOP;
END
$$;
REVOKE UPDATE, DELETE ON audit_log, goal_revisions FROM ccc_api;

-- Parent-only tables use protected parent existence as their tenant scope.
-- The historical manifest and global revocation metadata deliberately remain
-- policy-less default-deny tables.
ALTER TABLE ai_draft_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_draft_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_ai_draft_versions ON ai_draft_versions FOR ALL TO ccc_api
  USING (EXISTS (SELECT 1 FROM ai_work_items AS work
                 WHERE work.id = ai_draft_versions.work_item_id
                   AND work.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM ai_work_items AS work
                      WHERE work.id = ai_draft_versions.work_item_id
                        AND work.org_id = current_setting('app.org_id', true)));
GRANT SELECT, INSERT ON ai_draft_versions TO ccc_api;

ALTER TABLE ai_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_ai_evidence_links ON ai_evidence_links FOR ALL TO ccc_api
  USING (EXISTS (SELECT 1
                 FROM ai_draft_versions AS draft
                 JOIN ai_work_items AS work ON work.id = draft.work_item_id
                 WHERE draft.id = ai_evidence_links.draft_version_id
                   AND work.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1
                      FROM ai_draft_versions AS draft
                      JOIN ai_work_items AS work ON work.id = draft.work_item_id
                      WHERE draft.id = ai_evidence_links.draft_version_id
                        AND work.org_id = current_setting('app.org_id', true)));
GRANT SELECT, INSERT ON ai_evidence_links TO ccc_api;

ALTER TABLE ai_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_review_events FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_ai_review_events ON ai_review_events FOR ALL TO ccc_api
  USING (EXISTS (SELECT 1
                 FROM ai_work_items AS work
                 JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
                 WHERE work.id = ai_review_events.work_item_id
                   AND draft.id = ai_review_events.draft_version_id
                   AND work.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1
                      FROM ai_work_items AS work
                      JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
                      WHERE work.id = ai_review_events.work_item_id
                        AND draft.id = ai_review_events.draft_version_id
                        AND work.org_id = current_setting('app.org_id', true)));
GRANT SELECT, INSERT ON ai_review_events TO ccc_api;

ALTER TABLE agent_job_result_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_job_result_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_agent_job_result_acceptances ON agent_job_result_acceptances FOR ALL TO ccc_api
  USING (EXISTS (SELECT 1 FROM agent_jobs AS job
                 WHERE job.id = agent_job_result_acceptances.job_id
                   AND job.org_id = current_setting('app.org_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_jobs AS job
                      WHERE job.id = agent_job_result_acceptances.job_id
                        AND job.org_id = current_setting('app.org_id', true)));
GRANT SELECT, INSERT ON agent_job_result_acceptances TO ccc_api;

ALTER TABLE auth_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_auth_revocations_actor_select ON auth_revocations FOR SELECT TO ccc_api
  USING (kind = 'actor'
         AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM users
                     WHERE users.id = auth_revocations.subject
                       AND users.org_id = current_setting('app.org_id', true)));
CREATE POLICY rls_auth_revocations_actor_insert ON auth_revocations FOR INSERT TO ccc_api
  WITH CHECK (kind = 'actor'
              AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND EXISTS (SELECT 1 FROM users
                          WHERE users.id = auth_revocations.subject
                            AND users.org_id = current_setting('app.org_id', true)));
-- Session revocation IDs are opaque and have no tenant lookup.  Permit the
-- append-only event from a fully scoped API transaction, but intentionally
-- provide no SELECT policy, so even the originating tenant cannot read it.
CREATE POLICY rls_auth_revocations_session_insert ON auth_revocations FOR INSERT TO ccc_api
  WITH CHECK (kind = 'session'
              AND NULLIF(current_setting('app.org_id', true), '') IS NOT NULL
              AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL);
GRANT SELECT, INSERT ON auth_revocations TO ccc_api;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON auth_revocations FROM ccc_api;

ALTER TABLE beneficiary_id_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiary_id_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_beneficiary_id_counters ON beneficiary_id_counters FOR ALL TO ccc_api
  USING (NULLIF(current_setting('app.org_id',true),'') IS NOT NULL
    AND NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.org_id',true),'') IS NOT NULL
    AND NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL);
GRANT SELECT, INSERT, UPDATE ON beneficiary_id_counters TO ccc_api;

ALTER TABLE participant_support_case_cutover_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_support_case_cutover_manifest FORCE ROW LEVEL SECURITY;
REVOKE ALL ON participant_support_case_cutover_manifest FROM ccc_api;

-- Compatibility views must evaluate as the caller so their joins cannot use
-- owner privileges to bypass the underlying tenant policies.
ALTER VIEW approved_ai_briefing_v1 SET (security_invoker = true);
ALTER VIEW grounded_ai_quality_v1 SET (security_invoker = true);
ALTER VIEW case_assignees SET (security_invoker = true);
ALTER VIEW cases SET (security_invoker = true);
ALTER VIEW approved_ai_briefing_v1 OWNER TO ccc_schema_owner;
ALTER VIEW grounded_ai_quality_v1 OWNER TO ccc_schema_owner;
ALTER VIEW case_assignees OWNER TO ccc_schema_owner;
ALTER VIEW cases OWNER TO ccc_schema_owner;
GRANT SELECT ON approved_ai_briefing_v1, grounded_ai_quality_v1, case_assignees, cases TO ccc_api;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq, goal_revisions_id_seq TO ccc_api;

-- Trigger procedures and functions reached implicitly by defaults/checks are
-- the only application functions the API may execute; all are invoker-security
-- functions.  ccc_reject_write is included because immutable triggers call it.
-- No SECURITY DEFINER path is introduced.
DO $$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT DISTINCT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_trigger AS t ON t.tgfoid = p.oid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ccc_api', function_record.signature);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION ccc_legacy_now(), ccc_iso_now(),
  ccc_json_valid(text), ccc_json_type(text), ccc_json_array_length(text),
  ccc_timestamp(text), ccc_retention_due(text, bigint), ccc_retention_cap(text),
  ccc_nullable_least(timestamp, timestamp) TO ccc_api;
GRANT EXECUTE ON FUNCTION ccc_reject_write() TO ccc_api;
