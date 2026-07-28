import { describe, it, expect } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { RegisterForm } from './register-form';

const noop = (): void => {};

const currentUser = { name: '홍길동', email: 'me@example.test' };

describe('RegisterForm (#37 당사자 등록 폼)', () => {
  it('renders the 2×2 wireframe fields (name·email·phone·program)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="phone"]')).not.toBeNull();
    expect(container.querySelector('select[name="programType"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain('가입하기');
  });

  it('keeps all three consent checkboxes present and unchecked by default (D23·D15·D44)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    for (const name of ['consentPrivacy', 'consentRecording', 'consentTextAi']) {
      const box = container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      expect(box).not.toBeNull();
      expect(box.checked).toBe(false);
    }
  });

  it('carries the privacy consent when checked (D44 — 등록이 동의를 받는 자리)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.click(container.querySelector('input[name="consentPrivacy"]') as HTMLInputElement);
    const data = new FormData(form);
    expect(data.get('consentPrivacy')).toBe('on');
    expect(data.get('consentRecording')).toBeNull();
  });

  it('carries the filled email and a checked consent in the form payload', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const recording = container.querySelector('input[name="consentRecording"]') as HTMLInputElement;

    fireEvent.change(email, { target: { value: 'participant@example.test' } });
    fireEvent.click(recording);

    const data = new FormData(form);
    expect(data.get('email')).toBe('participant@example.test');
    // 체크된 동의만 폼에 실린다(미체크 = 키 부재 = 미동의, D15). 서버 액션이 명시 boolean 으로 정규화한다.
    expect(data.get('consentRecording')).toBe('on');
    expect(data.get('consentTextAi')).toBeNull();
  });

  it('renders a collapsed "자세히 읽어보기" accordion with the consent detail copy (D15·D23)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const detail = container.querySelector('details.consent-detail') as HTMLDetailsElement;
    expect(detail).not.toBeNull();
    expect(detail.open).toBe(false);
    expect(within(container).getByText('자세히 읽어보기')).not.toBeNull();
    expect(detail.textContent).toContain('법률 검토 전 참고용 초안');
  });

  it('shows the registrant as the read-only 담당 실무자 (이름 우선) and drops the assignee select (등록자=담당 실무자)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    // 담당 실무자 지정 select 는 사라진다 — 등록자가 곧 담당 실무자다.
    expect(container.querySelector('select[name="initialAssigneeUserId"]')).toBeNull();
    // 현재 사용자(이름 우선)를 읽기 전용으로 표시하고 자동 배정을 안내한다.
    expect(container.textContent).toContain('홍길동');
    expect(container.textContent).toContain('등록한 실무자가 담당 실무자로 자동 배정됩니다');
  });

  it('falls back to the email when the registrant has no display name', () => {
    const { container } = render(
      <RegisterForm currentUser={{ name: null, email: 'noname@example.test' }} action={noop} />,
    );
    expect(container.textContent).toContain('noname@example.test');
  });
});
