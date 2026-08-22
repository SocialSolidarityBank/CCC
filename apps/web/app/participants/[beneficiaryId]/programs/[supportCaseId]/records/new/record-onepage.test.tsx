import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RecordOnepage, type RecordOnepageProps } from './record-onepage';
import { RecordAccordionToggle } from './record-accordion-toggle';

// CCC-10 정기 기록지 원페이지: 고정 헤더(이번 상담 목표·전체 목표 N), 우측 필수 채움 레일,
// 6영역 '위기' 선택 시 위기·안전 아코디언 자동 펼침+강조를 검증한다.

function props(overrides: Partial<RecordOnepageProps> = {}): RecordOnepageProps {
  return {
    schedules: [],
    openActionItems: [],
    latestLifeAreaSnapshot: [],
    sessionGoals: [],
    customQuestions: [],
    lastRecordSummary: null,
    briefingPath: '/participants/swallow-003/programs/case-1/briefing',
    actions: <><button type="button">상담 기록으로 돌아가기</button><button type="submit">저장</button></>,
    ...overrides,
  };
}

// vitest globals 를 쓰지 않는 설정이라 자동 정리가 걸리지 않는다. 한 파일에서 여러 번
// 렌더하므로 테스트마다 DOM 을 비운다(같은 testid 중복 방지).
afterEach(cleanup);

describe('RecordOnepage', () => {
  // 2026-08-08 Q: 구 상단 고정 헤더가 좌측 레일로 옮겨 갔다(인테이크와 같은 레이아웃).
  it('좌측 레일에 이번 상담 목표를 항상 표시한다', () => {
    const { getByTestId } = render(<RecordOnepage {...props({
      sessionGoals: [{ body: '임대차 계약 확인', caseGoalTitle: '월세 체납 해소' }],
    })} />);

    const rail = getByTestId('record-side-rail');
    expect(rail.className).toContain('record-side');
    expect(rail.textContent).toContain('이번 상담 목표');
    expect(rail.textContent).toContain('임대차 계약 확인');
    // D62 위계(전체 > 세부 > 세션): 세션 목표가 연결된 부모는 **세부 목표**다 — 구 라벨
    // '전체 목표:'는 goals 표의 문구를 전체 목표라고 잘못 부르고 있었다(CCC-68 정정).
    expect(rail.textContent).toContain('세부 목표: 월세 체납 해소');
    expect(rail.textContent).not.toContain('세부 목표 작성');
    // CCC-76: 목표가 있으면 카드 제목 옆 민트 배지가 건수를 보인다(진행·상태 축).
    const badge = getByTestId('record-session-goal-card').querySelector('.record-rail-title .wire-badge');
    expect(badge?.textContent).toBe('1건');
    expect(badge?.getAttribute('data-tone')).toBe('mint');
  });

  // CCC-76: '이번 상담에서 확인할 것'(워크인 폴백 자유 글)은 레일에서 본문 폼 맨 위
  // (오늘 상담 내용 위)로 옮겼다 — 레일은 읽기 전용이 된다. 라벨은 목표 낱말을 쓰지 않는다
  // (ADR-0032 §6 — '세부 목표 작성'이라 부르면 본문의 세부 목표 구획과 층이 섞인다).
  it('이번 상담에서 확인할 것 입력칸은 레일이 아니라 본문 오늘 상담 내용 위에 있다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    const input = container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(getByTestId('record-side-rail').contains(input)).toBe(false);
    expect(input.closest('.record-main')).not.toBeNull();

    const inputCard = input.closest('.wire-card') as HTMLElement;
    const memoCard = container.querySelector('textarea[name="memo"]')?.closest('.wire-card') as HTMLElement;
    expect(inputCard).not.toBe(memoCard);
    // 입력칸의 카드가 '오늘 상담 내용' 카드보다 문서 순서상 앞이다.
    expect(inputCard.compareDocumentPosition(memoCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // 나가기·저장은 레일 바닥이다(2026-08-08 Q — 구 고정 헤더 우측 대체).
  // 저장이 폼 아래에 하나도 남아 있지 않으므로, 이 자리가 비면 저장할 길이 사라진다.
  it('좌측 레일이 나가기·저장 버튼을 갖는다', () => {
    const { getByTestId } = render(<RecordOnepage {...props()} />);

    const rail = getByTestId('record-side-rail');
    expect(rail.textContent).toContain('상담 기록으로 돌아가기');
    expect(rail.querySelector('button[type="submit"]')?.textContent).toBe('저장');
  });

  it('세션 목표가 미연결이면 빈 상태 한 줄과 라벤더 미설정 배지가 뜬다', () => {
    // 2026-08-09 Q: 구 '미연결' 글자 표시 대체. 상태만 말하고 다음 손짓을 말하지 않던 자리다.
    // CCC-76: 배지는 라벤더 '미설정'(주의·대기 축) — 레드는 D9 리스크 독점 위반이라 기각.
    const { getByTestId } = render(<RecordOnepage {...props()} />);

    const rail = getByTestId('record-side-rail');
    expect(rail.textContent).toContain('일정에 연결된 목표가 없습니다');
    expect(rail.textContent).not.toContain('미연결');
    const badge = getByTestId('record-session-goal-card').querySelector('.record-rail-title .wire-badge');
    expect(badge?.textContent).toBe('미설정');
    expect(badge?.getAttribute('data-tone')).toBe('lavender');
  });

  // 2026-08-09 Q: 레일은 형제 카드 3장 스택이다 — 이번 상담 목표(맨 위) + 미해결 액션
  // 아코디언 + 체크리스트(구 진척도 카드에서 목표·필수를 가른다). 바로가기 목차는 레일이
  // 아니라 우측 셋째 열이다(같은 날 Q 2차 — 아래 목차 테스트).
  // 아코디언 본문은 액션 내용이 위, 지난 상담 시각이 아래고, '자세히 보기'는 15초 페이지
  // 미해결 액션 구획 앵커로 간다.
  it('지난 상담이 있으면 레일이 목표·미해결 액션·체크리스트 카드 3장이 된다', () => {
    const { getByTestId } = render(<RecordOnepage {...props({
      lastRecordSummary: { heldAt: '2026-08-01T05:00:00.000Z', text: '서류 준비를 확인했다' },
      openActionItems: [{ id: 'action-1', description: '서류 제출', owner: 'beneficiary', dueDate: null }],
    })} />);

    const rail = getByTestId('record-side-rail');
    expect(rail.querySelectorAll(':scope > .surface-card').length).toBe(3);

    const accordion = getByTestId('record-open-actions') as HTMLDetailsElement;
    expect(accordion.tagName).toBe('DETAILS');
    expect(accordion.querySelector('.wire-card-title')?.textContent).toBe('미해결 액션 1건');

    // 이번 상담 목표 카드가 미해결 액션 위에 선다(2026-08-09 Q).
    const goalCard = getByTestId('record-session-goal-card');
    expect(goalCard.compareDocumentPosition(accordion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const paragraphs = Array.from(accordion.querySelectorAll('.wire-card-body p'));
    expect(paragraphs[0]?.textContent).toBe('서류 준비를 확인했다');
    // 시각 표기는 ICU 버전에 따라 공백 문자가 달라 날짜까지만 본다(Asia/Seoul 고정).
    expect(paragraphs[1]?.textContent).toContain('지난 상담 2026년 8월 1일');

    const link = accordion.querySelector('a.wire-button') as HTMLAnchorElement;
    expect(link.textContent).toContain('자세히 보기');
    expect(link.getAttribute('href')).toBe('/participants/swallow-003/programs/case-1/briefing#open-actions');
  });

  it('지난 상담이 없으면 레일은 목표·체크리스트 카드 2장이다', () => {
    const { getByTestId, queryByTestId } = render(<RecordOnepage {...props()} />);

    expect(getByTestId('record-side-rail').querySelectorAll(':scope > .surface-card').length).toBe(2);
    expect(queryByTestId('record-open-actions')).toBeNull();
  });

  // 2026-08-09 Q 2차 "TOC 는 우측에": 목차는 레일이 아니라 격자의 셋째 열(형제 nav)이고,
  // 본문 구획 전부를 가리킨다. 광폭 전용 숨김·트랙 전환은 CSS(컨테이너 질의) 몫이라
  // 하니스 실측이 잰다 — 여기서는 구조(형제·앵커 짝)만 고정한다.
  it('구획 바로가기 목차가 레일 밖 형제 nav 로 서고 본문 구획 앵커와 짝이 맞는다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    const rail = getByTestId('record-side-rail');
    const toc = getByTestId('record-toc');
    expect(rail.contains(toc)).toBe(false);
    expect(toc.parentElement).toBe(rail.parentElement);
    expect(toc.tagName).toBe('NAV');
    expect(toc.className).toContain('wire-toc-rail');

    // goalSection 슬롯(#record-goals-title)은 페이지가 실어 보내는 부품이라 이 렌더에는 없다.
    const anchors = Array.from(toc.querySelectorAll('a'))
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter((href) => href !== '#record-goals-title');
    expect(anchors.length).toBeGreaterThanOrEqual(10);
    for (const href of anchors) {
      expect(container.querySelector(href), `${href} 대상 없음`).not.toBeNull();
    }
  });

  // 2026-08-09 Q: 미저장 안내는 레일 최하단, 저장 버튼 아래다 — 구 자리는 HERO 아래 본문
  // 상단이라 매 방문 첫 화면을 안내가 차지했다.
  it('미저장 안내 슬롯은 레일 맨 아래, 저장 버튼 아래에 선다', () => {
    const { getByTestId } = render(<RecordOnepage {...props({
      unsavedNotice: <p data-testid="record-unsaved-notice">아직 서버에 저장되지 않았습니다</p>,
    })} />);

    const rail = getByTestId('record-side-rail');
    const notice = getByTestId('record-unsaved-notice');
    expect(rail.contains(notice)).toBe(true);
    expect(rail.lastElementChild).toBe(notice);
    const submit = rail.querySelector('button[type="submit"]') as HTMLElement;
    expect(submit.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // CCC-76: 자동 저장 대기는 라벤더 배지다(주의·대기 축). 안내문(panel-meta)은 저장 버튼 줄
  // 아래에 선다.
  it('저장 구획은 대기 배지를 보이고 안내문이 저장 버튼 아래에 선다', () => {
    const { getByTestId } = render(<RecordOnepage {...props()} />);

    const status = getByTestId('draft-status');
    const badge = status.querySelector('.wire-badge');
    expect(badge?.textContent).toBe('자동 저장 대기');
    expect(badge?.getAttribute('data-tone')).toBe('lavender');

    const rail = getByTestId('record-side-rail');
    const submit = rail.querySelector('button[type="submit"]') as HTMLElement;
    const note = Array.from(rail.querySelectorAll('p.panel-meta'))
      .find((p) => p.textContent?.includes('수기 메모 하나만')) as HTMLElement;
    expect(note).not.toBeUndefined();
    expect(submit.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('우측 레일에 필수 채움 카운트를 표시하고 수기 메모를 채우면 올라간다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    // 미해결 액션 0건·6영역 기본값은 충족, 수기 메모만 남은 상태.
    expect(getByTestId('record-required-count').textContent).toBe('필수 2/3');

    const memo = container.querySelector('textarea[name="memo"]');
    expect(memo).not.toBeNull();
    fireEvent.change(memo as HTMLTextAreaElement, { target: { value: '오늘 상담 내용' } });
    expect(getByTestId('record-required-count').textContent).toBe('필수 3/3');
  });

  it('미해결 액션은 처리 상태를 고르기 전까지 필수 채움에서 빠진다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props({
      openActionItems: [{ id: 'action-1', description: '서류 제출', owner: 'beneficiary', dueDate: null }],
    })} />);

    expect(getByTestId('record-required-count').textContent).toBe('필수 1/3');
    const done = container.querySelector('input[name="resolutionStatus_action-1"][value="done"]');
    fireEvent.click(done as HTMLInputElement);
    expect(getByTestId('record-required-count').textContent).toBe('필수 2/3');
  });

  it("6영역에서 '위기'를 고르면 위기·안전 아코디언이 자동으로 펼쳐지고 강조된다", () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.open).toBe(false);
    expect(safety.className).not.toContain('is-crisis');

    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });

    expect(safety.open).toBe(true);
    expect(safety.className).toContain('is-crisis');
    expect(safety.textContent).toContain('확인 필요');
  });

  it("'위기'를 되돌리면 강조를 거두되 실무자가 연 상태는 유지한다", () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);
    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'okay' } });

    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.className).not.toContain('is-crisis');
    expect(safety.open).toBe(true);
  });

  it('리스크 플래그는 D72 고정 6종을 빠짐없이 보여준다', () => {
    const { container } = render(<RecordOnepage {...props()} />);
    const values = Array.from(container.querySelectorAll('input[name="flagType"]'))
      .map((input) => (input as HTMLInputElement).value);

    expect(values).toEqual([
      'crisis_utterance',
      'contact_loss_risk',
      'housing_livelihood_shock',
      'debt_deterioration',
      'repeated_noncompliance',
      'violence_exploitation',
    ]);
    expect(container.textContent).toContain('주거·생계·건강 급변');
    expect(container.textContent).toContain('폭력·착취 피해');
  });

  // D47 §6 · ADR-0019 — GAS 점수와 '목표 종료+신설'은 화면에서 내렸다. D43 이 보류한 것은
  // 'GAS 와 세부 목표 층' 둘 다인데 브리핑만 정리되고 이 화면에는 남아 있었다(UI 훑기 R1).
  // 이 테스트는 그것들이 조용히 되살아나는 것을 막는다 — 되살릴 때는 D43 해제가 먼저다.
  it('보류된 세부 목표 층 UI(GAS 점수·목표 종료+신설)를 어디에도 그리지 않는다', () => {
    const { container } = render(<RecordOnepage {...props()} />);

    expect(container.querySelector('select[name="gasScore"]')).toBeNull();
    expect(container.querySelector('select[name="closeGoalId"]')).toBeNull();
    expect(container.querySelector('input[name="goalClosedReason"]')).toBeNull();
    expect(container.querySelector('input[name="newGoalTitle"]')).toBeNull();
    // 라벨로도 남아 있으면 안 된다 — 입력칸만 지우고 제목이 남으면 기능이 있는 것처럼 읽힌다.
    expect(container.textContent).not.toContain('GAS');
    expect(container.textContent).not.toContain('목표 종료');
  });

  // 2026-08-09 Q: 전체 여닫기 버튼은 HERO(당사자 카드) 안으로 갔다. 범위는 .record-main
  // 선택자라 두 부품을 함께 렌더하면 실제 화면과 같은 조합이 된다.
  it('전체 열기/닫기가 아코디언을 일괄 조작하고 기본은 접힘이다 (CCC-24)', () => {
    const { container, getByText } = render(<><RecordAccordionToggle /><RecordOnepage {...props()} /></>);
    const allDetails = () => Array.from(container.querySelectorAll('details'));

    // 기본은 접힘 — CCC-5 결정. 위기·안전 자동 펼침이 없는 상태에서는 전부 닫혀 있다.
    expect(allDetails().every((details) => !details.open)).toBe(true);

    fireEvent.click(getByText('전체 열기'));
    expect(allDetails().every((details) => details.open)).toBe(true);

    fireEvent.click(getByText('전체 접기'));
    expect(allDetails().every((details) => !details.open)).toBe(true);
  });

  // CCC-76: 전체 여닫기 범위는 .record-main 이다 — 레일의 미해결 액션 아코디언은 본문
  // 기록 칸이 아니라 지난 상담 참조라 일괄 조작 대상이 아니다.
  it('전체 열기는 레일의 미해결 액션 아코디언을 건드리지 않는다', () => {
    const { getByText, getByTestId } = render(<><RecordAccordionToggle /><RecordOnepage {...props({
      lastRecordSummary: { heldAt: '2026-08-01T05:00:00.000Z', text: '서류 준비를 확인했다' },
    })} /></>);

    fireEvent.click(getByText('전체 열기'));
    expect((getByTestId('record-open-actions') as HTMLDetailsElement).open).toBe(false);
  });

  it('위기 선택 중에는 전체 접기도 위기·안전 칸을 닫지 못한다 (CCC-24)', () => {
    const { container, getByText } = render(<><RecordAccordionToggle /><RecordOnepage {...props()} /></>);

    // 6영역에서 '위기'를 골라 위기·안전 칸을 자동 펼친다.
    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });
    const safety = container.querySelector('[data-testid="safety-accordion"]') as HTMLDetailsElement;
    expect(safety.open).toBe(true);

    // 전부 연 뒤 접어도 위기 칸은 열린 채로 남는다.
    fireEvent.click(getByText('전체 열기'));
    fireEvent.click(getByText('전체 접기'));
    expect(safety.open).toBe(true);
    // 위기 칸을 제외한 나머지는 접힌다.
    const others = Array.from(container.querySelectorAll('details')).filter((d) => d !== safety);
    expect(others.every((details) => !details.open)).toBe(true);
  });

  // CCC-57: 기록을 남겨도 연결된 약속이 '예정'으로 남던 것을 고친다. 기본값이 실제로 그
  // 일정에 걸려 있는지를 본다. **선택지가 있는지가 아니라 골라져 있는지**다. 값은 JSON
  // 문자열이라 키 순서만 달라도 어느 선택지와도 안 맞고, 브라우저가 조용히 첫 선택지로
  // 되돌린다. 그 경우 "선택지가 있다"는 검사는 통과하면서 버그는 그대로 남는다.
  it('연결된 예정 일정을 기본으로 골라 둔다', () => {
    const schedule = {
      id: 'sched-1',
      beneficiaryId: 'swallow-003',
      supportCaseId: 'case-1',
      scheduledAt: '2026-08-12T05:00:00.000Z',
      status: 'scheduled' as const,
      version: 3,
    };
    const { container } = render(<RecordOnepage {...props({ schedules: [schedule] })} />);

    const select = container.querySelector('select[name="scheduleCompletion"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe(JSON.stringify({ id: 'sched-1', version: 3 }));
    // 끄는 길은 남아 있다. 자동 완료가 강제가 되면 안 된다.
    expect([...select.options].some((option) => option.value === '')).toBe(true);
  });

  // 자리 이동(2026-08-08 Q 승인): 접힌 '새 액션 · 다음 만남' 구획에서 항상 보이는
  // '오늘 상담 내용' 카드로 올렸다. 기본이 켬인 이상 안 보이는 곳에서 일정이 완료되면 안 된다.
  it('완료할 일정은 접힌 구획이 아니라 상담 일시와 같은 카드에 있다', () => {
    const { container } = render(<RecordOnepage {...props({
      schedules: [{
        id: 'sched-1',
        beneficiaryId: 'swallow-003',
        supportCaseId: 'case-1',
        scheduledAt: '2026-08-12T05:00:00.000Z',
        status: 'scheduled' as const,
        version: 1,
      }],
    })} />);

    const select = container.querySelector('select[name="scheduleCompletion"]') as HTMLSelectElement;
    expect(select.closest('details')).toBeNull();
    expect(select.closest('.wire-card')).toBe(
      container.querySelector('select[name="channel"]')?.closest('.wire-card'),
    );
  });

  // 예정 건이 없으면 칸 자체를 그리지 않는다. 고를 것이 '표시하지 않음' 하나뿐인 칸은
  // 항상 보이는 자리에서 자리만 먹는다.
  it('예정 일정이 없으면 완료할 일정 칸을 그리지 않는다', () => {
    const { container } = render(<RecordOnepage {...props()} />);
    expect(container.querySelector('select[name="scheduleCompletion"]')).toBeNull();
  });

  it('이미 완료·취소된 일정은 완료 대상으로 세지 않는다', () => {
    const { container } = render(<RecordOnepage {...props({
      schedules: [{
        id: 'sched-done',
        beneficiaryId: 'swallow-003',
        supportCaseId: 'case-1',
        scheduledAt: '2026-08-01T05:00:00.000Z',
        status: 'completed' as const,
        version: 2,
      }],
    })} />);
    expect(container.querySelector('select[name="scheduleCompletion"]')).toBeNull();
  });
});
