import { describe, expect, it } from 'vitest';
import { installation, json } from './test-support';
import { BusinessTransport } from './transport';
import { RecordsApi } from './records';
import { BusinessError } from './errors';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
// @ts-expect-error The executable synthetic server is JavaScript without declarations.
import { createSyntheticState, handleApi, SYNTHETIC_IDS } from '../../tools/synthetic-api.mjs';

const capabilities = () => buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: false,
});
const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';


const openIntakeQuestion = {
  kind: 'intake', id: 'question-intake-1', sourceId: 'intake-1', sourceRevision: 2,
  sourceSessionId: 'intake-1', sourceHeldAt: '2026-09-01T01:00:00.000Z', sourceScheduledAt: null,
  createdAt: '2026-09-01T02:00:00.000Z', body: '첫 상담 뒤 확인할 내용', state: 'open', outcomes: [],
} as const;
const confirmedRecordQuestion = {
  kind: 'record', id: 'question-record-1', sourceId: 'record-1', sourceRevision: 1,
  sourceSessionId: 'record-1', sourceHeldAt: '2026-09-02T01:00:00.000Z', sourceScheduledAt: null,
  createdAt: '2026-09-02T02:00:00.000Z', body: '지난 회차 질문', state: 'confirmed',
  outcomes: [{ sessionId: 'record-2', heldAt: '2026-09-09T01:00:00.000Z', outcome: 'confirmed',
    answer: '확인한 답', sourceRevision: 1, sourceText: '지난 회차 질문' }],
} as const;
const withdrawnIntakeQuestion = {
  ...openIntakeQuestion, id: 'question-intake-withdrawn', state: 'withdrawn',
  outcomes: [{ sessionId: 'record-3', heldAt: '2026-09-10T01:00:00.000Z', outcome: 'confirmed',
    answer: '철회 전 확정 답', sourceRevision: 1, sourceText: '철회된 첫 상담 질문' }],
} as const;
const manualContext = {
  schemaVersion: 3, supportCaseId: CASE_ID, canWrite: true,
  defaults: { heldAt: null, channel: null, reason: null, scheduleId: null, scheduleVersion: null },
  actions: [], closedActions: [], questions: [openIntakeQuestion],
  confirmedQuestions: [confirmedRecordQuestion], withdrawnQuestions: [withdrawnIntakeQuestion],
};
const manualProjection = {
  schemaVersion: 2, revision: 1,
  details: { schemaVersion: 2, method: 'in_person', reason: null, urgency: null,
    changes: [], counselorOpinion: null, nextQuestions: [] },
  legacyDetailsJson: null, history: [], actionOutcomes: [],
  questionOutcomes: [{ kind: 'intake', questionId: openIntakeQuestion.id, sourceId: openIntakeQuestion.sourceId,
    sessionId: 'record-2', heldAt: '2026-09-09T01:00:00.000Z', outcome: 'confirmed',
    answer: '확인한 답', sourceRevision: 2, sourceText: openIntakeQuestion.body }],
};
function syntheticQuestion(value: unknown): { kind: 'schedule' | 'record' | 'intake'; id: string; sourceId: string; sourceRevision: number } {
  if (value === null || typeof value !== 'object' || !('kind' in value) || !('id' in value)
    || !('sourceId' in value) || !('sourceRevision' in value)
    || (value.kind !== 'schedule' && value.kind !== 'record' && value.kind !== 'intake')
    || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.sourceRevision !== 'number') {
    throw new Error('synthetic manual question is invalid');
  }
  return { kind: value.kind, id: value.id, sourceId: value.sourceId, sourceRevision: value.sourceRevision };
}
async function api(handler: (request: Request) => Promise<Response> | Response) {
  const verified = await installation();
  const transport = new BusinessTransport(verified, () => 'synthetic-token', async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith('/capabilities')) {
      return json(capabilities(), 200, { 'X-CCC-Installation-Id': 'client-boundary-test' });
    }
    return handler(request);
  });
  await transport.initialize();
  return { api: new RecordsApi(transport), transport };
}

describe('counseling record write boundary', () => {
  it('keeps one submission idempotent and sends the fixed manual-record shape', async () => {
    const sent: unknown[] = [];
    const { api: records } = await api(async (request) => {
      sent.push(await request.clone().json());
      return json({ record: { id: 'record-1', heldAt: '2026-09-10T05:00:00.000Z', channel: 'in_person', memo: 'memo' }, replayed: sent.length > 1 });
    });
    const submissionId = '0b7d4a92-1c3e-4f58-9a2b-6d8e0f1a2b34';
    const input = {
      submissionId, heldAt: '2026-09-10T05:00:00.000Z', memo: '합성 기록',
      details: { counselorOpinion: '  다음 회차 확인  ' },
      actions: [{ description: '서류 제출', owner: 'beneficiary' as const, dueDate: '2026-09-17' }],
      flagTypes: ['contact_loss_risk' as const],
      questionAnswers: [{ kind: 'intake' as const, questionId: openIntakeQuestion.id,
        sourceId: openIntakeQuestion.sourceId, expectedRevision: openIntakeQuestion.sourceRevision, answer: '확인한 답' }],
      schedule: { id: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedVersion: 2 },
    };
    const first = await records.create(CASE_ID, input);
    const second = await records.create(CASE_ID, input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0]).toMatchObject({
      schemaVersion: 2, submissionId, channel: 'in_person', gasScores: [],
      counselorOpinion: '다음 회차 확인',
      actionItems: [{ description: '서류 제출', owner: 'beneficiary', dueDate: '2026-09-17' }],
      questionAnswers: [{ kind: 'intake', questionId: openIntakeQuestion.id,
        sourceId: openIntakeQuestion.sourceId, expectedRevision: 2, answer: '확인한 답' }],
      flags: [{ flagType: 'contact_loss_risk' }],
      scheduleId: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedScheduleVersion: 2,
    });
    const body = sent[0];
    if (typeof body !== 'object' || body === null) throw new Error('manual request missing');
    expect(body).not.toHaveProperty('details');
    expect(body).not.toHaveProperty('questionCompletions');
  });

  it('surfaces a schedule version conflict instead of retrying with a new submission', async () => {
    const { api: records } = await api(() => json({ error: 'conflict' }, 409));
    await expect(records.create(CASE_ID, {
      submissionId: '0b7d4a92-1c3e-4f58-9a2b-6d8e0f1a2b34', heldAt: '2026-09-10T05:00:00.000Z',
      memo: '합성 기록', details: {}, actions: [], flagTypes: [], questionAnswers: [],
      schedule: { id: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedVersion: 1 },
    })).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });

  it('decodes open, confirmed and withdrawn manual questions without losing confirmed answers', async () => {
    const { api: records } = await api(() => json(manualContext));
    const context = await records.context(CASE_ID);
    expect(context.questions).toEqual([openIntakeQuestion]);
    expect(context.confirmedQuestions[0]).toMatchObject({ kind: 'record', state: 'confirmed',
      outcomes: [{ outcome: 'confirmed', answer: '확인한 답' }] });
    expect(context.withdrawnQuestions[0]).toMatchObject({ kind: 'intake', state: 'withdrawn',
      outcomes: [{ outcome: 'confirmed', answer: '철회 전 확정 답' }] });

    const { api: missingState } = await api(() => json({
      ...manualContext, questions: [{ ...openIntakeQuestion, state: undefined }],
    }));
    await expect(missingState.context(CASE_ID)).rejects.toThrow(BusinessError);
  });

  it('reads only official records and refuses an unapproved draft leaking into the list', async () => {
    const paths: string[] = [];
    const { api: records } = await api((request) => {
      paths.push(new URL(request.url).pathname + new URL(request.url).search);
      return json({
        records: [{
          id: '91ac47d2-38b5-4f0c-9a71-2d5e6f8a0b13', supportCaseId: CASE_ID,
          heldAt: '2026-09-02T01:00:00.000Z', channel: 'in_person', memo: 'memo', kind: 'regular',
          createdAt: '2026-09-02T02:00:00.000Z', gasScores: [], actionItems: [], flags: [],
          manual: manualProjection, lifeAreaSnapshot: [], managerOpinion: null, aiOneLiner: null, memoExcerpt: 'memo',
          sessionGoals: [], discrepancies: [],
        }],
        goals: [], schedule: null, recordErrorSessionIds: [], overallGoal: null,
        caseStatus: 'active', programType: 'financial_support_v1',
      });
    });
    const list = await records.list(CASE_ID);
    expect(paths[0]?.endsWith('/records?official=true')).toBe(true);
    expect(list.records[0]?.aiOneLiner).toBeNull();
    expect(list.records[0]?.manual?.questionOutcomes[0]).toMatchObject({
      kind: 'intake', questionId: openIntakeQuestion.id, answer: '확인한 답',
    });

    const { api: broken } = await api(() => json({ records: [{ id: 'x' }], goals: [], schedule: null,
      recordErrorSessionIds: [], overallGoal: null, caseStatus: 'active', programType: 'financial_support_v1' }));
    await expect(broken.list(CASE_ID)).rejects.toThrow(BusinessError);
  });
});

describe('synthetic manual records API', () => {
  const options = {
    clientOrigin: 'https://client.example', installationId: 'synthetic-installation',
    basePath: '/functions/v1/ccc', admissionCopyHash: 'a'.repeat(64), admissionCopyVersion: 'synthetic-copy-v1',
  };
  const request = async (state: Record<string, unknown>, path: string, method = 'GET', body?: unknown) => {
    const response = await handleApi(new Request(`https://api.example/functions/v1/ccc${path}`, {
      method,
      headers: { authorization: 'Bearer synthetic', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), state, options);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  it('exposes manual context and carries an intake answer into the saved record projection', async () => {
    const state = createSyntheticState() as Record<string, unknown>;
    const contextResponse = await request(state, `/support-cases/${SYNTHETIC_IDS.CASE_ID}/records/context`);
    expect(contextResponse.status).toBe(200);
    const questions = contextResponse.body.questions;
    if (!Array.isArray(questions)) throw new Error('synthetic manual questions missing');
    expect(questions.map(syntheticQuestion).map((question) => question.kind).sort()).toEqual(['intake', 'record', 'schedule']);
    expect(contextResponse.body.confirmedQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'confirmed' }),
    ]));
    expect(contextResponse.body.withdrawnQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'withdrawn', outcomes: [expect.objectContaining({ outcome: 'confirmed' })] }),
    ]));
    const closedState = createSyntheticState() as Record<string, unknown>;
    closedState.caseClosed = { reason: 'completed', at: '2026-09-13T01:00:00.000Z' };
    expect(await request(closedState, `/support-cases/${SYNTHETIC_IDS.CASE_ID}/records`, 'POST', {
      schemaVersion: 2, submissionId: 'closed-manual-submission', heldAt: '2026-09-14T01:00:00.000Z',
      channel: 'in_person', memo: '닫힌 사례 기록',
    })).toMatchObject({ status: 409, body: { error: 'conflict' } });
    const intake = questions.map(syntheticQuestion).find((question) => question.kind === 'intake')!;
    const create = await request(state, `/support-cases/${SYNTHETIC_IDS.CASE_ID}/records`, 'POST', {
      schemaVersion: 2, submissionId: 'manual-submission-1', heldAt: '2026-09-14T01:00:00.000Z',
      channel: 'in_person', memo: '합성 수기 기록',
      questionAnswers: [{ kind: intake.kind, questionId: intake.id, sourceId: intake.sourceId,
        expectedRevision: intake.sourceRevision, answer: '다음 회차에서 확인한 답' }],
    });
    expect(create).toMatchObject({ status: 201 });
    const list = await request(state, `/support-cases/${SYNTHETIC_IDS.CASE_ID}/records`);
    const records = list.body.records;
    const after = await request(state, `/support-cases/${SYNTHETIC_IDS.CASE_ID}/records/context`);
    const remaining = after.body.questions;
    if (!Array.isArray(remaining)) throw new Error('synthetic remaining questions missing');
    expect(remaining.map(syntheticQuestion).map((question) => question.kind).sort()).toEqual(['record', 'schedule']);
    expect(after.body.confirmedQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'intake', id: intake.id, state: 'confirmed' }),
    ]));
    if (!Array.isArray(records)) throw new Error('synthetic records missing');
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ manual: expect.objectContaining({
        questionOutcomes: [expect.objectContaining({ kind: 'intake', answer: '다음 회차에서 확인한 답' })],
      }) }),
    ]));
  });
});
