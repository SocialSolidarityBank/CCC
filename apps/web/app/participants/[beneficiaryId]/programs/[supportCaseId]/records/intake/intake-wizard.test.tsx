import { describe, it, expect, vi } from 'vitest';
import { render, within, fireEvent, waitFor } from '@testing-library/react';
import { IntakeWizard } from './intake-wizard';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function renderWizard() {
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
      extendedPii={{ birthDate: null, region: null, emergencyContact: null, gender: null }}
      sessionSequence={1}
      recorderLabel="실무자"
      briefingHref="/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=intake_saved"
      submit={submit}
    />,
  );
  return { ...utils, getLastInput: () => lastInput };
}

/** P1 최소 입력(동의·호소 3문·6영역·목표·행동)만 채워 완료 가능 상태로 만든다. */
function fillRequired(scoped: ReturnType<typeof within>, areaStatus: Record<string, string> = {}): void {
  fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });
  fireEvent.click(scoped.getByRole('button', { name: /2\. 동의/ }));
  fireEvent.click(scoped.getByLabelText('개인정보 수집·이용 동의'));
  fireEvent.click(scoped.getByLabelText('녹음·AI 정리 동의'));
  fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
  fireEvent.change(scoped.getByLabelText('오늘 어떤 도움'), { target: { value: '생계비 상담' } });
  fireEvent.change(scoped.getByLabelText('가장 힘든 점'), { target: { value: '월세 체납' } });
  fireEvent.change(scoped.getByLabelText('어떻게 달라지면'), { target: { value: '안정적으로' } });
  fireEvent.click(scoped.getByRole('button', { name: /4\. 생활 상황/ }));
  for (const label of ['경제·생계', '주거', '일·고용·학업', '건강', '심리·정서', '가족·관계·돌봄']) {
    fireEvent.change(scoped.getByLabelText(`${label} 상태`), { target: { value: areaStatus[label] ?? 'okay' } });
  }
  fireEvent.click(scoped.getByRole('button', { name: /5\. 정리/ }));
  fireEvent.change(scoped.getByLabelText('목표 1'), { target: { value: '월세 체납 해소' } });
  fireEvent.change(scoped.getByLabelText('다음 행동 1'), { target: { value: '서류 준비' } });
}

function completeButton(scoped: ReturnType<typeof within>): HTMLButtonElement {
  return scoped.getByRole('button', { name: '완료' }) as HTMLButtonElement;
}

describe('IntakeWizard', () => {
  it('스테퍼로 단계를 이동한다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    expect(scoped.getByRole('heading', { name: '① 시작' })).not.toBeNull();
    fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
    expect(scoped.getByRole('heading', { name: '③ 원하는 도움' })).not.toBeNull();
  });

  it('P1이 비면 완료 버튼이 비활성이고 남은 단계를 안내한다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    expect(completeButton(scoped).disabled).toBe(true);
    expect(scoped.getByTestId('intake-missing').textContent).toContain('2. 동의');
    expect(scoped.getByTestId('intake-missing').textContent).toContain('3. 원하는 도움');
  });

  it('상담 일시를 자동으로 채운다 (P2)', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    // ① 시작의 P2 자동 입력: 마운트 직후 화면을 연 시각이 들어 있다.
    expect((scoped.getByLabelText('상담 일시') as HTMLInputElement).value)
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(scoped.getByTestId('intake-missing').textContent).not.toContain('시작(상담 일시)');
  });

  it('필수 채움 카운트가 동의 단계에서 증가한다', () => {
    const { container } = renderWizard();
    const scoped = within(container);
    // 스테퍼의 동의 단계는 처음 0/2.
    expect(scoped.getByRole('button', { name: /2\. 동의 0\/2/ })).not.toBeNull();
    fireEvent.click(scoped.getByRole('button', { name: /2\. 동의/ }));
    fireEvent.click(scoped.getByLabelText('개인정보 수집·이용 동의'));
    expect(scoped.getByRole('button', { name: /2\. 동의 1\/2/ })).not.toBeNull();
  });

  it('P1을 모두 채우면 완료가 활성화되고 게이트웨이 입력으로 제출한다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);

    fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });

    fireEvent.click(scoped.getByRole('button', { name: /2\. 동의/ }));
    fireEvent.click(scoped.getByLabelText('개인정보 수집·이용 동의'));
    fireEvent.click(scoped.getByLabelText('녹음·AI 정리 동의'));

    fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
    fireEvent.change(scoped.getByLabelText('오늘 어떤 도움'), { target: { value: '생계비 상담' } });
    fireEvent.change(scoped.getByLabelText('가장 힘든 점'), { target: { value: '월세 체납' } });
    fireEvent.change(scoped.getByLabelText('어떻게 달라지면'), { target: { value: '안정적으로' } });

    fireEvent.click(scoped.getByRole('button', { name: /4\. 생활 상황/ }));
    for (const label of ['경제·생계', '주거', '일·고용·학업', '건강', '심리·정서', '가족·관계·돌봄']) {
      fireEvent.change(scoped.getByLabelText(`${label} 상태`), { target: { value: 'okay' } });
    }

    fireEvent.click(scoped.getByRole('button', { name: /5\. 정리/ }));
    fireEvent.change(scoped.getByLabelText('목표 1'), { target: { value: '월세 체납 해소' } });
    fireEvent.change(scoped.getByLabelText('다음 행동 1'), { target: { value: '서류 준비' } });

    const complete = completeButton(scoped);
    expect(complete.disabled).toBe(false);
    fireEvent.click(complete);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const input = getLastInput();
    expect(input?.consent).toEqual({ privacy: true, recordingAi: true });
    expect(input?.helpNarrative.todayHelp).toBe('생계비 상담');
    expect(input?.lifeAreas).toHaveLength(6);
    expect(input?.lifeAreas.every((area) => area.status === 'okay')).toBe(true);
    expect(input?.goals[0]?.title).toBe('월세 체납 해소');
    expect(input?.actions[0]?.description).toBe('서류 준비');
  });

  it("생활 영역에 '위기'가 있으면 위기·안전 블록이 자동 펼침·강조된다", () => {
    const { container } = renderWizard();
    const scoped = within(container);

    // 위기가 없을 때: 강조 없음, 질문 접힘.
    fireEvent.click(scoped.getByRole('button', { name: /5\. 정리/ }));
    expect(scoped.getByTestId('intake-crisis-block').getAttribute('data-emphasis')).toBe('false');
    expect(scoped.queryByTestId('intake-crisis-alert')).toBeNull();
    expect((scoped.getByText('위기·안전 질문').closest('details') as HTMLDetailsElement).open).toBe(false);

    // 한 영역이라도 '위기'면 자동 펼침 + 강조 + 경고 문구.
    fireEvent.click(scoped.getByRole('button', { name: /4\. 생활 상황/ }));
    fireEvent.change(scoped.getByLabelText('주거 상태'), { target: { value: 'crisis' } });
    fireEvent.click(scoped.getByRole('button', { name: /5\. 정리/ }));
    expect(scoped.getByTestId('intake-crisis-block').getAttribute('data-emphasis')).toBe('true');
    expect(scoped.getByTestId('intake-crisis-alert').textContent).toContain('주거');
    expect((scoped.getByText('위기·안전 질문').closest('details') as HTMLDetailsElement).open).toBe(true);
  });

  it('답변거부·모름·해당없음을 본문과 구분해 제출한다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillRequired(scoped);

    // ⑤ 정리의 강점·자원(접힘)을 열고 한 문항은 서술, 한 문항은 답변거부로 남긴다.
    fireEvent.click(scoped.getByText('강점·자원 (선택)'));
    fireEvent.change(scoped.getByLabelText('스스로 잘한다고 생각하는 점'), { target: { value: '꾸준함' } });
    // 강점·자원 두 번째 문항(도움을 주고받는 사람)만 답변거부로 표시한다.
    const relational = scoped.getByLabelText('도움을 주고받는 사람').closest('div');
    fireEvent.click(within(relational as HTMLElement).getByRole('button', { name: '답변거부' }));

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    const answers = getLastInput()?.answers ?? [];
    expect(answers).toContainEqual({ key: 'strength_personal', response: 'answered', text: '꾸준함' });
    expect(answers).toContainEqual({ key: 'strength_relational', response: 'declined' });
    // 손대지 않은 문항은 아예 보내지 않는다.
    expect(answers.some((answer) => answer.key === 'strength_resources')).toBe(false);
  });

  it('기본정보와 다음 만남을 제출하고, 저장 뒤 브리핑으로 보낸다', async () => {
    const { container, getLastInput } = renderWizard();
    const scoped = within(container);
    fillRequired(scoped);

    fireEvent.click(scoped.getByRole('button', { name: /1\. 시작/ }));
    fireEvent.click(scoped.getByText('기본정보 더 적기 (선택)'));
    fireEvent.change(scoped.getByLabelText('생년월일'), { target: { value: '1984-03-11' } });
    fireEvent.change(scoped.getByLabelText('거주 지역'), { target: { value: '관악구' } });

    fireEvent.click(scoped.getByRole('button', { name: /5\. 정리/ }));
    fireEvent.change(scoped.getByLabelText('다음 만남 일시'), { target: { value: '2026-08-05T10:00' } });

    fireEvent.click(completeButton(scoped));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    expect(getLastInput()?.extendedPii).toEqual({ birthDate: '1984-03-11', region: '관악구' });
    expect(getLastInput()?.nextMeeting).toEqual({ heldAt: '2026-08-05T10:00', channel: 'in_person' });
    expect(push).toHaveBeenCalledWith('/participants/swallow-003/programs/11111111-1111-4111-8111-111111111111/briefing?notice=intake_saved');
  });
});
