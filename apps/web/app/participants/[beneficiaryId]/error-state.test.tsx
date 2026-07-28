import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { ErrorState } from './error-state';

afterEach(cleanup);

describe('참여자 정보 차단 안내 (CCC-23)', () => {
  it('복귀 링크가 참여자 목록을 가리킨다', () => {
    const { container } = render(<ErrorState kind="access_or_not_found" />);
    const link = within(container).getByRole('link', { name: '참여자 목록으로 돌아가기' });
    expect(link.getAttribute('href')).toBe('/participants');
  });

  it('안내 문구가 참여자의 존재 여부를 드러내지 않는다 (D36 전제 게이트)', () => {
    // "없는 참여자"와 "권한 없음"을 구분하지 않는다 — 존재 자체가 정보다.
    const { container } = render(<ErrorState kind="access_or_not_found" />);
    const alert = within(container).getByRole('alert');
    expect(alert.textContent).toContain('접근 권한과 주소를 확인하세요');
    expect(alert.textContent).not.toContain('존재하지');
    expect(alert.textContent).not.toContain('찾을 수 없');
  });
});
