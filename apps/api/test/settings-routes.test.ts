import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { setupD1 } from './support/d1';

// 설정 화면(#14)의 두 데이터 경로에 대한 HTTP 계약 테스트.
//   GET /me     — 내 계정(이메일·역할). 인증된 본인 누구나(역할 무관).
//   GET /users  — 조직 상담사 목록. 시스템 관리자(admin)만 200, 그 외 403.
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
    await expect(response.json()).resolves.toEqual({
      id: 'counselor.routes@example.invalid',
      orgId: 'org_demo',
      email: 'counselor.routes@example.invalid',
      role: 'counselor',
      active: true,
      name: null, // D31: 표시 이름 미입력이면 null(화면은 이메일 폴백)
      // D35·ADR-0014 '개정' 2번: `/` 직행 목적지. 아직 고른 적이 없으면 null 이고
      // 화면이 첫 사업으로 폴백한다.
      lastProgramType: null,
    });
    // R1: 자기 신원 열람도 감사에 남는다(read, users, self).
    // 마지막 선택 사업 조회는 여기에 행을 더하지 않는다 — 본인 UI 설정이라 감사 대상이
    // 아니다(근거: db/gateway.ts rememberLastProgramType · migrations/0017 주석).
    expect(await auditRows('counselor.routes@example.invalid')).toEqual([
      expect.objectContaining({ action: 'read', targetTable: 'users', detail: JSON.stringify({ self: true }) }),
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
    // 자기 조직 계정은 보이고(관리자 본인 + 상담사), 다른 조직 계정은 절대 새지 않는다.
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
