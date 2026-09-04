import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  INVITE_SIGNUP_ACTOR_ID,
  ValidationError,
  consumeInviteToken,
  createCounselorInvite,
  createParticipantInvite,
  getInviteForSignup,
} from '@ccc/core/gateway';
import { grantTestPractitionerRole, setupD1, testActors } from './support/d1';

const { counselor, admin, service } = testActors;

const t = setupD1();

// 초대 토큰 기반(D39 · ADR-0016 · CCC-29). 토큰이 곧 자격이므로 발급 권한·경계 조회·
// 단방향 소비를 gateway 단위에서 고정한다. HTTP 문단속은 CCC-28의 라우트 테스트 몫.
describe('invite tokens (CCC-29)', () => {
  it('실무자가 당사자 초대를 발급하면 사업+발급자가 묶인 64자 hex 토큰이 생기고 감사가 남는다', async () => {
    await t.reset();

    const invite = await createParticipantInvite(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.kind).toBe('participant');
    expect(invite.orgId).toBe(counselor.orgId);
    expect(invite.programType).toBe('financial_support_v1');
    expect(invite.issuedBy).toBe(counselor.userId);
    expect(invite.status).toBe('issued');
    expect(invite.usedAt).toBeNull();

    const audit = await t.db.prepare(
      "SELECT actor_id, action FROM audit_log WHERE action = 'invite_issue' AND target_id = ?",
    ).bind(invite.token).first<{ actor_id: string; action: string }>();
    expect(audit?.actor_id).toBe(counselor.userId);
  });

  it('관리자도 당사자 초대를 발급할 수 있다 (겸임 1계정, D39)', async () => {
    await t.reset();
    await grantTestPractitionerRole(t.db, admin);

    const invite = await createParticipantInvite(t.env, admin, {
      programType: 'financial_support_v1',
    });
    expect(invite.issuedBy).toBe(admin.userId);
  });

  it('서비스 역할은 당사자 초대를 발급할 수 없다', async () => {
    await t.reset();

    await expect(
      createParticipantInvite(t.env, service, { programType: 'financial_support_v1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('당사자 초대는 유효한 사업 유형이 필수다', async () => {
    await t.reset();

    await expect(
      createParticipantInvite(t.env, counselor, { programType: 'unknown_program' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('실무자 초대 발급은 관리자만 할 수 있다', async () => {
    await t.reset();

    await expect(createCounselorInvite(t.env, counselor)).rejects.toBeInstanceOf(ForbiddenError);

    const invite = await createCounselorInvite(t.env, admin);
    expect(invite.kind).toBe('counselor');
    expect(invite.programType).toBeNull();
    expect(invite.issuedBy).toBe(admin.userId);
  });

  it('경계 조회는 유효한 토큰+종류 일치만 통과시키고 나머지는 같은 에러로 거부한다', async () => {
    await t.reset();

    const invite = await createParticipantInvite(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    const found = await getInviteForSignup(t.env, invite.token, 'participant');
    expect(found.token).toBe(invite.token);

    // 종류 불일치 · 무효 토큰 · 빈 토큰 — 전부 동일한 ForbiddenError (열거 단서 차단)
    await expect(getInviteForSignup(t.env, invite.token, 'counselor')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getInviteForSignup(t.env, 'f'.repeat(64), 'participant')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getInviteForSignup(t.env, '', 'participant')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('소비는 issued → used 단방향이고 두 번째 소비는 거부된다', async () => {
    await t.reset();

    const invite = await createParticipantInvite(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    const used = await consumeInviteToken(t.env, invite.token, 'participant', {
      beneficiaryId: 'crane-001',
    });
    expect(used.status).toBe('used');
    expect(used.usedAt).not.toBeNull();

    const row = await t.db.prepare(
      'SELECT used_by_beneficiary_id FROM invite_tokens WHERE token = ?',
    ).bind(invite.token).first<{ used_by_beneficiary_id: string }>();
    expect(row?.used_by_beneficiary_id).toBe('crane-001');

    // 사용된 토큰은 경계 조회·재소비 모두 거부
    await expect(getInviteForSignup(t.env, invite.token, 'participant')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      consumeInviteToken(t.env, invite.token, 'participant', { beneficiaryId: 'crane-002' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 소비 감사는 시스템 행위자(가입자는 디렉터리에 없음, D14)
    const audit = await t.db.prepare(
      "SELECT actor_id FROM audit_log WHERE action = 'invite_consume' AND target_id = ?",
    ).bind(invite.token).first<{ actor_id: string }>();
    expect(audit?.actor_id).toBe(INVITE_SIGNUP_ACTOR_ID);
  });

  it('검증 뒤 폐기된 토큰도 DB 경계에서 소비되지 않는다', async () => {
    await t.reset();
    const invite = await createCounselorInvite(t.env, admin);
    await expect(getInviteForSignup(t.env, invite.token, 'counselor')).resolves.toBeTruthy();
    await t.db.prepare(
      'UPDATE invite_tokens SET revoked_at = datetime(\'now\') WHERE token = ?',
    ).bind(invite.token).run();

    await expect(t.db.prepare(
      `UPDATE invite_tokens
       SET status = 'used', used_at = datetime('now')
       WHERE token = ?`,
    ).bind(invite.token).run()).rejects.toThrow('invite_token_revoked');
    await expect(t.db.prepare(
      'SELECT status FROM invite_tokens WHERE token = ?',
    ).bind(invite.token).first<{ status: string }>()).resolves.toEqual({ status: 'issued' });
  });
});
