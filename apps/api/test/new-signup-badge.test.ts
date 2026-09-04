import { describe, expect, it } from 'vitest';
import {
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createIntakeRecord,
  countNewSignups,
  listAssignedParticipants,
  listNewSignupBeneficiaryIds,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

// CCC-26 새 가입 배지 — 게이트웨이 파생 값의 단위 테스트.
// 새 알림 테이블 없이 케이스 상태에서 파생한다(티켓 본문):
//   개설(intake 전)이고 '새로 들어온' 케이스(legacy_import 제외) + 아직
//   인테이크 일정이 없고 + 담당 실무자가 케이스를 읽은(허브 열람) 감사가 없다.
// 소멸 3종: 인테이크 일정 등록 · 허브 열람 · 인테이크 완료.

const { counselor, unassignedCounselor, admin } = testActors;

const t = setupD1();

describe('new signup badge derivation (CCC-26)', () => {
  it('새로 개설된 인테이크 전 케이스는 새 가입으로 보인다', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    const newSignups = await listNewSignupBeneficiaryIds(t.env, counselor);
    expect(newSignups.has(created.beneficiaryId)).toBe(true);
    expect(await countNewSignups(t.env, counselor)).toBe(1);

    const participants = await listAssignedParticipants(t.env, counselor);
    expect(participants.find((entry) => entry.beneficiaryId === created.beneficiaryId)?.newSignup).toBe(true);
  });

  it('인테이크 일정을 등록하면 새 가입 배지가 소멸한다', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      scheduledAt: '2026-08-24T09:00:00.000Z',
    });

    const newSignups = await listNewSignupBeneficiaryIds(t.env, counselor);
    expect(newSignups.has(created.beneficiaryId)).toBe(false);
  });

  it('허브 열람(케이스 읽기 감사) 후에는 새 가입 배지가 소멸한다', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    // 허브 페이지가 남기는 것과 같은 모양의 읽기 감사(D14) — 행위자·케이스가 같고
    // 케이스 생성 이후로 찍힌다. created_at 을 밀리초 단위로 밀어 순서를 보장한다.
    await t.db.prepare(
      `INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at)
       VALUES (?, ?, 'counselor', 'read', 'support_cases', ?, ?, NULL, datetime('now', '+1 minute'))`,
    ).bind(counselor.orgId, counselor.userId, created.supportCaseId, created.supportCaseId).run();

    const newSignups = await listNewSignupBeneficiaryIds(t.env, counselor);
    expect(newSignups.has(created.beneficiaryId)).toBe(false);
  });

  it('인테이크가 완료되면 새 가입 배지가 소멸한다', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-08-20T09:00:00.000Z',
    });
    await createIntakeRecord(t.env, counselor, created.supportCaseId, {
      submissionId: '01000000-0000-4000-8000-00000000cd01',
      heldAt: '2026-08-20T10:00:00.000Z',
      channel: 'in_person',
      consent: { privacy: true, recordingAi: true },
    });

    const newSignups = await listNewSignupBeneficiaryIds(t.env, counselor);
    expect(newSignups.has(created.beneficiaryId)).toBe(false);
  });

  it('담당이 아닌 실무자의 목록에는 새 가입으로 세지 않는다 (D7)', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    const newSignups = await listNewSignupBeneficiaryIds(t.env, unassignedCounselor);
    expect(newSignups.has(created.beneficiaryId)).toBe(false);
    expect(await countNewSignups(t.env, unassignedCounselor)).toBe(0);
  });

  it('기관 관리자 범위에서는 기관 전체를 센다', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    const newSignups = await listNewSignupBeneficiaryIds(t.env, admin);
    expect(newSignups.has(created.beneficiaryId)).toBe(true);
    expect(await countNewSignups(t.env, admin)).toBe(1);
  });
});