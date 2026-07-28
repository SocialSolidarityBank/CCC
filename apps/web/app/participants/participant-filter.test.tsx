import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ParticipantFilter, type ParticipantFilterRow } from './participant-filter';

afterEach(cleanup);

function rows(): ParticipantFilterRow[] {
  return [
    { beneficiaryId: 'swallow-003', haystack: '김미영 swallow-003 010-0000-0001', node: <span>김미영</span> },
    { beneficiaryId: 'rabbit-001', haystack: '남주원 rabbit-001 010-0000-0016', node: <span>남주원</span> },
  ];
}

function visibleNames(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('.participant-row-list > div')].map((row) => row.textContent);
}

describe('ParticipantFilter (D21 참여자 찾기의 새 자리)', () => {
  it('입력이 없으면 전원을 보여준다', () => {
    const { container } = render(<ParticipantFilter rows={rows()} />);
    expect(visibleNames(container)).toEqual(['김미영', '남주원']);
  });

  it('이름 일부로 좁힌다', () => {
    const { container } = render(<ParticipantFilter rows={rows()} />);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: '남주' } });
    expect(visibleNames(container)).toEqual(['남주원']);
  });

  it('가명 ID와 연락처로도 찾는다', () => {
    const { container } = render(<ParticipantFilter rows={rows()} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'swallow' } });
    expect(visibleNames(container)).toEqual(['김미영']);
    fireEvent.change(input, { target: { value: '0016' } });
    expect(visibleNames(container)).toEqual(['남주원']);
  });

  it('결과가 없으면 안내를 띄우고, 입력을 지우면 목록이 그대로 돌아온다', () => {
    // 서버 검색이 아니라 받은 목록을 좁히는 방식이라 오타에도 목록이 사라지지 않는다.
    const { container, getByRole } = render(<ParticipantFilter rows={rows()} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '없는이름' } });
    expect(container.querySelector('.participant-row-list')).toBeNull();
    expect(getByRole('status').textContent).toContain('찾는 참여자가 없습니다');
    fireEvent.change(input, { target: { value: '' } });
    expect(visibleNames(container)).toEqual(['김미영', '남주원']);
  });

  it('대소문자를 가리지 않는다', () => {
    const { container } = render(<ParticipantFilter rows={rows()} />);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'SWALLOW' } });
    expect(visibleNames(container)).toEqual(['김미영']);
  });
});
