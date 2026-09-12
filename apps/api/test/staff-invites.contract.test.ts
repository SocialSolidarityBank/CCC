import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import worker from './support/local-worker';
import { completeOrganizationOnboarding } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';
import { checkpointSources, proveStaffInvitesSchema } from './support/migration-parity';

// D86 직원 초대(staff_invites). 기존 invite_tokens 는 당사자 링크 전용으로 남고,
// 익명 발급이던 POST /invites/counselor 는 폐기된다.
//
// 이 표면은 **공개 참가자 가입 스위치(PUBLIC_SIGNUP_ENABLED)와 무관**하다 — 기관이
// 직원을 들이는 일은 당사자 공개 가입을 열었는지와 아무 상관이 없다. 그래서 이 파일의
// 모든 요청은 스위치가 **없는** t.env 로 보낸다(폐기 라우트 확인 한 건만 예외).

const { admin, counselor, otherOrgAdmin } = testActors;

const TECHNICAL_ADMIN_ID = 'tech.admin@example.invalid';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function headersFor(userId: string, orgId: string, role: 'admin' | 'counselor'): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': userId,
    'X-CCC-Org-Id': orgId,
    'X-CCC-Role': role,
  };
}

const adminHeaders = headersFor(admin.userId, admin.orgId, 'admin');
const counselorHeaders = headersFor(counselor.userId, counselor.orgId, 'counselor');
const technicalAdminHeaders = headersFor(TECHNICAL_ADMIN_ID, admin.orgId, 'admin');
const otherOrgAdminHeaders = headersFor(otherOrgAdmin.userId, otherOrgAdmin.orgId, 'admin');

const t = setupD1();

afterEach(() => {
  vi.useRealTimers();
});

interface StaffInvite {
  id: string;
  email: string;
  roles: string[];
  status: 'issued' | 'used' | 'revoked';
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function postJson(path: string, headers: Record<string, string>, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** 발급까지 끝난 초대 하나. token 은 이 한 번의 응답에만 존재한다. */
async function issueInvite(
  headers: Record<string, string>,
  input: { email: string; roles: string[] },
): Promise<{ invite: StaffInvite; token: string }> {
  const res = await worker.fetch(postJson('/staff-invites', headers, input), t.env);
  expect(res.status).toBe(201);
  return await res.json() as { invite: StaffInvite; token: string };
}

/** users.role='admin' 로 등재되면 트리거가 institution_admin + institution_technical_admin 을
 * 심는다. 기술 관리자만 남기려고 institution_admin 한 줄을 직접 회수한다(다른 활성
 * institution_admin 이 org_demo 에 남아 있어 last_required_institution_role 가드에 걸리지 않는다). */
async function seedTechnicalOnlyAdmin(): Promise<void> {
  await t.db.prepare(
    'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, NULL)',
  ).bind(TECHNICAL_ADMIN_ID, admin.orgId, TECHNICAL_ADMIN_ID, 'admin').run();
  await t.db.prepare(
    `UPDATE user_role_assignments
     SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE org_id = ? AND user_id = ? AND role = 'institution_admin' AND revoked_at IS NULL`,
  ).bind(admin.orgId, TECHNICAL_ADMIN_ID).run();

  const active = await t.db.prepare(
    'SELECT role FROM user_role_assignments WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY role',
  ).bind(admin.orgId, TECHNICAL_ADMIN_ID).all<{ role: string }>();
  expect(active.results.map((row) => row.role)).toEqual(['institution_technical_admin']);
}

async function activeRoles(userId: string, orgId = admin.orgId): Promise<{ role: string; source: string; grantedBy: string | null }[]> {
  const rows = await t.db.prepare(
    `SELECT role, source, granted_by AS grantedBy
     FROM user_role_assignments
     WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL
     ORDER BY role`,
  ).bind(orgId, userId).all<{ role: string; source: string; grantedBy: string | null }>();
  return rows.results;
}

async function userRow(email: string): Promise<{ id: string; org_id: string; role: string; active: number; name: string | null } | null> {
  return await t.db.prepare(
    'SELECT id, org_id, role, active, name FROM users WHERE email = ?',
  ).bind(email).first();
}

async function countUsers(email: string): Promise<number> {
  const row = await t.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').bind(email).first<{ n: number }>();
  return row?.n ?? 0;
}

async function inviteRow(id: string): Promise<Record<string, unknown> | null> {
  return await t.db.prepare('SELECT * FROM staff_invites WHERE id = ?').bind(id).first();
}

describe('POST /staff-invites (기관 관리자 발급)', () => {
  it('공개 가입 스위치 없이도 발급된다 — 토큰은 이 응답 한 번뿐이고 DB 에는 해시만 남는다', async () => {
    await t.reset();
    expect(t.env.PUBLIC_SIGNUP_ENABLED).toBeUndefined();

    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'New.Staff@Example.Invalid',
      roles: ['practitioner'],
    });

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite).toMatchObject({
      email: 'new.staff@example.invalid',
      roles: ['practitioner'],
      status: 'issued',
      usedAt: null,
      revokedAt: null,
    });
    expect(invite.id).toBeTruthy();

    // 기본 수명 7일(발급 안에서 now() 를 두 번 읽을 수 있으므로 2초 여유).
    const lifetime = Date.parse(invite.expiresAt) - Date.parse(invite.issuedAt);
    expect(Math.abs(lifetime - SEVEN_DAYS_MS)).toBeLessThanOrEqual(2000);

    // 평문 토큰은 어디에도 저장되지 않는다 — 해시만.
    const row = await inviteRow(invite.id);
    expect(row).toMatchObject({
      org_id: admin.orgId,
      token_hash: await sha256Hex(token),
      email_normalized: 'new.staff@example.invalid',
      issued_by: admin.userId,
      status: 'issued',
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.parse(String(row?.roles_json))).toEqual(['practitioner']);
  });

  it('목록은 토큰을 절대 돌려주지 않는다', async () => {
    await t.reset();
    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'listed.staff@example.invalid',
      roles: ['practitioner'],
    });

    const res = await worker.fetch(new Request('http://localhost/staff-invites', { headers: adminHeaders }), t.env);
    expect(res.status).toBe(200);
    const body = await res.json() as { invites: StaffInvite[] };
    const listed = body.invites.find((row) => row.id === invite.id);
    expect(listed).toMatchObject({ email: 'listed.staff@example.invalid', roles: ['practitioner'], status: 'issued' });
    expect(listed).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('기관 관리자는 역할을 하나 이상 골라야 한다 — 빈 배열은 400', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/staff-invites', adminHeaders, { email: 'norole.staff@example.invalid', roles: [] }),
      t.env,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
    const row = await t.db.prepare('SELECT COUNT(*) AS n FROM staff_invites').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('역할 개수에 상한이 없다 — 줄 수 있는 역할 셋을 한 번에 주는 초대도 발급된다', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/staff-invites', adminHeaders, {
        email: 'every.role@example.invalid',
        roles: ['institution_admin', 'institution_technical_admin', 'practitioner'],
      }),
      t.env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { invite: { roles: string[] } };
    expect([...body.invite.roles].sort()).toEqual(
      ['institution_admin', 'institution_technical_admin', 'practitioner'],
    );
  });

  it('실무 책임자는 초대로 줄 수 없다 — 팀 감독 지정에서만 생긴다', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/staff-invites', adminHeaders, {
        email: 'supervisor.invite@example.invalid', roles: ['supervisor'],
      }),
      t.env,
    );
    expect(res.status).toBe(400);
    const row = await t.db.prepare('SELECT COUNT(*) AS n FROM staff_invites').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('같은 역할을 두 번 적으면 거절한다 — 상한을 없앤 뒤에도 중복은 막는다', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/staff-invites', adminHeaders, {
        email: 'duplicate.role@example.invalid',
        roles: ['practitioner', 'practitioner'],
      }),
      t.env,
    );
    expect(res.status).toBe(400);
    const row = await t.db.prepare('SELECT COUNT(*) AS n FROM staff_invites').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('실무자는 발급할 수 없다(403)', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/staff-invites', counselorHeaders, { email: 'by.practitioner@example.invalid', roles: ['practitioner'] }),
      t.env,
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    const row = await t.db.prepare('SELECT COUNT(*) AS n FROM staff_invites').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('GET /staff-invites/token/:token (공개 조회)', () => {
  it('기관 이름·역할·만료만 돌려준다 — 이메일은 어떤 형태로도 싣지 않는다', async () => {
    await t.reset();
    await completeOrganizationOnboarding(t.env, admin, {
      orgName: '사회연대은행',
      programDisplayName: '마이크로크레딧',
    });
    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'public.staff@example.invalid',
      roles: ['practitioner'],
    });

    const res = await worker.fetch(new Request(`http://localhost/staff-invites/token/${token}`), t.env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({
      orgName: '사회연대은행',
      roles: ['practitioner'],
      expiresAt: invite.expiresAt,
    });
    // 이메일도, 그 지역부(local part)도 새지 않는다.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('public.staff');
    expect(serialized).not.toContain('@');
  });

  it('없는 토큰은 404', async () => {
    await t.reset();
    const res = await worker.fetch(new Request(`http://localhost/staff-invites/token/${'0'.repeat(64)}`), t.env);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });
});

describe('POST /staff-invites/token/:token/accept (공개 수락)', () => {
  it('이메일이 다르면 404 — 무엇이 틀렸는지 알려주지 않고 계정도 만들지 않는다', async () => {
    await t.reset();
    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'invited.staff@example.invalid',
      roles: ['practitioner'],
    });

    const res = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '다른 사람',
        email: 'someone.else@example.invalid',
      }),
      t.env,
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
    expect(await countUsers('someone.else@example.invalid')).toBe(0);
    expect(await countUsers('invited.staff@example.invalid')).toBe(0);
    // 토큰은 소비되지 않는다 — 제 사람이 여전히 쓸 수 있다.
    expect(await inviteRow(invite.id)).toMatchObject({ status: 'issued', used_at: null, used_by_user_id: null });
  });

  it('수락하면 활성 사용자와 초대에 적힌 역할만 생기고 초대는 소비된다', async () => {
    await t.reset();
    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'Accepted.Staff@Example.Invalid',
      roles: ['practitioner'],
    });

    const res = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '수락한 직원',
        email: 'accepted.staff@example.invalid',
      }),
      t.env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { userId: string; email: string; roleWaiting: boolean };
    expect(body.email).toBe('accepted.staff@example.invalid');
    expect(body.roleWaiting).toBe(false);
    expect(body.userId).toBeTruthy();

    const user = await userRow('accepted.staff@example.invalid');
    expect(user).toMatchObject({ id: body.userId, org_id: admin.orgId, role: 'counselor', active: 1, name: '수락한 직원' });

    // 활성 역할은 초대에 적힌 것과 **정확히** 같고, 발급자가 부여자다
    // (users 등재 트리거가 심는 legacy 줄은 같은 배치에서 회수된다).
    expect(await activeRoles(body.userId)).toEqual([
      { role: 'practitioner', source: 'manual', grantedBy: admin.userId },
    ]);

    expect(await inviteRow(invite.id)).toMatchObject({
      status: 'used',
      used_by_user_id: body.userId,
      used_at: expect.any(String),
      consumption_id: expect.any(String),
    });
  });

  it('관리자 역할이 섞이면 users.role 은 admin 으로 등재된다', async () => {
    await t.reset();
    const { token } = await issueInvite(adminHeaders, {
      email: 'new.admin@example.invalid',
      roles: ['institution_admin', 'practitioner'],
    });

    const res = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '새 관리자',
        email: 'new.admin@example.invalid',
      }),
      t.env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { userId: string };

    expect(await userRow('new.admin@example.invalid')).toMatchObject({ role: 'admin', active: 1 });
    expect(await activeRoles(body.userId)).toEqual([
      { role: 'institution_admin', source: 'manual', grantedBy: admin.userId },
      { role: 'practitioner', source: 'manual', grantedBy: admin.userId },
    ]);
  });

  it('토큰은 1회성 — 두 번째 수락은 거절되고 계정이 겹쳐 생기지 않는다', async () => {
    await t.reset();
    const { token } = await issueInvite(adminHeaders, {
      email: 'once.staff@example.invalid',
      roles: ['practitioner'],
    });
    const accept = (name: string): Request => postJson(
      `/staff-invites/token/${token}/accept`,
      { 'content-type': 'application/json' },
      { name, email: 'once.staff@example.invalid' },
    );

    expect((await worker.fetch(accept('첫 수락'), t.env)).status).toBe(201);
    const second = await worker.fetch(accept('두 번째 수락'), t.env);
    expect([404, 409]).toContain(second.status);
    expect(await countUsers('once.staff@example.invalid')).toBe(1);
  });

  it('회수된 초대는 수락할 수 없다(404)', async () => {
    await t.reset();
    const { invite, token } = await issueInvite(adminHeaders, {
      email: 'revoked.staff@example.invalid',
      roles: ['practitioner'],
    });

    const revoked = await worker.fetch(postJson(`/staff-invites/${invite.id}/revoke`, adminHeaders), t.env);
    expect(revoked.status).toBe(200);
    const revokedBody = await revoked.json() as { invite: StaffInvite };
    expect(revokedBody.invite).toMatchObject({ id: invite.id, status: 'revoked', revokedAt: expect.any(String) });
    expect(revokedBody).not.toHaveProperty('token');
    expect(await inviteRow(invite.id)).toMatchObject({ status: 'revoked', revoked_by: admin.userId });

    const res = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '회수 뒤 수락',
        email: 'revoked.staff@example.invalid',
      }),
      t.env,
    );
    expect(res.status).toBe(404);
    expect(await countUsers('revoked.staff@example.invalid')).toBe(0);
  });

  it('만료된 초대는 조회도 수락도 404 (수명은 응용 시계로 판정한다)', async () => {
    await t.reset();
    const { token } = await issueInvite(adminHeaders, {
      email: 'expired.staff@example.invalid',
      roles: ['practitioner'],
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + SEVEN_DAYS_MS + 60_000));

    const info = await worker.fetch(new Request(`http://localhost/staff-invites/token/${token}`), t.env);
    expect(info.status).toBe(404);

    const accept = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '만료 뒤 수락',
        email: 'expired.staff@example.invalid',
      }),
      t.env,
    );
    expect(accept.status).toBe(404);
    expect(await countUsers('expired.staff@example.invalid')).toBe(0);
  });
});

describe('기술 관리자 전용 발급(역할 대기)', () => {
  it('roles [] 로 발급하면 수락자는 활성 역할 없이 등재된다', async () => {
    await t.reset();
    await seedTechnicalOnlyAdmin();

    const { invite, token } = await issueInvite(technicalAdminHeaders, {
      email: 'waiting.staff@example.invalid',
      roles: [],
    });
    expect(invite.roles).toEqual([]);
    expect(await inviteRow(invite.id)).toMatchObject({ issued_by: TECHNICAL_ADMIN_ID, roles_json: '[]' });

    const info = await worker.fetch(new Request(`http://localhost/staff-invites/token/${token}`), t.env);
    expect(info.status).toBe(200);
    await expect(info.json()).resolves.toMatchObject({ roles: [] });

    const res = await worker.fetch(
      postJson(`/staff-invites/token/${token}/accept`, { 'content-type': 'application/json' }, {
        name: '역할 대기 직원',
        email: 'waiting.staff@example.invalid',
      }),
      t.env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { userId: string; roleWaiting: boolean };
    expect(body.roleWaiting).toBe(true);

    // 계정은 살아 있지만 권한은 0 — legacy 자동 부여분까지 같은 배치에서 회수된다.
    expect(await userRow('waiting.staff@example.invalid')).toMatchObject({ role: 'counselor', active: 1 });
    expect(await activeRoles(body.userId)).toEqual([]);
    expect(await inviteRow(invite.id)).toMatchObject({ status: 'used', used_by_user_id: body.userId });
  });
});

describe('기관 경계', () => {
  it('다른 기관 관리자는 남의 초대를 보지도 회수하지도 못한다', async () => {
    await t.reset();
    const { invite } = await issueInvite(adminHeaders, {
      email: 'scoped.staff@example.invalid',
      roles: ['practitioner'],
    });

    const list = await worker.fetch(new Request('http://localhost/staff-invites', { headers: otherOrgAdminHeaders }), t.env);
    expect(list.status).toBe(200);
    const body = await list.json() as { invites: StaffInvite[] };
    expect(body.invites.some((row) => row.id === invite.id)).toBe(false);

    const revoke = await worker.fetch(postJson(`/staff-invites/${invite.id}/revoke`, otherOrgAdminHeaders), t.env);
    expect(revoke.status).toBe(404);
    expect(await inviteRow(invite.id)).toMatchObject({ status: 'issued', revoked_at: null });
  });
});

describe('폐기된 익명 발급 라우트', () => {
  it('POST /invites/counselor 는 공개 가입 스위치를 열어도 404', async () => {
    await t.reset();
    const res = await worker.fetch(
      postJson('/invites/counselor', adminHeaders),
      { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' },
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });
});

describe('0058 forward SQLite upgrade', () => {
  it('replays the registered checkpoint through the shared live semantic proof', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-staff-invite-checkpoint-'));
    const db = openEncryptedSqlite({ filename: join(directory, 'proof.db'), key: new Uint8Array(32).fill(29) });
    try {
      for (const checkpoint of checkpointSources()) await db.applyMigrations(checkpoint.sqlite);
      await proveStaffInvitesSchema(db);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
