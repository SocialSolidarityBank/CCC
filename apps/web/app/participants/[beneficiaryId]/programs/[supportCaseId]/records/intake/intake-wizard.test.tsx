import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, within, fireEvent, waitFor } from '@testing-library/react';
import { IntakeWizard, type IntakeInitialValues } from './intake-wizard';
import { ACTIVE_QUESTIONS, STEP_GROUPS } from './intake-questions';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';
import { parseIntakeQuestionnaire } from '@ccc/contracts/intake';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type ConsentDomain,
  type ConsentState,
  type CurrentConsentState,
} from '@ccc/contracts/consent';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(cleanup);

/** CCC-57 연결 일정. 화면에 뜨는 표기와 제출 페이로드 둘 다 이 값으로 검증한다. */
const LINKED_SCHEDULE = { id: '22222222-2222-4222-8222-222222222222', scheduledAt: '2026-08-12T05:00:00.000Z', version: 3 };

const MODULE_SNAPSHOT = {
  programId: '33333333-3333-4333-8333-333333333333',
  programVersion: 4,
  financialSupportEnabled: true,
} as const;

function consentStates(overrides: Partial<Record<ConsentDomain, ConsentState>> = {}): CurrentConsentState[] {
  return CONSENT_DOMAINS.map((domain) => ({
    domain,
    state: overrides[domain] ?? 'granted',
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
}

const BOUND_EDIT_INITIAL = {
  heldAt: '2026-08-01T05:00:00.000Z',
  answers: [],
  debts: [],
  linkedOrgs: [],
  additionalItems: [
    { item: '유지할 질문', dueNote: '다음 상담' },
    { item: '철회할 질문', dueNote: '이번 주' },
  ],
  managerOpinion: '기존 의견',
  schemaVersion: 2 as const,
  revision: 7,
  questionLifecycle: {
    version: 1 as const,
    items: [
      {
        id: 'question-retained',
        revision: 2,
        sourceRevision: 7,
        sourceRowIndex: 0,
        createdBy: 'worker-1',
        createdAt: '2026-08-01T05:00:00.000Z',
        withdrawn: null,
        origin: null,
      },
      {
        id: 'question-withdrawn',
        revision: 3,
        sourceRevision: 7,
        sourceRowIndex: 1,
        createdBy: 'worker-1',
        createdAt: '2026-08-01T05:00:00.000Z',
        withdrawn: null,
        origin: null,
      },
    ],
    conversion: null,
  },
};

function renderWizard(
  consent = consentStates(),
  extra: {
    schedule?: typeof LINKED_SCHEDULE | null;
    overallGoal?: string | null;
    overallGoalSaved?: boolean;
    result?: IntakeRecordActionResult;
    mode?: 'create' | 'edit';
    initial?: IntakeInitialValues;
  } = {},
) {
  push.mockClear();
  let lastInput: CreateIntakeRecordActionInput | null = null;
  const submit = async (input: CreateIntakeRecordActionInput): Promise<IntakeRecordActionResult> => {
    lastInput = input;
    return extra.result ?? { status: 'saved', revision: 1, overallGoalSaved: extra.overallGoalSaved ?? true };
  };
  const utils = render(
    <IntakeWizard
      beneficiaryId="swallow-003"
      supportCaseId="11111111-1111-4111-8111-111111111111"
      submissionId="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
      participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
      extendedPii={{ birthDate: '1984-03-11', region: '서울시 은평구', emergencyContact: null, gender: '여성' }}
      consent={consent}
      sessionSequence={1}
      recorderLabel="이지은"
      briefingHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=intake_saved"
      writeSchemaVersion={3}
      moduleSnapshot={MODULE_SNAPSHOT}
      {...(extra.mode === undefined ? {} : { mode: extra.mode })}
      {...(extra.initial === undefined ? {} : { initial: extra.initial })}
      participantHref="/participants/swallow-003"
      basicInfoHref="/participants/swallow-003/edit"
      overallGoal={extra.overallGoal ?? null}
      overallGoalErrorHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=overall_goal_error"
      schedule={extra.schedule ?? null}
      submit={submit}
    />,
  );
  return { ...utils, getLastInput: () => lastInput };
}

/**
 * 전 항목 필수 + 무응답 원칙(D41). 고르기·여러 개 고르기는 '무응답'을, 서술은 본문을 채운다.
 * 단계마다 화면에 뜬 것만 채울 수 있으므로 4단계를 차례로 돈다.
 */
function fillAllQuestions(scoped: ReturnType<typeof within>): void {
  for (let step = 1; step <= 4; step += 1) {
    fireEvent.click(scoped.getByRole('button', { name: new RegExp(`^${step}\\.`) }));
    for (const question of STEP_GROUPS[step - 1]!.flatMap((group) => group.questions)) {
      if (question.kind === 'select') {
        const fallback = question.options?.includes('무응답') === true ? '무응답' : question.options![0]!;
        fireEvent.change(scoped.getByLabelText(question.label), { target: { value: fallback } });
      } else if (question.kind === 'multi') {
        fireEvent.click(scoped.getByLabelText(`${question.label} 무응답`));
      } else {
        const name = question.key === 'previous_support_detail' ? /이전 지원 경험/ : question.label;
        fireEvent.change(scoped.getByRole('textbox', { name }), { target: { value: `${question.key} 내용` } });
      }
    }
    // 질문 밖의 필수 3개: 2-1 부채 표·3-3 연계 기관 표의 첫 열(정본: 없으면 '해당 없음')과 종합의견.
    if (step === 2) fireEvent.change(scoped.getByLabelText('기관·채권자 1'), { target: { value: '해당 없음' } });
    if (step === 3) fireEvent.change(scoped.getByLabelText('기관명 1'), { target: { value: '해당 없음' } });
    if (step === 4) fireEvent.change(scoped.getByLabelText('담당 실무자 종합의견'), { target: { value: '우선순위 높음' } });
  }
}

  it('화면 제목은 인테이크 기록 목적지 이름을 쓴다', () => {
    const { container } = renderWizard();
    expect(within(container).getByRole('heading', { level: 1, name: '인테이크 기록' })).toBeTruthy();
  });

function completeButton(scoped: ReturnType<typeof within>): HTMLButtonElement {
  return scoped.getByRole('button', { name: '완료' }) as HTMLButtonElement;
}

describe('IntakeWizard', () => {
  it('질문지 4부와 1:1인 4단계를 보여주고 이동한다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    expect(scoped.getByRole('heading', { name: '1. 상담 신청 및 기본정보' })).not.toBeNull();
    fireEvent.click(scoped.getByRole('button', { name: /3\. 필요한 도움과 활용 가능한 자원/ }));
    expect(scoped.getByRole('heading', { name: '3. 필요한 도움과 활용 가능한 자원' })).not.toBeNull();
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    expect(scoped.getByRole('heading', { name: '4. 상담 정리와 후속관리' })).not.toBeNull();
    // 5단계·6단계는 없다(구 6단계 폐기).
    expect(scoped.queryByRole('button', { name: /5\./ })).toBeNull();
  });

  it('단계 레일은 짧은 화면 라벨과 고정 열을 써 네 제목의 시작선을 맞춘다', () => {
    const { container } = renderWizard();
    const steps = [...container.querySelectorAll<HTMLButtonElement>('.intake-step')];
    expect(steps).toHaveLength(4);
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
    expect(steps[2]?.getAttribute('aria-label')).toBe('3. 필요한 도움과 활용 가능한 자원, 0/8 완료');
  });

  it('여러 개 고르기의 무응답과 해당 없음은 일반 선택과 함께 남지 않는다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));
    const ordinary = scoped.getByLabelText('현재 어려움 관련 영역 경제') as HTMLInputElement;
    const unknown = scoped.getByLabelText('현재 어려움 관련 영역 무응답') as HTMLInputElement;

    fireEvent.click(ordinary);
    fireEvent.click(unknown);
    expect(ordinary.checked).toBe(false);
    expect(unknown.checked).toBe(true);

    fireEvent.click(ordinary);
    expect(ordinary.checked).toBe(true);
    expect(unknown.checked).toBe(false);
  });

  it('남은 필수 항목 안내는 단계 레일 아래에 둔다', () => {
    const { getByTestId } = renderWizard();
    const rail = getByTestId('intake-step-rail');
    const warning = getByTestId('intake-missing');

    expect(rail.contains(warning)).toBe(true);
    expect(rail.lastElementChild).toBe(warning);
  });

  it('대출 부채 표는 다른 소절 카드와 같은 바깥 폭에 선다', () => {
    const { container, getByTestId } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));

    const table = getByTestId('intake-debt-table');
    expect(table.className).toContain('wire-card');
    expect(table.closest('.consent-detail')).toBeNull();
  });

  it('필수는 실제 입력 항목에만 라벤더 배지로 표시하고 선택 표시는 두지 않는다', () => {
    const { container, getByTestId } = renderWizard();
    const markers = [...container.querySelectorAll('.wire-form-label .wire-required-marker')];
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((marker) => marker.getAttribute('data-tone') === 'lavender')).toBe(true);
    expect(container.querySelector('.wire-requirement-badge')).toBeNull();

    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));
    expect(scoped.getByRole('group', { name: /현재 어려움 관련 영역 필수/ })).toBeTruthy();
    const debtTable = getByTestId('intake-debt-table');
    expect(debtTable.querySelector('.wire-card-title .wire-required-marker')).toBeNull();
    expect(debtTable.querySelectorAll('.wire-form-label .wire-required-marker')).toHaveLength(1);
    fireEvent.click(within(debtTable).getByRole('button', { name: '줄 추가' }));
    expect(debtTable.querySelectorAll('.wire-form-label .wire-required-marker')).toHaveLength(1);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    const overallGoal = getByTestId('intake-overall-goal');
    expect(overallGoal.querySelector('.wire-required-marker')).toBeNull();
    expect(within(overallGoal).queryByText('선택')).toBeNull();
  });

  it('빈 반복 표도 안내 행에 추가와 삭제 버튼을 한 쌍으로 둔다', () => {
    const { container, getByTestId } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));

    const table = getByTestId('intake-additional-table');
    expect(table.querySelector('.wire-repeat-guide')).not.toBeNull();
    expect(within(table).getByRole('button', { name: '줄 추가' })).toBeTruthy();
    expect((within(table).getByRole('button', { name: '이 줄 삭제' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('하단 이전 버튼은 상단 뒤로 버튼과 같은 page-back 계약을 쓴다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /^2\./ }));
    const previous = scoped.getByRole('button', { name: '이전' });
    expect(previous.className).toContain('page-back');
    expect(previous.querySelector('.wire-chevron[data-dir="left"]')).not.toBeNull();
  });

  it('1단계 소절 번호는 정본 순서대로 하나씩만 뜬다', () => {
    const { container } = renderWizard();
    const subHeadings = [...container.querySelectorAll('h3')]
      .map((el) => el.textContent ?? '')
      .filter((text) => /^1-\d\./.test(text));

    // 구 결함: 자동 채움 항목을 별도 상자로 빼는 바람에 '1-3' 이 두 번 떴고
    // 그 상자가 1-2 위로 올라가 정본 순서가 깨졌다.
    expect(subHeadings).toEqual([
      '1-1. 당사자 기본정보',
      '1-2. 공적급여·수급자 여부',
      '1-3. 상담 운영정보',
      '1-4. 상담 신청 사유',
    ]);
    expect(new Set(subHeadings).size).toBe(subHeadings.length);
  });

  it('4단계 소절은 질문지 번호 순서대로 배치한다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));

    const headings = [...container.querySelectorAll('h3')]
      .map((el) => el.textContent ?? '')
      .filter((text) => /^(4-\d\.|전체 목표|담당 실무자 종합의견)/.test(text));

    expect(headings).toEqual([
      '4-1. 상담 참여 여건',
      '4-2. 추가 확인사항',
      '4-3. 담당 실무자 판단 및 다음 단계',
      '전체 목표',
      '담당 실무자 종합의견',
    ]);
    const tocLabels = [...container.querySelectorAll('[data-testid="intake-toc"] a')]
      .map((el) => el.textContent ?? '');
    expect(tocLabels).toEqual(headings);

  });

  // 2026-08-09 3차: 우측 바로가기 목차는 현재 단계의 소절만 담고, 앵커는 전부 본문 대상과
  // 짝이 맞아야 한다(광폭 표시·숨김은 CSS 몫이라 하니스가 잰다).
  it('우측 바로가기 목차가 현재 단계 소절과 짝이 맞고 단계를 따라 바뀐다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    const hrefs = () => Array.from(container.querySelectorAll('[data-testid="intake-toc"] a'))
      .map((anchor) => anchor.getAttribute('href') ?? '');

    for (let step = 1; step <= 4; step += 1) {
      fireEvent.click(scoped.getByRole('button', { name: new RegExp(`^${step}\\.`) }));
      const anchors = hrefs();
      expect(anchors.length).toBeGreaterThanOrEqual(3);
      for (const href of anchors) {
        expect(container.querySelector(href), `${step}단계 ${href} 대상 없음`).not.toBeNull();
      }
    }

    // 단계를 따라 바뀐다 — 2단계 목차에는 부채 표가 있고 1단계 항목(기본정보)은 없다.
    fireEvent.click(scoped.getByRole('button', { name: /^2\./ }));
    expect(hrefs().some((href) => href.includes('부채'))).toBe(true);
    expect(hrefs().some((href) => href.includes('기본정보'))).toBe(false);
  });

  it('현재 단계 제목은 조회 버튼 유무와 무관한 공용 툴바 줄에 선다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fireEvent.click(scoped.getByRole('button', { name: /^2\./ }));

    const heading = scoped.getByRole('heading', { level: 2, name: '2. 현재 생활상황' });
    expect(heading.parentElement?.classList.contains('intake-step-toolbar')).toBe(true);
  });

  it('자동 채움 항목(상담일·실무자·회차)은 1-3 소절 안에 있다', () => {
    const { container } = renderWizard();
    // 소절 상자는 WireCard 다(2026-08-05 컴포넌트화) — h3 는 제목 슬롯 안이라 카드로 올라간다.
    const operations = [...container.querySelectorAll('h3')]
      .find((el) => el.textContent === '1-3. 상담 운영정보')?.closest('.wire-card');
    expect(operations).not.toBeUndefined();

    const scoped = within(operations as HTMLElement);
    expect(scoped.getByLabelText('상담일 날짜')).not.toBeNull();
    expect(scoped.getByText('상담 회차')).not.toBeNull();
    // 정본 1-3 의 나머지 항목도 같은 상자 안이다 — 소절이 쪼개지지 않았다.
    expect(scoped.getByText(/상담 방법/)).not.toBeNull();
  });

  it('1단계 기본정보와 동의 여섯 영역은 읽기 전용이다', () => {
    const { container } = renderWizard(consentStates({ external_stt_processing: 'unconfirmed' }));
    const scoped = within(container);

    const basic = scoped.getByTestId('intake-basic-info');
    expect(within(basic).getByText('서울시 은평구')).not.toBeNull();
    expect(within(basic).getByText('1984-03-11')).not.toBeNull();
    expect(within(basic).getByText('여성')).not.toBeNull();
    expect(basic.querySelectorAll('input, select, textarea').length).toBe(0);

    const consent = scoped.getByTestId('intake-consent-status');
    expect(consent.querySelectorAll('input, select, textarea').length).toBe(0);
    const sections = [...consent.querySelectorAll('.wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual(
      CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].label),
    );
    for (const domain of CONSENT_DOMAINS) {
      expect(consent.textContent).toContain(CONSENT_COPY[domain].copy);
    }
    expect(within(consent).getByText('당사자 정보로 이동')).not.toBeNull();
  });

  // CCC-37: 1-1 의 '수정' 링크는 기본정보 수정 화면으로 간다. 동의 링크(허브)와 목적지가 다르다.
  it('1-1 기본정보 수정 링크는 기본정보 수정 화면을 가리킨다', () => {
    const { container } = renderWizard(consentStates({ external_stt_processing: 'unconfirmed' }));
    const scoped = within(container);
    const basicEdit = within(scoped.getByTestId('intake-basic-info'))
      .getByText('당사자 등록 정보에서 수정') as HTMLAnchorElement;
    expect(basicEdit.getAttribute('href')).toBe('/participants/swallow-003/edit');
    const consentLink = within(scoped.getByTestId('intake-consent-status'))
      .getByText('당사자 정보로 이동') as HTMLAnchorElement;
    expect(consentLink.getAttribute('href')).toBe('/participants/swallow-003');
  });

  it('목표·GAS·동의 입력 칸을 더 이상 두지 않는다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    expect(scoped.queryByLabelText('목표 1')).toBeNull();
    expect(scoped.queryByLabelText('목표 1 GAS 기준')).toBeNull();
    expect(scoped.queryByLabelText('개인정보 수집·이용 동의')).toBeNull();
  });

  it('상담일을 자동으로 채운다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    // D48: 한 칸이던 상담일이 날짜 칸 + 시각 칸으로 나뉘었다. 자동 채움은 둘 다 채워야 한다.
    expect((scoped.getByLabelText('상담일 날짜') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((scoped.getByLabelText('상담일 시각') as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/);
    expect(scoped.getByTestId('intake-missing').textContent).not.toContain('1. 상담일');
    const firstStepCount = container.querySelector('.intake-step-count');
    expect(firstStepCount?.textContent).toBe('1/11');
    fireEvent.change(scoped.getByLabelText('상담일 날짜'), { target: { value: '' } });
    expect(firstStepCount?.textContent).toBe('0/11');
  });

  it('전 항목이 비면 완료를 눌러도 저장되지 않고 빈 칸·단계가 red 로 표시된다', () => {
    // 2026-08-09 Q: 완료는 **비활성이 아니다** — 못 눌리는 버튼은 왜 못 누르는지도 말해 주지
    // 않는다. 눌러 본 뒤부터 빈 칸이 스스로를 알린다(칸 테두리 + 좌측 단계 red).
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    expect(completeButton(scoped).disabled).toBe(false);
    expect(container.querySelectorAll('.intake-step[data-step-state="missing"]').length).toBe(0);

    fireEvent.click(completeButton(scoped));
    expect(getLastInput()).toBeNull();
    expect(scoped.getByTestId('intake-missing').textContent).toContain('완료하려면 필수 항목을 채우세요');
    // 남은 단계는 왼쪽 진행 단계에서 red 로 선다.
    expect(container.querySelectorAll('.intake-step[data-step-state="missing"]').length).toBeGreaterThan(0);
    // 빈 필수 칸은 입력 오류와 같은 어휘로 표시된다(§5 입력칸 오류).
    expect(container.querySelectorAll('.wire-input-box[data-invalid="true"]').length).toBeGreaterThan(0);
  });

  it('질문 밖 필수 3개(부채 표·연계 기관 표 첫 열, 종합의견)도 비면 저장되지 않는다', () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    // 전부 채우면 안내가 사라진다.
    expect(scoped.queryByTestId('intake-missing')).toBeNull();

    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.change(scoped.getByLabelText('담당 실무자 종합의견'), { target: { value: '  ' } });
    fireEvent.click(completeButton(scoped));
    expect(getLastInput()).toBeNull();
    expect(scoped.getByTestId('intake-missing')).not.toBeNull();

    fireEvent.change(scoped.getByLabelText('담당 실무자 종합의견'), { target: { value: '우선순위 높음' } });
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));
    fireEvent.change(scoped.getByLabelText('기관·채권자 1'), { target: { value: '' } });
    fireEvent.click(completeButton(scoped));
    expect(getLastInput()).toBeNull();
    expect(scoped.getByTestId('intake-missing')).not.toBeNull();
  });

  it("'무응답'은 빈칸이 아니라 응답 코드로 저장된다", async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);

    expect(completeButton(scoped).disabled).toBe(false);
    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    const answers = getLastInput()?.questionnaire.answers ?? [];
    expect(answers).toContainEqual({ key: 'public_benefits', response: 'unknown' });
    expect(answers).toContainEqual({ key: 'difficulty_areas', response: 'unknown' });
    expect(answers).toContainEqual({ key: 'contact_caution', response: 'answered', text: 'contact_caution 내용' });
  });

  it('긴급도는 실무자가 고른 값 그대로 저장된다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.change(scoped.getByLabelText('긴급도'), { target: { value: '즉시 개입 필요' } });

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.questionnaire.answers).toContainEqual({
      key: 'summary_urgency', response: 'answered', text: '위기',
    });
  });

  // CCC-57: 인테이크에는 완료 배선 자체가 없어서 인테이크를 마쳐도 그 약속이 계속
  // '예정'으로 남았다. 기본은 켬이고, 두 값은 언제나 함께 실린다(한쪽만 오면 서버가
  // 버전 검사를 못 한다).
  it('연결된 예정 일정을 기본으로 완료 처리한다', async () => {
    const { container, getLastInput } = renderWizard(undefined, { schedule: LINKED_SCHEDULE });
    const scoped = within(container);
    fillAllQuestions(scoped);

    const card = scoped.getByTestId('intake-schedule-completion');
    const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.scheduleId).toBe(LINKED_SCHEDULE.id);
    expect(getLastInput()?.expectedScheduleVersion).toBe(LINKED_SCHEDULE.version);
  });

  it('체크를 풀면 일정을 완료로 넘기지 않는다', async () => {
    const { container, getLastInput } = renderWizard(undefined, { schedule: LINKED_SCHEDULE });
    const scoped = within(container);
    fillAllQuestions(scoped);

    const card = scoped.getByTestId('intake-schedule-completion');
    fireEvent.click(card.querySelector('input[type="checkbox"]') as HTMLInputElement);

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // 둘 다 빠진다. 한쪽만 남으면 경계 검증이 요청을 통째로 막는다.
    expect(getLastInput()?.scheduleId).toBeUndefined();
    expect(getLastInput()?.expectedScheduleVersion).toBeUndefined();
  });

  it('예정 일정이 없으면 완료 카드를 그리지 않는다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    expect(scoped.queryByTestId('intake-schedule-completion')).toBeNull();

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.scheduleId).toBeUndefined();
  });

  // 수정 경로에는 일정 연결 자리가 없다(서버 파서가 허용 키로 막는다). 실수로 실리면
  // 인테이크 수정 자체가 통째로 거부되므로, 위저드 안에서도 한 겹 더 막는다.
  it('수정 모드에서는 예정 일정이 있어도 완료 배선을 걸지 않는다', async () => {
    push.mockClear();
    let lastInput: CreateIntakeRecordActionInput | null = null;
    const { container } = render(
      <IntakeWizard
        mode="edit"
        beneficiaryId="swallow-003"
        writeSchemaVersion={3}
        moduleSnapshot={MODULE_SNAPSHOT}
        supportCaseId="11111111-1111-4111-8111-111111111111"
        submissionId="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
        participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
        extendedPii={{ birthDate: '1984-03-11', region: '서울시 은평구', emergencyContact: null, gender: '여성' }}
        consent={consentStates()}
        sessionSequence={2}
        recorderLabel="이지은"
        briefingHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records/intake"
        participantHref="/participants/swallow-003"
        basicInfoHref="/participants/swallow-003/edit"
        overallGoal={null}
        overallGoalErrorHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=overall_goal_error"
        initial={{
          heldAt: '2026-08-01T05:00:00.000Z',
          answers: [],
          debts: [],
          linkedOrgs: [],
          additionalItems: [],
          managerOpinion: '기존 의견',
          schemaVersion: 2,
          revision: 1,
          questionLifecycle: { version: 1, items: [], conversion: null },
        }}
        schedule={LINKED_SCHEDULE}
        submit={async (input) => {
          lastInput = input;
          return { status: 'saved', revision: 2, overallGoalSaved: true };
        }}
      />,
    );
    const scoped = within(container);
    fillAllQuestions(scoped);
    expect(scoped.queryByTestId('intake-schedule-completion')).toBeNull();
    expect([...container.querySelectorAll('.intake-step-count')].every((node) => /^\d+\/\d+$/.test(node.textContent ?? ''))).toBe(true);

    const hero = container.querySelector('.participant-hero-card');
    expect(hero).not.toBeNull();
    fireEvent.click(within(hero as HTMLElement).getByRole('button', { name: '수정 완료' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect((lastInput as CreateIntakeRecordActionInput | null)?.scheduleId).toBeUndefined();
  });

  it('목표를 보내지 않고, 동의·6영역·원하는 도움도 보내지 않는다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    const input = getLastInput();
    expect(input).not.toBeNull();
    for (const legacyKey of ['goals', 'consent', 'lifeAreas', 'helpNarrative', 'actions']) {
      expect(Object.hasOwn(input!, legacyKey)).toBe(false);
    }
    // 전체 목표 칸(D62)을 안 건드리면 키 자체가 없다.
    expect(input?.overallGoal).toBeUndefined();
    expect(input?.channel).toBe('in_person');
  });

  it.each([
    ['invalid_request', '입력한 내용을 다시 확인하세요.'],
    ['forbidden', '지금은 읽기만 할 수 있어요. 저장된 내용은 계속 확인할 수 있어요.'],
    ['conflict', '다른 곳에서 먼저 저장됐어요. 다시 불러온 뒤 이어서 작성해 주세요.'],
  ] as const)('%s 저장 실패를 구분하고 입력값을 유지한다', async (status, message) => {
    const { container } = renderWizard(undefined, { result: { status } });
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    const opinion = scoped.getByLabelText('담당 실무자 종합의견') as HTMLTextAreaElement;

    fireEvent.click(completeButton(scoped));

    await waitFor(() => expect(scoped.getByRole('alert').textContent).toBe(message));
    expect(opinion.value).toBe('우선순위 높음');
    expect(push).not.toHaveBeenCalled();
  });

  it('schema 3 봉투와 추가 확인사항 행 결합을 만들어 보낸다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    const table = scoped.getByTestId('intake-additional-table');
    fireEvent.click(within(table).getByRole('button', { name: '줄 추가' }));
    fireEvent.change(scoped.getByLabelText('추가 확인사항 1'), { target: { value: '소득 확인' } });

    fireEvent.click(completeButton(scoped));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const input = getLastInput();
    expect(input?.schemaVersion).toBe(3);
    expect(() => parseIntakeQuestionnaire(input?.questionnaire)).not.toThrow();
    expect(input?.additionalItemRefs).toEqual([
      { rowIndex: 0, questionId: null, expectedRevision: null },
    ]);
    expect(input?.questionWithdrawals).toEqual([]);
  });

  it('기존 행 삭제는 질문 ID 철회로 보내고 남은 행 결합을 유지한다', async () => {
    const { container, getLastInput } = renderWizard(undefined, {
      mode: 'edit',
      initial: BOUND_EDIT_INITIAL,
    });
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.click(within(scoped.getByTestId('intake-additional-table')).getByRole('button', { name: '이 줄 삭제' }));

    fireEvent.click(scoped.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.additionalItemRefs).toEqual([
      { rowIndex: 0, questionId: 'question-retained', expectedRevision: 2 },
    ]);
    expect(getLastInput()?.questionWithdrawals).toEqual([
      { questionId: 'question-withdrawn', expectedRevision: 3 },
    ]);
  });

  it('기존 행의 내용을 비운 생략은 삭제나 철회로 보내지 않는다', async () => {
    const { container, getLastInput } = renderWizard(undefined, {
      mode: 'edit',
      initial: BOUND_EDIT_INITIAL,
    });
    const scoped = within(container);
    fillAllQuestions(scoped);

    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.change(scoped.getByLabelText('추가 확인사항 1'), { target: { value: '' } });

    fireEvent.click(scoped.getByRole('button', { name: '저장' }));

    expect(getLastInput()).toBeNull();
    expect(scoped.getByRole('alert').textContent).toContain('필수 항목');
  });
  it('미결합 schema 2는 원본 revision 확인 뒤 legacy 행 위치를 보존해 전환한다', async () => {
    const initial = {
      ...BOUND_EDIT_INITIAL,
      revision: 5,
      questionLifecycle: null,
    };
    const { container, getLastInput } = renderWizard(undefined, { mode: 'edit', initial });
    const scoped = within(container);
    fillAllQuestions(scoped);

    fireEvent.click(scoped.getByRole('button', { name: '저장' }));
    expect(getLastInput()).toBeNull();
    expect(scoped.getByRole('alert').textContent).toContain('원본 보존과 전환');

    fireEvent.click(scoped.getByRole('checkbox', {
      name: '이전 원본을 보존하고 새 양식에 직접 작성해 전환할 것을 확인했어요',
    }));
    fireEvent.click(scoped.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.conversion).toEqual({ confirmed: true, sourceRevision: 5 });
    expect(getLastInput()?.additionalItemRefs).toEqual([
      { rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 },
      { rowIndex: 1, questionId: null, expectedRevision: null, legacySourceRowIndex: 1 },
    ]);
    expect(getLastInput()?.questionWithdrawals).toEqual([]);
  });

  // ── 전체 목표 칸 (D62 · ADR-0032 §2 · CCC-68) ────────────────────────────────
  it('4단계에 전체 목표 칸이 안내 문구·질문지 참고 값과 함께 선다', () => {
    const { container } = renderWizard();
    const scoped = within(container);

    // 3-1 지원욕구·4-3 지원방향을 답하면 전체 목표 카드가 참고로 되비춘다.
    fireEvent.click(scoped.getByRole('button', { name: /3\. 필요한 도움과 활용 가능한 자원/ }));
    fireEvent.change(scoped.getByLabelText('1순위 지원욕구'), { target: { value: '주거지원' } });
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.change(scoped.getByLabelText('주요 지원방향'), { target: { value: '사례관리 진행' } });

    const card = scoped.getByTestId('intake-overall-goal');
    expect(card.textContent).toContain('첫 상담에서 합의가 어려우면 비워 두세요. 본 상담에서 채워도 됩니다');
    expect(card.textContent).toContain('주거지원');
    expect(card.textContent).toContain('사례관리 진행');
    // 아직 안 답한 참고 값은 그 사실을 그대로 말한다.
    expect(card.textContent).toContain('아직 답하지 않음');
    // 질문지 항목이 아니라 무응답 선택지가 없다(D62 — '전 항목 필수'의 예외).
    expect(within(card).queryByRole('button', { name: '무응답' })).toBeNull();
  });

  it('전체 목표를 적으면 제출에 실리고, 빈 채로 두면 완료를 막지 않는다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.change(scoped.getByLabelText(/^전체 목표/), { target: { value: '  3개월 안에 채무조정 신청을 마친다  ' } });
    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // 앞뒤 공백은 잘라 보낸다 — 게이트웨이 비교·이력이 공백 차이로 갈리지 않는다.
    expect(getLastInput()?.overallGoal).toBe('3개월 안에 채무조정 신청을 마친다');
  });

  it('프리필된 전체 목표를 지우면 null(설정 전으로 되돌림)로 실린다', async () => {
    const { container, getLastInput } = renderWizard(undefined, { overallGoal: '기존 전체 목표' });
    const scoped = within(container);
    fillAllQuestions(scoped);
    const goalInput = scoped.getByLabelText(/^전체 목표/) as HTMLInputElement;
    // 15초 페이지 카드에서 먼저 적은 값이 프리필로 서 있다 — 빈 칸 시작이면 저장이 지워 버린다.
    expect(goalInput.value).toBe('기존 전체 목표');
    fireEvent.change(goalInput, { target: { value: '' } });
    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.overallGoal).toBeNull();
  });

  it('인테이크는 저장됐는데 전체 목표만 실패하면 15초 페이지 오류 안내로 보낸다', async () => {
    const { container } = renderWizard(undefined, { overallGoalSaved: false });
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.change(scoped.getByLabelText(/^전체 목표/), { target: { value: '새 전체 목표' } });
    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(
      '/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=overall_goal_error',
    );
  });

  it('반복 행 표(부채·연계 기관·추가 확인사항)를 저장하고 브리핑으로 보낸다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);

    // 부채·연계 기관 표는 첫 줄이 처음부터 있다(정본: 없으면 첫 행에 '해당 없음').
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));
    fireEvent.click(scoped.getByLabelText('현재 어려움 관련 영역 경제'));
    fireEvent.change(scoped.getByLabelText('기관·채권자 1'), { target: { value: 'OO은행' } });
    fireEvent.change(scoped.getByLabelText('잔액 1'), { target: { value: '1,200만 원' } });

    fireEvent.click(scoped.getByRole('button', { name: /3\. 필요한 도움과 활용 가능한 자원/ }));
    fireEvent.change(scoped.getByLabelText('기관명 1'), { target: { value: 'OO구 주민센터' } });

    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.click(within(scoped.getByTestId('intake-additional-table')).getByRole('button', { name: '줄 추가' }));
    fireEvent.change(scoped.getByLabelText('추가 확인사항 1'), { target: { value: '전체 채무 잔액' } });
    fireEvent.change(scoped.getByLabelText('확인 예정 시점 1'), { target: { value: '다음 상담 전' } });
    fireEvent.change(scoped.getByLabelText('담당 실무자 종합의견'), { target: { value: '우선순위 높음' } });

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    const input = getLastInput();
    expect(input?.questionnaire.debts).toEqual({
      response: 'answered',
      rows: [{ creditor: 'OO은행', balance: '1,200만 원' }],
    });
    expect(input?.questionnaire.linkedOrgs).toEqual({
      response: 'answered',
      rows: [{ orgName: 'OO구 주민센터' }],
    });
    expect(input?.questionnaire.additionalItems).toEqual({
      response: 'answered',
      rows: [{ item: '전체 채무 잔액', dueNote: '다음 상담 전' }],
    });
    expect(input?.questionnaire.answers).toContainEqual({
      key: 'managerOpinion',
      response: 'answered',
      text: '우선순위 높음',
    });
    expect(push).toHaveBeenCalledWith('/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=intake_saved');
  });
});
