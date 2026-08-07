import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ScheduleCards, type ScheduleCardItem } from './schedule-cards';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// **테스트는 전부 통과해도 종료코드가 1** 이 된다(CI 실패). 이 파일이 실제로 CI 를 깨뜨렸다:
// 2026-07-30 PR #16 의 push 런에서 unhandled error 2건으로 verify 실패(같은 커밋의
// pull_request 런은 통과 — 부하에 따라 갈리는 타이밍 의존이라 '플레이크'로 보였던 것이다).
afterEach(cleanup);

// 2026-08-06 Q 카드 통일: 카드는 공용 ParticipantCard 다 — 1행 날짜·시간·종류 뱃지,
// 2행 이름·가명 ID·연락처. 이 테스트는 그 구조를 계약으로 고정한다.
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

function cellTexts(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.participant-card-cell')).map((el) => el.textContent);
}

/** 카드 렌더 순서 — 날짜 칸을 카드 순서대로 뽑는다(2026-08-07 행 순서 교체로 날짜는
 *  첫 칸이 아니라 data-col 로 짚는다 — 이름 행이 위, 일정 행이 가로선 아래다). */
function cardDates(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.participant-card'))
    .map((card) => card.querySelector('.participant-card-cell[data-col="date"]')?.textContent ?? null);
}

describe('ScheduleCards', () => {
  it('이름 행이 위, 날짜·시간·종류 뱃지는 가로선 아래를 표시한다 (2026-08-07 행 순서 교체)', () => {
    const { container } = render(<ScheduleCards cards={cards} />);
    const values = cellTexts(container);
    expect(values).toContain('김철수'); // 실명(T2 응답)
    expect(values).toContain('swallow-003'); // 가명 ID 칸(2026-08-06 복귀)
    expect(values).toContain('010-1234-5678'); // 연락처
    expect(values).toContain('미기입'); // participantName=null → 이름 칸 폴백(ID 칸이 따로 있다)
    expect(values).toContain('7월 17일 (목)');
    expect(values).toContain('10:00');

    // 상담 종류는 블루 뱃지다(D34 일정 축).
    const badges = Array.from(container.querySelectorAll('.wire-badge')).map((el) => el.textContent);
    expect(badges).toContain('기본 상담');
    expect(badges).toContain('인테이크');

    // 행 구분선은 회색 풀블리드 한 줄이다(2026-08-06).
    expect(container.querySelectorAll('.participant-card .wire-card-divider')).toHaveLength(2);

    // 카드는 상담 준비(브리핑)로 링크된다. 열 수는 .card-grid 가 정한다(2026-07-26).
    const links = Array.from(container.querySelectorAll('.card-grid > a')).map((el) => el.getAttribute('href'));
    expect(links).toContain('/participants/swallow-003/programs/case-1/briefing');
  });

  it('시간순 정렬 토글을 누르면 카드 순서가 뒤집힌다', () => {
    const { container } = render(<ScheduleCards cards={cards} />);
    expect(cardDates(container)).toEqual(['7월 17일 (목)', '7월 18일 (금)']); // 기본 오름차순

    const toggle = container.querySelector('button.wire-button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);
    expect(cardDates(container)).toEqual(['7월 18일 (금)', '7월 17일 (목)']); // 내림차순
  });

  it("툴바에 '고정' 자리표시자를 두지 않는다", () => {
    // 2026-07-31 Q 요청으로 뺐다. 누를 수 없는 버튼이 계속 보이면 "아직 안 만든 것"이 아니라
    // "고장난 것"으로 읽힌다. 되살아나면 이 테스트가 잡는다 — 기능이 실제로 생길 때 넣는다.
    const { container } = render(<ScheduleCards cards={cards} />);
    const toolbarButtons = Array.from(container.querySelectorAll('.list-toolbar button'));
    expect(toolbarButtons).toHaveLength(1);
    expect(container.querySelector('.list-toolbar')?.textContent).not.toContain('고정');
    // 비활성 버튼 자체가 남아 있지 않아야 한다.
    expect(container.querySelector('.list-toolbar button[disabled]')).toBeNull();
  });
});
