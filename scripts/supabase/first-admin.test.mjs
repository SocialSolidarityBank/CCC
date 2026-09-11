import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { INSTALLER_SESSION_TIMEOUTS } from './installer-connection.mjs';
import { firstAdminActorId, linkFirstAdmin } from './first-admin.mjs';

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

const disposable = disposableDatabaseUrl(process.env.CCC_FIRST_ADMIN_TEST_DATABASE_URL);
const migrationDirectory = resolve(import.meta.dirname, '../../migrations/postgres');
const installerRole = 'ccc_first_admin_installer';
const subject = '00000000-0000-4000-8000-000000000001';
const otherSubject = '00000000-0000-4000-8000-000000000002';
const email = 'synthetic.creator@example.invalid';
const otherEmail = 'synthetic.second@example.invalid';
const orgs = Object.freeze({
  linked: 'org-first-admin-linked',
  second: 'org-first-admin-second',
  legacy: 'org-first-admin-legacy',
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
 * ccc_schema_owner 멤버십만 가진다. 그래서 FORCE RLS와 역할 부여 guard가 실제로 걸린다.
 */
async function prepareFixture() {
  const admin = postgres(disposable.url.toString(), {
    max: 1, connection: INSTALLER_SESSION_TIMEOUTS, onnotice: () => {},
  });
  const password = randomBytes(24).toString('hex');
  const apiPassword = randomBytes(24).toString('hex');
  const [safety] = await admin.unsafe(`SELECT current_database() AS database_name,
    to_regclass('public.users') IS NOT NULL AS installed`);
  if (safety.database_name !== disposable.databaseName) throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  if (!safety.installed) {
    for (const name of (await readdir(migrationDirectory)).filter(item => item.endsWith('.sql')).sort()) {
      await admin.unsafe(await readFile(resolve(migrationDirectory, name), 'utf8')).simple();
    }
  }
  const [rows] = await admin.unsafe(`SELECT (SELECT count(*) FROM users)::integer
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
    (SELECT count(*)::integer FROM users WHERE org_id = $1) AS users,
    (SELECT count(*)::integer FROM user_role_assignments WHERE org_id = $1) AS assignments,
    (SELECT count(*)::integer FROM audit_log WHERE org_id = $1) AS receipts,
    (SELECT COALESCE(max(id), 0)::text FROM audit_log) AS max_audit_id`, [orgId]);
  return counts;
}

async function forcedTableCount(admin) {
  const [state] = await admin.unsafe(`SELECT count(*)::integer AS forced FROM pg_catalog.pg_class
    WHERE oid = ANY (ARRAY['public.users'::regclass, 'public.user_role_assignments'::regclass, 'public.audit_log'::regclass])
      AND relrowsecurity AND relforcerowsecurity`);
  return state.forced;
}

/** packages/core/src/gateway.ts getInstitutionReadiness의 영수증 조건을 그대로 옮긴 질의. */
const READINESS_RECEIPT_QUERY = `SELECT receipt.detail, creator.auth_subject
  FROM audit_log AS receipt
  LEFT JOIN users AS creator ON creator.id = receipt.target_id AND creator.org_id = receipt.org_id
    AND creator.active = 1 AND creator.role <> 'service'
    AND EXISTS (SELECT 1 FROM user_role_assignments AS held
      WHERE held.user_id = creator.id AND held.org_id = creator.org_id
        AND held.role = 'institution_admin' AND held.revoked_at IS NULL)
  WHERE receipt.org_id = $1 AND receipt.actor_id = $2 AND receipt.actor_role = 'service'
    AND receipt.action = 'first_admin_linked' AND receipt.target_table = 'users'
  LIMIT 2`;

test('설치자만이 첫 기관 관리자를 연결하고 재실행은 아무것도 쓰지 않는다', { timeout: 180_000 }, async t => {
  const { admin, installerUrl, apiUrl } = await prepareFixture();
  try {
    let linkedUserId;

    await t.test('첫 연결이 디렉터리 행과 영수증만 쓰고 FORCE RLS를 되돌린다', async () => {
      const before = await businessRowCounts(admin, orgs.linked);
      assert.deepEqual(
        { users: before.users, assignments: before.assignments, receipts: before.receipts },
        { users: 0, assignments: 0, receipts: 0 },
      );
      const report = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.linked, authSubject: subject, email, name: '첫 관리자',
      }));
      assert.deepEqual(Object.keys(report).sort(), [
        'authSubjectSha256', 'emailSha256', 'ok', 'operation', 'ready', 'userIdSha256',
      ]);
      assert.equal(report.ready, true);
      assert.equal(report.emailSha256, sha256Hex(email));
      assert.equal(report.authSubjectSha256, sha256Hex(subject));

      const [user] = await admin.unsafe(
        'SELECT id, org_id, email, role, active, name, auth_subject FROM users WHERE org_id = $1',
        [orgs.linked],
      );
      linkedUserId = user.id;
      assert.equal(report.userIdSha256, sha256Hex(user.id));
      assert.equal(user.email, email);
      assert.equal(user.role, 'admin');
      assert.equal(Number(user.active), 1);
      assert.equal(user.name, '첫 관리자');
      assert.equal(user.auth_subject, subject);

      // 표준 역할 부여는 users insert trigger가 만든다. 업무 경로의 관리자와 같은 모양이다.
      const assignments = await admin.unsafe(
        `SELECT user_id, role, source, granted_by, revoked_at FROM user_role_assignments
         WHERE org_id = $1 ORDER BY role`,
        [orgs.linked],
      );
      assert.deepEqual([...assignments], [
        {
          user_id: user.id, role: 'institution_admin', source: 'legacy',
          granted_by: null, revoked_at: null,
        },
        {
          user_id: user.id, role: 'institution_technical_admin', source: 'legacy',
          granted_by: null, revoked_at: null,
        },
      ]);

      const [receipt] = await admin.unsafe(
        `SELECT actor_id, actor_role, action, target_table, target_id, detail, beneficiary_id, support_case_id
         FROM audit_log WHERE org_id = $1`,
        [orgs.linked],
      );
      assert.deepEqual(receipt, {
        actor_id: firstAdminActorId(orgs.linked), actor_role: 'service', action: 'first_admin_linked',
        target_table: 'users', target_id: user.id, beneficiary_id: null, support_case_id: null,
        detail: JSON.stringify({
          schemaVersion: 1, emailSha256: sha256Hex(email), authSubjectSha256: sha256Hex(subject),
        }),
      });

      const after = await businessRowCounts(admin, orgs.linked);
      assert.deepEqual(
        { users: after.users, assignments: after.assignments, receipts: after.receipts },
        { users: 1, assignments: 2, receipts: 1 },
      );
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('업무 runtime이 RLS 경계 안에서 같은 영수증을 읽는다', async () => {
      const api = postgres(apiUrl, { max: 1, onnotice: () => {} });
      try {
        const session = await api.reserve();
        try {
          await session.unsafe('BEGIN');
          await session.unsafe('SELECT set_config($1, $2, true)', ['app.org_id', orgs.linked]);
          const rows = await session.unsafe(READINESS_RECEIPT_QUERY, [orgs.linked, firstAdminActorId(orgs.linked)]);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].auth_subject, subject);
          const detail = JSON.parse(rows[0].detail);
          assert.deepEqual(detail, {
            schemaVersion: 1, emailSha256: sha256Hex(email), authSubjectSha256: sha256Hex(subject),
          });
          await session.unsafe('ROLLBACK');
        } finally {
          await session.release();
        }
      } finally {
        await api.end({ timeout: 5 }).catch(() => {});
      }
    });

    await t.test('같은 기관의 두 번째 관리자는 고정 code로 거부된다', async () => {
      const before = await businessRowCounts(admin, orgs.linked);
      const refusal = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.linked, authSubject: otherSubject, email: otherEmail,
      }));
      assert.deepEqual(refusal, { ok: false, code: 'FIRST_ADMIN_EXISTS' });
      assert.deepEqual(await businessRowCounts(admin, orgs.linked), before);
      assert.equal(await forcedTableCount(admin), 3);
    });

    await t.test('같은 subject와 이메일의 재실행은 같은 해시를 돌려주고 아무것도 쓰지 않는다', async () => {
      const before = await businessRowCounts(admin, orgs.linked);
      const report = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.linked, authSubject: subject, email, name: '다른 표시 이름',
      }));
      assert.deepEqual(report, {
        ok: true, operation: 'link-first-admin', ready: true,
        userIdSha256: sha256Hex(linkedUserId), emailSha256: sha256Hex(email),
        authSubjectSha256: sha256Hex(subject),
      });
      assert.deepEqual(await businessRowCounts(admin, orgs.linked), before);
      const [user] = await admin.unsafe('SELECT name FROM users WHERE org_id = $1', [orgs.linked]);
      assert.equal(user.name, '첫 관리자');
    });

    await t.test('이미 쓰인 Auth subject는 다른 기관에서도 거부된다', async () => {
      const refusal = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.second, authSubject: subject, email: otherEmail,
      }));
      assert.deepEqual(refusal, { ok: false, code: 'FIRST_ADMIN_SUBJECT_TAKEN' });
      const counts = await businessRowCounts(admin, orgs.second);
      assert.deepEqual(
        { users: counts.users, assignments: counts.assignments, receipts: counts.receipts },
        { users: 0, assignments: 0, receipts: 0 },
      );
    });

    await t.test('다른 기관의 첫 관리자는 표시 이름 없이 독립으로 연결된다', async () => {
      const report = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.second, authSubject: otherSubject, email: otherEmail,
      }));
      assert.equal(report.ready, true);
      assert.equal(report.authSubjectSha256, sha256Hex(otherSubject));
      const [user] = await admin.unsafe(
        'SELECT id, name, auth_subject FROM users WHERE org_id = $1',
        [orgs.second],
      );
      assert.equal(user.name, null);
      assert.equal(user.auth_subject, otherSubject);
      assert.equal(report.userIdSha256, sha256Hex(user.id));
      const counts = await businessRowCounts(admin, orgs.second);
      assert.deepEqual(
        { users: counts.users, assignments: counts.assignments, receipts: counts.receipts },
        { users: 1, assignments: 2, receipts: 1 },
      );
    });

    await t.test('영수증 없이 기관 관리자가 있으면 연결하지 않는다', async () => {
      // users insert trigger가 canonical institution_admin을 함께 만든다.
      await admin.unsafe(
        "INSERT INTO users (id, org_id, email, role, active) VALUES ($1, $2, $3, 'admin', 1)",
        ['legacy-admin-user', orgs.legacy, 'synthetic.legacy@example.invalid'],
      );
      const before = await businessRowCounts(admin, orgs.legacy);
      const refusal = await withInstallerSession(installerUrl, session => linkFirstAdmin(session, {
        orgId: orgs.legacy, authSubject: otherSubject, email: otherEmail,
      }));
      assert.deepEqual(refusal, { ok: false, code: 'FIRST_ADMIN_EXISTS' });
      assert.deepEqual(await businessRowCounts(admin, orgs.legacy), before);
    });

    await t.test('설치자 권한만으로는 되돌린 FORCE RLS 뒤에서 업무 표를 읽지 못한다', async () => {
      const visible = await withInstallerSession(installerUrl, async session => {
        const [row] = await session.unsafe('SELECT count(*)::integer AS users FROM users');
        return row.users;
      });
      assert.equal(visible, 0);
    });
  } finally {
    await admin.end({ timeout: 5 }).catch(() => {});
  }
});
