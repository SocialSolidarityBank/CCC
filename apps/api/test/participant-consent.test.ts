import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  createBeneficiaryWithInitialSupportCase,
  getIntakeRecordContext,
  updateParticipantConsent,
  ForbiddenError,
  type ParticipantConsentInput,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const { counselor, admin, unassignedCounselor } = testActors;
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

async function register(actor: typeof counselor | typeof admin, consent?: ParticipantConsentInput) {
  const input = actor.role === 'admin'
    ? { programType: 'financial_support_v1' as const, intakeAt: INTAKE_AT, initialAssigneeUserId: actor.userId }
    : { programType: 'financial_support_v1' as const, intakeAt: INTAKE_AT };
  // G1: ① 은 등록의 하드 게이트다. 테스트 기본값은 "동의함"이고, 게이트 자체를 시험하는
  // 테스트만 privacy:false 를 명시한다(스프레드가 뒤에 있어 명시값이 이긴다).
  const gated = consent === undefined ? undefined : { privacy: true, ...consent };
  return createBeneficiaryWithInitialSupportCase(t.env, actor, input, undefined, gated);
}

async function consentRow(beneficiaryId: string) {
  return t.db.prepare(
    'SELECT * FROM participant_consent_records WHERE beneficiary_id = ?',
  ).bind(beneficiaryId).first<Record<string, unknown>>();
}

describe('당사자 등록 동의 기록 (D15 · D23 · 티켓 #19)', () => {
  it('records both consents and mirrors the pipeline gate on support_cases', async () => {
    await t.reset();
    const creation = await register(counselor, { recording: true, textAi: true });

    const row = await consentRow(creation.beneficiaryId);
    expect(row).not.toBeNull();
    expect(row?.support_case_id).toBe(creation.supportCaseId);
    expect(row?.recorded_by).toBe(counselor.userId);
    expect(row?.consent_recording_at).not.toBeNull();
    expect(row?.consent_text_ai_at).not.toBeNull();
    expect(row?.consent_recording_at).toBe(row?.recorded_at);
    expect(row?.consent_text_ai_at).toBe(row?.recorded_at);

    // 파이프라인 게이트(support_cases.consent_*_at, D15)가 동의 시각과 일치한다.
    const supportCase = await t.db.prepare(
      'SELECT consent_recording_at, consent_text_ai_at FROM support_cases WHERE id = ?',
    ).bind(creation.supportCaseId).first<Record<string, unknown>>();
    expect(supportCase?.consent_recording_at).toBe(row?.consent_recording_at);
    expect(supportCase?.consent_text_ai_at).toBe(row?.consent_text_ai_at);

    // 감사: record_consent 가 당사자·참여사업 출처와 함께 남는다.
    const audit = await t.db.prepare(
      "SELECT * FROM audit_log WHERE action = 'record_consent' AND beneficiary_id = ?",
    ).bind(creation.beneficiaryId).first<Record<string, unknown>>();
    expect(audit).not.toBeNull();
    expect(audit?.support_case_id).toBe(creation.supportCaseId);
    expect(audit?.target_table).toBe('participant_consent_records');
  });

  it('allows registration with no consent (D15 미동의 경로) and stores NULL item times', async () => {
    await t.reset();
    const creation = await register(counselor, { recording: false, textAi: false });

    const row = await consentRow(creation.beneficiaryId);
    expect(row).not.toBeNull();
    expect(row?.consent_recording_at).toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
    expect(row?.recorded_by).toBe(counselor.userId);

    const supportCase = await t.db.prepare(
      'SELECT consent_recording_at, consent_text_ai_at FROM support_cases WHERE id = ?',
    ).bind(creation.supportCaseId).first<Record<string, unknown>>();
    expect(supportCase?.consent_recording_at).toBeNull();
    expect(supportCase?.consent_text_ai_at).toBeNull();
  });

  it('supports per-item consent split (recording only)', async () => {
    await t.reset();
    const creation = await register(counselor, { recording: true, textAi: false });
    const row = await consentRow(creation.beneficiaryId);
    expect(row?.consent_recording_at).not.toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
  });

  it('keeps the participant completion guard intact (exactly 3 provenance audits)', async () => {
    await t.reset();
    // 동의 기록(+record_consent 감사)이 배치에 추가돼도 beneficiaries_complete_guard 를
    // 깨지 않는지 — 완료 전환 시점의 당사자 감사 3건 불변식이 유지되는지 확인한다.
    const creation = await register(counselor, { recording: true, textAi: true });
    const beneficiary = await t.db.prepare(
      'SELECT initialization_state FROM beneficiaries WHERE id = ?',
    ).bind(creation.beneficiaryId).first<{ initialization_state: string }>();
    expect(beneficiary?.initialization_state).toBe('complete');

    const provenance = await t.db.prepare(
      "SELECT action FROM audit_log WHERE beneficiary_id = ? AND action IN ('create', 'assign') ORDER BY id",
    ).bind(creation.beneficiaryId).all<{ action: string }>();
    expect(provenance.results.map((r) => r.action)).toEqual(['create', 'create', 'assign']);
  });

  it('is append-only: consent records reject UPDATE and DELETE (D23)', async () => {
    await t.reset();
    const creation = await register(admin, { recording: true, textAi: true });
    const row = await consentRow(creation.beneficiaryId);
    const id = row?.id as string;

    await expect(t.db.prepare(
      'UPDATE participant_consent_records SET recorded_by = ? WHERE id = ?',
    ).bind('someone@example.invalid', id).run()).rejects.toThrow('append-only');
    await expect(t.db.prepare(
      'DELETE FROM participant_consent_records WHERE id = ?',
    ).bind(id).run()).rejects.toThrow('append-only');
  });

  it('leaves no consent record on the legacy compatibility path (consent undefined)', async () => {
    await t.reset();
    const creation = await register(counselor);
    const row = await consentRow(creation.beneficiaryId);
    expect(row).toBeNull();
  });
});

describe('POST /participants consent contract (티켓 #19)', () => {
  function register(body: Record<string, unknown>): Promise<Response> {
    return worker.fetch(new Request('http://localhost/participants', {
      method: 'POST',
      headers: headersFor(counselor),
      body: JSON.stringify(body),
    }), t.env);
  }

  it('records the split consent from the registration payload', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다.
      consentPrivacy: true,
      consentRecording: true,
      consentTextAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { beneficiaryId: string; supportCaseId: string };

    const row = await consentRow(created.beneficiaryId);
    expect(row?.consent_recording_at).not.toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
    expect(row?.recorded_by).toBe(counselor.userId);
  });

  it('records a decline when the form submits both flags false (D15 미동의 경로)', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
      // ②·③ 미동의 경로는 G1 이후에도 불변이다 — 막히는 것은 ① 뿐이다.
      consentPrivacy: true,
      consentRecording: false,
      consentTextAi: false,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { beneficiaryId: string };
    const row = await consentRow(created.beneficiaryId);
    expect(row).not.toBeNull();
    expect(row?.consent_recording_at).toBeNull();
    expect(row?.consent_text_ai_at).toBeNull();
  });

  // G1(2026-07-29)이 이 자리의 계약을 뒤집었다: 동의 키를 생략한 HTTP 등록은 "동의 기록 없이
  // 등록"이 아니라 **거부**다. 하위 호환으로 게이트를 건너뛰는 구멍을 두지 않는다.
  it('rejects a payload that omits the privacy consent (G1 하드 게이트)', async () => {
    await t.reset();
    const response = await register({ programType: 'financial_support_v1', intakeAt: INTAKE_AT });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'privacy_consent_required' });
    const created = await t.db.prepare('SELECT COUNT(*) AS count FROM beneficiaries').first<{ count: number }>();
    expect(created?.count).toBe(0);
  });

  it('rejects a non-boolean consent flag', async () => {
    await t.reset();
    const response = await register({
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
      consentRecording: 'yes',
    });
    expect(response.status).toBe(400);
  });
});

describe('동의 3종 — 등록 저장 · 설정 수정 · 인테이크 읽기 (D44)', () => {
  async function supportCaseConsent(supportCaseId: string) {
    return t.db.prepare(
      `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at
       FROM support_cases WHERE id = ?`,
    ).bind(supportCaseId).first<Record<string, unknown>>();
  }

  it('stores all three consents at registration', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: false });

    const row = await consentRow(creation.beneficiaryId);
    expect(row?.consent_privacy_at).toBe(row?.recorded_at);
    expect(row?.consent_recording_at).toBe(row?.recorded_at);
    expect(row?.consent_text_ai_at).toBeNull();

    // 현재값(support_cases)도 같은 층에서 함께 남는다 — 이력만 남기면 화면이 못 읽는다.
    const current = await supportCaseConsent(creation.supportCaseId);
    expect(current?.consent_privacy_at).toBe(row?.consent_privacy_at);
    expect(current?.consent_recording_at).toBe(row?.consent_recording_at);
    expect(current?.consent_text_ai_at).toBeNull();
  });

  // G1 이 이 자리의 계약을 대체했다: ① 를 비운 채로는 등록이 성립하지 않는다.
  // 게이트 전체(긴급 예외 포함)는 consent-privacy-gate.test.ts 가 고정한다.
  it('refuses to register without the privacy consent (G1)', async () => {
    await t.reset();
    await expect(register(counselor, { privacy: false, recording: true, textAi: true }))
      .rejects.toThrow('privacy_consent_required');
  });

  it('updates and revokes from the participant settings page, appending history + audit', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: true });

    // 철회: 개인정보만 남기고 둘을 해제한다.
    const updated = await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: true,
      recording: false,
      textAi: false,
    });
    expect(updated).toMatchObject({ privacy: true, recording: false, textAi: false });

    const current = await supportCaseConsent(creation.supportCaseId);
    expect(current?.consent_privacy_at).not.toBeNull();
    expect(current?.consent_recording_at).toBeNull();
    expect(current?.consent_text_ai_at).toBeNull();

    // 이력은 UPDATE 로 지워지지 않는다 — 등록 1건 + 수정 1건 = 2행(append-only, D23).
    const history = await t.db.prepare(
      `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at
       FROM participant_consent_records WHERE beneficiary_id = ? ORDER BY recorded_at, id`,
    ).bind(creation.beneficiaryId).all<Record<string, unknown>>();
    // 순서가 아니라 집합으로 본다 — 두 기록이 같은 밀리초에 떨어져도 흔들리지 않는다.
    expect(history.results).toHaveLength(2);
    expect(history.results.filter((row) => row.consent_recording_at !== null)).toHaveLength(1);
    expect(history.results.filter((row) => row.consent_recording_at === null)).toHaveLength(1);

    // 감사(D14): 변경 전건이 record_consent 로 남는다 — 등록 1건 + 수정 1건.
    const audits = await t.db.prepare(
      `SELECT detail FROM audit_log WHERE action = 'record_consent' AND beneficiary_id = ?`,
    ).bind(creation.beneficiaryId).all<{ detail: string }>();
    expect(audits.results).toHaveLength(2);
    const details = audits.results.map((row) => JSON.parse(row.detail) as Record<string, unknown>);
    expect(details).toContainEqual(expect.objectContaining({
      privacy: true,
      recording: false,
      textAi: false,
      kind: 'update',
    }));
  });

  it('re-grants a revoked consent (the settings page is the only edit surface)', async () => {
    await t.reset();
    // ① 이 비어 있는 케이스는 이제 긴급 등록으로만 생긴다(G1). 그 상태에서 보완하는 흐름이다.
    const creation = await register(counselor, {
      privacy: false, recording: false, textAi: false, emergency: { reason: '위기 개입' },
    });
    await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: true, recording: true, textAi: true,
    });
    const current = await supportCaseConsent(creation.supportCaseId);
    expect(current?.consent_privacy_at).not.toBeNull();
    expect(current?.consent_recording_at).not.toBeNull();
    expect(current?.consent_text_ai_at).not.toBeNull();
  });

  it('shows the stored values on the read-only intake first step', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: false, textAi: true });
    const context = await getIntakeRecordContext(t.env, counselor, creation.supportCaseId);
    expect(context.consent).toEqual({ privacy: true, recording: false, textAi: true });

    // 철회가 화면에 반영된다 — 이력에서 "동의한 행"만 고르면 철회가 영영 보이지 않았다.
    await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: false, recording: false, textAi: false,
    });
    const after = await getIntakeRecordContext(t.env, counselor, creation.supportCaseId);
    expect(after.consent).toEqual({ privacy: false, recording: false, textAi: false });
  });

  it('rejects an edit by a counselor who is not assigned to the case', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: true });
    await expect(updateParticipantConsent(t.env, unassignedCounselor, creation.supportCaseId, {
      privacy: false, recording: false, textAi: false,
    })).rejects.toBeInstanceOf(ForbiddenError);

    // 거부된 시도는 값을 바꾸지 않는다.
    const current = await supportCaseConsent(creation.supportCaseId);
    expect(current?.consent_privacy_at).not.toBeNull();
  });

  it('lets an org admin edit consent (등록과 같은 권한 층)', async () => {
    await t.reset();
    const creation = await register(counselor, {
      privacy: false, recording: false, textAi: false, emergency: { reason: '위기 개입' },
    });
    const updated = await updateParticipantConsent(t.env, admin, creation.supportCaseId, {
      privacy: true, recording: false, textAi: false,
    });
    expect(updated.privacy).toBe(true);
  });

  it('rejects a non-boolean consent value', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: true });
    await expect(updateParticipantConsent(
      t.env,
      counselor,
      creation.supportCaseId,
      { privacy: 'yes', recording: false, textAi: false } as unknown as {
        privacy: boolean; recording: boolean; textAi: boolean;
      },
    )).rejects.toThrow();
  });
});

describe('PUT /support-cases/:id/consent (D44)', () => {
  it('updates consent over the route and refuses an unassigned counselor', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: INTAKE_AT },
      undefined,
      { privacy: false, recording: false, textAi: false, emergency: { reason: '위기 개입' } },
    );

    const ok = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent`,
      {
        method: 'PUT',
        headers: headersFor(counselor),
        body: JSON.stringify({ privacy: true, recording: true, textAi: false }),
      },
    ), t.env);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ privacy: true, recording: true, textAi: false });

    const denied = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent`,
      {
        method: 'PUT',
        headers: headersFor(unassignedCounselor),
        body: JSON.stringify({ privacy: false, recording: false, textAi: false }),
      },
    ), t.env);
    expect(denied.status).toBe(403);
  });

  it('keeps a recorded timestamp after a full revocation (기록 시각이지 동의 시각이 아니다)', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: true });
    await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: false, recording: false, textAi: false,
    });

    const response = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      { headers: headersFor(counselor) },
    ), t.env);
    expect(response.status).toBe(200);
    const programs = await response.json() as Array<{
      consent: { privacy: boolean; recording: boolean; textAi: boolean };
      consentRecordedAt: string | null;
    }>;
    expect(programs[0]?.consent).toEqual({ privacy: false, recording: false, textAi: false });
    // 동의 시각에서 역산했다면 여기가 null 이 된다 — 방금 남긴 철회 기록이 사라져 보인다.
    expect(programs[0]?.consentRecordedAt).not.toBeNull();
  });

  it('rejects a partial payload — the three values always travel together', async () => {
    await t.reset();
    const creation = await register(counselor, { privacy: true, recording: true, textAi: true });
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/consent`,
      { method: 'PUT', headers: headersFor(counselor), body: JSON.stringify({ privacy: false }) },
    ), t.env);
    expect(response.status).toBe(400);
  });
});

describe('participant_consent_records schema guards', () => {
  const CREATED_AT = '2026-07-16 09:00:00';

  it('rejects a recorder who is not an active human user', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
    });
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, recorded_by, recorded_at, created_at
       ) VALUES ('c-ghost', ?, ?, ?, 'ghost@example.invalid', ?, ?)`,
    ).bind(counselor.orgId, creation.beneficiaryId, creation.supportCaseId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('rejects a support case that does not belong to the beneficiary', async () => {
    await t.reset();
    const first = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
    });
    const second = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
    });
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, recorded_by, recorded_at, created_at
       ) VALUES ('c-mismatch', ?, ?, ?, ?, ?, ?)`,
    ).bind(counselor.orgId, first.beneficiaryId, second.supportCaseId, counselor.userId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('rejects an item consent time that differs from recorded_at', async () => {
    await t.reset();
    const creation = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: INTAKE_AT,
    });
    await expect(t.db.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, consent_recording_at, recorded_by, recorded_at, created_at
       ) VALUES ('c-skew', ?, ?, ?, '2020-01-01 00:00:00', ?, ?, ?)`,
    ).bind(counselor.orgId, creation.beneficiaryId, creation.supportCaseId, counselor.userId, CREATED_AT, CREATED_AT).run())
      .rejects.toThrow('participant_schema_violation');
  });
});
