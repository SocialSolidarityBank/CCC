import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { canonicalizeJcs } from '../../apps/community-cloud/dist/install-manifest-verifier.js';
import { PlanFailure } from './plan.mjs';
import { INSTALL_METADATA_TABLES } from './install-journal.mjs';

const MAX_RECORD_STRING_BYTES = 1_024;
const MAX_OBJECTS = 5_000;
const MAX_GRANTS = 20_000;
const FORBIDDEN_IDENTITY = /[\p{Cc}/\\]/u;
const OBJECT_KINDS = new Set(['schema', 'relation', 'routine', 'type', 'catalog']);
const OBJECT_PROVENANCE = new Set(['extension', 'initial_privilege', 'supabase_managed']);
const GRANT_KINDS = new Set(['schema', 'relation', 'column', 'routine', 'type', 'default', 'role']);
const GRANT_PROVENANCE = new Set(['initial_privilege', 'supabase_managed']);

export const PROVIDER_INVENTORY_QUERY = `SELECT * FROM (
WITH
  non_system_namespace AS MATERIALIZED (
    SELECT namespace.oid, namespace.nspname, namespace.nspowner, namespace.nspacl
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema'
  ),
  installation_evidence AS MATERIALIZED (
    SELECT (
      (SELECT pg_catalog.count(*) = ${INSTALL_METADATA_TABLES.length}
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'private' AND relation.relkind IN ('r', 'p')
          AND relation.relname IN (${INSTALL_METADATA_TABLES.map(name => `'${name}'`).join(', ')}))
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ccc_api')
    ) AS present
  ),
  unowned_schema AS MATERIALIZED (
    SELECT namespace.oid
    FROM non_system_namespace AS namespace
    CROSS JOIN installation_evidence AS installation
    WHERE NOT (
      (namespace.nspname = 'public'
        AND namespace.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'pg_database_owner'))
      OR (installation.present AND namespace.nspname = 'private')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_namespace'::regclass
          AND dependency.objid = namespace.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_init_privs AS initial
        WHERE initial.classoid = 'pg_catalog.pg_namespace'::regclass
          AND initial.objoid = namespace.oid AND initial.objsubid = 0
          AND initial.privtype IN ('i', 'e')
      )
    )
  ),
  unowned_object AS MATERIALIZED (
    SELECT 'schema'::text AS object_kind, 'pg_catalog.pg_namespace'::regclass AS class_oid,
      namespace.oid AS object_oid, 0::integer AS object_sub_id, namespace.oid AS namespace_oid
    FROM unowned_schema AS namespace
    UNION ALL
    SELECT 'relation', 'pg_catalog.pg_class'::regclass, relation.oid, 0, namespace.oid
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_init_privs AS initial
        WHERE initial.classoid = 'pg_catalog.pg_class'::regclass
          AND initial.objoid = relation.oid AND initial.objsubid = 0
          AND initial.privtype IN ('i', 'e')
      )
    UNION ALL
    SELECT 'routine', 'pg_catalog.pg_proc'::regclass, procedure.oid, 0, namespace.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_proc'::regclass
          AND dependency.objid = procedure.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_init_privs AS initial
        WHERE initial.classoid = 'pg_catalog.pg_proc'::regclass
          AND initial.objoid = procedure.oid AND initial.objsubid = 0
          AND initial.privtype IN ('i', 'e')
      )
    UNION ALL
    SELECT 'type', 'pg_catalog.pg_type'::regclass, type_value.oid, 0, namespace.oid
    FROM pg_catalog.pg_type AS type_value
    JOIN non_system_namespace AS namespace ON namespace.oid = type_value.typnamespace
    LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = type_value.typrelid
    WHERE (type_value.typrelid = 0 OR composite_relation.relkind = 'c')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS base_type WHERE base_type.typarray = type_value.oid
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          AND dependency.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_init_privs AS initial
        WHERE initial.classoid = 'pg_catalog.pg_type'::regclass
          AND initial.objoid = type_value.oid AND initial.objsubid = 0
          AND initial.privtype IN ('i', 'e')
      )
    UNION ALL
    SELECT DISTINCT 'catalog', dependency.classid, dependency.objid, 0, namespace.oid
    FROM pg_catalog.pg_depend AS dependency
    JOIN non_system_namespace AS namespace
      ON dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dependency.refobjid = namespace.oid
    WHERE dependency.classid NOT IN (
        'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass,
        'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass,
        'pg_catalog.pg_default_acl'::regclass, 'pg_catalog.pg_extension'::regclass
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS extension_dependency
        WHERE extension_dependency.classid = dependency.classid
          AND extension_dependency.objid = dependency.objid
          AND extension_dependency.refclassid = 'pg_catalog.pg_extension'::regclass
          AND extension_dependency.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_init_privs AS initial
        WHERE initial.classoid = dependency.classid
          AND initial.objoid = dependency.objid
          AND initial.objsubid = 0
          AND initial.privtype IN ('i', 'e')
      )
  ),
  provider_object_candidate AS MATERIALIZED (
    SELECT 'schema'::text AS object_kind, 'pg_catalog.pg_namespace'::regclass AS class_oid,
      namespace.oid AS object_oid, 0::integer AS object_sub_id, namespace.oid AS namespace_oid
    FROM non_system_namespace AS namespace
    UNION ALL
    SELECT 'relation', 'pg_catalog.pg_class'::regclass, relation.oid, 0, namespace.oid
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'routine', 'pg_catalog.pg_proc'::regclass, procedure.oid, 0, namespace.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    UNION ALL
    SELECT 'type', 'pg_catalog.pg_type'::regclass, type_value.oid, 0, namespace.oid
    FROM pg_catalog.pg_type AS type_value
    JOIN non_system_namespace AS namespace ON namespace.oid = type_value.typnamespace
    LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = type_value.typrelid
    WHERE (type_value.typrelid = 0 OR composite_relation.relkind = 'c')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS base_type WHERE base_type.typarray = type_value.oid
      )
    UNION ALL
    SELECT DISTINCT 'catalog', dependency.classid, dependency.objid, 0, 0::oid
    FROM pg_catalog.pg_depend AS dependency
    JOIN non_system_namespace AS namespace
      ON dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dependency.refobjid = namespace.oid
    WHERE dependency.classid NOT IN (
      'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass,
      'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass,
      'pg_catalog.pg_default_acl'::regclass, 'pg_catalog.pg_extension'::regclass
    )
  ),
  provider_object AS MATERIALIZED (
    SELECT candidate.*,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid = candidate.class_oid
            AND dependency.objid = candidate.object_oid
            AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
            AND dependency.deptype = 'e'
        ) THEN 'extension'
        WHEN EXISTS (
          SELECT 1 FROM pg_catalog.pg_init_privs AS initial
          WHERE initial.classoid = candidate.class_oid
            AND initial.objoid = candidate.object_oid
            AND initial.objsubid = candidate.object_sub_id
            AND initial.privtype IN ('i', 'e')
        ) THEN 'initial_privilege'
        ELSE 'supabase_managed'
      END::text AS provenance
    FROM provider_object_candidate AS candidate
  ),
  actual_grant AS MATERIALIZED (
    SELECT 'schema'::text AS grant_kind, 'pg_catalog.pg_namespace'::regclass AS class_oid,
      namespace.oid AS object_oid, 0::integer AS object_sub_id,
      namespace.nspname AS schema_name, namespace.nspowner AS owner_oid,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable
    FROM non_system_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) AS privilege
    UNION ALL
    SELECT 'relation', 'pg_catalog.pg_class'::regclass, relation.oid, 0,
      namespace.nspname, relation.relowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS privilege
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'column', 'pg_catalog.pg_class'::regclass, relation.oid, attribute.attnum,
      namespace.nspname, relation.relowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
    WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
    UNION ALL
    SELECT 'default', 'pg_catalog.pg_default_acl'::regclass, defaults.oid, 0,
      COALESCE(namespace.nspname, ''), defaults.defaclrole,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable
    FROM pg_catalog.pg_default_acl AS defaults
    LEFT JOIN non_system_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS privilege
    WHERE defaults.defaclnamespace = 0 OR namespace.oid IS NOT NULL
    UNION ALL
    SELECT 'role', 'pg_catalog.pg_auth_members'::regclass, membership.roleid, 0,
      '', membership.roleid, membership.grantor, membership.member, 'MEMBER', membership.admin_option
    FROM pg_catalog.pg_auth_members AS membership
  ),
  effective_grant AS MATERIALIZED (
    SELECT 'schema'::text AS grant_kind, 'pg_catalog.pg_namespace'::regclass AS class_oid,
      namespace.oid AS object_oid, 0::integer AS object_sub_id,
      namespace.nspname AS schema_name, namespace.nspowner AS owner_oid,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL::boolean AS inherit_option, NULL::boolean AS set_option
    FROM non_system_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      namespace.nspacl, pg_catalog.acldefault('n'::"char", namespace.nspowner)
    )) AS privilege
    UNION ALL
    SELECT 'relation', 'pg_catalog.pg_class'::regclass, relation.oid, 0,
      namespace.nspname, relation.relowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL, NULL
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      relation.relacl,
      pg_catalog.acldefault((CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END)::"char", relation.relowner)
    )) AS privilege
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'column', 'pg_catalog.pg_class'::regclass, relation.oid, attribute.attnum,
      namespace.nspname, relation.relowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL, NULL
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      attribute.attacl, pg_catalog.acldefault('c'::"char", relation.relowner)
    )) AS privilege
    WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
    UNION ALL
    SELECT 'routine', 'pg_catalog.pg_proc'::regclass, procedure.oid, 0,
      namespace.nspname, procedure.proowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL, NULL
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      procedure.proacl, pg_catalog.acldefault('f'::"char", procedure.proowner)
    )) AS privilege
    UNION ALL
    SELECT 'type', 'pg_catalog.pg_type'::regclass, type_value.oid, 0,
      namespace.nspname, type_value.typowner,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL, NULL
    FROM pg_catalog.pg_type AS type_value
    JOIN non_system_namespace AS namespace ON namespace.oid = type_value.typnamespace
    LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = type_value.typrelid
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      type_value.typacl, pg_catalog.acldefault('T'::"char", type_value.typowner)
    )) AS privilege
    WHERE (type_value.typrelid = 0 OR composite_relation.relkind = 'c')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS base_type WHERE base_type.typarray = type_value.oid
      )
    UNION ALL
    SELECT 'default', 'pg_catalog.pg_default_acl'::regclass, defaults.oid, 0,
      COALESCE(namespace.nspname, ''), defaults.defaclrole,
      privilege.grantor, privilege.grantee, privilege.privilege_type, privilege.is_grantable,
      NULL, NULL
    FROM pg_catalog.pg_default_acl AS defaults
    LEFT JOIN non_system_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS privilege
    WHERE defaults.defaclnamespace = 0 OR namespace.oid IS NOT NULL
    UNION ALL
    SELECT 'role', 'pg_catalog.pg_auth_members'::regclass, membership.roleid, 0,
      '', membership.roleid, membership.grantor, membership.member, 'MEMBER', membership.admin_option,
      membership.inherit_option, membership.set_option
    FROM pg_catalog.pg_auth_members AS membership
  ),
  provider_grant AS MATERIALIZED (
    SELECT grant_record.*,
      CASE WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_init_privs AS initial
        CROSS JOIN LATERAL pg_catalog.aclexplode(initial.initprivs) AS initial_privilege
        WHERE initial.classoid = grant_record.class_oid
          AND initial.objoid = grant_record.object_oid
          AND initial.objsubid = grant_record.object_sub_id
          AND initial.privtype IN ('i', 'e')
          AND initial_privilege.grantor = grant_record.grantor
          AND initial_privilege.grantee = grant_record.grantee
          AND initial_privilege.privilege_type = grant_record.privilege_type
          AND initial_privilege.is_grantable = grant_record.is_grantable
      ) THEN 'initial_privilege' ELSE 'supabase_managed' END::text AS provenance
    FROM effective_grant AS grant_record
  ),
  unexpected_grant AS MATERIALIZED (
    SELECT grant_record.*
    FROM actual_grant AS grant_record
    WHERE NOT (
      grant_record.grantor = grant_record.owner_oid
        AND grant_record.grantee = grant_record.owner_oid
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_init_privs AS initial
        CROSS JOIN LATERAL pg_catalog.aclexplode(initial.initprivs) AS initial_privilege
        WHERE initial.classoid = grant_record.class_oid
          AND initial.objoid = grant_record.object_oid
          AND initial.objsubid = grant_record.object_sub_id
          AND initial.privtype IN ('i', 'e')
          AND initial_privilege.grantor = grant_record.grantor
          AND initial_privilege.grantee = grant_record.grantee
          AND initial_privilege.privilege_type = grant_record.privilege_type
          AND initial_privilege.is_grantable = grant_record.is_grantable
      )
    )
  ),
  provider_object_inventory AS MATERIALIZED (
    SELECT 'schema'::text AS object_kind, namespace.nspname AS namespace_name,
      pg_catalog.format('%I', namespace.nspname) AS object_identity,
      pg_catalog.pg_get_userbyid(namespace.nspowner) AS owner_name,
      pg_catalog.jsonb_build_object('name', namespace.nspname)::text AS definition_text,
      inventory.provenance,
      ((SELECT present FROM installation_evidence)
        AND namespace.nspname = 'private') AS installation_candidate,
      inventory.class_oid AS inventory_class_oid,
      inventory.object_oid AS inventory_object_oid
    FROM provider_object AS inventory
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = inventory.object_oid
    WHERE inventory.object_kind = 'schema'
    UNION ALL
    SELECT 'relation', namespace.nspname,
      pg_catalog.format('%I.%I %s', namespace.nspname, relation.relname,
        CASE relation.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED TABLE'
          WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
          WHEN 'f' THEN 'FOREIGN TABLE' END),
      pg_catalog.pg_get_userbyid(relation.relowner),
      pg_catalog.jsonb_build_object(
        'relkind', relation.relkind, 'persistence', relation.relpersistence,
        'rowSecurity', relation.relrowsecurity, 'forceRowSecurity', relation.relforcerowsecurity,
        'replicaIdentity', relation.relreplident,
        'options', COALESCE((
          SELECT pg_catalog.jsonb_agg(relation_option ORDER BY relation_option)
          FROM pg_catalog.unnest(relation.reloptions) AS relation_option
        ), '[]'::jsonb),
        'columns', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'notNull', attribute.attnotnull,
            'identity', attribute.attidentity,
            'generated', attribute.attgenerated,
            'collation', CASE WHEN attribute.attcollation = 0 THEN NULL
              ELSE attribute.attcollation::regcollation::text END,
            'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid, false)
          ) ORDER BY attribute.attnum)
          FROM pg_catalog.pg_attribute AS attribute
          LEFT JOIN pg_catalog.pg_attrdef AS default_value
            ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
          WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ), '[]'::jsonb),
        'constraints', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_value.oid, false)
            ORDER BY constraint_value.conname)
          FROM pg_catalog.pg_constraint AS constraint_value
          WHERE constraint_value.conrelid = relation.oid
        ), '[]'::jsonb),
        'indexes', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(index_value.indexrelid, 0, false)
            ORDER BY index_value.indexrelid::regclass::text)
          FROM pg_catalog.pg_index AS index_value
          WHERE index_value.indrelid = relation.oid
        ), '[]'::jsonb),
        'triggers', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'definition', pg_catalog.pg_get_triggerdef(trigger_value.oid, false),
            'enabled', trigger_value.tgenabled
          ) ORDER BY trigger_value.tgname)
          FROM pg_catalog.pg_trigger AS trigger_value
          WHERE trigger_value.tgrelid = relation.oid AND NOT trigger_value.tgisinternal
        ), '[]'::jsonb),
        'policies', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', policy.polname,
            'permissive', policy.polpermissive,
            'command', policy.polcmd,
            'roles', COALESCE((
              SELECT pg_catalog.jsonb_agg(policy_role.role_name ORDER BY policy_role.role_name)
              FROM (
                SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                  ELSE 'ROLE:' || pg_catalog.pg_get_userbyid(role_oid) END AS role_name
                FROM pg_catalog.unnest(policy.polroles) AS role_oid
              ) AS policy_role
            ), '[]'::jsonb),
            'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, false),
            'check', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, false)
          ) ORDER BY policy.polname)
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ), '[]'::jsonb),
        'viewDefinition', CASE WHEN relation.relkind IN ('v', 'm')
          THEN pg_catalog.pg_get_viewdef(relation.oid, false) ELSE NULL END,
        'sequence', CASE WHEN relation.relkind = 'S' THEN (
          SELECT pg_catalog.jsonb_build_object(
            'type', pg_catalog.format_type(sequence.seqtypid, NULL),
            'start', sequence.seqstart::text, 'increment', sequence.seqincrement::text,
            'max', sequence.seqmax::text, 'min', sequence.seqmin::text,
            'cache', sequence.seqcache::text, 'cycle', sequence.seqcycle
          ) FROM pg_catalog.pg_sequence AS sequence WHERE sequence.seqrelid = relation.oid
        ) ELSE NULL END,
        'foreignTable', CASE WHEN relation.relkind = 'f' THEN (
          SELECT pg_catalog.jsonb_build_object(
            'server', server.srvname, 'options', foreign_table.ftoptions
          )
          FROM pg_catalog.pg_foreign_table AS foreign_table
          JOIN pg_catalog.pg_foreign_server AS server ON server.oid = foreign_table.ftserver
          WHERE foreign_table.ftrelid = relation.oid
        ) ELSE NULL END
      )::text,
      inventory.provenance,
      ((SELECT present FROM installation_evidence) AND (
        (namespace.nspname = 'public' AND relation.relowner IN (
          CURRENT_USER::regrole::oid,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
        ))
        OR (namespace.nspname = 'private' AND relation.relkind IN ('r', 'p')
          AND relation.relname IN (${INSTALL_METADATA_TABLES.map(name => `'${name}'`).join(', ')}))
      )),
      inventory.class_oid,
      inventory.object_oid
    FROM provider_object AS inventory
    JOIN pg_catalog.pg_class AS relation ON relation.oid = inventory.object_oid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = inventory.namespace_oid
    WHERE inventory.object_kind = 'relation'
    UNION ALL
    SELECT 'routine', namespace.nspname,
      pg_catalog.format('%I.%I(%s) %s RETURNS %s', namespace.nspname, procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid),
        CASE procedure.prokind WHEN 'f' THEN 'FUNCTION' WHEN 'p' THEN 'PROCEDURE'
          WHEN 'a' THEN 'AGGREGATE' WHEN 'w' THEN 'WINDOW' END,
        COALESCE(pg_catalog.pg_get_function_result(procedure.oid),
          pg_catalog.format_type(procedure.prorettype, NULL))),
      pg_catalog.pg_get_userbyid(procedure.proowner),
      -- pg_get_functiondef rejects aggregates, so aggregate state comes from pg_aggregate.
      CASE WHEN procedure.prokind = 'a' THEN (
        SELECT pg_catalog.jsonb_build_object(
          'language', (SELECT language.lanname FROM pg_catalog.pg_language AS language
            WHERE language.oid = procedure.prolang),
          'returnType', pg_catalog.format_type(procedure.prorettype, NULL),
          'returnsSet', procedure.proretset,
          'strict', procedure.proisstrict,
          'securityDefiner', procedure.prosecdef,
          'volatility', procedure.provolatile,
          'parallel', procedure.proparallel,
          'config', procedure.proconfig,
          'aggregateKind', aggregate_value.aggkind,
          'directArgumentCount', aggregate_value.aggnumdirectargs,
          'transitionFunction', NULLIF(aggregate_value.aggtransfn::oid, 0)::regprocedure::text,
          'finalFunction', NULLIF(aggregate_value.aggfinalfn::oid, 0)::regprocedure::text,
          'combineFunction', NULLIF(aggregate_value.aggcombinefn::oid, 0)::regprocedure::text,
          'serialFunction', NULLIF(aggregate_value.aggserialfn::oid, 0)::regprocedure::text,
          'deserialFunction', NULLIF(aggregate_value.aggdeserialfn::oid, 0)::regprocedure::text,
          'movingTransitionFunction', NULLIF(aggregate_value.aggmtransfn::oid, 0)::regprocedure::text,
          'movingInverseFunction', NULLIF(aggregate_value.aggminvtransfn::oid, 0)::regprocedure::text,
          'movingFinalFunction', NULLIF(aggregate_value.aggmfinalfn::oid, 0)::regprocedure::text,
          'finalExtraArguments', aggregate_value.aggfinalextra,
          'movingFinalExtraArguments', aggregate_value.aggmfinalextra,
          'finalModify', aggregate_value.aggfinalmodify,
          'movingFinalModify', aggregate_value.aggmfinalmodify,
          'sortOperator', NULLIF(aggregate_value.aggsortop, 0)::regoperator::text,
          'transitionType', CASE WHEN aggregate_value.aggtranstype = 0 THEN NULL
            ELSE pg_catalog.format_type(aggregate_value.aggtranstype, NULL) END,
          'transitionSpace', aggregate_value.aggtransspace,
          'movingTransitionType', CASE WHEN aggregate_value.aggmtranstype = 0 THEN NULL
            ELSE pg_catalog.format_type(aggregate_value.aggmtranstype, NULL) END,
          'movingTransitionSpace', aggregate_value.aggmtransspace,
          'initialValue', aggregate_value.agginitval,
          'movingInitialValue', aggregate_value.aggminitval
        )::text
        FROM pg_catalog.pg_aggregate AS aggregate_value
        WHERE aggregate_value.aggfnoid = procedure.oid
      ) ELSE pg_catalog.pg_get_functiondef(procedure.oid) END,
      inventory.provenance,
      ((SELECT present FROM installation_evidence) AND (
        (namespace.nspname = 'public' AND procedure.proowner IN (
          CURRENT_USER::regrole::oid,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
        ))
        OR (namespace.nspname = 'private'
          AND procedure.proname = 'ccc_install_append_only'
          AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
          AND procedure.prorettype = 'pg_catalog.trigger'::regtype)
      )),
      inventory.class_oid,
      inventory.object_oid
    FROM provider_object AS inventory
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = inventory.object_oid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = inventory.namespace_oid
    WHERE inventory.object_kind = 'routine'
    UNION ALL
    SELECT 'type', namespace.nspname,
      identified.identity,
      pg_catalog.pg_get_userbyid(type_value.typowner),
      pg_catalog.jsonb_build_object(
        'typeKind', type_value.typtype, 'category', type_value.typcategory,
        'preferred', type_value.typispreferred, 'notNull', type_value.typnotnull,
        'delimiter', type_value.typdelim, 'alignment', type_value.typalign,
        'storage', type_value.typstorage, 'byValue', type_value.typbyval,
        'baseType', CASE WHEN type_value.typbasetype = 0 THEN NULL
          ELSE pg_catalog.format_type(type_value.typbasetype, type_value.typtypmod) END,
        'default', type_value.typdefault,
        'collation', CASE WHEN type_value.typcollation = 0 THEN NULL
          ELSE type_value.typcollation::regcollation::text END,
        'enumLabels', COALESCE((
          SELECT pg_catalog.jsonb_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
          FROM pg_catalog.pg_enum AS enum_value WHERE enum_value.enumtypid = type_value.oid
        ), '[]'::jsonb),
        'compositeAttributes', COALESCE((
          SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'notNull', attribute.attnotnull,
            'collation', CASE WHEN attribute.attcollation = 0 THEN NULL
              ELSE attribute.attcollation::regcollation::text END
          ) ORDER BY attribute.attnum)
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = type_value.typrelid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ), '[]'::jsonb),
        'range', (
          SELECT pg_catalog.jsonb_build_object(
            'subtype', pg_catalog.format_type(range_value.rngsubtype, NULL),
            'collation', CASE WHEN range_value.rngcollation = 0 THEN NULL
              ELSE range_value.rngcollation::regcollation::text END,
            'canonical', range_value.rngcanonical::regproc::text,
            'subtypeDiff', range_value.rngsubdiff::regproc::text,
            'multirange', pg_catalog.format_type(range_value.rngmultitypid, NULL)
          ) FROM pg_catalog.pg_range AS range_value WHERE range_value.rngtypid = type_value.oid
        )
      )::text,
      inventory.provenance,
      ((SELECT present FROM installation_evidence)
        AND namespace.nspname = 'public'
        AND type_value.typowner IN (
          CURRENT_USER::regrole::oid,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
        )),
      inventory.class_oid,
      inventory.object_oid
    FROM provider_object AS inventory
    JOIN pg_catalog.pg_type AS type_value ON type_value.oid = inventory.object_oid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = inventory.namespace_oid
    CROSS JOIN LATERAL pg_catalog.pg_identify_object(inventory.class_oid, inventory.object_oid, 0) AS identified
    WHERE inventory.object_kind = 'type'
    UNION ALL
    SELECT 'catalog', COALESCE(identified.schema, ''),
      pg_catalog.format('%s %s', identified.type, identified.identity),
      CASE
        WHEN inventory.class_oid = 'pg_catalog.pg_collation'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.collowner)
            FROM pg_catalog.pg_collation AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_conversion'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.conowner)
            FROM pg_catalog.pg_conversion AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_opclass'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.opcowner)
            FROM pg_catalog.pg_opclass AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_operator'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.oprowner)
            FROM pg_catalog.pg_operator AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_opfamily'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.opfowner)
            FROM pg_catalog.pg_opfamily AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_statistic_ext'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.stxowner)
            FROM pg_catalog.pg_statistic_ext AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_config'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.cfgowner)
            FROM pg_catalog.pg_ts_config AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_dict'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(value.dictowner)
            FROM pg_catalog.pg_ts_dict AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_publication_namespace'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(publication.pubowner)
            FROM pg_catalog.pg_publication_namespace AS value
            JOIN pg_catalog.pg_publication AS publication ON publication.oid = value.pnpubid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_publication_rel'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(publication.pubowner)
            FROM pg_catalog.pg_publication_rel AS value
            JOIN pg_catalog.pg_publication AS publication ON publication.oid = value.prpubid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_constraint'::regclass
          THEN (SELECT COALESCE(pg_catalog.pg_get_userbyid(owning_relation.relowner),
              pg_catalog.pg_get_userbyid(owning_type.typowner), '')
            FROM pg_catalog.pg_constraint AS value
            LEFT JOIN pg_catalog.pg_class AS owning_relation ON owning_relation.oid = value.conrelid
            LEFT JOIN pg_catalog.pg_type AS owning_type ON owning_type.oid = value.contypid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_attrdef'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(owning_relation.relowner)
            FROM pg_catalog.pg_attrdef AS value
            JOIN pg_catalog.pg_class AS owning_relation ON owning_relation.oid = value.adrelid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_trigger'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(owning_relation.relowner)
            FROM pg_catalog.pg_trigger AS value
            JOIN pg_catalog.pg_class AS owning_relation ON owning_relation.oid = value.tgrelid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_rewrite'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(owning_relation.relowner)
            FROM pg_catalog.pg_rewrite AS value
            JOIN pg_catalog.pg_class AS owning_relation ON owning_relation.oid = value.ev_class
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_policy'::regclass
          THEN (SELECT pg_catalog.pg_get_userbyid(owning_relation.relowner)
            FROM pg_catalog.pg_policy AS value
            JOIN pg_catalog.pg_class AS owning_relation ON owning_relation.oid = value.polrelid
            WHERE value.oid = inventory.object_oid)
        ELSE ''
        -- Text-search parsers and templates have no per-object owner in PostgreSQL.
      END,
      -- Every counted catalog class serializes actual state. An unmodeled class
      -- yields NULL here and the normalizer rejects the observation fail-closed.
      CASE
        WHEN inventory.class_oid = 'pg_catalog.pg_constraint'::regclass
          THEN pg_catalog.pg_get_constraintdef(inventory.object_oid, false)
        WHEN inventory.class_oid = 'pg_catalog.pg_trigger'::regclass
          THEN pg_catalog.pg_get_triggerdef(inventory.object_oid, false)
        WHEN inventory.class_oid = 'pg_catalog.pg_rewrite'::regclass
          THEN pg_catalog.pg_get_ruledef(inventory.object_oid, false)
        WHEN inventory.class_oid = 'pg_catalog.pg_attrdef'::regclass
          THEN (SELECT pg_catalog.pg_get_expr(value.adbin, value.adrelid, false)
            FROM pg_catalog.pg_attrdef AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_policy'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'name', value.polname, 'permissive', value.polpermissive, 'command', value.polcmd,
            'relation', value.polrelid::regclass::text,
            'roles', COALESCE((
              SELECT pg_catalog.jsonb_agg(policy_role.role_name ORDER BY policy_role.role_name)
              FROM (
                SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                  ELSE 'ROLE:' || pg_catalog.pg_get_userbyid(role_oid) END AS role_name
                FROM pg_catalog.unnest(value.polroles) AS role_oid
              ) AS policy_role
            ), '[]'::jsonb),
            'using', pg_catalog.pg_get_expr(value.polqual, value.polrelid, false),
            'check', pg_catalog.pg_get_expr(value.polwithcheck, value.polrelid, false)
          )::text FROM pg_catalog.pg_policy AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_collation'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'provider', value.collprovider, 'deterministic', value.collisdeterministic,
            'encoding', value.collencoding, 'collate', value.collcollate,
            'ctype', value.collctype, 'locale', value.colllocale,
            'icuRules', value.collicurules, 'version', value.collversion
          )::text FROM pg_catalog.pg_collation AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_conversion'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'sourceEncoding', value.conforencoding, 'targetEncoding', value.contoencoding,
            'procedure', value.conproc::regprocedure::text, 'default', value.condefault
          )::text FROM pg_catalog.pg_conversion AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_opclass'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'accessMethod', (SELECT method.amname FROM pg_catalog.pg_am AS method
              WHERE method.oid = value.opcmethod),
            'family', (SELECT pg_catalog.format('%I.%I', family_namespace.nspname, family.opfname)
              FROM pg_catalog.pg_opfamily AS family
              JOIN pg_catalog.pg_namespace AS family_namespace ON family_namespace.oid = family.opfnamespace
              WHERE family.oid = value.opcfamily),
            'inputType', pg_catalog.format_type(value.opcintype, NULL),
            'default', value.opcdefault,
            'keyType', CASE WHEN value.opckeytype = 0 THEN NULL
              ELSE pg_catalog.format_type(value.opckeytype, NULL) END
          )::text FROM pg_catalog.pg_opclass AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_operator'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'kind', value.oprkind, 'canMerge', value.oprcanmerge, 'canHash', value.oprcanhash,
            'leftType', CASE WHEN value.oprleft = 0 THEN NULL
              ELSE pg_catalog.format_type(value.oprleft, NULL) END,
            'rightType', CASE WHEN value.oprright = 0 THEN NULL
              ELSE pg_catalog.format_type(value.oprright, NULL) END,
            'resultType', CASE WHEN value.oprresult = 0 THEN NULL
              ELSE pg_catalog.format_type(value.oprresult, NULL) END,
            'commutator', NULLIF(value.oprcom, 0)::regoperator::text,
            'negator', NULLIF(value.oprnegate, 0)::regoperator::text,
            'procedure', NULLIF(value.oprcode::oid, 0)::regprocedure::text,
            'restrictionEstimator', NULLIF(value.oprrest::oid, 0)::regprocedure::text,
            'joinEstimator', NULLIF(value.oprjoin::oid, 0)::regprocedure::text
          )::text FROM pg_catalog.pg_operator AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_opfamily'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'accessMethod', (SELECT method.amname FROM pg_catalog.pg_am AS method
              WHERE method.oid = value.opfmethod),
            'operators', COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'strategy', family_operator.amopstrategy,
                'leftType', pg_catalog.format_type(family_operator.amoplefttype, NULL),
                'rightType', pg_catalog.format_type(family_operator.amoprighttype, NULL),
                'operator', family_operator.amopopr::regoperator::text,
                'purpose', family_operator.amoppurpose,
                'sortFamily', CASE WHEN family_operator.amopsortfamily = 0 THEN NULL ELSE (
                  SELECT pg_catalog.format('%I.%I', sort_namespace.nspname, sort_family.opfname)
                  FROM pg_catalog.pg_opfamily AS sort_family
                  JOIN pg_catalog.pg_namespace AS sort_namespace ON sort_namespace.oid = sort_family.opfnamespace
                  WHERE sort_family.oid = family_operator.amopsortfamily) END
              ) ORDER BY family_operator.amopopr::regoperator::text, family_operator.amopstrategy,
                family_operator.amoppurpose)
              FROM pg_catalog.pg_amop AS family_operator WHERE family_operator.amopfamily = value.oid
            ), '[]'::jsonb),
            'procedures', COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'number', family_procedure.amprocnum,
                'leftType', pg_catalog.format_type(family_procedure.amproclefttype, NULL),
                'rightType', pg_catalog.format_type(family_procedure.amprocrighttype, NULL),
                'procedure', family_procedure.amproc::regprocedure::text
              ) ORDER BY family_procedure.amproc::regprocedure::text, family_procedure.amprocnum,
                pg_catalog.format_type(family_procedure.amproclefttype, NULL),
                pg_catalog.format_type(family_procedure.amprocrighttype, NULL))
              FROM pg_catalog.pg_amproc AS family_procedure WHERE family_procedure.amprocfamily = value.oid
            ), '[]'::jsonb)
          )::text FROM pg_catalog.pg_opfamily AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_publication_namespace'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'publication', publication.pubname,
            'insert', publication.pubinsert, 'update', publication.pubupdate,
            'delete', publication.pubdelete, 'truncate', publication.pubtruncate,
            'allTables', publication.puballtables, 'viaRoot', publication.pubviaroot
          )::text FROM pg_catalog.pg_publication_namespace AS value
            JOIN pg_catalog.pg_publication AS publication ON publication.oid = value.pnpubid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_publication_rel'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'publication', publication.pubname, 'relation', value.prrelid::regclass::text,
            'insert', publication.pubinsert, 'update', publication.pubupdate,
            'delete', publication.pubdelete, 'truncate', publication.pubtruncate,
            'allTables', publication.puballtables, 'viaRoot', publication.pubviaroot,
            'filter', pg_catalog.pg_get_expr(value.prqual, value.prrelid, false),
            'columns', (SELECT pg_catalog.jsonb_agg(attribute.attname ORDER BY key.ordinality)
              FROM pg_catalog.unnest(value.prattrs::int2[]) WITH ORDINALITY AS key(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = value.prrelid AND attribute.attnum = key.attnum)
          )::text FROM pg_catalog.pg_publication_rel AS value
            JOIN pg_catalog.pg_publication AS publication ON publication.oid = value.prpubid
            WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_statistic_ext'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'relation', value.stxrelid::regclass::text,
            'kinds', value.stxkind,
            'statisticsTarget', value.stxstattarget,
            'columns', COALESCE((
              SELECT pg_catalog.jsonb_agg(attribute.attname ORDER BY key.ordinality)
              FROM pg_catalog.unnest(value.stxkeys::int2[]) WITH ORDINALITY AS key(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS attribute
                ON attribute.attrelid = value.stxrelid AND attribute.attnum = key.attnum
            ), '[]'::jsonb),
            'expressions', pg_catalog.pg_get_expr(value.stxexprs, value.stxrelid, false)
          )::text FROM pg_catalog.pg_statistic_ext AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_config'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'parser', (SELECT pg_catalog.format('%I.%I', parser_namespace.nspname, parser.prsname)
              FROM pg_catalog.pg_ts_parser AS parser
              JOIN pg_catalog.pg_namespace AS parser_namespace ON parser_namespace.oid = parser.prsnamespace
              WHERE parser.oid = value.cfgparser),
            'mappings', COALESCE((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'tokenType', config_map.maptokentype,
                'sequence', config_map.mapseqno,
                'dictionary', config_map.mapdict::regdictionary::text
              ) ORDER BY config_map.maptokentype, config_map.mapseqno)
              FROM pg_catalog.pg_ts_config_map AS config_map WHERE config_map.mapcfg = value.oid
            ), '[]'::jsonb)
          )::text FROM pg_catalog.pg_ts_config AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_dict'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'template', (SELECT pg_catalog.format('%I.%I', template_namespace.nspname, template.tmplname)
              FROM pg_catalog.pg_ts_template AS template
              JOIN pg_catalog.pg_namespace AS template_namespace ON template_namespace.oid = template.tmplnamespace
              WHERE template.oid = value.dicttemplate),
            'initOption', value.dictinitoption
          )::text FROM pg_catalog.pg_ts_dict AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_parser'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'start', NULLIF(value.prsstart::oid, 0)::regprocedure::text,
            'token', NULLIF(value.prstoken::oid, 0)::regprocedure::text,
            'end', NULLIF(value.prsend::oid, 0)::regprocedure::text,
            'headline', NULLIF(value.prsheadline::oid, 0)::regprocedure::text,
            'lexTypes', NULLIF(value.prslextype::oid, 0)::regprocedure::text
          )::text FROM pg_catalog.pg_ts_parser AS value WHERE value.oid = inventory.object_oid)
        WHEN inventory.class_oid = 'pg_catalog.pg_ts_template'::regclass
          THEN (SELECT pg_catalog.jsonb_build_object(
            'init', NULLIF(value.tmplinit::oid, 0)::regprocedure::text,
            'lexize', NULLIF(value.tmpllexize::oid, 0)::regprocedure::text
          )::text FROM pg_catalog.pg_ts_template AS value WHERE value.oid = inventory.object_oid)
        ELSE NULL
      END,
      inventory.provenance,
      ((SELECT present FROM installation_evidence)
        AND COALESCE(identified.schema, '') IN ('public', 'private')),
      inventory.class_oid,
      inventory.object_oid
    FROM provider_object AS inventory
    CROSS JOIN LATERAL pg_catalog.pg_identify_object(inventory.class_oid, inventory.object_oid, 0) AS identified
    WHERE inventory.object_kind = 'catalog'
  ),
  provider_grant_inventory AS MATERIALIZED (
    SELECT grant_record.grant_kind, grant_record.schema_name AS namespace_name,
      CASE grant_record.grant_kind
        WHEN 'schema' THEN pg_catalog.format('%I', grant_record.schema_name)
        WHEN 'relation' THEN (
          SELECT pg_catalog.format('%I.%I %s', namespace.nspname, relation.relname,
            CASE relation.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'PARTITIONED TABLE'
              WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
              WHEN 'f' THEN 'FOREIGN TABLE' END)
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE relation.oid = grant_record.object_oid
        )
        WHEN 'column' THEN (
          SELECT pg_catalog.format('%I.%I.%I', namespace.nspname, relation.relname, attribute.attname)
          FROM pg_catalog.pg_attribute AS attribute
          JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE attribute.attrelid = grant_record.object_oid AND attribute.attnum = grant_record.object_sub_id
        )
        WHEN 'routine' THEN (
          SELECT pg_catalog.format('%I.%I(%s) %s RETURNS %s', namespace.nspname, procedure.proname,
            pg_catalog.pg_get_function_identity_arguments(procedure.oid),
            CASE procedure.prokind WHEN 'f' THEN 'FUNCTION' WHEN 'p' THEN 'PROCEDURE'
              WHEN 'a' THEN 'AGGREGATE' WHEN 'w' THEN 'WINDOW' END,
            COALESCE(pg_catalog.pg_get_function_result(procedure.oid),
              pg_catalog.format_type(procedure.prorettype, NULL)))
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
          WHERE procedure.oid = grant_record.object_oid
        )
        WHEN 'type' THEN (
          SELECT identified.identity
          FROM pg_catalog.pg_identify_object(
            'pg_catalog.pg_type'::regclass, grant_record.object_oid, 0
          ) AS identified
        )
        WHEN 'default' THEN (
          SELECT pg_catalog.format('default privileges for role %I%s on %s',
            pg_catalog.pg_get_userbyid(defaults.defaclrole),
            CASE WHEN namespace.oid IS NULL THEN '' ELSE pg_catalog.format(' in schema %I', namespace.nspname) END,
            CASE defaults.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
              WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' WHEN 'n' THEN 'SCHEMAS' END)
          FROM pg_catalog.pg_default_acl AS defaults
          LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
          WHERE defaults.oid = grant_record.object_oid
        )
        WHEN 'role' THEN pg_catalog.pg_get_userbyid(grant_record.object_oid)
      END AS object_identity,
      pg_catalog.pg_get_userbyid(grant_record.grantor) AS grantor_name,
      CASE WHEN grant_record.grantee = 0 THEN 'PUBLIC'
        ELSE 'ROLE:' || pg_catalog.pg_get_userbyid(grant_record.grantee) END AS grantee_name,
      grant_record.privilege_type AS privilege,
      grant_record.is_grantable,
      grant_record.inherit_option,
      grant_record.set_option,
      grant_record.provenance,
      ((SELECT present FROM installation_evidence) AND (
        (grant_record.grant_kind = 'schema'
          AND grant_record.schema_name = 'public'
          AND (
            (grant_record.grantee = (
              SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner'
            ) AND grant_record.privilege_type IN ('USAGE', 'CREATE'))
            OR (grant_record.grantee = (
              SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_api'
            ) AND grant_record.privilege_type = 'USAGE')
          ))
        OR EXISTS (
          SELECT 1
          FROM provider_object_inventory AS installation_object
          WHERE installation_object.installation_candidate
            AND installation_object.inventory_class_oid = grant_record.class_oid
            AND installation_object.inventory_object_oid = grant_record.object_oid
            AND (
              installation_object.object_kind = grant_record.grant_kind
              OR (grant_record.grant_kind = 'column'
                AND installation_object.object_kind = 'relation')
            )
        )
        OR (grant_record.grant_kind = 'role'
          AND grant_record.object_oid = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner'
          )
          AND grant_record.grantee = CURRENT_USER::regrole::oid
          AND NOT grant_record.is_grantable)
      )) AS installation_candidate
    FROM provider_grant AS grant_record
  )
SELECT
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'object_kind', object_kind, 'namespace_name', namespace_name,
    'object_identity', object_identity, 'owner_name', owner_name,
    'definition_text', definition_text, 'provenance', provenance
  ) ORDER BY object_kind, namespace_name, object_identity) FROM provider_object_inventory), '[]'::jsonb) AS objects,
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grant_kind', grant_kind, 'namespace_name', namespace_name,
    'object_identity', object_identity, 'grantor_name', grantor_name,
    'grantee_name', grantee_name, 'privilege', privilege,
    'is_grantable', is_grantable, 'inherit_option', inherit_option,
    'set_option', set_option, 'provenance', provenance
  ) ORDER BY grant_kind, namespace_name, object_identity, grantor_name, grantee_name,
    privilege, is_grantable, inherit_option, set_option)
  FROM provider_grant_inventory), '[]'::jsonb) AS grants,
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'object_kind', object_kind, 'namespace_name', namespace_name,
    'object_identity', object_identity, 'owner_name', owner_name,
    'definition_text', definition_text, 'provenance', provenance
  ) ORDER BY object_kind, namespace_name, object_identity)
  FROM provider_object_inventory WHERE installation_candidate), '[]'::jsonb) AS installation_objects,
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grant_kind', grant_kind, 'namespace_name', namespace_name,
    'object_identity', object_identity, 'grantor_name', grantor_name,
    'grantee_name', grantee_name, 'privilege', privilege,
    'is_grantable', is_grantable, 'inherit_option', inherit_option,
    'set_option', set_option, 'provenance', provenance
  ) ORDER BY grant_kind, namespace_name, object_identity, grantor_name, grantee_name,
    privilege, is_grantable, inherit_option, set_option)
  FROM provider_grant_inventory WHERE installation_candidate), '[]'::jsonb) AS installation_grants
) AS provider_inventory`;

function fail() {
  throw new PlanFailure('PROVIDER_UNREADABLE');
}

function boundedString(value, { nonempty = false, identity = false } = {}) {
  return typeof value === 'string'
    && (!nonempty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= MAX_RECORD_STRING_BYTES
    && (!identity || !FORBIDDEN_IDENTITY.test(value));
}

function canonical(value) {
  try {
    return Buffer.from(canonicalizeJcs(value), 'utf8');
  } catch {
    fail();
  }
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeObject(row) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)
    || !OBJECT_KINDS.has(row.object_kind)
    || !OBJECT_PROVENANCE.has(row.provenance)
    || !boundedString(row.namespace_name)
    || !boundedString(row.object_identity, { nonempty: true, identity: true })
    || !boundedString(row.owner_name)
    || typeof row.definition_text !== 'string') fail();
  return {
    kind: row.object_kind,
    schema: row.namespace_name,
    identity: row.object_identity,
    owner: row.owner_name,
    definitionSha256: hash(row.definition_text),
    provenance: row.provenance,
  };
}

function normalizeGrant(row) {
  const roleMembership = row?.grant_kind === 'role';
  const inheritOption = row?.inherit_option ?? null;
  const setOption = row?.set_option ?? null;
  if (typeof row !== 'object' || row === null || Array.isArray(row)
    || !GRANT_KINDS.has(row.grant_kind)
    || !GRANT_PROVENANCE.has(row.provenance)
    || !boundedString(row.namespace_name)
    || !boundedString(row.object_identity, { nonempty: true, identity: true })
    || !boundedString(row.grantor_name)
    || !boundedString(row.grantee_name)
    || !boundedString(row.privilege)
    || typeof row.is_grantable !== 'boolean'
    || (roleMembership
      ? typeof row.inherit_option !== 'boolean' || typeof row.set_option !== 'boolean'
      : inheritOption !== null || setOption !== null)) fail();
  return {
    kind: row.grant_kind,
    schema: row.namespace_name,
    objectIdentity: row.object_identity,
    grantor: row.grantor_name,
    grantee: row.grantee_name,
    privilege: row.privilege,
    grantable: row.is_grantable,
    inheritOption,
    setOption,
    provenance: row.provenance,
  };
}

function sortUnique(records, identity) {
  const keyed = records.map(record => ({ record, canonical: canonical(record), identity: identity(record) }));
  keyed.sort((left, right) => Buffer.compare(left.canonical, right.canonical));
  const identities = new Set();
  for (const item of keyed) {
    if (identities.has(item.identity)) fail();
    identities.add(item.identity);
    Object.freeze(item.record);
  }
  return Object.freeze(keyed.map(({ record }) => record));
}

function exactSubset(records, inventory) {
  const observed = new Set(inventory.map(record => canonicalizeJcs(record)));
  return records.every(record => observed.has(canonicalizeJcs(record)));
}

export function providerInventoryFingerprint(inventory) {
  if (!Array.isArray(inventory?.objects) || !Array.isArray(inventory?.grants)) fail();
  return Object.freeze({
    objectInventorySha256: hash(canonicalizeJcs(inventory.objects)),
    grantInventorySha256: hash(canonicalizeJcs(inventory.grants)),
  });
}

export function normalizeProviderInventory(row) {
  const rawInstallationObjects = row?.installation_objects ?? [];
  const rawInstallationGrants = row?.installation_grants ?? [];
  if (typeof row !== 'object' || row === null || Array.isArray(row)
    || !Array.isArray(row.objects) || row.objects.length > MAX_OBJECTS
    || !Array.isArray(row.grants) || row.grants.length > MAX_GRANTS
    || !Array.isArray(rawInstallationObjects) || rawInstallationObjects.length > MAX_OBJECTS
    || !Array.isArray(rawInstallationGrants) || rawInstallationGrants.length > MAX_GRANTS) fail();
  const objects = sortUnique(row.objects.map(normalizeObject), record => (
    canonicalizeJcs([record.kind, record.schema, record.identity])
  ));
  const grants = sortUnique(row.grants.map(normalizeGrant), record => canonicalizeJcs([
    record.kind, record.schema, record.objectIdentity, record.grantor,
    record.grantee, record.privilege, record.grantable, record.inheritOption, record.setOption,
  ]));
  const installationObjects = sortUnique(
    rawInstallationObjects.map(normalizeObject),
    record => canonicalizeJcs([record.kind, record.schema, record.identity]),
  );
  const installationGrants = sortUnique(
    rawInstallationGrants.map(normalizeGrant),
    record => canonicalizeJcs([
      record.kind, record.schema, record.objectIdentity, record.grantor,
      record.grantee, record.privilege, record.grantable, record.inheritOption, record.setOption,
    ]),
  );
  if (!exactSubset(installationObjects, objects)
    || !exactSubset(installationGrants, grants)) fail();
  return Object.freeze({
    objects,
    grants,
    installationObjects,
    installationGrants,
    ...providerInventoryFingerprint({ objects, grants }),
  });
}
