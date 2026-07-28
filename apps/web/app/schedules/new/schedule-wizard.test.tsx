import { describe, it, expect, afterEach } from 'vitest';
import { render, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ScheduleWizard, type ScheduleWizardCandidate } from './schedule-wizard';
import type { CreateSchedulePlanInput, CreateSchedulePlanResult, ScheduleContextResult } from '../../actions';
import { PROGRAM_LABELS } from '../../lib/labels';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);

const candidates: ScheduleWizardCandidate[] = [
  {
    value: 'swallow-003|11111111-1111-1111-8111-111111111111',
    beneficiaryId: 'swallow-003',
    supportCaseId: '11111111-1111-1111-8111-111111111111',
    programLabel: PROGRAM_LABELS.financial_support_v1,
    participantName: '홍서희',
    participantPhone: '010-1234-5678',
    participantEmail: 'seohee@example.test',
    // 인테이크를 마친 케이스 — 상담 유형 기본값이 '기본 상담'이 된다(D35 §5).
    intakeAt: '2026-07-01T00:00:00.000Z',
  },
];

// 인테이크가 아직 없는 케이스 — 상담 유형 기본값이 '인테이크'가 된다(D35 §5).
const freshCandidate: ScheduleWizardCandidate = {
  value: 'rabbit-001|22222222-2222-4222-8222-222222222222',
  beneficiaryId: 'rabbit-001',
  supportCaseId: '22222222-2222-4222-8222-222222222222',
  programLabel: PROGRAM_LABELS.financial_support_v1,
  participantName: '남주원',
  participantPhone: '010-0000-0016',
  participantEmail: null,
  intakeAt: null,
};
const freshCandidateLabel = '남주원 010-0000-0016';

// D31: 당사자 행은 실명·연락처·이메일로 표기하고 사업명은 빼야 한다.
// 구분자 가운뎃점 대신 각 조각을 독립 노드(MetaRow)로 렌더하므로 접근성 이름은 공백으로 이어진다.
const candidateLabel = '홍서희 010-1234-5678 seohee@example.test';

function renderWizard(overrides: { candidates?: ScheduleWizardCandidate[] } = {}) {
  const calls = { load: 0, submit: 0 };
  let lastInput: CreateSchedulePlanInput | null = null;
  const loadContext = async (): Promise<ScheduleContextResult> => {
    calls.load += 1;
    return { status: 'loaded', caseGoals: [{ id: 'g1', title: '생활비 계획 유지' }], lastBriefing: null };
  };
  const submit = async (input: CreateSchedulePlanInput): Promise<CreateSchedulePlanResult> => {
    calls.submit += 1;
    lastInput = input;
    return { status: 'created' };
  };
  return {
    calls,
    getLastInput: () => lastInput,
    ...render(
      <ScheduleWizard
        candidates={overrides.candidates ?? candidates}
        loadContext={loadContext}
        submit={submit}
      />,
    ),
  };
}

describe('ScheduleWizard', () => {
  it('당사자·일시를 고르고 다음을 누르면 2단계(이번 상담의 목표)로 전환하며 참고 카드를 채운다', async () => {
    const { container, calls } = renderWizard();
    const scoped = within(container);

    // 1단계에서는 목표 질문이 아직 없다.
    expect(scoped.queryByText('이번 상담의 목표는 무엇인가요?')).toBeNull();

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 이번 상담의 목표/ }));

    await waitFor(() => expect(scoped.getByText('이번 상담의 목표는 무엇인가요?')).not.toBeNull());
    expect(calls.load).toBe(1);
    // 로드한 활성 케이스 목표가 '상담별 목표' 카드와 연결 선택지 양쪽에 반영된다.
    expect(scoped.getAllByText('생활비 계획 유지').length).toBeGreaterThanOrEqual(1);
  });

  it('당사자를 고르기 전에는 상담 유형·일시가 보이지 않고 다음으로 갈 수 없다 (D35 §5)', () => {
    // 상담 유형 기본값이 그 케이스의 인테이크 유무로 갈리므로, 당사자를 모르면 물어볼 수
    // 없다. 그래서 순서가 당사자 → 상담 유형 → 일시다.
    const { container, calls } = renderWizard();
    const scoped = within(container);

    expect(scoped.queryByLabelText('상담 일시')).toBeNull();
    expect(scoped.queryByText('상담 유형')).toBeNull();
    // 기관·참여 사업 선택은 삭제됐다 — 워크스페이스가 이미 정한 값을 다시 묻지 않는다.
    expect(scoped.queryByLabelText('기관')).toBeNull();
    expect(scoped.queryByLabelText('참여 사업')).toBeNull();
    // 상담 방법은 '대면' 하나뿐이라 숨긴다(D4).
    expect(scoped.queryByLabelText('상담 방법 선택하기')).toBeNull();

    expect((scoped.getByRole('button', { name: /다음: / }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.load).toBe(0);
  });

  it('당사자를 고르면 상담 유형이 케이스 상태로 정해진다 — 인테이크를 마친 케이스는 기본 상담', () => {
    const { container } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    expect(scoped.getByText('기본 상담')).not.toBeNull();
    expect(scoped.getByText(/인테이크가 끝난 당사자라/)).not.toBeNull();
    // 다른 유형은 접혀 있다 — 평소에는 고를 일이 없다.
    expect(scoped.queryByLabelText('상담 유형 선택하기')).toBeNull();
    expect(scoped.getByRole('button', { name: '다른 유형 선택' })).not.toBeNull();
  });

  it('인테이크가 없는 케이스는 인테이크로 잡히고 경고를 띄우지 않는다', () => {
    // 새로 등록한 당사자의 첫 상담이 이 경로다 — 실무자가 유형을 고르지 않아도 맞게 잡혀야 한다.
    const { container } = renderWizard({ candidates: [freshCandidate] });
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: freshCandidateLabel }));
    expect(scoped.getByText('인테이크')).not.toBeNull();
    expect(scoped.getByText(/아직 인테이크 기록이 없어/)).not.toBeNull();
    expect(scoped.queryByRole('alert')).toBeNull();
    expect(scoped.getByRole('button', { name: /다음: 상담 목표/ })).not.toBeNull();
  });

  it('당사자를 바꾸면 상담 유형 기본값도 다시 잡힌다', () => {
    // 앞 당사자 기준으로 고른 유형이 남으면 인테이크가 끝난 사람에게 인테이크가 잡힌다.
    const { container } = renderWizard({ candidates: [freshCandidate, candidates[0]!] });
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: freshCandidateLabel }));
    expect(scoped.getByText(/아직 인테이크 기록이 없어/)).not.toBeNull();

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    expect(scoped.getByText(/인테이크가 끝난 당사자라/)).not.toBeNull();
  });

  it('인테이크를 마친 케이스에서 인테이크를 다시 고르면 경고와 기존 기록 링크가 뜨되 막지 않는다', () => {
    // CCC-14 의 "차단이 아니라 경고" 결정 유지 — 장기 중단 후 재개로 인테이크를 다시 해야
    // 할 때 우회로가 없어진다. 저장 시점의 "케이스당 인테이크 1회" 검사는 게이트웨이에 있다.
    const { container } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    fireEvent.click(scoped.getByRole('button', { name: '다른 유형 선택' }));
    fireEvent.change(scoped.getByLabelText('상담 유형 선택하기'), { target: { value: 'intake' } });

    const alert = scoped.getByRole('alert');
    expect(alert.textContent).toContain('인테이크를 이미 마쳤습니다');
    const link = within(alert).getByRole('link');
    expect(link.getAttribute('href')).toContain('/records/intake');
    // 경고일 뿐이므로 일시까지 채우면 다음으로 갈 수 있다.
    fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });
    expect((scoped.getByRole('button', { name: /다음: 상담 목표/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('인테이크를 고르면 케이스 목표 입력으로 가고 참고 데이터를 부르지 않으며 인테이크로 제출한다', async () => {
    const { container, calls, getLastInput } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });
    // 이 픽스처는 인테이크를 마친 케이스라 기본값이 '기본 상담'이다 — 인테이크로 바꾸려면
    // 접힌 선택을 펼쳐야 한다(D35 §5).
    fireEvent.click(scoped.getByRole('button', { name: '다른 유형 선택' }));
    fireEvent.change(scoped.getByLabelText('상담 유형 선택하기'), { target: { value: 'intake' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 상담 목표/ }));

    await waitFor(() => expect(scoped.getByText('상담의 목표는 무엇인가요?')).not.toBeNull());
    // 인테이크는 기존 케이스 목표·브리핑 참고 데이터를 부르지 않는다.
    expect(calls.load).toBe(0);
    // 세션 목표 입력(기본 상담 전용)은 나타나지 않는다.
    expect(scoped.queryByText('이번 상담의 목표는 무엇인가요?')).toBeNull();

    fireEvent.change(scoped.getByLabelText('상담 목표 1'), { target: { value: '월 5만원 저축을 3개월 유지한다' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 맞춤형 질문/ }));
    fireEvent.click(scoped.getByRole('button', { name: '완료' }));

    await waitFor(() => expect(calls.submit).toBe(1));
    const input = getLastInput();
    expect(input?.sessionKind).toBe('intake');
    expect(input?.caseGoals).toContain('월 5만원 저축을 3개월 유지한다');
  });

  it('당사자를 골라도 일시가 비어 있으면 다음이 눌리지 않고 무엇이 모자란지 알린다 (CCC-22)', () => {
    const { container } = renderWizard();
    const scoped = within(container);

    // 당사자만 고른 상태 — 일시 미입력.
    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    const nextButton = scoped.getByRole('button', { name: /다음: / }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    expect(scoped.getByText('상담 일시를 선택하면 다음으로 넘어갈 수 있습니다.')).not.toBeNull();

    // 일시를 채우면 활성화되고 안내가 사라진다.
    fireEvent.change(scoped.getByLabelText('상담 일시'), { target: { value: '2026-07-20T13:00' } });
    expect(nextButton.disabled).toBe(false);
    expect(scoped.queryByText('상담 일시를 선택하면 다음으로 넘어갈 수 있습니다.')).toBeNull();
  });
});
