import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import { RegisterForm } from './register-form';
import { CONSENT_COPY, CONSENT_COPY_VERSION, CONSENT_DOMAINS } from '@ccc/contracts/consent';

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

  // 2026-08-08 Q: 구 Y8 별표를 내린다. 서버가 이름·이메일·연락처를 셋 다 선택 취급하고
  // (createInitialParticipantProgramAction), D59 가 이름 없는 무응답 등록을 설계된 경우로
  // 인정한다. 화면만 필수라고 말하면 서버 규칙과 어긋난 거짓 안내가 된다.
  it('shows 이름·이메일·연락처 without required asterisks (서버 선택 취급과 일치)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    expect(container.querySelectorAll('.wire-search-label .wire-form-required').length).toBe(0);
    for (const label of ['이름', '이메일', '연락처']) {
      const owner = [...container.querySelectorAll('.wire-search-label')]
        .find((el) => el.textContent?.startsWith(label));
      expect(owner).not.toBeUndefined();
    }
    // 입력 강제도 없다 — 서버 규칙(선택)과 같은 말을 한다.
    for (const name of ['name', 'email', 'phone']) {
      expect((container.querySelector(`input[name="${name}"]`) as HTMLInputElement).required).toBe(false);
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

  it('여섯 영역을 정본 순서와 문안으로 그리고 어떤 결정도 기본 선택하지 않는다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const sections = [...container.querySelectorAll('.register-consent-block .wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual(
      CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].label),
    );
    for (const domain of CONSENT_DOMAINS) {
      const group = container.querySelectorAll(`input[name="consent-${domain}"]`);
      expect(group).toHaveLength(2);
      expect([...group].every((input) => !(input as HTMLInputElement).checked)).toBe(true);
      expect(container.textContent).toContain(CONSENT_COPY[domain].copy);
      expect(container.querySelector(
        `[role="radiogroup"][aria-label="${CONSENT_COPY[domain].label}"]`,
      )).not.toBeNull();
    }
    expect((container.querySelector('input[name="consentCopyVersion"]') as HTMLInputElement).value)
      .toBe(CONSENT_COPY_VERSION);
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('input[name="consentPrivacy"]')).toBeNull();
    expect(container.querySelector('input[name="consentRecordingAi"]')).toBeNull();
  });

  it('사용자가 여섯 결정을 모두 고른 뒤에만 제출 값을 만든다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      const decision = index % 2 === 0 ? 'grant' : 'decline';
      fireEvent.click(container.querySelector(
        `input[name="consent-${domain}"][value="${decision}"]`,
      ) as HTMLInputElement);
    }

    const data = new FormData(form);
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      expect(data.get(`consent-${domain}`)).toBe(index % 2 === 0 ? 'grant' : 'decline');
    }
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('이메일과 사용자가 고른 한 영역 결정은 폼에서 그대로 유지된다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'participant@example.test' } });
    fireEvent.click(container.querySelector(
      'input[name="consent-external_stt_processing"][value="grant"]',
    ) as HTMLInputElement);

    const data = new FormData(form);
    expect(data.get('email')).toBe('participant@example.test');
    expect(data.get('consent-external_stt_processing')).toBe('grant');
    expect(data.get('consent-counseling_recording')).toBeNull();
  });

  it('shows an invalid email beside the field and preserves the other entered values', () => {
    const action = vi.fn();
    const { container } = render(<RegisterForm currentUser={currentUser} action={action} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const name = container.querySelector('input[name="name"]') as HTMLInputElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const phone = container.querySelector('input[name="phone"]') as HTMLInputElement;

    fireEvent.change(name, { target: { value: '김당사자' } });
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.change(phone, { target: { value: '010-1234-5678' } });
    fireEvent.submit(form);

    const error = within(email.closest('.wire-search') as HTMLElement).getByRole('alert');
    expect(error.textContent).toContain('이메일 형식');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(within(email.closest('.wire-search') as HTMLElement).getByRole('textbox', { name: '이메일' })).toBe(email);
    expect(document.activeElement).toBe(email);
    expect(name.value).toBe('김당사자');
    expect(email.value).toBe('not-an-email');
    expect(phone.value).toBe('010-1234-5678');
    expect(action).not.toHaveBeenCalled();
  });

  it('각 영역의 정본 문안을 별도 카드 구획에서 읽을 수 있다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    for (const domain of CONSENT_DOMAINS) {
      const heading = within(container).getByRole('heading', { level: 3, name: CONSENT_COPY[domain].label });
      expect(heading.closest('.wire-card-section')?.textContent).toContain(CONSENT_COPY[domain].copy);
    }
  });

  it('shows the registrant as the read-only 담당 실무자 (이름 우선) and drops the assignee select (등록자=담당 실무자)', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    // 담당 실무자 지정 select 는 사라진다 — 등록자가 곧 담당 실무자다.
    expect(container.querySelector('select[name="initialAssigneeUserId"]')).toBeNull();
    // 현재 사용자(이름 우선)를 읽기 전용으로 표시하고 자동 배정을 안내한다.
    expect(container.textContent).toContain('홍길동');
    expect(container.textContent).toContain('등록한 실무자가 담당 실무자로 자동 배정됩니다');
  });

  it('여섯 결정과 긴급 사유를 모두 확인하기 전에는 등록할 수 없다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(container.querySelector('textarea[name="emergencyReason"]')).toBeNull();

    fireEvent.click(container.querySelector('input[name="emergencyRegistration"]') as HTMLInputElement);
    const reason = container.querySelector('textarea[name="emergencyReason"]') as HTMLTextAreaElement;
    expect(reason.required).toBe(true);
    expect(submit.disabled).toBe(true);
  });

  it('개인정보 동의와 긴급 등록을 함께 켜지 않는다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const grant = () => container.querySelector(
      'input[name="consent-personal_data_collection_use"][value="grant"]',
    ) as HTMLInputElement;
    const emergency = () => container.querySelector('input[name="emergencyRegistration"]') as HTMLInputElement;

    fireEvent.click(grant());
    expect(grant().checked).toBe(true);
    fireEvent.click(emergency());
    expect(emergency().checked).toBe(true);
    expect(grant().checked).toBe(false);

    fireEvent.click(grant());
    expect(grant().checked).toBe(true);
    expect(emergency().checked).toBe(false);
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
