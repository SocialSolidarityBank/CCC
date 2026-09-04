import { afterEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { SQLITE_MIGRATIONS_PATH } from './support/d1';

const instances: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe('E3-2 SQL portability migrations', () => {
  it('normalizes legacy timestamps, preserves ordering, and canonicalizes every legacy default path', async () => {
    const miniflare = new Miniflare({
      compatibilityDate: '2026-07-06',
      d1Databases: ['DB'],
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } };',
    });
    instances.push(miniflare);
    const db = await miniflare.getD1Database('DB');
    const migrations = await readD1Migrations(SQLITE_MIGRATIONS_PATH);
    const portabilityIndex = migrations.findIndex((migration) => (
      migration.queries.some((query) => query.includes('uq_support_cases_operation_marker'))
    ));
    const normalizationIndex = migrations.findIndex((migration) => (
      migration.queries.some((query) => query.includes('DROP TRIGGER agent_installations_identity_immutable'))
    ));
    expect(normalizationIndex).toBe(portabilityIndex + 1);
    expect(portabilityIndex).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, portabilityIndex)) {
      await db.batch(migration.queries.map((query) => db.prepare(query)));
    }

    const legacyDefaultTables = await db.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND sql LIKE '%datetime(''now'')%' ORDER BY name`,
    ).all<{ name: string }>();
    expect(legacyDefaultTables.results.length).toBeGreaterThan(0);
    const legacyDefaultColumns: Array<{ table: string; column: string }> = [];
    for (const table of legacyDefaultTables.results) {
      const columns = await db.prepare(
        `SELECT name, dflt_value FROM pragma_table_info(?)`,
      ).bind(table.name).all<{ name: string; dflt_value: string | null }>();
      for (const column of columns.results) {
        if (column.dflt_value?.includes("datetime('now')") === true) {
          legacyDefaultColumns.push({ table: table.name, column: column.name });
        }
      }
    }
    const timestampColumns: Array<{ table: string; column: string }> = [];
    const tables = await db.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       ORDER BY name`,
    ).all<{ name: string }>();
    for (const table of tables.results) {
      const columns = await db.prepare(
        `SELECT name FROM pragma_table_info(?)`,
      ).bind(table.name).all<{ name: string }>();
      for (const column of columns.results) {
        if (/(?:_at|_due)$/u.test(column.name)) {
          timestampColumns.push({ table: table.name, column: column.name });
        }
      }
    }
    const triggersBefore = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    const viewsBefore = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'view' ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    const indexesBefore = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    await db.prepare(
      `INSERT INTO organization_settings (
         org_id, time_zone, pii_purge_grace_days, version, created_at, updated_at
       ) VALUES ('org_demo', 'UTC', 180, 1, '2026-01-01 09:00:00', '2026-01-01T09:00:00.500Z')`,
    ).run();
    await db.prepare(
      `INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
       VALUES ('A900', 'org_demo', 'pending', '2026-01-01 09:00:00', '2026-01-01T09:00:00.500Z')`,
    ).run();
    await db.prepare(
      `INSERT INTO users (id, org_id, email, role, active, created_at)
       VALUES ('migration-worker', 'org_demo', 'migration-worker@example.invalid', 'counselor', 1, '2026-01-01 09:00:00')`,
    ).run();
    await db.prepare(
      `INSERT INTO support_cases (
         id, org_id, beneficiary_id, legacy_case_id, status, intake_at, creation_kind, created_at, updated_at
       ) VALUES (
         'migration-support-case', 'org_demo', 'A900', 'A900', 'active',
         '2026-01-01 09:00:00', 'initial', '2026-01-01 09:00:00', '2026-01-01T09:00:00.500Z'
       )`,
    ).run();
    await db.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, status, accepted_at, assigned_at
       ) VALUES (
         'migration-assignment', 'org_demo', 'migration-support-case', 'migration-worker',
         'secondary', 'active', '2026-01-01 09:00:00', '2026-01-01 09:00:00'
       )`,
    ).run();


    await db.prepare(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, created_at)
       VALUES ('org_demo', 'actor', 'service', 'legacy', 'fixture', 'legacy', '2026-01-01 09:00:00')`,
    ).run();
    await db.prepare(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, created_at)
       VALUES ('org_demo', 'actor', 'service', 'iso', 'fixture', 'iso', '2026-01-01T09:00:00.500Z')`,
    ).run();

    const portability = migrations[portabilityIndex];
    const normalization = migrations[normalizationIndex];
    if (portability === undefined || normalization === undefined) {
      throw new Error('expected SQL portability migration pair');
    }
    await db.batch(portability.queries.map((query) => db.prepare(query)));
    await db.batch(normalization.queries.map((query) => db.prepare(query)));
    const portabilitySql = portability.queries.join('\n');
    const normalizationSql = normalization.queries.join('\n');
    const rebuiltTables = new Set(
      legacyDefaultTables.results
        .map((table) => table.name)
        .filter((table) => portabilitySql.includes(`${table}_sql_portability_next`)),
    );
    const defaultColumnKeys = new Set(
      legacyDefaultColumns.map(({ table, column }) => `${table}.${column}`),
    );
    for (const { table, column } of timestampColumns) {
      const inPortabilityMigration = rebuiltTables.has(table)
        || defaultColumnKeys.has(`${table}.${column}`);
      expect(inPortabilityMigration ? portabilitySql : normalizationSql, `${table}.${column}`).toContain(
        rebuiltTables.has(table)
          ? `CASE WHEN ${column} GLOB`
          : `${column} = CASE WHEN ${column} GLOB`,
      );
    }

    await db.prepare(
      `CREATE TABLE sql_timestamp_value_probes (
         table_name TEXT NOT NULL,
         column_name TEXT NOT NULL,
         kind TEXT NOT NULL,
         value TEXT NOT NULL,
         PRIMARY KEY (table_name, column_name, kind)
       )`,
    ).run();
    await db.batch(timestampColumns.map(({ table, column }) => db.prepare(
      `INSERT INTO sql_timestamp_value_probes (table_name, column_name, kind, value)
       VALUES (?, ?, 'legacy', '2026-01-01 09:00:00'),
              (?, ?, 'iso', '2026-01-01T09:00:00.500Z')`,
    ).bind(table, column, table, column)));
    await db.prepare(
      `UPDATE sql_timestamp_value_probes
       SET value = CASE
         WHEN value GLOB '????-??-?? ??:??:??'
           THEN substr(value, 1, 10) || 'T' || substr(value, 12, 8) || '.000Z'
         ELSE value
       END`,
    ).run();
    const probeRows = await db.prepare(
      `SELECT table_name, column_name, value
       FROM sql_timestamp_value_probes
       ORDER BY table_name, column_name, value`,
    ).all<{ table_name: string; column_name: string; value: string }>();
    for (const { table, column } of timestampColumns) {
      expect(
        probeRows.results
          .filter((row) => row.table_name === table && row.column_name === column)
          .map((row) => row.value),
        `${table}.${column}`,
      ).toEqual(['2026-01-01T09:00:00.000Z', '2026-01-01T09:00:00.500Z']);
    }
    await db.prepare('DROP TABLE sql_timestamp_value_probes').run();

    await expect(db.prepare(
      `SELECT action, created_at FROM audit_log WHERE target_table = 'fixture' ORDER BY created_at, id`,
    ).all()).resolves.toMatchObject({
      results: [
        { action: 'legacy', created_at: '2026-01-01T09:00:00.000Z' },
        { action: 'iso', created_at: '2026-01-01T09:00:00.500Z' },
      ],
    });
    await expect(db.prepare(
      `SELECT intake_at, created_at, updated_at FROM support_cases WHERE id = 'migration-support-case'`,
    ).first()).resolves.toEqual({
      intake_at: '2026-01-01T09:00:00.000Z',
      created_at: '2026-01-01T09:00:00.000Z',
      updated_at: '2026-01-01T09:00:00.500Z',
    });
    await expect(db.prepare(
      `SELECT assigned_at, accepted_at FROM support_case_assignees WHERE id = 'migration-assignment'`,
    ).first()).resolves.toEqual({
      assigned_at: '2026-01-01T09:00:00.000Z',
      accepted_at: '2026-01-01T09:00:00.000Z',
    });

    await db.prepare(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id)
       VALUES ('org_demo', 'actor', 'service', 'default', 'fixture', 'default')`,
    ).run();
    const defaultTimestamp = await db.prepare(
      "SELECT created_at FROM audit_log WHERE action = 'default'",
    ).first<string>('created_at');
    expect(defaultTimestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    await db.prepare(
      `INSERT INTO users (id, org_id, email, role, active)
       VALUES ('post-migration-worker', 'org_demo', 'post-migration-worker@example.invalid', 'counselor', 1)`,
    ).run();
    const seededRoleTimestamps = await db.prepare(
      `SELECT users.created_at AS user_created_at, role.granted_at AS role_granted_at
       FROM users
       JOIN user_role_assignments AS role ON role.user_id = users.id
       WHERE users.id = 'post-migration-worker' AND role.role = 'practitioner'`,
    ).first<{ user_created_at: string; role_granted_at: string }>();
    expect(seededRoleTimestamps?.user_created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(seededRoleTimestamps?.role_granted_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    for (const { table, column } of legacyDefaultColumns) {
      const columns = await db.prepare(
        `SELECT name, dflt_value FROM pragma_table_info(?)`,
      ).bind(table).all<{ name: string; dflt_value: string | null }>();
      const migrated = columns.results.find((candidate) => candidate.name === column);
      if (migrated?.dflt_value?.includes("strftime('%Y-%m-%dT%H:%M:%fZ'") !== true) {
        await expect(db.prepare(
          `SELECT COUNT(*) AS count FROM sqlite_schema
           WHERE type = 'trigger' AND name = ?`,
        ).bind(`${table}_normalize_timestamp_after_insert`).first<number>('count')).resolves.toBe(1);
      }
    }

    const triggersAfter = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    const triggerNamesBefore = triggersBefore.results.map((entry) => entry.name);
    const addedNormalizers = triggersAfter.results
      .map((entry) => entry.name)
      .filter((name) => !triggerNamesBefore.includes(name));
    expect(addedNormalizers).toEqual([
      'beneficiaries_normalize_timestamp_after_insert',
      'organization_settings_normalize_timestamp_after_insert',
      'participant_support_case_cutover_manifest_normalize_timestamp_after_insert',
      'schedule_custom_questions_normalize_timestamp_after_insert',
      'schedule_session_goals_normalize_timestamp_after_insert',
      'session_life_area_snapshots_normalize_timestamp_after_insert',
      'users_normalize_timestamp_after_insert',
    ]);
    for (const name of triggerNamesBefore) {
      expect(triggersAfter.results.some((entry) => entry.name === name)).toBe(true);
    }
    for (const before of triggersBefore.results) {
      const after = triggersAfter.results.find((entry) => entry.name === before.name);
      if (before.name === 'participant_pii_archives_insert_guard') {
        expect(after?.sql).toContain('julianday(NEW.archived_at)');
        expect(after?.sql).not.toContain("julianday('now')");
        continue;
      }
      if (before.name === 'users_seed_independent_roles_after_insert') {
        expect(after?.sql.match(/strftime\('%Y-%m-%dT%H:%M:%fZ', NEW\.created_at\)/gu)).toHaveLength(3);
        continue;
      }
      const expectedSql = before.sql.replace(
        /\bdatetime\s*\(/giu,
        "strftime('%Y-%m-%dT%H:%M:%fZ', ",
      );
      expect(after?.sql.replace(/\s+/gu, ' ')).toBe(expectedSql.replace(/\s+/gu, ' '));
    }

    const viewsAfter = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'view' ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    expect(viewsAfter.results).toEqual(viewsBefore.results);
    const indexesAfter = await db.prepare(
      `SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    for (const before of indexesBefore.results) {
      expect(indexesAfter.results).toContainEqual(before);
    }
    await expect(db.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_schema
       WHERE name IN ('_ccc_timestamp_normalization', 'sql_timestamp_normalization_assertions')`,
    ).first<number>('count')).resolves.toBe(0);
    await expect(db.prepare('PRAGMA foreign_key_check').all().then((result) => result.results)).resolves.toEqual([]);
  });
});
