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
const freshCandidateLabel = '남주원 rabbit-001 010-0000-0016';

// D31: 당사자 행은 실명·가명 ID·연락처·이메일로 표기하고 사업명은 빼야 한다(가명 ID 는
// 다른 당사자 카드와 같은 공용 .participant-card-id 회색 조각 — 2026-08-28 Q 통일).
// 구분자 가운뎃점 대신 각 조각을 독립 노드(MetaRow)로 렌더하므로 접근성 이름은 공백으로 이어진다.
const candidateLabel = '홍서희 swallow-003 010-1234-5678 seohee@example.test';

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
    fireEvent.change(scoped.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scoped.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 이번 상담의 목표/ }));

    await waitFor(() => expect(scoped.getByText('이번 상담의 목표는 무엇인가요?')).not.toBeNull());
    expect(calls.load).toBe(1);
    // 로드한 활성 세부 목표가 '세부 목표' 카드와 연결 선택지 양쪽에 반영된다(D62 · CCC-70).
    expect(scoped.getAllByText('생활비 계획 유지').length).toBeGreaterThanOrEqual(1);
    // 라벨은 '세부 목표 연결'이다. 구 '케이스 목표 연결'은 세부 목표 층의 옛 이름.
    expect(scoped.getByLabelText('세부 목표 연결')).not.toBeNull();
  });

  it('세부 목표 연결을 고르면 제출 페이로드에 caseGoalId 로 실린다 (CCC-70 회귀)', async () => {
    // 세부 목표 층이 보류였을 때는 선택지가 늘 비어 있어 이 경로가 한 번도 돌지 않았고,
    // 상태 업데이터 안에서 event.currentTarget 을 늦게 읽는 잠복 버그가 숨어 있었다.
    const { container, calls, getLastInput } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    fireEvent.change(scoped.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scoped.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 이번 상담의 목표/ }));
    await waitFor(() => expect(scoped.getByLabelText('세부 목표 연결')).not.toBeNull());

    fireEvent.change(scoped.getByLabelText('세션 목표 1'), { target: { value: '구직 활동 점검' } });
    fireEvent.change(scoped.getByLabelText('세부 목표 연결'), { target: { value: 'g1' } });
    fireEvent.click(scoped.getByRole('button', { name: '완료' }));

    await waitFor(() => expect(calls.submit).toBe(1));
    expect(getLastInput()?.sessionGoals).toEqual([{ body: '구직 활동 점검', caseGoalId: 'g1' }]);
  });

  it('당사자를 고르기 전에는 상담 유형·일시가 보이지 않고 다음으로 갈 수 없다 (D35 §5)', () => {
    // 상담 유형 기본값이 그 케이스의 인테이크 유무로 갈리므로, 당사자를 모르면 물어볼 수
    // 없다. 그래서 순서가 당사자 → 상담 유형 → 일시다.
    const { container, calls } = renderWizard();
    const scoped = within(container);

    expect(scoped.queryByLabelText('상담 일시 날짜')).toBeNull();
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
    // 2026-08-09 Q: 값을 보여 주는 자리와 고치는 자리가 **선택창 하나**다(구 값 + 접힘 대체).
    const kind = scoped.getByLabelText('상담 유형') as HTMLSelectElement;
    expect(kind.value).toBe('regular');
    expect(scoped.getByText(/인테이크가 끝난 당사자라/)).not.toBeNull();
    // 접힘·'다른 유형 선택' 버튼은 없어졌다 — 낱말이 세 번 겹치던 원인이었다.
    expect(scoped.queryByRole('button', { name: '다른 유형 선택' })).toBeNull();
  });

  it('인테이크가 없는 케이스는 인테이크로 잡히고 경고를 띄우지 않는다', () => {
    // 새로 등록한 당사자의 첫 상담이 이 경로다 — 실무자가 유형을 고르지 않아도 맞게 잡혀야 한다.
    const { container } = renderWizard({ candidates: [freshCandidate] });
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: freshCandidateLabel }));
    expect((scoped.getByLabelText('상담 유형') as HTMLSelectElement).value).toBe('intake');
    expect(scoped.getByText(/아직 인테이크 기록이 없어/)).not.toBeNull();
    expect(scoped.queryByRole('alert')).toBeNull();
    expect(scoped.getByRole('button', { name: /다음: 맞춤형 질문/ })).not.toBeNull();
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
    fireEvent.change(scoped.getByLabelText('상담 유형'), { target: { value: 'intake' } });

    const alert = scoped.getByRole('alert');
    expect(alert.textContent).toContain('인테이크를 이미 마쳤습니다');
    const link = within(alert).getByRole('link');
    // 2026-08-08 Q: 인테이크 화면 직행은 전체 상담 기록·당사자 정보의 입구만 갖는다 —
    // 이 경고 링크는 인테이크가 담긴 전체 상담 기록으로 간다(/records, intake 직행 아님).
    expect(link.getAttribute('href')).toMatch(/\/records$/);
    // 경고일 뿐이므로 일시까지 채우면 다음으로 갈 수 있다.
    fireEvent.change(scoped.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scoped.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    expect((scoped.getByRole('button', { name: /다음: 맞춤형 질문/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  // CCC-64: 인테이크 경로의 구 목표 입력 단계는 없앴다. 그 값은 goals 표(D43 이 보류한
  // 세부 목표 층)로 들어가 어느 화면에도 안 보였는데 필수였다. 당사자를 만나기도 전에
  // 목표를 지어내야 했다. 이제 1단계에서 맞춤형 질문으로 바로 넘어간다.
  it('인테이크는 목표 입력 없이 맞춤형 질문으로 가고 참고 데이터를 부르지 않는다', async () => {
    const { container, calls, getLastInput } = renderWizard();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    fireEvent.change(scoped.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scoped.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    // 이 픽스처는 인테이크를 마친 케이스라 기본값이 '기본 상담'이다(D35 §5).
    fireEvent.change(scoped.getByLabelText('상담 유형'), { target: { value: 'intake' } });
    fireEvent.click(scoped.getByRole('button', { name: /다음: 맞춤형 질문/ }));

    await waitFor(() => expect(scoped.getByRole('button', { name: '완료' })).not.toBeNull());
    // 인테이크는 기존 케이스 목표·브리핑 참고 데이터를 부르지 않는다.
    expect(calls.load).toBe(0);
    // 목표 입력은 어느 쪽도 나타나지 않는다.
    expect(scoped.queryByText('상담의 목표는 무엇인가요?')).toBeNull();
    expect(scoped.queryByText('이번 상담의 목표는 무엇인가요?')).toBeNull();
    expect(scoped.queryByLabelText('상담 목표 1')).toBeNull();
    // 인테이크는 2단계다(구 3단계) — CCC-81 단계 부품으로 표기된다.
    const steps = container.querySelector('ol.wire-steps');
    expect(steps).not.toBeNull();
    const labels = [...(steps?.querySelectorAll('.wire-step-label') ?? [])].map((el) => el.textContent);
    expect(labels).toEqual(['당사자 선택', '맞춤형 질문']);
    expect(container.querySelector('.wire-step[aria-current="step"]')?.textContent).toContain('맞춤형 질문');

    fireEvent.click(scoped.getByRole('button', { name: '완료' }));

    await waitFor(() => expect(calls.submit).toBe(1));
    const input = getLastInput();
    expect(input?.sessionKind).toBe('intake');
    // 목표를 한 글자도 안 적어도 등록된다. 구 흐름은 여기서 막혔다.
    expect(input).not.toHaveProperty('caseGoals');
  });

  // 2026-08-30 Q: 기본 상담의 2단계 칩은 그 단계에 실제로 선 것 둘을 다 부른다. 2026-08-28 Q
  // 가 목표와 맞춤형 질문을 한 단계 2열로 합쳤는데 칩은 '상담 목표' 하나만 부르고 있었다 —
  // 인테이크 칩은 자기 내용을 전부 부르므로 두 경로의 충실도가 어긋나 있었다.
  // 가운뎃점 대신 '와' 로 잇는다(§10 구분자 가운뎃점 금지 — guard:tokens 가 강제).
  it('기본 상담 2단계 칩은 목표와 맞춤형 질문을 함께 부른다', () => {
    const { container } = renderWizard({ candidates: [candidates[0]!, freshCandidate] });
    const scoped = within(container);

    // 미선택 기본값은 기본 상담이다.
    expect([...container.querySelectorAll('.wire-step-label')].map((el) => el.textContent))
      .toEqual(['당사자 선택', '상담 목표와 맞춤형 질문']);

    // 인테이크 없는 당사자를 고르면 유형이 인테이크로 잡히고 칩도 그 단계 이름으로 바뀐다.
    fireEvent.click(scoped.getByRole('button', { name: freshCandidateLabel }));
    expect([...container.querySelectorAll('.wire-step-label')].map((el) => el.textContent))
      .toEqual(['당사자 선택', '맞춤형 질문']);

    // 인테이크를 마친 당사자로 되돌리면 다시 기본 상담 칩이다.
    fireEvent.click(scoped.getByRole('button', { name: candidateLabel }));
    expect([...container.querySelectorAll('.wire-step-label')].map((el) => el.textContent))
      .toEqual(['당사자 선택', '상담 목표와 맞춤형 질문']);
  });

  // 2026-08-09 Q: 카드 full-width + '당사자 정보' 버튼이 카드 안이다. 가명 ID 는 이름 다음
  // 공용 .participant-card-id 조각으로 선다(2026-08-28 Q 통일 — 구 mint 전용 클래스 대체).
  it('후보 카드가 가명 ID 조각과 당사자 정보 링크를 카드 안에 갖는다', () => {
    const { container } = renderWizard();
    const scoped = within(container);

    const row = scoped.getByRole('button', { name: candidateLabel }).closest('.schedule-candidate-item') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.className).toContain('wire-row');
    // ID 조각은 이름 바로 다음이다.
    const id = row.querySelector('.participant-card-id') as HTMLElement;
    expect(id.textContent).toBe('swallow-003');
    const name = row.querySelector('.schedule-candidate-name') as HTMLElement;
    expect(name.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // '당사자 정보' 링크가 카드(행) **안**에 있다 — 구 행 밖 형제 배치 대체.
    const link = within(row).getByRole('link', { name: '당사자 정보' });
    expect(link.getAttribute('href')).toBe('/participants/swallow-003');
  });

  it('이름이 없어 가명 ID 가 이름 자리에 서면 ID 조각을 겹쳐 그리지 않는다', () => {
    const { container } = renderWizard({
      candidates: [{ ...freshCandidate, participantName: null }],
    });
    const scoped = within(container);

    const row = scoped.getByRole('button', { name: 'rabbit-001 010-0000-0016' }).closest('.schedule-candidate-item') as HTMLElement;
    expect(row.querySelector('.schedule-candidate-name')?.textContent).toBe('rabbit-001');
    expect(row.querySelector('.participant-card-id')).toBeNull();
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
    fireEvent.change(scoped.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scoped.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    expect(nextButton.disabled).toBe(false);
    expect(scoped.queryByText('상담 일시를 선택하면 다음으로 넘어갈 수 있습니다.')).toBeNull();
  });
});
