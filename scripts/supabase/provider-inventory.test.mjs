import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROVIDER_INVENTORY_QUERY,
  normalizeProviderInventory,
  providerInventoryFingerprint,
} from './provider-inventory.mjs';

function rawProviderRows() {
  return {
    objects: [
      {
        object_kind: 'catalog', namespace_name: 'extensions', object_identity: 'collation extensions.ko_kr',
        owner_name: 'postgres', definition_text: '{"collprovider":"i"}', provenance: 'supabase_managed',
        object_oid: 9001, database_url: 'postgresql://must-not-escape',
      },
      {
        object_kind: 'type', namespace_name: 'auth', object_identity: 'auth.factor_type',
        owner_name: 'supabase_auth_admin', definition_text: "CREATE TYPE auth.factor_type AS ENUM ('totp')",
        provenance: 'supabase_managed', object_oid: 9002,
      },
      {
        object_kind: 'routine', namespace_name: 'auth', object_identity: 'auth.uid() RETURNS uuid',
        owner_name: 'supabase_auth_admin',
        definition_text: "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid'",
        provenance: 'supabase_managed', object_oid: 9003,
      },
      {
        object_kind: 'relation', namespace_name: 'extensions',
        object_identity: 'extensions.legacy_business TABLE', owner_name: 'postgres',
        definition_text: '{"relkind":"r","rls":false}', provenance: 'supabase_managed', object_oid: 9004,
      },
      {
        object_kind: 'schema', namespace_name: 'storage', object_identity: 'storage',
        owner_name: 'supabase_admin', definition_text: '{"name":"storage"}',
        provenance: 'supabase_managed', object_oid: 9005,
      },
    ],
    grants: [
      {
        grant_kind: 'role', namespace_name: '', object_identity: 'authenticator',
        grantor_name: 'postgres', grantee_name: 'ROLE:e_role', privilege: 'MEMBER', is_grantable: false,
        inherit_option: true, set_option: true,
        provenance: 'supabase_managed', role_oid: 8001,
      },
      {
        grant_kind: 'default', namespace_name: 'auth',
        object_identity: 'default privileges for role supabase_auth_admin in schema auth',
        grantor_name: 'supabase_auth_admin', grantee_name: 'ROLE:d_role', privilege: 'SELECT',
        is_grantable: false, provenance: 'supabase_managed', object_oid: 8002,
      },
      {
        grant_kind: 'column', namespace_name: 'auth', object_identity: 'auth.users.email',
        grantor_name: 'supabase_auth_admin', grantee_name: 'ROLE:c_role', privilege: 'SELECT',
        is_grantable: false, provenance: 'supabase_managed', object_oid: 8003,
      },
      {
        grant_kind: 'relation', namespace_name: 'auth', object_identity: 'auth.users TABLE',
        grantor_name: 'supabase_auth_admin', grantee_name: 'ROLE:b_role', privilege: 'SELECT',
        is_grantable: false, provenance: 'supabase_managed', object_oid: 8004,
      },
      {
        grant_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
        grantor_name: 'supabase_admin', grantee_name: 'ROLE:a_role', privilege: 'USAGE',
        is_grantable: false, provenance: 'supabase_managed', object_oid: 8005,
        credential: 'must-not-escape',
      },
    ],
  };
}

function objectRow(overrides = {}) {
  return {
    object_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
    owner_name: 'supabase_admin', definition_text: '{"name":"auth"}',
    provenance: 'supabase_managed', ...overrides,
  };
}

function grantRow(overrides = {}) {
  return {
    grant_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
    grantor_name: 'supabase_admin', grantee_name: 'ROLE:authenticated', privilege: 'USAGE',
    is_grantable: false, provenance: 'supabase_managed', ...overrides,
  };
}

function rejectsUnreadable(run) {
  assert.throws(run, error => error?.code === 'PROVIDER_UNREADABLE');
}

test('normalizes exact provider records without persisting volatile fields or definitions', () => {
  const inventory = normalizeProviderInventory(rawProviderRows());

  assert.deepEqual(inventory.objects, [
    {
      kind: 'type', schema: 'auth', identity: 'auth.factor_type', owner: 'supabase_auth_admin',
      definitionSha256: '628d8808dc80fcdc9caf1b16061d2a526274fffea2d50674549e28d994466d96',
      provenance: 'supabase_managed',
    },
    {
      kind: 'schema', schema: 'storage', identity: 'storage', owner: 'supabase_admin',
      definitionSha256: 'c26676c54ad5cc29fcf2dfaf907faf58069a557a0f9b4ab0089b3707a5cd0486',
      provenance: 'supabase_managed',
    },
    {
      kind: 'routine', schema: 'auth', identity: 'auth.uid() RETURNS uuid', owner: 'supabase_auth_admin',
      definitionSha256: 'd3b62ea183d48de5b0c234a3c305fcd2fceeccf11a765c5a9e6e80af5461b876',
      provenance: 'supabase_managed',
    },
    {
      kind: 'relation', schema: 'extensions', identity: 'extensions.legacy_business TABLE', owner: 'postgres',
      definitionSha256: 'd9ca30c660a867307c6debd5ef7e0529573165012fa4b703fcf87b11aeca8fe3',
      provenance: 'supabase_managed',
    },
    {
      kind: 'catalog', schema: 'extensions', identity: 'collation extensions.ko_kr', owner: 'postgres',
      definitionSha256: 'f94b6173d5cefa445a36b77f14ffbdbfdfdd35705d793a6a52e4f49494ea5c61',
      provenance: 'supabase_managed',
    },
  ]);
  assert.deepEqual(inventory.grants.map(({ kind, grantee }) => ({ kind, grantee })), [
    { kind: 'schema', grantee: 'ROLE:a_role' },
    { kind: 'relation', grantee: 'ROLE:b_role' },
    { kind: 'column', grantee: 'ROLE:c_role' },
    { kind: 'default', grantee: 'ROLE:d_role' },
    { kind: 'role', grantee: 'ROLE:e_role' },
  ]);
  assert.deepEqual(providerInventoryFingerprint(inventory), {
    objectInventorySha256: '3aac25944e2a888d79e0fd2a048893dde3872b330687d2e9db565e218c6092b7',
    grantInventorySha256: 'b29fa1fe5d2b4553c7a9285976ac0be3047c9d69811ece3ad2271f341125c558',
  });
  assert.equal(inventory.objectInventorySha256, '3aac25944e2a888d79e0fd2a048893dde3872b330687d2e9db565e218c6092b7');
  assert.equal(inventory.grantInventorySha256, 'b29fa1fe5d2b4553c7a9285976ac0be3047c9d69811ece3ad2271f341125c558');
  assert.equal(JSON.stringify(inventory).includes('object_oid'), false);
  assert.doesNotMatch(JSON.stringify(inventory), /CREATE FUNCTION|must-not-escape|postgresql:\/\//u);
  assert.ok(Object.isFrozen(inventory) && Object.isFrozen(inventory.objects)
    && Object.isFrozen(inventory.objects[0]) && Object.isFrozen(inventory.grants)
    && Object.isFrozen(inventory.grants[0]));
});

test('normalizes only individually identified installation records as an exact inventory subset', () => {
  const rows = rawProviderRows();
  rows.installation_objects = [rows.objects[0]];
  rows.installation_grants = [rows.grants[0]];
  const inventory = normalizeProviderInventory(rows);
  assert.deepEqual(inventory.installationObjects, [inventory.objects.at(-1)]);
  assert.deepEqual(inventory.installationGrants, [inventory.grants.at(-1)]);
  assert.ok(Object.isFrozen(inventory.installationObjects));
  assert.ok(Object.isFrozen(inventory.installationGrants));
  assert.equal(JSON.stringify(inventory.installationObjects).includes('object_oid'), false);

  assert.throws(
    () => normalizeProviderInventory({
      ...rows,
      installation_objects: [objectRow({ object_identity: 'unobserved' })],
    }),
    error => error?.code === 'PROVIDER_UNREADABLE',
  );
  assert.match(PROVIDER_INVENTORY_QUERY, /AS installation_objects/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /AS installation_grants/u);
});

test('sorts by UTF-8 canonical JSON and rejects duplicate stable identities', () => {
  const inventory = normalizeProviderInventory({
    objects: [
      objectRow({ object_identity: '\u{10000}', definition_text: '' }),
      objectRow({ object_identity: '\uE000', definition_text: '' }),
    ],
    grants: [],
  });
  assert.deepEqual(inventory.objects.map(({ identity }) => identity), ['\uE000', '\u{10000}']);

  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [objectRow({ object_oid: 1 }), objectRow({ object_oid: 2 })],
    grants: [],
  }));
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [],
    grants: [grantRow({ object_oid: 1 }), grantRow({ object_oid: 2, provenance: 'initial_privilege' })],
  }));
});

test('enforces record string and inventory count bounds', () => {
  assert.equal(normalizeProviderInventory({
    objects: [objectRow({ object_identity: 'a'.repeat(1_024) })], grants: [],
  }).objects.length, 1);
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [objectRow({ object_identity: 'a'.repeat(1_025) })], grants: [],
  }));
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [objectRow({ object_identity: '가'.repeat(342) })], grants: [],
  }));
  const objectsAtLimit = Array.from(
    { length: 5_000 },
    (_, index) => objectRow({ object_identity: `schema_${index}` }),
  );
  const grantsAtLimit = Array.from(
    { length: 20_000 },
    (_, index) => grantRow({ grantee_name: `role_${index}` }),
  );
  assert.equal(normalizeProviderInventory({ objects: objectsAtLimit, grants: [] }).objects.length, 5_000);
  assert.equal(normalizeProviderInventory({ objects: [], grants: grantsAtLimit }).grants.length, 20_000);
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [...objectsAtLimit, objectRow({ object_identity: 'schema_5000' })],
    grants: [],
  }));
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [],
    grants: [...grantsAtLimit, grantRow({ grantee_name: 'role_20000' })],
  }));
});

function querySegment(start, end) {
  const from = PROVIDER_INVENTORY_QUERY.indexOf(start);
  const to = PROVIDER_INVENTORY_QUERY.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing query segment: ${start}`);
  return PROVIDER_INVENTORY_QUERY.slice(from, to);
}

test('serializes aggregate routines without passing aggregates to pg_get_functiondef', () => {
  const routines = querySegment(
    "SELECT 'routine', namespace.nspname,",
    "UNION ALL\n    SELECT 'type', namespace.nspname,",
  );
  assert.match(routines, /CASE WHEN procedure\.prokind = 'a' THEN \(/u);
  assert.match(routines, /FROM pg_catalog\.pg_aggregate AS aggregate_value/u);
  assert.match(routines, /NULLIF\(aggregate_value\.aggtransfn::oid, 0\)::regprocedure::text/u);
  assert.match(routines, /ELSE pg_catalog\.pg_get_functiondef\(procedure\.oid\) END/u);
});

test('serializes ordered RLS policy state inside the owning relation definition', () => {
  const relations = querySegment(
    "SELECT 'relation', namespace.nspname,",
    "UNION ALL\n    SELECT 'routine', namespace.nspname,",
  );
  assert.match(relations, /'policies', COALESCE\(\(/u);
  assert.match(relations, /FROM pg_catalog\.pg_policy AS policy/u);
  assert.match(relations, /ORDER BY policy\.polname/u);
  assert.match(relations, /CASE WHEN role_oid = 0 THEN 'PUBLIC'/u);
  assert.match(relations, /pg_catalog\.pg_get_expr\(policy\.polqual, policy\.polrelid, false\)/u);
  assert.match(relations, /pg_catalog\.pg_get_expr\(policy\.polwithcheck, policy\.polrelid, false\)/u);
});

test('serializes every PG17 namespace-dependent catalog class without an identity-only fallback', () => {
  const catalogs = querySegment(
    "UNION ALL\n    SELECT 'catalog', COALESCE(identified.schema, ''),",
    "\n  ),\n  provider_grant_inventory AS MATERIALIZED",
  );
  const definitions = catalogs.slice(catalogs.indexOf('      CASE', catalogs.indexOf('      CASE') + 1));
  for (const catalog of [
    'pg_collation', 'pg_constraint', 'pg_conversion', 'pg_opclass', 'pg_operator',
    'pg_opfamily', 'pg_publication_namespace', 'pg_statistic_ext', 'pg_ts_config',
    'pg_ts_dict', 'pg_ts_parser', 'pg_ts_template', 'pg_publication_rel',
    'pg_attrdef', 'pg_policy', 'pg_rewrite', 'pg_trigger',
  ]) {
    assert.ok(definitions.includes(`inventory.class_oid = 'pg_catalog.${catalog}'::regclass`),
      `missing definition for ${catalog}`);
  }
  assert.match(catalogs, /config_map\.maptokentype/u);
  assert.match(catalogs, /config_map\.mapseqno/u);
  assert.match(catalogs, /config_map\.mapdict::regdictionary::text/u);
  assert.doesNotMatch(catalogs, /pg_identify_object_as_address|addressNames|addressArgs/u);
  assert.doesNotMatch(catalogs, /ELSE pg_catalog\.jsonb_build_object/u);
  assert.match(definitions, /ELSE NULL\s+END/u);
  const configs = definitions.slice(definitions.indexOf("WHEN inventory.class_oid = 'pg_catalog.pg_ts_config'"),
    definitions.indexOf("WHEN inventory.class_oid = 'pg_catalog.pg_ts_dict'"));
  assert.match(configs, /WHERE parser\.oid = value\.cfgparser/u);
  assert.match(configs, /ORDER BY config_map\.maptokentype, config_map\.mapseqno/u);
  assert.match(catalogs, /pg_get_userbyid\(value\.cfgowner\)/u);
  rejectsUnreadable(() => normalizeProviderInventory({
    objects: [objectRow({ object_kind: 'catalog', definition_text: null })], grants: [],
  }));
});

test('policy serialization distinguishes PUBLIC audience from a real role named PUBLIC', async () => {
  // Execute the emitted scalar CASE in native SQLite with only PostgreSQL's
  // catalog lookup replaced. No tables, writes, provider access or SQL mocks.
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(':memory:');
  database.function('pg_get_userbyid', roleOid => {
    assert.equal(roleOid, 42);
    return 'PUBLIC';
  });
  try {
    const roleExpressions = [...PROVIDER_INVENTORY_QUERY.matchAll(
      /SELECT (CASE WHEN role_oid = 0[\s\S]*? END) AS role_name/gu,
    )];
    assert.equal(roleExpressions.length, 2, 'nested relation and standalone policy serializers');
    for (const [, expression] of roleExpressions) {
      const statement = database.prepare(
        `SELECT ${expression.replaceAll('pg_catalog.pg_get_userbyid', 'pg_get_userbyid')} AS role_name
          FROM (SELECT ? AS role_oid)`,
      );
      const publicAudience = statement.get(0).role_name;
      const namedRole = statement.get(42).role_name;
      assert.notEqual(publicAudience, namedRole);
      const publicState = JSON.stringify({ roles: [publicAudience] });
      const namedRoleState = JSON.stringify({ roles: [namedRole] });
      const publicInventory = normalizeProviderInventory({
        objects: [objectRow({ object_kind: 'relation', definition_text: publicState })], grants: [],
      });
      const namedRoleInventory = normalizeProviderInventory({
        objects: [objectRow({ object_kind: 'relation', definition_text: namedRoleState })], grants: [],
      });
      assert.notEqual(publicInventory.objects[0].definitionSha256, namedRoleInventory.objects[0].definitionSha256);
      assert.notEqual(publicInventory.objectInventorySha256, namedRoleInventory.objectInventorySha256);
      assert.equal(publicInventory.grantInventorySha256, namedRoleInventory.grantInventorySha256);
    }
  } finally {
    database.close();
  }
});

test('inventories extension and initial objects plus every effective privilege', () => {
  assert.match(PROVIDER_INVENTORY_QUERY, /provider_object_candidate AS MATERIALIZED/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /FROM provider_object AS inventory/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /THEN 'extension'[\s\S]*THEN 'initial_privilege'/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /provider_grant AS MATERIALIZED/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /pg_catalog\.acldefault\('f'::"char", procedure\.proowner\)/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /pg_catalog\.acldefault\('T'::"char", type_value\.typowner\)/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /FROM provider_grant AS grant_record/u);
  const installationGrantRules = querySegment(
    'provider_grant_inventory AS MATERIALIZED',
    '\n  )\nSELECT',
  );
  assert.match(installationGrantRules, /FROM provider_object_inventory AS installation_object/u);
  assert.match(installationGrantRules, /installation_object\.object_kind = grant_record\.grant_kind/u);
  assert.match(installationGrantRules, /grant_record\.grant_kind = 'column'/u);
  const inventory = normalizeProviderInventory({
    objects: [
      objectRow({ object_identity: 'extension_object', provenance: 'extension' }),
      objectRow({ object_identity: 'initial_object', provenance: 'initial_privilege' }),
    ],
    grants: [grantRow({ provenance: 'initial_privilege' })],
  });
  assert.deepEqual(inventory.objects.map(({ provenance }) => provenance),
    ['extension', 'initial_privilege']);
  assert.equal(inventory.grants[0].provenance, 'initial_privilege');
});

test('relation definitions bind reloptions and trigger enablement', () => {
  const relations = querySegment(
    "SELECT 'relation', namespace.nspname,",
    "UNION ALL\n    SELECT 'routine', namespace.nspname,",
  );
  assert.match(relations, /'options', COALESCE\(\([\s\S]*pg_catalog\.unnest\(relation\.reloptions\)/u);
  assert.match(relations, /ORDER BY relation_option/u);
  assert.match(relations, /'enabled', trigger_value\.tgenabled/u);
});

test('normalizes routine and type effective privileges as distinct grant kinds', () => {
  const common = {
    grantor_name: 'supabase_admin',
    grantee_name: 'ROLE:authenticated',
    is_grantable: false,
    provenance: 'supabase_managed',
    inherit_option: null,
    set_option: null,
  };
  const inventory = normalizeProviderInventory({
    objects: [],
    grants: [
      {
        ...common,
        grant_kind: 'routine',
        namespace_name: 'auth',
        object_identity: 'auth.uid() FUNCTION RETURNS uuid',
        privilege: 'EXECUTE',
      },
      {
        ...common,
        grant_kind: 'type',
        namespace_name: 'storage',
        object_identity: 'storage.bucket_type',
        privilege: 'USAGE',
      },
    ],
  });
  assert.deepEqual(inventory.grants.map(({ kind }) => kind), ['routine', 'type']);
  assert.deepEqual(inventory.grants.map(({ inheritOption, setOption }) => (
    { inheritOption, setOption }
  )), [
    { inheritOption: null, setOption: null },
    { inheritOption: null, setOption: null },
  ]);
});

test('role membership inheritance and SET options change the inventory fingerprint', () => {
  const inventory = (inheritOption, setOption) => normalizeProviderInventory({
    objects: [],
    grants: [{
      grant_kind: 'role',
      namespace_name: '',
      object_identity: 'authenticator',
      grantor_name: 'postgres',
      grantee_name: 'ROLE:authenticated',
      privilege: 'MEMBER',
      is_grantable: false,
      inherit_option: inheritOption,
      set_option: setOption,
      provenance: 'supabase_managed',
    }],
  });
  const inherited = inventory(true, false);
  const settable = inventory(false, true);
  assert.deepEqual(
    { inheritOption: inherited.grants[0].inheritOption, setOption: inherited.grants[0].setOption },
    { inheritOption: true, setOption: false },
  );
  assert.notEqual(inherited.grantInventorySha256, settable.grantInventorySha256);
  assert.match(PROVIDER_INVENTORY_QUERY, /membership\.inherit_option/u);
  assert.match(PROVIDER_INVENTORY_QUERY, /membership\.set_option/u);
});

test('grant serialization distinguishes PUBLIC grantee from a real role named PUBLIC', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(':memory:');
  database.function('pg_get_userbyid', roleOid => {
    assert.equal(roleOid, 42);
    return 'PUBLIC';
  });
  try {
    const match = PROVIDER_INVENTORY_QUERY.match(
      /(CASE WHEN grant_record\.grantee = 0[\s\S]*? END) AS grantee_name/u,
    );
    assert.ok(match);
    const statement = database.prepare(
      `SELECT ${match[1].replaceAll('pg_catalog.pg_get_userbyid', 'pg_get_userbyid')} AS grantee_name
        FROM (SELECT ? AS grantee) AS grant_record`,
    );
    assert.notEqual(statement.get(0).grantee_name, statement.get(42).grantee_name);
  } finally {
    database.close();
  }
});
