import { beforeEach, describe, expect, it } from 'vitest';
import type { SupportCaseReport } from '@ccc/contracts/report';
import {
  activateAiProviderConfiguration,
  approveGeneratedAiDraft,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createGeneratedAiDraft,
  enqueueTextWorkItem,
  getActiveAiProviderRuntimeMetadataForService,
  listOpenActionItems,
  loadMaskedSourceSnapshotForService,
  registerAiProviderConfiguration,
  setSupportCaseOverallGoal,
  updateParticipantPii,
  getManualRecordContext,
  createCounselingSchedule,
  type Actor,
} from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { agentManifestEnv, runAgentTextJobs, seedCanonicalSttConsent } from './support/agent-jobs';
import {
  seedTestProgramWithRuntimeModes,
  setupD1,
  testActors,
  testProgramId,
} from './support/d1';
import { registrationInput } from './support/registration';
import { seedLegacyIntake } from './support/intake';
import { seedLegacyManualRecord } from './support/manual-record';
import { intakeInput, intakeQuestionnaire, newIntakeQuestionRefs } from './support/intake';
import { createIntakeRecord, updateIntakeRecord, getIntakeRecordContext } from '@ccc/core/gateway';

function withLegacyIntakeVersions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withLegacyIntakeVersions);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withLegacyIntakeVersions(child)]));
  if (result.kind === 'intake' || (typeof result.source === 'string' && (result.source.startsWith('intake_details.') || result.source.startsWith('session_life_area_snapshots.')) && result.sessionNumber === 1)) {
    result.intakeSchemaVersion = 1;
    result.intakeRevision = 1;
  }
  return result;
}

const t = setupD1();
const { admin, counselor, otherOrgAdmin, service, unassignedCounselor } = testActors;

beforeEach(async () => {
  await t.reset();
});

function http(actor: Actor, path: string): Promise<Response> {
  return handleRequest(new Request(`http://localhost${path}`), t.env, async () => actor);
}

async function seedCase() {
  return createBeneficiaryWithInitialSupportCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
}

async function report(actor: Actor, supportCaseId: string): Promise<SupportCaseReport> {
  const response = await http(actor, `/support-cases/${supportCaseId}/report`);
  expect(response.status).toBe(200);
  return response.json() as Promise<SupportCaseReport>;
}

async function createDraft(sessionId: string, oneLiner: string) {
  Object.assign(t.env, await agentManifestEnv(t.env, { mode: 'community-cloud', stt: 'off' }));
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  expect(await runAgentTextJobs(t.env, t.db)).toBe(1);
  const completed = await t.db.prepare(
    'SELECT completed_snapshot_id AS id FROM ai_text_work_queue WHERE session_id = ?',
  ).bind(sessionId).first<{ id: string }>();
  if (completed === null) throw new Error('missing completed report snapshot');
  const snapshot = await loadMaskedSourceSnapshotForService(t.env, service, sessionId, completed.id);
  const evidenceItem = snapshot.evidence[0];
  if (evidenceItem === undefined) throw new Error('missing report evidence');
  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, sessionId);
  const evidenceLink = {
    sourceEvidenceItemId: evidenceItem.id,
    evidenceQuote: evidenceItem.evidenceQuote,
    sourceRef: evidenceItem.sourceRef,
    sourceStart: evidenceItem.sourceStart,
    sourceEnd: evidenceItem.sourceEnd,
  };
  return createGeneratedAiDraft(t.env, service, sessionId, {
    summaryText: 'DRAFT_SUMMARY_CANARY',
    claims: [{ claimKey: 'report-claim', section: 'other_topics', text: 'DRAFT_SUMMARY_CANARY' }],
    flagSuggestions: [],
    oneLiner,
    questions: [
      { title: '합성 확인 질문 1', reason: '합성 확인 사유 1' },
      { title: '합성 확인 질문 2', reason: '합성 확인 사유 2' },
    ],
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHash: snapshot.sha256,
    materials: [{ kind: 'text_context', snapshotId: snapshot.id, snapshotSha256: snapshot.sha256 }],
    contrast: [
      { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
      { axis: 'missing_from_transcript', status: 'no_transcript', findings: [] },
      { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
    ],
    providerConfigId: selection.providerConfigId,
    consentEvidenceId: selection.consentEvidenceId,
    consentRevision: selection.consentRevision,
    consentReceipt: selection.consentReceipt,
    modelId: 'gpt-5-codex',
    promptVersion: 'report-contract-v1',
    schemaVersion: 'schema-v1',
    evidence: [
      { ...evidenceLink, claimKey: 'report-claim' },
      { ...evidenceLink, claimKey: 'question_1' },
      { ...evidenceLink, claimKey: 'question_2' },
    ],
  });
}

describe('GET /support-cases/:id/report', () => {
  it('projects stored changes, urgency and session-local opinion with complete open-question references', async () => {
    const created = await seedCase();
    const schedule = await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
      scheduledAt: '2026-09-01T09:00:00.000Z', customQuestions: ['COMPLETED_SCHEDULE_QUESTION'],
    });
    const first = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
      schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z',
      channel: 'visit', reason: 'walk_in', urgency: 'caution', memo: 'SOURCE_MANUAL_MEMO',
      changes: [{ area: 'housing', text: 'RECORDED_HOUSING_CHANGE' }],
      counselorOpinion: 'OPINION_ONLY_IN_SOURCE_SESSION', nextQuestions: ['SAME_QUESTION', 'SAME_QUESTION'],
      actionItems: [{ description: 'STAFF_ACTION', owner: 'counselor', dueDate: '2026-09-20' }],
      scheduleId: schedule.id, expectedScheduleVersion: schedule.version,
    });
    const initial = await getManualRecordContext(t.env, counselor, created.supportCaseId);
    const [question, omitted] = initial.questions.filter(item => item.kind === 'record');
    const scheduled = initial.questions.find(item => item.kind === 'schedule')!;
    const action = initial.actions[0]!;
    await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
      scheduledAt: '2099-01-01T09:00:00.000Z', customQuestions: ['FUTURE_WITHOUT_SESSION'],
    });
    const second = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
      schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-02T09:00:00.000Z',
      channel: 'phone', memo: 'ANSWER_SESSION',
      questionAnswers: [{ kind: 'record', questionId: question!.id, sourceId: first.record.id, expectedRevision: 1, answer: 'HUMAN_CONFIRMED_ANSWER' }],
      actionOutcomes: [{ actionItemId: action.id, expectedRevision: 1, outcome: 'not_done', continuation: 'stop', reason: 'HUMAN_STOP_REASON' }],
    });
    const body = await report(counselor, created.supportCaseId);
    expect(body.schemaVersion).toBe(2);
    expect(body.sessions.find(session => session.sessionId === first.record.id)).toMatchObject({
      channel: 'visit', counselorOpinion: { sessionId: first.record.id,
        source: 'record_details.counselorOpinion', text: 'OPINION_ONLY_IN_SOURCE_SESSION' },
    });
    expect(body.sessions.find(session => session.sessionId === second.record.id)).not.toHaveProperty('counselorOpinion');
    expect(body.nextConfirmations).toHaveLength(2);
    expect(body.nextConfirmations).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: 'SAME_QUESTION',
        questionRef: { kind: 'record', questionId: omitted!.id, sourceId: first.record.id, sourceRevision: 1 } }),
      expect.objectContaining({ item: 'COMPLETED_SCHEDULE_QUESTION',
        questionRef: { kind: 'schedule', questionId: scheduled.id, sourceId: schedule.id, sourceRevision: 1 },
        evidence: expect.objectContaining({ sessionId: first.record.id }) }),
    ]));
    expect(JSON.stringify(body.sections)).not.toContain('OPINION_ONLY_IN_SOURCE_SESSION');
    expect(JSON.stringify(body)).not.toContain('FUTURE_WITHOUT_SESSION');
    expect(JSON.stringify(body)).not.toContain('STAFF_ACTION');
    expect(body.sections.situationChanges?.entries).toContainEqual(expect.objectContaining({
      sessionId: first.record.id, source: 'record_details.changes.0.text', area: 'housing', text: 'RECORDED_HOUSING_CHANGE',
    }));
    expect(body.sections.riskSignals?.entries).toEqual([expect.objectContaining({
      sessionId: first.record.id, source: 'record_details.urgency', text: 'caution',
    })]);
  });

  it('rejects an incomplete bound question identity instead of silently dropping its reference', async () => {
    const target = await seedCase();
    const record = await seedLegacyManualRecord(t.env, counselor, target.supportCaseId, {
      heldAt: '2026-09-01T09:00:00.000Z', channel: 'in_person', memo: 'BOUND_QUESTION_SOURCE',
    });
    await t.db.prepare('UPDATE sessions SET manual_schema_version = 2, record_details = ? WHERE id = ?')
      .bind(JSON.stringify({ schemaVersion: 2, method: 'in_person', reason: null, urgency: null,
        changes: [], counselorOpinion: null, nextQuestions: [{ id: '', body: 'BOUND_QUESTION' }] }), record.record.id).run();
    const response = await http(counselor, `/support-cases/${target.supportCaseId}/report`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'conflict' });
  });

  it('returns chronological sourced evidence for all five sections without replacing the first intake plan', async () => {
    const created = await seedCase();
    await updateParticipantPii(t.env, counselor, created.beneficiaryId, {
      supportCaseContextId: created.supportCaseId,
      expectedVersion: 1,
      name: 'REPORT_PII_NAME_CANARY',
      phone: '010-0000-9999',
      account: 'REPORT_PII_ACCOUNT_CANARY',
    });
    const intake = await seedLegacyIntake(t.env, counselor, created.supportCaseId, {
      submissionId: '10000000-0000-4000-8000-000000000001',
      heldAt: '2026-07-01T09:00:00.000Z',
      channel: 'phone',
      answers: [
        { key: 'application_reason_detail', response: 'answered', text: '월세와 생계비 상담을 신청했습니다' },
        { key: 'need_primary', response: 'answered', text: '첫 인테이크 주거 안정 계획' },
        { key: 'summary_direction', response: 'answered', text: '후순위 지원 방향' },
        { key: 'housing_detail', response: 'answered', text: '임시 거처라 계약이 불안정합니다' },
        { key: 'summary_urgency', response: 'answered', text: '당일 안전 확인 필요' },
      ],
      actionItems: [
        { description: '당사자 임대차 서류 준비', owner: 'beneficiary', dueDate: '2026-07-10' },
        { description: '실무자 지원 제도 확인', owner: 'counselor' },
      ],
      debts: [{
        creditor: '합성은행',
        kind: '생활비 대출',
        balance: '300만원',
        monthlyPayment: '20만원',
        arrearsStatus: '1개월 연체',
      }],
      additionalItems: [{
        item: '임대차 계약서 원본 확인',
        reason: '주거 지원 자격 확인',
        method: '다음 상담 때 지참',
        dueNote: '다음 상담 전',
        dueDate: '2026-07-09',
        owner: '당사자',
      }],
      linkedOrgs: [{
        orgName: '합성 주민센터',
        serviceName: '긴급 주거 지원',
        supportDetail: '신청 서류 검토',
        usagePeriod: '2026년 7월',
        progressStatus: '접수 완료',
      }],
    });
    const openActions = await listOpenActionItems(t.env, counselor, created.supportCaseId);
    const beneficiaryAction = openActions.find((item) => item.description === '당사자 임대차 서류 준비');
    if (beneficiaryAction === undefined) throw new Error('missing beneficiary action fixture');

    const third = await seedLegacyManualRecord(t.env, counselor, created.supportCaseId, { submissionId: '10000000-0000-4000-8000-000000000003',
    heldAt: '2026-07-03T09:00:00.000Z',
    channel: 'video',
    memo: '셋째 회차 수기 요약',
    gasScores: [],
    actionItems: [{ description: '실무자 후속 전화', owner: 'counselor' }],
    flags: [{ flagType: 'housing_livelihood_shock', quote: '퇴거 통지를 받았다고 확인함' }],
    actionItemResolutions: [{
      actionItemId: beneficiaryAction.id,
      status: 'hold',
      note: '임대차 계약서 도착 대기',
    }],
    lifeAreas: [
      { areaKey: 'economy', status: 'strained', note: '이번 달 수입이 감소했습니다' },
    ],
    details: {
      sessionGoalNote: '주거 지원 신청 방향을 확인한다',
      changeSinceLast: '임대인에게 퇴거 통지를 받았습니다',
      safetyNote: '오늘 머물 곳은 확보했습니다',
    }, });
    const second = await createCounselingRecord(t.env, counselor, created.supportCaseId, { schemaVersion: 2, submissionId: '10000000-0000-4000-8000-000000000002',
    heldAt: '2026-07-02T09:00:00.000Z',
    channel: 'in_person',
    memo: '둘째 회차 수기 요약',
    gasScores: [],
    actionItems: [],
    flags: [], });
    await setSupportCaseOverallGoal(t.env, counselor, created.supportCaseId, 'MUTABLE_OVERALL_GOAL_CANARY');

    const flag = await t.db.prepare('SELECT id FROM flags WHERE session_id = ?')
      .bind(third.record.id).first<{ id: string }>();
    if (flag === null) throw new Error('missing confirmed flag fixture');

    const body = await report(counselor, created.supportCaseId);
    const intakeGoal = {
      sessionId: intake.record.id,
      sessionNumber: 1,
      heldAt: '2026-07-01T09:00:00.000Z',
      source: 'intake_details.answers.need_primary',
      text: '첫 인테이크 주거 안정 계획',
    };
    expect(body).toEqual(withLegacyIntakeVersions({
      schemaVersion: 2,
      supportCaseId: created.supportCaseId,
      beneficiaryId: created.beneficiaryId,
      programId: testProgramId(counselor.orgId),
      programName: '테스트 사업',
      status: 'active',
      sessions: [
        {
          sessionId: intake.record.id,
          sessionNumber: 1,
          heldAt: '2026-07-01T09:00:00.000Z',
          kind: 'intake',
          channel: 'phone',
          summary: {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.answers.application_reason_detail',
            text: '월세와 생계비 상담을 신청했습니다',
          },
        },
        {
          sessionId: second.record.id,
          sessionNumber: 2,
          heldAt: '2026-07-02T09:00:00.000Z',
          kind: 'regular',
          channel: 'in_person',
          summary: {
            sessionId: second.record.id,
            sessionNumber: 2,
            heldAt: '2026-07-02T09:00:00.000Z',
            source: 'sessions.memo',
            text: '둘째 회차 수기 요약',
          },
        },
        {
          sessionId: third.record.id,
          sessionNumber: 3,
          heldAt: '2026-07-03T09:00:00.000Z',
          kind: 'regular',
          channel: 'video',
          summary: {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'sessions.memo',
            text: '셋째 회차 수기 요약',
          },
        },
      ],
      firstIntakeGoal: intakeGoal,
      nextConfirmations: [{
        item: '임대차 계약서 원본 확인',
        reason: '주거 지원 자격 확인',
        method: '다음 상담 때 지참',
        dueNote: '다음 상담 전',
        dueDate: '2026-07-09',
        owner: '당사자',
        questionRef: null,
        evidence: {
          sessionId: intake.record.id,
          sessionNumber: 1,
          heldAt: '2026-07-01T09:00:00.000Z',
          source: 'intake_details.additionalItems.0.item',
          text: '임대차 계약서 원본 확인',
        },
      }],
      sections: {
        situationChanges: { entries: [
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.answers.housing_detail',
            text: '임시 거처라 계약이 불안정합니다',
          },
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.debts.0.creditor',
            text: '합성은행',
          },
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.debts.0.kind',
            text: '생활비 대출',
          },
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.debts.0.balance',
            text: '300만원',
          },
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.debts.0.monthlyPayment',
            text: '20만원',
          },
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.debts.0.arrearsStatus',
            text: '1개월 연체',
          },
          {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'record_details.changeSinceLast',
            text: '임대인에게 퇴거 통지를 받았습니다',
          },
          {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'session_life_area_snapshots.economy.status',
            text: 'strained',
          },
          {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'session_life_area_snapshots.economy.note',
            text: '이번 달 수입이 감소했습니다',
          },
        ] },
        goalChanges: {
          initialGoal: intakeGoal,
          directions: [{
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'sessionGoals.0',
            text: '주거 지원 신청 방향을 확인한다',
          }],
        },
        actionItems: { items: [{
          id: beneficiaryAction.id,
          description: '당사자 임대차 서류 준비',
          resolutionStatus: 'hold',
          resolvedAt: null,
          dueDate: '2026-07-10',
          evidence: {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: `action_items.${beneficiaryAction.id}.description`,
            text: '당사자 임대차 서류 준비',
          },
          resolution: {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: `action_items.${beneficiaryAction.id}.resolution_note`,
            text: '임대차 계약서 도착 대기',
          },
        }] },
        resourceConnections: { entries: [{
          orgName: '합성 주민센터',
          serviceName: '긴급 주거 지원',
          supportDetail: '신청 서류 검토',
          usagePeriod: '2026년 7월',
          progressStatus: '접수 완료',
          evidence: {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.linkedOrgs.0',
            text: '합성 주민센터',
          },
        }] },
        riskSignals: { entries: [
          {
            sessionId: intake.record.id,
            sessionNumber: 1,
            heldAt: '2026-07-01T09:00:00.000Z',
            source: 'intake_details.answers.summary_urgency',
            text: '당일 안전 확인 필요',
          },
          {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: 'record_details.safetyNote',
            text: '오늘 머물 곳은 확보했습니다',
          },
          {
            sessionId: third.record.id,
            sessionNumber: 3,
            heldAt: '2026-07-03T09:00:00.000Z',
            source: `flags.${flag.id}`,
            text: '퇴거 통지를 받았다고 확인함',
          },
        ] },
      },
    }));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('MUTABLE_OVERALL_GOAL_CANARY');
    expect(serialized).not.toContain('실무자 지원 제도 확인');
    expect(serialized).not.toContain('실무자 후속 전화');
    expect(serialized).not.toContain('REPORT_PII_NAME_CANARY');
    expect(serialized).not.toContain('REPORT_PII_ACCOUNT_CANARY');
  });

  it('keeps the nine-area intake meaning and omits retained but inapplicable responses from reports', async () => {
    const created = await seedCase();
    const input = await intakeInput(t.env, counselor, created.supportCaseId);
    input.questionnaire = intakeQuestionnaire(input.questionnaire.moduleSnapshot, [
      { key: 'difficulty_areas', response: 'answered', choices: ['physical_health', 'mental_health', 'family_relationships', 'care_parenting', 'legal_administrative'] },
      { key: 'need_primary', response: 'answered', text: 'care_parenting' },
      { key: 'summary_urgency', response: 'answered', text: '주의' },
      { key: 'physical_health_detail', response: 'answered', text: '신체 건강에 관한 수기 기록' },
      { key: 'mental_health_detail', response: 'answered', text: '심리와 정서에 관한 수기 기록' },
      { key: 'family_relationships_detail', response: 'answered', text: '가족 관계에 관한 수기 기록' },
      { key: 'care_parenting_detail', response: 'answered', text: '돌봄에 관한 수기 기록' },
      { key: 'legal_administrative_detail', response: 'answered', text: '행정 서류에 관한 수기 기록' },
      { key: 'employment_detail', response: 'answered', text: 'INAPPLICABLE_RETAINED_CANARY' },
    ]);
    const intake = await createIntakeRecord(t.env, counselor, created.supportCaseId, input);
    const body = await report(counselor, created.supportCaseId);
    expect(body.sessions).toMatchObject([{ sessionId: intake.record.id, intakeSchemaVersion: 2, intakeRevision: 1 }]);
    expect(body.firstIntakeGoal).toMatchObject({ text: '돌봄·양육', intakeSchemaVersion: 2, intakeRevision: 1 });
    const serialized = JSON.stringify(body);
    for (const text of ['신체 건강에 관한 수기 기록', '심리와 정서에 관한 수기 기록', '가족 관계에 관한 수기 기록', '돌봄에 관한 수기 기록', '행정 서류에 관한 수기 기록']) expect(serialized).toContain(text);
    expect(serialized).not.toContain('INAPPLICABLE_RETAINED_CANARY');
    expect(body.sections.riskSignals?.entries).toContainEqual(expect.objectContaining({ text: '주의', intakeSchemaVersion: 2, intakeRevision: 1 }));
  });

  it('reports only open intake identities with their immutable evidence revision after omission and later answers', async () => {
    const created = await seedCase(), caseId = created.supportCaseId;
    const input = await intakeInput(t.env, counselor, caseId);
    input.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '확인할 첫 질문' }, { item: '남겨 둔 질문', dueNote: '원래 기한' }] };
    input.additionalItemRefs = newIntakeQuestionRefs(input.questionnaire);
    const intake = await createIntakeRecord(t.env, counselor, caseId, input);
    const saved = (await getIntakeRecordContext(t.env, counselor, caseId)).saved!;
    const a = saved.questionLifecycle!.items.find(item => item.sourceRowIndex === 0)!;
    const b = saved.questionLifecycle!.items.find(item => item.sourceRowIndex === 1)!;
    await updateIntakeRecord(t.env, counselor, caseId, {
      schemaVersion: 3, expectedRevision: 1, heldAt: '2026-09-02T09:00:00.000Z', channel: input.channel,
      questionnaire: { ...input.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '수정한 첫 질문' }] } },
      additionalItemRefs: [{ rowIndex: 0, questionId: a.id, expectedRevision: 1 }], questionWithdrawals: [],
    });
    const current = await report(counselor, caseId);
    expect(current.nextConfirmations).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: '수정한 첫 질문', questionRef: { kind: 'intake', questionId: a.id, sourceId: intake.record.id, sourceRevision: 2 },
        evidence: expect.objectContaining({ intakeRevision: 2, source: 'intake_details.additionalItems.0.item' }) }),
      expect.objectContaining({ item: '남겨 둔 질문', dueNote: '원래 기한',
        questionRef: { kind: 'intake', questionId: b.id, sourceId: intake.record.id, sourceRevision: 1 }, evidence: expect.objectContaining({
        sessionId: intake.record.id, heldAt: input.heldAt, intakeSchemaVersion: 2, intakeRevision: 1, source: 'intake_details.additionalItems.1.item',
      }) }),
    ]));
    await createCounselingRecord(t.env, counselor, caseId, { schemaVersion: 2, submissionId: crypto.randomUUID(),
      heldAt: '2026-09-03T09:00:00.000Z', channel: 'in_person', memo: '수기로 확인',
      questionAnswers: [{ kind: 'intake', questionId: b.id, sourceId: intake.record.id, expectedRevision: 1, answer: '확인한 답' }],
    });
    expect((await report(counselor, caseId)).nextConfirmations?.map(item => item.item)).toEqual(['수정한 첫 질문']);
    await updateIntakeRecord(t.env, counselor, caseId, {
      schemaVersion: 3, expectedRevision: 2, heldAt: '2026-09-02T09:00:00.000Z', channel: input.channel,
      questionnaire: { ...input.questionnaire, additionalItems: { response: 'unknown' } }, additionalItemRefs: [],
      questionWithdrawals: [{ questionId: a.id, expectedRevision: 2 }, { questionId: b.id, expectedRevision: 1 }],
    });
    const withdrawn = await report(counselor, caseId);
    expect(withdrawn.nextConfirmations).toBeUndefined();
  });

  it('keeps an evidence-free intake session while omitting every fabricated section and summary', async () => {
    const created = await seedCase();
    const intake = await seedLegacyIntake(t.env, counselor, created.supportCaseId, {
      submissionId: '20000000-0000-4000-8000-000000000001',
      heldAt: '2026-07-05T09:00:00.000Z',
      channel: 'in_person',
      debts: [{ creditor: '해당 없음' }],
      linkedOrgs: [{ orgName: '해당 없음' }],
    });

    const body = await report(counselor, created.supportCaseId);
    expect(body.sessions).toEqual([{
      sessionId: intake.record.id,
      sessionNumber: 1,
      heldAt: '2026-07-05T09:00:00.000Z',
      kind: 'intake',
      channel: 'in_person',
      intakeSchemaVersion: 1,
      intakeRevision: 1,
    }]);
    expect(body).not.toHaveProperty('firstIntakeGoal');
    expect(body).not.toHaveProperty('nextConfirmations');
    expect(body.sections).toEqual({});
  });

  it('excludes an unapproved AI draft and selects its approved one-liner only after approval', async () => {
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, {
      sttMode: 'off',
      llmMode: 'openai',
    });
    t.env.CCC_LLM_MODE = 'openai';
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    const created = await seedCase();
    await seedCanonicalSttConsent(t.env, counselor, created.supportCaseId);
    const session = await createCounselingRecord(t.env, counselor, created.supportCaseId, { schemaVersion: 2, submissionId: '30000000-0000-4000-8000-000000000001',
    heldAt: '2026-07-06T09:00:00.000Z',
    channel: 'in_person',
    memo: '승인 전에는 이 수기 요약만 보입니다',
    gasScores: [],
    actionItems: [],
    flags: [], });
    const config = await registerAiProviderConfiguration(t.env, admin, {
      adapterId: 'codex',
      adapterVersion: 'v1',
      configHash: 'b'.repeat(64),
      approvalRefs: ['privacy-security-approval'],
    });
    await activateAiProviderConfiguration(t.env, admin, config.id);
    const draft = await createDraft(session.record.id, '승인된 AI 한 줄');

    const beforeApproval = await report(counselor, created.supportCaseId);
    expect(beforeApproval.sessions[0]?.summary).toEqual({
      sessionId: session.record.id,
      sessionNumber: 1,
      heldAt: '2026-07-06T09:00:00.000Z',
      source: 'sessions.memo',
      text: '승인 전에는 이 수기 요약만 보입니다',
    });
    expect(JSON.stringify(beforeApproval)).not.toContain('DRAFT_SUMMARY_CANARY');
    expect(JSON.stringify(beforeApproval)).not.toContain('승인된 AI 한 줄');

    await approveGeneratedAiDraft(t.env, counselor, draft.workItemId, draft.version);
    const afterApproval = await report(counselor, created.supportCaseId);
    expect(afterApproval.sessions[0]?.summary).toEqual({
      sessionId: session.record.id,
      sessionNumber: 1,
      heldAt: '2026-07-06T09:00:00.000Z',
      source: 'approved_ai_briefing_v1.one_liner',
      text: '승인된 AI 한 줄',
    });
    expect(JSON.stringify(afterApproval)).not.toContain('DRAFT_SUMMARY_CANARY');
  });

  it('allows assigned and administrative reads, denies wider actors, rejects queries, and audits a no-store response', async () => {
    const created = await seedCase();
    expect((await http(counselor, `/support-cases/${created.supportCaseId}/report`)).status).toBe(200);

    for (const actor of [unassignedCounselor, otherOrgAdmin, service]) {
      expect((await http(actor, `/support-cases/${created.supportCaseId}/report`)).status).toBe(403);
    }
    expect((await http(counselor, `/support-cases/${created.supportCaseId}/report?include=drafts`)).status).toBe(400);

    const adminRead = await http(admin, `/support-cases/${created.supportCaseId}/report`);
    expect(adminRead.status).toBe(200);
    expect(adminRead.headers.get('cache-control')).toBe('no-store');
    const audit = await t.db.prepare(
      `SELECT actor_id, action, target_table, support_case_id
       FROM audit_log
       WHERE actor_id = ? AND action = 'read' AND target_table = 'sessions'
       ORDER BY id DESC LIMIT 1`,
    ).bind(admin.userId).first<{
      actor_id: string;
      action: string;
      target_table: string;
      support_case_id: string;
    }>();
    expect(audit).toEqual({
      actor_id: admin.userId,
      action: 'read',
      target_table: 'sessions',
      support_case_id: created.supportCaseId,
    });
  });
});
