import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewGatePage from './page';

describe('미리보기 코드 게이트', () => {
  it('일반 POST로 잠금을 풀어 전체 문서 이동을 보장한다', async () => {
    const { container } = render(
      await PreviewGatePage({ searchParams: Promise.resolve({}) }),
    );

    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/preview/unlock');
  });

  it('기관 관리자 미리보기 전용 입구를 제공한다', async () => {
    const { container } = render(
      await PreviewGatePage({ searchParams: Promise.resolve({}) }),
    );

    expect(container.querySelector('a[href="/preview/admin"]')).not.toBeNull();
  });
});
