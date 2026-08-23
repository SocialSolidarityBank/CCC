import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireSteps } from './wire-steps';

afterEach(cleanup);

describe('WireSteps (CCC-81)', () => {
  it('현재·완료·대기 상태를 마디와 함께 렌더하고 현재 단계를 aria-current 로 알린다', () => {
    const { container } = render(
      <WireSteps
        steps={[{ label: '당사자 선택' }, { label: '상담 일시·유형' }, { label: '맞춤형 질문' }]}
        current={2}
      />,
    );

    const steps = [...(container.querySelectorAll('li.wire-step') ?? [])];
    expect(steps).toHaveLength(3);
    expect(steps[0]?.classList.contains('wire-step-done')).toBe(true);
    expect(steps[1]?.classList.contains('wire-step-current')).toBe(true);
    expect(steps[2]?.classList.contains('wire-step-upcoming')).toBe(true);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(steps[0]?.getAttribute('aria-current')).toBeNull();
  });
});