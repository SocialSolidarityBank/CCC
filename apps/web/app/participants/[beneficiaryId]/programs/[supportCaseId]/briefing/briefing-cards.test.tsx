import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { BriefingCards, type BriefingCardsProps } from './briefing-cards';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다 — 렌더 누적을 막기 위해 명시 정리.
afterEach(cleanup);

function baseProps(overrides: Partial<BriefingCardsProps> = {}): BriefingCardsProps {
  return {
    beneficiaryId: 'swallow-003',
    participantHref: '/participants/swallow-003',
    recordsHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records',
    recordNewHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records/new',
    programLabel: '마이크로크레딧 씬파일러 금융지원·멘토링',
    participant: { name: '홍길동', phone: '010-1234-5678' },
    gasTrend: [
      { goalId: 'g1', goalTitle: '주거 안정', status: 'active', closedAt: null, points: [
        { heldAt: '2026-07-01T00:00:00Z', score: -1 },
        { heldAt: '2026-07-08T00:00:00Z', score: 1 },
      ] },
    ],
    lastSessionSummary: { source: 'ai', text: '지난 상담 요약입니다.', pendingApprovalCount: 2 },
    questions: ['최근 구직 활동은 어땠는지'],
    openActionItems: [{ id: 'a1', description: '서류 제출', owner: 'beneficiary', dueDate: '2026-07-20' }],
    flags: [],
    upcomingSchedule: {
      id: 's1',
      scheduledAt: '2026-07-20T05:00:00Z',
      sessionGoals: [{ body: '구직 상담', caseGoalId: 'g1', caseGoalTitle: '주거 안정' }],
      customQuestions: ['이번 달 지출은 정리됐는지'],
    },
    ...overrides,
  };
}

// 2026-07-27 시안(artifacts/layout-frame-v1/briefing.html) 기준으로 구성이 바뀌었다.
// **구 '기본정보' 카드는 없다** — 시간·이름은 HERO 로, 연락처는 개인정보 카드로, 전체 참여사업
// 링크는 HERO 우상단 '당사자 정보'로 갔다. 그리드에 남는 것은 아코디언 4종이다.
const CARD_TITLES = ['지난 상담 브리핑', '오늘 확인할 질문', '미해결 액션', '개인정보'];

// GAS 는 전폭 **아코디언** 하나다 — 2열 카드(폭 510) 안에서는 조밀 그리드 3열이 안 나오고
// 계약이 2열을 금지한다(DESIGN.md §4-2).
function gasSection(container: HTMLElement): HTMLDetailsElement {
  const section = container.querySelector<HTMLDetailsElement>('details.briefing-gas-card');
  if (section === null) throw new Error('GAS accordion not found');
  return section;
}

function hero(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.briefing-hero');
  if (el === null) throw new Error('HERO not found');
  return el;
}

function cardByTitle(container: HTMLElement, title: string): HTMLDetailsElement {
  const card = [...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')].find(
    (details) => details.querySelector('.briefing-card-summary')?.textContent?.includes(title) ?? false,
  );
  if (card === undefined) throw new Error(`Card not found: ${title}`);
  return card;
}

describe('BriefingCards — HERO + GAS 아코디언 + 자료 4종 (시안 layout-frame-v1)', () => {
  it('아코디언 4종 + GAS 전폭 아코디언을 렌더하고 기본은 모두 펼침', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const gridCards = container.querySelectorAll<HTMLDetailsElement>('.briefing-cards-grid > details.briefing-card');
    expect(gridCards).toHaveLength(4);
    const titles = [...gridCards].map((card) => card.querySelector('.briefing-card-summary')?.textContent?.trim());
    for (const expected of CARD_TITLES) {
      expect(titles.some((title) => title?.startsWith(expected))).toBe(true);
    }
    // 구 '기본정보' 카드가 되살아나면 같은 값이 화면에 두 번 나온다.
    expect(titles.some((title) => title?.startsWith('기본정보'))).toBe(false);
    expect(gasSection(container).querySelector('.briefing-card-summary')?.textContent)
      .toContain('진행 중인 세부 목표');
    expect([...gridCards].every((card) => card.open)).toBe(true);
  });

  it('여닫기는 버튼 하나이고 GAS 아코디언까지 함께 접는다', () => {
    // 버튼이 둘이면 지금 상태를 버튼이 안 알려준다. 그리고 GAS 는 카드 그리드 **밖**이라
    // 여닫기 범위를 그리드에만 걸면 GAS 만 펼쳐진 채로 남는다 — 실제로 그렇게 짜기 쉬운 자리다.
    const { container, getByText } = render(<BriefingCards {...baseProps()} />);
    const allDetails = () => [...container.querySelectorAll<HTMLDetailsElement>('details')];
    expect(container.querySelectorAll('.briefing-toolbar button')).toHaveLength(1);

    fireEvent.click(getByText('전체 접기'));
    expect(allDetails().every((details) => !details.open)).toBe(true);
    expect(gasSection(container).open).toBe(false);

    fireEvent.click(getByText('전체 열기'));
    expect(allDetails().every((details) => details.open)).toBe(true);
  });

  it('HERO 우상단은 행동 2개(당사자 정보 → 상담 시작)이고, 상담 기록은 페이지 맨 아래로 내려갔다 (D37)', () => {
    // D35 는 이동 버튼 2개를 이름 바로 아래 뒀는데 D37 이 그 배치만 고쳤다:
    // '당사자 정보'는 HERO 우상단 세컨더리, '상담 기록'은 '자세한 상담 기록 보기'로 맨 아래.
    const { container, queryByText } = render(<BriefingCards {...baseProps()} />);
    const actions = hero(container).querySelector('.page-actions');
    expect([...(actions?.querySelectorAll('a') ?? [])].map((a) => a.textContent))
      .toEqual(['당사자 정보', '상담 시작']);
    // 우상단은 최대 2개다(§4-5). 늘어나면 사이드바=장소 / 우상단=행동 축이 흐려진다.
    expect(actions?.children).toHaveLength(2);

    const more = container.querySelector('.briefing-more');
    expect(more?.getAttribute('href')).toBe(baseProps().recordsHref);
    expect(more?.textContent).toContain('자세한 상담 기록 보기');
    // 맨 아래여야 한다 — 위 브리핑을 다 읽은 다음의 걸음이다.
    expect(container.querySelector('.briefing-page')?.lastElementChild).toBe(more);

    // 되살아나면 이 테스트가 잡는다.
    expect(queryByText('← 목록으로')).toBeNull();
    expect(queryByText('전체 사업 보기')).toBeNull();
  });

  it('HERO 는 카드이고 이름·상태 태그·메타 한 줄을 담는다 (§4-5)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = hero(container);
    // 화면의 모든 글자는 카드 안에 있다 — HERO 도 카드다.
    expect(card.className).toContain('surface-card');
    expect(card.querySelector('.participant-name-group')).not.toBeNull();
    expect(card.querySelector('.briefing-badge.is-stage')?.textContent).toBe('상담 준비');
    const meta = card.querySelector('.briefing-hero-meta')?.textContent ?? '';
    expect(meta).toContain('마이크로크레딧');
    expect(meta).toContain('대면');
  });

  it('확인된 리스크 플래그가 있으면 경고 배너를 표시한다 (D9)', () => {
    const { container } = render(<BriefingCards {...baseProps({
      flags: [{ id: 'f1', flagType: 'crisis_utterance', source: 'counselor', reviewStatus: 'confirmed' }],
    })} />);
    const banner = container.querySelector('.risk-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('위기 발언');
  });

  it('오늘 확인할 질문 카드는 세션 목표·맞춤형 질문·AI 질문을 병기한다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '오늘 확인할 질문');
    const labels = [...card.querySelectorAll('.briefing-qlabel')].map((node) => node.textContent);
    expect(labels).toEqual(['세션 목표', '맞춤형 질문', 'AI 질문']);
    expect(card.textContent).toContain('구직 상담');
    expect(card.textContent).toContain('이번 달 지출은 정리됐는지');
    expect(card.textContent).toContain('최근 구직 활동은 어땠는지');
  });
});

describe('BriefingCards — 실명 직표시와 폴백 (D24 · ADR-0005)', () => {
  it('담당 실무자에게는 HERO·개인정보 카드에 실명과 연락처를 직표시한다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    // 구 '기본정보' 카드가 하던 이름 표시는 HERO 가 이어받았다.
    expect(within(hero(container)).getByText('홍길동')).toBeTruthy();
    const privacy = cardByTitle(container, '개인정보');
    expect(privacy.textContent).toContain('홍길동');
    expect(privacy.textContent).toContain('010-1234-5678');
    expect(privacy.textContent).not.toContain('권한 없음');
  });

  it('이름이 없으면 HERO 이름은 가명 ID 그대로 폴백한다 (D31 — 한글 표시명 폐기)', () => {
    // D31 이 한글 표시명("제비 003")을 폐기했다. 가명 ID 는 기계 식별자이므로 화면에도
    // 슬러그 그대로 나온다 — 한글로 바꿔 보여주면 사람용 이름처럼 읽힌다.
    const { container } = render(<BriefingCards {...baseProps({ participant: { name: null, phone: '010-0000-0000' } })} />);
    const card = hero(container);
    expect(card.textContent).toContain('swallow-003');
    expect(card.textContent).not.toContain('제비');
  });

  it('실명·연락처가 모두 없으면 개인정보 카드는 권한 없음으로 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps({ participant: { name: null, phone: null } })} />);
    const privacy = cardByTitle(container, '개인정보');
    expect(privacy.textContent).toContain('권한 없음');
    expect(privacy.querySelector('.wire-field-row')).toBeNull();
  });

  it('다가오는 일정이 없으면 HERO 메타는 예정된 상담 없음으로 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps({ upcomingSchedule: null })} />);
    expect(hero(container).textContent).toContain('예정된 상담 없음');
  });

  it('GAS 카드는 케이스 목표별 최신 점수를 부호와 함께 크게 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const gas = gasSection(container);
    expect(gas.querySelector('.briefing-gas-score')?.textContent).toBe('+1');
    expect(gas.textContent).toContain('주거 안정');
  });

  it('게이지는 원형이고 채움 비율이 −2~+2 를 0~100% 로 편 값이다 (DESIGN.md §5)', () => {
    // 점수의 좋고 나쁨을 색으로 알리지 않으므로(D6·R4) 계열은 점수가 아니라 목표 순서가 정한다.
    const { container } = render(<BriefingCards {...baseProps({
      gasTrend: [
        { goalId: 'g1', goalTitle: '가', status: 'active', closedAt: null, points: [{ heldAt: '2026-07-01T00:00:00Z', score: -2 }] },
        { goalId: 'g2', goalTitle: '나', status: 'active', closedAt: null, points: [{ heldAt: '2026-07-01T00:00:00Z', score: 0 }] },
        { goalId: 'g3', goalTitle: '다', status: 'active', closedAt: null, points: [{ heldAt: '2026-07-01T00:00:00Z', score: 2 }] },
      ],
    })} />);
    const gauges = [...container.querySelectorAll<HTMLElement>('.briefing-gauge')];
    expect(gauges.map((g) => g.style.getPropertyValue('--gauge-pct'))).toEqual(['0%', '50%', '100%']);
    expect([...container.querySelectorAll('.briefing-gas-goal')].map((g) => g.getAttribute('data-series')))
      .toEqual(['blue', 'mint', 'lavender']);
    // 숫자는 aria-hidden 이고 읽을 이름은 게이지가 갖는다 — 안 그러면 "+2"만 읽힌다.
    expect(gauges[2]?.getAttribute('aria-label')).toContain('최신 GAS 점수 +2점');
  });

  it('진행 중이 4개 이상이면 3개만 세우고 나머지는 외 N개로 접는다 (D33)', () => {
    const goal = (id: string) => ({
      goalId: id, goalTitle: id, status: 'active' as const, closedAt: null,
      points: [{ heldAt: '2026-07-01T00:00:00Z', score: 1 }],
    });
    const { container } = render(<BriefingCards {...baseProps({ gasTrend: [goal('a'), goal('b'), goal('c'), goal('d'), goal('e')] })} />);
    expect(container.querySelectorAll('.briefing-gauge')).toHaveLength(3);
    expect(gasSection(container).querySelector('.briefing-card-summary')?.textContent).toContain('외 2개');
  });

  it('종료된 목표는 GAS 카드에 종료 칩과 종료일을 함께 표기한다 (#17 잔여, D12)', () => {
    const { container } = render(<BriefingCards {...baseProps({
      gasTrend: [
        { goalId: 'g1', goalTitle: '주거 안정', status: 'closed', closedAt: '2026-07-10T00:00:00Z', points: [
          { heldAt: '2026-07-01T00:00:00Z', score: -1 },
        ] },
      ],
    })} />);
    const gas = gasSection(container);
    expect(gas.querySelector('.briefing-gas-goal-closed')?.textContent).toBe('종료');
    expect(gas.textContent).toContain('2026-07-10');
  });
});
