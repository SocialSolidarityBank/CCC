import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { PageError } from './page-error';
import { WireButton } from './wire-button';

afterEach(cleanup);

describe('PageError — 오류 화면 공용 셸 (§5 로딩 행 ③ "오류도 같은 셸")', () => {
  it('제목은 PageTitle 이고 오류 한 줄은 카드 안에 선다', () => {
    const { container } = render(<PageError title="당사자 정보">불러올 수 없습니다.</PageError>);
    const title = container.querySelector('.wire-page-title');
    expect(title?.textContent).toBe('당사자 정보');
    // 오류 줄이 맨 그리드가 아니라 카드 안에 있어야 한다 — 구 형태(카드 없는 맨 알약)의 회귀 잠금.
    const card = container.querySelector('.wire-card');
    expect(card).not.toBeNull();
    const alert = within(card as HTMLElement).getByRole('alert');
    expect(alert.textContent).toBe('불러올 수 없습니다.');
    // 로딩 카드와 같은 92 예약이라 로딩에서 오류로 바뀔 때 화면이 튀지 않는다.
    expect(alert.getAttribute('data-reserve')).toBe('true');
  });

  it('action 을 주면 복귀 버튼 줄이 카드 아래 선다', () => {
    const { container } = render(
      <PageError
        title="15초 페이지"
        action={<WireButton variant="secondary" href="/participants">당사자 목록으로 돌아가기</WireButton>}
      >
        불러올 수 없습니다.
      </PageError>,
    );
    const link = within(container as HTMLElement).getByRole('link', { name: '당사자 목록으로 돌아가기' });
    expect(link.getAttribute('href')).toBe('/participants');
    // 버튼은 카드 밖이다(브리핑 EmptyState 와 같은 문법).
    expect(link.closest('.wire-card')).toBeNull();
  });

  it('action 이 없으면 행동 줄 자체가 없다', () => {
    const { container } = render(<PageError title="인테이크">불러올 수 없습니다.</PageError>);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});
