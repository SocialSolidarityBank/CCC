import { describe, expect, it } from 'vitest';
import { decodeReport } from './report';
import { BusinessError } from './errors';

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
