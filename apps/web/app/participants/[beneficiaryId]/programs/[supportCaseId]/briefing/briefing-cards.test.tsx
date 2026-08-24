import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { BriefingCards, type BriefingCardsProps } from './briefing-cards';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다 — 렌더 누적을 막기 위해 명시 정리.
afterEach(cleanup);

function baseProps(overrides: Partial<BriefingCardsProps> = {}): BriefingCardsProps {
  return {
    beneficiaryId: 'swallow-003',
    supportCaseId: '11111111-1111-4111-8111-111111111111',
    overallGoal: null,
    activeGoals: [],
    canEditOverallGoal: true,
    participantHref: '/participants/swallow-003',
    recordsHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records',
    recordNewHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records/new',
    programLabel: '마이크로크레딧 씬파일러 금융지원·멘토링',
    participant: { name: '홍길동', phone: '010-1234-5678' },
    sessionRows: [
      { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '구직 활동 근황과 지출 정리를 확인했다' },
      { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', kind: 'intake', aiOneLiner: null, memoExcerpt: '채무 현황과 정서적 어려움 확인' },
    ],
    discrepancies: [],
    pendingApprovalCount: 2,
    pendingReviewSessionIds: [],
    aiSuggestions: [{
      title: '최근 구직 활동은 어땠는지',
      reason: '지난 회차에서 면접 결과를 기다리고 있었다',
      sessionId: 's-2',
      heldAt: '2026-07-15T05:00:00Z',
      sourceQuotes: ['면접 결과는 다음 주에 나와요.'],
    }],
    openActionItems: [{ id: 'a1', description: '서류 제출', owner: 'beneficiary', dueDate: '2026-07-20', sessionId: 's-2' }],
    flags: [],
    upcomingSchedule: {
      id: 's1',
      scheduledAt: '2026-07-20T05:00:00Z',
      sessionGoals: [{ body: '구직 상담', caseGoalId: 'g1', caseGoalTitle: '주거 안정', caseGoalStatus: 'active' }],
      customQuestions: ['이번 달 지출은 정리됐는지'],
    },
    ...overrides,
  };
}

// D45(ADR-0018) 3영역 — 이 순서가 계약이다. 구 '지난 상담 브리핑'·'오늘 확인할 질문' 카드는
// 영역 ①·②가 대체했고, GAS 아코디언은 D43 보류로 화면에서 빠졌다.
const AREA_TITLES = ['오늘 만나기 전 꼭 기억할 것', '상담 내용 회차별 정리', '내용 불일치'];
// 개인정보 카드는 2026-08-03 Q 지시로 브리핑에서 빠졌다 — 당사자 정보 HERO(이름 클릭)로 이동.
const GRID_TITLES = ['미해결 액션'];

function hero(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.participant-hero-card');
  if (el === null) throw new Error('HERO not found');
  return el;
}

function cardByTitle(container: HTMLElement, title: string): HTMLDetailsElement {
  const card = [...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')].find(
    (details) => details.querySelector('.wire-card-summary')?.textContent?.includes(title) ?? false,
  );
  if (card === undefined) throw new Error(`Card not found: ${title}`);
  return card;
}

describe('BriefingCards — 3영역 골격 (D45 · ADR-0018)', () => {
  it('3영역이 계약 순서로 렌더되고 유지 카드 2종은 그리드에 남는다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const allTitles = [...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')]
      .map((card) => card.querySelector('.wire-card-summary')?.textContent?.trim() ?? '');
    // 3영역이 이 순서로 먼저 온다 — 영역 순서가 바뀌면 '5분 전에 훑는' 동선이 깨진다.
    const areaIndexes = AREA_TITLES.map((title) => allTitles.findIndex((candidate) => candidate.startsWith(title)));
    expect(areaIndexes.every((index) => index >= 0)).toBe(true);
    expect([...areaIndexes].sort((a, b) => a - b)).toEqual(areaIndexes);

    const gridCards = container.querySelectorAll<HTMLDetailsElement>('.briefing-cards-grid > details.briefing-card');
    expect([...gridCards].map((card) => card.querySelector('.wire-card-summary')?.textContent?.trim()))
      .toEqual(GRID_TITLES);
    expect([...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')].every((card) => card.open)).toBe(true);
    expect([...container.querySelectorAll<HTMLDetailsElement>('details[data-source-quotes]')].every((item) => !item.open)).toBe(true);
  });

  it('구 카드와 GAS 표시는 어디에도 없다 (D43 이행 + D45 대체)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('지난 상담 브리핑');
    expect(text).not.toContain('오늘 확인할 질문');
    expect(text).not.toContain('진행 중인 세부 목표');
    expect(container.querySelector('.briefing-gauge')).toBeNull();
    expect(container.querySelector('.briefing-gas-card')).toBeNull();
    // 구 '기본정보' 카드가 되살아나면 같은 값이 화면에 두 번 나온다.
    expect(text).not.toContain('기본정보');
  });

  it('여닫기는 버튼 하나이고 3영역과 그리드 카드를 전부 함께 접는다', () => {
    const { container, getByText } = render(<BriefingCards {...baseProps()} />);
    const allDetails = () => [...container.querySelectorAll<HTMLDetailsElement>('details')];
    expect(container.querySelectorAll('.briefing-toolbar button')).toHaveLength(1);

    fireEvent.click(getByText('전체 접기'));
    expect(allDetails().every((details) => !details.open)).toBe(true);

    fireEvent.click(getByText('전체 열기'));
    expect(allDetails().every((details) => details.open)).toBe(true);
  });

  // CCC-76: 상담 기록 작성 레일의 '자세히 보기'가 #open-actions 앵커로 이 카드에 온다.
  // 기본 펼침 카드라 앵커 진입 시 내용이 바로 보인다.
  it('미해결 액션 카드는 앵커 id open-actions 를 갖는다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '미해결 액션');
    expect(card.id).toBe('open-actions');
    expect(card.open).toBe(true);
  });

  it('영역 ①은 실무자 입력(세션 목표·맞춤형 질문)이 위, AI 제안이 아래다 (D45·R5)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '오늘 만나기 전 꼭 기억할 것');
    const labels = [...card.querySelectorAll('.wire-card-section>h3')].map((node) => node.textContent);
    expect(labels).toEqual(['세션 목표', '맞춤형 질문', 'AI 제안']);
    expect(card.textContent).toContain('구직 상담');
    expect(card.textContent).toContain('이번 달 지출은 정리됐는지');
    expect(card.textContent).toContain('최근 구직 활동은 어땠는지');
  });

  it('AI 제안은 제목·이유·근거 회차 링크 3층이고 링크는 해당 회차 기록 앵커로 간다 (CCC-39)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const item = container.querySelector('.wire-item');
    if (item === null) throw new Error('suggestion item not found');
    expect(item.querySelector('.wire-item-title')?.textContent).toBe('최근 구직 활동은 어땠는지');
    expect(item.querySelector('.wire-item-desc')?.textContent).toBe('지난 회차에서 면접 결과를 기다리고 있었다');
    const link = item.querySelector('.wire-item-action a');
    expect(link?.getAttribute('href')).toBe(`${baseProps().recordsHref}#record-s-2`);
    expect(link?.textContent).toContain('근거 회차 보기');
    expect(link?.textContent).toContain('2026년 7월 15일');
  });

  it('AI 제안 근거 인용을 그 자리에서 접어 두고 출처 회차로 연결한다 (D73)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const item = container.querySelector('.wire-item');
    const disclosure = item?.parentElement?.querySelector('details[data-source-quotes]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('면접 결과는 다음 주에 나와요.');
    expect(disclosure?.querySelector('a')?.getAttribute('href'))
      .toBe(`${baseProps().recordsHref}#record-s-2`);
  });

  it('AI 제안은 최대 3개만 렌더되고, 구(v1) 저장분(reason=null)은 이유 줄을 생략한다', () => {
    const suggestion = (n: number) => ({
      title: `제안 ${n}`,
      reason: n === 1 ? null : `이유 ${n}`,
      sessionId: `s-${n}`,
      heldAt: null,
      sourceQuotes: [],
    });
    const { container } = render(<BriefingCards {...baseProps({
      aiSuggestions: [suggestion(1), suggestion(2), suggestion(3), suggestion(4)],
    })} />);
    const items = container.querySelectorAll('.wire-item');
    expect(items).toHaveLength(3);
    // reason=null(첫 항목)은 이유 줄 없이 제목·링크만 남는다.
    expect(items[0]?.querySelector('.wire-item-desc')).toBeNull();
    expect(items[1]?.querySelector('.wire-item-desc')?.textContent).toBe('이유 2');
    // heldAt 이 없으면 링크 라벨에 날짜 괄호가 붙지 않는다.
    expect(items[0]?.querySelector('a')?.textContent).toBe('근거 회차 보기');
  });

  it('공식 기록이 없어 제안이 비면 빈 상태 안내를 표시한다 (CCC-39 AC)', () => {
    const { container } = render(<BriefingCards {...baseProps({ aiSuggestions: [] })} />);
    const card = cardByTitle(container, '오늘 만나기 전 꼭 기억할 것');
    expect(card.textContent).toContain('승인된 상담 기록이 쌓이면 확인할 것을 제안합니다');
    expect(card.querySelector('.wire-item')).toBeNull();
  });

  it('영역 ②는 회차마다 상담일·유형·한 줄을 표시하고, 수기 발췌에는 수기 배지가 붙는다 (CCC-38·D5)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '상담 내용 회차별 정리');
    const rows = [...card.querySelectorAll('li')].map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2026년 7월 15일');
    expect(rows[0]).toContain('기본 상담');
    expect(rows[0]).toContain('구직 활동 근황');
    expect(rows[0]).toContain('수기');
    expect(rows[1]).toContain('2026년 7월 1일');
    expect(rows[1]).toContain('인테이크');
    expect(rows[1]).toContain('채무 현황과 정서적 어려움 확인');
    const typeBadges = [...card.querySelectorAll('.briefing-session-kind .wire-badge')];
    expect(typeBadges.map((badge) => badge.getAttribute('data-tone'))).toEqual(['mint', 'lavender']);
  });

  it('승인된 AI 한 줄이 있는 회차는 그 한 줄을 싣고 수기 배지를 붙이지 않는다 (CCC-38·R2)', () => {
    const { container } = render(<BriefingCards {...baseProps({
      sessionRows: [{
        sessionId: 's-4',
        heldAt: '2026-07-18T05:00:00Z',
        kind: 'regular',
        aiOneLiner: '구직 지원금 신청을 완료하고 다음 면접 일정을 잡았다.',
        memoExcerpt: '수기 발췌는 뒤로 밀린다',
      }],
    })} />);
    const card = cardByTitle(container, '상담 내용 회차별 정리');
    const row = card.querySelector('li')?.textContent ?? '';
    expect(row).toContain('구직 지원금 신청을 완료하고 다음 면접 일정을 잡았다.');
    // 승인된 한 줄이 있으면 수기 폴백(발췌·배지)은 나오지 않는다.
    expect(row).not.toContain('수기');
  });

  it('영역 ②의 수기 메모 없는 회차는 폴백 문구를, 회차가 없으면 빈 상태를 표시한다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      sessionRows: [{ sessionId: 's-3', heldAt: '2026-07-10T05:00:00Z', kind: 'regular', aiOneLiner: null, memoExcerpt: null }],
    })} />);
    expect(cardByTitle(container, '상담 내용 회차별 정리').textContent).toContain('수기 메모 없음');

    cleanup();
    const empty = render(<BriefingCards {...baseProps({ sessionRows: [] })} />);
    expect(cardByTitle(empty.container, '상담 내용 회차별 정리').textContent).toContain('표시할 상담 회차가 없습니다');
  });

  it('승인 대기 배지는 영역 ② 머리에 앉고 0건이면 없다 (D5 — D45 가 자리만 옮김)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const summary = cardByTitle(container, '상담 내용 회차별 정리').querySelector('.wire-card-summary');
    expect(summary?.textContent).toContain('승인 대기 2건');

    cleanup();
    const none = render(<BriefingCards {...baseProps({ pendingApprovalCount: 0 })} />);
    expect(none.container.textContent).not.toContain('승인 대기');
  });

  it('승인 대기 fixture session id만 검수 화면 링크로 연결하고 초안 본문은 받지 않는다', () => {
    const { container } = render(<BriefingCards {...baseProps({ pendingReviewSessionIds: ['s-2'] })} />);
    const card = cardByTitle(container, '상담 내용 회차별 정리');
    const link = within(card).getByRole('link', {
      name: '2026년 7월 15일 기본 상담 AI 초안 검토',
    });
    expect(link.getAttribute('href')).toBe(`${baseProps().recordsHref}/s-2/review`);
    const pendingSection = within(card).getByTestId('pending-fixture-reviews');
    expect(pendingSection.textContent).toContain('2026년 7월 15일');
    expect(pendingSection.textContent).toContain('기본 상담');
    expect(card.textContent).not.toContain('fixture summary sentinel');

    cleanup();
    const none = render(<BriefingCards {...baseProps({ pendingReviewSessionIds: [] })} />);
    expect(none.container.querySelector('[data-testid="pending-fixture-reviews"]')).toBeNull();
  });

  it('bounded 회차 목록 밖의 fixture도 검수 링크를 보존한다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      pendingReviewSessionIds: ['fixture/session older'],
      sessionRows: [],
    })} />);
    const card = cardByTitle(container, '상담 내용 회차별 정리');
    const link = within(card).getByRole('link', { name: /AI 초안 검토/ });
    expect(link.getAttribute('href')).toBe(
      `${baseProps().recordsHref}/fixture%2Fsession%20older/review`,
    );
    expect(card.textContent).toContain('상담일 확인 필요');
    expect(card.textContent).toContain('상담 유형 확인 필요');
  });

  it('미해결 액션은 action_items.session_id 출처 회차 링크를 표시한다 (D73)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '미해결 액션');
    const link = within(card).getByRole('link', { name: '출처 회차 보기' });
    expect(link.getAttribute('href')).toBe(`${baseProps().recordsHref}#record-s-2`);
  });

  it('영역 ③은 불일치가 없으면 빈 상태를 표시한다 (CCC-43)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '내용 불일치');
    expect(card.textContent).toContain('검출된 불일치가 없습니다');
    expect(card.querySelector('.wire-badge')).toBeNull();
  });

  it('영역 ③은 양쪽 인용과 회차 링크를 나란히 놓고 판단 표현을 쓰지 않는다 (CCC-43 · R5)', () => {
    const recordsHref = baseProps().recordsHref;
    const { container } = render(<BriefingCards {...baseProps({
      discrepancies: [
        {
          id: 'd-1',
          kind: 'cross_session',
          left: { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', quote: '채무는 은행 대출뿐이라고 했다' },
          right: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '지인에게 빌린 돈 상환이 밀려 있다' },
          detectedAt: '2026-07-15T06:00:00Z',
          resolution: null,
        },
        {
          id: 'd-2',
          kind: 'within_session',
          left: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '이번 달 지출을 정리했다' },
          right: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '지출 내역은 아직 정리 전이다' },
          detectedAt: '2026-07-15T06:00:00Z',
          resolution: null,
        },
      ],
    })} />);
    const card = cardByTitle(container, '내용 불일치');
    // 건수 배지 — 영역 ② '승인 대기'와 같은 자리 문법.
    expect(card.querySelector('.wire-card-summary')?.textContent).toContain('2건');
    // 유형 라벨 2종.
    expect(card.textContent).toContain('회차 간 불일치');
    expect(card.textContent).toContain('회차 내 모순');
    // 양쪽 원문 인용이 그대로 나온다.
    expect(card.textContent).toContain('채무는 은행 대출뿐이라고 했다');
    expect(card.textContent).toContain('지인에게 빌린 돈 상환이 밀려 있다');
    // 회차 링크 — 상세 기록의 해당 회차 앵커로 간다.
    const links = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(`${recordsHref}#record-s-1`);
    expect(links).toContain(`${recordsHref}#record-s-2`);
    // 각 인용 옆에 상담일이 붙는다.
    expect(card.textContent).toContain('2026년 7월 1일 회차');
    expect(card.textContent).toContain('2026년 7월 15일 회차');
    // AI 는 판단하지 않는다(R5) — 판단 어휘가 화면에 나오면 계약 위반이다.
    for (const banned of ['오류입니다', '틀렸', '맞습니다', '정확', '거짓']) {
      expect(card.textContent).not.toContain(banned);
    }
  });

  it('처리 3종 버튼은 서버 액션이 있을 때만 그려지고 항목 ID를 함께 보낸다 (CCC-42)', () => {
    const unresolved = {
      id: 'd-1' as const,
      kind: 'cross_session' as const,
      left: { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', quote: '채무는 은행 대출뿐이라고 했다' },
      right: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '지인에게 빌린 돈 상환이 밀려 있다' },
      detectedAt: '2026-07-15T06:00:00Z',
      resolution: null,
    };
    // 액션이 없으면(=권한·환경이 갖춰지지 않은 렌더) 버튼을 그리지 않는다.
    const withoutAction = render(<BriefingCards {...baseProps({ discrepancies: [unresolved] })} />);
    expect(cardByTitle(withoutAction.container, '내용 불일치').querySelector('form')).toBeNull();

    const { container } = render(<BriefingCards {...baseProps({
      discrepancies: [unresolved],
      discrepancyAction: async () => {},
    })} />);
    const form = cardByTitle(container, '내용 불일치').querySelector('form');
    if (form === null) throw new Error('resolution form not found');
    // 어느 항목을 처리하는지 폼이 스스로 안다 — 화면 상태에 기대지 않는다.
    expect(form.querySelector<HTMLInputElement>('input[name="discrepancyId"]')?.value).toBe('d-1');
    expect(form.querySelector<HTMLInputElement>('input[name="supportCaseId"]')?.value)
      .toBe(baseProps().supportCaseId);
    // 처리 3종이 그대로, ADR-0018 순서로 나온다.
    expect([...form.querySelectorAll('button')].map((button) => [button.value, button.textContent]))
      .toEqual([
        ['situation_changed', '상황 변경'],
        ['record_error', '기록 오류'],
        ['confirmed', '확인 완료'],
      ]);
  });

  it('처리된 항목은 삭제되지 않고 접힌 이력으로 내려가며 배지는 미처리만 센다 (CCC-42)', () => {
    const { container } = render(<BriefingCards {...baseProps({
      discrepancyAction: async () => {},
      discrepancies: [
        {
          id: 'd-1',
          kind: 'cross_session',
          left: { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', quote: '채무는 은행 대출뿐이라고 했다' },
          right: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '지인에게 빌린 돈 상환이 밀려 있다' },
          detectedAt: '2026-07-15T06:00:00Z',
          resolution: null,
        },
        {
          id: 'd-2',
          kind: 'within_session',
          left: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '이번 달 지출을 정리했다' },
          right: { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', quote: '지출 내역은 아직 정리 전이다' },
          detectedAt: '2026-07-15T06:00:00Z',
          resolution: { status: 'situation_changed', resolvedAt: '2026-07-16T02:00:00Z' },
        },
      ],
    })} />);
    const card = cardByTitle(container, '내용 불일치');
    // 배지가 이력까지 세면 '남은 일'을 알려주지 못한다 — 미처리 1건만.
    expect(card.querySelector('.wire-card-summary')?.textContent).toContain('1건');
    const history = card.querySelector('.briefing-history');
    if (history === null) throw new Error('history not found');
    expect(history.querySelector('summary')?.textContent).toContain('처리된 항목 1건');
    // 접혀 있을 뿐 지워지지 않는다 — 인용도 처리 상태도 이력 안에 남는다.
    expect(history.textContent).toContain('이번 달 지출을 정리했다');
    expect(history.textContent).toContain('상황 변경으로 처리됨');
    // 미처리 항목은 이력 밖에 있다.
    expect(history.textContent).not.toContain('채무는 은행 대출뿐이라고 했다');
    // 처리 종류는 다시 바꿀 수 있다(Q 결정) — 이력에도 버튼이 살아 있고 현재 상태만 비활성.
    const historyButtons = [...history.querySelectorAll('button')];
    expect(historyButtons).toHaveLength(3);
    expect(historyButtons.find((button) => button.value === 'situation_changed')?.disabled).toBe(true);
    expect(historyButtons.find((button) => button.value === 'record_error')?.disabled).toBe(false);
  });
});

describe('BriefingCards — HERO·리스크 배너·출구 (유지 계약 D37·D38·D9)', () => {
  it('HERO 우상단은 행동 3개(당사자 정보 → 전체 상담 기록 → 상담 기록)다 (2026-08-06 Q — 구 맨 아래 링크 대체)', () => {
    const { container, queryByText } = render(<BriefingCards {...baseProps()} />);
    const actions = hero(container).querySelector('.page-actions');
    expect([...(actions?.querySelectorAll('a') ?? [])].map((a) => a.textContent))
      .toEqual(['당사자 정보', '전체 상담 기록', '상담 기록']);
    // 이 화면만 D38 상한을 3개로 넓혔다(2026-08-06 Q). 프라이머리는 여전히 오른쪽 끝 1개다.
    expect(actions?.children).toHaveLength(3);

    const more = container.querySelector('.briefing-more');
    expect(more?.getAttribute('href')).toBe(baseProps().recordsHref);
    expect(more?.textContent).toContain('전체 상담 기록');
    // 구 맨 아래 링크가 되살아나면 이 테스트가 잡는다.
    expect(queryByText('자세한 상담 기록 보기')).toBeNull();
    expect(queryByText('← 목록으로')).toBeNull();
    expect(queryByText('전체 사업 보기')).toBeNull();
  });

  it('HERO 는 카드이고 이름·상태 태그·메타 한 줄을 담는다 (§4-5)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = hero(container);
    // 화면의 모든 글자는 카드 안에 있다 — HERO 도 카드다.
    expect(card.className).toContain('surface-card');
    expect(card.querySelector('.participant-name-group')).not.toBeNull();
    // 상태 태그는 §5 컨트롤 부품(2026-08-05 — 트랙 C 의 .is-stage 폐지와 같은 결론).
    // 2026-08-09 Q: 상태 태그는 화면 이름이 아니라 **최신 회차의 유형·회차**다.
    // 픽스처는 최신이 기본 상담이고 회차가 둘이다.
    expect(card.querySelector('.wire-status-tag')?.textContent).toBe('기본 상담 2회');
    const meta = card.querySelector('.participant-hero-meta')?.textContent ?? '';
    expect(meta).toContain('마이크로크레딧');
    expect(meta).toContain('대면');
  });

  it('확인된 리스크 플래그가 있으면 경고 배너를 표시한다 (D9)', () => {
    const { container } = render(<BriefingCards {...baseProps({
      flags: [{ id: 'f1', flagType: 'crisis_utterance', source: 'counselor', reviewStatus: 'confirmed', sessionId: 's-2', quote: null }],
    })} />);
    const banner = container.querySelector('.risk-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('위기 발언');
  });

  it('다가오는 일정이 없으면 HERO 메타는 예정된 상담 없음으로 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps({ upcomingSchedule: null })} />);
    expect(hero(container).textContent).toContain('예정된 상담 없음');
  });
});

describe('BriefingCards — 실명 직표시와 폴백 (D24 · ADR-0005)', () => {
  it('담당 실무자에게는 HERO 에 실명을 직표시하고, 개인정보 카드는 더 이상 없다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    // 구 '기본정보' 카드가 하던 이름 표시는 HERO 가 이어받았다.
    expect(within(hero(container)).getByText('홍길동')).toBeTruthy();
    // 개인정보 카드는 당사자 정보 HERO(이름 클릭 접힘)로 이동했다(2026-08-03 Q).
    // 연락처도 브리핑에는 더 이상 나오지 않는다.
    const cardTitles = [...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')]
      .map((card) => card.querySelector('.wire-card-summary')?.textContent?.trim() ?? '');
    expect(cardTitles.some((title) => title.includes('개인정보'))).toBe(false);
    expect(container.textContent).not.toContain('010-1234-5678');
  });

  it('이름이 없으면 HERO 이름은 가명 ID 그대로 폴백한다 (D31 — 한글 표시명 폐기)', () => {
    // D31 이 한글 표시명("제비 003")을 폐기했다. 가명 ID 는 기계 식별자이므로 화면에도
    // 슬러그 그대로 나온다 — 한글로 바꿔 보여주면 사람용 이름처럼 읽힌다.
    const { container } = render(<BriefingCards {...baseProps({ participant: { name: null, phone: '010-0000-0000' } })} />);
    const card = hero(container);
    expect(card.textContent).toContain('swallow-003');
    expect(card.textContent).not.toContain('제비');
  });

});

// 전체 목표 카드 셀렉터 — 전체 목표·활성 세부 목표(D62 §8) 테스트가 함께 쓴다.
const goalCard = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('.briefing-goal');
  if (el === null) throw new Error('overall goal card not found');
  return el;
};

describe('BriefingCards — 전체 목표 카드 (D45 · CCC-41)', () => {
  it('리스크 배너 아래·아코디언 위에 서고, 비어 있으면 설정 전으로 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = goalCard(container);
    expect(card.textContent).toContain('전체 목표');
    expect(card.textContent).toContain('설정 전');
    // 위치 계약(D45 표 3행): 아코디언 영역보다 앞이다.
    const accordions = container.querySelector('.briefing-accordions');
    expect(accordions).not.toBeNull();
    expect(card.compareDocumentPosition(accordions as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 점수·게이지는 붙지 않는다(D43).
    expect(card.querySelector('.briefing-gauge')).toBeNull();
  });

  it('값이 있으면 한 줄로 보여주고 담당 실무자에게는 수정 버튼이 뜬다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      overallGoal: '안정적인 주거 확보와 채무 상환 계획 실행',
      overallGoalAction: async () => {},
    })} />);
    const card = goalCard(container);
    expect(card.textContent).toContain('안정적인 주거 확보와 채무 상환 계획 실행');
    expect(card.textContent).not.toContain('설정 전');
    expect(within(card).getByText('수정')).toBeTruthy();
  });

  it('수정을 누르면 그 자리에서 입력 폼이 열리고 취소로 닫힌다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      overallGoal: '기존 목표',
      overallGoalAction: async () => {},
    })} />);
    const card = goalCard(container);
    fireEvent.click(within(card).getByText('수정'));
    const input = card.querySelector<HTMLInputElement>('input[name="overallGoal"]');
    expect(input).not.toBeNull();
    expect(input?.defaultValue).toBe('기존 목표');
    // 게이트웨이 상한과 같은 200자.
    expect(input?.maxLength).toBe(200);
    // hidden 값이 폼에 실린다 — 게이트웨이 권한 판정의 입력이다.
    expect(card.querySelector<HTMLInputElement>('input[name="supportCaseId"]')?.value)
      .toBe('11111111-1111-4111-8111-111111111111');
    fireEvent.click(within(card).getByText('취소'));
    expect(card.querySelector('input[name="overallGoal"]')).toBeNull();
  });

  it('비어 있으면 버튼 라벨은 입력이고, 비담당(canEdit=false)에게는 편집 UI 가 없다', () => {
    const editable = render(<BriefingCards {...baseProps({ overallGoalAction: async () => {} })} />);
    expect(within(goalCard(editable.container)).getByText('입력')).toBeTruthy();
    cleanup();
    const readOnly = render(<BriefingCards {...baseProps({
      canEditOverallGoal: false,
      overallGoal: '기존 목표',
      overallGoalAction: async () => {},
    })} />);
    const card = goalCard(readOnly.container);
    expect(card.textContent).toContain('기존 목표');
    expect(card.querySelector('button')).toBeNull();
  });

  it('저장 실패 notice 가 오면 카드 안에 오류 한 줄을 알린다', () => {
    const { container } = render(<BriefingCards {...baseProps({ overallGoalError: true })} />);
    const alert = goalCard(container).querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('저장하지 못했습니다');
  });
});

describe('활성 세부 목표 (D62 §8 · CCC-69)', () => {
  const threeGoals = [
    { id: 'g1', title: '월 지출 내역을 매주 기록한다' },
    { id: 'g2', title: '이력서를 월 2회 제출한다' },
    { id: 'g3', title: '주거 지원 신청 서류를 준비한다' },
  ];

  it('전체 목표 카드 안에 기본 펼침 한 줄씩 선다 — 접힘(details) 밖이다', () => {
    const { container } = render(<BriefingCards {...baseProps({ activeGoals: threeGoals })} />);
    const card = goalCard(container);
    const rows = [...card.querySelectorAll('.briefing-subgoal-row')];
    expect(rows.map((row) => row.textContent)).toEqual(threeGoals.map((goal) => goal.title));
    // 눌러야 보이는 접힘 금지(ADR-0032 §8) — 줄이 details 안에 있으면 위반이다.
    for (const row of rows) expect(row.closest('details')).toBeNull();
    // 말줄임 규칙: 회차 행과 같은 한 줄 압축(.wire-fade-clip).
    for (const row of rows) expect(row.classList.contains('wire-fade-clip')).toBe(true);
  });

  it('세부 목표가 없으면 구획 자체가 없다 — 빈 라벨을 세우지 않는다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    expect(goalCard(container).textContent).not.toContain('세부 목표');
    expect(goalCard(container).querySelector('.briefing-subgoal-rows')).toBeNull();
  });
});

describe('세션 목표의 부모 세부 목표 병기 (D62 §5 · CCC-69)', () => {
  it('부모가 활성이면 이름만 병기하고 흐림 표시가 없다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const parent = container.querySelector('.briefing-parent-goal');
    expect(parent?.textContent).toContain('세부 목표: 주거 안정');
    expect(parent?.classList.contains('is-closed')).toBe(false);
    // 구 라벨은 사라졌다 — D62 위계 용어는 '세부 목표'다.
    expect(container.textContent).not.toContain('케이스 목표');
  });

  it('부모가 닫혔으면 (종료) 문구와 흐림 클래스로 병기한다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      upcomingSchedule: {
        id: 's1',
        scheduledAt: '2026-07-20T05:00:00Z',
        sessionGoals: [{ body: '구직 상담', caseGoalId: 'g1', caseGoalTitle: '주거 안정', caseGoalStatus: 'closed' }],
        customQuestions: [],
      },
    })} />);
    const parent = container.querySelector('.briefing-parent-goal');
    expect(parent?.textContent).toContain('세부 목표(종료): 주거 안정');
    expect(parent?.classList.contains('is-closed')).toBe(true);
  });
});

describe('전체 목표 미설정 AI 안내 (D62 §7 · CCC-69)', () => {
  const HINT_KEY = 'ccc:briefing-goal-hint-closed:v1:11111111-1111-4111-8111-111111111111';
  afterEach(() => window.localStorage.clear());

  it('전체 목표가 없으면 AI 제안 구획에 안내 한 줄이 뜬다 — 제안은 차단되지 않는다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const hint = container.querySelector('[data-testid="briefing-ai-goal-hint"]');
    expect(hint?.textContent).toContain('전체 목표를 설정하면 AI 제안이 더 정확해집니다');
    // 제안 자체는 그대로 나온다(재료이지 게이트가 아니다).
    expect(container.querySelector('.wire-item')).not.toBeNull();
  });

  it('전체 목표가 있으면 안내가 없다', () => {
    const { container } = render(<BriefingCards {...baseProps({ overallGoal: '주거 안정' })} />);
    expect(container.querySelector('[data-testid="briefing-ai-goal-hint"]')).toBeNull();
  });

  it('닫으면 사라지고 케이스 단위로 저장돼 다시 뜨지 않는다', () => {
    const first = render(<BriefingCards {...baseProps()} />);
    const hint = first.container.querySelector('[data-testid="briefing-ai-goal-hint"]');
    expect(hint).not.toBeNull();
    fireEvent.click(within(hint as HTMLElement).getByText('닫기'));
    expect(first.container.querySelector('[data-testid="briefing-ai-goal-hint"]')).toBeNull();
    expect(window.localStorage.getItem(HINT_KEY)).not.toBeNull();
    cleanup();
    // 같은 케이스를 다시 열어도 닫힘이 유지된다.
    const again = render(<BriefingCards {...baseProps()} />);
    expect(again.container.querySelector('[data-testid="briefing-ai-goal-hint"]')).toBeNull();
    cleanup();
    // 다른 케이스는 케이스 단위 저장이라 다시 뜬다.
    const other = render(<BriefingCards {...baseProps({ supportCaseId: '22222222-2222-4222-8222-222222222222' })} />);
    expect(other.container.querySelector('[data-testid="briefing-ai-goal-hint"]')).not.toBeNull();
  });
});
