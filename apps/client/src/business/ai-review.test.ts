import { describe, expect, it } from 'vitest';
import { AiReviewApi, decodeAiDraft } from './ai-review';

const SESSION_ID = '91ac47d2-38b5-4f0c-9a71-2d5e6f8a0b13';
const SNAPSHOT_ID = '81ac47d2-38b5-4f0c-9a71-2d5e6f8a0b13';
const base = {
  version: 1, origin: 'generated', creationMode: 'provider_generated', summaryText: '저장된 요약',
  oneLiner: '근거 있는 한 줄', reviewDecision: null,
  claims: [], questions: [], evidence: [], contrast: [],
};

describe('AI 검토 계약', () => {
  it('현재 초안 조회의 재생성 신호를 읽는다', () => {
    expect(decodeAiDraft({
      ...base, regenerateAvailable: true, regenerateSourceSnapshotId: SNAPSHOT_ID,
    })).toMatchObject({ regenerateAvailable: true, regenerateSourceSnapshotId: SNAPSHOT_ID });
  });

  it('승인 응답에 재생성 전용 필드가 없어도 닫힌 상태로 읽는다', () => {
    expect(decodeAiDraft({ ...base, reviewDecision: 'approved' })).toMatchObject({
      reviewDecision: 'approved', regenerateAvailable: false, regenerateSourceSnapshotId: null,
    });
  });

  it('서버가 준 새 스냅샷 ID만 재생성 요청에 되돌려 보낸다', async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const transport = {
      request: async (path: string, method?: string, body?: unknown) => {
        calls.push({ path, method, body });
        return { ...base, version: 2 };
      },
    };
    await new AiReviewApi(transport as never).regenerate(SESSION_ID, SNAPSHOT_ID);
    expect(calls).toEqual([{
      path: `/sessions/${SESSION_ID}/ai/generate`, method: 'POST', body: { sourceSnapshotId: SNAPSHOT_ID },
    }]);
  });
});

describe('canonical comparison DTO boundary', () => {
  const finding = { description: '고지서 확인', materialKind: 'transcript', quote: '고지서를 못 봤어요' };

  it('accepts canonical axes and preserves unavailable states without inventing findings', () => {
    const draft = decodeAiDraft({ ...base, contrast: [
      { axis: 'missing_from_memo', status: 'applied', findings: [finding] },
      { axis: 'missing_from_transcript', status: 'no_text', findings: [] },
      { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
    ] });
    expect(draft.contrast.map((entry) => [entry.axis, entry.status, entry.findings.length])).toEqual([
      ['missing_from_memo', 'applied', 1], ['missing_from_transcript', 'no_text', 0],
      ['undiscussed_session_goal', 'no_session_goal', 0],
    ]);
    expect(decodeAiDraft({ ...base, contrast: [
      { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
    ] }).contrast[0]?.status).toBe('no_transcript');
  });

  it.each(['missing_in_memo', 'missing_in_audio', 'undiscussed_goals'])('rejects legacy axis %s', (axis) => {
    expect(() => decodeAiDraft({ ...base, contrast: [{ axis, status: 'applied', findings: [] }] })).toThrow();
  });

  it('rejects unknown states and findings on an unavailable axis', () => {
    expect(() => decodeAiDraft({ ...base, contrast: [
      { axis: 'missing_from_memo', status: 'no_material', findings: [] },
    ] })).toThrow();
    expect(() => decodeAiDraft({ ...base, contrast: [
      { axis: 'missing_from_memo', status: 'no_transcript', findings: [finding] },
    ] })).toThrow();
  });

  it.each([{ description: undefined }, { materialKind: 'memo' }, { quote: null }])('rejects malformed evidence %j', (patch) => {
    expect(() => decodeAiDraft({ ...base, contrast: [
      { axis: 'missing_from_memo', status: 'applied', findings: [{ ...finding, ...patch }] },
    ] })).toThrow();
  });
});
