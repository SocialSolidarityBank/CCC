import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { ListRow } from './list-row';

afterEach(cleanup);

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

  it('아코디언 변형은 없다 — 접힘 어휘는 WireCardDetails 하나다 (2026-08-10)', () => {
    // 구 open prop 은 체브론 방향을 파생하고 aria-expanded 를 달았는데, 쓰는 화면이
    // 한 곳도 없었다(킷 데모와 이 테스트뿐). 되살아나면 접힘 어휘가 다시 두 벌이 된다.
    const { container } = render(<ListRow onClick={() => {}}>줄</ListRow>);
    expect(container.querySelector('.wire-row')?.getAttribute('aria-expanded')).toBeNull();
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
