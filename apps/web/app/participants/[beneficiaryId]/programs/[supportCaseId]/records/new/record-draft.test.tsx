import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { RecordOnepage, type RecordOnepageProps } from './record-onepage';
import { draftKey, readDraft, writeDraft, type FieldValues } from '../../../../../../lib/form-draft';

// 정기 기록지의 로컬 자동 저장·복원(CCC-12). 저장이 서버 액션 + 리다이렉트라 성공을 화면이
// 직접 알 수 없다 — 'submitting' 표시와 되돌아온 오류 유무로 판정하는 규칙까지 함께 고정한다.

const SUPPORT_CASE_ID = 'case-1';
const KEY = draftKey('record', SUPPORT_CASE_ID);

function props(overrides: Partial<RecordOnepageProps> = {}): RecordOnepageProps {
  return {
    goals: [{ id: 'goal-1', title: '월세 체납 해소', status: 'active' }],
    schedules: [],
    openActionItems: [],
    latestLifeAreaSnapshot: [],
    sessionGoals: [],
    customQuestions: [],
    lastRecordSummary: null,
    briefingPath: '/participants/swallow-003/programs/case-1/briefing',
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

    fireEvent.change(container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement, {
      target: { value: '오늘 상담 내용' },
    });

    await waitFor(() => {
      expect(readDraft<FieldValues>(KEY)?.values['memo#0']).toBe('오늘 상담 내용');
    }, { timeout: 3000 });
    expect(getByTestId('draft-status').textContent).toContain('자동 저장됨');
  });

  it('작성하던 임시본이 있으면 이어쓰기 배너를 띄우고 내용을 되돌린다', () => {
    writeDraft<FieldValues>(KEY, { 'memo#0': '끊기기 전 내용', 'counselorOpinion#0': '의견' }, 'editing');

    const { container, getByTestId, getByRole } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    // 고르기 전에는 아무것도 덮어쓰지 않는다.
    expect((container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement).value).toBe('');

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect((container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement).value).toBe('끊기기 전 내용');
    expect((container.querySelector('textarea[name="counselorOpinion"]') as HTMLTextAreaElement).value).toBe('의견');
  });

  it("'새로 시작'을 고르면 임시본을 지운다", () => {
    writeDraft<FieldValues>(KEY, { 'memo#0': '끊기기 전 내용' }, 'editing');

    const { container, getByRole, queryByTestId } = render(<RecordOnepage {...props()} />);
    fireEvent.click(getByRole('button', { name: '새로 시작' }));

    expect(queryByTestId('draft-restore-prompt')).toBeNull();
    expect(readDraft(KEY)).toBeNull();
    expect((container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement).value).toBe('');
  });

  it('저장 여부를 확인하지 못한 임시본은 지우지 않고 물어본다', () => {
    // service_unavailable · unknown_outcome · conflict 는 상위 화면이 폼 대신 안내 패널을
    // 렌더해 이 컴포넌트가 마운트되지 않는다. 실무자가 저장 여부를 확인하러 갔다가 새 기록
    // 작성으로 돌아오면 '오류 없는 깨끗한 방문'이 되는데, 그때 지우면 저장도 안 된 상담
    // 내용이 조용히 사라진다. 지우는 판단은 사람이 한다.
    writeDraft<FieldValues>(KEY, { 'memo#0': '저장됐는지 모르는 내용' }, 'submitting');

    const { getByTestId, getByRole } = render(<RecordOnepage {...props({ submissionFailed: false })} />);

    expect(getByTestId('draft-restore-prompt').textContent).toContain('저장 여부를 확인하지 못한');
    expect(readDraft(KEY)).not.toBeNull();

    fireEvent.click(getByRole('button', { name: '새로 시작' }));
    expect(readDraft(KEY)).toBeNull();
  });

  it('배너를 고르지 않고 타이핑해도 되돌릴 임시본을 덮어쓰지 않는다', async () => {
    // 실무자가 배너를 무시하고 새로 쓰기 시작하면, 되돌릴 수 있던 내용이 거의 빈 현재
    // 폼으로 덮어써지고 새로고침하면 사라진다. 고르기 전까지는 저장소를 건드리지 않는다.
    writeDraft<FieldValues>(KEY, { 'memo#0': '지켜야 하는 내용' }, 'editing');

    const { container, getByTestId } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();

    fireEvent.change(container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement, {
      target: { value: '고르지 않고 새로 쓴 내용' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(readDraft<FieldValues>(KEY)?.values['memo#0']).toBe('지켜야 하는 내용');
  });

  it('제출하면 임시본에 submitting 을 찍는다', async () => {
    // 이 표시가 안 찍히면 임시본이 영원히 editing 으로 남아, 저장에 성공한 뒤에도
    // 다음 기록을 열 때마다 지난 회차 메모가 배너로 따라온다.
    const { container } = render(
      <form>
        <RecordOnepage {...props()} />
      </form>,
    );
    fireEvent.change(container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement, {
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
    writeDraft<FieldValues>(KEY, { 'memo#0': '저장 못 한 내용' }, 'submitting');

    const { container, getByTestId, getByRole } = render(<RecordOnepage {...props({ submissionFailed: true })} />);

    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: '이어쓰기' }));
    expect((container.querySelector('textarea[name="memo"]') as HTMLTextAreaElement).value).toBe('저장 못 한 내용');
  });

  it('되돌리면 값에서 파생되는 화면 상태도 함께 따라온다', () => {
    // 값만 꽂고 리액트가 모르면 필수 카운트·위기 자동 펼침이 어긋난 채로 남는다.
    writeDraft<FieldValues>(KEY, {
      'memo#0': '오늘 상담 내용',
      'lifeAreaStatus_economy#0': 'crisis',
    }, 'editing');

    const { getByTestId, getByRole } = render(<RecordOnepage {...props()} />);
    expect(getByTestId('record-required-count').textContent).toBe('필수 2/3');

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    expect(getByTestId('record-required-count').textContent).toBe('필수 3/3');
    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.open).toBe(true);
    expect(safety.className).toContain('is-crisis');
  });

  it('메모 도움말이 임시 보관 사실을 밝힌다', () => {
    const { container } = render(<RecordOnepage {...props()} />);
    // id 는 WireFormField 가 htmlFor 에서 만든다(`${htmlFor}-hint`).
    const help = container.querySelector('#record-memo-hint') as HTMLElement;
    // 저장하지 않는다고 적어 두고 저장하면 안 된다 — 문구와 동작을 함께 고정한다.
    expect(help.textContent).toContain('이 브라우저에만 12시간 임시 보관');
    expect(help.textContent).not.toContain('저장하지 않습니다');
    // 도움말이 컨트롤에 묶여 있어야 스크린 리더가 읽는다.
    expect(container.querySelector('textarea[name="memo"]')?.getAttribute('aria-describedby'))
      .toBe('record-memo-hint');
  });
});
