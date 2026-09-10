import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireEmpty, WireError } from './wire-state';

afterEach(cleanup);

describe('WireError — 오류 알림 한 줄 (2026-08-09 Q 알약 박스 정정)', () => {
  it('리스크 텍스트 줄이다 — 배지 알약이 아니다', () => {
    const { container } = render(<WireError>불러올 수 없습니다.</WireError>);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.tagName).toBe('P');
    expect(alert?.className).toContain('wire-error');
    // 구 형태: WireBadge tone="risk". 배지는 inline-flex 알약이라 그리드에서 전폭
    // 알약 막대가 됐다(D61 알약은 배지 라벨 전유물) — 회귀를 클래스로 잠근다.
    expect(container.querySelector('.wire-badge')).toBeNull();
  });

  it('reserve 는 켤 때만 자리를 예약한다 (WireEmpty 와 같은 규칙)', () => {
    const { container } = render(
      <>
        <WireError>기본</WireError>
        <WireError reserve>카드 유일 내용</WireError>
      </>,
    );
    const lines = [...container.querySelectorAll('.wire-error')];
    expect(lines[0]?.getAttribute('data-reserve')).toBeNull();
    expect(lines[1]?.getAttribute('data-reserve')).toBe('true');
  });
});

describe('WireEmpty — 빈 상태 한 줄', () => {
  it('role="status" 텍스트 줄이다', () => {
    const { container } = render(<WireEmpty>아직 없습니다.</WireEmpty>);
    const status = container.querySelector('[role="status"]');
    expect(status?.className).toContain('empty');
  });
});
