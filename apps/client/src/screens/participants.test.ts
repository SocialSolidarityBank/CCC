// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DOMAINS, type ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import { ParticipantRegisterScreen } from './participants';
import { IntakeScreen } from './intake';
import { ParticipantsApi } from '../business/participants';
import { SchedulesApi } from '../business/schedules';
import { BusinessError } from '../business/errors';
import type { HumanRole } from '../business/api';
import type { Session } from '../business/session';
import { readiness } from '../business/test-support';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const beneficiaryId = 'swallow-003';
const intakePath = `/participants/${beneficiaryId}/programs/${CASE_ID}/records/intake`;
const roots = new Set<{ root: Root; container: HTMLElement }>();

afterEach(async () => {
  for (const { root, container } of roots) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

async function harness(options: {
  roles?: HumanRole[]; assigned?: boolean; closed?: boolean; admissionReady?: boolean;
  permissionFailure?: boolean; registrationFailure?: boolean; direct?: boolean;
} = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const roles = options.roles ?? ['worker'];
  let permissionFailure = options.permissionFailure === true;
  let assigned = options.assigned !== false;
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
      return { beneficiaryId, supportCaseId: CASE_ID, assignmentRole: 'primary', replayed: false };
    }
    if (permissionFailure) throw new BusinessError('unavailable', 503);
    if (path.endsWith('/hub')) return {
      beneficiaryId, restricted: false, participantName: null, participantPhone: null, participantEmail: null,
      participantBirthDate: null, status: 'active', closedAt: null, sessionCount: 0, lastSessionAt: null,
      programs: [{ id: CASE_ID, beneficiaryId, programId: 'program-1', programName: '합성 사업',
        programType: 'financial_support_v1', status: options.closed ? 'closed' : 'active', intakeAt: null,
        creationKind: 'initial', sourceSupportCase: null, participantName: null, participantPhone: null,
        authorized: true, assigneeNames: [], consentRecordedAt: null, closedAt: null, upcomingSchedule: null }],
    };
    if (path.endsWith('/briefing')) return {
      beneficiaryId, focusSupportCaseId: CASE_ID, overallGoal: null, canEditOverallGoal: assigned,
      activeGoals: [], participant: { name: null, phone: null }, focusUpcomingSchedule: null,
      sections: [{ sourceSupportCase: { id: CASE_ID }, aiSuggestions: [], sessionRows: [],
        discrepancies: [], openActionItems: [], flags: [], pendingReviewSessionIds: [] }],
    };
    throw new Error(`Unexpected request: ${method} ${path}`);
  } };
  const session = {
    participants: new ParticipantsApi(transport as never), schedules: new SchedulesApi(transport as never),
    me: { roles, institution: readiness('org-1', { initialSetupState: 'complete' }) },
    consent: { registrationDisclosures: async () => disclosures },
    auth: { signOut: vi.fn(), recheck: vi.fn() },
    intake: { context: async () => {
      calls.push('intake.context');
      return { beneficiaryId, supportCaseId: CASE_ID, participant: { name: null, phone: null, email: null },
        sessionSequence: 1, hasIntake: false, extendedPii: {}, consent: [], overallGoal: null,
        schedule: null, saved: null };
    } },
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
  }], { initialEntries: [options.direct ? intakePath : '/participants/new'] });
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
      await act(async () => {
        container.querySelector<HTMLInputElement>(`#consent-${domain}-grant`)!.click();
      });
    }
    await act(async () => { container.querySelector('form')!.requestSubmit(); });
  };
  return { container, calls, register, router,
    recover: () => { permissionFailure = false; }, revoke: () => { assigned = false; } };
}

describe('registration to first intake', () => {
  it('offers the returned person and case route and opens the intake form', async () => {
    const { container, register, router } = await harness();
    await register();
    expect(container.querySelector(`a[href="${intakePath}"]`)).not.toBeNull();
    expect(container.querySelector('#register-program')).toBeNull();
    await act(async () => { await router.navigate(intakePath); });
    expect(container.querySelector('label[for="intake-held-at"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it.each([
    { roles: ['institution-admin'] as HumanRole[], assigned: true },
    { roles: ['institution-admin', 'worker'] as HumanRole[], assigned: false },
    { roles: ['worker'] as HumanRole[], assigned: true, closed: true },
  ])('does not turn registration or read authority into write authority: %j', async (options) => {
    const { container, register } = await harness(options);
    await register();
    expect(container.querySelector(`a[href="${intakePath}"]`)).toBeNull();
    expect(container.querySelector(`a[href="/participants/${beneficiaryId}"]`)).not.toBeNull();
  });

  it('retries only the permission read after successful registration', async () => {
    const { container, calls, register, recover } = await harness({ permissionFailure: true });
    await register();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector(`a[href="${intakePath}"]`)).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    recover();
    await act(async () => { container.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(calls.filter((call) => call === 'POST /participants')).toHaveLength(1);
    expect(container.querySelector(`a[href="${intakePath}"]`)).not.toBeNull();
  });

  it('rechecks assignment when entering intake instead of trusting the earlier action', async () => {
    const { container, register, router, revoke } = await harness();
    await register();
    revoke();
    await act(async () => { await router.navigate(intakePath); });
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector(`a[href="/participants/${beneficiaryId}"]`)).not.toBeNull();
  });

  it('does not show a writing form for a direct read-only entry', async () => {
    const { container } = await harness({ roles: ['supervisor'], direct: true });
    expect(container.querySelector('form')).toBeNull();
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
