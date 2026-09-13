import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { INSTALLER_SESSION_TIMEOUTS } from './installer-connection.mjs';
import { createInstitution, institutionActorId } from './institution.mjs';

function disposableDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('MISSING_DISPOSABLE_POSTGRES_FIXTURE');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const testDatabaseName = /(^|[_-])(test|fixture|disposable)([_-]|$)/iu.test(databaseName);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !localHost || !testDatabaseName || parsed.search !== '' || parsed.hash !== ''
    || /(^|[_-])(prod|production)([_-]|$)/iu.test(databaseName)) {
    throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  }
  return { databaseName, url: parsed };
}

const disposable = disposableDatabaseUrl(process.env.CCC_INSTITUTION_TEST_DATABASE_URL);
const migrationDirectory = resolve(import.meta.dirname, '../../migrations/postgres');
const installerRole = 'ccc_institution_installer';
const orgs = Object.freeze({
  created: 'org-institution-created',
  policyOnly: 'org-institution-policy-only',
  settingsOnly: 'org-institution-settings-only',
  refused: 'org-institution-refused',
});

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function credentialUrl(role, password) {
  const url = new URL(disposable.url);
  url.username = role;
  url.password = password;
  return url.toString();
}

/**
 * 운영과 같은 설치 권한을 재현한다. 설치자는 superuser도 BYPASSRLS도 아니고
 * ccc_schema_owner 멤버십만 가진다. 그래서 FORCE RLS guard가 실제로 걸린다.
 */
async function prepareFixture() {
  const admin = postgres(disposable.url.toString(), {
    max: 1, connection: INSTALLER_SESSION_TIMEOUTS, onnotice: () => {},
  });
  const password = randomBytes(24).toString('hex');
  const apiPassword = randomBytes(24).toString('hex');
  const [safety] = await admin.unsafe(`SELECT current_database() AS database_name,
    to_regclass('public.organization_settings') IS NOT NULL AS installed`);
  if (safety.database_name !== disposable.databaseName) throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  if (!safety.installed) {
    for (const name of (await readdir(migrationDirectory)).filter(item => item.endsWith('.sql')).sort()) {
      await admin.unsafe(await readFile(resolve(migrationDirectory, name), 'utf8')).simple();
    }
  }
  const [rows] = await admin.unsafe(`SELECT (SELECT count(*) FROM organization_settings)::integer
    + (SELECT count(*) FROM program_admission_policies)::integer
    + (SELECT count(*) FROM audit_log)::integer AS business_rows`);
  if (rows.business_rows !== 0) throw new Error('NONEMPTY_DISPOSABLE_POSTGRES_FIXTURE');
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${installerRole}') THEN
      CREATE ROLE ${installerRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END $$`);
  await admin.unsafe(`ALTER ROLE ${installerRole} PASSWORD '${password}'`);
  await admin.unsafe(`GRANT ccc_schema_owner TO ${installerRole}`);
  await admin.unsafe(`ALTER ROLE ccc_api PASSWORD '${apiPassword}'`);
  return { admin, installerUrl: credentialUrl(installerRole, password), apiUrl: credentialUrl('ccc_api', apiPassword) };
}

async function withInstallerSession(installerUrl, run) {
  const sql = postgres(installerUrl, {
    max: 1, connection: INSTALLER_SESSION_TIMEOUTS, onnotice: () => {},
  });
  const session = await sql.reserve();
  try {
    const [identity] = await session.unsafe(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    assert.equal(identity.role, installerRole);
    assert.equal(identity.rolsuper, false);
    assert.equal(identity.rolbypassrls, false);
    return await run(session);
  } finally {
    await session.release();
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function businessRowCounts(admin, orgId) {
  const [counts] = await admin.unsafe(`SELECT
    (SELECT count(*)::integer FROM organization_settings WHERE org_id = $1) AS settings,
    (SELECT count(*)::integer FROM program_admission_policies WHERE org_id = $1) AS policies,
    (SELECT count(*)::integer FROM audit_log WHERE org_id = $1) AS receipts,
    (SELECT COALESCE(max(id), 0)::text FROM audit_log) AS max_audit_id`, [orgId]);
  return counts;
}

async function forcedTableCount(admin) {
  const [state] = await admin.unsafe(`SELECT count(*)::integer AS forced FROM pg_catalog.pg_class
    WHERE oid = ANY (ARRAY['public.organization_settings'::regclass,
      'public.program_admission_policies'::regclass, 'public.audit_log'::regclass])
      AND relrowsecurity AND relforcerowsecurity`);
  return state.forced;
}

/** packages/core/src/gateway.ts installedAiPolicyForOrg가 첫 호출에서 읽는 질의 그대로. */
const GATEWAY_POLICY_QUERY = 'SELECT version, stt_mode, llm_mode FROM program_admission_policies WHERE org_id = $1';

test('설치가 기관을 만들고 재실행은 아무것도 쓰지 않는다', { timeout: 180_000 }, async t => {
  const { admin, installerUrl, apiUrl } = await prepareFixture();
  try {
    await t.test('첫 실행이 두 표와 영수증을 쓰고 FORCE RLS를 되돌린다', async () => {
      const report = await withInstallerSession(installerUrl, session => createInstitution(session, {
        orgId: orgs.created,
      }));
      assert.deepEqual(report, {
        ok: true, operation: 'create-institution', ready: true,
        orgIdSha256: sha256Hex(orgs.created), timeZone: 'Asia/Seoul', piiPurgeGraceDays: 365,
        sttMode: 'off', llmMode: 'off',
      });

      const [settings] = await admin.unsafe(
        `SELECT time_zone, pii_purge_grace_days::integer AS days, version::integer AS version,
           org_name, program_display_name, initial_program_id
         FROM organization_settings WHERE org_id = $1`,
        [orgs.created],
      );
      assert.deepEqual(settings, {
        time_zone: 'Asia/Seoul', days: 365, version: 1,
        org_name: null, program_display_name: null, initial_program_id: null,
      });

      const [policy] = await admin.unsafe(
        `SELECT version::integer AS version, stt_mode, llm_mode
         FROM program_admission_policies WHERE org_id = $1`,
        [orgs.created],
      );
      assert.deepEqual(policy, { version: 1, stt_mode: 'off', llm_mode: 'off' });

      const [receipt] = await admin.unsafe(
        `SELECT actor_id, actor_role, action, target_table, target_id, detail, beneficiary_id, support_case_id
         FROM audit_log WHERE org_id = $1`,
        [orgs.created],
      );
      assert.deepEqual(receipt, {
        actor_id: institutionActorId(orgs.created), actor_role: 'service', action: 'create',
        target_table: 'organization_settings', target_id: orgs.created,
        beneficiary_id: null, support_case_id: null,
        detail: JSON.stringify({
          schemaVersion: 1, timeZone: 'Asia/Seoul', piiPurgeGraceDays: 365,
          sttMode: 'off', llmMode: 'off',
        }),
      });

      const counts = await businessRowCounts(admin, orgs.created);
      assert.deepEqual(
        { settings: counts.settings, policies: counts.policies, receipts: counts.receipts },
        { settings: 1, policies: 1, receipts: 1 },
      );
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('업무 runtime이 RLS 경계 안에서 admission 정책을 읽는다', async () => {
      const api = postgres(apiUrl, { max: 1, onnotice: () => {} });
      try {
        const session = await api.reserve();
        try {
          await session.unsafe('BEGIN');
          await session.unsafe('SELECT set_config($1, $2, true)', ['app.org_id', orgs.created]);
          const rows = await session.unsafe(GATEWAY_POLICY_QUERY, [orgs.created]);
          assert.equal(rows.length, 1);
          assert.deepEqual(
            { version: Number(rows[0].version), stt_mode: rows[0].stt_mode, llm_mode: rows[0].llm_mode },
            { version: 1, stt_mode: 'off', llm_mode: 'off' },
          );
          // 다른 기관의 app.org_id로는 같은 행이 보이지 않는다.
          await session.unsafe('SELECT set_config($1, $2, true)', ['app.org_id', orgs.refused]);
          assert.equal((await session.unsafe(GATEWAY_POLICY_QUERY, [orgs.created])).length, 0);
          await session.unsafe('ROLLBACK');
        } finally {
          await session.release();
        }
      } finally {
        await api.end({ timeout: 5 }).catch(() => {});
      }
    });

    await t.test('같은 기관의 재실행은 저장된 값을 돌려주고 아무것도 쓰지 않는다', async () => {
      const before = await businessRowCounts(admin, orgs.created);
      const report = await withInstallerSession(installerUrl, session => createInstitution(session, {
        orgId: orgs.created, timeZone: 'UTC', piiPurgeGraceDays: 30,
      }));
      assert.deepEqual(report, {
        ok: true, operation: 'create-institution', ready: true,
        orgIdSha256: sha256Hex(orgs.created), timeZone: 'Asia/Seoul', piiPurgeGraceDays: 365,
        sttMode: 'off', llmMode: 'off',
      });
      assert.deepEqual(await businessRowCounts(admin, orgs.created), before);
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('두 표 중 한쪽만 있으면 반쪽 상태를 덮어쓰지 않는다', async () => {
      await admin.unsafe(
        "INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode) VALUES ($1, 1, 'off', 'off')",
        [orgs.policyOnly],
      );
      await admin.unsafe(
        'INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES ($1, $2, $3)',
        [orgs.settingsOnly, 'Asia/Seoul', 365],
      );
      for (const orgId of [orgs.policyOnly, orgs.settingsOnly]) {
        const before = await businessRowCounts(admin, orgId);
        const refusal = await withInstallerSession(installerUrl, session => createInstitution(session, { orgId }));
        assert.deepEqual(refusal, { ok: false, code: 'INSTITUTION_STATE_INCONSISTENT' });
        assert.deepEqual(await businessRowCounts(admin, orgId), before);
      }
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('잘못된 시간대와 보관 일수는 쓰기 전에 거부된다', async () => {
      const before = await businessRowCounts(admin, orgs.refused);
      for (const input of [
        { timeZone: 'Asia/Nowhere' },
        { timeZone: 'Seoul' },
        { timeZone: '' },
        { timeZone: "Asia/Seoul'; DROP TABLE organization_settings; --" },
        { piiPurgeGraceDays: 0 },
        { piiPurgeGraceDays: 3661 },
        { piiPurgeGraceDays: '365.5' },
        { piiPurgeGraceDays: 'all' },
      ]) {
        await assert.rejects(
          () => withInstallerSession(installerUrl, session => createInstitution(session, { orgId: orgs.refused, ...input })),
          error => error.code === 'OPERATION_UNSUPPORTED',
          JSON.stringify(input),
        );
      }
      // 기관 식별자 자체가 형식에 맞지 않으면 소유자 증거 부족으로 멈춘다.
      await assert.rejects(
        () => withInstallerSession(installerUrl, session => createInstitution(session, { orgId: 'has space' })),
        error => error.code === 'OWNER_EVIDENCE_MISSING',
      );
      assert.deepEqual(await businessRowCounts(admin, orgs.refused), before);
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('설치자 권한만으로는 되돌린 FORCE RLS 뒤에서 업무 표를 읽지 못한다', async () => {
      const visible = await withInstallerSession(installerUrl, async session => {
        const [row] = await session.unsafe(`SELECT
          (SELECT count(*)::integer FROM organization_settings) AS settings,
          (SELECT count(*)::integer FROM program_admission_policies) AS policies`);
        return row;
      });
      assert.deepEqual(visible, { settings: 0, policies: 0 });
    });

    await t.test('허용된 다른 시간대와 보관 일수도 그대로 저장된다', async () => {
      const report = await withInstallerSession(installerUrl, session => createInstitution(session, {
        orgId: orgs.refused, timeZone: 'UTC', piiPurgeGraceDays: '3660',
      }));
      assert.deepEqual(
        { timeZone: report.timeZone, piiPurgeGraceDays: report.piiPurgeGraceDays },
        { timeZone: 'UTC', piiPurgeGraceDays: 3660 },
      );
      const [settings] = await admin.unsafe(
        'SELECT time_zone, pii_purge_grace_days::integer AS days FROM organization_settings WHERE org_id = $1',
        [orgs.refused],
      );
      assert.deepEqual(settings, { time_zone: 'UTC', days: 3660 });
    });
  } finally {
    await admin.end({ timeout: 5 }).catch(() => {});
  }
});
