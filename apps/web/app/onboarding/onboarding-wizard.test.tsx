import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { OnboardingWizard } from './onboarding-wizard';

// app-sidebar.test.tsx 와 같은 이유 — vitest 전역 미설정이라 수동 정리한다.
afterEach(cleanup);

function textInput(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector(`input[name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`input ${name} not found`);
  return input;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((el) => el.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button ${text} not found`);
  return button;
}

describe('OnboardingWizard (CCC-32 · 스펙 #78 US 1)', () => {
  it('1단계 기관 이름 → 2단계 사업 이름 순서로 진행하고, 빈 값이면 다음이 잠긴다', () => {
    const { container } = render(<OnboardingWizard action={vi.fn()} />);

    // 1단계: 기관 이름. 비어 있으면 다음 버튼이 눌리지 않는다.
    expect(container.textContent).toContain('1단계 / 2단계');
    expect(buttonByText(container, '다음').disabled).toBe(true);

    fireEvent.change(textInput(container, 'orgName'), { target: { value: '연대은행' } });
    expect(buttonByText(container, '다음').disabled).toBe(false);
    fireEvent.click(buttonByText(container, '다음'));

    // 2단계: 사업 이름. 저장 버튼은 사업 이름을 채워야 열린다.
    expect(container.textContent).toContain('2단계 / 2단계');
    expect(buttonByText(container, '저장하고 시작하기').disabled).toBe(true);
    fireEvent.change(textInput(container, 'programDisplayName'), { target: { value: '금융지원 사업' } });
    expect(buttonByText(container, '저장하고 시작하기').disabled).toBe(false);
  });

  it('2단계 폼에도 1단계 값이 hidden 으로 실려 한 번에 제출된다', () => {
    const { container } = render(<OnboardingWizard action={vi.fn()} />);
    fireEvent.change(textInput(container, 'orgName'), { target: { value: '연대은행' } });
    fireEvent.click(buttonByText(container, '다음'));

    const hidden = container.querySelector('input[type="hidden"][name="orgName"]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe('연대은행');
  });

  it('저장돼 있던 이름이 미리 채워진다 — 온보딩은 수정 경로 겸용', () => {
    const { container } = render(
      <OnboardingWizard action={vi.fn()} initialOrgName="연대은행" initialProgramName="금융지원 사업" />,
    );
    expect(textInput(container, 'orgName').value).toBe('연대은행');
    fireEvent.click(buttonByText(container, '다음'));
    expect(textInput(container, 'programDisplayName').value).toBe('금융지원 사업');
    // 2단계에서 이전으로 돌아가도 값이 남는다.
    fireEvent.click(buttonByText(container, '이전'));
    expect(textInput(container, 'orgName').value).toBe('연대은행');
  });
});
