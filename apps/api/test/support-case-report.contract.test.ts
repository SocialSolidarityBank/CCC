import { beforeEach, describe, expect, it } from 'vitest';
import type { SupportCaseReport } from '@ccc/contracts/report';
import {
  activateAiProviderConfiguration,
  approveGeneratedAiDraft,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createGeneratedAiDraft,
  createIntakeRecord,
  getActiveAiProviderRuntimeMetadataForService,
  listOpenActionItems,
  recordMaskedSourceSnapshot,
  registerAiProviderConfiguration,
  setSupportCaseOverallGoal,
  updateParticipantPii,
  type Actor,
} from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { seedCanonicalSttConsent, sha256Hex } from './support/agent-jobs';
import {
  seedTestProgramWithRuntimeModes,
  setupD1,
  testActors,
  testProgramId,
} from './support/d1';
import { registrationInput } from './support/registration';

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
  const maskedText = 'MASKED_REPORT_EVIDENCE';
  const hash = await sha256Hex(maskedText);
  const evidenceId = `report-evidence-${sessionId}`;
  const snapshot = await recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText,
    sha256: hash,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: [{
      id: evidenceId,
      sourceRef: 'memo:report-source',
      sourceSha256: hash,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: maskedText.length,
    }],
  });
  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, sessionId);
  const evidenceLink = {
    sourceEvidenceItemId: evidenceId,
    evidenceQuote: maskedText,
    sourceRef: 'memo:report-source',
    sourceStart: 0,
    sourceEnd: maskedText.length,
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
  it('returns chronological sourced evidence for all five sections without replacing the first intake plan', async () => {
    const created = await seedCase();
    await updateParticipantPii(t.env, counselor, created.beneficiaryId, {
      supportCaseContextId: created.supportCaseId,
      expectedVersion: 1,
      name: 'REPORT_PII_NAME_CANARY',
      phone: '010-0000-9999',
      account: 'REPORT_PII_ACCOUNT_CANARY',
    });
    const intake = await createIntakeRecord(t.env, counselor, created.supportCaseId, {
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

    const third = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
      submissionId: '10000000-0000-4000-8000-000000000003',
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
        { areaKey: 'economy', changed: true, status: 'strained', note: '이번 달 수입이 감소했습니다' },
        { areaKey: 'housing', changed: false },
        { areaKey: 'employment', changed: false },
        { areaKey: 'health', changed: false },
        { areaKey: 'mental_health', changed: false },
        { areaKey: 'family', changed: false },
      ],
      details: {
        sessionGoalNote: '주거 지원 신청 방향을 확인한다',
        changeSinceLast: '임대인에게 퇴거 통지를 받았습니다',
        safetyNote: '오늘 머물 곳은 확보했습니다',
      },
    });
    const second = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
      submissionId: '10000000-0000-4000-8000-000000000002',
      heldAt: '2026-07-02T09:00:00.000Z',
      channel: 'in_person',
      memo: '둘째 회차 수기 요약',
      gasScores: [],
      actionItems: [],
      flags: [],
    });
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
    expect(body).toEqual({
      schemaVersion: 1,
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
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('MUTABLE_OVERALL_GOAL_CANARY');
    expect(serialized).not.toContain('실무자 지원 제도 확인');
    expect(serialized).not.toContain('실무자 후속 전화');
    expect(serialized).not.toContain('REPORT_PII_NAME_CANARY');
    expect(serialized).not.toContain('REPORT_PII_ACCOUNT_CANARY');
  });

  it('keeps an evidence-free intake session while omitting every fabricated section and summary', async () => {
    const created = await seedCase();
    const intake = await createIntakeRecord(t.env, counselor, created.supportCaseId, {
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
    const session = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
      submissionId: '30000000-0000-4000-8000-000000000001',
      heldAt: '2026-07-06T09:00:00.000Z',
      channel: 'in_person',
      memo: '승인 전에는 이 수기 요약만 보입니다',
      gasScores: [],
      actionItems: [],
      flags: [],
    });
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
