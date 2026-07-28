import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { IntakeWizard } from './intake-wizard';
import { draftKey, readDraft, writeDraft } from '../../../../../../lib/form-draft';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';

// 인테이크 위저드의 로컬 자동 저장·복원(CCC-12).
// 이 파일의 첫 테스트가 이 티켓에서 가장 중요한 것이다 — 금고에서 내려온 개인정보가
// 브라우저 저장소로 새지 않는지. 폼 상태를 통째로 직렬화하면 테스트는 다 통과하면서
// 이 항목만 조용히 깨진다.

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
      sessionSequence={1}
      recorderLabel="상담사"
      recordsHref="/participants/swallow-003/programs/case/records"
      scheduleHref="/schedules/new"
      submit={submit}
    />,
  );
  return { ...utils, getLastInput: () => lastInput };
}

function fillRequired(scoped: ReturnType<typeof within>): void {
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
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('인테이크 임시본', () => {
  it('금고에서 내려온 개인정보는 임시본에 담기지 않는다', async () => {
    const { container } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
    fireEvent.change(scoped.getByLabelText('오늘 어떤 도움'), { target: { value: '생계비 상담' } });

    await waitFor(() => {
      expect(readDraft(KEY)).not.toBeNull();
    }, { timeout: 3000 });

    // 값 하나하나가 아니라 저장된 문자열 전체를 훑는다 — 어느 필드로 새든 잡힌다.
    const raw = window.localStorage.getItem(KEY) as string;
    for (const value of Object.values(VAULT_PII)) {
      expect(raw).not.toContain(value);
    }
    // 상담사가 이 화면에서 직접 쓴 내용은 담긴다(그것이 이 기능의 목적이다).
    expect(raw).toContain('생계비 상담');
  });

  it('작성하던 임시본이 있으면 이어쓰기 배너를 띄우고 입력을 되돌린다', () => {
    writeDraft(KEY, {
      step: 3, heldAt: '2026-07-20T13:00', channel: 'in_person',
      consentPrivacy: true, consentRecordingAi: false,
      todayHelp: '생계비 상담', hardestPoint: '월세 체납', desiredChange: '',
      lifeAreas: {}, goals: [], actions: [], managerOpinion: '', answers: {},
      additionalItems: [], nextMeetingAt: '', nextMeetingChannel: 'in_person',
    }, 'editing');

    const { container, getByTestId, getByRole } = renderWizard();
    const scoped = within(container);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    // 고르기 전에는 단계도 입력도 건드리지 않는다.
    expect(scoped.getByRole('heading', { name: '① 시작' })).not.toBeNull();

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect((scoped.getByLabelText('오늘 어떤 도움') as HTMLTextAreaElement).value).toBe('생계비 상담');
    expect((scoped.getByLabelText('가장 힘든 점') as HTMLTextAreaElement).value).toBe('월세 체납');
  });

  it('되돌려도 금고 값은 임시본이 아니라 등록 데이터에서 온다', () => {
    writeDraft(KEY, {
      step: 1, heldAt: '2026-07-20T13:00', channel: 'in_person',
      consentPrivacy: true, consentRecordingAi: false,
      todayHelp: '생계비 상담', hardestPoint: '', desiredChange: '',
      // 임시본에 금고 4종을 억지로 심어도 되돌리기가 그것을 쓰지 않아야 한다.
      birthDate: '2000-01-01', region: '엉뚱한 지역', emergencyContact: '010-0000-0000', gender: '남성',
      lifeAreas: {}, goals: [], actions: [], managerOpinion: '', answers: {},
      additionalItems: [], nextMeetingAt: '', nextMeetingChannel: 'in_person',
    }, 'editing');

    const { container, getByRole } = renderWizard();
    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    const scoped = within(container);
    expect((scoped.getByLabelText('생년월일') as HTMLInputElement).value).toBe(VAULT_PII.birthDate);
    expect((scoped.getByLabelText('거주 지역') as HTMLInputElement).value).toBe(VAULT_PII.region);
    expect((scoped.getByLabelText('긴급 연락처') as HTMLInputElement).value).toBe(VAULT_PII.emergencyContact);
    expect((scoped.getByLabelText('성별') as HTMLInputElement).value).toBe(VAULT_PII.gender);
  });

  it('배포 사이에 모양이 달라진 임시본을 되돌려도 화면이 죽지 않는다', () => {
    // 보관 12시간은 배포를 건너뛴다. 필드가 빠졌거나 타입이 다른 임시본이 실제로 들어온다.
    writeDraft(KEY, {
      step: 99, heldAt: 42, channel: 'telepathy',
      todayHelp: '남아 있던 내용',
      lifeAreas: { economy: '괜찮음' }, goals: 'not-an-array', answers: { referral_path: null },
    }, 'editing');

    const { container, getByRole } = renderWizard();
    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    const scoped = within(container);
    // 살릴 수 있는 것은 살리고, 나머지는 기본값으로 떨어진다.
    fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
    expect((scoped.getByLabelText('오늘 어떤 도움') as HTMLTextAreaElement).value).toBe('남아 있던 내용');
  });

  it('서버 저장에 성공하면 임시본을 지운다', async () => {
    const { container } = renderWizard();
    const scoped = within(container);
    fillRequired(scoped);

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

    fireEvent.click(scoped.getByRole('button', { name: /3\. 원하는 도움/ }));
    fireEvent.change(scoped.getByLabelText('오늘 어떤 도움'), { target: { value: '생계비 상담' } });

    await waitFor(() => {
      expect(getByTestId('draft-status').textContent).toContain('자동 저장됨');
    }, { timeout: 3000 });
  });
});
