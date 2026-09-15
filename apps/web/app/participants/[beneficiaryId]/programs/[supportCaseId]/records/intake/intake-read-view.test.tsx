import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { IntakeReadView } from './intake-read-view';
import { ACTIVE_QUESTIONS, STEP_TITLES } from './intake-questions';
import type { IntakeAnswerInput, IntakeSavedRecord } from '../../../../../../lib/api';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type CurrentConsentState,
} from '@ccc/contracts/consent';

afterEach(cleanup);

// 전 항목이 저장돼 있는 정상 기록(전 항목 필수 원칙, D41). 서술은 본문, 나머지는 첫 선택지.
function fullAnswers(): IntakeAnswerInput[] {
  return ACTIVE_QUESTIONS.map((question) => {
    if (question.kind === 'text') return { key: question.key, response: 'answered' as const, text: `${question.label} 답변` };
    return { key: question.key, response: 'answered' as const, text: question.options![0]! };
  });
}

const CONSENT_STATES: CurrentConsentState[] = CONSENT_DOMAINS.map((domain, index) => ({
  domain,
  state: index === 0 ? 'granted' : index === 1 ? 'not_granted' : 'unconfirmed',
  provider: CONSENT_COPY[domain].provider,
  providerLegalRecipient: null,
  providerCountry: null,
  purpose: CONSENT_COPY[domain].purpose,
  retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
  effectiveAt: null,
  eventId: null,
  revision: null,
  eventSequence: null,
}));

function savedRecord(overrides: Partial<IntakeSavedRecord> = {}): IntakeSavedRecord {
  return {
    sessionId: 'session-1',
    heldAt: '2026-07-15T10:00:00.000Z',
    channel: 'in_person',
    schemaVersion: 2,
    revision: 7,
    history: [],
    questionLifecycle: { version: 1, items: [], conversion: null },
    questionnaire: {
      schemaVersion: 2,
      moduleSnapshot: { programId: 'program-1', programVersion: 4, financialSupportEnabled: true },
      answers: [],
      debts: { response: 'answered', rows: [{ creditor: 'OO은행' }] },
      linkedOrgs: { response: 'answered', rows: [{ orgName: 'OO구 주민센터' }] },
      additionalItems: { response: 'answered', rows: [{ item: '전체 채무 잔액' }] },
    },
    legacyDetailsJson: null,
    answers: fullAnswers(),
    debts: [{ creditor: 'OO은행', kind: '신용대출', balance: '1,200만 원', monthlyPayment: '30만 원', arrearsStatus: '3개월 연체' }],
    linkedOrgs: [{ orgName: 'OO구 주민센터', serviceName: '긴급복지 생계지원', supportDetail: '', usagePeriod: '', progressStatus: '' }],
    additionalItems: [{ item: '전체 채무 잔액', reason: '', method: '신용정보조회서 확인', dueNote: '' }],
    managerOpinion: '채무조정 상담을 우선 연계한다.',
    ...overrides,
  };
}

function renderView(
  saved: IntakeSavedRecord = savedRecord(),
  overallGoal: string | null = '3개월 안에 채무조정 신청을 마친다',
  canWrite = true,
) {
  return render(
    <IntakeReadView
      beneficiaryId="swallow-003"
      participant={{ name: '홍서희', phone: '010-1234-5678', email: 'sample@example.test' }}
      consent={CONSENT_STATES}
      saved={saved}
      overallGoal={overallGoal}
      editHref="/participants/swallow-003/programs/case-1/records/intake?edit=1"
      recordsHref="/participants/swallow-003/programs/case-1/records"
      participantHref="/participants/swallow-003"
      canWrite={canWrite}
    />,
  );
}

describe('IntakeReadView (CCC-58)', () => {
  it('shows one questionnaire part at a time and changes the content from the four-step rail', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 2, name: `1. ${STEP_TITLES[0]}` })).toBeTruthy();
    expect(screen.queryByTestId('intake-read-debts')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`2\\. ${STEP_TITLES[1]}`) }));

    const heading = screen.getByRole('heading', { level: 2, name: `2. ${STEP_TITLES[1]}` });
    expect(heading.parentElement?.classList.contains('intake-step-toolbar')).toBe(true);
    expect(screen.getByText('OO은행')).toBeTruthy();
    expect(screen.queryByText('신청 배경 답변')).toBeNull();
  });

  it('uses compact one-line rail labels with a shared title start line', () => {
    const { container } = renderView();
    const steps = [...container.querySelectorAll<HTMLButtonElement>('.intake-step')];
    expect(steps.map((item) => item.querySelector('.intake-step-label')?.textContent)).toEqual([
      '상담 신청',
      '생활상황',
      '도움과 자원',
      '상담 정리',
    ]);
    expect(steps.every((item) => item.querySelector('.intake-step-index') !== null)).toBe(true);
    expect(steps.every((item) => item.querySelector('.intake-step-marker') === null)).toBe(true);
    expect(steps.every((item) => item.querySelector('.wire-badge') === null)).toBe(true);
    expect(steps.every((item) => item.children.length === 3)).toBe(true);
    expect(container.querySelector('[data-testid="intake-step-rail"] h2')?.textContent).toBe('인테이크 4단계');
    expect(container.querySelector('[data-testid="intake-step-rail"] h2')?.classList.contains('wire-card-title')).toBe(true);
    expect(steps[2]?.getAttribute('aria-label')).toBe('3. 필요한 도움과 활용 가능한 자원, 8/8 완료');
  });

  it('동의 여섯 영역을 정본 순서와 문안, 현재 상태로 표시한다', () => {
    renderView();
    const card = screen.getByTestId('intake-read-consent');
    const sections = [...card.querySelectorAll('.wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      `${CONSENT_COPY.personal_data_collection_use.label}동의함`,
      `${CONSENT_COPY.sensitive_information_processing.label}동의하지 않음`,
      ...CONSENT_DOMAINS.slice(2).map((domain) => `${CONSENT_COPY[domain].label}미기록`),
    ]);
    for (const domain of CONSENT_DOMAINS) {
      expect(card.textContent).toContain(CONSENT_COPY[domain].copy);
    }
    expect(within(card).getByText('동의함')).toBeTruthy();
    expect(within(card).getByText('동의하지 않음')).toBeTruthy();
    expect(within(card).getAllByText('미기록')).toHaveLength(4);
  });

  it('shows the no-response and not-applicable codes as the canonical phrases', () => {
    const answers = fullAnswers().map((answer): IntakeAnswerInput => {
      if (answer.key === 'welfare_other') return { key: answer.key, response: 'unknown' };
      if (answer.key === 'need_secondary') return { key: answer.key, response: 'not_applicable' };
      return answer;
    });
    renderView(savedRecord({ answers }));
    expect(screen.getByText('무응답')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`3\\. ${STEP_TITLES[2]}`) }));
    expect(screen.getByText('해당 없음')).toBeTruthy();
  });

  it('renders the three row tables with column labels and blank cells as 미입력', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`2\\. ${STEP_TITLES[1]}`) }));
    const debts = screen.getByTestId('intake-read-debts');
    expect(within(debts).getByText('OO은행')).toBeTruthy();
    expect(within(debts).getByText('연체 여부·상태')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`3\\. ${STEP_TITLES[2]}`) }));
    const linked = screen.getByTestId('intake-read-linked-orgs');
    expect(within(linked).getByText('긴급복지 생계지원')).toBeTruthy();
    expect(within(linked).getAllByText('미입력').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`4\\. ${STEP_TITLES[3]}`) }));
    const additional = screen.getByTestId('intake-read-additional');
    expect(within(additional).getByText('신용정보조회서 확인')).toBeTruthy();
  });

  it('keeps the overall goal and manager opinion inside the numbered 4-3 accordion', () => {
    const { unmount } = renderView();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`4\\. ${STEP_TITLES[3]}`) }));
    const judgment = screen.getByTestId('intake-read-judgment');
    expect(judgment.querySelector('.wire-card-title')?.textContent).toContain('4-3.');
    expect(within(judgment).getByText('3개월 안에 채무조정 신청을 마친다')).toBeTruthy();
    expect(within(judgment).getByText('채무조정 상담을 우선 연계한다.')).toBeTruthy();
    unmount();

    renderView(savedRecord({ managerOpinion: null }), null);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`4\\. ${STEP_TITLES[3]}`) }));
    const missingJudgment = screen.getByTestId('intake-read-judgment');
    expect(within(missingJudgment).getAllByText('기록 없음').length).toBe(2);
    expect(within(missingJudgment).getByText('미기록 1')).toBeTruthy();
  });

  it('uses the participant hero for identity and removes the duplicated vault-information card', () => {
    const { container } = renderView();
    expect(screen.getByRole('heading', { level: 1, name: '인테이크 기록' })).toBeTruthy();
    const edit = screen.getByRole('link', { name: '수정' });
    expect(edit.getAttribute('href')).toBe('/participants/swallow-003/programs/case-1/records/intake?edit=1');
    const records = screen.getByRole('link', { name: '상담 기록 확인하기' });
    expect(records.getAttribute('href')).toBe('/participants/swallow-003/programs/case-1/records');
    expect(screen.getByText('010-1234-5678')).toBeTruthy();
    expect(screen.getByText('sample@example.test')).toBeTruthy();
    const hero = container.querySelector('.participant-hero-card');
    expect([...hero!.querySelectorAll('.wire-field-label')].map((node) => node.textContent))
      .toEqual(['인테이크', '전화번호', '이메일', '상담일']);
    expect(hero?.querySelector('.wire-field-row[data-tone="blue"] .wire-field-label')?.textContent).toBe('상담일');
    expect(screen.queryByTestId('intake-read-basic-info')).toBeNull();

    // 미확정 4개가 있어 동의 수정처 안내가 뜬다.
    expect(within(screen.getByTestId('intake-read-consent')).getByText('미기록 4')).toBeTruthy();
    expect(screen.getByRole('link', { name: '당사자 정보로 이동' })).toBeTruthy();
  });

  it('schema 1 원본은 저장된 키와 값을 그대로 보여 주고 현재 질문지로 분류하지 않는다', () => {
    const legacy = {
      ...savedRecord(),
      schemaVersion: 1,
      questionnaire: null,
      legacyDetailsJson: JSON.stringify({
        old_label: '원본 값',
        unknown_shape: { kept: true },
      }),
      answers: [],
      debts: [],
      linkedOrgs: [],
      additionalItems: [],
      managerOpinion: null,
      questionLifecycle: null,
    } as unknown as IntakeSavedRecord;

    renderView(legacy);

    const record = screen.getByTestId('intake-legacy-record');
    expect(within(record).getByText('old_label')).toBeTruthy();
    expect(within(record).getByText('원본 값')).toBeTruthy();
    expect(within(record).getByText('{"kept":true}')).toBeTruthy();
    expect(screen.queryByTestId('intake-read-current-step')).toBeNull();
  });

  it('쓰기 권한이 없으면 저장 기록을 읽되 수정 진입을 숨긴다', () => {
    renderView(savedRecord(), null, false);

    expect(screen.queryByRole('link', { name: '수정' })).toBeNull();
    expect(screen.getByText('지금은 읽기만 할 수 있어요. 저장된 내용은 계속 확인할 수 있어요.')).toBeTruthy();
  });

  it('추가 확인사항의 유지와 철회와 전환 확정 이력을 구분한다', () => {
    renderView(savedRecord({
      questionLifecycle: {
        version: 1,
        items: [
          {
            id: 'question-retained',
            revision: 2,
            sourceRevision: 7,
            sourceRowIndex: 0,
            createdBy: 'worker-1',
            createdAt: '2026-07-15T10:00:00.000Z',
            withdrawn: null,
            origin: {
              schemaVersion: 2,
              sourceRevision: 6,
              sourceRowIndex: 0,
            },
          },
          {
            id: 'question-withdrawn',
            revision: 3,
            sourceRevision: 6,
            sourceRowIndex: 1,
            createdBy: 'worker-1',
            createdAt: '2026-07-15T10:00:00.000Z',
            withdrawn: {
              actorId: 'worker-1',
              recordedAt: '2026-07-16T10:00:00.000Z',
              fromRevision: 2,
            },
            origin: null,
          },
        ],
        conversion: {
          sourceSchemaVersion: 2,
          sourceRevision: 6,
          mechanical: {
            recordedAt: '2026-07-15T10:00:00.000Z',
            mappings: [{ questionId: 'question-retained', sourceRowIndex: 0 }],
          },
          confirmation: {
            actorId: 'worker-1',
            recordedAt: '2026-07-15T10:01:00.000Z',
          },
        },
      },
    }));

    const history = screen.getByTestId('intake-question-history');
    expect(within(history).getByText('유지')).toBeTruthy();
    expect(within(history).getByText('철회')).toBeTruthy();
    expect(within(history).getByText('전환 확정')).toBeTruthy();
  });

  it('renders every current-step group as an accordion and supports open-all and close-all', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`2\\. ${STEP_TITLES[1]}`) }));
    const groups = Array.from(container.querySelectorAll('[data-testid="intake-read-current-step"] > details'));
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every((group) => (group as HTMLDetailsElement).open)).toBe(true);
    expect(groups.every((group) => group.querySelector('[role="heading"][aria-level="3"]') !== null)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '전체 닫기' }));
    expect(groups.every((group) => !(group as HTMLDetailsElement).open)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '전체 열기' }));
    expect(groups.every((group) => (group as HTMLDetailsElement).open)).toBe(true);
  });

  it('uses the neutral outline for recorded badges on gradient headers', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`2\\. ${STEP_TITLES[1]}`) }));
    const recorded = Array.from(
      container.querySelectorAll('[data-testid="intake-read-current-step"] > details[open] summary .wire-badge'),
    ).filter((badge) => badge.textContent === '기록됨');

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((badge) => badge.getAttribute('data-tone') === null)).toBe(true);
  });

  it('shows only the current step in the spacing-only TOC and every anchor has a target', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`2\\. ${STEP_TITLES[1]}`) }));
    const toc = screen.getByTestId('intake-read-toc');
    expect(toc.tagName).toBe('NAV');
    expect(toc.querySelector('.wire-card-divider')).toBeNull();
    const anchors = Array.from(toc.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href') ?? '');
    expect(anchors.length).toBeGreaterThan(1);
    for (const href of anchors) {
      expect(container.querySelector(href), `${href} 대상 없음`).not.toBeNull();
    }
  });
});
