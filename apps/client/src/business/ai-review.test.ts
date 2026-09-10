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
