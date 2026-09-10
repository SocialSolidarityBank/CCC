import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  EMERGENCY_CONSENT_GRACE_DAYS,
  EmergencyReasonRequiredError,
  PrivacyConsentRequiredError,
  ValidationError,
  appendSupportCaseConsentEvent,
  completeParticipantSignup,
  createBeneficiaryWithInitialSupportCase,
  createParticipantInvite,
  createSupportCase,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  listEmergencyConsentDeadlines,
  listPrivacyConsentFollowUps,
  type Actor,
} from '@ccc/core/gateway';
import { CONSENT_DOMAINS, type ConsentDomain } from '@ccc/contracts/consent';
import { grantTestPractitionerRole, setupD1, testActors, testProgramId } from './support/d1';
import { registrationConsentEvents, registrationInput } from './support/registration';

// G1 (docs/consent/consent-implementation-gates-v1.md §2 · 2026-07-29 Q 결정1):
// ① 개인정보 수집·이용 동의는 등록의 **하드 게이트**이고, 급박한 위기 개입만 "긴급 등록"
// (사유 필수 · 보완 기한 · 전건 감사)으로 통과한다. 나머지 다섯 도메인 미동의 경로는 불변이다(D15).
//
// S7 이후 동의의 정본은 6종 consent_events 다 — support_cases 의 옛 동의 시각 컬럼은
// 아무 권위도 갖지 않으므로 이 파일은 그 컬럼을 읽지 않는다. 긴급 등록 3값만 케이스 행에 남는다.
//
// 이 파일이 고정하는 것: ① 없음 + 긴급 아님 → 거부 / 긴급 → 허용 + 기한 생성 /
// 자기 가입에서 ① 없음 → 거부 / 보완 대상 리포트.

const { counselor, admin } = testActors;
const t = setupD1();

const INTAKE_AT = '2026-07-16T09:00:00.000Z';
const PRIVACY: ConsentDomain = 'personal_data_collection_use';
/** 여섯 도메인을 모두 거절한다 — ① 이 빠지므로 긴급 사유 없이는 등록이 성립하지 않는다. */
const DECLINE_ALL = Object.fromEntries(
  CONSENT_DOMAINS.map((domain) => [domain, 'decline' as const]),
) as Partial<Record<ConsentDomain, 'decline'>>;
/** ①·② 만 받고 녹음·외부 처리 네 종은 거절한 "최소 동의" 등록. */
const PRIVACY_ONLY: Partial<Record<ConsentDomain, 'decline'>> = {
  counseling_recording: 'decline',
  external_stt_processing: 'decline',
  external_llm_cross_border_processing: 'decline',
  voice_original_retention_period: 'decline',
};

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

/** 긴급 등록 3값만 읽는다 — 동의 자체는 consent_events 가 정본이다(S7). */
async function emergencyRow(supportCaseId: string) {
  return t.db.prepare(
    `SELECT emergency_registration_at, emergency_registration_reason, consent_privacy_due_at
     FROM support_cases WHERE id = ?`,
  ).bind(supportCaseId).first<Record<string, unknown>>();
}

async function consentStates(actor: Actor, supportCaseId: string): Promise<Record<ConsentDomain, string>> {
  const states = await getSupportCaseConsent(t.env, actor, supportCaseId);
  return Object.fromEntries(states.map((state) => [state.domain, state.state])) as Record<ConsentDomain, string>;
}

/** ① 보완: 뒤늦게 받은 개인정보 동의를 그 시점 고지에 묶어 한 건 더 쌓는다(append-only). */
async function grantPrivacyLater(actor: Actor, supportCaseId: string): Promise<void> {
  const disclosures = await issueSupportCaseConsentDisclosures(t.env, actor, supportCaseId);
  const disclosure = disclosures.find((item) => item.domain === PRIVACY);
  if (disclosure === undefined) throw new Error('missing privacy consent disclosure');
  await appendSupportCaseConsentEvent(t.env, actor, supportCaseId, {
    domain: PRIVACY,
    decision: 'grant',
    provider: disclosure.provider,
    providerLegalRecipient: disclosure.providerLegalRecipient,
    providerCountry: disclosure.country,
    purpose: disclosure.purpose,
    retentionDuration: null,
    copyVersion: disclosure.copyVersion,
    copyHash: disclosure.copyHash,
    disclosureSnapshotId: disclosure.snapshotId,
    effectiveAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
    correctionOfEventId: null,
    expectedRevision: null,
  });
}

describe('① 개인정보 동의 하드 게이트 — 당사자 등록 (G1)', () => {
  it('① 없음 + 긴급 아님이면 등록을 거부한다', async () => {
    await t.reset();
    await expect(createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(
        t.env, counselor, { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT }, DECLINE_ALL,
      ),
    )).rejects.toBeInstanceOf(PrivacyConsentRequiredError);

    // 거부는 아무것도 남기지 않는다 — 반쯤 만들어진 당사자가 남으면 게이트가 무의미해진다.
    const created = await t.db.prepare('SELECT COUNT(*) AS count FROM beneficiaries')
      .first<{ count: number }>();
    expect(created?.count).toBe(0);
    const events = await t.db.prepare('SELECT COUNT(*) AS count FROM consent_events')
      .first<{ count: number }>();
    expect(events?.count).toBe(0);
  });

  it('①만 받으면 나머지 다섯 도메인 미동의여도 등록이 진행된다 (D15 미동의 경로 불변)', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(
        t.env, counselor, { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT }, PRIVACY_ONLY,
      ),
    );
    expect(await consentStates(counselor, creation.supportCaseId)).toEqual({
      personal_data_collection_use: 'granted',
      sensitive_information_processing: 'granted',
      counseling_recording: 'not_granted',
      external_stt_processing: 'not_granted',
      external_llm_cross_border_processing: 'not_granted',
      voice_original_retention_period: 'not_granted',
    });
    expect(await emergencyRow(creation.supportCaseId)).toEqual({
      emergency_registration_at: null,
      emergency_registration_reason: null,
      consent_privacy_due_at: null,
    });
  });

  it('긴급 등록은 사유·보완 기한과 함께 통과한다', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(
        t.env,
        counselor,
        {
          programId: testProgramId(counselor.orgId),
          intakeAt: INTAKE_AT,
          emergencyReason: '위기 개입 — 서면 동의 전 등록',
        },
        DECLINE_ALL,
      ),
    );

    // 거절도 기록이다 — 여섯 도메인이 모두 미동의로 읽히되, ① 이 비어 기한이 걸린다.
    const states = await consentStates(counselor, creation.supportCaseId);
    expect(Object.values(states)).toEqual(CONSENT_DOMAINS.map(() => 'not_granted'));

    const row = await emergencyRow(creation.supportCaseId);
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
      await registrationInput(
        t.env,
        counselor,
        { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT, emergencyReason: '   ' },
        DECLINE_ALL,
      ),
    )).rejects.toBeInstanceOf(EmergencyReasonRequiredError);
  });

  it('① 동의와 긴급 등록이 함께 오면 거부한다 (예외는 동의가 없을 때만 성립)', async () => {
    await t.reset();
    await expect(createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(
        t.env,
        counselor,
        { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT, emergencyReason: '사유' },
        PRIVACY_ONLY,
      ),
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('HTTP 등록도 같은 게이트를 지난다 — ① 을 거절하면 422 다', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/participants', {
      method: 'POST',
      headers: headersFor(counselor),
      body: JSON.stringify({
        programId: testProgramId(counselor.orgId),
        idempotencyKey: crypto.randomUUID(),
        consentEvents: await registrationConsentEvents(
          t.env, counselor, testProgramId(counselor.orgId), DECLINE_ALL,
        ),
      }),
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
        programId: testProgramId(counselor.orgId),
        idempotencyKey: crypto.randomUUID(),
        consentEvents: await registrationConsentEvents(
          t.env, counselor, testProgramId(counselor.orgId), DECLINE_ALL,
        ),
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
      await registrationInput(
        t.env, counselor, { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT }, PRIVACY_ONLY,
      ),
    );
  }

  it('① 없음 + 긴급 아님이면 거부한다', async () => {
    await t.reset();
    const initial = await initialCase();
    await expect(createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '11111111-1111-4111-8111-111111111111',
      programId: testProgramId(counselor.orgId),
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentEvents: await registrationConsentEvents(
        t.env, counselor, testProgramId(counselor.orgId), DECLINE_ALL,
      ),
    })).rejects.toBeInstanceOf(PrivacyConsentRequiredError);

    const count = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM support_cases WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('두 번째 사업은 자기 6종을 새로 받는다 — 앞 사업의 동의를 물려받지 않는다', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '22222222-2222-4222-8222-222222222222',
      programId: testProgramId(counselor.orgId),
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentEvents: await registrationConsentEvents(t.env, counselor, testProgramId(counselor.orgId)),
    });

    // 두 케이스가 서로 다른 결정을 든다: 앞 사업은 녹음 계열이 비어 있고, 새 사업은 전부 받았다.
    expect(await consentStates(counselor, initial.supportCaseId))
      .toMatchObject({ personal_data_collection_use: 'granted', counseling_recording: 'not_granted' });
    expect(await consentStates(counselor, second.supportCaseId))
      .toEqual(Object.fromEntries(CONSENT_DOMAINS.map((domain) => [domain, 'granted'])));

    // 이벤트는 케이스별로 6건씩 따로 쌓인다 — 앞 사업 행을 다시 쓰지 않는다(append-only).
    const rows = await t.db.prepare(
      'SELECT support_case_id, COUNT(*) AS n, MIN(recorded_by) AS recorded_by FROM consent_events GROUP BY support_case_id',
    ).all<{ support_case_id: string; n: number; recorded_by: string }>();
    expect(rows.results).toEqual(expect.arrayContaining([
      { support_case_id: initial.supportCaseId, n: 6, recorded_by: counselor.userId },
      { support_case_id: second.supportCaseId, n: 6, recorded_by: counselor.userId },
    ]));
  });

  it('긴급 등록이면 사유·기한이 두 번째 사업에도 남는다', async () => {
    await t.reset();
    const initial = await initialCase();
    const second = await createSupportCase(t.env, counselor, initial.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '33333333-3333-4333-8333-333333333333',
      programId: testProgramId(counselor.orgId),
      intakeAt: '2026-07-17T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
      consentEvents: await registrationConsentEvents(
        t.env, counselor, testProgramId(counselor.orgId), DECLINE_ALL,
      ),
      emergencyReason: '연락 두절 직전 급박한 개입',
    });
    const row = await emergencyRow(second.supportCaseId);
    expect(row?.emergency_registration_reason).toBe('연락 두절 직전 급박한 개입');
    expect(row?.consent_privacy_due_at).not.toBeNull();
    expect((await consentStates(counselor, second.supportCaseId)).personal_data_collection_use)
      .toBe('not_granted');
  });
});

describe('① 하드 게이트 — 자기 가입 (G1 · 긴급 예외 없음)', () => {
  it('① 없이 가입하면 거부한다', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programId: testProgramId(counselor.orgId) });
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
    const invite = await createParticipantInvite(t.env, counselor, { programId: testProgramId(counselor.orgId) });
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
      await registrationInput(
        t.env, counselor, { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT }, PRIVACY_ONLY,
      ),
    );
    const urgent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(
        t.env,
        counselor,
        { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT, emergencyReason: '위기 개입' },
        DECLINE_ALL,
      ),
    );

    const pending = await listPrivacyConsentFollowUps(t.env, counselor);
    expect(pending.map((item) => item.supportCaseId)).toEqual([urgent.supportCaseId]);
    expect(pending[0]?.emergencyRegistrationAt).not.toBeNull();
    expect(pending[0]?.consentPrivacyDueAt).not.toBeNull();
    expect(pending[0]?.overdue).toBe(false);
    // 동의한 케이스는 애초에 목록에 없다.
    expect(pending.some((item) => item.supportCaseId === consented.supportCaseId)).toBe(false);

    await grantPrivacyLater(counselor, urgent.supportCaseId);
    expect((await consentStates(counselor, urgent.supportCaseId)).personal_data_collection_use)
      .toBe('granted');
    await expect(listPrivacyConsentFollowUps(t.env, counselor)).resolves.toEqual([]);
  });

  it('기한이 지난 긴급 등록은 워치독 집계에 잡힌다 (만료 전·후 알림)', async () => {
    await t.reset();
    await grantTestPractitionerRole(t.db, admin);
    const urgent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      admin,
      await registrationInput(
        t.env,
        admin,
        {
          programId: testProgramId(admin.orgId),
          initialAssigneeUserId: admin.userId,
          emergencyReason: '위기 개입',
        },
        DECLINE_ALL,
      ),
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
      await registrationInput(
        t.env,
        counselor,
        { programId: testProgramId(counselor.orgId), intakeAt: INTAKE_AT, emergencyReason: '위기 개입' },
        DECLINE_ALL,
      ),
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
