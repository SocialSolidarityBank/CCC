import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { GoalTreeCard as GoalTreeCardView } from './goal-tree';
import type { ParticipantGoalTreeCase } from '../../lib/api';

// 목표 트리 (D62 §8 · CCC-69) — 전체 > 세부 > 세션 위계, 닫힌 목표 흐리게, '이력 보기'.
// 이력 보기가 이전 문구·수정자·시각을 표시하는 것이 티켓 완료 기준이다.

afterEach(cleanup);

const programLabels = { microcredit: '마이크로크레딧 씬파일러 금융지원·멘토링' } as never;

function GoalTreeCard(props: Omit<ComponentProps<typeof GoalTreeCardView>, 'beneficiaryId'>) {
  return <GoalTreeCardView beneficiaryId="swallow-003" {...props} />;
}

function caseTree(overrides: Partial<ParticipantGoalTreeCase> = {}): ParticipantGoalTreeCase {
  return {
    sourceSupportCase: { id: 'case-1', programType: 'microcredit' as never, status: 'active' },
    overallGoal: '안정적인 주거 확보와 채무 상환 계획 실행',
    overallGoalRevisions: [
      { title: '안정적인 주거 확보와 채무 상환 계획 실행', editedByName: '김실무', editedAt: '2026-08-05T02:00:00Z' },
      { title: '주거 안정', editedByName: '박담당', editedAt: '2026-07-01T02:00:00Z' },
    ],
    goals: [
      {
        id: 'g1',
        title: '월 지출 내역을 매주 기록한다',
        status: 'active',
        closedReason: null,
        closedAt: null,
        revisions: [
          { title: '월 지출 내역을 매주 기록한다', editedByName: '김실무', editedAt: '2026-08-01T02:00:00Z' },
        ],
        sessionGoals: [
          { id: 'sg1', body: '가계부 확인', scheduledAt: '2026-08-10T05:00:00Z', scheduleStatus: 'scheduled' },
          { id: 'sg2', body: '지출 항목 정리', scheduledAt: '2026-07-20T05:00:00Z', scheduleStatus: 'completed' },
        ],
        linkedSessions: [{
          sessionId: 'session-2',
          heldAt: '2026-07-20T05:00:00Z',
          oneLiner: '지출 항목을 정리하고 다음 확인일을 정했다.',
        }],
      },
      {
        id: 'g2',
        title: '이력서를 월 2회 제출한다',
        status: 'closed',
        closedReason: 'achieved',
        closedAt: '2026-08-01T02:00:00Z',
        revisions: [
          { title: '이력서를 월 2회 제출한다', editedByName: '김실무', editedAt: '2026-07-01T02:00:00Z' },
        ],
        sessionGoals: [],
        linkedSessions: [],
      },
    ],
    ...overrides,
  };
}

describe('GoalTreeCard — 목표 트리 (D62 §8)', () => {
  it('전체 > 세부 > 세션 위계가 케이스 구획 안에 선다', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    expect(container.textContent).toContain('전체 목표');
    expect(container.textContent).toContain('안정적인 주거 확보와 채무 상환 계획 실행');
    expect(container.textContent).toContain('월 지출 내역을 매주 기록한다');
    // 세션 목표는 세부 목표 가지 아래 들여쓴 줄이다 — 회기 시각과 문구가 함께 남는다.
    const sessionRows = [...container.querySelectorAll('.goal-tree-session-row')];
    expect(sessionRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('가계부 확인'),
      expect.stringContaining('지출 항목 정리'),
    ]);
    expect(sessionRows[0]?.closest('.goal-tree-goal')?.textContent).toContain('월 지출 내역을 매주 기록한다');
  });


  it('축약되는 전체·세부 목표는 전체 문구를 title 속성으로 보존한다', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    const overall = container.querySelector('.goal-tree-overall-text');
    const detail = container.querySelector('.goal-tree-goal-title');
    expect(overall?.getAttribute('title')).toBe('안정적인 주거 확보와 채무 상환 계획 실행');
    expect(detail?.getAttribute('title')).toBe('월 지출 내역을 매주 기록한다');
  });
  it('세부 목표를 펼치면 연결된 회차의 날짜와 핵심 한 줄이 기록 앵커 링크로 보인다 (D73)', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    const goal = [...container.querySelectorAll('details.goal-tree-goal-details')]
      .find((details) => details.textContent?.includes('월 지출 내역을 매주 기록한다'));
    expect(goal).not.toBeUndefined();
    expect(goal?.hasAttribute('open')).toBe(false);
    const sessionLink = goal?.querySelector('.goal-tree-linked-session');
    expect(sessionLink?.textContent).toContain('2026년 7월 20일');
    expect(sessionLink?.textContent).toContain('지출 항목을 정리하고 다음 확인일을 정했다.');
    expect(sessionLink?.getAttribute('href'))
      .toBe('/participants/swallow-003/programs/case-1/records#record-session-2');
  });

  it('닫힌 목표는 흐림 클래스와 사유 배지로 남는다 — 지워지지 않는다', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    const closed = [...container.querySelectorAll('.goal-tree-goal')]
      .find((node) => node.textContent?.includes('이력서를 월 2회 제출한다'));
    expect(closed?.classList.contains('is-closed')).toBe(true);
    expect(closed?.querySelector('.wire-badge')?.textContent).toBe('종료(달성)');
    const active = [...container.querySelectorAll('.goal-tree-goal')]
      .find((node) => node.textContent?.includes('월 지출 내역'));
    expect(active?.classList.contains('is-closed')).toBe(false);
  });

  it('이력 보기가 이전 문구·수정자·시각을 표시한다 (완료 기준)', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    const overallHistory = [...container.querySelectorAll('details.goal-tree-history')]
      .find((details) => details.textContent?.includes('주거 안정'));
    expect(overallHistory).not.toBeUndefined();
    // 기본 숨김 — 네이티브 details 라 open 속성이 없어야 한다(D62 §4 "기본으로 숨기고").
    expect(overallHistory?.hasAttribute('open')).toBe(false);
    const historyChevron = overallHistory?.querySelector('.wire-disclosure-chevron');
    expect(historyChevron?.getAttribute('data-variant')).toBe('plain');
    expect(historyChevron?.classList.contains('wire-chevron-button')).toBe(false);
    const rows = [...(overallHistory as HTMLElement).querySelectorAll('.goal-tree-history-row')];
    expect(rows).toHaveLength(2);
    // 최신부터: 현재 문구가 먼저, 이전 문구(최초 작성)가 마지막이다.
    expect(rows[0]?.textContent).toContain('안정적인 주거 확보와 채무 상환 계획 실행');
    expect(rows[0]?.textContent).toContain('김실무');
    expect(rows[0]?.textContent).toContain('수정');
    expect(rows[1]?.textContent).toContain('주거 안정');
    expect(rows[1]?.textContent).toContain('박담당');
    expect(rows[1]?.textContent).toContain('최초 작성');
    // 시각 표기 — 공용 한국어 날짜 표기가 실제로 들어간다.
    expect(rows[0]?.textContent).toContain('2026년 8월 5일');
  });

  it('이력이 없으면 이력 보기 토글 자체가 없다', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree({
      overallGoalRevisions: [],
      goals: [],
    })]} programLabels={programLabels} />);
    expect(container.querySelector('details.goal-tree-history')).toBeNull();
    // 세부 목표가 없으면 빈 상태 안내가 선다.
    expect(container.textContent).toContain('세부 목표가 없습니다');
  });

  it('전체 목표 미설정은 설정 전으로 읽히고, 케이스가 여럿이면 사업명 머리가 선다', () => {
    const second = caseTree({
      sourceSupportCase: { id: 'case-2', programType: 'microcredit' as never, status: 'closed' },
      overallGoal: null,
      overallGoalRevisions: [],
      goals: [],
    });
    const { container } = render(<GoalTreeCard cases={[caseTree(), second]} programLabels={programLabels} />);
    expect(container.textContent).toContain('설정 전');
    const heads = [...container.querySelectorAll('.goal-tree-case-title')];
    expect(heads).toHaveLength(2);
    // 케이스 구획이 갈린다 — 두 번째 케이스(종결)에는 종결 배지가 선다.
    const blocks = [...container.querySelectorAll('.goal-tree-case')];
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.textContent).toContain('종결');
  });

  it('케이스가 0건이면 카드를 그리지 않는다', () => {
    const { container } = render(<GoalTreeCard cases={[]} programLabels={programLabels} />);
    expect(container.querySelector('.participant-hub-card')).toBeNull();
  });

  it('세부 목표가 2개 이상일 때만 불릿 목록이 된다 (§5 불릿 규칙 · 2026-08-09 Q)', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    // 목표 2개 — 나열이라 구분자(불릿)를 얹는다.
    expect(container.querySelector('.goal-tree-goals')?.classList.contains('wire-bullets')).toBe(true);
    cleanup();
    const single = render(<GoalTreeCard cases={[caseTree({
      goals: [{ id: 'g1', title: '월 지출 내역을 매주 기록한다', status: 'active', closedReason: null, closedAt: null, revisions: [], sessionGoals: [], linkedSessions: [] }],
    })]} programLabels={programLabels} />);
    // 한 항목뿐이면 목록이 아니라 문장이다 — 점도 들여쓰기도 두지 않는다.
    expect(single.container.querySelector('.goal-tree-goals')?.classList.contains('wire-bullets')).toBe(false);
  });

  it('세션 목표 줄은 날짜와 문장을 각각 독립 노드로 둔다 — 세로선 구분자를 쓰지 않는다', () => {
    const { container } = render(<GoalTreeCard cases={[caseTree()]} programLabels={programLabels} />);
    const row = container.querySelector('.goal-tree-session-row');
    // 날짜는 자기 노드다(색으로 구분하므로 문장과 한 노드에 섞이면 물들일 자리가 없다).
    expect(row?.querySelector('.goal-tree-session-date')?.textContent).toBe('2026년 8월 10일');
    expect(row?.querySelector('.goal-tree-session-body')?.textContent).toBe('가계부 확인');
    // MetaRow 의 세로선 구분자는 문장이 접힐 때 본문 앞 막대로 남아 쓰지 않는다.
    expect(row?.querySelector('.wire-meta-row')).toBeNull();
  });

  it('목표 조회만 실패하면 카드 자리에 오류 한 줄이 남는다 — 허브는 계속 선다 (D8 폴백)', () => {
    const { container } = render(<GoalTreeCard cases={[]} programLabels={programLabels} loadFailed />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('목표를 지금 불러올 수 없습니다');
    // 카드 셸은 유지된다 — 구획이 통째로 사라지면 실무자가 목표가 없는 것으로 오독한다.
    expect(container.querySelector('.participant-hub-card')).not.toBeNull();
  });
});
