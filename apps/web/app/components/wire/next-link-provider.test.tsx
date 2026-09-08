import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// next/link 를 가짜로 바꿔 "이 앱의 렌더러가 실제로 끼워졌는가"만 본다. 라우팅 동작 자체는
// 프레임워크 몫이고, 여기서 잠그는 것은 경계다: 주입 전에는 평범한 <a>, 주입 뒤에는 앱 링크.
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children?: unknown } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)} data-next-link="true">{children as never}</a>
  ),
}));

// vi.mock 이 끌어올려진 뒤에 모듈을 평가해야 가짜 next/link 가 잡힌다. 정적 import 는
// 모의 등록보다 먼저 평가돼 진짜 모듈을 물어 온다(back-link.test.tsx 와 같은 이유·방식).
const { NextLinkProvider } = await import('./next-link-provider');
const { WireButton } = await import('./wire-button');

afterEach(cleanup);

describe('NextLinkProvider', () => {
  it('주입 전에는 공용 부품이 평범한 <a> 를 낸다', () => {
    const { container } = render(<WireButton href="/participants" variant="secondary">당사자 정보</WireButton>);
    const link = container.querySelector('a');
    expect(link?.getAttribute('data-next-link')).toBeNull();
    expect(link?.getAttribute('href')).toBe('/participants');
  });

  it('주입하면 같은 DOM 계약 그대로 앱 링크로 렌더한다', () => {
    const { container } = render(
      <NextLinkProvider>
        <WireButton href="/participants" variant="secondary">당사자 정보</WireButton>
      </NextLinkProvider>,
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('data-next-link')).toBe('true');
    // DOM 계약 불변: 클래스·data 속성·글자 슬롯이 그대로다(디자인 게이트가 이 DOM 을 잰다).
    expect(link?.className).toBe('wire-button');
    expect(link?.getAttribute('data-variant')).toBe('secondary');
    expect(link?.getAttribute('data-justify')).toBe('center');
    expect(link?.querySelector('.wire-button-text')?.textContent).toBe('당사자 정보');
  });

  it('DOM 래퍼를 만들지 않는다', () => {
    const { container } = render(
      <NextLinkProvider><span data-testid="child">본문</span></NextLinkProvider>,
    );
    expect(container.firstElementChild?.getAttribute('data-testid')).toBe('child');
    expect(container.childElementCount).toBe(1);
  });
});
