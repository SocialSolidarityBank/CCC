import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RiskBanner, type RiskBannerFlag } from './risk-banner';

const confirmedFlag: RiskBannerFlag = {
  id: 'flag-confirmed',
  flagType: 'crisis_utterance',
  source: 'counselor',
  reviewStatus: 'confirmed',
};

const pendingAiFlag: RiskBannerFlag = {
  id: 'flag-pending',
  flagType: 'debt_deterioration',
  source: 'ai',
  reviewStatus: 'pending',
};

describe('RiskBanner', () => {
  it('확인된 플래그가 있으면 경고 배너를 렌더한다', () => {
    const { container } = render(<RiskBanner flags={[confirmedFlag]} />);
    const banner = container.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(container.textContent).toContain('위기 발언');
  });

  it('확인된 플래그가 없으면 배너를 DOM에 남기지 않는다', () => {
    const { container } = render(<RiskBanner flags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('검토 전 AI 제안(미확인 플래그)은 배너에서 제외한다', () => {
    const { container } = render(<RiskBanner flags={[pendingAiFlag]} />);
    expect(container.firstChild).toBeNull();
  });

  it('배너에는 접기 UI(details/summary/버튼)가 없다', () => {
    const { container } = render(<RiskBanner flags={[confirmedFlag]} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('summary')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  // --risk 대비가 흰 위 2.72 로 WCAG 아래에 있으므로(DESIGN.md §9) 색 하나로 경고를 전달하지
  // 않는다. 아이콘·문구·고정 위치·접힘 불가 4중 신호가 계약이고, 그중 마크업으로 검증할 수 있는
  // 둘(아이콘·문구)을 여기서 고정한다. 색을 못 보는 상태에서도 배너가 무엇인지 알 수 있어야 한다.
  it('색 없이도 읽히도록 경고 아이콘과 건수 문구를 함께 둔다', () => {
    const { container } = render(<RiskBanner flags={[confirmedFlag, { ...confirmedFlag, id: 'flag-2' }]} />);
    expect(container.querySelector('.risk-banner-icon')).not.toBeNull();
    expect(container.textContent).toContain('확인된 리스크 2건');
  });

  it('경고 아이콘은 문구와 내용이 겹치므로 접근성 트리에서 숨긴다', () => {
    const { container } = render(<RiskBanner flags={[confirmedFlag]} />);
    expect(container.querySelector('.risk-banner-icon')?.getAttribute('aria-hidden')).toBe('true');
  });
});
