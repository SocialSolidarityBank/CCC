import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RiskBanner, type RiskBannerFlag } from './risk-banner';

afterEach(cleanup);

const recordsHref = '/participants/swallow-003/programs/case-1/records';

const confirmedFlag: RiskBannerFlag = {
  id: 'flag-confirmed',
  flagType: 'crisis_utterance',
  source: 'counselor',
  reviewStatus: 'confirmed',
  sessionId: 'session-1',
  quote: '더는 버티기 어렵다고 말했다.',
};

const pendingAiFlag: RiskBannerFlag = {
  id: 'flag-pending',
  flagType: 'debt_deterioration',
  source: 'ai',
  reviewStatus: 'pending',
  sessionId: 'session-2',
  quote: '이자를 석 달째 내지 못했다.',
};

describe('RiskBanner', () => {
  it('확인된 플래그가 있으면 경고 배너를 렌더한다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[confirmedFlag]} />);
    const banner = container.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(container.textContent).toContain('위기 발언');
  });

  it('D72 신설 유형과 확장된 건강 급변 라벨을 표시한다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[
      { ...confirmedFlag, id: 'flag-health', flagType: 'housing_livelihood_shock' },
      { ...confirmedFlag, id: 'flag-violence', flagType: 'violence_exploitation' },
    ]} />);
    expect(container.textContent).toContain('주거·생계·건강 급변');
    expect(container.textContent).toContain('폭력·착취 피해');
  });

  it('근거 인용을 접은 채 그 자리에 두고 출처 회차로 연결한다 (D73)', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[confirmedFlag]} />);
    const disclosure = container.querySelector('details[data-source-quotes]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('더는 버티기 어렵다고 말했다.');
    expect(disclosure?.querySelector('a')?.getAttribute('href')).toBe(`${recordsHref}#record-session-1`);
  });

  it('확인된 플래그가 없으면 배너를 DOM에 남기지 않는다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('검토 전 AI 제안(미확인 플래그)은 배너에서 제외한다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[pendingAiFlag]} />);
    expect(container.firstChild).toBeNull();
  });

  it('배너에는 접기 UI(details/summary/버튼)가 없다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[confirmedFlag]} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(container.querySelector('details[data-source-quotes]')).not.toBeNull();
  });

  // --risk 대비가 흰 위 2.72 로 WCAG 아래에 있으므로(DESIGN.md §9) 색 하나로 경고를 전달하지
  // 않는다. 아이콘·문구·고정 위치·접힘 불가 4중 신호가 계약이고, 그중 마크업으로 검증할 수 있는
  // 둘(아이콘·문구)을 여기서 고정한다. 색을 못 보는 상태에서도 배너가 무엇인지 알 수 있어야 한다.
  it('색 없이도 읽히도록 경고 아이콘과 건수 문구를 함께 둔다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[confirmedFlag, { ...confirmedFlag, id: 'flag-2' }]} />);
    expect(container.querySelector('.risk-banner-icon')).not.toBeNull();
    expect(container.textContent).toContain('확인된 리스크 2건');
  });

  it('경고 아이콘은 문구와 내용이 겹치므로 접근성 트리에서 숨긴다', () => {
    const { container } = render(<RiskBanner recordsHref={recordsHref} flags={[confirmedFlag]} />);
    expect(container.querySelector('.risk-banner-icon')?.getAttribute('aria-hidden')).toBe('true');
  });
});
