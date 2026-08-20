import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import WelcomePage from './page';

afterEach(cleanup);

// 공개 입구 화면(CCC-109). 이 페이지는 **동기** 서버 컴포넌트라 jsdom 에서 통째로 렌더할
// 수 있다 — 인증·데이터 조회가 없다는 성질이 곧 "렌더에 목이 하나도 필요 없다"로 나타난다.
// 목이 필요해지는 순간이 이 화면에 조회가 스며든 순간이다.

describe('공개 입구 화면 /welcome (CCC-109)', () => {
  it('인증·데이터 목 없이 렌더된다', () => {
    const { container } = render(<WelcomePage />);
    expect(container.querySelector('h1')?.textContent).toBe('CCC 사례관리');
  });

  it('두 진입 버튼이 각각 온보딩과 로그인(홈)으로 간다', () => {
    const { container } = render(<WelcomePage />);
    const links = new Map(
      Array.from(container.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')]),
    );
    expect(links.get('기관 등록 시작')).toBe('/onboarding');
    expect(links.get('실무자 로그인')).toBe('/');
  });

  it('로그인 버튼 곁에 Access 로그인 안내가 있다', () => {
    // 로그인 화면이 따로 없으므로, Access 화면이 뜨는 것이 고장이 아님을 입구에서 알린다.
    const { container } = render(<WelcomePage />);
    expect(container.textContent).toContain('Cloudflare Access');
  });

  it('15초 브리핑 카피가 있다 — 5분은 여는 시점, 15초는 훑는 시간', () => {
    // CONTEXT.md '브리핑' 항목이 카피의 근거다. 두 숫자가 사라지면 소개가 제품의
    // 핵심 가치(상담 5분 전 브리핑 한 화면)를 말하지 않는 화면이 된다.
    const { container } = render(<WelcomePage />);
    expect(container.textContent).toContain('상담 5분 전');
    expect(container.textContent).toContain('15초');
  });
});
