import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, type ParticipantConsentInput } from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

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

async function register(actor: typeof counselor | typeof admin, consent?: ParticipantConsentInput) {
  const input = actor.role === 'admin'
    ? { programType: 'financial_support_v1' as const, intakeAt: INTAKE_AT, initialAssigneeUserId: actor.userId }
    : { programType: 'financial_support_v1' as const, intakeAt: INTAKE_AT };
  return createBeneficiaryWithInitialSupportCase(t.env, actor, input, undefined, consent);
}

async function consentRow(beneficiaryId: string) {
  return t.db.prepare(
    'SELECT * FROM participant_consent_records WHERE beneficiary_id = ?',
  ).bind(beneficiaryId).first<Record<string, unknown>>();
}

describe('참여자 등록 동의 기록 (D15 · D23 · 티켓 #19)', () => {
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

    // 감사: record_consent 가 참여자·참여사업 출처와 함께 남는다.
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
    // 깨지 않는지 — 완료 전환 시점의 참여자 감사 3건 불변식이 유지되는지 확인한다.
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

  it('records no consent when the payload omits both flags (legacy/programmatic caller)', async () => {
    await t.reset();
    const response = await register({ programType: 'financial_support_v1', intakeAt: INTAKE_AT });
    expect(response.status).toBe(201);
    const created = await response.json() as { beneficiaryId: string };
    expect(await consentRow(created.beneficiaryId)).toBeNull();
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
