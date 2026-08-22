import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewAdminGatePage from './page';

describe('기관 관리자 미리보기 코드 게이트', () => {
  it('기관 관리자 코드로 설정 화면에 들어가는 일반 POST 폼을 제공한다', async () => {
    const { container } = render(
      await PreviewAdminGatePage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.querySelector('h1')?.textContent).toBe('기관 관리자 미리보기 접속');
    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/preview/unlock');
    expect(container.querySelector<HTMLInputElement>('input[name="mode"]')?.value).toBe('admin');
    expect(container.querySelector('a[href="/preview"]')).not.toBeNull();
  });
});
