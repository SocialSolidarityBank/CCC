import { describe, expect, it } from 'vitest';
import type { CreateManualRecordInput } from '@ccc/contracts/manual-record';
import { ValidationError, createBeneficiaryWithInitialSupportCase, createCounselingRecord, createGoal, listCounselingRecords } from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';

const t = setupD1();
const actor = testActors.counselor;
async function seedCase() {
  return createBeneficiaryWithInitialSupportCase(t.env, actor, await registrationInput(t.env, actor, { programId: testProgramId(actor.orgId) }));
}
function recordInput(overrides: Partial<CreateManualRecordInput> = {}): CreateManualRecordInput {
  return { schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-12T09:00:00.000Z', channel: 'in_person', memo: '오늘 상담 내용을 수기로 남긴다', ...overrides };
}

describe('versioned one-page manual record', () => {
  it('makes a memo immediately official without supplying optional assessments', async () => {
    await t.reset();
    const created = await seedCase();
    const saved = await createCounselingRecord(t.env, actor, created.supportCaseId, recordInput());
    const records = await listCounselingRecords(t.env, actor, created.supportCaseId);
    expect(records.find(record => record.id === saved.record.id)).toMatchObject({
      memo: '오늘 상담 내용을 수기로 남긴다', approvedAt: null, aiSummary: null,
      manual: { schemaVersion: 2, details: { urgency: null, changes: [], reason: null, counselorOpinion: null } },
    });
  });
  it('preserves explicit visit metadata and practitioner opinion without carrying them into another visit', async () => {
    await t.reset();
    const created = await seedCase();
    const first = await createCounselingRecord(t.env, actor, created.supportCaseId, recordInput({
      channel: 'visit', reason: 'walk_in', counselorOpinion: '주거 문제를 먼저 확인한다', urgency: 'caution',
      changes: [{ area: 'physical_health', text: '다음 주 진료 일정을 정했다' }],
    }));
    const second = await createCounselingRecord(t.env, actor, created.supportCaseId, recordInput({ heldAt: '2026-09-13T09:00:00.000Z' }));
    const records = await listCounselingRecords(t.env, actor, created.supportCaseId);
    expect(records.find(record => record.id === first.record.id)).toMatchObject({
      managerOpinion: '주거 문제를 먼저 확인한다', manual: { details: { method: 'visit', reason: 'walk_in', urgency: 'caution',
        changes: [{ area: 'physical_health', text: '다음 주 진료 일정을 정했다' }] } },
    });
    expect(records.find(record => record.id === second.record.id)).toMatchObject({
      managerOpinion: null, manual: { details: { urgency: null, changes: [], reason: null } },
    });
  });
  it('rejects retired write meanings and leaves the separately managed goal unchanged', async () => {
    await t.reset();
    const created = await seedCase();
    const goal = await createGoal(t.env, actor, created.supportCaseId, { title: '주거 안정' });
    for (const retired of [
      { details: { changeSinceLast: 'legacy value' } },
      { lifeAreas: [{ areaKey: 'health', changed: false }] },
      { actionItemResolutions: [{ actionItemId: goal.id, status: 'hold' }] },
      { goalTransition: { closeGoalId: goal.id, closedReason: '달성해서 종료' } },
    ]) {
      await expect(createCounselingRecord(t.env, actor, created.supportCaseId, { ...recordInput(), ...retired } as never))
        .rejects.toBeInstanceOf(ValidationError);
    }
    const storedGoal = await t.db.prepare('SELECT status FROM goals WHERE id = ?').bind(goal.id).first<{ status: string }>();
    expect(storedGoal?.status).toBe('active');
    expect(await listCounselingRecords(t.env, actor, created.supportCaseId)).toEqual([]);
  });
  it('replays one submitted opinion without creating another official record', async () => {
    await t.reset();
    const created = await seedCase();
    const input = recordInput({ counselorOpinion: '재시도 확인' });
    const first = await createCounselingRecord(t.env, actor, created.supportCaseId, input);
    const second = await createCounselingRecord(t.env, actor, created.supportCaseId, input);
    expect(second).toMatchObject({ replayed: true, record: { id: first.record.id } });
    expect((await listCounselingRecords(t.env, actor, created.supportCaseId)).map(record => record.id)).toEqual([first.record.id]);
  });
});
