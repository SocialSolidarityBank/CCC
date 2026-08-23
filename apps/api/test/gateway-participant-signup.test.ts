import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  INVITE_SIGNUP_ACTOR_ID,
  PARTICIPANT_SELF_RECORDER,
  ValidationError,
  completeParticipantSignup,
  createParticipantInvite,
  type ParticipantSignupResult,
} from '../../../db/gateway';
import { grantTestPractitionerRole, setupD1, testActors } from './support/d1';

const { counselor, admin } = testActors;

const t = setupD1();

// 당사자 자기 가입(D39 · ADR-0016 · CCC-28). 토큰 권한 원자 트랜잭션: 당사자+케이스+
// 담당 배정+동의(기록자=본인)+토큰 소비를 한 배치에 묶고, 동시 이중 제출은 DB 가드로
// 되감는다. HTTP 문단속은 라우트 테스트 몫.
describe('participant self signup (CCC-28)', () => {
  it('실무자가 발급한 링크로 가입하면 당사자+케이스+배정+동의+토큰 소비가 한 번에 성립한다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });

    const result = await completeParticipantSignup(t.env, {
      token: invite.token,
      name: '홍길동',
      phone: '010-1234-5678',
      email: 'hong@example.invalid',
      consent: { privacy: true, recordingAi: true },
    });

    expect(result.beneficiaryId).toMatch(/^[a-z]+-\d{3}$/);
    expect(result.supportCaseId).toBeTruthy();

    const beneficiary = await t.db.prepare(
      'SELECT initialization_state FROM beneficiaries WHERE id = ?',
    ).bind(result.beneficiaryId).first<{ initialization_state: string }>();
    expect(beneficiary?.initialization_state).toBe('complete');

    const supportCase = await t.db.prepare(
      `SELECT program_type, status, intake_at, consent_recording_at, consent_text_ai_at,
              consent_privacy_at, creation_kind
       FROM support_cases WHERE id = ?`,
    ).bind(result.supportCaseId).first<{
      program_type: string; status: string; intake_at: string | null;
      consent_recording_at: string | null; consent_text_ai_at: string | null;
      consent_privacy_at: string | null; creation_kind: string;
    }>();
    expect(supportCase?.program_type).toBe('financial_support_v1');
    expect(supportCase?.status).toBe('active');
    expect(supportCase?.creation_kind).toBe('initial');
    expect(supportCase?.intake_at).toBeNull(); // 가입 시점에는 인테이크 상담이 아직 없다
    // 동의의 **현재값**이 체크한 대로 남는다 — "가입이 성공했다"만으로는 어떤 동의가 저장됐는지
    // 알 수 없어서 전 컬럼을 본다. D49: ② 한 체크가 두 컬럼에 같은 시각을 찍는다.
    expect(supportCase?.consent_privacy_at).not.toBeNull();
    expect(supportCase?.consent_recording_at).not.toBeNull();
    expect(supportCase?.consent_text_ai_at).toBe(supportCase?.consent_recording_at);

    // 담당 실무자는 링크 발급 실무자(ADR-0016 결정 5).
    const assignee = await t.db.prepare(
      "SELECT user_id, role FROM support_case_assignees WHERE support_case_id = ? AND role = 'primary'",
    ).bind(result.supportCaseId).first<{ user_id: string; role: string }>();
    expect(assignee?.user_id).toBe(counselor.userId);

    // PII 는 금고에 암호문으로 들어간다(D3).
    const vault = await t.db.prepare(
      'SELECT enc_name, enc_phone, enc_email FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(result.beneficiaryId).first<{ enc_name: string | null; enc_phone: string | null; enc_email: string | null }>();
    expect(vault?.enc_name).not.toBeNull();
    expect(vault?.enc_phone).not.toBeNull();
    expect(vault?.enc_email).not.toBeNull();

    // 토큰은 소비되고 당사자로 역참조된다.
    const token = await t.db.prepare(
      'SELECT status, used_by_beneficiary_id FROM invite_tokens WHERE token = ?',
    ).bind(invite.token).first<{ status: string; used_by_beneficiary_id: string | null }>();
    expect(token?.status).toBe('used');
    expect(token?.used_by_beneficiary_id).toBe(result.beneficiaryId);
  });

  it('동의 기록의 기록자는 본인이며 발급 실무자가 아니다 (ADR-0016 결정 6)', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });

    const result = await completeParticipantSignup(t.env, {
      token: invite.token,
      name: '홍길동',
      // G1: 자기 가입도 ① 없이는 성립하지 않는다. 여기서 보는 것은 기록자 표식이다.
      consent: { privacy: true, recordingAi: true },
    });

    const consent = await t.db.prepare(
      `SELECT recorded_by, consent_recording_at, consent_text_ai_at, consent_privacy_at
       FROM participant_consent_records WHERE beneficiary_id = ?`,
    ).bind(result.beneficiaryId).first<{
      recorded_by: string; consent_recording_at: string | null;
      consent_text_ai_at: string | null; consent_privacy_at: string | null;
    }>();
    expect(consent?.recorded_by).toBe(PARTICIPANT_SELF_RECORDER);
    expect(consent?.recorded_by).not.toBe(counselor.userId);
    // 현재값(support_cases)만이 아니라 **이력 행에도** 같은 모양으로 남는다(D44 2층 저장).
    expect(consent?.consent_privacy_at).not.toBeNull();
    expect(consent?.consent_recording_at).not.toBeNull();
    expect(consent?.consent_text_ai_at).toBe(consent?.consent_recording_at);
  });

  it('관리자가 발급한 링크의 담당 실무자는 그 관리자다 (겸임 1계정)', async () => {
    await t.reset();
    await grantTestPractitionerRole(t.db, admin);
    const invite = await createParticipantInvite(t.env, admin, { programType: 'financial_support_v1' });

    const result = await completeParticipantSignup(t.env, {
      token: invite.token,
      name: '홍길동',
      consent: { privacy: true, recordingAi: true },
    });

    const assignee = await t.db.prepare(
      "SELECT user_id FROM support_case_assignees WHERE support_case_id = ? AND role = 'primary'",
    ).bind(result.supportCaseId).first<{ user_id: string }>();
    expect(assignee?.user_id).toBe(admin.userId);
  });

  it('이미 소비된 토큰으로 다시 가입하면 거부된다 (순차)', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    await completeParticipantSignup(t.env, {
      token: invite.token, name: '홍길동', consent: { privacy: true, recordingAi: true },
    });

    await expect(
      completeParticipantSignup(t.env, {
        token: invite.token, name: '두번째', consent: { privacy: true, recordingAi: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('같은 토큰 동시 이중 제출은 한 명만 성립하고 나머지는 409, 고아 당사자 없음', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    const payload = { token: invite.token, name: '홍길동', consent: { privacy: true, recordingAi: true } };

    const [first, second] = await Promise.allSettled([
      completeParticipantSignup(t.env, payload),
      completeParticipantSignup(t.env, payload),
    ]);

    const fulfilled = [first, second].filter((r): r is PromiseFulfilledResult<ParticipantSignupResult> => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(ConflictError) });

    // 토큰은 정확히 한 번 소비되고, 역참조된 당사자도 하나다.
    const used = await t.db.prepare(
      "SELECT used_by_beneficiary_id FROM invite_tokens WHERE token = ? AND status = 'used'",
    ).bind(invite.token).all<{ used_by_beneficiary_id: string }>();
    expect(used.results).toHaveLength(1);
  });

  it('없는 토큰은 거부된다', async () => {
    await t.reset();
    await expect(
      completeParticipantSignup(t.env, {
        token: '0'.repeat(64), name: '홍길동', consent: { privacy: true, recordingAi: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('이름이 비어 있으면 거부된다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    await expect(
      completeParticipantSignup(t.env, {
        token: invite.token, name: '   ', consent: { privacy: true, recordingAi: true },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('동의가 없거나 형태가 틀리면 거부된다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    await expect(
      completeParticipantSignup(t.env, { token: invite.token, name: '홍길동', consent: null as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('생성 감사 3건은 후원 행위자, 토 소비 감사는 시스템 행위자로 남는다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    const result = await completeParticipantSignup(t.env, {
      token: invite.token, name: '홍길동', consent: { privacy: true, recordingAi: true },
    });

    const creationAudits = await t.db.prepare(
      `SELECT actor_id FROM audit_log
       WHERE beneficiary_id = ? AND action IN ('create', 'assign')`,
    ).bind(result.beneficiaryId).all<{ actor_id: string }>();
    expect(creationAudits.results.length).toBeGreaterThanOrEqual(3);
    expect(creationAudits.results.every((row) => row.actor_id === counselor.userId)).toBe(true);

    const consumeAudit = await t.db.prepare(
      "SELECT actor_id, actor_role FROM audit_log WHERE action = 'invite_consume' AND target_id = ?",
    ).bind(invite.token).first<{ actor_id: string; actor_role: string }>();
    expect(consumeAudit?.actor_id).toBe(INVITE_SIGNUP_ACTOR_ID);
    expect(consumeAudit?.actor_role).toBe('service');
  });
});
