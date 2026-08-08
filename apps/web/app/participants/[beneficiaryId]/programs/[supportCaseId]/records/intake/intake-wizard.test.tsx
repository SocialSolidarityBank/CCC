import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, within, fireEvent, waitFor } from '@testing-library/react';
import { IntakeWizard } from './intake-wizard';
import { ACTIVE_QUESTIONS, STEP_GROUPS } from './intake-questions';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(cleanup);

/** CCC-57 연결 일정. 화면에 뜨는 표기와 제출 페이로드 둘 다 이 값으로 검증한다. */
const LINKED_SCHEDULE = { id: '22222222-2222-4222-8222-222222222222', scheduledAt: '2026-08-12T05:00:00.000Z', version: 3 };

function renderWizard(
  consent = { privacy: true, recordingAi: true },
  extra: { schedule?: typeof LINKED_SCHEDULE | null } = {},
) {
  push.mockClear();
  let lastInput: CreateIntakeRecordActionInput | null = null;
  const submit = async (input: CreateIntakeRecordActionInput): Promise<IntakeRecordActionResult> => {
    lastInput = input;
    return { status: 'saved' };
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
      participantHref="/participants/swallow-003"
      basicInfoHref="/participants/swallow-003/edit"
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
        fireEvent.change(scoped.getByLabelText(question.label), { target: { value: `${question.key} 내용` } });
      }
    }
    // 질문 밖의 필수 3개: 2-1 부채 표·3-3 연계 기관 표의 첫 열(정본: 없으면 '해당 없음')과 종합의견.
    if (step === 2) fireEvent.change(scoped.getByLabelText('기관·채권자 1'), { target: { value: '해당 없음' } });
    if (step === 3) fireEvent.change(scoped.getByLabelText('기관명 1'), { target: { value: '해당 없음' } });
    if (step === 4) fireEvent.change(scoped.getByLabelText('담당 실무자 종합의견'), { target: { value: '우선순위 높음' } });
  }
}

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

  it('1단계 기본정보와 동의는 읽기 전용이다 — 입력 칸이 없다', () => {
    const { container } = renderWizard({ privacy: true, recordingAi: false });
    const scoped = within(container);

    const basic = scoped.getByTestId('intake-basic-info');
    expect(within(basic).getByText('서울시 은평구')).not.toBeNull();
    expect(within(basic).getByText('1984-03-11')).not.toBeNull();
    expect(within(basic).getByText('여성')).not.toBeNull();
    // 기본정보 카드 안에는 어떤 입력 컨트롤도 없다(저장은 당사자 등록 몫, D42 ①).
    expect(basic.querySelectorAll('input, select, textarea').length).toBe(0);

    const consent = scoped.getByTestId('intake-consent-status');
    expect(consent.querySelectorAll('input, select, textarea').length).toBe(0);
    expect(consent.textContent).toContain('미기록');
    // D44: 동의를 고치는 자리는 당사자 정보 페이지다 — 인테이크는 읽기만 한다.
    expect(within(consent).getByText('당사자 정보로 이동')).not.toBeNull();
  });

  // CCC-37: 1-1 의 '수정' 링크는 기본정보 수정 화면으로 간다. 동의 링크(허브)와 목적지가 다르다.
  it('1-1 기본정보 수정 링크는 기본정보 수정 화면을 가리킨다', () => {
    const { container } = renderWizard({ privacy: true, recordingAi: false });
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

    const answers = getLastInput()?.answers ?? [];
    // 화면에 뜬 질문 전부가 제출된다(전 항목 필수).
    expect(answers).toHaveLength(ACTIVE_QUESTIONS.length);
    expect(answers).toContainEqual({ key: 'welfare_basic_livelihood', response: 'unknown' });
    expect(answers).toContainEqual({ key: 'difficulty_areas', response: 'unknown' });
    expect(answers).toContainEqual({ key: 'welfare_other', response: 'answered', text: 'welfare_other 내용' });
  });

  it('긴급도는 실무자가 고른 값 그대로 저장된다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);
    fireEvent.click(scoped.getByRole('button', { name: /4\. 상담 정리와 후속관리/ }));
    fireEvent.change(scoped.getByLabelText('긴급도'), { target: { value: '즉시 개입 필요' } });

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(getLastInput()?.answers).toContainEqual({
      key: 'summary_urgency', response: 'answered', text: '즉시 개입 필요',
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
        supportCaseId="11111111-1111-4111-8111-111111111111"
        submissionId="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
        participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
        extendedPii={{ birthDate: '1984-03-11', region: '서울시 은평구', emergencyContact: null, gender: '여성' }}
        consent={{ privacy: true, recordingAi: true }}
        sessionSequence={2}
        recorderLabel="이지은"
        briefingHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/records/intake"
        participantHref="/participants/swallow-003"
        basicInfoHref="/participants/swallow-003/edit"
        initial={{
          heldAt: '2026-08-01T05:00:00.000Z',
          answers: [],
          debts: [],
          linkedOrgs: [],
          additionalItems: [],
          managerOpinion: '기존 의견',
        }}
        schedule={LINKED_SCHEDULE}
        submit={async (input) => { lastInput = input; return { status: 'saved' }; }}
      />,
    );
    const scoped = within(container);
    fillAllQuestions(scoped);
    expect(scoped.queryByTestId('intake-schedule-completion')).toBeNull();

    fireEvent.click(scoped.getByRole('button', { name: '저장' }));
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
    expect(input?.goals).toBeUndefined();
    expect(input?.consent).toBeUndefined();
    expect(input?.lifeAreas).toBeUndefined();
    expect(input?.helpNarrative).toBeUndefined();
    expect(input?.actions).toBeUndefined();
    // 상담 방법 6종은 답변으로 남고, 채널 컬럼에는 좁힌 값이 들어간다.
    expect(input?.channel).toBe('in_person');
  });

  it('반복 행 표(부채·연계 기관·추가 확인사항)를 저장하고 브리핑으로 보낸다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);

    // 부채·연계 기관 표는 첫 줄이 처음부터 있다(정본: 없으면 첫 행에 '해당 없음').
    fireEvent.click(scoped.getByRole('button', { name: /2\. 현재 생활상황/ }));
    fireEvent.change(scoped.getByLabelText('기관·채권자 1'), { target: { value: 'OO은행' } });
    fireEvent.change(scoped.getByLabelText('잔액 1'), { target: { value: '1,200만원' } });

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
    expect(input?.debts).toEqual([{ creditor: 'OO은행', balance: '1,200만원' }]);
    expect(input?.linkedOrgs).toEqual([{ orgName: 'OO구 주민센터' }]);
    expect(input?.additionalItems).toEqual([{ item: '전체 채무 잔액', dueNote: '다음 상담 전' }]);
    expect(input?.managerOpinion).toBe('우선순위 높음');
    expect(push).toHaveBeenCalledWith('/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=intake_saved');
  });
});
