import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireCardSection, WireItem } from './wire-section';

afterEach(cleanup);

describe('WireCardSection — 카드 안 구획', () => {
  it('라벨은 구획의 **직계 자식 h3** 다 — 한 겹만 감싸도 14/600 라벨 계약이 죽는다', () => {
    // 계약이 `.wire-card-section>h3` 라 직계여야만 산다. 한 겹 감싸면 규칙이 안 걸려
    // 브라우저 기본 h3(18.7px)가 그대로 나오고, 라벨이 본문 16 보다 커져 위계가 뒤집힌다 —
    // 이 부품이 생기기 전 카드들이 실제로 그 상태였다. querySelector('h3') 는 깊이를 안 보므로
    // 자식 결합자로 단언한다.
    const { container } = render(<WireCardSection title="세션 목표">내용</WireCardSection>);
    const section = container.querySelector('.wire-card-section');
    expect(section?.tagName).toBe('SECTION');
    expect(section?.querySelector(':scope>h3')?.textContent).toBe('세션 목표');
  });

  it('기본 톤은 무채색이라 data-tone 을 달지 않는다', () => {
    const { container } = render(<WireCardSection title="수기 메모">내용</WireCardSection>);
    expect(container.querySelector('.wire-card-section')?.getAttribute('data-tone')).toBeNull();
  });

  it('계열 톤은 data-tone 으로 나간다 (D34 고정 의미)', () => {
    const { container } = render(<WireCardSection title="AI 제안" tone="lavender">내용</WireCardSection>);
    expect(container.querySelector('.wire-card-section')?.getAttribute('data-tone')).toBe('lavender');
  });

  it('구획 전체 행동은 공용 action 슬롯에서 제목 뒤 카드 끝으로 분리한다', () => {
    const { container } = render(
      <WireCardSection title="AI 제안" action={<button type="button">닫기</button>}>내용</WireCardSection>,
    );
    const head = container.querySelector('.wire-card-section-head');
    const action = container.querySelector('.wire-card-section-action');
    expect(head?.lastElementChild).toBe(action);
    expect(action?.textContent).toBe('닫기');
  });

  it('구획 둘은 **형제로** 나온다 — 자동 구분선(.wire-card-section+.wire-card-section)이 사는 조건이다', () => {
    // 이 단언이 지키는 것: 누가 구획마다 <div> 로 한 겹 감싸면 CSS 의 인접 형제 선택자가
    // 조용히 죽어 §2-2 규칙 2ⓐ(3줄 이상이면 가로선)가 화면에서만 사라진다. 마크업이 평평한지를
    // 여기서 잠근다 — 구분선 자체는 CSS 라 jsdom 이 못 본다.
    const { container } = render(
      <div>
        <WireCardSection title="세션 목표">A</WireCardSection>
        <WireCardSection title="맞춤형 질문">B</WireCardSection>
      </div>,
    );
    const sections = [...container.querySelectorAll('.wire-card-section')];
    expect(sections).toHaveLength(2);
    expect(sections[0]?.nextElementSibling).toBe(sections[1]);
  });
});

describe('WireItem — 한 항목(제목·설명·상태·행동)', () => {
  it('제목·설명이 서로 다른 단으로 나간다 (§2-2 위계 4단)', () => {
    const { container } = render(
      <WireItem title="최근 구직 활동은 어땠는지" description="지난 회차에서 면접 결과를 기다리고 있었다" />,
    );
    expect(container.querySelector('.wire-item-title')?.textContent).toBe('최근 구직 활동은 어땠는지');
    expect(container.querySelector('.wire-item-desc')?.textContent).toBe('지난 회차에서 면접 결과를 기다리고 있었다');
  });

  it('설명·상태·행동은 준 것만 그린다 — 빈 줄을 자리 지키기로 남기지 않는다', () => {
    const { container } = render(<WireItem title="제목만" />);
    expect(container.querySelector('.wire-item-desc')).toBeNull();
    expect(container.querySelector('.wire-item-status')).toBeNull();
    expect(container.querySelector('.wire-item-action')).toBeNull();
  });

  it('개별 항목 행동은 항목 텍스트 뒤에 선다', () => {
    const { container } = render(
      <WireItem title="제안" description="확인할 내용" action={<a href="/records">근거 회차 보기</a>} />,
    );
    const description = container.querySelector('.wire-item-desc');
    const action = container.querySelector('.wire-item-action');
    expect(action?.querySelector('a')?.getAttribute('href')).toBe('/records');
    expect(description?.nextElementSibling).toBe(action);
  });

  it('톤을 주면 면이 붙고, 안 주면 면 없이 줄만 선다', () => {
    const { container } = render(
      <>
        <WireItem title="면 없음" />
        <WireItem title="라벤더 면" tone="lavender" testId="tinted" />
      </>,
    );
    const items = [...container.querySelectorAll('.wire-item')];
    expect(items[0]?.getAttribute('data-tone')).toBeNull();
    expect(items[1]?.getAttribute('data-tone')).toBe('lavender');
  });
});
