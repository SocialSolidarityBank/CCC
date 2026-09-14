import { describe, expect, it } from 'vitest';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { decodeReport, ReportApi } from './report';
import { BusinessError } from './errors';
import { installation, json } from './test-support';
import { BusinessTransport } from './transport';
// @ts-expect-error The executable synthetic server is JavaScript without declarations.
import { createSyntheticState, handleApi, SYNTHETIC_IDS } from '../../tools/synthetic-api.mjs';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const capabilities = () => buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: false,
});
async function api(handler: (request: Request) => Promise<Response> | Response) {
  const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith('/capabilities')) return json(capabilities(), 200, { 'X-CCC-Installation-Id': 'client-boundary-test' });
    return handler(request);
  });
  await transport.initialize();
  return new ReportApi(transport);
}

const evidence = { sessionId: 'session-1', sessionNumber: 1, heldAt: '2026-09-01T01:00:00.000Z',
  source: 'intake.questionnaire.answers.managerOpinion', text: '저장된 첫 상담 의견', intakeSchemaVersion: 2, intakeRevision: 4 };
const report = {
  schemaVersion: 2, supportCaseId: 'case-1', beneficiaryId: 'swallow-003', programId: 'program-1', programName: '사업', status: 'active',
  sessions: [{ sessionId: 'session-1', sessionNumber: 1, heldAt: evidence.heldAt, kind: 'intake', channel: 'visit',
    intakeSchemaVersion: 2, intakeRevision: 4, summary: evidence, counselorOpinion: evidence }],
  firstIntakeGoal: evidence,
  nextConfirmations: [{ item: '확인할 질문', questionRef: { kind: 'intake', questionId: 'question-1',
    sourceId: 'session-1', sourceRevision: 4 }, evidence }],
  sections: { situationChanges: { entries: [evidence] } },
};

describe('report intake source version preservation', () => {
  it('retains v2 question identity, session method and evidence provenance', () => {
    const decoded = decodeReport(report);
    expect(decoded.schemaVersion).toBe(2);
    expect(decoded.sessions[0]).toMatchObject({ channel: 'visit', intakeSchemaVersion: 2, intakeRevision: 4 });
    expect(decoded.sessions[0]?.summary).toMatchObject({ intakeSchemaVersion: 2, intakeRevision: 4 });
    expect(decoded.sessions[0]?.counselorOpinion).toEqual(evidence);
    expect(decoded.nextConfirmations?.[0]?.questionRef).toEqual({
      kind: 'intake', questionId: 'question-1', sourceId: 'session-1', sourceRevision: 4,
    });
    expect(decoded.firstIntakeGoal).toEqual(evidence);
    expect(decoded.sections.situationChanges?.entries[0]).toEqual(evidence);
  });

  it('does not invent provenance for older responses', () => {
    const decoded = decodeReport({ ...report, sessions: [{ ...report.sessions[0], intakeSchemaVersion: undefined,
      intakeRevision: undefined, summary: undefined }], firstIntakeGoal: undefined, sections: {} });
    expect(decoded.sessions[0]).not.toHaveProperty('intakeSchemaVersion');
    expect(decoded.sessions[0]).not.toHaveProperty('intakeRevision');
  });

  it.each([{ intakeSchemaVersion: 3 }, { intakeRevision: 0 }, { intakeRevision: '4' }])('rejects malformed intake provenance %j', (patch) => {
    expect(() => decodeReport({ ...report, sessions: [{ ...report.sessions[0], ...patch }] })).toThrow(BusinessError);
    expect(() => decodeReport({ ...report, firstIntakeGoal: { ...evidence, ...patch } })).toThrow(BusinessError);
  });

  it.each([
    { questionRef: undefined },
    { questionRef: { kind: 'unknown', questionId: 'question-1', sourceId: 'session-1', sourceRevision: 4 } },
    { questionRef: { kind: 'intake', questionId: 'question-1', sourceId: 'session-1', sourceRevision: 0 } },
  ])('rejects malformed v2 question references %j', (patch) => {
    expect(() => decodeReport({ ...report, nextConfirmations: [{ ...report.nextConfirmations[0], ...patch }] }))
      .toThrow(BusinessError);
  });
});

describe('report CSV export boundary', () => {
  it('downloads the selected case CSV with the Bearer token and served filename', async () => {
    const requests: Request[] = [];
    const report = await api((request) => {
      requests.push(request);
      return new Response('\uFEFF회차,상담일\r\n1,2026-09-01\r\n', { status: 200, headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': "attachment; filename=\"case.csv\"; filename*=UTF-8''%EA%B2%BD%EA%B3%BC-swallow-003.csv",
      } });
    });
    const file = await report.exportCsv(CASE_ID);
    expect(new URL(requests[0]!.url).pathname.endsWith(`/support-cases/${CASE_ID}/export.csv`)).toBe(true);
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer synthetic-token');
    expect(requests[0]!.headers.get('accept')).toBe('text/csv');
    expect(file.filename).toBe('경과-swallow-003.csv');
    expect(file.blob.type.startsWith('text/csv')).toBe(true);
    expect(await file.blob.text()).toContain('회차,상담일');
  });

  it.each([
    [403, { error: 'forbidden' }, 'forbidden'],
    [409, { error: 'conflict' }, 'conflict'],
  ] as const)('surfaces the server rejection %s without a file', async (status, body, code) => {
    const report = await api(() => json(body, status));
    await expect(report.exportCsv(CASE_ID)).rejects.toMatchObject({ code, status });
  });

  it('rejects a non-CSV success body instead of saving it', async () => {
    const report = await api(() => json({ ok: true }));
    await expect(report.exportCsv(CASE_ID)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('synthetic CSV export route', () => {
  const options = {
    clientOrigin: 'https://client.example', installationId: 'synthetic-installation',
    basePath: '/functions/v1/ccc', admissionCopyHash: 'a'.repeat(64), admissionCopyVersion: 'synthetic-copy-v1',
  };
  const download = (state: Record<string, unknown>) => handleApi(new Request(
    `https://api.example/functions/v1/ccc/support-cases/${SYNTHETIC_IDS.CASE_ID}/export.csv`,
    { headers: { authorization: 'Bearer synthetic', accept: 'text/csv' } },
  ), state, options) as Promise<Response>;

  it('serves CSV to the assigned worker and refuses a technical admin', async () => {
    const worker = await download(createSyntheticState() as Record<string, unknown>);
    expect(worker.status).toBe(200);
    expect(worker.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(worker.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(await worker.text()).toContain('"회차","상담일"');
    const technical = createSyntheticState() as Record<string, unknown>;
    technical.role = 'technical-admin';
    const refused = await download(technical);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'forbidden' });
  });
});
