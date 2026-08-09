import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { IntakeReadView } from './intake-read-view';
import { ACTIVE_QUESTIONS, STEP_TITLES } from './intake-questions';
import type { IntakeAnswerInput, IntakeSavedRecord } from '../../../../../../lib/api';

afterEach(cleanup);

// 전 항목이 저장돼 있는 정상 기록(전 항목 필수 원칙, D41). 서술은 본문, 나머지는 첫 선택지.
function fullAnswers(): IntakeAnswerInput[] {
  return ACTIVE_QUESTIONS.map((question) => {
    if (question.kind === 'text') return { key: question.key, response: 'answered' as const, text: `${question.label} 답변` };
    return { key: question.key, response: 'answered' as const, text: question.options![0]! };
  });
}

function savedRecord(overrides: Partial<IntakeSavedRecord> = {}): IntakeSavedRecord {
  return {
    sessionId: 'session-1',
    heldAt: '2026-07-15T10:00:00.000Z',
    channel: 'in_person',
    answers: fullAnswers(),
    debts: [{ creditor: 'OO은행', kind: '신용대출', balance: '1,200만원', monthlyPayment: '30만원', arrearsStatus: '3개월 연체' }],
    linkedOrgs: [{ orgName: 'OO구 주민센터', serviceName: '긴급복지 생계지원', supportDetail: '', usagePeriod: '', progressStatus: '' }],
    additionalItems: [{ item: '전체 채무 잔액', reason: '', method: '신용정보조회서 확인', dueNote: '' }],
    managerOpinion: '채무조정 상담을 우선 연계한다.',
    ...overrides,
  };
}

function renderView(
  saved: IntakeSavedRecord = savedRecord(),
  overallGoal: string | null = '3개월 안에 채무조정 신청을 마친다',
) {
  return render(
    <IntakeReadView
      beneficiaryId="swallow-003"
      participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
      extendedPii={{ birthDate: '1984-03-11', region: '서울시 은평구', emergencyContact: null, gender: '여성' }}
      consent={{ privacy: true, recordingAi: false }}
      saved={saved}
      overallGoal={overallGoal}
      editHref="/participants/swallow-003/programs/case-1/records/intake?edit=1"
      recordsHref="/participants/swallow-003/programs/case-1/records"
      participantHref="/participants/swallow-003"
      basicInfoHref="/participants/swallow-003/edit"
    />,
  );
}

describe('IntakeReadView (CCC-58)', () => {
  it('renders every questionnaire answer across the four parts on one page', () => {
    renderView();
    // 4부 절 제목이 전부 선다 — 단계를 넘기지 않고 한 페이지다.
    STEP_TITLES.forEach((title, index) => {
      expect(screen.getByRole('heading', { level: 2, name: `${index + 1}. ${title}` })).toBeTruthy();
    });
    // 서술 답 표본(본문 그대로)과 선택 답 표본(첫 선택지 저장)이 본문으로 읽힌다.
    expect(screen.getByText('신청 배경 답변')).toBeTruthy();
    expect(screen.getByText('경제·생계 어려움')).toBeTruthy();
  });

  it('shows the no-response and not-applicable codes as the canonical phrases', () => {
    const answers = fullAnswers().map((answer): IntakeAnswerInput => {
      if (answer.key === 'welfare_other') return { key: answer.key, response: 'unknown' };
      if (answer.key === 'need_secondary') return { key: answer.key, response: 'not_applicable' };
      return answer;
    });
    renderView(savedRecord({ answers }));
    expect(screen.getByText('무응답')).toBeTruthy();
    expect(screen.getByText('해당 없음')).toBeTruthy();
  });

  it('renders the three row tables with column labels and blank cells as 미입력', () => {
    renderView();
    const debts = screen.getByTestId('intake-read-debts');
    expect(within(debts).getByText('OO은행')).toBeTruthy();
    expect(within(debts).getByText('연체 여부·상태')).toBeTruthy();
    const linked = screen.getByTestId('intake-read-linked-orgs');
    expect(within(linked).getByText('긴급복지 생계지원')).toBeTruthy();
    expect(within(linked).getAllByText('미입력').length).toBeGreaterThan(0);
    const additional = screen.getByTestId('intake-read-additional');
    expect(within(additional).getByText('신용정보조회서 확인')).toBeTruthy();
  });

  it('shows the manager opinion and falls back to 기록 없음 when empty', () => {
    const { unmount } = renderView();
    expect(within(screen.getByTestId('intake-read-opinion')).getByText('채무조정 상담을 우선 연계한다.')).toBeTruthy();
    unmount();
    renderView(savedRecord({ managerOpinion: null }));
    expect(within(screen.getByTestId('intake-read-opinion')).getByText('기록 없음')).toBeTruthy();
  });

  it('offers the edit entry and the records exit, and shows consent guidance when a consent is missing', () => {
    renderView();
    const edit = screen.getByRole('link', { name: '수정' });
    expect(edit.getAttribute('href')).toBe('/participants/swallow-003/programs/case-1/records/intake?edit=1');
    const records = screen.getByRole('link', { name: '전체 상담 기록' });
    expect(records.getAttribute('href')).toBe('/participants/swallow-003/programs/case-1/records');
    // ② 미기록이므로 동의 수정처 안내가 뜬다(D44 — 동의는 당사자 정보 페이지 몫).
    expect(within(screen.getByTestId('intake-read-consent')).getByText('미기록')).toBeTruthy();
    expect(screen.getByRole('link', { name: '당사자 정보로 이동' })).toBeTruthy();
  });

  it('renders 기본정보 from the vault as read-only rows', () => {
    renderView();
    const basic = screen.getByTestId('intake-read-basic-info');
    expect(within(basic).getByText('홍서희')).toBeTruthy();
    expect(within(basic).getByText('1984-03-11')).toBeTruthy();
    expect(within(basic).getByText('서울시 은평구')).toBeTruthy();
  });

  // 2026-08-09 3차: 우측 바로가기 목차(광폭 전용 — 표시·숨김은 CSS 몫이라 하니스가 재고,
  // 여기서는 부·소절 앵커가 전부 본문 대상과 짝이 맞는지만 고정한다).
  it('우측 바로가기 목차의 부·소절 앵커가 전부 본문 대상과 짝이 맞는다', () => {
    const { container } = renderView();
    const toc = screen.getByTestId('intake-read-toc');
    expect(toc.tagName).toBe('NAV');
    const anchors = Array.from(toc.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href') ?? '');
    // 부 4 + 소절(1부 5·2부 7·3부 4·4부 5) = 25개.
    expect(anchors.length).toBe(25);
    for (const href of anchors) {
      expect(container.querySelector(href), `${href} 대상 없음`).not.toBeNull();
    }
  });

  // D62 · CCC-68: 인테이크가 전체 목표의 주 입력 자리라 조회 화면도 같은 자리(4단계)에서 읽는다.
  it('전체 목표를 읽고, 비어 있으면 설정 전으로 보인다', () => {
    const { unmount } = renderView();
    expect(within(screen.getByTestId('intake-read-overall-goal')).getByText('3개월 안에 채무조정 신청을 마친다')).toBeTruthy();
    unmount();
    renderView(savedRecord(), null);
    expect(within(screen.getByTestId('intake-read-overall-goal')).getByText('설정 전')).toBeTruthy();
  });
});
