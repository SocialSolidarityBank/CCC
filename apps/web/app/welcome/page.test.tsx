import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import WelcomePage from './page';

afterEach(cleanup);

describe('공개 소개의 도입 경로', () => {
  it('기관 생성이나 가짜 로그인 대신 페이지 안의 도입 안내로 연결한다', () => {
    const { container } = render(<WelcomePage />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#adoption']);
    expect(container.querySelector('#adoption')).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });
});
