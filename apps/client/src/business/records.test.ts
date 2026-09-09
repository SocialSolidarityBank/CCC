import { describe, expect, it } from 'vitest';
import { installation, json } from './test-support';
import { BusinessTransport } from './transport';
import { RecordsApi } from './records';
import { BusinessError } from './errors';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';

const capabilities = () => buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: false,
});
const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';

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
      details: { counselorOpinion: '  다음 회차 확인  ', safetyNote: '   ' },
      actions: [{ description: '서류 제출', owner: 'beneficiary' as const, dueDate: '2026-09-17' }],
      flagTypes: ['contact_loss_risk' as const],
      schedule: { id: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedVersion: 2 },
    };
    const first = await records.create(CASE_ID, input);
    const second = await records.create(CASE_ID, input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0]).toMatchObject({
      submissionId, channel: 'in_person', gasScores: [],
      details: { counselorOpinion: '다음 회차 확인' },
      flags: [{ flagType: 'contact_loss_risk' }],
      scheduleId: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedScheduleVersion: 2,
    });
    // 빈 서술 항목은 아예 보내지 않는다. 서버가 빈 문자열을 거부하기 때문이다.
    const body = sent[0];
    if (typeof body !== 'object' || body === null || !('details' in body)) throw new Error('details missing');
    const details = body.details;
    if (typeof details !== 'object' || details === null) throw new Error('details is not an object');
    expect(Object.keys(details)).toEqual(['counselorOpinion']);
  });

  it('surfaces a schedule version conflict instead of retrying with a new submission', async () => {
    const { api: records } = await api(() => json({ error: 'conflict' }, 409));
    await expect(records.create(CASE_ID, {
      submissionId: '0b7d4a92-1c3e-4f58-9a2b-6d8e0f1a2b34', heldAt: '2026-09-10T05:00:00.000Z',
      memo: '합성 기록', details: {}, actions: [], flagTypes: [],
      schedule: { id: '5b8d3c14-6f2a-4c19-8d3e-9a1b2c4d6e80', expectedVersion: 1 },
    })).rejects.toMatchObject({ code: 'conflict', status: 409 });
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
          lifeAreaSnapshot: [], managerOpinion: null, aiOneLiner: null, memoExcerpt: 'memo',
          sessionGoals: [], discrepancies: [],
        }],
        goals: [], schedule: null, recordErrorSessionIds: [], overallGoal: null,
        caseStatus: 'active', programType: 'financial_support_v1',
      });
    });
    const list = await records.list(CASE_ID);
    expect(paths[0]?.endsWith('/records?official=true')).toBe(true);
    expect(list.records[0]?.aiOneLiner).toBeNull();

    const { api: broken } = await api(() => json({ records: [{ id: 'x' }], goals: [], schedule: null,
      recordErrorSessionIds: [], overallGoal: null, caseStatus: 'active', programType: 'financial_support_v1' }));
    await expect(broken.list(CASE_ID)).rejects.toThrow(BusinessError);
  });
});
