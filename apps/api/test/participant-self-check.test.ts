import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  completeParticipantSignup,
  createCounselingSchedule,
  createParticipantInvite,
  getParticipantSelfCheck,
  type ParticipantSelfCheck,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';
import worker from './support/local-worker';

// CCC-27 당사자 자기 확인 — 가입 링크(소비된 토큰)로 여는 본인 정보 페이지의
// 게이트웨이·라우트 시험. 고정하는 것은 두 가지다:
//   ① 유효(소비된) 토큰은 200, 무효·미소비·실무자용 토큰은 저마다 404(구분 불가)
//   ② 표시는 정확히 다섯 갈래(이름·연락처 / 참여 사업+담당 / 일정 / 동의) — 기록 내용 없음

const { counselor, admin } = testActors;

const t = setupD1();

function signupOpenEnv() {
  return { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' };
}

/** 가입까지 끝낸 토큰·당사자 고정물. 이름·연락처를 심어 PII 왕복도 검증한다. */
async function seedJoinedParticipant() {
  const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
  const result = await completeParticipantSignup(t.env, {
    token: invite.token,
    name: '홍길동',
    phone: '010-1234-5678',
    email: 'hong@example.invalid',
    consent: { privacy: true, recordingAi: true },
  });
  return { token: invite.token, ...result };
}

describe('getParticipantSelfCheck (CCC-27)', () => {
  it('이름·연락처, 참여 사업+담당 실무자, 일정(다가오는/지난), 동의 상태를 반환한다', async () => {
    await t.reset();
    const joined = await seedJoinedParticipant();
    await t.db.prepare(
      'INSERT INTO counseling_schedules (id, org_id, beneficiary_id, support_case_id, scheduled_at, status, version, created_by_actor_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime(\'now\'), datetime(\'now\'))',
    ).bind(
      'schedule-future-1', counselor.orgId, joined.beneficiaryId, joined.supportCaseId,
      '2099-01-15T09:00:00.000Z', 'scheduled', counselor.userId,
    ).run();
    await t.db.prepare(
      'INSERT INTO counseling_schedules (id, org_id, beneficiary_id, support_case_id, scheduled_at, status, version, created_by_actor_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime(\'now\'), datetime(\'now\'))',
    ).bind(
      'schedule-past-1', counselor.orgId, joined.beneficiaryId, joined.supportCaseId,
      '2026-01-10T09:00:00.000Z', 'cancelled', counselor.userId,
    ).run();

    const check = await getParticipantSelfCheck(t.env, joined.token);

    expect(check.name).toBe('홍길동');
    expect(check.phone).toBe('010-1234-5678');
    expect(check.email).toBe('hong@example.invalid');
    expect(check.programs).toHaveLength(1);
    expect(check.programs[0]).toEqual({
      programType: 'financial_support_v1',
      // 발급 실무자(후원자)가 담당으로 배정된다(ADR-0016 결정 5).
      counselorName: expect.any(String),
      consent: { privacy: true, recordingAi: true },
    });
    expect(check.upcomingSchedules.map((s) => s.id)).toEqual(['schedule-future-1']);
    expect(check.pastSchedules.map((s) => s.id)).toEqual(['schedule-past-1']);
  });

  it('응답에 상담 기록 내용(요약·플래그·브리핑) 키가 없다 — 표시 범위 고정', async () => {
    await t.reset();
    const joined = await seedJoinedParticipant();

    const check: ParticipantSelfCheck = await getParticipantSelfCheck(t.env, joined.token);
    const keys = Object.keys(check);
    expect(keys.sort()).toEqual(
      ['email', 'name', 'pastSchedules', 'phone', 'programs', 'upcomingSchedules'],
    );
    expect(JSON.stringify(check)).not.toMatch(/memo|summary|flag|briefing|oneLiner|gas/i);
  });

  it('미소비(issued)·무효 토큰은 거부한다 (구분 불가, 열거 단서 금지)', async () => {
    await t.reset();
    await seedJoinedParticipant();
    const unused = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });

    await expect(getParticipantSelfCheck(t.env, unused.token)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getParticipantSelfCheck(t.env, 'not-a-real-token')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('GET /invites/participant/:token/me (CCC-27)', () => {
  it('소비된 유효 토큰이면 200과 다섯 갈래를 돌려준다', async () => {
    await t.reset();
    const joined = await seedJoinedParticipant();

    const res = await worker.fetch(
      new Request(`http://localhost/invites/participant/${joined.token}/me`),
      signupOpenEnv(),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      name: '홍길동',
      phone: '010-1234-5678',
      email: 'hong@example.invalid',
      programs: [{ programType: 'financial_support_v1', counselorName: expect.any(String) }],
      upcomingSchedules: [],
      pastSchedules: [],
    });
  });

  it('미소비·무효 토큰은 404로 뭉친다 (구분 불가)', async () => {
    await t.reset();
    await seedJoinedParticipant();
    const unused = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });

    for (const token of [unused.token, 'not-a-real-token']) {
      const res = await worker.fetch(
        new Request(`http://localhost/invites/participant/${encodeURIComponent(token)}/me`),
        signupOpenEnv(),
      );
      expect(res.status).toBe(404);
    }
  });

  it('스위치 미설정이면 자기 확인 표면도 닫힌다 (fail closed, CCC-112 규약)', async () => {
    await t.reset();
    const joined = await seedJoinedParticipant();

    const res = await worker.fetch(
      new Request(`http://localhost/invites/participant/${joined.token}/me`),
      t.env,
    );
    expect(res.status).toBe(404);
  });

  it('실무자용 토큰(kind=counselor)은 404다 — 참여자 표면이 아니다', async () => {
    await t.reset();
    // 실무자용 토큰은 별도 발급 경로가 복잡해, invite_tokens 에 직접 넣는다(구조 고정).
    await t.db.prepare(
      `INSERT INTO invite_tokens (token, org_id, kind, program_type, issued_by, status, issued_at)
       VALUES ('counselor-token-ccc27', ?, 'counselor', NULL, ?, 'used', datetime('now'))`,
    ).bind(counselor.orgId, counselor.userId).run();

    const res = await worker.fetch(
      new Request('http://localhost/invites/participant/counselor-token-ccc27/me'),
      signupOpenEnv(),
    );
    expect(res.status).toBe(404);
  });
});