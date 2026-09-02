import { createHash } from 'node:crypto';

import { PlanFailure } from './plan.mjs';

export const DATABASE_STATE_QUERY = `SELECT
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
      policy.polpermissive::text, policy.polcmd::text, policy.polroles::text,
      COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ''),
      COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '')),
    ',' ORDER BY namespace.nspname, relation.relname, policy.polname
  ), ''))
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public') AS policy_fingerprint,
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    pg_catalog.to_jsonb(bucket)::text,
    ',' ORDER BY bucket.id
  ), '')) FROM storage.buckets AS bucket) AS bucket_fingerprint,
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
  EXISTS(SELECT 1 FROM storage.buckets AS bucket WHERE bucket.id = 'ccc-session-audio') AS bucket_exists,
  (SELECT bucket.public FROM storage.buckets AS bucket WHERE bucket.id = 'ccc-session-audio') AS bucket_public,
  pg_catalog.current_setting('server_version') AS database_version,
  (pg_catalog.current_setting('transaction_read_only') = 'on') AS read_only,
  pg_catalog.has_database_privilege(CURRENT_USER, pg_catalog.current_database(), 'CONNECT') AS database_readable,
  EXISTS(SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'ccc_schema_migrations' AND relation.relkind IN ('r', 'p')) AS ledger_exists`;

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

export function normalizeDatabaseSnapshot({ database, migration, auth, authFingerprint = fingerprint(auth), institutionDataFingerprint = '' }) {
  const ledgerExists = boolean(database.ledger_exists);
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
      institutionDataFingerprint,
      userTableCount: number(database.user_table_count),
      userRowEstimate: number(database.user_row_estimate),
      rlsEnabledTableCount: number(database.rls_enabled_table_count),
      policyCount: number(database.policy_count),
      bucket: {
        exists: boolean(database.bucket_exists),
        public: database.bucket_public === null || database.bucket_public === undefined
          ? null
          : boolean(database.bucket_public),
      },
    },
  };
}

export function createHostedInspector({ accessToken, projectRef, fetchImpl = fetch }) {
  if (!accessToken) throw new PlanFailure('CREDENTIAL_MISSING');
  if (!projectRef) throw new PlanFailure('PROJECT_REF_MISSING');
  const base = 'https://api.supabase.com';
  const ref = encodeURIComponent(projectRef);

  async function request(path, options = {}) {
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
      const [project, authConfig, database] = await Promise.all([
        request(`/v1/projects/${ref}`),
        request(`/v1/projects/${ref}/config/auth`),
        readOnlyQuery(DATABASE_STATE_QUERY),
      ]);
      const auth = safeAuth(authConfig);
      const migration = boolean(database.ledger_exists) ? await readOnlyQuery(LEDGER_QUERY) : null;
      const dataEntries = await Promise.all(publicDataTableNames(database).map(async (tableName) => ({
        tableName,
        row: await readOnlyQuery(dataFingerprintQuery(tableName)),
      })));
      const institutionDataFingerprint = fingerprintPublicData(dataEntries);
      return {
        project: {
          region: typeof project.region === 'string' ? project.region : null,
          databaseVersion: typeof project.database?.version === 'string' && /^[0-9.]+$/u.test(project.database.version)
            ? project.database.version
            : null,
          status: typeof project.status === 'string' && /^[A-Z_]+$/u.test(project.status)
            ? project.status
            : 'UNKNOWN',
        },
        ...normalizeDatabaseSnapshot({
          database,
          migration,
          auth,
          authFingerprint: fingerprint(authConfig),
          institutionDataFingerprint,
        }),
      };
    },
  };
}
