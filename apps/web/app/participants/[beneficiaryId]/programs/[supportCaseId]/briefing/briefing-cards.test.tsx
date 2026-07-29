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
    canEditOverallGoal: true,
    participantHref: '/participants/swallow-003',
    recordsHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records',
    recordNewHref: '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records/new',
    programLabel: '마이크로크레딧 씬파일러 금융지원·멘토링',
    participant: { name: '홍길동', phone: '010-1234-5678' },
    sessionRows: [
      { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', kind: 'regular', memoExcerpt: '구직 활동 근황과 지출 정리를 확인했다' },
      { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', kind: 'intake', memoExcerpt: '채무 현황과 정서적 어려움 확인' },
    ],
    pendingApprovalCount: 2,
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

// D45(ADR-0018) 3영역 — 이 순서가 계약이다. 구 '지난 상담 브리핑'·'오늘 확인할 질문' 카드는
// 영역 ①·②가 대체했고, GAS 아코디언은 D43 보류로 화면에서 빠졌다.
const AREA_TITLES = ['오늘 만나기 전 꼭 기억할 것', '상담 내용 회차별 정리', '내용 불일치'];
const GRID_TITLES = ['미해결 액션', '개인정보'];

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

describe('BriefingCards — 3영역 골격 (D45 · ADR-0018)', () => {
  it('3영역이 계약 순서로 렌더되고 유지 카드 2종은 그리드에 남는다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const allTitles = [...container.querySelectorAll<HTMLDetailsElement>('details.briefing-card')]
      .map((card) => card.querySelector('.briefing-card-summary')?.textContent?.trim() ?? '');
    // 3영역이 이 순서로 먼저 온다 — 영역 순서가 바뀌면 '5분 전에 훑는' 동선이 깨진다.
    const areaIndexes = AREA_TITLES.map((title) => allTitles.findIndex((candidate) => candidate.startsWith(title)));
    expect(areaIndexes.every((index) => index >= 0)).toBe(true);
    expect([...areaIndexes].sort((a, b) => a - b)).toEqual(areaIndexes);

    const gridCards = container.querySelectorAll<HTMLDetailsElement>('.briefing-cards-grid > details.briefing-card');
    expect([...gridCards].map((card) => card.querySelector('.briefing-card-summary')?.textContent?.trim()))
      .toEqual(GRID_TITLES);
    expect([...container.querySelectorAll<HTMLDetailsElement>('details')].every((card) => card.open)).toBe(true);
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

  it('영역 ①은 실무자 입력(세션 목표·맞춤형 질문)이 위, AI 질문이 아래다 (D45·R5)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '오늘 만나기 전 꼭 기억할 것');
    const labels = [...card.querySelectorAll('.briefing-qlabel')].map((node) => node.textContent);
    expect(labels).toEqual(['세션 목표', '맞춤형 질문', 'AI 질문']);
    expect(card.textContent).toContain('구직 상담');
    expect(card.textContent).toContain('이번 달 지출은 정리됐는지');
    expect(card.textContent).toContain('최근 구직 활동은 어땠는지');
  });

  it('영역 ②는 회차마다 상담일·유형·한 줄을 표시한다', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '상담 내용 회차별 정리');
    const rows = [...card.querySelectorAll('li')].map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2026-07-15');
    expect(rows[0]).toContain('기본 상담');
    expect(rows[0]).toContain('구직 활동 근황');
    expect(rows[1]).toContain('2026-07-01');
    expect(rows[1]).toContain('인테이크');
    expect(rows[1]).toContain('채무 현황과 정서적 어려움 확인');
  });

  it('영역 ②의 수기 메모 없는 회차는 폴백 문구를, 회차가 없으면 빈 상태를 표시한다', () => {
    const { container } = render(<BriefingCards {...baseProps({
      sessionRows: [{ sessionId: 's-3', heldAt: '2026-07-10T05:00:00Z', kind: 'regular', memoExcerpt: null }],
    })} />);
    expect(cardByTitle(container, '상담 내용 회차별 정리').textContent).toContain('수기 메모 없음');

    cleanup();
    const empty = render(<BriefingCards {...baseProps({ sessionRows: [] })} />);
    expect(cardByTitle(empty.container, '상담 내용 회차별 정리').textContent).toContain('표시할 상담 회차가 없습니다');
  });

  it('승인 대기 배지는 영역 ② 머리에 앉고 0건이면 없다 (D5 — D45 가 자리만 옮김)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const summary = cardByTitle(container, '상담 내용 회차별 정리').querySelector('.briefing-card-summary');
    expect(summary?.textContent).toContain('승인 대기 2건');

    cleanup();
    const none = render(<BriefingCards {...baseProps({ pendingApprovalCount: 0 })} />);
    expect(none.container.textContent).not.toContain('승인 대기');
  });

  it('영역 ③은 준비 중 안내를 표시한다 (검출은 CCC-43, 처리는 CCC-42)', () => {
    const { container } = render(<BriefingCards {...baseProps()} />);
    const card = cardByTitle(container, '내용 불일치');
    expect(card.textContent).toContain('준비 중');
  });
});

describe('BriefingCards — HERO·리스크 배너·출구 (유지 계약 D37·D38·D9)', () => {
  it('HERO 우상단은 행동 2개(당사자 정보 → 상담 시작)이고, 상담 기록은 페이지 맨 아래로 내려갔다 (D37)', () => {
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

  it('다가오는 일정이 없으면 HERO 메타는 예정된 상담 없음으로 표기한다', () => {
    const { container } = render(<BriefingCards {...baseProps({ upcomingSchedule: null })} />);
    expect(hero(container).textContent).toContain('예정된 상담 없음');
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
});

describe('BriefingCards — 전체 목표 카드 (D45 · CCC-41)', () => {
  const goalCard = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('.briefing-goal');
    if (el === null) throw new Error('overall goal card not found');
    return el;
  };

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
