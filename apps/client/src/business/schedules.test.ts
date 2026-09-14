import { describe, expect, it } from 'vitest';
import { decodeBriefing, SchedulesApi } from './schedules';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';

function api() {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const transport = {
    request: async (path: string, _method?: string, body?: unknown) => {
      sent.push({ path, body: body as Record<string, unknown> });
      return { id: CASE_ID, scheduledAt: '2026-09-20T01:00:00.000Z' };
    },
  };
  return { sent, schedules: new SchedulesApi(transport as never) };
}

describe('상담 일정 등록 본문', () => {
  it('인테이크 일정은 세션 목표를 싣지 않고 세부 목표로 보낸다', async () => {
    // 서버는 인테이크 + 비어 있지 않은 sessionGoals 를 400 으로 거절한다.
    const { sent, schedules } = api();
    await schedules.create({
      beneficiaryId: 'swallow-001', supportCaseId: CASE_ID,
      scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'intake',
      goals: [' 월세 체납 정리 ', '', '소득 만들기'],
    });
    const body = sent[0]!.body;
    expect(body).not.toHaveProperty('sessionGoals');
    expect(body.caseGoals).toEqual(['월세 체납 정리', '소득 만들기']);
  });

  it('기본 상담은 세션 목표로 보내고 세부 목표를 만들지 않는다', async () => {
    const { sent, schedules } = api();
    await schedules.create({
      beneficiaryId: 'swallow-001', supportCaseId: CASE_ID,
      scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'regular', goals: ['고지서 확인'],
    });
    const body = sent[0]!.body;
    expect(body).not.toHaveProperty('caseGoals');
    expect(body.sessionGoals).toEqual([{ body: '고지서 확인', caseGoalId: null }]);
  });

  it('빈 입력은 빈 목록으로 보낸다', async () => {
    const { sent, schedules } = api();
    await schedules.create({
      beneficiaryId: 'swallow-001', supportCaseId: CASE_ID,
      scheduledAt: '2026-09-20T01:00:00.000Z', sessionKind: 'intake', goals: ['', '   '],
    });
    expect(sent[0]!.body.caseGoals).toEqual([]);
  });
});

describe('briefing custom question contract', () => {
  const briefing = (customQuestions: unknown) => ({
    beneficiaryId: 'swallow-003', focusSupportCaseId: CASE_ID, overallGoal: null, canEditOverallGoal: false,
    participant: { name: null, phone: null }, activeGoals: [],
    sections: [{ sourceSupportCase: { id: CASE_ID }, aiSuggestions: [], sessionRows: [],
      discrepancies: [], openActionItems: [], flags: [], pendingReviewSessionIds: [] }],
    focusUpcomingSchedule: { id: 'schedule-1', scheduledAt: '2026-09-20T01:00:00.000Z',
      sessionKind: 'regular', sessionGoals: [], customQuestions },
  });

  it('accepts the real string array, including no custom questions', () => {
    expect(decodeBriefing(briefing(['첫 질문', '다음 질문']), CASE_ID).upcoming?.customQuestions)
      .toEqual(['첫 질문', '다음 질문']);
    expect(decodeBriefing(briefing([]), CASE_ID).upcoming?.customQuestions).toEqual([]);
  });

  it.each([{ questions: [{ body: '옛 객체' }] }, { questions: [1] }, { questions: null }, { questions: undefined }])('rejects non-string-array custom questions %j', ({ questions }) => {
    expect(() => decodeBriefing(briefing(questions), CASE_ID)).toThrow();
  });
});
