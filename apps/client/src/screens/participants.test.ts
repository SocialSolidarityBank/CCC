// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_COPY, CONSENT_DOMAINS, type ConsentDisclosureSnapshot, type CurrentConsentState } from '@ccc/contracts/consent';
import { ParticipantRegisterScreen } from './participants';
import { IntakeScreen } from './intake';
import { ParticipantsApi } from '../business/participants';
import { IntakeApi } from '../business/intake';
import { BusinessError } from '../business/errors';
import type { HumanRole } from '../business/api';
import type { Session } from '../business/session';
import { readiness } from '../business/test-support';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const beneficiaryId = 'swallow-003';
const intakePath = `/participants/${beneficiaryId}/programs/${CASE_ID}/records/intake`;
const contextPath = `/support-cases/${CASE_ID}/records/intake`;
const roots = new Set<{ root: Root; container: HTMLElement }>();
const consent: CurrentConsentState[] = CONSENT_DOMAINS.map((domain) => ({
  domain, state: 'unconfirmed',
  provider: CONSENT_COPY[domain].provider, providerLegalRecipient: null, providerCountry: null,
  purpose: CONSENT_COPY[domain].purpose,
  retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
  effectiveAt: null, eventId: null, revision: null, eventSequence: null,
}));
const savedIntake = {
  sessionId: 'intake-1', heldAt: '2026-09-01T01:00:00.000Z',
  answers: [
    { key: 'application_reason_detail', response: 'answered', text: '합성 신청 배경\n다음 줄도 보존' },
    { key: 'welfare_other', response: 'unknown' },
  ],
  debts: [{ creditor: '합성 채권자', balance: '120만 원' }],
  linkedOrgs: [{ orgName: '합성 연계기관', serviceName: '연계 서비스' }],
  additionalItems: [{ item: '합성 추가 질문', reason: '확인이 필요한 이유' }],
  managerOpinion: '합성 실무자 의견',
};

afterEach(async () => {
  for (const { root, container } of roots) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

async function harness(options: {
  roles?: HumanRole[]; canWriteIntake?: boolean; canWrite?: unknown; admissionReady?: boolean;
  contextFailure?: boolean; registrationFailure?: boolean; replayed?: boolean; direct?: boolean; saved?: boolean;
  routeBeneficiaryId?: string;
} = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const roles = options.roles ?? ['worker'];
  let contextFailure = options.contextFailure === true;
  const disclosures: ConsentDisclosureSnapshot[] = CONSENT_DOMAINS.map((domain) => ({
    snapshotId: `disclosure-${domain}`,
    scopeBinding: { orgId: 'org-1', programId: 'program-1', issuerId: 'user-1', supportCaseId: null },
    domain, fullKoreanCopy: '합성 동의 문안', provider: 'institution', providerLegalRecipient: '기관',
    country: null, purpose: 'case_management', retentionProfile: 'default_temporary_d85',
    retentionDuration: 'default_temporary_d85', copyVersion: 'consent-six-domains-v1', copyHash: 'hash',
    issuedAt: '2026-09-10T00:00:00.000Z', expiresAt: '2027-09-10T00:00:00.000Z',
  }));
  const transport = { request: async (path: string, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/program-options') return { programs: [{ id: 'program-1', displayName: '합성 사업',
      programType: 'financial_support_v1', admissionState: options.admissionReady === false ? 'undecided' : 'ready' }] };
    if (path === '/settings/accounts') return { accounts: [{ id: 'worker-1', name: '합성 실무자',
      email: null, active: true, roles: ['worker'] }], nextCursor: null };
    if (path === '/participants' && method === 'POST') {
      if (options.registrationFailure) throw new BusinessError('forbidden', 403);
      return { beneficiaryId, supportCaseId: CASE_ID, assignmentRole: 'primary',
        replayed: options.replayed === true, canWriteIntake: options.canWriteIntake ?? true };
    }
    if (path === contextPath && method === 'GET') {
      if (contextFailure) throw new BusinessError('unavailable', 503);
      return { beneficiaryId, supportCaseId: CASE_ID, participant: { name: null, phone: null, email: null },
        sessionSequence: 1, hasIntake: options.saved === true,
        canWrite: Object.hasOwn(options, 'canWrite') ? options.canWrite : true,
        extendedPii: {}, consent, overallGoal: null, schedule: null, saved: options.saved ? savedIntake : null };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  } };
  const session = {
    participants: new ParticipantsApi(transport as never), intake: new IntakeApi(transport as never),
    me: { roles, institution: readiness('org-1', { initialSetupState: 'complete' }) },
    consent: { registrationDisclosures: async () => disclosures },
    auth: { signOut: vi.fn(), recheck: vi.fn() },
  } as unknown as Session;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add({ root, container });
  const router = createMemoryRouter([{
    element: createElement(() => createElement(Outlet, { context: session })),
    children: [
      { path: '/participants/new', element: createElement(ParticipantRegisterScreen) },
      { path: '/participants/:beneficiaryId/programs/:supportCaseId/records/intake', element: createElement(IntakeScreen) },
    ],
  }], { initialEntries: [options.direct
    ? `/participants/${options.routeBeneficiaryId ?? beneficiaryId}/programs/${CASE_ID}/records/intake`
    : '/participants/new'] });
  await act(async () => { root.render(createElement(RouterProvider, { router })); });
  const select = async (id: string, value: string) => act(async () => {
    const input = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const register = async () => {
    await select('register-program', 'program-1');
    if (roles.includes('institution-admin')) await select('register-assignee', 'worker-1');
    for (const domain of CONSENT_DOMAINS) {
      await act(async () => { container.querySelector<HTMLInputElement>(`#consent-${domain}-grant`)!.click(); });
    }
    await act(async () => { container.querySelector('form')!.requestSubmit(); });
  };
  return { container, calls, register, router, recover: () => { contextFailure = false; } };
}

describe('registration to first intake', () => {
  it('uses the returned permission and IDs without a permission fetch, then reads context once', async () => {
    const { container, calls, register, router } = await harness();
    await register();
    expect(container.querySelector(`a[href="${intakePath}"]`)).not.toBeNull();
    expect(container.querySelector('#register-program')).toBeNull();
    expect(calls).toEqual(['GET /program-options', 'POST /participants']);
    await act(async () => { await router.navigate(intakePath); });
    expect(calls).toEqual(['GET /program-options', 'POST /participants', `GET ${contextPath}`]);
    expect(container.querySelector('label[for="intake-held-at"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#intake-application_reason_detail')?.disabled).toBe(false);
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('does not infer writing from a worker role or replayed primary assignment', async () => {
    const { container, calls, register } = await harness({ canWriteIntake: false, replayed: true });
    await register();
    expect(container.querySelector(`a[href="${intakePath}"]`)).toBeNull();
    expect(container.querySelector(`a[href="/participants/${beneficiaryId}"]`)).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(calls).toEqual(['GET /program-options', 'POST /participants']);
  });

  it('retries context after entry failure without creating the participant again', async () => {
    const { container, calls, register, router, recover } = await harness({ contextFailure: true });
    await register();
    await act(async () => { await router.navigate(intakePath); });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    recover();
    await act(async () => { container.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(calls.filter((call) => call === 'POST /participants')).toHaveLength(1);
    expect(calls.filter((call) => call === `GET ${contextPath}`)).toHaveLength(2);
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('rechecks context instead of trusting the registration CTA', async () => {
    const { container, register, router } = await harness({ canWrite: false, saved: true });
    await register();
    expect(container.querySelector(`a[href="${intakePath}"]`)).not.toBeNull();
    await act(async () => { await router.navigate(intakePath); });
    expect(container.textContent).toContain(savedIntake.answers[0]!.text);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it.each([
    ['institution admin', ['institution-admin']],
    ['supervisor', ['supervisor']],
    ['worker reading a closed case', ['worker']],
  ] as const)('preserves saved questionnaire and tables for %s without editing', async (_label, roles) => {
    const { container, calls } = await harness({ roles: [...roles], canWrite: false, saved: true, direct: true });
    expect(container.textContent).toContain(savedIntake.answers[0]!.text);
    expect(container.textContent).toContain(savedIntake.heldAt);
    expect(container.querySelector('input, select, textarea, button[type="submit"]')).toBeNull();
    for (const expected of ['합성 채권자', '합성 연계기관', '합성 추가 질문']) {
      await act(async () => {
        [...container.querySelectorAll('button')].find((button) => button.textContent === '다음 단계')!.click();
      });
      expect(container.textContent).toContain(expected);
      expect(container.querySelector('input, select, textarea, button[type="submit"]')).toBeNull();
    }
    expect(container.textContent).toContain(savedIntake.managerOpinion);
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(calls).toEqual([`GET ${contextPath}`]);
  });

  it.each([true, false])('rejects a mixed-person/case route before rendering saved data (canWrite=%s)', async (canWrite) => {
    const { container, calls, router } = await harness({
      canWrite, saved: true, direct: true, routeBeneficiaryId: 'otter-011',
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('form, input, select, textarea, button[type="submit"]')).toBeNull();
    expect(container.textContent).not.toContain(savedIntake.answers[0]!.text);
    expect(container.textContent).not.toContain(savedIntake.managerOpinion);
    expect(calls).toEqual([`GET ${contextPath}`]);
    await act(async () => { await router.navigate(intakePath); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    if (canWrite) {
      expect(container.querySelector<HTMLTextAreaElement>('#intake-application_reason_detail')?.value)
        .toBe(savedIntake.answers[0]!.text);
    } else {
      expect(container.textContent).toContain(savedIntake.answers[0]!.text);
      expect(container.querySelector('input, select, textarea, button[type="submit"]')).toBeNull();
    }
  });

  it.each([undefined, null, 'true', 1])('rejects invalid context write permission %s', async (canWrite) => {
    const { container } = await harness({ canWrite, direct: true });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('retains admission and consent gates before registration', async () => {
    const { container, calls } = await harness();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(calls).not.toContain('POST /participants');
    const locked = await harness({ admissionReady: false });
    expect(locked.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(locked.container.querySelector('option[value="program-1"]')).toBeNull();
  });

  it('does not offer first intake when registration is rejected', async () => {
    const { container, register } = await harness({ registrationFailure: true });
    await register();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector(`a[href="${intakePath}"]`)).toBeNull();
  });
});
