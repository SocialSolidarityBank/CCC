import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OpenActionResolutions, type OpenActionResolutionItem } from './open-action-resolutions';

const actions: OpenActionResolutionItem[] = [
  { id: 'a-1', description: '서류 제출', owner: 'beneficiary', dueDate: '2026-07-30' },
  { id: 'a-2', description: '기관 연락', owner: 'counselor', dueDate: null },
];

describe('OpenActionResolutions (CCC-5 미해결 액션 원클릭 처리)', () => {
  it('shows a pass message and no inputs when there are no open actions', () => {
    const { container } = render(<OpenActionResolutions actions={[]} />);
    expect(container.querySelector('input[name="openActionItemId"]')).toBeNull();
    expect(container.textContent).toContain('처리할 미해결 액션이 없습니다');
  });

  it('renders the four resolution states plus a default "미처리" radio and a note field per action', () => {
    const { container } = render(<OpenActionResolutions actions={actions} />);
    // 액션 개수만큼 hidden id 가 실린다.
    expect(container.querySelectorAll('input[name="openActionItemId"]')).toHaveLength(2);
    const first = container.querySelectorAll('input[name="resolutionStatus_a-1"]');
    // 미처리 + 4상태 = 5 라디오.
    expect(first).toHaveLength(5);
    expect(Array.from(first).map((radio) => (radio as HTMLInputElement).value))
      .toEqual(['', 'done', 'in_progress', 'not_done', 'hold']);
    // 기본값은 '미처리'(빈 값)로 체크되어 있어 미선택 시 통과한다.
    expect((first[0] as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('input[name="resolutionNote_a-1"]')).not.toBeNull();
  });

  it('carries the selected state and note in the form payload', () => {
    const { container } = render(<form><OpenActionResolutions actions={actions} /></form>);
    const form = container.querySelector('form') as HTMLFormElement;
    const hold = container.querySelector('input[name="resolutionStatus_a-1"][value="hold"]') as HTMLInputElement;
    const note = container.querySelector('input[name="resolutionNote_a-1"]') as HTMLInputElement;
    fireEvent.click(hold);
    fireEvent.change(note, { target: { value: '서류 대기' } });

    const data = new FormData(form);
    expect(data.get('resolutionStatus_a-1')).toBe('hold');
    expect(data.get('resolutionNote_a-1')).toBe('서류 대기');
    // 손대지 않은 액션은 기본 '미처리'(빈 값)로 남아 통과한다.
    expect(data.get('resolutionStatus_a-2')).toBe('');
  });
});
