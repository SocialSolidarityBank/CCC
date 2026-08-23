import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ScheduleCards, type ScheduleCardItem } from './schedule-cards';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// **테스트는 전부 통과해도 종료코드가 1** 이 된다(CI 실패). 이 파일이 실제로 CI 를 깨뜨렸다:
// 2026-07-30 PR #16 의 push 런에서 unhandled error 2건으로 verify 실패(같은 커밋의
// pull_request 런은 통과 — 부하에 따라 갈리는 타이밍 의존이라 '플레이크'로 보였던 것이다).
afterEach(cleanup);

// 공용 ParticipantCard 는 이름과 우상단 배지를 공통 헤더로 쓰고, 화면 맥락에 맞는
// 라벨·값만 아래 정보 격자에 표시한다.
const cards: ScheduleCardItem[] = [
  {
    id: 's1',
    href: '/participants/swallow-003/programs/case-1/briefing',
    schedule: { date: '7월 17일 (목)', time: '10:00', kindLabel: '기본 상담' },
    participantName: '김철수',
    beneficiaryId: 'swallow-003',
    participantPhone: '010-1234-5678',
  },
  {
    id: 's2',
    href: '/participants/otter-001/programs/case-2/briefing',
    schedule: { date: '7월 18일 (금)', time: '14:00', kindLabel: '인테이크' },
    participantName: null,
    beneficiaryId: 'otter-001',
    participantPhone: null,
  },
];

/** 카드 렌더 순서. 날짜는 상담 일시 값의 data-col 로 짚는다. */
function cardDates(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.participant-card'))
    .map((card) => card.querySelector('.participant-card-date[data-col="date"]')?.textContent ?? null);
}

describe('ScheduleCards', () => {
  it('공통 헤더 아래 일정 맥락의 라벨과 값만 표시한다', () => {
    const { container } = render(<ScheduleCards today={[]} upcoming={cards} />);
    const cardsRendered = Array.from(container.querySelectorAll('.participant-card'));
    const firstCard = cardsRendered[0];
    expect(firstCard?.querySelector('.participant-card-header')?.textContent).toContain('김철수');
    expect(firstCard?.querySelector('.participant-card-id')?.textContent).toBe('swallow-003');
    expect(firstCard?.querySelector('.participant-card-header')?.textContent).toContain('기본 상담');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).toContain('상담 일시');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).toContain('7월 17일 (목) 10:00');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).toContain('연락처');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).toContain('010-1234-5678');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).not.toContain('가명 ID');
    expect(firstCard?.querySelector('.participant-card-fields')?.textContent).not.toContain('swallow-003');
    expect(firstCard?.querySelector('.participant-card-fields [data-layout="stack"]')).toBeNull();
    expect(cardsRendered[1]?.querySelector('.participant-card-name')?.textContent).toBe('otter-001');

    // 상담 종류는 블루 뱃지다(D34 일정 축).
    const badges = Array.from(container.querySelectorAll('.wire-badge')).map((el) => el.textContent);
    expect(badges).toContain('기본 상담');
    expect(badges).toContain('인테이크');

    // 정보는 위계와 여백으로 묶으며 카드 안 구분선은 쓰지 않는다.
    expect(container.querySelector('.participant-card .wire-card-divider')).toBeNull();

    // 카드는 상담 준비(브리핑)로 링크된다. 열 수는 .card-grid 가 정한다(2026-07-26).
    const links = Array.from(container.querySelectorAll('.card-grid > a')).map((el) => el.getAttribute('href'));
    expect(links).toContain('/participants/swallow-003/programs/case-1/briefing');
  });

  it('시간순 정렬 토글을 누르면 카드 순서가 뒤집힌다', () => {
    const { container } = render(<ScheduleCards today={[]} upcoming={cards} />);
    expect(cardDates(container)).toEqual(['7월 17일 (목) 10:00', '7월 18일 (금) 14:00']); // 기본 오름차순

    const toggle = container.querySelector('button.wire-button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);
    expect(cardDates(container)).toEqual(['7월 18일 (금) 14:00', '7월 17일 (목) 10:00']); // 내림차순
  });

  // CCC-66: D21 이 정한 '오늘' 구분이 구현에서 빠져 평평한 목록이 됐다. 오늘 상담이 다른
  // 날짜에 섞여 있으면 "상담 5분 전에 한 화면" 콘셉트와 어긋난다.
  it('오늘과 다가오는 일정을 나눠 보여준다', () => {
    const todayCard: ScheduleCardItem = {
      id: 't1',
      href: '/participants/crane-001/programs/case-3/briefing',
      schedule: { date: '7월 16일 (수)', time: '09:00', kindLabel: '기본 상담' },
      participantName: '이영희',
      beneficiaryId: 'crane-001',
      participantPhone: null,
    };
    const { container } = render(<ScheduleCards today={[todayCard]} upcoming={cards} />);

    const today = container.querySelector('[data-testid="schedule-today"]') as HTMLElement;
    const upcoming = container.querySelector('[data-testid="schedule-upcoming"]') as HTMLElement;
    expect(today.querySelector('h2')?.textContent).toBe('오늘');
    expect(upcoming.querySelector('h2')?.textContent).toBe('다가오는 일정');
    expect(today.textContent).toContain('이영희');
    expect(today.textContent).not.toContain('김철수');
    expect(upcoming.textContent).toContain('김철수');
    expect(upcoming.textContent).not.toContain('이영희');
  });

  // 오늘 칸은 끝난 상담도 배지와 함께 남긴다("3건 중 1건 끝"을 보는 자리다).
  // 다가오는 칸은 예정만 온다. 거르기는 페이지가 하고, 여기서는 배지가 붙는지만 본다.
  it('오늘 칸의 끝난 상담에는 상태 배지가 붙는다', () => {
    const done: ScheduleCardItem = {
      id: 't2',
      href: '/participants/crane-001/programs/case-3/briefing',
      schedule: { date: '7월 16일 (수)', time: '09:00', kindLabel: '기본 상담', statusLabel: '완료' },
      participantName: '이영희',
      beneficiaryId: 'crane-001',
      participantPhone: null,
    };
    const { container } = render(<ScheduleCards today={[done]} upcoming={[]} />);

    const today = container.querySelector('[data-testid="schedule-today"]') as HTMLElement;
    expect(Array.from(today.querySelectorAll('.wire-badge')).map((el) => el.textContent)).toContain('완료');
  });

  // 오늘 상담이 없다는 것 자체가 실무자가 알고 싶은 답이다. 칸이 통째로 사라지면
  // "오늘이 없는 건지 화면이 안 뜬 건지"를 구분할 수 없다.
  it('오늘 상담이 없어도 오늘 칸은 남고 빈 상태를 알린다', () => {
    const { container } = render(<ScheduleCards today={[]} upcoming={cards} />);

    const today = container.querySelector('[data-testid="schedule-today"]') as HTMLElement;
    expect(today).not.toBeNull();
    expect(today.textContent).toContain('오늘 잡힌 상담이 없습니다');
  });

  it("툴바에 '고정' 자리표시자를 두지 않는다", () => {
    // 2026-07-31 Q 요청으로 뺐다. 누를 수 없는 버튼이 계속 보이면 "아직 안 만든 것"이 아니라
    // "고장난 것"으로 읽힌다. 되살아나면 이 테스트가 잡는다 — 기능이 실제로 생길 때 넣는다.
    const { container } = render(<ScheduleCards today={[]} upcoming={cards} />);
    const toolbarButtons = Array.from(container.querySelectorAll('.list-toolbar button'));
    expect(toolbarButtons).toHaveLength(1);
    expect(container.querySelector('.list-toolbar')?.textContent).not.toContain('고정');
    // 비활성 버튼 자체가 남아 있지 않아야 한다.
    expect(container.querySelector('.list-toolbar button[disabled]')).toBeNull();
  });
});
