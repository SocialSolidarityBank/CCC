// CCC-73 — AI 재료 배선 (D62 §7 · ADR-0032)
// 텍스트 일감 원문(getTextWorkItemSource)이 케이스 컨텍스트(전체 목표 으뜸, 인테이크
// 지원욕구·지원방향 기본)를 깔고 회차 텍스트를 잇는지, 이력의 이전 문구·무응답 선택값이
// 재료에서 빠지는지 고정한다. 이 원문은 장비 마스킹을 거친 스냅샷이 되어야만 사업자로
// 나간다(D57 게이트). 사업자 호출부 쪽 보증은 routes.test.ts 의 CCC-73 테스트가 잡는다.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  createCase,
  createCounselingRecord,
  createIntakeRecord,
  enqueueTextWorkItem,
  getTextWorkItemSource,
  listSupportCasesForBeneficiary,
  listTextWorkItems,
  recordPilotTextAiConsentEvidence,
  setSupportCaseOverallGoal,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 픽스처가 케이스·인테이크·회차·동의를 매번 새로 만든다. 전체 스위트 병렬 실행에서
// 기본 5초를 넘길 수 있어 discrepancies.test.ts 와 같은 이유로 여유를 준다.
vi.setConfig({ testTimeout: 30_000 });

const { counselor, service } = testActors;
const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

async function fixtureCase(): Promise<{ caseId: string; supportCaseId: string }> {
  const caseRecord = await createCase(t.env, counselor, {});
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, caseRecord.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected initial support case');
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  await recordPilotTextAiConsentEvidence(t.env, counselor, caseRecord.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: 'a'.repeat(64),
    evidenceRef: `r2://pilot-evidence/${caseRecord.id}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  return { caseId: caseRecord.id, supportCaseId };
}

async function saveRecord(
  supportCaseId: string,
  memo: string,
  details?: { sessionGoalNote?: string },
): Promise<string> {
  const result = await createCounselingRecord(t.env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-07-08T10:00:00.000Z',
    channel: 'in_person',
    memo,
    gasScores: [],
    actionItems: [],
    flags: [],
    ...(details === undefined ? {} : { details }),
  });
  return result.record.id;
}

/** 장비 폴링과 같은 경로로 일감을 찾아 원문을 꺼낸다. */
async function sourceForSession(sessionId: string): Promise<string> {
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  const items = await listTextWorkItems(t.env, service);
  const item = items.find((entry) => entry.sessionId === sessionId);
  if (item === undefined) throw new Error('expected a pending text work item');
  const { text } = await getTextWorkItemSource(t.env, service, item.id);
  return text;
}

describe('getTextWorkItemSource — AI 재료 배선 (CCC-73 · D62 §7)', () => {
  it('전체 목표를 으뜸으로, 인테이크 선택값을 기본으로 깔고 회차 텍스트를 잇는다', async () => {
    const { supportCaseId } = await fixtureCase();
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '전세 보증금을 마련한다');
    await createIntakeRecord(t.env, counselor, supportCaseId, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-07-01T10:00:00.000Z',
      channel: 'in_person',
      answers: [
        { key: 'need_primary', response: 'answered', text: '주거 안정' },
        // 무응답 선택값은 재료에 싣지 않는다.
        { key: 'need_secondary', response: 'declined' },
        { key: 'summary_direction', response: 'answered', text: '긴급 주거비 지원 연계' },
      ],
    });
    const sessionId = await saveRecord(
      supportCaseId,
      '보증금 마련 계획을 함께 세웠다',
      { sessionGoalNote: '대출 서류 준비 여부 확인' },
    );

    const text = await sourceForSession(sessionId);
    const lines = text.split('\n');
    expect(lines[0]).toBe('[전체 목표] 전세 보증금을 마련한다');
    expect(lines[1]).toBe('[지원욕구 1순위] 주거 안정');
    expect(lines[2]).toBe('[지원방향] 긴급 주거비 지원 연계');
    expect(lines[3]).toBe('보증금 마련 계획을 함께 세웠다');
    // 워크인 폴백 자유 글(D62 §7)은 회차 텍스트 뒤에 붙는다.
    expect(lines[4]).toBe('[이번 상담에서 확인할 것] 대출 서류 준비 여부 확인');
    expect(text).not.toContain('지원욕구 2순위');
  });

  it('컨텍스트가 비어 있으면 회차 텍스트만 나간다(빈 라벨 없음)', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await saveRecord(supportCaseId, '오늘 상담 내용을 수기로 남긴다');

    const text = await sourceForSession(sessionId);
    expect(text).toBe('오늘 상담 내용을 수기로 남긴다');
  });

  it('전체 목표의 이전 문구(이력)는 재료에 싣지 않는다', async () => {
    const { supportCaseId } = await fixtureCase();
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, 'OLD_GOAL_PHRASE 첫 합의 문구');
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '다듬은 최종 문구');
    const sessionId = await saveRecord(supportCaseId, '문구를 다듬은 뒤의 상담');

    const text = await sourceForSession(sessionId);
    expect(text).toContain('[전체 목표] 다듬은 최종 문구');
    expect(text).not.toContain('OLD_GOAL_PHRASE');

    // 대조군: 이력 자체는 두 줄 쌓여 있다. 이력이 있어도 재료는 현재 문구뿐이어야
    // 이 테스트가 실제 제외를 증명한다(헛도는 테스트 방지).
    const revisions = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM goal_revisions WHERE support_case_id = ? AND goal_id IS NULL',
    ).bind(supportCaseId).first<{ count: number }>();
    expect(Number(revisions?.count)).toBe(2);
  });

  it('컨텍스트에 실린 등록 실명도 1차 치환을 거친다 (R3)', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    await updateParticipantPii(t.env, counselor, caseId, {
      supportCaseContextId: supportCaseId,
      expectedVersion: 1,
      name: '홍길동',
    });
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '홍길동 님의 채무를 정리한다');
    const sessionId = await saveRecord(supportCaseId, '상환 계획을 점검했다');

    const text = await sourceForSession(sessionId);
    expect(text).toContain('[전체 목표]');
    expect(text).not.toContain('홍길동');
  });
});
