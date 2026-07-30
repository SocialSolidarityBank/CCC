import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { RegisterForm } from './register-form';

const noop = (): void => {};

const currentUser = { name: '홍길동', email: 'me@example.test' };

// vitest.config.ts 에 globals 가 없어 자동 정리가 걸리지 않는다. 이 줄이 없으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 터지고 —
// 테스트가 전부 통과해도 종료코드가 1 이 된다(CI 는 그 숫자만 본다).
afterEach(cleanup);

describe('RegisterForm (#37 당사자 등록 폼)', () => {
  it('renders the input fields and the 등록하기 submit (Y7 — 실무자 대행 등록 화면)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="phone"]')).not.toBeNull();
    const submit = container.querySelector('button[type="submit"]');
    expect(submit?.textContent).toContain('등록하기');
    // 자기 가입 폼(join/participant)은 '가입하기' 가 맞다 — 이 화면만 바뀐다.
    // 검사 범위를 제출 버튼으로 좁힌다: container 전체로 보면 동의 문안(consent-copy.ts, 자기 가입
    // 폼과 공유)이 '가입' 을 쓰게 되는 날 손대지도 않은 이 파일이 깨지고 원인을 엉뚱하게 가리킨다.
    expect(submit?.textContent).not.toContain('가입하기');
  });

  // Y6: 등록 화면만 폼이 배경 위에 놓여 다른 화면의 카드 언어와 달랐다.
  it('wraps the form in the shared card surface and drops the full-width submit (Y6)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const card = container.querySelector('.surface-card.wire-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('form.wire-register-form')).not.toBeNull();
    // 풀폭 규칙(.wire-register-submit)은 이 화면만의 예외였다.
    expect(container.querySelector('.wire-register-submit')).toBeNull();
    expect(container.querySelector('button[type="submit"]')?.className).toContain('register-submit');
  });

  // 2026-07-30 Q(훑기 목록 밖): 참여 사업은 초대 시점에 정해지므로 고를 값이 아니다.
  // 서버 액션도 폼이 보낸 값을 읽지 않는다(programType 하드코딩) — 칸을 없애도 저장은 그대로다.
  it('shows the participating program as a fixed label instead of a select', () => {
    const { container } = render(
      <RegisterForm currentUser={currentUser} action={noop} programLabel="희망키움 2026" />,
    );
    expect(container.querySelector('select[name="programType"]')).toBeNull();
    const fixed = container.querySelector('.register-program-fixed');
    expect(fixed).not.toBeNull();
    expect(fixed?.textContent).toContain('참여 사업');
    expect(fixed?.textContent).toContain('희망키움 2026');
    // 이번에 등록하는 사업 하나만 말한다 — 폼이 사업 값을 실어 보내지 않는다.
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('programType')).toBeNull();
  });

  // 2026-07-30 Q(훑기 목록 밖): 성별이 생년월일 위다.
  it('orders 성별 above 생년월일', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const names = [...container.querySelectorAll('input[name], select[name]')]
      .map((el) => el.getAttribute('name'));
    expect(names.indexOf('gender')).toBeGreaterThan(-1);
    expect(names.indexOf('gender')).toBeLessThan(names.indexOf('birthDate'));
  });

  // Y8: 무엇을 비워도 되는지 알 수 없었다. 별표는 wire-form-required(--risk)를 재사용한다.
  it('marks 이름·이메일·연락처 as required with the shared asterisk (Y8)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const marks = container.querySelectorAll('.wire-search-label .wire-form-required');
    expect(marks.length).toBe(3);
    for (const mark of marks) {
      expect(mark.textContent).toBe('*');
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    }
    for (const label of ['이름', '이메일', '연락처']) {
      const owner = [...container.querySelectorAll('.wire-search-label')]
        .find((el) => el.textContent?.startsWith(label));
      expect(owner?.querySelector('.wire-form-required')).not.toBeNull();
    }
  });

  // 2026-07-30 Q: 자리만 만들고 기능은 다음 세션이다. **올릴 수 있어 보이면 안 된다** —
  // 실무자가 스캔 동의서를 제출했다고 믿으면 동의 없는 상담이 동의 있는 것으로 기록된다.
  it('reserves an inert 서명 동의서 첨부 slot with no file input (요청 3)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const slot = container.querySelector('.consent-upload-slot');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toContain('서명 동의서 첨부');
    expect(slot?.textContent).toContain('준비 중');
    // 조작할 수 있는 것이 하나도 없어야 한다.
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(slot?.querySelector('input, button, a, [role="button"]')).toBeNull();
  });

  // Y10(안 A): 카드 안에서는 그림자를 쓰지 않는다. 공용 규칙을 덮지 않고 범위를 좁힌 클래스를 쓴다 —
  // .consent-fieldset 자체를 고치면 자기 가입 폼·동의 수정 허브가 함께 바뀐다.
  it('scopes the consent block restyle to this screen (Y10)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const fieldset = container.querySelector('fieldset.consent-fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset?.classList.contains('register-consent')).toBe(true);
  });

  it('keeps both consent checkboxes present and unchecked by default (D23·D49·D44)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    for (const name of ['consentPrivacy', 'consentRecordingAi']) {
      const box = container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      expect(box).not.toBeNull();
      expect(box.checked).toBe(false);
    }
    // D49: 구 3종 시절의 두 체크(consentRecording·consentTextAi)는 사라졌다.
    expect(container.querySelector('input[name="consentRecording"]')).toBeNull();
    expect(container.querySelector('input[name="consentTextAi"]')).toBeNull();
  });

  it('carries the privacy consent when checked (D44 — 등록이 동의를 받는 자리)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.click(container.querySelector('input[name="consentPrivacy"]') as HTMLInputElement);
    const data = new FormData(form);
    expect(data.get('consentPrivacy')).toBe('on');
    expect(data.get('consentRecordingAi')).toBeNull();
  });

  it('carries the filled email and a checked consent in the form payload', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const recording = container.querySelector('input[name="consentRecordingAi"]') as HTMLInputElement;

    fireEvent.change(email, { target: { value: 'participant@example.test' } });
    fireEvent.click(recording);

    const data = new FormData(form);
    expect(data.get('email')).toBe('participant@example.test');
    // 체크된 동의만 폼에 실린다(미체크 = 키 부재 = 미동의, D15). 서버 액션이 명시 boolean 으로 정규화한다.
    expect(data.get('consentRecordingAi')).toBe('on');
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

  // G1(① 하드 게이트 + 긴급 등록 예외). 최종 판정은 서버가 하지만, 화면은 "무엇을 채워야
  // 하는지"를 보여야 한다 — 서버 검증만 남으면 화면에서 원인 없는 실패로 보인다.
  it('marks the privacy consent required and moves that requirement to the emergency reason (G1)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const privacy = container.querySelector('input[name="consentPrivacy"]') as HTMLInputElement;
    expect(privacy.required).toBe(true);
    // 긴급 등록 전에는 사유 칸이 없다.
    expect(container.querySelector('textarea[name="emergencyReason"]')).toBeNull();

    fireEvent.click(container.querySelector('input[name="emergencyRegistration"]') as HTMLInputElement);

    const reason = container.querySelector('textarea[name="emergencyReason"]') as HTMLTextAreaElement;
    expect(reason).not.toBeNull();
    expect(reason.required).toBe(true);
    // 긴급 등록을 고르면 ① 필수 표시는 사유 쪽으로 옮겨 간다(둘 다 강제하면 통과 경로가 없다).
    expect((container.querySelector('input[name="consentPrivacy"]') as HTMLInputElement).required).toBe(false);
  });

  it('keeps the privacy consent and the emergency toggle mutually exclusive (G1)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const privacy = () => container.querySelector('input[name="consentPrivacy"]') as HTMLInputElement;
    const emergency = () => container.querySelector('input[name="emergencyRegistration"]') as HTMLInputElement;

    // 서버는 "동의가 있는데 긴급 예외까지 왔다"를 거부한다 — 화면에서 그 조합을 못 만들게 한다.
    fireEvent.click(privacy());
    expect(privacy().checked).toBe(true);
    fireEvent.click(emergency());
    expect(emergency().checked).toBe(true);
    expect(privacy().checked).toBe(false);

    fireEvent.click(privacy());
    expect(privacy().checked).toBe(true);
    expect(emergency().checked).toBe(false);
    expect(container.querySelector('textarea[name="emergencyReason"]')).toBeNull();
  });

  it('carries the emergency reason in the form payload (G1)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.click(container.querySelector('input[name="emergencyRegistration"]') as HTMLInputElement);
    fireEvent.change(container.querySelector('textarea[name="emergencyReason"]') as HTMLTextAreaElement, {
      target: { value: '위기 개입 — 서면 동의 전 등록' },
    });
    const data = new FormData(form);
    expect(data.get('emergencyRegistration')).toBe('on');
    expect(data.get('emergencyReason')).toBe('위기 개입 — 서면 동의 전 등록');
  });

  it('falls back to the email when the registrant has no display name', () => {
    const { container } = render(
      <RegisterForm currentUser={{ name: null, email: 'noname@example.test' }} action={noop} />,
    );
    expect(container.textContent).toContain('noname@example.test');
  });
});
