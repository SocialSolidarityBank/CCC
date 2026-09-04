import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  EMERGENCY_CONSENT_GRACE_DAYS,
  EmergencyReasonRequiredError,
  PrivacyConsentRequiredError,
  ValidationError,
  completeParticipantSignup,
  createBeneficiaryWithInitialSupportCase,
  createParticipantInvite,
  createSupportCase,
  listEmergencyConsentDeadlines,
  listPrivacyConsentFollowUps,
  updateParticipantConsent,
} from '@ccc/core/gateway';
import { grantTestPractitionerRole, setupD1, testActors } from './support/d1';

// G1 (docs/consent/consent-implementation-gates-v1.md §2 · 2026-07-29 Q 결정1):
// ① 개인정보 수집·이용 동의는 등록의 **하드 게이트**이고, 급박한 위기 개입만 "긴급 등록"
// (사유 필수 · 보완 기한 · 전건 감사)으로 통과한다. ②·③ 미동의 경로는 불변이다(D15).
//
// 이 파일이 고정하는 것: ① 없음 + 긴급 아님 → 거부 / 긴급 → 허용 + 기한 생성 /
// 자기 가입에서 ① 없음 → 거부 / 보완 대상 리포트.

const { counselor, admin } = testActors;
const t = setupD1();

const INTAKE_AT = '2026-07-16T09:00:00.000Z';

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

async function supportCaseRow(supportCaseId: string) {
  return t.db.prepare(
    `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at,
            emergency_registration_at, emergency_registration_reason,
            consent_privacy_due_at
     FROM support_cases WHERE id = ?`,
  ).bind(supportCaseId).first<Record<string, unknown>>();
}

describe('① 개인정보 동의 하드 게이트 — 당사자 등록 (G1)', () => {
  it('① 없음 + 긴급 아님이면 등록을 거부한다', async () => {
    await t.reset();
    await expect(createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recordingAi: false },
    )).rejects.toBeInstanceOf(PrivacyConsentRequiredError);

    // 거부는 아무것도 남기지 않는다 — 반쯤 만들어진 당사자가 남으면 게이트가 무의미해진다.
    const created = await t.db.prepare('SELECT COUNT(*) AS count FROM beneficiaries')
      .first<{ count: number }>();
    expect(created?.count).toBe(0);
  });

  it('①만 체크하면 ②·③ 미동의여도 등록이 진행된다 (D15 미동의 경로 불변)', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: true, recordingAi: false },
    );
    const row = await supportCaseRow(creation.supportCaseId);
    expect(row?.consent_privacy_at).not.toBeNull();
    expect(row?.emergency_registration_at).toBeNull();
    expect(row?.consent_privacy_due_at).toBeNull();
  });

  it('긴급 등록은 사유·보완 기한과 함께 통과한다', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '위기 개입 — 서면 동의 전 등록' } },
    );

    const row = await supportCaseRow(creation.supportCaseId);
    expect(row?.consent_privacy_at).toBeNull();
    expect(row?.emergency_registration_reason).toBe('위기 개입 — 서면 동의 전 등록');
    const registeredAt = String(row?.emergency_registration_at);
    const dueAt = String(row?.consent_privacy_due_at);
    expect(Date.parse(dueAt) - Date.parse(registeredAt))
      .toBe(EMERGENCY_CONSENT_GRACE_DAYS * 86_400_000);

    // 전건 감사(D14): 긴급 등록은 record_consent 계열로 남고, 사유 텍스트는 싣지 않는다(R3 태도).
    const audit = await t.db.prepare(
      "SELECT detail FROM audit_log WHERE action = 'record_consent' AND beneficiary_id = ?",
    ).bind(creation.beneficiaryId).first<{ detail: string }>();
    expect(audit).not.toBeNull();
    const detail = JSON.parse(String(audit?.detail)) as Record<string, unknown>;
    expect(detail.emergencyRegistration).toBe(true);
    expect(detail.consentPrivacyDueAt).toBe(dueAt);
    expect(JSON.stringify(detail)).not.toContain('위기 개입');
  });

  it('긴급 등록에 사유가 비면 거부한다', async () => {
    await t.reset();
    await expect(createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '   ' } },
    )).rejects.toBeInstanceOf(EmergencyReasonRequiredError);
  });

  it('① 동의와 긴급 등록이 함께 오면 거부한다 (예외는 동의가 없을 때만 성립)', async () => {
    await t.reset();
    await expect(createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: true, recordingAi: false, emergency: { reason: '사유' } },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('HTTP 등록도 같은 게이트를 지난다 — 동의 키가 아예 없어도 422 다', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/participants', {
      method: 'POST',
      headers: headersFor(counselor),
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), t.env);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'privacy_consent_required' });
  });

  it('HTTP 긴급 등록: 사유가 비면 emergency_reason_required 로 구분해 돌려준다', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/participants', {
      method: 'POST',
      headers: headersFor(counselor),
      body: JSON.stringify({
        programType: 'financial_support_v1',
        consentPrivacy: false,
        emergencyReason: '',
      }),
    }), t.env);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'emergency_reason_required' });
  });
});

describe('① 하드 게이트 — 추가 참여 사업 (G1 · D44 두 번째 사업은 미체크로 시작)', () => {
  async function initialCase() {
    return createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: true, recordingAi: false },
    );
  }

  it('① 없음 + 긴급 아님이면 거부한다', async () => {
    await t.reset();
    const initial = await initialCase();
    await expect(createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '11111111-1111-4111-8111-111111111111',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentPrivacy: false,
    })).rejects.toBeInstanceOf(PrivacyConsentRequiredError);

    const count = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM support_cases WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('① 체크면 동의 이력이 한 행 더 쌓인다 (앞 사업의 동의를 물려받지 않는다)', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '22222222-2222-4222-8222-222222222222',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentPrivacy: true,
    });

    const row = await t.db.prepare(
      `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at, recorded_by, recorded_at
       FROM participant_consent_records WHERE support_case_id = ?`,
    ).bind(second.supportCaseId).first<Record<string, unknown>>();
    expect(row?.consent_privacy_at).toBe(row?.recorded_at);
    expect(row?.consent_recording_at).toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
    expect(row?.recorded_by).toBe(counselor.userId);
  });

  // D49: 이 인자가 생기기 전에는 두 번째 사업에서 ② 를 기록할 API 경로가 아예 없었다.
  it('② AI를 활용한 녹취기록 동의를 두 번째 사업에서 함께 받는다 (D49)', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '44444444-4444-4444-8444-444444444444',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentPrivacy: true,
      consentRecordingAi: true,
    });

    // 현재값과 이력 행 양쪽에 두 컬럼이 같은 시각으로 남는다(insert 가드 정합).
    const current = await supportCaseRow(second.supportCaseId);
    expect(current?.consent_recording_at).not.toBeNull();
    expect(current?.consent_text_ai_at).toBe(current?.consent_recording_at);

    const row = await t.db.prepare(
      `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at, recorded_at
       FROM participant_consent_records WHERE support_case_id = ?`,
    ).bind(second.supportCaseId).first<Record<string, unknown>>();
    expect(row?.consent_recording_at).toBe(row?.recorded_at);
    expect(row?.consent_text_ai_at).toBe(row?.recorded_at);
  });

  it('② 를 보내지 않으면 미동의로 시작한다 — ② 는 게이트가 아니다 (D49)', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '55555555-5555-4555-8555-555555555555',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentPrivacy: true,
    });
    const row = await supportCaseRow(second.supportCaseId);
    expect(row?.consent_recording_at).toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
  });

  it('긴급 등록이면 사유·기한이 두 번째 사업에도 남는다', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '33333333-3333-4333-8333-333333333333',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentPrivacy: false,
      emergencyReason: '연락 두절 직전 급박한 개입',
    });
    const row = await supportCaseRow(second.supportCaseId);
    expect(row?.consent_privacy_at).toBeNull();
    expect(row?.emergency_registration_reason).toBe('연락 두절 직전 급박한 개입');
    expect(row?.consent_privacy_due_at).not.toBeNull();
  });
});

describe('① 하드 게이트 — 자기 가입 (G1 · 긴급 예외 없음)', () => {
  it('① 없이 가입하면 거부한다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    await expect(completeParticipantSignup(t.env, {
      token: invite.token,
      name: '홍길동',
      consent: { privacy: false, recordingAi: false },
    })).rejects.toBeInstanceOf(PrivacyConsentRequiredError);

    // 토큰은 소비되지 않는다 — 거부된 제출이 링크를 태워 버리면 당사자가 다시 가입할 수 없다.
    const token = await t.db.prepare('SELECT status FROM invite_tokens WHERE token = ?')
      .bind(invite.token).first<{ status: string }>();
    expect(token?.status).toBe('issued');
  });

  it('자기 가입에는 긴급 등록 예외가 없다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    await expect(completeParticipantSignup(t.env, {
      token: invite.token,
      name: '홍길동',
      consent: { privacy: false, recordingAi: false, emergency: { reason: '급함' } },
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('① 동의 보완 대상 리포트 (G1 완료 기준)', () => {
  it('긴급 등록 건을 담당 실무자가 목록으로 본다 — 동의를 보완하면 목록에서 빠진다', async () => {
    await t.reset();
    const consented = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: true, recordingAi: false },
    );
    const urgent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '위기 개입' } },
    );

    const pending = await listPrivacyConsentFollowUps(t.env, counselor);
    expect(pending.map((item) => item.supportCaseId)).toEqual([urgent.supportCaseId]);
    expect(pending[0]?.emergencyRegistrationAt).not.toBeNull();
    expect(pending[0]?.consentPrivacyDueAt).not.toBeNull();
    expect(pending[0]?.overdue).toBe(false);
    // 동의한 케이스는 애초에 목록에 없다.
    expect(pending.some((item) => item.supportCaseId === consented.supportCaseId)).toBe(false);

    await updateParticipantConsent(t.env, counselor, urgent.supportCaseId, {
      privacy: true, recordingAi: false,
    });
    await expect(listPrivacyConsentFollowUps(t.env, counselor)).resolves.toEqual([]);
  });

  it('기한이 지난 긴급 등록은 워치독 집계에 잡힌다 (만료 전·후 알림)', async () => {
    await t.reset();
    await grantTestPractitionerRole(t.db, admin);
    const urgent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      admin,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT, initialAssigneeUserId: admin.userId },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '위기 개입' } },
    );
    // 방금 만든 건의 기한은 14일 뒤라 '임박(3일)'에도 '경과'에도 들지 않는다 — 알림이
    // 등록 즉시 울리지 않는다는 것이 여기서 고정하는 계약이다(기한 컬럼은 0028 로 불변이라
    // 시간을 앞당겨 경과 상태를 만들 수는 없다).
    await expect(listEmergencyConsentDeadlines(t.env)).resolves.toEqual([]);

    // 그래도 보완 대상 리포트에는 처음부터 올라와 있다 — 기한과 무관하게 ① 이 비었기 때문이다.
    const followUps = await listPrivacyConsentFollowUps(t.env, admin);
    expect(followUps.map((item) => item.supportCaseId)).toEqual([urgent.supportCaseId]);
  });

  it('HTTP 리포트 라우트도 같은 목록을 낸다', async () => {
    await t.reset();
    const urgent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '위기 개입' } },
    );
    const response = await worker.fetch(new Request('http://localhost/consent/follow-ups', {
      method: 'GET',
      headers: headersFor(counselor),
    }), t.env);
    expect(response.status).toBe(200);
    const body = await response.json() as { results: { supportCaseId: string }[] };
    expect(body.results.map((item) => item.supportCaseId)).toEqual([urgent.supportCaseId]);
  });
});
