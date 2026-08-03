import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { IntakeWizard } from './intake-wizard';
import { STEP_GROUPS } from './intake-questions';
import { draftKey, readDraft, writeDraft } from '../../../../../../lib/form-draft';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';

// 인테이크 위저드의 로컬 자동 저장·복원(CCC-12).
// 이 파일의 첫 테스트가 가장 중요한 것이다 — 금고에서 내려온 개인정보가 브라우저 저장소로
// 새지 않는지. 폼 상태를 통째로 직렬화하면 테스트는 다 통과하면서 이 항목만 조용히 깨진다.

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = draftKey('intake', SUPPORT_CASE_ID);

const VAULT_PII = {
  birthDate: '1990-03-17',
  region: '서울 성북구',
  emergencyContact: '010-9876-5432',
  gender: '여성',
};

function renderWizard(extendedPii = VAULT_PII) {
  push.mockClear();
  let lastInput: CreateIntakeRecordActionInput | null = null;
  const submit = async (input: CreateIntakeRecordActionInput): Promise<IntakeRecordActionResult> => {
    lastInput = input;
    return { status: 'saved' };
  };
  const utils = render(
    <IntakeWizard
      beneficiaryId="swallow-003"
      supportCaseId={SUPPORT_CASE_ID}
      submissionId="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
      participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
      extendedPii={extendedPii}
      consent={{ privacy: true, recordingAi: true }}
      sessionSequence={1}
      recorderLabel="이지은"
      briefingHref="/participants/swallow-003/programs/case/briefing?notice=intake_saved"
      participantHref="/participants/swallow-003"
      basicInfoHref="/participants/swallow-003/edit"
      submit={submit}
    />,
  );
  return { ...utils, getLastInput: () => lastInput };
}

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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('인테이크 임시본', () => {
  it('금고에서 내려온 개인정보는 임시본에 담기지 않는다', async () => {
    const { container } = renderWizard();
    const scoped = within(container);

    fireEvent.change(scoped.getByLabelText('기타 공적급여'), { target: { value: '기초연금 수급' } });

    await waitFor(() => {
      expect(readDraft(KEY)).not.toBeNull();
    }, { timeout: 3000 });

    // 값 하나하나가 아니라 저장된 문자열 전체를 훑는다 — 어느 필드로 새든 잡힌다.
    const raw = window.localStorage.getItem(KEY) as string;
    for (const value of Object.values(VAULT_PII)) {
      expect(raw).not.toContain(value);
    }
    expect(raw).not.toContain('010-1234-5678');
    expect(raw).not.toContain('홍서희');
    // 실무자가 이 화면에서 직접 쓴 내용은 담긴다(그것이 이 기능의 목적이다).
    expect(raw).toContain('기초연금 수급');
  });

  it('작성하던 임시본이 있으면 이어쓰기 배너를 띄우고 입력을 되돌린다', () => {
    writeDraft(KEY, {
      step: 2,
      heldAt: '2026-07-20T13:00',
      answers: {
        welfare_other: { response: 'answered', text: '기초연금 수급' },
        welfare_basic_livelihood: { response: 'unknown', text: '' },
      },
      debts: [], linkedOrgs: [], additionalItems: [], managerOpinion: '',
    }, 'editing');

    const { container, getByTestId, getByRole } = renderWizard();
    const scoped = within(container);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    // 고르기 전에는 단계도 입력도 건드리지 않는다.
    expect(scoped.getByRole('heading', { name: '1. 상담 신청 및 기본정보' })).not.toBeNull();

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect(scoped.getByRole('heading', { name: '2. 현재 생활상황' })).not.toBeNull();
    fireEvent.click(scoped.getByRole('button', { name: /^1\./ }));
    expect((scoped.getByLabelText('기타 공적급여') as HTMLTextAreaElement).value).toBe('기초연금 수급');
    expect((scoped.getByLabelText('기초생활보장 수급 여부') as HTMLSelectElement).value).toBe('무응답');
  });

  it('배포 사이에 모양이 달라진 임시본을 되돌려도 화면이 죽지 않는다', () => {
    // 보관 12시간은 배포를 건너뛴다. 필드가 빠졌거나 타입이 다른 임시본이 실제로 들어온다.
    writeDraft(KEY, {
      step: 99,
      heldAt: 42,
      answers: { welfare_other: { response: 'answered', text: '남아 있던 내용' }, unknown_key: null },
      debts: 'not-an-array',
    }, 'editing');

    const { container, getByRole } = renderWizard();
    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    const scoped = within(container);
    // 살릴 수 있는 것은 살리고, 나머지는 기본값으로 떨어진다.
    expect((scoped.getByLabelText('기타 공적급여') as HTMLTextAreaElement).value).toBe('남아 있던 내용');
  });

  it('서버 저장에 성공하면 임시본을 지운다', async () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fillAllQuestions(scoped);

    await waitFor(() => {
      expect(readDraft(KEY)).not.toBeNull();
    }, { timeout: 3000 });

    fireEvent.click(scoped.getByRole('button', { name: '완료' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    }, { timeout: 3000 });
    expect(readDraft(KEY)).toBeNull();
  });

  it('자동 저장 상태를 상시 표시한다', async () => {
    const { container, getByTestId } = renderWizard();
    const scoped = within(container);
    expect(getByTestId('draft-status').textContent).toBe('자동 저장 대기');

    fireEvent.change(scoped.getByLabelText('기타 공적급여'), { target: { value: '기초연금 수급' } });

    await waitFor(() => {
      expect(getByTestId('draft-status').textContent).toContain('자동 저장됨');
    }, { timeout: 3000 });
  });
});
