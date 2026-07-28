import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ListRow } from './list-row';

describe('ListRow', () => {
  it('chevron="down"은 아래 방향 체브론을 렌더한다', () => {
    const { container } = render(<ListRow chevron="down">헤더</ListRow>);
    const chevron = container.querySelector('.wire-chevron');
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute('data-dir')).toBe('down');
  });

  it('chevron="right"은 오른쪽 방향 체브론을 렌더한다', () => {
    const { container } = render(<ListRow chevron="right">이동</ListRow>);
    expect(container.querySelector('.wire-chevron')?.getAttribute('data-dir')).toBe('right');
  });

  it('체브론을 주지 않으면 체브론이 없다', () => {
    const { container } = render(<ListRow>텍스트</ListRow>);
    expect(container.querySelector('.wire-chevron')).toBeNull();
  });

  it('open 상태로 체브론 방향을 파생한다(true=down, false=right)', () => {
    const { container: openContainer } = render(<ListRow open>펼침</ListRow>);
    expect(openContainer.querySelector('.wire-chevron')?.getAttribute('data-dir')).toBe('down');
    const { container: closedContainer } = render(<ListRow open={false}>접힘</ListRow>);
    expect(closedContainer.querySelector('.wire-chevron')?.getAttribute('data-dir')).toBe('right');
  });

  it('selected면 뮤트 필 표시(data-selected)를 남긴다', () => {
    const { container } = render(<ListRow selected>선택됨</ListRow>);
    expect(container.querySelector('.wire-row')?.getAttribute('data-selected')).toBe('true');
    const { container: plain } = render(<ListRow>기본</ListRow>);
    expect(plain.querySelector('.wire-row')?.getAttribute('data-selected')).toBeNull();
  });

  it('href를 주면 링크(a)로, onClick을 주면 버튼으로 렌더한다', () => {
    const { container: linkContainer } = render(<ListRow href="/x">링크</ListRow>);
    const anchor = linkContainer.querySelector('a.wire-row');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('/x');

    let clicked = 0;
    const { container: buttonContainer } = render(<ListRow onClick={() => { clicked += 1; }}>버튼</ListRow>);
    const button = buttonContainer.querySelector('button.wire-row');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(clicked).toBe(1);
  });
});
