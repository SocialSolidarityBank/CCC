import { createHash } from 'node:crypto';
import { canonicalizeJcs } from '../../apps/community-cloud/dist/install-manifest-verifier.js';
import { assertAuthorizationMatches } from './manifest-preflight.mjs';

const HASH = /^[0-9a-f]{64}$/u;
const INSTALLATION_ID_MAX_LENGTH = 256;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const CONTRACT_VERSION = 'S11-install-approval-v1';
const PHASES = new Set(['planned', 'installing', 'installed', 'rollback_failed']);
const STEPS = new Set([
  'baseline', 'platform_migration', 'auth_config', 'storage_bucket', 'cron_job',
  'edge_secret_binding', 'receipt', 'prepare_backup', 'verify_manifest', 'restore_data',
  'restore_provider_metadata', 'switch_release', 'verify_receipt',
]);
export const INSTALL_METADATA_TABLES = Object.freeze([
  'ccc_install_authorizations',
  'ccc_install_journal',
  'ccc_install_receipt',
  'ccc_install_resources',
  'ccc_install_steps',
  'ccc_release_history',
  'ccc_schema_migrations',
]);

export const INSTALL_METADATA_QUERY = `SELECT
  to_regclass('private.ccc_install_journal') IS NOT NULL AS journal_exists,
  ARRAY(
    SELECT relation.relname
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname IN (${INSTALL_METADATA_TABLES.map(name => `'${name}'`).join(', ')})
    ORDER BY relation.relname
  ) AS metadata_tables`;

export const DATABASE_INSTALL_FINGERPRINT_QUERY = `SELECT jsonb_build_object(
  'schemas', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, pg_catalog.pg_get_userbyid(namespace.nspowner), namespace.nspacl::text
    ) ORDER BY namespace.nspname)
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'namespaceDependencies', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname,
      dependency.classid, dependency.objid, dependency.objsubid, dependency.deptype,
      identified.type, identified.schema, identified.name, identified.identity
    ) ORDER BY namespace.nspname, dependency.classid, dependency.objid,
      dependency.objsubid, dependency.deptype)
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_namespace AS namespace
      ON dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dependency.refobjid = namespace.oid
    CROSS JOIN LATERAL pg_catalog.pg_identify_object(
      dependency.classid, dependency.objid, dependency.objsubid
    ) AS identified
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'relations', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, relation.relkind,
      relation.relrowsecurity, relation.relforcerowsecurity,
      pg_catalog.pg_get_userbyid(relation.relowner), relation.relacl::text, relation.reloptions
    ) ORDER BY namespace.nspname, relation.relname, relation.relkind)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private') AND relation.relkind IN ('r','p','v','m','S','f')
  ), '[]'::jsonb),
  'columns', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, attribute.attname,
      attribute.atttypid, attribute.atttypmod,
      attribute.attnotnull, attribute.attidentity, attribute.attgenerated,
      pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), attribute.attacl::text
    ) ORDER BY namespace.nspname, relation.relname, attribute.attnum)
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname IN ('public','private') AND relation.relkind IN ('r','p','v','m','f')
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ), '[]'::jsonb),
  'constraints', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, constraint_record.conname, constraint_record.contype,
      pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
    ) ORDER BY namespace.nspname, relation.relname, constraint_record.conname)
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'indexes', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, table_record.relname, index_record.relname,
      index_definition.indisunique, index_definition.indisprimary, index_definition.indisvalid,
      pg_catalog.pg_get_indexdef(index_definition.indexrelid)
    ) ORDER BY namespace.nspname, table_record.relname, index_record.relname)
    FROM pg_catalog.pg_index AS index_definition
    JOIN pg_catalog.pg_class AS table_record ON table_record.oid = index_definition.indrelid
    JOIN pg_catalog.pg_class AS index_record ON index_record.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_record.relnamespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'sequences', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, sequence.seqtypid, sequence.seqstart,
      sequence.seqincrement, sequence.seqmax, sequence.seqmin, sequence.seqcache, sequence.seqcycle
    ) ORDER BY namespace.nspname, relation.relname)
    FROM pg_catalog.pg_sequence AS sequence
    JOIN pg_catalog.pg_class AS relation ON relation.oid = sequence.seqrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'views', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, pg_catalog.pg_get_viewdef(relation.oid, true)
    ) ORDER BY namespace.nspname, relation.relname)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private') AND relation.relkind IN ('v','m')
  ), '[]'::jsonb),
  'routines', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, procedure.proname, procedure.prokind,
      procedure.proargtypes::text, procedure.proallargtypes::text,
      procedure.proargmodes, procedure.proargnames, procedure.proargdefaults::text,
      procedure.pronargdefaults, procedure.prorettype, procedure.proretset,
      language.lanname, procedure.prosecdef, procedure.proleakproof,
      procedure.proisstrict, procedure.provolatile, procedure.proparallel,
      procedure.prosupport, procedure.proacl::text, procedure.proconfig,
      procedure.procost, procedure.prorows, procedure.probin, procedure.prosrc,
      procedure.prosqlbody::text, pg_catalog.pg_get_userbyid(procedure.proowner)
    ) ORDER BY namespace.nspname, procedure.proname, procedure.proargtypes::text)
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname IN ('public','private') AND procedure.prokind <> 'a'
  ), '[]'::jsonb),
  'aggregates', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, procedure.proname, procedure.proargtypes::text,
      pg_catalog.pg_get_userbyid(procedure.proowner), procedure.proacl::text,
      procedure.proparallel, aggregate_record.aggkind, aggregate_record.aggnumdirectargs,
      aggregate_record.aggtransfn, aggregate_record.aggfinalfn,
      aggregate_record.aggcombinefn, aggregate_record.aggserialfn,
      aggregate_record.aggdeserialfn, aggregate_record.aggmtransfn,
      aggregate_record.aggminvtransfn, aggregate_record.aggmfinalfn,
      aggregate_record.aggfinalextra, aggregate_record.aggmfinalextra,
      aggregate_record.aggfinalmodify, aggregate_record.aggmfinalmodify,
      aggregate_record.aggsortop, aggregate_record.aggtranstype,
      aggregate_record.aggtransspace, aggregate_record.aggmtranstype,
      aggregate_record.aggmtransspace, aggregate_record.agginitval,
      aggregate_record.aggminitval
    ) ORDER BY namespace.nspname, procedure.proname, procedure.proargtypes::text)
    FROM pg_catalog.pg_aggregate AS aggregate_record
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = aggregate_record.aggfnoid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'triggers', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, trigger_record.tgname, trigger_record.tgenabled,
      pg_catalog.pg_get_triggerdef(trigger_record.oid, true)
    ) ORDER BY namespace.nspname, relation.relname, trigger_record.tgname)
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private') AND NOT trigger_record.tgisinternal
  ), '[]'::jsonb),
  'policies', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, relation.relname, policy.polname, policy.polpermissive, policy.polcmd,
      ARRAY(
        SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END
        FROM unnest(policy.polroles) AS role_oid
        ORDER BY 1
      ),
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) ORDER BY namespace.nspname, relation.relname, policy.polname)
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public','private')
  ), '[]'::jsonb),
  'types', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      namespace.nspname, type_record.typname, type_record.typtype,
      pg_catalog.pg_get_userbyid(type_record.typowner), type_record.typacl::text,
      CASE type_record.typtype
        WHEN 'e' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_array(enum.enumlabel, enum.enumsortorder)
            ORDER BY enum.enumsortorder)
          FROM pg_catalog.pg_enum AS enum
          WHERE enum.enumtypid = type_record.oid
        ), '[]'::jsonb)
        WHEN 'd' THEN jsonb_build_array(
          type_record.typbasetype, type_record.typtypmod,
          type_record.typnotnull,
          type_record.typdefaultbin::text, type_record.typdefault,
          type_record.typcollation
        )
        WHEN 'c' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_array(
            attribute.attname, attribute.atttypid, attribute.atttypmod,
            attribute.attcollation
          ) ORDER BY attribute.attnum)
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = type_record.typrelid
            AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ), '[]'::jsonb)
        WHEN 'r' THEN (
          SELECT jsonb_build_array(
            range_record.rngsubtype,
            range_record.rngsubopc,
            range_record.rngcollation,
            range_record.rngcanonical,
            range_record.rngsubdiff,
            range_record.rngmultitypid
          )
          FROM pg_catalog.pg_range AS range_record
          JOIN pg_catalog.pg_opclass AS opclass ON opclass.oid = range_record.rngsubopc
          JOIN pg_catalog.pg_namespace AS opclass_namespace ON opclass_namespace.oid = opclass.opcnamespace
          WHERE range_record.rngtypid = type_record.oid
        )
      END,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_array(
          constraint_record.conname, pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        ) ORDER BY constraint_record.conname)
        FROM pg_catalog.pg_constraint AS constraint_record
        WHERE constraint_record.contypid = type_record.oid
      ), '[]'::jsonb)
    ) ORDER BY namespace.nspname, type_record.typname)
    FROM pg_catalog.pg_type AS type_record
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_record.typnamespace
    LEFT JOIN pg_catalog.pg_class AS relation ON relation.oid = type_record.typrelid
    WHERE namespace.nspname IN ('public','private')
      AND type_record.typtype IN ('e','d','c','r')
      AND (type_record.typrelid = 0 OR relation.relkind = 'c')
  ), '[]'::jsonb),
  'apiRoles', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(rolname, rolcanlogin, rolsuper, rolinherit,
      rolcreaterole, rolcreatedb, rolreplication, rolbypassrls) ORDER BY rolname)
    FROM pg_catalog.pg_roles WHERE rolname IN ('ccc_api','ccc_schema_owner')
  ), '[]'::jsonb),
  'apiMemberships', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(pg_catalog.pg_get_userbyid(membership.roleid),
      pg_catalog.pg_get_userbyid(membership.member), membership.admin_option)
      ORDER BY membership.roleid, membership.member)
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('ccc_api','ccc_schema_owner'))
      OR membership.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('ccc_api','ccc_schema_owner'))
  ), '[]'::jsonb),
  'defaultPrivileges', COALESCE((
    SELECT jsonb_agg(jsonb_build_array(
      pg_catalog.pg_get_userbyid(default_acl.defaclrole),
      COALESCE(namespace.nspname, ''), default_acl.defaclobjtype, default_acl.defaclacl::text
    ) ORDER BY pg_catalog.pg_get_userbyid(default_acl.defaclrole),
      COALESCE(namespace.nspname, ''), default_acl.defaclobjtype)
    FROM pg_catalog.pg_default_acl AS default_acl
    LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = default_acl.defaclnamespace
    WHERE default_acl.defaclnamespace = 0 OR namespace.nspname IN ('public','private')
  ), '[]'::jsonb)
)::text AS catalog_state`;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function redactFailure(error, fallbackCode) {
  if (typeof error?.code === 'string' && error.message === error.code && ERROR_CODE.test(error.code)) {
    return error;
  }
  return failure(fallbackCode);
}

export function hashDatabaseInstallFingerprint(rows, providerInventory) {
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.catalog_state !== 'string'
    || !Array.isArray(providerInventory?.objects)
    || !Array.isArray(providerInventory?.grants)
    || !Array.isArray(providerInventory?.installationObjects)
    || !Array.isArray(providerInventory?.installationGrants)) {
    throw failure('INSTALL_JOURNAL_INVALID');
  }
  return createHash('sha256').update(canonicalizeJcs({
    catalogState: rows[0].catalog_state,
    providerObjects: providerInventory.objects,
    providerGrants: providerInventory.grants,
    installationObjects: providerInventory.installationObjects,
    installationGrants: providerInventory.installationGrants,
  }), 'utf8').digest('hex');
}

export async function readDatabaseInstallFingerprint(session) {
  try {
    const { normalizeProviderInventory, PROVIDER_INVENTORY_QUERY } =
      await import('./provider-inventory.mjs');
    const rows = await session.unsafe(DATABASE_INSTALL_FINGERPRINT_QUERY);
    const providerRows = await session.unsafe(PROVIDER_INVENTORY_QUERY);
    if (!Array.isArray(providerRows) || providerRows.length !== 1) {
      throw failure('INSTALL_JOURNAL_INVALID');
    }
    return hashDatabaseInstallFingerprint(rows, normalizeProviderInventory(providerRows[0]));
  } catch {
    throw failure('INSTALL_JOURNAL_INVALID');
  }
}

function requireHash(value, code = 'INSTALL_AUTHORIZATION_MISMATCH') {
  if (typeof value !== 'string' || !HASH.test(value)) throw failure(code);
  return value;
}

function requireInstallationId(value) {
  if (typeof value !== 'string' || value.length === 0
    || value.length > INSTALLATION_ID_MAX_LENGTH || value.includes('\0')) {
    throw failure('OWNER_EVIDENCE_MISSING');
  }
  return value;
}

function requireSafeName(value, code = 'INSTALL_JOURNAL_INVALID') {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw failure(code);
  return value;
}

function requireExpiry(value) {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(milliseconds) || milliseconds <= Date.now()) throw failure('OWNER_EVIDENCE_MISSING');
  return new Date(milliseconds).toISOString();
}

function validateAuthorization(authorization) {
  if (authorization === null || typeof authorization !== 'object') throw failure('OWNER_EVIDENCE_MISSING');
  requireInstallationId(authorization.installationId);
  requireHash(authorization.institutionIdHash);
  requireHash(authorization.projectRefHash);
  requireHash(authorization.expectedOwnerOrgIdHash);
  requireHash(authorization.runtimeManifestSha256);
  requireHash(authorization.approvalSha256);
  requireHash(authorization.runtimeConfigurationSha256);
  if (authorization.contractVersion !== CONTRACT_VERSION) throw failure('INSTALL_AUTHORIZATION_MISMATCH');
  if (!Number.isSafeInteger(authorization.runtimeSequence) || authorization.runtimeSequence < 0) {
    throw failure('INSTALL_AUTHORIZATION_MISMATCH');
  }
  return { ...authorization, expiresAt: requireExpiry(authorization.expiresAt) };
}

function validateDesired(desired) {
  if (desired === null || typeof desired !== 'object') throw failure('INSTALL_AUTHORIZATION_MISMATCH');
  return {
    resourcesSha256: requireHash(desired.resourcesSha256),
    migrationsSha256: requireHash(desired.migrationsSha256),
    planFingerprint: requireHash(desired.planFingerprint),
  };
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeSequence(value) {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw failure('INSTALL_JOURNAL_INVALID');
  return sequence;
}

function assertCurrentAuthorization(row, authorization, desired, { renewal = false } = {}) {
  const previous = {
    installationId: row.installation_id,
    institutionIdHash: row.institution_id_hash,
    projectRefHash: row.project_ref_hash,
    expectedOwnerOrgIdHash: row.expected_owner_org_id_hash,
    runtimeManifestSha256: row.runtime_manifest_sha256,
    approvalSha256: row.approval_sha256,
    runtimeConfigurationSha256: row.runtime_configuration_sha256,
    contractVersion: row.contract_version,
    runtimeSequence: normalizeSequence(row.runtime_sequence),
    expiresAt: normalizeTimestamp(row.expires_at),
    resourcesSha256: row.resources_sha256,
    migrationsSha256: row.migrations_sha256,
  };
  assertAuthorizationMatches(previous, authorization, {
    renewAuthorization: renewal,
    resourcesSha256: desired.resourcesSha256,
    migrationsSha256: desired.migrationsSha256,
  });
  if (row.plan_fingerprint !== desired.planFingerprint) throw failure('INSTALL_AUTHORIZATION_MISMATCH');
  if (!renewal && (authorization.runtimeSequence !== previous.runtimeSequence
    || authorization.expiresAt !== previous.expiresAt)) {
    throw failure('INSTALL_AUTHORIZATION_MISMATCH');
  }
}

function desiredFromRow(row) {
  return {
    resourcesSha256: row.resources_sha256,
    migrationsSha256: row.migrations_sha256,
    planFingerprint: row.plan_fingerprint,
  };
}

async function currentJournal(session, installationId, lock = false) {
  const rows = await session.unsafe(`SELECT * FROM private.ccc_install_journal
    WHERE installation_id = $1${lock ? ' FOR UPDATE' : ''}`, [installationId]);
  return rows[0] ?? null;
}

async function requireCurrentJournal(session, authorization, lock = false) {
  const row = await currentJournal(session, authorization.installationId, lock);
  if (row !== null) return row;
  const foreign = await session.unsafe(
    'SELECT 1 FROM private.ccc_install_journal WHERE project_ref_hash = $1 LIMIT 1',
    [authorization.projectRefHash],
  );
  if (foreign.length > 0) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  throw failure('INSTALL_JOURNAL_MISSING');
}

function assertFreshAuthorizationPair(expected, desired, fresh) {
  const verified = validateAuthorization(fresh);
  assertAuthorizationMatches({ ...expected, ...desired }, verified, {
    resourcesSha256: desired.resourcesSha256,
    migrationsSha256: desired.migrationsSha256,
  });
  return verified;
}

function assertFreshAuthorization(current, expected, fresh) {
  const desired = desiredFromRow(current);
  assertCurrentAuthorization(current, expected, desired);
  const verified = assertFreshAuthorizationPair(expected, desired, fresh);
  assertCurrentAuthorization(current, verified, desired);
  return verified;
}

// postgres.js reserve() exposes unsafe/release, not begin(). Keep the advisory
// lock and every statement on that reserved connection throughout the transaction.
async function installTransaction(session, write) {
  if (typeof session?.release !== 'function') throw failure('INSTALL_JOURNAL_INVALID');
  await session.unsafe('BEGIN');
  try {
    const result = await write(session);
    await session.unsafe('COMMIT');
    return result;
  } catch (error) {
    await session.unsafe('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function authorizedWrite(session, authorization, authorize, write) {
  const expected = validateAuthorization(authorization);
  if (typeof authorize !== 'function') throw failure('OWNER_EVIDENCE_MISSING');
  return installTransaction(session, async transaction => {
    const current = await requireCurrentJournal(transaction, expected, true);
    assertFreshAuthorization(current, expected, await authorize());
    const result = await write(transaction, current);
    assertFreshAuthorization(current, expected, await authorize());
    return result;
  });
}

function ownershipTag(installationId) {
  return `ccc.installation_id=${installationId}`;
}

function requireOwnershipTags(tags, installationId) {
  if (!Array.isArray(tags) || tags.length !== 1 || tags[0] !== ownershipTag(installationId)) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return tags;
}

function requireHashArray(values, code = 'RESOURCE_OWNERSHIP_MISMATCH') {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !HASH.test(value))) {
    throw failure(code);
  }
  return values;
}

function requireStep(step) {
  if (!STEPS.has(step)) throw failure('INSTALL_JOURNAL_INVALID');
  return step;
}

function sqlLiteral(value) {
  requireInstallationId(value);
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildInstallStateQuery(installationId) {
  const id = sqlLiteral(installationId);
  return `SELECT jsonb_build_object(
    'journal', jsonb_build_object(
      'installationId', journal.installation_id,
      'institutionIdHash', journal.institution_id_hash,
      'projectRefHash', journal.project_ref_hash,
      'expectedOwnerOrgIdHash', journal.expected_owner_org_id_hash,
      'runtimeManifestSha256', journal.runtime_manifest_sha256,
      'approvalSha256', journal.approval_sha256,
      'runtimeConfigurationSha256', journal.runtime_configuration_sha256,
      'contractVersion', journal.contract_version,
      'runtimeSequence', journal.runtime_sequence,
      'expiresAt', journal.expires_at,
      'resourcesSha256', journal.resources_sha256,
      'migrationsSha256', journal.migrations_sha256,
      'phase', journal.phase,
      'currentStep', journal.current_step,
      'planFingerprint', journal.plan_fingerprint,
      'databaseFingerprint', journal.database_fingerprint,
      'stateFingerprint', journal.state_fingerprint,
      'lastErrorCode', journal.last_error_code,
      'createdAt', journal.created_at,
      'updatedAt', journal.updated_at
    ),
    'authorizationHistory', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'runtimeSequence', authorization_record.runtime_sequence,
        'runtimeManifestSha256', authorization_record.runtime_manifest_sha256,
        'approvalSha256', authorization_record.approval_sha256,
        'runtimeConfigurationSha256', authorization_record.runtime_configuration_sha256,
        'contractVersion', authorization_record.contract_version,
        'expiresAt', authorization_record.expires_at,
        'recordedAt', authorization_record.recorded_at
      ) ORDER BY authorization_record.runtime_sequence)
      FROM private.ccc_install_authorizations AS authorization_record
      WHERE authorization_record.installation_id = journal.installation_id
    ), '[]'::jsonb),
    'migrations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', migration.id,
        'checksum', migration.checksum,
        'appliedAt', migration.applied_at
      ) ORDER BY migration.id)
      FROM private.ccc_schema_migrations AS migration
      WHERE migration.installation_id = journal.installation_id
    ), '[]'::jsonb),
    'completedSteps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'step', step.step,
        'idempotencyKey', step.idempotency_key,
        'ownershipTags', step.ownership_tags,
        'providerResourceIdHashes', step.provider_resource_id_hashes,
        'providerResourceDigests', step.provider_resource_digests,
        'stateFingerprint', step.state_fingerprint,
        'completedAt', step.completed_at
      ) ORDER BY step.completed_at, step.step)
      FROM private.ccc_install_steps AS step
      WHERE step.installation_id = journal.installation_id AND step.status = 'completed'
    ), '[]'::jsonb),
    'resources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'resourceType', resource.resource_type,
        'resourceIdHash', resource.resource_id_hash,
        'resourceDigest', resource.resource_digest,
        'ownershipTag', resource.ownership_tag,
        'recordedAt', resource.recorded_at
      ) ORDER BY resource.resource_type, resource.resource_id_hash)
      FROM private.ccc_install_resources AS resource
      WHERE resource.installation_id = journal.installation_id
    ), '[]'::jsonb),
    'currentReceipt', (
      SELECT jsonb_build_object(
        'contract', receipt.contract,
        'contractVersion', receipt.contract_version,
        'installationId', receipt.installation_id,
        'institutionIdHash', receipt.institution_id_hash,
        'rollbackTarget', receipt.rollback_target,
        'expectedOwnerOrgIdHash', receipt.expected_owner_org_id_hash,
        'observedOwnerOrgIdHash', receipt.observed_owner_org_id_hash,
        'releaseVersion', receipt.release_version,
        'releaseSequence', receipt.release_sequence,
        'manifestDigest', receipt.manifest_digest,
        'artifactSetDigest', receipt.artifact_set_digest,
        'migrationHead', receipt.migration_head,
        'schemaFingerprint', receipt.schema_fingerprint,
        'edgeRegionEvidence', receipt.edge_region_evidence,
        'providerResourceDigests', receipt.provider_resource_digests,
        'backupId', receipt.backup_id,
        'backupDigest', receipt.backup_digest,
        'priorReceiptDigest', receipt.prior_receipt_digest,
        'recordedAt', receipt.recorded_at,
        'status', receipt.status
      )
      FROM private.ccc_install_receipt AS receipt
      WHERE receipt.installation_id = journal.installation_id
    ),
    'releaseHistory', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'contract', history.contract,
        'contractVersion', history.contract_version,
        'installationId', history.installation_id,
        'institutionIdHash', history.institution_id_hash,
        'rollbackTarget', history.rollback_target,
        'expectedOwnerOrgIdHash', history.expected_owner_org_id_hash,
        'observedOwnerOrgIdHash', history.observed_owner_org_id_hash,
        'releaseVersion', history.release_version,
        'releaseSequence', history.release_sequence,
        'manifestDigest', history.manifest_digest,
        'artifactSetDigest', history.artifact_set_digest,
        'migrationHead', history.migration_head,
        'schemaFingerprint', history.schema_fingerprint,
        'edgeRegionEvidence', history.edge_region_evidence,
        'providerResourceDigests', history.provider_resource_digests,
        'backupId', history.backup_id,
        'backupDigest', history.backup_digest,
        'priorReceiptDigest', history.prior_receipt_digest,
        'recordedAt', history.recorded_at,
        'status', history.status
      ) ORDER BY history.release_sequence)
      FROM private.ccc_release_history AS history
      WHERE history.installation_id = journal.installation_id
    ), '[]'::jsonb)
  ) AS install_state
  FROM private.ccc_install_journal AS journal
  WHERE journal.installation_id = ${id}`;
}

export async function withInstallLock(sql, projectRefHash, callback) {
  requireHash(projectRefHash, 'INSTALL_LOCK_BUSY');
  if (typeof callback !== 'function') throw failure('INSTALL_JOURNAL_INVALID');
  const session = await sql.reserve();
  let locked = false;
  try {
    const [result] = await session.unsafe(
      "SELECT pg_try_advisory_lock(('x' || substr($1, 1, 16))::bit(64)::bigint) AS locked",
      [projectRefHash],
    );
    locked = result?.locked === true;
    if (!locked) throw failure('INSTALL_LOCK_BUSY');
    return await callback(session);
  } finally {
    try {
      if (locked) {
        await session.unsafe(
          "SELECT pg_advisory_unlock(('x' || substr($1, 1, 16))::bit(64)::bigint)",
          [projectRefHash],
        );
      }
    } finally {
      await session.release();
    }
  }
}

export async function readInstallState(session, installationId) {
  requireInstallationId(installationId);
  const [metadata] = await session.unsafe(INSTALL_METADATA_QUERY);
  const present = metadata?.metadata_tables ?? [];
  if (present.length === 0) return null;
  if (present.length !== INSTALL_METADATA_TABLES.length || metadata.journal_exists !== true) throw failure('INSTALL_JOURNAL_INVALID');
  const rows = await session.unsafe(buildInstallStateQuery(installationId));
  if (rows.length === 0) return null;
  const state = typeof rows[0].install_state === 'string' ? JSON.parse(rows[0].install_state) : rows[0].install_state;
  state.journal.runtimeSequence = normalizeSequence(state.journal.runtimeSequence);
  if (state.currentReceipt !== null) state.currentReceipt.releaseSequence = normalizeSequence(state.currentReceipt.releaseSequence);
  for (const item of state.releaseHistory) item.releaseSequence = normalizeSequence(item.releaseSequence);
  for (const item of state.authorizationHistory) item.runtimeSequence = normalizeSequence(item.runtimeSequence);
  return state;
}

const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.ccc_install_journal (
  installation_id text PRIMARY KEY CHECK (char_length(installation_id) BETWEEN 1 AND 256),
  institution_id_hash text NOT NULL CHECK (institution_id_hash ~ '^[0-9a-f]{64}$'),
  project_ref_hash text NOT NULL UNIQUE CHECK (project_ref_hash ~ '^[0-9a-f]{64}$'),
  expected_owner_org_id_hash text NOT NULL CHECK (expected_owner_org_id_hash ~ '^[0-9a-f]{64}$'),
  runtime_manifest_sha256 text NOT NULL CHECK (runtime_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  approval_sha256 text NOT NULL CHECK (approval_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_configuration_sha256 text NOT NULL CHECK (runtime_configuration_sha256 ~ '^[0-9a-f]{64}$'),
  contract_version text NOT NULL CHECK (contract_version = 'S11-install-approval-v1'),
  runtime_sequence bigint NOT NULL CHECK (runtime_sequence BETWEEN 0 AND 9007199254740991),
  expires_at timestamptz NOT NULL,
  resources_sha256 text NOT NULL CHECK (resources_sha256 ~ '^[0-9a-f]{64}$'),
  migrations_sha256 text NOT NULL CHECK (migrations_sha256 ~ '^[0-9a-f]{64}$'),
  phase text NOT NULL CHECK (phase IN ('planned','installing','installed','rollback_failed')),
  current_step text,
  plan_fingerprint text NOT NULL CHECK (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  database_fingerprint text NOT NULL CHECK (database_fingerprint ~ '^[0-9a-f]{64}$'),
  state_fingerprint text CHECK (state_fingerprint IS NULL OR state_fingerprint ~ '^[0-9a-f]{64}$'),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.ccc_install_authorizations (
  installation_id text NOT NULL REFERENCES private.ccc_install_journal(installation_id),
  runtime_sequence bigint NOT NULL CHECK (runtime_sequence BETWEEN 0 AND 9007199254740991),
  runtime_manifest_sha256 text NOT NULL CHECK (runtime_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  approval_sha256 text NOT NULL CHECK (approval_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_configuration_sha256 text NOT NULL CHECK (runtime_configuration_sha256 ~ '^[0-9a-f]{64}$'),
  contract_version text NOT NULL CHECK (contract_version = 'S11-install-approval-v1'),
  expires_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, runtime_sequence)
);

CREATE TABLE private.ccc_install_steps (
  installation_id text NOT NULL REFERENCES private.ccc_install_journal(installation_id),
  step text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('started','completed')),
  ownership_tags text[] NOT NULL DEFAULT '{}',
  provider_resource_id_hashes text[] NOT NULL DEFAULT '{}',
  provider_resource_digests text[] NOT NULL DEFAULT '{}',
  state_fingerprint text CHECK (state_fingerprint IS NULL OR state_fingerprint ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (installation_id, step, idempotency_key),
  CHECK ((status = 'started' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL))
);

CREATE TABLE private.ccc_schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  installation_id text NOT NULL REFERENCES private.ccc_install_journal(installation_id),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.ccc_install_resources (
  installation_id text NOT NULL REFERENCES private.ccc_install_journal(installation_id),
  resource_type text NOT NULL,
  resource_id_hash text NOT NULL CHECK (resource_id_hash ~ '^[0-9a-f]{64}$'),
  resource_digest text NOT NULL CHECK (resource_digest ~ '^[0-9a-f]{64}$'),
  ownership_tag text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, resource_type, resource_id_hash),
  CHECK (ownership_tag = 'ccc.installation_id=' || installation_id)
);

CREATE TABLE private.ccc_install_receipt (
  installation_id text PRIMARY KEY REFERENCES private.ccc_install_journal(installation_id),
  contract text NOT NULL CHECK (contract = 'S11'),
  contract_version text NOT NULL CHECK (contract_version = '0.3'),
  institution_id_hash text NOT NULL CHECK (institution_id_hash ~ '^[0-9a-f]{64}$'),
  rollback_target jsonb,
  expected_owner_org_id_hash text NOT NULL CHECK (expected_owner_org_id_hash ~ '^[0-9a-f]{64}$'),
  observed_owner_org_id_hash text NOT NULL CHECK (observed_owner_org_id_hash ~ '^[0-9a-f]{64}$'),
  release_version text NOT NULL,
  release_sequence bigint NOT NULL CHECK (release_sequence BETWEEN 1 AND 9007199254740991),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  artifact_set_digest text NOT NULL CHECK (artifact_set_digest ~ '^[0-9a-f]{64}$'),
  migration_head text NOT NULL,
  schema_fingerprint text NOT NULL CHECK (schema_fingerprint ~ '^[0-9a-f]{64}$'),
  edge_region_evidence jsonb NOT NULL,
  provider_resource_digests jsonb NOT NULL,
  backup_id text,
  backup_digest text CHECK (backup_digest IS NULL OR backup_digest ~ '^[0-9a-f]{64}$'),
  prior_receipt_digest text CHECK (prior_receipt_digest IS NULL OR prior_receipt_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('installed','rollback_failed'))
);

CREATE TABLE private.ccc_release_history (
  installation_id text NOT NULL REFERENCES private.ccc_install_journal(installation_id),
  contract text NOT NULL CHECK (contract = 'S11'),
  contract_version text NOT NULL CHECK (contract_version = '0.3'),
  institution_id_hash text NOT NULL CHECK (institution_id_hash ~ '^[0-9a-f]{64}$'),
  rollback_target jsonb,
  expected_owner_org_id_hash text NOT NULL CHECK (expected_owner_org_id_hash ~ '^[0-9a-f]{64}$'),
  observed_owner_org_id_hash text NOT NULL CHECK (observed_owner_org_id_hash ~ '^[0-9a-f]{64}$'),
  release_version text NOT NULL,
  release_sequence bigint NOT NULL CHECK (release_sequence BETWEEN 1 AND 9007199254740991),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  artifact_set_digest text NOT NULL CHECK (artifact_set_digest ~ '^[0-9a-f]{64}$'),
  migration_head text NOT NULL,
  schema_fingerprint text NOT NULL CHECK (schema_fingerprint ~ '^[0-9a-f]{64}$'),
  edge_region_evidence jsonb NOT NULL,
  provider_resource_digests jsonb NOT NULL,
  backup_id text,
  backup_digest text CHECK (backup_digest IS NULL OR backup_digest ~ '^[0-9a-f]{64}$'),
  prior_receipt_digest text CHECK (prior_receipt_digest IS NULL OR prior_receipt_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('installed','rollback_failed')),
  PRIMARY KEY (installation_id, release_sequence)
);

CREATE FUNCTION private.ccc_install_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, private AS $function$
BEGIN
  RAISE EXCEPTION 'append-only table';
END
$function$;

CREATE TRIGGER ccc_install_authorizations_no_change
  BEFORE UPDATE OR DELETE OR TRUNCATE ON private.ccc_install_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION private.ccc_install_append_only();
CREATE TRIGGER ccc_schema_migrations_no_change
  BEFORE UPDATE OR DELETE OR TRUNCATE ON private.ccc_schema_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION private.ccc_install_append_only();
CREATE TRIGGER ccc_release_history_no_change
  BEFORE UPDATE OR DELETE OR TRUNCATE ON private.ccc_release_history
  FOR EACH STATEMENT EXECUTE FUNCTION private.ccc_install_append_only();

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','ccc_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA private FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA private FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM %I', role_name);
    END IF;
  END LOOP;
END
$roles$;`;

export async function bootstrapInstall(session, authorization, desired, { authorize } = {}) {
  const verified = validateAuthorization(authorization);
  const expected = validateDesired(desired);
  if (typeof authorize !== 'function') throw failure('OWNER_EVIDENCE_MISSING');
  return installTransaction(session, async transaction => {
    assertFreshAuthorizationPair(verified, expected, await authorize());
    const [existing] = await transaction.unsafe(`SELECT
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'private'
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'private'
      ) AS has_objects,
      current_user IN ('anon','authenticated','ccc_api') AS forbidden_role`);
    if (existing.has_objects) throw failure('EXISTING_PROJECT_NOT_CLEAN');
    if (existing.forbidden_role) throw failure('CREDENTIAL_INSUFFICIENT');
    await transaction.unsafe(BOOTSTRAP_SQL);
    const databaseFingerprint = await readDatabaseInstallFingerprint(transaction);
    await transaction.unsafe(`INSERT INTO private.ccc_install_journal (
      installation_id, institution_id_hash, project_ref_hash, expected_owner_org_id_hash,
      runtime_manifest_sha256, approval_sha256, runtime_configuration_sha256, contract_version,
      runtime_sequence, expires_at, resources_sha256, migrations_sha256, phase, plan_fingerprint,
      database_fingerprint
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'planned',$13,$14)`, [
      verified.installationId, verified.institutionIdHash, verified.projectRefHash,
      verified.expectedOwnerOrgIdHash, verified.runtimeManifestSha256, verified.approvalSha256,
      verified.runtimeConfigurationSha256, verified.contractVersion, verified.runtimeSequence,
      verified.expiresAt, expected.resourcesSha256, expected.migrationsSha256, expected.planFingerprint,
      databaseFingerprint,
    ]);
    await transaction.unsafe(`INSERT INTO private.ccc_install_authorizations (
      installation_id, runtime_sequence, runtime_manifest_sha256, approval_sha256,
      runtime_configuration_sha256, contract_version, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      verified.installationId, verified.runtimeSequence, verified.runtimeManifestSha256,
      verified.approvalSha256, verified.runtimeConfigurationSha256, verified.contractVersion,
      verified.expiresAt,
    ]);
    const state = await readInstallState(transaction, verified.installationId);
    assertFreshAuthorizationPair(verified, expected, await authorize());
    return state;
  });
}

export async function ensureAuthorization(
  session,
  authorization,
  desired,
  { renewAuthorization = false, authorize } = {},
) {
  const verified = validateAuthorization(authorization);
  const expected = validateDesired(desired);
  if (typeof authorize !== 'function') throw failure('OWNER_EVIDENCE_MISSING');
  return installTransaction(session, async transaction => {
    assertFreshAuthorizationPair(verified, expected, await authorize());
    const current = await requireCurrentJournal(transaction, verified, true);
    const sameCurrentPair = normalizeSequence(current.runtime_sequence) === verified.runtimeSequence
      && current.runtime_manifest_sha256 === verified.runtimeManifestSha256
      && current.approval_sha256 === verified.approvalSha256;
    assertCurrentAuthorization(current, verified, expected, {
      renewal: renewAuthorization && !sameCurrentPair,
    });
    let result = { renewed: false };
    if (renewAuthorization && !sameCurrentPair) {
      await transaction.unsafe(`INSERT INTO private.ccc_install_authorizations (
        installation_id, runtime_sequence, runtime_manifest_sha256, approval_sha256,
        runtime_configuration_sha256, contract_version, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        verified.installationId, verified.runtimeSequence, verified.runtimeManifestSha256,
        verified.approvalSha256, verified.runtimeConfigurationSha256, verified.contractVersion,
        verified.expiresAt,
      ]);
      await transaction.unsafe(`UPDATE private.ccc_install_journal SET
        runtime_manifest_sha256 = $2,
        approval_sha256 = $3,
        runtime_sequence = $4,
        expires_at = $5,
        updated_at = clock_timestamp()
        WHERE installation_id = $1`, [
        verified.installationId, verified.runtimeManifestSha256, verified.approvalSha256,
        verified.runtimeSequence, verified.expiresAt,
      ]);
      result = { renewed: true };
    }
    assertFreshAuthorizationPair(verified, expected, await authorize());
    return result;
  });
}

const EXECUTE_MIGRATION_SQL = `CREATE OR REPLACE FUNCTION pg_temp.ccc_execute_install_migration(
  migration_sql text
) RETURNS void
LANGUAGE plpgsql
AS $migration$
BEGIN
  EXECUTE migration_sql;
END
$migration$`;

async function executeMigrationSql(transaction, sql) {
  await transaction.unsafe(EXECUTE_MIGRATION_SQL);
  await transaction.unsafe(
    'SELECT pg_temp.ccc_execute_install_migration($1)',
    [sql],
  );
}

async function migrationReceiptExists(transaction, current, expected, migration) {
  if (current.database_fingerprint !== await readDatabaseInstallFingerprint(transaction)) {
    throw failure('DRIFT_BLOCKED');
  }
  const receipts = await transaction.unsafe(
    'SELECT checksum, installation_id FROM private.ccc_schema_migrations WHERE id = $1',
    [migration.id],
  );
  if (receipts.length === 0) return false;
  if (receipts[0].checksum !== migration.checksum) throw failure('MIGRATION_CHECKSUM_MISMATCH');
  if (receipts[0].installation_id !== expected.installationId) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  return true;
}

export async function applyJournaledMigration(session, authorization, migration, { authorize } = {}) {
  const expected = validateAuthorization(authorization);
  if (migration === null || typeof migration !== 'object'
    || !SAFE_NAME.test(migration.id ?? '') || !HASH.test(migration.checksum ?? '')
    || typeof migration.sql !== 'string' || migration.sql.trim().length === 0) {
    throw failure('MIGRATION_CHECKSUM_MISMATCH');
  }
  const checksum = createHash('sha256').update(migration.sql, 'utf8').digest('hex');
  if (checksum !== migration.checksum) throw failure('MIGRATION_CHECKSUM_MISMATCH');
  if (typeof authorize !== 'function') throw failure('OWNER_EVIDENCE_MISSING');

  const step = migration.id.startsWith('0001_') ? 'baseline' : 'platform_migration';
  const desiredDigest = createHash('sha256').update(migration.id).update(migration.checksum).digest('hex');
  const idempotencyKey = createHash('sha256')
    .update(expected.installationId).update(step).update(desiredDigest).digest('hex');
  try {
    const pending = await authorizedWrite(session, authorization, authorize, async (transaction, current) => {
      if (await migrationReceiptExists(transaction, current, expected, migration)) return false;
      const steps = await transaction.unsafe(`SELECT status FROM private.ccc_install_steps
        WHERE installation_id = $1 AND step = $2 AND idempotency_key = $3`, [
        expected.installationId, step, idempotencyKey,
      ]);
      if (steps.some(row => row.status !== 'started')) throw failure('INSTALL_STEP_MISMATCH');
      if (steps.length === 0) {
        await transaction.unsafe(`INSERT INTO private.ccc_install_steps (
          installation_id, step, idempotency_key, status
        ) VALUES ($1,$2,$3,'started')`, [expected.installationId, step, idempotencyKey]);
      }
      await transaction.unsafe(`UPDATE private.ccc_install_journal SET
        phase = 'installing', current_step = $2, last_error_code = NULL, updated_at = clock_timestamp()
        WHERE installation_id = $1`, [expected.installationId, step]);
      return true;
    });
    if (!pending) return { applied: false };

    return await authorizedWrite(session, authorization, authorize, async (transaction, current) => {
      if (await migrationReceiptExists(transaction, current, expected, migration)) return { applied: false };
      await executeMigrationSql(transaction, migration.sql);
      const databaseFingerprint = await readDatabaseInstallFingerprint(transaction);
      await transaction.unsafe(`UPDATE private.ccc_install_journal SET
        database_fingerprint = $2, updated_at = clock_timestamp()
        WHERE installation_id = $1`, [expected.installationId, databaseFingerprint]);
      await transaction.unsafe(
        'INSERT INTO private.ccc_schema_migrations (id, checksum, installation_id) VALUES ($1,$2,$3)',
        [migration.id, migration.checksum, expected.installationId],
      );
      await transaction.unsafe(`UPDATE private.ccc_install_steps SET
        status = 'completed', completed_at = clock_timestamp()
        WHERE installation_id = $1 AND step = $2 AND idempotency_key = $3`, [
        expected.installationId, step, idempotencyKey,
      ]);
      return { applied: true };
    });
  } catch (error) {
    const safe = redactFailure(error, 'MIGRATION_APPLY_FAILED');
    if (safe.code === 'MIGRATION_APPLY_FAILED') {
      try { await recordInstallFailure(session, authorization, { step, code: safe.code }, { authorize }); }
      catch { /* An unavailable DB or withdrawn authorization leaves the committed intent for resume. */ }
    }
    throw safe;
  }
}

export async function startInstallStep(session, authorization, stepInput, { authorize } = {}) {
  if (stepInput === null || typeof stepInput !== 'object') throw failure('INSTALL_JOURNAL_INVALID');
  const step = requireStep(stepInput.step);
  const idempotencyKey = requireHash(stepInput.idempotencyKey, 'INSTALL_STEP_MISMATCH');
  return authorizedWrite(session, authorization, authorize, async (transaction, current) => {
    const rows = await transaction.unsafe(
      'SELECT idempotency_key, status FROM private.ccc_install_steps WHERE installation_id = $1 AND step = $2',
      [current.installation_id, step],
    );
    if (rows.some(row => row.idempotency_key !== idempotencyKey)) throw failure('INSTALL_STEP_MISMATCH');
    if (rows.length > 0) return { started: false, completed: rows[0].status === 'completed' };
    await transaction.unsafe(`INSERT INTO private.ccc_install_steps (
      installation_id, step, idempotency_key, status
    ) VALUES ($1,$2,$3,'started')`, [current.installation_id, step, idempotencyKey]);
    await transaction.unsafe(`UPDATE private.ccc_install_journal SET
      phase = 'installing', current_step = $2, last_error_code = NULL, updated_at = clock_timestamp()
      WHERE installation_id = $1`, [current.installation_id, step]);
    return { started: true, completed: false };
  });
}

export async function completeInstallStep(session, authorization, stepInput, { authorize } = {}) {
  if (stepInput === null || typeof stepInput !== 'object') throw failure('INSTALL_JOURNAL_INVALID');
  const step = requireStep(stepInput.step);
  const idempotencyKey = requireHash(stepInput.idempotencyKey, 'INSTALL_STEP_MISMATCH');
  const tags = requireOwnershipTags(stepInput.ownershipTags ?? [], authorization.installationId);
  const idHashes = requireHashArray(stepInput.providerResourceIdHashes ?? []);
  const digests = requireHashArray(stepInput.providerResourceDigests ?? []);
  if (idHashes.length !== digests.length) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  const stateFingerprint = requireHash(stepInput.stateFingerprint, 'INSTALL_JOURNAL_INVALID');
  return authorizedWrite(session, authorization, authorize, async transaction => {
    const rows = await transaction.unsafe(`SELECT status, ownership_tags, provider_resource_id_hashes,
      provider_resource_digests, state_fingerprint
      FROM private.ccc_install_steps
      WHERE installation_id = $1 AND step = $2 AND idempotency_key = $3 FOR UPDATE`, [
      authorization.installationId, step, idempotencyKey,
    ]);
    if (rows.length === 0) throw failure('INSTALL_STEP_MISMATCH');
    if (rows[0].status === 'completed') {
      if (JSON.stringify(rows[0].ownership_tags) !== JSON.stringify(tags)
        || JSON.stringify(rows[0].provider_resource_id_hashes) !== JSON.stringify(idHashes)
        || JSON.stringify(rows[0].provider_resource_digests) !== JSON.stringify(digests)
        || rows[0].state_fingerprint !== stateFingerprint) throw failure('INSTALL_STEP_MISMATCH');
      return { completed: false };
    }
    await transaction.unsafe(`UPDATE private.ccc_install_steps SET
      status = 'completed', ownership_tags = $4, provider_resource_id_hashes = $5,
      provider_resource_digests = $6, state_fingerprint = $7, completed_at = clock_timestamp()
      WHERE installation_id = $1 AND step = $2 AND idempotency_key = $3`, [
      authorization.installationId, step, idempotencyKey, tags, idHashes, digests, stateFingerprint,
    ]);
    await transaction.unsafe(`UPDATE private.ccc_install_journal SET
      current_step = NULL, state_fingerprint = $2, last_error_code = NULL, updated_at = clock_timestamp()
      WHERE installation_id = $1`, [authorization.installationId, stateFingerprint]);
    return { completed: true };
  });
}

export async function recordInstallResource(session, authorization, resource, { authorize } = {}) {
  if (resource === null || typeof resource !== 'object') throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  const resourceType = requireSafeName(resource.resourceType, 'RESOURCE_OWNERSHIP_MISMATCH');
  const resourceIdHash = requireHash(resource.resourceIdHash, 'RESOURCE_OWNERSHIP_MISMATCH');
  const resourceDigest = requireHash(resource.resourceDigest, 'RESOURCE_OWNERSHIP_MISMATCH');
  if (resource.ownershipTag !== ownershipTag(authorization.installationId)) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return authorizedWrite(session, authorization, authorize, async transaction => {
    const rows = await transaction.unsafe(`SELECT resource_digest, ownership_tag
      FROM private.ccc_install_resources
      WHERE installation_id = $1 AND resource_type = $2 AND resource_id_hash = $3`, [
      authorization.installationId, resourceType, resourceIdHash,
    ]);
    if (rows.length > 0) {
      if (rows[0].resource_digest !== resourceDigest || rows[0].ownership_tag !== resource.ownershipTag) {
        throw failure('RESOURCE_OWNERSHIP_MISMATCH');
      }
      return { recorded: false };
    }
    await transaction.unsafe(`INSERT INTO private.ccc_install_resources (
      installation_id, resource_type, resource_id_hash, resource_digest, ownership_tag
    ) VALUES ($1,$2,$3,$4,$5)`, [
      authorization.installationId, resourceType, resourceIdHash, resourceDigest, resource.ownershipTag,
    ]);
    return { recorded: true };
  });
}

export async function updateInstallPhase(session, authorization, update, { authorize } = {}) {
  if (update === null || typeof update !== 'object' || !PHASES.has(update.phase)) {
    throw failure('INSTALL_JOURNAL_INVALID');
  }
  if (update.currentStep !== null && update.currentStep !== undefined) requireStep(update.currentStep);
  const stateFingerprint = update.stateFingerprint === undefined || update.stateFingerprint === null
    ? null : requireHash(update.stateFingerprint, 'INSTALL_JOURNAL_INVALID');
  return authorizedWrite(session, authorization, authorize, async transaction => {
    await transaction.unsafe(`UPDATE private.ccc_install_journal SET
      phase = $2, current_step = $3, state_fingerprint = COALESCE($4, state_fingerprint),
      last_error_code = NULL, updated_at = clock_timestamp()
      WHERE installation_id = $1`, [
      authorization.installationId, update.phase, update.currentStep ?? null, stateFingerprint,
    ]);
    return { updated: true };
  });
}

export async function recordInstallFailure(session, authorization, failureInput, { authorize } = {}) {
  if (failureInput === null || typeof failureInput !== 'object' || !ERROR_CODE.test(failureInput.code ?? '')) {
    throw failure('INSTALL_JOURNAL_INVALID');
  }
  const step = requireStep(failureInput.step);
  const stateFingerprint = failureInput.stateFingerprint === undefined || failureInput.stateFingerprint === null
    ? null : requireHash(failureInput.stateFingerprint, 'INSTALL_JOURNAL_INVALID');
  return authorizedWrite(session, authorization, authorize, async transaction => {
    await transaction.unsafe(`UPDATE private.ccc_install_journal SET
      current_step = $2, state_fingerprint = COALESCE($3, state_fingerprint),
      last_error_code = $4, updated_at = clock_timestamp()
      WHERE installation_id = $1`, [
      authorization.installationId, step, stateFingerprint, failureInput.code,
    ]);
    return { recorded: true };
  });
}
