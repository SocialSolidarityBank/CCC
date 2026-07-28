import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  ValidationError,
  deactivateUser,
  findUserByEmail,
  getLastProgramType,
  listUsers,
  rememberLastProgramType,
  upsertUser,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const { admin, otherOrgAdmin, counselor } = testActors;

const t = setupD1({ provisionDirectory: false });

describe('user directory (users)', () => {
  it('provisions a user, lists it, and resolves it by email', async () => {
    await t.reset();

    const created = await upsertUser(t.env, admin, { email: 'c1@example.invalid', role: 'counselor' });
    expect(created).toEqual(expect.objectContaining({ email: 'c1@example.invalid', role: 'counselor', active: true, orgId: 'org_demo' }));
    expect(created.id.length).toBeGreaterThan(0);

    const list = await listUsers(t.env, admin);
    expect(list.map((u) => u.email)).toEqual(['c1@example.invalid']);

    const found = await findUserByEmail(t.env, 'c1@example.invalid');
    expect(found?.id).toBe(created.id);
  });

  it('stores an optional display name and preserves it when omitted on re-upsert (D31)', async () => {
    await t.reset();

    const created = await upsertUser(t.env, admin, { email: 'named@example.invalid', role: 'counselor', name: '홍길동' });
    expect(created.name).toBe('홍길동');

    // name 미전달 재-upsert 는 기존 이름을 보존한다(COALESCE).
    const preserved = await upsertUser(t.env, admin, { email: 'named@example.invalid', role: 'counselor' });
    expect(preserved.name).toBe('홍길동');

    // 명시 전달 시 이름을 갱신한다.
    const renamed = await upsertUser(t.env, admin, { email: 'named@example.invalid', role: 'counselor', name: '김철수' });
    expect(renamed.name).toBe('김철수');

    // 이름 없이 만든 사용자는 name 이 null 이다(이메일 폴백 대상).
    const anon = await upsertUser(t.env, admin, { email: 'anon@example.invalid', role: 'counselor' });
    expect(anon.name).toBeNull();
  });

  it('honors an explicit userId on create and updates role on re-upsert (same email)', async () => {
    await t.reset();

    const created = await upsertUser(t.env, admin, { email: 'svc@example.invalid', role: 'service', userId: 'mac-mini-token' });
    expect(created.id).toBe('mac-mini-token');

    const updated = await upsertUser(t.env, admin, { email: 'svc@example.invalid', role: 'counselor', userId: 'ignored-on-update' });
    expect(updated.id).toBe('mac-mini-token'); // 이메일이 신원 키 — userId 인자는 갱신 시 무시
    expect(updated.role).toBe('counselor');
    expect((await listUsers(t.env, admin)).length).toBe(1);
  });

  it('deactivates a user and reactivates it on re-upsert', async () => {
    await t.reset();
    const created = await upsertUser(t.env, admin, { email: 'c2@example.invalid', role: 'counselor' });

    const deactivated = await deactivateUser(t.env, admin, created.id);
    expect(deactivated.active).toBe(false);
    expect((await findUserByEmail(t.env, 'c2@example.invalid'))?.active).toBe(false);

    const reactivated = await upsertUser(t.env, admin, { email: 'c2@example.invalid', role: 'counselor' });
    expect(reactivated.active).toBe(true);
  });

  it('guards the last active admin against demotion and deactivation', async () => {
    await t.reset();
    const admin1 = await upsertUser(t.env, admin, { email: 'a1@example.invalid', role: 'admin' });

    // 유일한 활성 관리자는 강등도 비활성화도 불가.
    await expect(upsertUser(t.env, admin, { email: 'a1@example.invalid', role: 'counselor' })).rejects.toBeInstanceOf(ValidationError);
    await expect(deactivateUser(t.env, admin, admin1.id)).rejects.toBeInstanceOf(ValidationError);

    // 두 번째 관리자를 두면 첫 관리자를 강등할 수 있다.
    await upsertUser(t.env, admin, { email: 'a2@example.invalid', role: 'admin' });
    const demoted = await upsertUser(t.env, admin, { email: 'a1@example.invalid', role: 'counselor' });
    expect(demoted.role).toBe('counselor');
  });

  it('prevents an admin from deactivating themselves', async () => {
    await t.reset();
    // 행위자 자신의 id로 관리자 행을 만들고, 잠금 방지를 위해 여벌 관리자도 둔다.
    await upsertUser(t.env, admin, { email: 'me@example.invalid', role: 'admin', userId: admin.userId });
    await upsertUser(t.env, admin, { email: 'spare@example.invalid', role: 'admin' });

    await expect(deactivateUser(t.env, admin, admin.userId)).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to touch a user that belongs to another organization', async () => {
    await t.reset();
    await upsertUser(t.env, admin, { email: 'shared@example.invalid', role: 'counselor' });
    await expect(upsertUser(t.env, otherOrgAdmin, { email: 'shared@example.invalid', role: 'admin' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('restricts directory management to admins', async () => {
    await t.reset();
    await expect(listUsers(t.env, counselor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(upsertUser(t.env, counselor, { email: 'x@example.invalid', role: 'counselor' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deactivateUser(t.env, counselor, 'whatever')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects invalid role and empty email', async () => {
    await t.reset();
    await expect(upsertUser(t.env, admin, { email: '   ', role: 'counselor' })).rejects.toBeInstanceOf(ValidationError);
    await expect(upsertUser(t.env, admin, { email: 'x@example.invalid', role: 'superuser' as unknown as 'admin' })).rejects.toBeInstanceOf(ValidationError);
  });
});

// 마지막 선택 사업 — `/` 직행 목적지 (D35 · ADR-0014 '개정' 2번).
// 이 값은 users 행에 붙으므로 위 describe 와 달리 디렉터리가 채워진 컨텍스트가 필요하다.
const p = setupD1();

describe('last program type (users.last_program_type)', () => {
  it('아직 고른 적이 없으면 null 이고, 기억시킨 뒤에는 그 값을 돌려준다', async () => {
    await p.reset();
    expect(await getLastProgramType(p.env, counselor)).toBeNull();

    await rememberLastProgramType(p.env, counselor, 'financial_support_v1');
    expect(await getLastProgramType(p.env, counselor)).toBe('financial_support_v1');
  });

  it('본인 행만 쓴다 — 다른 사용자의 값은 그대로다', async () => {
    await p.reset();
    await rememberLastProgramType(p.env, counselor, 'financial_support_v1');
    expect(await getLastProgramType(p.env, admin)).toBeNull();
  });

  it('감사를 남기지 않는다 — 본인 UI 설정이라 감사 로그를 내비게이션 흔적으로 덮지 않는다', async () => {
    // D14 가 기록하라고 정한 것은 당사자·케이스 기록의 열람·변경·복호화·내보내기다.
    // 근거는 migrations/0017 주석과 게이트웨이 함수 주석에 적혀 있다.
    await p.reset();
    const before = await p.env.DB.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>();
    await rememberLastProgramType(p.env, counselor, 'financial_support_v1');
    await getLastProgramType(p.env, counselor);
    const after = await p.env.DB.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it('같은 값을 다시 기억시켜도 쓰기가 돌지 않는다', async () => {
    // 이 값은 화면 진입마다 기록되므로, 변화가 없을 때 UPDATE 가 돌면 쓰기가 상시 발생한다.
    await p.reset();
    await rememberLastProgramType(p.env, counselor, 'financial_support_v1');
    await rememberLastProgramType(p.env, counselor, 'financial_support_v1');
    expect(await getLastProgramType(p.env, counselor)).toBe('financial_support_v1');
  });

  it('빈 값은 거부하고, 서비스 토큰은 화면이 없으므로 막는다', async () => {
    await p.reset();
    await expect(rememberLastProgramType(p.env, counselor, '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(rememberLastProgramType(p.env, testActors.service, 'financial_support_v1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
