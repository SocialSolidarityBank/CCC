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

describe('ParticipantFilter (D21 당사자 찾기의 새 자리)', () => {
  it('보이는 찾기 라벨 없이 검색창과 등록 행동을 한 업무 바에 둔다', () => {
    const { container, queryByText } = render(<ParticipantFilter rows={rows()} />);
    const toolbar = container.querySelector('.participant-toolbar');

    expect(queryByText('당사자 찾기')).toBeNull();
    expect(container.querySelector('.participant-search-divider')).toBeNull();
    const search = toolbar?.querySelector('.participant-toolbar-search');
    expect(search?.querySelector('.wire-toolbar-label')?.textContent).toBe('당사자 검색');
    expect(search?.querySelector('input')).not.toBeNull();
    const actions = Array.from(toolbar?.querySelectorAll('.participant-toolbar-actions a') ?? []);
    expect(actions.map((action) => action.textContent)).toEqual(['당사자 초대', '당사자 등록']);
    expect(actions.map((action) => action.getAttribute('href')))
      .toEqual(['/participants/invite', '/participants/new']);
    // 버튼은 전 32 단일 높이다(2026-08-28 Q — 구 md/sm 2단·data-height 축 폐지).
    expect(actions.every((action) => action.classList.contains('wire-button') && action.getAttribute('data-height') === null)).toBe(true);
  });

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
    expect(getByRole('status').textContent).toContain('찾는 당사자가 없습니다');
    fireEvent.change(input, { target: { value: '' } });
    expect(visibleNames(container)).toEqual(['김미영', '남주원']);
  });

  it('대소문자를 가리지 않는다', () => {
    const { container } = render(<ParticipantFilter rows={rows()} />);
    fireEvent.change(container.querySelector('input') as HTMLInputElement, { target: { value: 'SWALLOW' } });
    expect(visibleNames(container)).toEqual(['김미영']);
  });

  it('목록 오류와 빈 목록에서도 업무 바 행동은 남는다', () => {
    const { container, rerender } = render(<ParticipantFilter rows={[]} error="불러오기 실패" />);
    expect(container.querySelector('.participant-toolbar')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('불러오기 실패');

    rerender(<ParticipantFilter rows={[]} />);
    expect(container.querySelector('.participant-toolbar')).not.toBeNull();
    expect(container.querySelector('.empty')?.textContent).toContain('먼저 등록하세요');
  });
});
