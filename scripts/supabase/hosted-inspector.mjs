import { createHash } from 'node:crypto';

import { PlanFailure } from './plan.mjs';
import { buildInstallStateQuery, DATABASE_INSTALL_FINGERPRINT_QUERY, hashDatabaseInstallFingerprint, INSTALL_METADATA_TABLES } from './install-journal.mjs';
import { assertAuthorizationCurrent } from './manifest-preflight.mjs';
import { normalizeProviderInventory, PROVIDER_INVENTORY_QUERY } from './provider-inventory.mjs';

export const DATABASE_STATE_QUERY = `SELECT * FROM (
WITH
  -- Provider-looking schema and role names are not ownership evidence. Only
  -- server-recorded initial privileges or extension membership are baseline proof.
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
  installation_object AS MATERIALIZED (
    SELECT 'schema'::text AS object_kind, namespace.oid AS object_oid
    FROM non_system_namespace AS namespace
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND namespace.nspname = 'private'
    UNION ALL
    SELECT 'relation', relation.oid
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND (
      (namespace.nspname = 'public' AND relation.relowner IN (
        CURRENT_USER::regrole::oid,
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
      ))
      OR (namespace.nspname = 'private' AND relation.relkind IN ('r', 'p')
        AND relation.relname IN (${INSTALL_METADATA_TABLES.map(name => `'${name}'`).join(', ')}))
    )
    UNION ALL
    SELECT 'routine', procedure.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND (
      (namespace.nspname = 'public' AND procedure.proowner IN (
        CURRENT_USER::regrole::oid,
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
      ))
      OR (namespace.nspname = 'private'
        AND procedure.proname = 'ccc_install_append_only'
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
        AND procedure.prorettype = 'pg_catalog.trigger'::regtype)
    )
    UNION ALL
    SELECT 'type', type_value.oid
    FROM pg_catalog.pg_type AS type_value
    JOIN non_system_namespace AS namespace ON namespace.oid = type_value.typnamespace
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND namespace.nspname = 'public'
      AND type_value.typowner IN (
        CURRENT_USER::regrole::oid,
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
      )
    UNION ALL
    SELECT DISTINCT 'catalog:' || dependency.classid::text, dependency.objid
    FROM pg_catalog.pg_depend AS dependency
    JOIN non_system_namespace AS namespace
      ON dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dependency.refobjid = namespace.oid
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND namespace.nspname IN ('public', 'private')
      AND dependency.classid NOT IN (
        'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass,
        'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass,
        'pg_catalog.pg_default_acl'::regclass, 'pg_catalog.pg_extension'::regclass
      )
  ),
  unowned_object AS MATERIALIZED (
    SELECT 'schema'::text AS object_kind, namespace.oid AS object_oid
    FROM unowned_schema AS namespace
    UNION ALL
    SELECT 'relation', relation.oid
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
    SELECT 'routine', procedure.oid
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
    SELECT 'type', type_value.oid
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
    SELECT DISTINCT 'catalog:' || dependency.classid::text, dependency.objid
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
  installation_unowned_object AS MATERIALIZED (
    SELECT inventory_object.object_kind, inventory_object.object_oid
    FROM unowned_object AS inventory_object
    JOIN installation_object AS installation
      ON installation.object_kind = inventory_object.object_kind
      AND installation.object_oid = inventory_object.object_oid
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
  installation_grant AS MATERIALIZED (
    SELECT grant_record.*
    FROM actual_grant AS grant_record
    CROSS JOIN installation_evidence AS installation
    WHERE installation.present AND (
      (grant_record.grant_kind = 'schema' AND grant_record.schema_name = 'public'
        AND (
          (grant_record.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
            AND grant_record.privilege_type IN ('USAGE', 'CREATE'))
          OR (grant_record.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_api')
            AND grant_record.privilege_type = 'USAGE')
        ))
      OR (grant_record.grant_kind = 'relation' AND grant_record.schema_name = 'public'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_class AS installed_relation
          WHERE installed_relation.oid = grant_record.object_oid
            AND installed_relation.relkind IN ('r', 'p')
        )
        AND grant_record.owner_oid IN (
          CURRENT_USER::regrole::oid,
          (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
        )
        AND grant_record.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_api')
        AND grant_record.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
      OR (grant_record.grant_kind = 'role'
        AND grant_record.object_oid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'ccc_schema_owner')
        AND grant_record.grantee = CURRENT_USER::regrole::oid
        AND NOT grant_record.is_grantable)
    )
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
  installation_unexpected_grant AS MATERIALIZED (
    SELECT grant_record.*
    FROM unexpected_grant AS grant_record
    JOIN installation_grant AS installation
      ON installation.grant_kind = grant_record.grant_kind
      AND installation.class_oid = grant_record.class_oid
      AND installation.object_oid = grant_record.object_oid
      AND installation.object_sub_id = grant_record.object_sub_id
      AND installation.grantor = grant_record.grantor
      AND installation.grantee = grant_record.grantee
      AND installation.privilege_type = grant_record.privilege_type
      AND installation.is_grantable = grant_record.is_grantable
  )
SELECT
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(schema_item.item, ',' ORDER BY schema_item.item), ''))
    FROM (
      SELECT pg_catalog.concat_ws(':', 'relation', namespace.nspname, relation.relname,
        relation.relkind::text, relation.relrowsecurity::text,
        relation.relforcerowsecurity::text, relation.relreplident::text) AS item
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S')
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'column', namespace.nspname, relation.relname,
        attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        attribute.attnotnull::text,
        COALESCE(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), ''))
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = 'public' AND attribute.attnum > 0 AND NOT attribute.attisdropped
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'constraint', namespace.nspname, relation.relname,
        constraint_value.conname, pg_catalog.pg_get_constraintdef(constraint_value.oid, true))
      FROM pg_catalog.pg_constraint AS constraint_value
      JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_value.conrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'index', namespace.nspname, relation.relname,
        pg_catalog.pg_get_indexdef(index_value.indexrelid))
      FROM pg_catalog.pg_index AS index_value
      JOIN pg_catalog.pg_class AS relation ON relation.oid = index_value.indrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'trigger', namespace.nspname, relation.relname,
        pg_catalog.pg_get_triggerdef(trigger_value.oid, true))
      FROM pg_catalog.pg_trigger AS trigger_value
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_value.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND NOT trigger_value.tgisinternal
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'view', namespace.nspname, relation.relname,
        pg_catalog.pg_get_viewdef(relation.oid, true))
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('v', 'm')
      UNION ALL
      SELECT pg_catalog.concat_ws(':', 'function', namespace.nspname, procedure.proname,
        pg_catalog.pg_get_functiondef(procedure.oid))
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
    ) AS schema_item) AS schema_fingerprint,
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    pg_catalog.concat_ws(':', namespace.nspname, relation.relname, policy.polname,
      policy.polpermissive::text, policy.polcmd::text,
      COALESCE((SELECT pg_catalog.string_agg(
        CASE WHEN role_oid = 0 THEN 'PUBLIC'
          ELSE 'ROLE:' || pg_catalog.pg_get_userbyid(role_oid) END,
        ',' ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC'
          ELSE 'ROLE:' || pg_catalog.pg_get_userbyid(role_oid) END
      ) FROM pg_catalog.unnest(policy.polroles) AS role_oid), ''),
      COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ''),
      COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')),
    ',' ORDER BY namespace.nspname, relation.relname, policy.polname
  ), ''))
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public') AS policy_fingerprint,
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    pg_catalog.jsonb_build_object(
      'id', bucket.id,
      'public', bucket.public,
      'fileSizeLimit', bucket.file_size_limit::text,
      'allowedMimeTypes', bucket.allowed_mime_types
    )::text,
    ',' ORDER BY bucket.id
  ), '')) FROM storage.buckets AS bucket) AS bucket_fingerprint,
  (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', bucket.id,
    'public', bucket.public,
    'fileSizeLimit', bucket.file_size_limit::text,
    'allowedMimeTypes', bucket.allowed_mime_types
  ) ORDER BY bucket.id), '[]'::jsonb) FROM storage.buckets AS bucket) AS bucket_inventory,
  (SELECT COALESCE(pg_catalog.array_agg(relation.relname::text ORDER BY relation.relname), ARRAY[]::text[])
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> 'ccc_schema_migrations') AS user_table_names,
  (SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> 'ccc_schema_migrations') AS user_table_count,
  (SELECT COALESCE(pg_catalog.sum(stats.n_live_tup), 0)::bigint
    FROM pg_catalog.pg_stat_user_tables AS stats
    WHERE stats.schemaname = 'public' AND stats.relname <> 'ccc_schema_migrations') AS user_row_estimate,
  (SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p') AND relation.relrowsecurity) AS rls_enabled_table_count,
  (SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public') AS policy_count,
  EXISTS(SELECT 1 FROM storage.buckets AS bucket WHERE bucket.id = 'ccc-audio') AS bucket_exists,
  (SELECT bucket.public FROM storage.buckets AS bucket WHERE bucket.id = 'ccc-audio') AS bucket_public,
  (SELECT count(*)::integer FROM auth.users) AS auth_user_count,
  (SELECT count(*)::integer FROM storage.buckets) AS bucket_count,
  (SELECT count(*)::integer FROM storage.objects) AS storage_object_count,
  (SELECT count(*)::integer FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'
    )) AS user_routine_count,
  (SELECT count(*)::integer FROM pg_catalog.pg_type AS type_value
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_value.typnamespace
    LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = type_value.typrelid
    WHERE namespace.nspname = 'public'
      AND (type_value.typrelid = 0 OR composite_relation.relkind = 'c')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type AS base_type WHERE base_type.typarray = type_value.oid)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_value.oid
          AND dependency.deptype = 'e'
      )) AS user_type_count,
  (SELECT pg_catalog.count(*)::integer FROM (
    SELECT namespace.oid, 'schema'::text AS object_kind
    FROM non_system_namespace AS namespace
    UNION ALL
    SELECT relation.oid, 'relation'
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT procedure.oid, 'routine'
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    UNION ALL
    SELECT type_value.oid, 'type'
    FROM pg_catalog.pg_type AS type_value
    JOIN non_system_namespace AS namespace ON namespace.oid = type_value.typnamespace
    LEFT JOIN pg_catalog.pg_class AS composite_relation ON composite_relation.oid = type_value.typrelid
    WHERE (type_value.typrelid = 0 OR composite_relation.relkind = 'c')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS base_type WHERE base_type.typarray = type_value.oid
      )
    UNION ALL
    SELECT DISTINCT dependency.objid, 'catalog:' || dependency.classid::text
    FROM pg_catalog.pg_depend AS dependency
    JOIN non_system_namespace AS namespace
      ON dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dependency.refobjid = namespace.oid
    WHERE dependency.classid NOT IN (
      'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass,
      'pg_catalog.pg_type'::regclass, 'pg_catalog.pg_namespace'::regclass,
      'pg_catalog.pg_default_acl'::regclass, 'pg_catalog.pg_extension'::regclass
    )
  ) AS provider_object) AS provider_object_count,
  (SELECT pg_catalog.count(*)::integer FROM (
    SELECT 1
    FROM non_system_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      namespace.nspacl, pg_catalog.acldefault('n'::"char", namespace.nspowner)
    )) AS privilege
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      relation.relacl,
      pg_catalog.acldefault((CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END)::"char", relation.relowner)
    )) AS privilege
    WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN non_system_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      attribute.attacl, pg_catalog.acldefault('c'::"char", relation.relowner)
    )) AS privilege
    WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
    UNION ALL
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN non_system_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      procedure.proacl, pg_catalog.acldefault('f'::"char", procedure.proowner)
    )) AS privilege
    UNION ALL
    SELECT 1
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
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    LEFT JOIN non_system_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS privilege
    WHERE defaults.defaclnamespace = 0 OR namespace.oid IS NOT NULL
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
  ) AS provider_grant) AS provider_grant_count,
  (SELECT pg_catalog.count(*)::integer FROM unowned_object) AS unknown_object_count,
  (SELECT pg_catalog.count(*)::integer FROM unowned_schema) AS custom_schema_count,
  (SELECT pg_catalog.count(*)::integer FROM unowned_object) AS unowned_object_count,
  (SELECT pg_catalog.count(*)::integer FROM installation_unowned_object) AS installation_unowned_object_count,
  (SELECT pg_catalog.count(*)::integer
    FROM installation_unowned_object WHERE object_kind = 'schema') AS installation_unowned_schema_count,
  (SELECT pg_catalog.count(*)::integer FROM unexpected_grant) AS unexpected_grant_count,
  (SELECT pg_catalog.count(*)::integer FROM installation_unexpected_grant) AS installation_unexpected_grant_count,
  (SELECT count(*)::integer FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m','S','f') AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
    )) AS user_auxiliary_relation_count,
  (SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[])
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relkind IN ('r','p')) AS private_table_names,
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cron' AND c.relname='job') AS cron_exists,
  EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='private') AS private_schema_exists,
  pg_catalog.current_setting('server_version') AS database_version,
  (pg_catalog.current_setting('transaction_read_only') = 'on') AS read_only,
  pg_catalog.has_database_privilege(CURRENT_USER, pg_catalog.current_database(), 'CONNECT') AS database_readable,
  EXISTS(SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='private' AND relation.relname IN ('ccc_install_journal','ccc_schema_migrations','ccc_install_receipt','ccc_install_resources','ccc_install_authorizations','ccc_install_steps','ccc_release_history')) AS private_install_metadata_exists,
  EXISTS(SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'ccc_schema_migrations' AND relation.relkind IN ('r', 'p')) AS ledger_exists
) AS database_state`;

export const LEDGER_QUERY = `SELECT migration.version, migration.checksum
  FROM public.ccc_schema_migrations AS migration
  ORDER BY migration.version DESC
  LIMIT 1`;

function safeAuth(auth) {
  return {
    emailEnabled: auth.external_email_enabled === true,
    openSignupDisabled: auth.disable_signup === true,
    totpEnabled: auth.mfa_totp_enroll_enabled === true && auth.mfa_totp_verify_enabled === true,
    refreshTokenRotationEnabled: auth.refresh_token_rotation_enabled === true,
  };
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function observedBuckets(database) {
  if (!Array.isArray(database.bucket_inventory)) throw new PlanFailure('PROVIDER_UNREADABLE');
  const ids = new Set();
  return database.bucket_inventory.map(bucket => {
    const id = bucket?.id;
    const fileSizeLimit = bucket?.fileSizeLimit;
    const allowedMimeTypes = bucket?.allowedMimeTypes;
    if (typeof id !== 'string' || id.length === 0 || ids.has(id)
      || typeof bucket.public !== 'boolean'
      || (fileSizeLimit !== null && (typeof fileSizeLimit !== 'string' || !/^\d+$/u.test(fileSizeLimit)))
      || (allowedMimeTypes !== null && (!Array.isArray(allowedMimeTypes)
        || allowedMimeTypes.some(value => typeof value !== 'string')))) {
      throw new PlanFailure('PROVIDER_UNREADABLE');
    }
    ids.add(id);
    return {
      resourceType: 'storage_bucket',
      resourceIdHash: createHash('sha256').update(id, 'utf8').digest('hex'),
      resourceDigest: fingerprint({
        public: bucket.public,
        fileSizeLimit,
        allowedMimeTypes: allowedMimeTypes === null ? null : [...allowedMimeTypes].sort(),
      }),
    };
  }).sort((left, right) => left.resourceIdHash.localeCompare(right.resourceIdHash));
}

export function publicDataTableNames(database) {
  if (!Array.isArray(database.user_table_names)) return [];
  return database.user_table_names.filter((name) => typeof name === 'string').sort();
}

export function dataFingerprintQuery(tableName) {
  const quoted = `"${tableName.replaceAll('"', '""')}"`;
  return `SELECT
    pg_catalog.count(*)::bigint AS row_count,
    COALESCE(pg_catalog.sum(pg_catalog.hashtextextended(pg_catalog.to_jsonb(row_value)::text, 0)::numeric), 0)::text AS hash_a,
    COALESCE(pg_catalog.sum(pg_catalog.hashtextextended(pg_catalog.to_jsonb(row_value)::text, 1)::numeric), 0)::text AS hash_b
    FROM public.${quoted} AS row_value`;
}

export function fingerprintPublicData(entries) {
  return fingerprint(entries.map(({ tableName, row }) => ({
    tableName,
    rowCount: String(row.row_count ?? '0'),
    hashA: String(row.hash_a ?? '0'),
    hashB: String(row.hash_b ?? '0'),
  })));
}

function firstRow(payload) {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (Array.isArray(payload?.data)) return payload.data[0] ?? null;
  if (Array.isArray(payload?.result)) return payload.result[0] ?? null;
  return null;
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function boolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function canonicalDatabaseVersion(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1_024
    || !/^\d+(?:\.\d+)*$/u.test(value)) {
    throw new PlanFailure('PROVIDER_UNREADABLE');
  }
  return value.split('.').map(part => BigInt(part).toString()).join('.');
}

export function normalizeDatabaseSnapshot({ database, migration, auth, authFingerprint = fingerprint(auth), institutionDataFingerprint = '' }) {
  // A legacy public ledger is never treated as an S11 installation journal.
  const ledgerExists = boolean(database.ledger_exists) || boolean(database.private_install_metadata_exists);
  return {
    connection: {
      readOnly: boolean(database.read_only),
      databaseReadable: boolean(database.database_readable),
      authReadable: true,
      storageReadable: true,
    },
    installed: ledgerExists
      ? {
          ledger: 'present',
          version: Number.isInteger(Number(migration?.version)) ? Number(migration.version) : null,
          checksum: typeof migration?.checksum === 'string' ? migration.checksum : null,
        }
      : { ledger: 'absent', version: null, checksum: null },
    auth,
    state: {
      schemaFingerprint: String(database.schema_fingerprint ?? ''),
      policyFingerprint: String(database.policy_fingerprint ?? ''),
      bucketFingerprint: String(database.bucket_fingerprint ?? ''),
      authFingerprint,
      buckets: observedBuckets(database),
      institutionDataFingerprint,
      userTableCount: number(database.user_table_count),
      userRowEstimate: number(database.user_row_estimate),
      rlsEnabledTableCount: number(database.rls_enabled_table_count),
      policyCount: number(database.policy_count),
      authUserCount: number(database.auth_user_count),
      bucketCount: number(database.bucket_count),
      storageObjectCount: number(database.storage_object_count),
      userRoutineCount: number(database.user_routine_count),
      userTypeCount: number(database.user_type_count),
      unknownObjectCount: number(database.unknown_object_count),
      customSchemaCount: number(database.custom_schema_count),
      unownedObjectCount: number(database.unowned_object_count),
      unexpectedGrantCount: number(database.unexpected_grant_count),
      providerObjectCount: number(database.provider_object_count),
      providerGrantCount: number(database.provider_grant_count),
      auxiliaryRelationCount: number(database.user_auxiliary_relation_count),
      privateTableNames: database.private_table_names ?? [],
      privateSchemaExists: boolean(database.private_schema_exists),
      legacyLedgerPresent: boolean(database.ledger_exists),
      bucket: {
        exists: boolean(database.bucket_exists),
        public: database.bucket_public === null || database.bucket_public === undefined
          ? null
          : boolean(database.bucket_public),
      },
    },
  };
}

export function createHostedInspector({ accessToken, projectRef, authorization, authorize, fetchImpl = fetch }) {
  if (!accessToken) throw new PlanFailure('CREDENTIAL_MISSING');
  if (!projectRef) throw new PlanFailure('PROJECT_REF_MISSING');
  assertAuthorizationCurrent(authorization);
  if (authorization.projectRef !== projectRef) {
    throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  }
  const base = 'https://api.supabase.com';
  const ref = encodeURIComponent(projectRef);

  async function request(path, options = {}) {
    const fresh = authorize === undefined ? authorization : await authorize();
    assertAuthorizationCurrent(fresh);
    if (fresh.runtimeManifestSha256 !== authorization.runtimeManifestSha256 || fresh.approvalSha256 !== authorization.approvalSha256) {
      throw new PlanFailure('INSTALL_AUTHORIZATION_MISMATCH');
    }
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...options,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          ...options.headers,
        },
      });
    } catch {
      throw new PlanFailure('PROVIDER_UNREADABLE');
    }
    if (response.status === 401) throw new PlanFailure('CREDENTIAL_INVALID');
    if (response.status === 403) throw new PlanFailure('CREDENTIAL_INSUFFICIENT');
    if (!response.ok) throw new PlanFailure('PROVIDER_UNREADABLE');
    try {
      return await response.json();
    } catch {
      throw new PlanFailure('PROVIDER_UNREADABLE');
    }
  }

  async function projectEvidence() {
    assertAuthorizationCurrent(authorization);
    const project = await request(`/v1/projects/${ref}`);
    if ((project.ref ?? project.id) !== projectRef || typeof project.organization_id !== 'string') {
      throw new PlanFailure('OWNER_EVIDENCE_MISSING');
    }
    if (project.organization_id !== authorization.expectedOwnerOrgId) throw new PlanFailure('OWNER_MISMATCH');
    return project;
  }

  async function readOnlyQuery(query) {
    const payload = await request(`/v1/projects/${ref}/database/query/read-only`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    const row = firstRow(payload);
    if (row === null) throw new PlanFailure('PROVIDER_UNREADABLE');
    return row;
  }

  return {
    async inspect() {
      const project = await projectEvidence();
      const [authConfig, database, providerInventoryRow] = await Promise.all([
        request(`/v1/projects/${ref}/config/auth`),
        readOnlyQuery(DATABASE_STATE_QUERY),
        readOnlyQuery(PROVIDER_INVENTORY_QUERY),
      ]);
      const auth = safeAuth(authConfig);
      for (const key of [
        'auth_user_count','bucket_count','storage_object_count','user_routine_count','user_type_count',
        'unknown_object_count','custom_schema_count','unowned_object_count','installation_unowned_object_count',
        'installation_unowned_schema_count','unexpected_grant_count','installation_unexpected_grant_count',
        'provider_object_count','provider_grant_count',
        'user_auxiliary_relation_count','user_table_count','user_row_estimate',
      ]) {
        const value = database[key];
        if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))
          || !Number.isSafeInteger(Number(value))) throw new PlanFailure('PROVIDER_UNREADABLE');
      }
      const observedDatabaseVersion = canonicalDatabaseVersion(database.database_version);
      const controlDatabaseVersion = canonicalDatabaseVersion(project.database?.version);
      if (observedDatabaseVersion !== controlDatabaseVersion) {
        throw new PlanFailure('PROVIDER_UNREADABLE');
      }
      const providerInventory = normalizeProviderInventory(providerInventoryRow);
      if (providerInventory.objects.length !== number(database.provider_object_count)
        || providerInventory.grants.length !== number(database.provider_grant_count)) {
        throw new PlanFailure('PROVIDER_UNREADABLE');
      }
      const metadataTables = [...INSTALL_METADATA_TABLES].sort();
      const privateTables = database.private_table_names;
      if (!Array.isArray(privateTables)) throw new PlanFailure('PROVIDER_UNREADABLE');
      let installState = null;
      if (privateTables.length > 0) {
        if (JSON.stringify([...privateTables].sort()) !== JSON.stringify(metadataTables)) {
          throw new PlanFailure('RESOURCE_OWNERSHIP_MISMATCH');
        }
        installState = (await readOnlyQuery(buildInstallStateQuery(authorization.installationId))).install_state;
        if (installState === null || typeof installState !== 'object') throw new PlanFailure('RESOURCE_OWNERSHIP_MISMATCH');
      }
      const cron = boolean(database.cron_exists)
        ? await readOnlyQuery('SELECT count(*)::integer AS count FROM cron.job') : { count: 0 };
      const databaseFingerprint = hashDatabaseInstallFingerprint(
        [await readOnlyQuery(DATABASE_INSTALL_FINGERPRINT_QUERY)],
        providerInventory,
      );
      const inventoryDatabase = { ...database };
      // Installation-owned candidates are exempt only after the durable catalog
      // fingerprint proves they are the exact state recorded by this journal.
      if (installState?.journal?.databaseFingerprint === databaseFingerprint) {
        const installationObjectCount = number(database.installation_unowned_object_count);
        const installationSchemaCount = number(database.installation_unowned_schema_count);
        const installationGrantCount = number(database.installation_unexpected_grant_count);
        if (installationObjectCount > number(database.unowned_object_count)
          || installationSchemaCount > number(database.custom_schema_count)
          || installationGrantCount > number(database.unexpected_grant_count)) {
          throw new PlanFailure('PROVIDER_UNREADABLE');
        }
        inventoryDatabase.unowned_object_count = number(database.unowned_object_count) - installationObjectCount;
        inventoryDatabase.unknown_object_count = inventoryDatabase.unowned_object_count;
        inventoryDatabase.custom_schema_count = number(database.custom_schema_count) - installationSchemaCount;
        inventoryDatabase.unexpected_grant_count = number(database.unexpected_grant_count) - installationGrantCount;
      }
      const authState = Object.fromEntries([
        'disable_signup','external_anonymous_users_enabled','external_email_enabled','mailer_autoconfirm',
        'mfa_max_enrolled_factors','mfa_totp_enroll_enabled','mfa_totp_verify_enabled',
        'refresh_token_rotation_enabled','security_captcha_enabled','jwt_exp','site_url',
        'sessions_single_per_user',
      ].map(key => [key, authConfig[key] ?? null]));
      return {
        project: {
          region: typeof project.region === 'string' ? project.region : null,
          ownerOrgIdHash: createHash('sha256').update(project.organization_id, 'utf8').digest('hex'),
          databaseVersion: observedDatabaseVersion,
          status: typeof project.status === 'string' && /^[A-Z_]+$/u.test(project.status)
            ? project.status
            : 'UNKNOWN',
        },
        ...normalizeDatabaseSnapshot({
          database: inventoryDatabase,
          migration: null,
          auth,
          authFingerprint: fingerprint(authState),
          institutionDataFingerprint: '',
        }),
        providerInventory,
        installState,
        databaseFingerprint,
        cronJobCount: number(cron.count),
      };
    },
  };
}
