import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(join/worker 페이지 테스트와 같은 이유).
afterEach(cleanup);

const getSupportCaseClosureInfo = vi.fn();
const getParticipantBriefing = vi.fn();
const getParticipantGoalTree = vi.fn();
const closeSupportCaseAction = vi.fn();

// page.tsx 가 lib/api 를 import 하므로 모듈 로드가 server-only 변환에 걸린다 — 페이지가
// 실제로 부르는 셋만 목으로 둔다(join/worker/[token]/page.test.tsx 패턴).
vi.mock('../../../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getSupportCaseClosureInfo: (supportCaseId: string) => getSupportCaseClosureInfo(supportCaseId),
  getParticipantBriefing: (beneficiaryId: string, supportCaseId: string) => getParticipantBriefing(beneficiaryId, supportCaseId),
  getParticipantGoalTree: (beneficiaryId: string) => getParticipantGoalTree(beneficiaryId),
}));

// HERO 메타의 사업명 라벨. 실제 모듈은 server-only 라 jsdom 에서 못 읽는다(consent-editor 패턴).
vi.mock('../../../../../lib/display-labels', () => ({
  getDisplayLabels: async () => ({ programLabels: { financial_support_v1: '마이크로크레딧 씬파일러 금융지원·멘토링' } }),
}));

vi.mock('../../../../../actions', () => ({
  closeSupportCaseAction: (formData: FormData) => closeSupportCaseAction(formData),
}));

const { CloseContent } = await import('./page');

const BENEFICIARY_ID = 'swallow-003';
const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';

function contentProps(overrides: { notice?: string; error?: string } = {}) {
  return {
    beneficiaryId: BENEFICIARY_ID,
    supportCaseId: SUPPORT_CASE_ID,
    notice: overrides.notice,
    error: overrides.error,
  };
}

function closureInfo(overrides: Record<string, unknown> = {}) {
  return {
    supportCaseId: SUPPORT_CASE_ID,
    beneficiaryId: BENEFICIARY_ID,
    status: 'active',
    closedAt: null,
    closedReason: null,
    purgeDue: null,
    purgedAt: null,
    hasOtherActiveSupportCase: false,
    ...overrides,
  };
}

function activeBriefing() {
  return {
    beneficiaryId: BENEFICIARY_ID,
    focusSupportCaseId: SUPPORT_CASE_ID,
    participant: { name: '김미영', phone: '010-1234-5678' },
    sections: [{
      sourceSupportCase: { id: SUPPORT_CASE_ID, programType: 'financial_support_v1', status: 'active' },
      openActionItems: [
        { id: 'action-1', description: '서류 제출 지원', owner: 'counselor', dueDate: '2026-09-01' },
        { id: 'action-2', description: '기관 연계 확인', owner: 'org', dueDate: null },
      ],
    }],
  };
}

function goalTree() {
  return [{
    sourceSupportCase: { id: SUPPORT_CASE_ID, programType: 'financial_support_v1', status: 'active' },
    overallGoal: null,
    overallGoalRevisions: [],
    goals: [
      { id: 'goal-1', title: '주거 안정 확보', status: 'active', closedReason: null, closedAt: null, revisions: [], sessionGoals: [], linkedSessions: [] },
      { id: 'goal-2', title: '이미 닫힌 목표', status: 'closed', closedReason: 'achieved', closedAt: '2026-08-01T00:00:00.000Z', revisions: [], sessionGoals: [], linkedSessions: [] },
    ],
  }];
}

beforeEach(() => {
  getSupportCaseClosureInfo.mockReset();
  getParticipantBriefing.mockReset();
  getParticipantGoalTree.mockReset();
  closeSupportCaseAction.mockReset();
});

describe('케이스 종결 확인 화면 (CCC-107)', () => {
  it('진행 중 케이스: 미해결 액션·활성 목표 목록과 종결 폼(사유 필수·확인 체크)을 그린다', async () => {
    getSupportCaseClosureInfo.mockResolvedValue(closureInfo());
    getParticipantBriefing.mockResolvedValue(activeBriefing());
    getParticipantGoalTree.mockResolvedValue(goalTree());

    const { container } = render(await CloseContent(contentProps()));

    expect(getSupportCaseClosureInfo).toHaveBeenCalledWith(SUPPORT_CASE_ID);
    // 공통 HERO(D38, 2026-09-04 Q): 되돌리기 어려운 화면이라 누구의 어떤 케이스인지 머리에 선다.
    // 이름은 브리핑 응답의 것을 그대로 쓴다(추가 금고 조회·감사 없음). h1 은 PageTitle 하나다.
    const hero = container.querySelector('.participant-hero-card');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('h2 .participant-name')?.textContent).toBe('김미영');
    expect(hero?.querySelector('.wire-status-tag')?.textContent).toBe('진행 중');
    expect(hero?.textContent).toContain('마이크로크레딧 씬파일러 금융지원·멘토링');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    // 종결 전 확인 재료: 미해결 액션 아이템과 활성 세부 목표만 선다(닫힌 목표는 안 선다).
    expect(container.textContent).toContain('서류 제출 지원');
    expect(container.textContent).toContain('기관 연계 확인');
    expect(container.textContent).toContain('주거 안정 확보');
    expect(container.textContent).not.toContain('이미 닫힌 목표');
    // 폼 이름 계약: closeSupportCaseAction 이 이 이름으로 읽는다. 사유·확인 체크는 필수다.
    const reason = container.querySelector('textarea[name="reason"]') as HTMLTextAreaElement;
    expect(reason).not.toBeNull();
    expect(reason.required).toBe(true);
    const confirm = container.querySelector('input[name="confirmClose"]') as HTMLInputElement;
    expect(confirm).not.toBeNull();
    expect(confirm.required).toBe(true);
    expect((container.querySelector('input[name="beneficiaryId"]') as HTMLInputElement).value).toBe(BENEFICIARY_ID);
    expect((container.querySelector('input[name="supportCaseId"]') as HTMLInputElement).value).toBe(SUPPORT_CASE_ID);
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain('케이스 종결');
  });

  it('이미 종결된 케이스: 종결일·사유·파기 예정일을 읽기 전용으로 보여주고 폼은 그리지 않는다', async () => {
    getSupportCaseClosureInfo.mockResolvedValue(closureInfo({
      status: 'closed',
      closedAt: '2026-08-15T02:00:00.000Z',
      closedReason: '지원 목표 달성',
      purgeDue: '2027-02-15T02:00:00.000Z',
    }));

    getParticipantBriefing.mockResolvedValue({ ...activeBriefing(), sections: [] });

    const { container } = render(await CloseContent(contentProps()));

    // 종결 상태에서는 종결 재료(목표 트리)를 조회하지 않는다 — 표시만 한다. 브리핑은
    // HERO 이름 하나 때문에 읽는다(2026-09-04 Q, 15초 페이지와 같은 읽기). 못 받아도 화면은 선다.
    expect(getParticipantGoalTree).not.toHaveBeenCalled();
    expect(getParticipantBriefing).toHaveBeenCalledTimes(1);
    const hero = container.querySelector('.participant-hero-card');
    expect(hero?.querySelector('h2 .participant-name')?.textContent).toBe('김미영');
    expect(hero?.querySelector('.wire-status-tag')?.textContent).toBe('종결');
    expect(container.querySelector('[data-testid="closed-case-summary"]')).not.toBeNull();
    expect(container.textContent).toContain('지원 목표 달성');
    expect(container.textContent).toContain('2026'); // 종결일
    expect(container.querySelector('[data-testid="closed-purge-due"]')?.textContent).toContain('2027');
    expect(container.querySelector('textarea[name="reason"]')).toBeNull();
    expect(container.querySelector('input[name="confirmClose"]')).toBeNull();
  });

  it('종결됐지만 다른 진행 중 케이스가 남았으면 보관 기간 미시작 안내를 보여준다', async () => {
    getSupportCaseClosureInfo.mockResolvedValue(closureInfo({
      status: 'closed',
      closedAt: '2026-08-15T02:00:00.000Z',
      closedReason: '사업 전환',
      purgeDue: null,
      hasOtherActiveSupportCase: true,
    }));

    const { container } = render(await CloseContent(contentProps()));
    expect(container.querySelector('[data-testid="closed-purge-due"]')?.textContent)
      .toContain('다른 진행 중 케이스가 있어');
  });

  it('접근 불가(403)면 오류 상태를 그린다', async () => {
    const { ApiError } = await import('../../../../../lib/api') as unknown as { ApiError: new (code: string) => Error };
    getSupportCaseClosureInfo.mockRejectedValue(new ApiError('forbidden'));

    const { container } = render(await CloseContent(contentProps()));
    expect(container.textContent).toContain('접근 권한과 주소를 확인하세요');
  });
});
