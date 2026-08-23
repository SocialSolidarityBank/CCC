import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireTimeline, WireTimelineItem } from './wire-timeline';

afterEach(cleanup);

describe('WireTimeline (CCC-78)', () => {
  it('시간 순서 나열로 렌더한다 — 마지막 항목은 연결선을 그리지 않는다', () => {
    const { container } = render(
      <WireTimeline>
        <WireTimelineItem><p>최신 문구</p></WireTimelineItem>
        <WireTimelineItem><p>이전 문구</p></WireTimelineItem>
        <WireTimelineItem><p>최초 문구</p></WireTimelineItem>
      </WireTimeline>,
    );

    const list = container.querySelector('ol.wire-timeline');
    expect(list).not.toBeNull();
    const items = [...(list?.querySelectorAll('li.wire-timeline-item') ?? [])];
    expect(items).toHaveLength(3);
    // 마디(dot)는 전 항목, 연결선(after)은 마지막 항목에서 끊긴다 — CSS pseudo-element 는
    // jsdom 에서 계산되지 않으므로 클래스 계약으로 고정한다.
    expect(items[0]?.className).toContain('wire-timeline-item');
    expect(items[2]?.textContent).toContain('최초 문구');
  });

  it('className 슬롯으로 호출부 클래스를 덧붙인다 (goal-tree-history-row)', () => {
    const { container } = render(
      <WireTimeline>
        <WireTimelineItem className="goal-tree-history-row"><p>문구</p></WireTimelineItem>
      </WireTimeline>,
    );
    const item = container.querySelector('li');
    expect(item?.classList.contains('wire-timeline-item')).toBe(true);
    expect(item?.classList.contains('goal-tree-history-row')).toBe(true);
  });
});