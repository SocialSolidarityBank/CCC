import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { RecordOnepage, type RecordOnepageProps } from './record-onepage';
import { draftKey, readDraft, writeDraft, type FieldValues } from '../../../../../../lib/form-draft';
import { RecordDraftCleanup } from '../record-draft-cleanup';

// 정기 기록지의 로컬 자동 저장·복원(CCC-12). 저장이 서버 액션 + 리다이렉트라 성공을 화면이
// 직접 알 수 없다 — 'submitting' 표시와 되돌아온 오류 유무로 판정하는 규칙까지 함께 고정한다.
// P0-9 (CCC-111): 민감 서술 필드(수기 메모·안전 관련 메모·실무자 의견)는 localStorage 에
// 쓰지 않는다 — 자동 저장 편의는 비민감 칸(날짜·선택지·짧은 확인 사항)만 갖는다.

const SUPPORT_CASE_ID = 'case-1';
const KEY = draftKey('record', SUPPORT_CASE_ID);

function props(overrides: Partial<RecordOnepageProps> = {}): RecordOnepageProps {
  return {
    schedules: [],
    openActionItems: [],
    latestLifeAreaSnapshot: [],
    sessionGoals: [],
    customQuestions: [],
    lastRecordSummary: null,
    briefingPath: '/participants/swallow-003/programs/case-1/briefing',
    actions: <button type="submit">저장</button>,
    supportCaseId: SUPPORT_CASE_ID,
    submissionFailed: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('정기 기록지 임시본', () => {
  it('입력하면 자동 저장하고 상태를 상시 표시한다', async () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('draft-status').textContent).toBe('자동 저장 대기');

    // 자동 저장 대상은 비민감 칸이다 — 수기 메모는 P0-9 로 임시본에서 빠졌다(아래 전용 테스트).
    fireEvent.change(container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement, {
      target: { value: '주거 급여 서류 확인' },
    });

    await waitFor(() => {
      expect(readDraft<FieldValues>(KEY)?.values['sessionGoalNote#0']).toBe('주거 급여 서류 확인');
    }, { timeout: 3000 });
    expect(getByTestId('draft-status').textContent).toContain('자동 저장됨');
  });

  it('민감 필드(수기 메모·안전 메모·실무자 의견)는 localStorage 에 쓰지 않는다', async () => {
    // P0-9 (CCC-111): 상담 내용 전문의 localStorage 사본은 서버의 권한·감사·파기 통제를
    // 우회한다. 민감 칸은 data-draft="skip" 으로 수집 단계에서 빠지고, 같은 폼의 비민감
    // 칸은 그대로 자동 저장된다.
    const { container } = render(<RecordOnepage {...props()} />);

    fireEvent.change(container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement, {
      target: { value: '상담 메모 전문' },
    });
    fireEvent.change(container.querySelector('textarea[name="safetyNote"]') as HTMLTextAreaElement, {
      target: { value: '안전 관련 메모' },
    });
    fireEvent.change(container.querySelector('textarea[name="counselorOpinion"]') as HTMLTextAreaElement, {
      target: { value: '실무자 의견' },
    });
    fireEvent.change(container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement, {
      target: { value: '비민감 확인 사항' },
    });

    await waitFor(() => {
      expect(readDraft<FieldValues>(KEY)?.values['sessionGoalNote#0']).toBe('비민감 확인 사항');
    }, { timeout: 3000 });

    // 키 이름이 아니라 저장소 원문 전체로 확인한다 — 어떤 키로든 전문이 남으면 안 된다.
    const raw = Object.keys(window.localStorage)
      .map((key) => `${key}=${window.localStorage.getItem(key) ?? ''}`)
      .join('\n');
    expect(raw).not.toContain('상담 메모 전문');
    expect(raw).not.toContain('안전 관련 메모');
    expect(raw).not.toContain('실무자 의견');
    const values = readDraft<FieldValues>(KEY)?.values ?? {};
    expect(Object.keys(values).some((key) => /^(memo|safetyNote|counselorOpinion)[#:]/.test(key))).toBe(false);
  });

  it('작성하던 임시본이 있으면 이어쓰기 배너를 띄우고 내용을 되돌린다', () => {
    writeDraft<FieldValues>(KEY, {
      'sessionGoalNote#0': '끊기기 전 확인 사항',
      'changeSinceLast#0': '이사 준비',
      // 어떤 경로로든 임시본에 민감 키가 섞여 있어도 복원하지 않는다(P0-9 — 수집·복원 양쪽 제외).
      'memo#0': '남아 있으면 안 되는 전문',
    }, 'editing');

    const { container, getByTestId, getByRole } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    // 고르기 전에는 아무것도 덮어쓰지 않는다.
    expect((container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement).value).toBe('');

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect((container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement).value).toBe('끊기기 전 확인 사항');
    expect((container.querySelector('input[name="changeSinceLast"]') as HTMLInputElement).value).toBe('이사 준비');
    expect((container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement).value).toBe('');
  });

  it("'새로 시작'을 고르면 임시본을 지운다", () => {
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '끊기기 전 확인 사항' }, 'editing');

    const { container, getByRole, queryByTestId } = render(<RecordOnepage {...props()} />);
    fireEvent.click(getByRole('button', { name: '새로 시작' }));

    expect(queryByTestId('draft-restore-prompt')).toBeNull();
    expect(readDraft(KEY)).toBeNull();
    expect((container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement).value).toBe('');
  });

  it('저장 여부를 확인하지 못한 임시본은 지우지 않고 물어본다', () => {
    // service_unavailable · unknown_outcome · conflict 는 상위 화면이 폼 대신 안내 패널을
    // 렌더해 이 컴포넌트가 마운트되지 않는다. 실무자가 저장 여부를 확인하러 갔다가 새 기록
    // 작성으로 돌아오면 '오류 없는 깨끗한 방문'이 되는데, 그때 지우면 저장도 안 된 상담
    // 내용이 조용히 사라진다. 지우는 판단은 사람이 한다.
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '저장됐는지 모르는 내용' }, 'submitting');

    const { getByTestId, getByRole } = render(<RecordOnepage {...props({ submissionFailed: false })} />);

    expect(getByTestId('draft-restore-prompt').textContent).toContain('저장 여부를 확인하지 못한');
    expect(readDraft(KEY)).not.toBeNull();

    fireEvent.click(getByRole('button', { name: '새로 시작' }));
    expect(readDraft(KEY)).toBeNull();
  });

  it('배너를 고르지 않고 타이핑해도 되돌릴 임시본을 덮어쓰지 않는다', async () => {
    // 실무자가 배너를 무시하고 새로 쓰기 시작하면, 되돌릴 수 있던 내용이 거의 빈 현재
    // 폼으로 덮어써지고 새로고침하면 사라진다. 고르기 전까지는 저장소를 건드리지 않는다.
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '지켜야 하는 내용' }, 'editing');

    const { container, getByTestId } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();

    fireEvent.change(container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement, {
      target: { value: '고르지 않고 새로 쓴 내용' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(readDraft<FieldValues>(KEY)?.values['sessionGoalNote#0']).toBe('지켜야 하는 내용');
  });

  it('제출하면 임시본에 submitting 을 찍는다', async () => {
    // 이 표시가 안 찍히면 임시본이 영원히 editing 으로 남아, 저장에 성공한 뒤에도
    // 다음 기록을 열 때마다 지난 회차 메모가 배너로 따라온다.
    const { container } = render(
      <form>
        <RecordOnepage {...props()} />
      </form>,
    );
    fireEvent.change(container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement, {
      target: { value: '제출할 내용' },
    });
    await waitFor(() => {
      expect(readDraft(KEY)?.phase).toBe('editing');
    }, { timeout: 3000 });

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(readDraft(KEY)?.phase).toBe('submitting');
  });

  it('기록 화면을 열면 다른 참여 사업의 만료된 임시본까지 걷는다', () => {
    // 만료를 읽을 때만 적용하면, 다시 열지 않은 임시본은 기기에 그대로 남는다 —
    // 화면 문구가 약속한 '12시간 임시 보관'과 어긋난다.
    const otherKey = draftKey('record', 'case-2');
    writeDraft<FieldValues>(otherKey, { 'memo#0': '오래된 다른 사업 내용' }, 'editing', 1_000);

    render(<RecordOnepage {...props()} />);

    expect(window.localStorage.getItem(otherKey)).toBeNull();
  });

  it('저장이 실패해 되돌아왔으면 임시본을 살린다', () => {
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '저장 못 한 내용' }, 'submitting');

    const { container, getByTestId, getByRole } = render(<RecordOnepage {...props({ submissionFailed: true })} />);

    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect((container.querySelector('input[name="sessionGoalNote"]') as HTMLInputElement).value).toBe('저장 못 한 내용');
  });

  it('되돌리면 값에서 파생되는 화면 상태도 함께 따라온다', () => {
    // 값만 꽂고 리액트가 모르면 위기 자동 펼침 같은 파생 상태가 어긋난 채로 남는다.
    // (수기 메모는 P0-9 로 임시본에서 빠져 필수 카운트 복원 검증 대상이 아니다.)
    writeDraft<FieldValues>(KEY, {
      'lifeAreaStatus_economy#0': 'crisis',
    }, 'editing');

    const { getByTestId, getByRole } = render(<RecordOnepage {...props()} />);

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.open).toBe(true);
    expect(safety.className).toContain('is-crisis');
  });

  it('메모 도움말이 임시 보관하지 않음을 밝힌다', () => {
    const { container } = render(<RecordOnepage {...props()} />);
    // id 는 WireFormField 가 htmlFor 에서 만든다(`${htmlFor}-hint`).
    const help = container.querySelector('#record-memo-hint') as HTMLElement;
    // 보관한다고 적어 두고 안 하면(그 반대도) 안 된다 — 문구와 동작을 함께 고정한다(P0-9).
    expect(help.textContent).toContain('임시 보관하지 않습니다');
    expect(help.textContent).not.toContain('12시간 임시 보관');
    // 도움말이 컨트롤에 묶여 있어야 스크린 리더가 읽는다.
    expect(container.querySelector('textarea[name="memo"]')?.getAttribute('aria-describedby'))
      .toBe('record-memo-hint');
  });

  it('기록 화면을 열면 민감 필드를 담던 구 형식(v1) 임시본을 지운다', () => {
    // P0-9 버전 처리: v1 임시본은 상담 메모 전문까지 담았다. 만료를 기다리지 않고 걷는다.
    const legacyKey = 'ccc:draft:v1:record:case-1';
    window.localStorage.setItem(legacyKey, JSON.stringify({
      values: { 'memo#0': '구 형식에 남은 전문' }, savedAt: Date.now(), phase: 'editing',
    }));

    render(<RecordOnepage {...props()} />);

    expect(window.localStorage.getItem(legacyKey)).toBeNull();
  });

  it('제출 성공 신호를 달고 기록 목록에 도착하면 임시본을 지운다', () => {
    // 저장 성공만 notice=record_submission_processed 로 목록에 온다(records/new/page.tsx).
    // 서버에 들어간 내용의 사본을 기기에 둘 이유가 없다(보관 규율 2·5).
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '제출까지 간 내용' }, 'submitting');

    render(<RecordDraftCleanup notice="record_submission_processed" supportCaseId={SUPPORT_CASE_ID} />);

    expect(readDraft(KEY)).toBeNull();
  });

  it('제출 성공 신호가 없으면 기록 목록이 임시본을 지우지 않는다', () => {
    writeDraft<FieldValues>(KEY, { 'sessionGoalNote#0': '아직 확인 안 된 내용' }, 'submitting');

    render(<RecordDraftCleanup notice={undefined} supportCaseId={SUPPORT_CASE_ID} />);

    expect(readDraft(KEY)).not.toBeNull();
  });
});
