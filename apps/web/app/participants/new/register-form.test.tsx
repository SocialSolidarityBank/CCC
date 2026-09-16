import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, within, cleanup } from '@testing-library/react';
import {
  RegisterForm as ProductionRegisterForm,
  type RegisterFormProps,
} from './register-form';
import NewParticipantPage from './page';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type ConsentDisclosureSnapshot,
} from '@ccc/contracts/consent';

const noop = (): void => {};

const currentUser = { name: '홍길동', email: 'me@example.test' };

const DISCLOSURES: ConsentDisclosureSnapshot[] = CONSENT_DOMAINS.map((domain, index) => ({
  snapshotId: `snapshot-${index + 1}`,
  scopeBinding: {
    orgId: 'org-1',
    programId: 'program-1',
    issuerId: 'user-1',
    supportCaseId: null,
  },
  domain,
  fullKoreanCopy: `서버가 발급한 ${index + 1}번째 고지 전문`,
  provider: CONSENT_COPY[domain].provider,
  providerLegalRecipient: '사회연대은행',
  country: 'KR',
  purpose: CONSENT_COPY[domain].purpose,
  retentionProfile: 'default_temporary_d85',
  retentionDuration: 'default_temporary_d85',
  copyVersion: 'server-copy-v1',
  copyHash: `copy-hash-${index + 1}`,
  issuedAt: '2026-09-16T00:00:00.000Z',
  expiresAt: '2026-09-16T00:30:00.000Z',
}));

const pageApiMocks = vi.hoisted(() => ({
  getMyIdentity: vi.fn(async () => ({ id: 'user-1', name: '홍길동', email: 'me@example.test', role: 'counselor' })),
  listProgramOptions: vi.fn(async () => ([
    { id: 'program-1', displayName: '희망키움 2026', programType: 'financial_support_v1' },
  ])),
  issueRegistrationConsentDisclosures: vi.fn(async () => DISCLOSURES),
}));

vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  ...pageApiMocks,
}));
vi.mock('../../lib/display-labels', () => ({
  getDisplayLabels: vi.fn(async () => ({ programLabels: { financial_support_v1: '금융지원' } })),
}));
vi.mock('../../actions', () => ({ createInitialParticipantProgramAction: vi.fn() }));

function RegisterForm(
  props: Omit<RegisterFormProps, 'disclosures'> & { disclosures?: readonly ConsentDisclosureSnapshot[] },
) {
  return <ProductionRegisterForm disclosures={DISCLOSURES} {...props} />;
}

// vitest.config.ts 에 globals 가 없어 자동 정리가 걸리지 않는다.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('당사자 등록 고지 로드', () => {
  it('단일 금융지원 사업 ID로 발급한 고지를 같은 등록 폼에 전달한다', async () => {
    const page = await NewParticipantPage({ searchParams: Promise.resolve({}) });
    const view = render(page);
    expect(pageApiMocks.issueRegistrationConsentDisclosures).toHaveBeenCalledWith('program-1');
    expect(view.getByText(DISCLOSURES[0]!.fullKoreanCopy)).not.toBeNull();
    expect(view.getByText('희망키움 2026')).not.toBeNull();
  });

  it('금융지원 사업 후보가 둘이면 임의로 고르지 않고 등록 폼을 막는다', async () => {
    pageApiMocks.listProgramOptions.mockResolvedValueOnce([
      { id: 'program-1', displayName: '희망키움 2026', programType: 'financial_support_v1' },
      { id: 'program-2', displayName: '희망키움 2027', programType: 'financial_support_v1' },
    ]);
    const page = await NewParticipantPage({ searchParams: Promise.resolve({}) });
    const view = render(page);
    expect(view.getByRole('alert').textContent).toContain('등록 가능한 금융지원 사업이 하나일 때만');
    expect(view.container.querySelector('form')).toBeNull();
    expect(pageApiMocks.issueRegistrationConsentDisclosures).not.toHaveBeenCalled();
  });

  it('사업 도입 확인 잠금이면 관리자 화면에서 할 일을 안내한다', async () => {
    const { ApiError } = await import('../../lib/api');
    pageApiMocks.issueRegistrationConsentDisclosures.mockRejectedValueOnce(new ApiError('conflict'));

    const view = render(await NewParticipantPage({ searchParams: Promise.resolve({}) }));

    expect(view.getByRole('alert').textContent).toContain('관리 > 기관');
    expect(view.getByRole('alert').textContent).toContain('저장 위치와 처리 경로');
    expect(view.container.querySelector('form')).toBeNull();
  });

  it('새 고지 snapshot이 오면 이전 결정을 지우고 다시 선택받는다', async () => {
    const firstPage = await NewParticipantPage({ searchParams: Promise.resolve({}) });
    const view = render(firstPage);
    const decision = view.container.querySelector(
      'input[name="consentDecision_personal_data_collection_use"][value="grant"]',
    ) as HTMLInputElement;
    fireEvent.click(decision);
    expect(decision.checked).toBe(true);

    const freshDisclosures = DISCLOSURES.map((snapshot) => ({
      ...snapshot,
      snapshotId: `fresh-${snapshot.snapshotId}`,
    }));
    pageApiMocks.issueRegistrationConsentDisclosures.mockResolvedValueOnce(freshDisclosures);
    const refreshedPage = await NewParticipantPage({ searchParams: Promise.resolve({}) });
    view.rerender(refreshedPage);

    expect((view.container.querySelector(
      'input[name="consentDecision_personal_data_collection_use"][value="grant"]',
    ) as HTMLInputElement).checked).toBe(false);
    expect((view.container.querySelector(
      'input[name="consentSnapshot_personal_data_collection_use"]',
    ) as HTMLInputElement).value).toBe(JSON.stringify(freshDisclosures[0]));
  });
});


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

  // 참여 사업은 화면에서 고르지 않는다. 페이지와 액션이 같은 단일 금융지원 사업을 확인한다.
  // 폼은 programId를 보내지 않으며 후보가 둘 이상이면 페이지가 등록을 막는다.
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
    expect(data.get('programId')).toBeNull();
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

  it('서버에서 받은 여섯 고지 전문과 같은 snapshot 객체를 결정 필드에 묶는다', () => {
    const { container } = render(
      <RegisterForm currentUser={currentUser} action={noop} disclosures={DISCLOSURES} />,
    );
    const sections = [...container.querySelectorAll('.register-consent-block .wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual(
      CONSENT_DOMAINS.map((domain) => `${CONSENT_COPY[domain].label}필수`),
    );
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      const group = container.querySelectorAll(`input[name="consentDecision_${domain}"]`);
      expect(group).toHaveLength(2);
      expect([...group].every((input) => !(input as HTMLInputElement).checked)).toBe(true);
      expect(sections[index]?.textContent).toContain(DISCLOSURES[index]!.fullKoreanCopy);
      expect(sections[index]?.textContent).not.toContain(CONSENT_COPY[domain].copy);
      expect((container.querySelector(
        `input[name="consentSnapshot_${domain}"]`,
      ) as HTMLInputElement).value).toBe(JSON.stringify(DISCLOSURES[index]));
      expect(container.querySelector(
        `[role="radiogroup"][aria-label="${CONSENT_COPY[domain].label}"][aria-required="true"]`,
      )).not.toBeNull();
    }
    expect(container.querySelectorAll('.wire-required-marker')).toHaveLength(CONSENT_DOMAINS.length);
    expect(container.querySelector('input[name="consentCopyVersion"]')).toBeNull();
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('사용자가 여섯 결정을 모두 고른 뒤에만 제출 값을 만든다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      const decision = index % 2 === 0 ? 'grant' : 'decline';
      fireEvent.click(container.querySelector(
        `input[name="consentDecision_${domain}"][value="${decision}"]`,
      ) as HTMLInputElement);
    }

    const data = new FormData(form);
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      expect(data.get(`consentDecision_${domain}`)).toBe(index % 2 === 0 ? 'grant' : 'decline');
      expect(data.get(`consentSnapshot_${domain}`)).toBe(JSON.stringify(DISCLOSURES[index]));
    }
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('이메일과 사용자가 고른 한 영역 결정은 폼에서 그대로 유지된다', () => {
    const { container } = render(<RegisterForm currentUser={currentUser} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'participant@example.test' } });
    fireEvent.click(container.querySelector(
      'input[name="consentDecision_external_stt_processing"][value="grant"]',
    ) as HTMLInputElement);

    const data = new FormData(form);
    expect(data.get('email')).toBe('participant@example.test');
    expect(data.get('consentDecision_external_stt_processing')).toBe('grant');
    expect(data.get('consentDecision_counseling_recording')).toBeNull();
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
      const heading = [...container.querySelectorAll('h3')]
        .find((element) => element.textContent?.startsWith(CONSENT_COPY[domain].label));
      expect(heading?.textContent).toContain('필수');
      expect(heading?.closest('.wire-card-section')?.textContent).toContain(
        DISCLOSURES.find((disclosure) => disclosure.domain === domain)!.fullKoreanCopy,
      );
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
      'input[name="consentDecision_personal_data_collection_use"][value="grant"]',
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
