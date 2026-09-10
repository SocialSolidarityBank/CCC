import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WelcomePage as PublicWelcomePage } from '@ccc/site/pages';
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

  it('설정된 업무 origin의 루트 대신 로그인 경로로 연결한다', () => {
    const { container } = render(<PublicWelcomePage loginOrigin="https://work.example.test" />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#adoption',
      'https://work.example.test/login',
    ]);
    expect(container.querySelector('form')).toBeNull();
  });
});
