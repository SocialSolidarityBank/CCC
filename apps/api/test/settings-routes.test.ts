import { EventEmitter, once } from 'node:events';
import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { setupD1, testProgramId } from './support/d1';
import type { PreparedStatement } from '@ccc/contracts/database';

// 설정 화면(#14)의 두 데이터 경로에 대한 HTTP 계약 테스트.
//   GET /me     — 내 계정(이메일·역할). 인증된 본인 누구나(역할 무관).
//   GET /users  — 기관 실무자 목록. 기관 관리자(admin)만 200, 그 외 403.
// 프로비저닝된 디렉터리(provisionDirectory 기본값)로 실제 신원 행을 두고 검증한다.

const adminHeaders = {
  'X-CCC-User-Id': 'admin.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'admin',
};

const counselorHeaders = {
  'X-CCC-User-Id': 'counselor.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'counselor',
};

const otherOrgCounselorHeaders = {
  'X-CCC-User-Id': 'counselor.other.routes@example.invalid',
  'X-CCC-Org-Id': 'org_other',
  'X-CCC-Role': 'counselor',
};

const t = setupD1();

interface DirectoryEntry {
  id: string;
  orgId: string;
  email: string;
  role: 'admin' | 'counselor' | 'service';
  active: boolean;
}

async function auditRows(actorId: string): Promise<Array<{ action: string; targetTable: string; detail: string | null }>> {
  const result = await t.db.prepare(
    'SELECT action, target_table AS targetTable, detail FROM audit_log WHERE actor_id = ? ORDER BY id',
  ).bind(actorId).all<{ action: string; targetTable: string; detail: string | null }>();
  return result.results;
}

describe('settings routes (/me, /users)', () => {
  it('returns the authenticated counselor their own email and role on GET /me', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/me', { headers: counselorHeaders }), t.env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'counselor.routes@example.invalid',
      orgId: 'org_demo',
      email: 'counselor.routes@example.invalid',
      role: 'counselor',
      active: true,
      name: null, // D31: 표시 이름 미입력이면 null(화면은 이메일 폴백)
      // D35·ADR-0014 '개정' 2번: `/` 직행 목적지. 아직 고른 적이 없으면 null 이고
      // 화면이 첫 사업으로 폴백한다.
      lastProgramType: null,
      // D74 역할 합(ADR-0038). 어드민 탭 필터(ADR-0044 결정 7)가 읽는다. 실무자는 worker 하나.
      roles: ['worker'],
    });
    // R1: 자기 신원 열람도 감사에 남는다(read, users, self).
    // Last selection adds no audit. Institution readiness is a separate audited settings read.
    expect(await auditRows('counselor.routes@example.invalid')).toEqual([
      expect.objectContaining({ action: 'read', targetTable: 'users', detail: JSON.stringify({ self: true }) }),
      expect.objectContaining({ action: 'read', targetTable: 'organization_settings', detail: JSON.stringify({ institutionReadiness: true }) }),
    ]);
  });

  it('마지막 선택 사업을 기억하고 GET /me 로 되돌려준다 (PUT /me/last-program)', async () => {
    await t.reset();
    const put = await worker.fetch(new Request('http://localhost/me/last-program', {
      method: 'PUT',
      headers: { ...counselorHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), t.env);
    expect(put.status).toBe(200);

    const me = await worker.fetch(new Request('http://localhost/me', { headers: counselorHeaders }), t.env);
    await expect(me.json()).resolves.toEqual(expect.objectContaining({ lastProgramType: 'financial_support_v1' }));
  });

  it('사업 값이 없는 PUT /me/last-program 은 거부한다', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/me/last-program', {
      method: 'PUT',
      headers: { ...counselorHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }), t.env);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
  });

  it('returns the authenticated admin their own email and role on GET /me', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/me', { headers: adminHeaders }), t.env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      email: 'admin.routes@example.invalid',
      role: 'admin',
      active: true,
      // provisionDirectory 의 admin 은 기관 관리자와 기술 관리자를 겸한다(시드와 같음, D74 겸임).
      roles: ['institution-admin', 'technical-admin'],
    }));
  });

  it('rejects GET /me without a verified actor', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/me'), t.env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });

  it('rejects GET /me with unexpected query parameters', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/me?list=true', { headers: counselorHeaders }), t.env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
  });

  it('lets a system administrator list the organization directory on GET /users', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/users', { headers: adminHeaders }), t.env);

    expect(response.status).toBe(200);
    const users = await response.json() as DirectoryEntry[];
    const emails = users.map((user) => user.email);
    // 자기 기관 계정은 보이고(관리자 본인 + 실무자), 다른 기관 계정은 절대 새지 않는다.
    expect(emails).toContain('admin.routes@example.invalid');
    expect(emails).toContain('counselor.routes@example.invalid');
    expect(users.every((user) => user.orgId === 'org_demo')).toBe(true);
    expect(emails).not.toContain('counselor.other.routes@example.invalid');
  });

  it('forbids a counselor from listing the organization directory on GET /users', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/users', { headers: counselorHeaders }), t.env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('forbids a counselor from another org too, and rejects unauthenticated GET /users', async () => {
    await t.reset();
    const crossOrg = await worker.fetch(new Request('http://localhost/users', { headers: otherOrgCounselorHeaders }), t.env);
    expect(crossOrg.status).toBe(403);
    await expect(crossOrg.json()).resolves.toEqual({ error: 'forbidden' });

    const unauthenticated = await worker.fetch(new Request('http://localhost/users'), t.env);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });
});

describe('organization profile partial update', () => {
  const patchProfile = (body: unknown, headers = adminHeaders, env = t.env) => worker.fetch(new Request('http://localhost/organization/profile', {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);

  it('saves only the institution name and preserves the first program and policy', async () => {
    await t.reset();
    await t.db.batch([
      t.db.prepare("UPDATE programs SET display_name = '기존 사업' WHERE id = ?").bind(testProgramId('org_demo')),
      t.db.prepare("UPDATE organization_settings SET initial_program_id = ? WHERE org_id = 'org_demo'").bind(testProgramId('org_demo')),
    ]);
    const response = await patchProfile({ orgName: ' 새 기관 ', expectedOrgName: null });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orgId: 'org_demo', orgName: '새 기관', programDisplayName: '기존 사업' });
    const saved = await worker.fetch(new Request('http://localhost/organization/profile', { headers: adminHeaders }), t.env);
    await expect(saved.json()).resolves.toEqual({ orgId: 'org_demo', orgName: '새 기관', programDisplayName: '기존 사업' });
    const policy = await t.db.prepare("SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = 'org_demo'").first();
    expect(policy?.pii_purge_grace_days).toBe(180);
    const audits = await auditRows(adminHeaders['X-CCC-User-Id']);
    expect(audits.filter(row => row.targetTable === 'organization_settings')).toEqual([
      expect.objectContaining({ action: 'update', detail: expect.not.stringContaining('onboarding') }),
    ]);
  });

  it('rejects a stale same-value editor without recording a second successful change', async () => {
    await t.reset();
    const payload = { orgName: '동시 변경 기관', expectedOrgName: null };
    const barrier = new EventEmitter();
    const ready = once(barrier, 'ready');
    const database = t.env.DB;
    let arrivals = 0;
    const env = {
      ...t.env,
      DB: {
        prepare: database.prepare.bind(database),
        async batch<T>(statements: PreparedStatement[]) {
          if (++arrivals === 2) barrier.emit('ready');
          await ready;
          return database.batch<T>(statements);
        },
      },
    };
    const secondHeaders = { ...adminHeaders, 'X-CCC-User-Id': 'admin@example.invalid' };
    const results = await Promise.all([patchProfile(payload, adminHeaders, env), patchProfile(payload, secondHeaders, env)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const audits = await t.db.prepare("SELECT actor_id FROM audit_log WHERE target_table = 'organization_settings'").all<{ actor_id: string }>();
    expect(audits.results).toEqual([{ actor_id: results[0].status === 200 ? adminHeaders['X-CCC-User-Id'] : secondHeaders['X-CCC-User-Id'] }]);
  });

  it('rejects non-admin writes and unrelated fields without changing stored settings', async () => {
    await t.reset();
    expect((await patchProfile({ orgName: '금지', expectedOrgName: null }, counselorHeaders)).status).toBe(403);
    expect((await patchProfile({ orgName: '금지', expectedOrgName: null, programDisplayName: '침범' })).status).toBe(400);
    expect((await patchProfile({ orgName: '금지', expectedOrgName: null, orgId: 'org_other' })).status).toBe(400);
    expect((await patchProfile({ orgName: ' ' , expectedOrgName: null })).status).toBe(400);
    const saved = await worker.fetch(new Request('http://localhost/organization/profile', { headers: adminHeaders }), t.env);
    await expect(saved.json()).resolves.toEqual({ orgId: 'org_demo', orgName: null, programDisplayName: null });
    expect((await auditRows(adminHeaders['X-CCC-User-Id'])).filter(row => row.targetTable === 'organization_settings')).toEqual([]);
  });

  it('rolls back the name when its audit insert fails', async () => {
    await t.reset();
    await t.db.prepare(`CREATE TRIGGER reject_profile_audit BEFORE INSERT ON audit_log
      WHEN NEW.target_table = 'organization_settings'
      BEGIN SELECT RAISE(ABORT, 'profile audit unavailable'); END`).run();
    expect((await patchProfile({ orgName: '롤백 대상', expectedOrgName: null })).status).toBe(500);
    const saved = await worker.fetch(new Request('http://localhost/organization/profile', { headers: adminHeaders }), t.env);
    await expect(saved.json()).resolves.toEqual({ orgId: 'org_demo', orgName: null, programDisplayName: null });
    expect((await auditRows(adminHeaders['X-CCC-User-Id'])).filter(row => row.targetTable === 'organization_settings')).toEqual([]);
  });

  it('does not recreate missing institution settings', async () => {
    await t.reset();
    await t.db.prepare("DELETE FROM organization_settings WHERE org_id = 'org_demo'").run();
    expect((await patchProfile({ orgName: '새 기관', expectedOrgName: null })).status).toBe(403);
    expect(await t.db.prepare("SELECT org_id FROM organization_settings WHERE org_id = 'org_demo'").first()).toBeNull();
  });

  it('keeps a same-value save unchanged without another audit and rejects stale expectations', async () => {
    await t.reset();
    expect((await patchProfile({ orgName: '새 기관', expectedOrgName: null })).status).toBe(200);
    expect((await patchProfile({ orgName: '새 기관', expectedOrgName: '새 기관' })).status).toBe(200);
    expect((await patchProfile({ orgName: '다른 이름', expectedOrgName: null })).status).toBe(409);
    expect((await auditRows(adminHeaders['X-CCC-User-Id'])).filter(row => row.targetTable === 'organization_settings')).toHaveLength(1);
    const other = await worker.fetch(new Request('http://localhost/organization/profile', { headers: otherOrgCounselorHeaders }), t.env);
    await expect(other.json()).resolves.toEqual({ orgId: 'org_other', orgName: null, programDisplayName: null });
  });

  it('allows IA alone but rejects TA alone, revoked IA, inactive IA, and service actors', async () => {
    await t.reset();
    const actorId = adminHeaders['X-CCC-User-Id'];
    await t.db.prepare("UPDATE user_role_assignments SET revoked_at = '2026-09-09T00:00:00Z' WHERE user_id = ? AND role = 'institution_technical_admin'").bind(actorId).run();
    expect((await patchProfile({ orgName: 'IA 단독', expectedOrgName: null })).status).toBe(200);
    await t.db.prepare("UPDATE user_role_assignments SET revoked_at = '2026-09-09T00:00:00Z' WHERE user_id = ? AND role = 'institution_admin'").bind(actorId).run();
    expect((await patchProfile({ orgName: '철회 후', expectedOrgName: 'IA 단독' })).status).toBe(403);
    await t.db.prepare("INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by) VALUES ('ta-only-profile', 'org_demo', ?, 'institution_technical_admin', 'manual', ?)").bind(actorId, 'admin@example.invalid').run();
    expect((await patchProfile({ orgName: 'TA 단독', expectedOrgName: 'IA 단독' })).status).toBe(403);
    expect((await patchProfile({ orgName: 'service', expectedOrgName: 'IA 단독' }, { ...adminHeaders, 'X-CCC-Role': 'service' })).status).toBe(403);
    await t.db.prepare("INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by) VALUES ('inactive-profile', 'org_demo', ?, 'institution_admin', 'manual', ?)").bind(actorId, 'admin@example.invalid').run();
    await t.db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(actorId).run();
    expect((await patchProfile({ orgName: '비활성', expectedOrgName: 'IA 단독' })).status).toBe(403);
    expect((await auditRows(actorId)).filter(row => row.targetTable === 'organization_settings')).toHaveLength(1);
    expect(await t.db.prepare("SELECT org_name FROM organization_settings WHERE org_id = 'org_demo'").first()).toEqual({ org_name: 'IA 단독' });
  });

  it('fails closed if canonical role assignments cannot be read', async () => {
    await t.reset();
    await t.db.prepare('DROP TABLE user_role_assignments').run();
    expect((await patchProfile({ orgName: '권한 미확인', expectedOrgName: null })).status).toBe(500);
    expect(await t.db.prepare("SELECT org_name FROM organization_settings WHERE org_id = 'org_demo'").first()).toEqual({ org_name: null });
    expect((await auditRows(adminHeaders['X-CCC-User-Id'])).filter(row => row.targetTable === 'organization_settings')).toEqual([]);
  });
});
