// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_COPY, CONSENT_DOMAINS, type ConsentDisclosureSnapshot, type CurrentConsentState } from '@ccc/contracts/consent';
import {
  INTAKE_WRITE_SCHEMA_VERSION, requiredIntakeQuestionKeys, type IntakeCreateRequest, type IntakeQuestionLifecycle,
  type IntakeUpdateRequest, type IntakeSavedRecord,
} from '@ccc/contracts/intake';
import { ParticipantRegisterScreen } from './participants';
import { IntakeScreen } from './intake';
import { ParticipantsApi } from '../business/participants';
import { IntakeApi } from '../business/intake';
import { BusinessError } from '../business/errors';
import type { HumanRole } from '../business/api';
import type { Session } from '../business/session';
import { readiness, intakeModule, intakeQuestionnaire } from '../business/test-support';

const CASE_ID = '2f9d1e6e-0d94-4f39-8f21-0d4f9d3a6f10';
const beneficiaryId = 'swallow-003';
const intakePath = `/participants/${beneficiaryId}/programs/${CASE_ID}/records/intake`;
const contextPath = `/support-cases/${CASE_ID}/records/intake`;
const heldAt = '2026-09-01T01:00:00.000Z';
const narrative = '합성 신청 배경';
const legacyJson = '{"answers":[{"key":"summary_urgency","response":"answered","text":"즉시 개입 필요"}],"family_care_burden":"복수 돌봄","additionalItems":[{"item":"원자료","reason":"구 사유"}]}';
const questionLifecycle = (revision = 1, withdrawn = false): IntakeQuestionLifecycle => ({
  version: 1,
  items: [{
    id: 'question-1', revision: withdrawn ? 2 : 1, sourceRevision: revision, sourceRowIndex: 0,
    createdBy: 'user-1', createdAt: heldAt,
    withdrawn: withdrawn ? { actorId: 'user-1', recordedAt: heldAt, fromRevision: 1 } : null, origin: null,
  }],
  conversion: null,
});
const roots = new Set<{ root: Root; container: HTMLElement }>();
const consent: CurrentConsentState[] = CONSENT_DOMAINS.map((domain) => ({
  domain, state: 'unconfirmed', provider: CONSENT_COPY[domain].provider, providerLegalRecipient: null,
  providerCountry: null, purpose: CONSENT_COPY[domain].purpose,
  retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
  effectiveAt: null, eventId: null, revision: null, eventSequence: null,
}));
afterEach(async () => {
  for (const { root, container } of roots) { await act(async () => { root.unmount(); }); container.remove(); }
  roots.clear(); vi.unstubAllGlobals();
});

async function harness(options: {
  roles?: HumanRole[]; canWriteIntake?: boolean; canWrite?: unknown; admissionReady?: boolean;
  contextFailure?: boolean; registrationFailure?: boolean; replayed?: boolean; direct?: boolean;
  saved?: boolean; legacy?: boolean; unbound?: boolean; omitted?: boolean; withdrawn?: boolean; financialSupportEnabled?: boolean;
  writeFailure?: 'invalid_request' | 'forbidden' | 'conflict' | 'unavailable'; routeBeneficiaryId?: string;
} = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const writes: Array<IntakeCreateRequest | IntakeUpdateRequest> = [];
  const roles = options.roles ?? ['worker'];
  let contextFailure = options.contextFailure === true;
  let writeFailure = options.writeFailure;
  const moduleSnapshot = { ...intakeModule, financialSupportEnabled: options.financialSupportEnabled ?? false };
  const questionnaire = intakeQuestionnaire(moduleSnapshot, moduleSnapshot.financialSupportEnabled ? ['economy'] : [], [
    { key: 'application_reason_detail', response: 'answered', text: narrative },
    { key: 'managerOpinion', response: 'answered', text: '합성 실무자 의견' },
  ]);
  questionnaire.linkedOrgs = { response: 'answered', rows: [{ orgName: '합성 연계기관', serviceName: '연계 서비스' }] };
  questionnaire.additionalItems = { response: 'answered', rows: [{ item: '합성 추가 질문', dueNote: '다음 상담 전' }] };
  if (moduleSnapshot.financialSupportEnabled) questionnaire.debts = { response: 'answered', rows: [{ creditor: '합성 채권자', balance: '120만 원' }] };
  const savedRevision = options.omitted || options.withdrawn ? 2 : 1;
  const savedQuestionnaire = options.omitted ? { ...questionnaire, additionalItems: { response: 'unknown' as const } } : questionnaire;
  const savedHistory = options.omitted ? [{
    revision: 1, schemaVersion: 2 as const, heldAt, channel: 'phone' as const, actorId: 'user-1', recordedAt: heldAt,
    convertedFromRevision: null, detailsJson: JSON.stringify(questionnaire), questionLifecycle: questionLifecycle(1),
  }] : [];
  let current: IntakeSavedRecord | null = options.legacy ? { sessionId: 'intake-1', heldAt, channel: 'phone', revision: 1,
    history: [], schemaVersion: 1, questionnaire: null, legacyDetailsJson: legacyJson, questionLifecycle: null }
    : options.saved ? { sessionId: 'intake-1', heldAt, channel: 'phone', revision: savedRevision, history: savedHistory,
      schemaVersion: 2, questionnaire: savedQuestionnaire, legacyDetailsJson: null,
      questionLifecycle: options.unbound ? null : questionLifecycle(options.omitted ? 1 : savedRevision, options.withdrawn) } : null;
  const disclosures: ConsentDisclosureSnapshot[] = CONSENT_DOMAINS.map((domain) => ({
    snapshotId: `disclosure-${domain}`, scopeBinding: { orgId: 'org-1', programId: 'program-1', issuerId: 'user-1', supportCaseId: null },
    domain, fullKoreanCopy: '합성 동의 문안', provider: CONSENT_COPY[domain].provider, providerLegalRecipient: '기관',
    country: null, purpose: CONSENT_COPY[domain].purpose, retentionProfile: 'default_temporary_d85',
    retentionDuration: 'default_temporary_d85', copyVersion: 'consent-six-domains-v1', copyHash: 'hash',
    issuedAt: heldAt, expiresAt: '2027-09-10T00:00:00.000Z',
  }));
  const transport = { request: async (path: string, method = 'GET', body?: IntakeCreateRequest | IntakeUpdateRequest) => {
    calls.push(`${method} ${path}`);
    if (path === '/program-options') return { programs: [{ id: 'program-1', displayName: '합성 사업',
      programType: 'financial_support_v1', admissionState: options.admissionReady === false ? 'undecided' : 'ready' }] };
    if (path === '/settings/accounts') return { accounts: [{ id: 'worker-1', name: '합성 실무자', email: null, active: true, roles: ['worker'] }], nextCursor: null };
    if (path === '/participants' && method === 'POST') {
      if (options.registrationFailure) throw new BusinessError('forbidden', 403);
      return { beneficiaryId, supportCaseId: CASE_ID, assignmentRole: 'primary', replayed: options.replayed === true,
        canWriteIntake: options.canWriteIntake ?? true };
    }
    if (path === contextPath && method === 'GET') {
      if (contextFailure) throw new BusinessError('unavailable', 503);
      return { beneficiaryId, supportCaseId: CASE_ID, participant: { name: null, phone: null, email: null },
        sessionSequence: 1, hasIntake: current !== null, writeSchemaVersion: INTAKE_WRITE_SCHEMA_VERSION, moduleSnapshot,
        canWrite: Object.hasOwn(options, 'canWrite') ? options.canWrite : true,
        extendedPii: {}, consent, overallGoal: null, schedule: null, saved: current };
    }
    if (path === contextPath && body) {
      writes.push(structuredClone(body));
      if (writeFailure) {
        const failure = writeFailure; writeFailure = undefined;
        if (failure === 'conflict' && current) current = {
          ...current, revision: current.revision + 1,
          questionLifecycle: current.questionLifecycle === null ? null : questionLifecycle(current.revision + 1),
        };
        throw new BusinessError(failure, failure === 'invalid_request' ? 400 : failure === 'forbidden' ? 403 : failure === 'conflict' ? 409 : 503);
      }
      const history = current ? [{ revision: current.revision, schemaVersion: current.schemaVersion, heldAt: current.heldAt,
        channel: current.channel, actorId: null, recordedAt: heldAt, convertedFromRevision: null,
        detailsJson: current.schemaVersion === 1 ? current.legacyDetailsJson : JSON.stringify(current.questionnaire),
        questionLifecycle: current.questionLifecycle }, ...current.history] : [];
      const revision = (current?.revision ?? 0) + 1;
      current = { schemaVersion: 2, sessionId: 'intake-1', heldAt: body.heldAt, channel: body.channel,
        questionnaire: body.questionnaire, legacyDetailsJson: null, revision, history, questionLifecycle: questionLifecycle(revision) };
      return { schemaVersion: 3, revision: current.revision, replayed: false,
        record: { id: current.sessionId, heldAt: current.heldAt, channel: current.channel, kind: 'intake' } };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  } };
  const session = { participants: new ParticipantsApi(transport as never), intake: new IntakeApi(transport as never),
    me: { roles, institution: readiness('org-1', { initialSetupState: 'complete' }) },
    consent: { registrationDisclosures: async () => disclosures }, auth: { signOut: vi.fn(), recheck: vi.fn() },
  } as unknown as Session;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.add({ root, container });
  const router = createMemoryRouter([{ element: createElement(() => createElement(Outlet, { context: session })), children: [
    { path: '/participants/new', element: createElement(ParticipantRegisterScreen) },
    { path: '/participants/:beneficiaryId/programs/:supportCaseId/records/intake', element: createElement(IntakeScreen) },
  ] }], { initialEntries: [options.direct ? `/participants/${options.routeBeneficiaryId ?? beneficiaryId}/programs/${CASE_ID}/records/intake` : '/participants/new'] });
  await act(async () => { root.render(createElement(RouterProvider, { router })); });
  const select = (id: string, value: string) => act(async () => {
    const field = container.querySelector<HTMLSelectElement>(`#${id}`)!;
    field.value = value; field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const fill = (id: string, value: string) => act(async () => {
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const click = (selector: string) => act(async () => { container.querySelector<HTMLElement>(selector)!.click(); });
  const submit = () => act(async () => { container.querySelector('form')!.requestSubmit(); });
  const register = async () => {
    await select('register-program', 'program-1');
    if (roles.includes('institution-admin')) await select('register-assignee', 'worker-1');
    for (const domain of CONSENT_DOMAINS) await click(`#consent-${domain}-grant`);
    await submit();
  };
  const completeCommon = async () => {
    for (const key of requiredIntakeQuestionKeys([])) await select(`intake-${key}-response`, 'unknown');
    await select('intake-linkedOrgs-response', 'not_applicable');
    await select('intake-additionalItems-response', 'declined');
  };
  return { container, calls, writes, router, register, select, fill, click, submit, completeCommon,
    recover: () => { contextFailure = false; } };
}

describe('versioned intake journey', () => {
  it('registers once, follows both returned IDs, reads one context and submits applicable v3 answers', async () => {
    const h = await harness(); await h.register();
    expect(h.container.querySelector(`a[href="${intakePath}"]`)).not.toBeNull();
    expect(h.calls).toEqual(['GET /program-options', 'POST /participants']);
    await act(async () => { await h.router.navigate(intakePath); });
    expect(h.calls).toEqual(['GET /program-options', 'POST /participants', `GET ${contextPath}`]);
    await h.completeCommon(); await h.fill('intake-held-at', '2026-09-01T10:00'); await h.select('intake-channel', 'video'); await h.submit();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ schemaVersion: 3, channel: 'video', additionalItemRefs: [], questionWithdrawals: [],
      questionnaire: { moduleSnapshot: intakeModule, linkedOrgs: { response: 'not_applicable' }, additionalItems: { response: 'declined' }, debts: null } });
    expect(h.writes[0]!.questionnaire.answers.map((answer) => answer.key)).toEqual(requiredIntakeQuestionKeys([]));
    expect(h.calls.filter((call) => call === 'POST /participants')).toHaveLength(1);
  });

  it('keeps selected area requirements and values while the accessible target is collapsed', async () => {
    const h = await harness({ direct: true, financialSupportEnabled: true });
    await h.completeCommon(); await h.fill('intake-held-at', '2026-09-01T10:00');
    await h.select('intake-difficulty_areas-response', 'answered'); await h.click('#intake-difficulty_areas-economy');
    await h.select('intake-debts-response', 'answered'); await h.fill('debts-0-creditor', '보존 채권자');
    const selector = 'button[aria-controls="intake-area-economy"]';
    const control = h.container.querySelector<HTMLButtonElement>(selector)!;
    expect(control).not.toBeNull();
    expect(control.type).toBe('button');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    const target = h.container.querySelector<HTMLElement>(`#${control.getAttribute('aria-controls')}`)!;
    expect(target).not.toBeNull();
    expect(target.hidden).toBe(false);
    expect(target.querySelector('#intake-economy_monthly_income-response')).not.toBeNull();
    await h.click(selector);
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(target.hidden).toBe(true);
    await h.submit();
    expect(h.writes).toHaveLength(0);
    expect(h.container.querySelector('[role="alert"]')).not.toBeNull();
    await h.click(selector);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(target.hidden).toBe(false);
    for (const key of requiredIntakeQuestionKeys(['economy']).filter((key) => !requiredIntakeQuestionKeys([]).includes(key))) await h.select(`intake-${key}-response`, 'unknown');
    await h.select('intake-economy_monthly_income-response', 'answered'); await h.fill('intake-economy_monthly_income', '0');
    await h.select('intake-economy_detail-response', 'answered'); await h.fill('intake-economy_detail', '보존할 경제 기록');
    await h.click(selector);
    expect(target.hidden).toBe(true);
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector<HTMLInputElement>('#intake-economy_monthly_income')?.value).toBe('0');
    expect(target.querySelector<HTMLTextAreaElement>('#intake-economy_detail')?.value).toBe('보존할 경제 기록');
    expect(h.container.querySelector<HTMLInputElement>('#intake-difficulty_areas-economy')?.checked).toBe(true);
    expect(h.container.querySelector<HTMLInputElement>('#debts-0-creditor')?.value).toBe('보존 채권자');
    await h.submit();
    expect(h.writes[0]!.questionnaire.answers).toContainEqual({ key: 'difficulty_areas', response: 'answered', choices: ['economy'] });
    expect(h.writes[0]!.questionnaire.answers).toContainEqual({ key: 'economy_monthly_income', response: 'answered', amount: 0 });
    expect(h.writes[0]!.questionnaire.answers).toContainEqual({ key: 'economy_detail', response: 'answered', text: '보존할 경제 기록' });
    expect(h.writes[0]!.questionnaire.debts).toEqual({ response: 'answered', rows: [{ creditor: '보존 채권자' }] });
  });

  it('does not open financial debt fields just because the existing program type is financial_support_v1', async () => {
    const h = await harness({ direct: true }); await h.select('intake-difficulty_areas-response', 'answered');
    await h.click('#intake-difficulty_areas-economy'); expect(h.container.querySelector('#intake-debts-response')).toBeNull();
  });

  it('retains the same submission ID after a transport failure', async () => {
    const h = await harness({ direct: true, writeFailure: 'unavailable' });
    await h.completeCommon(); await h.fill('intake-held-at', '2026-09-01T10:00'); await h.submit(); await h.submit();
    expect(h.writes).toHaveLength(2);
    expect((h.writes[0] as IntakeCreateRequest).submissionId).toBe((h.writes[1] as IntakeCreateRequest).submissionId);
  });

  it.each(['institution-admin', 'supervisor', 'worker'] as const)('preserves saved readonly answers and tables for %s', async (role) => {
    const h = await harness({ direct: true, roles: [role], canWrite: false, saved: true, financialSupportEnabled: true });
    for (const text of [narrative, heldAt, '합성 채권자', '합성 연계기관', '합성 추가 질문']) expect(h.container.textContent).toContain(text);
    expect(h.container.querySelector('form, input, select, textarea, button[type="submit"]')).toBeNull();
    expect(h.calls).toEqual([`GET ${contextPath}`]);
  });

  it('sends stable references only for explicit intake question withdrawal', async () => {
    const h = await harness({ direct: true, saved: true });
    await h.fill('additionalItems-0-item', '철회와 함께 보내면 안 되는 수정');
    const withdraw = [...h.container.querySelectorAll('button')].find((button) => button.textContent === '철회')!;
    expect(withdraw).not.toBeUndefined();
    await act(async () => { withdraw.click(); });
    expect(h.container.textContent).toContain('철회 취소');
    expect(h.container.querySelector<HTMLInputElement>('#additionalItems-0-item')?.value).toBe('합성 추가 질문');
    await h.submit();
    expect(h.writes[0]).toMatchObject({
      schemaVersion: 3,
      additionalItemRefs: [{ rowIndex: 0, questionId: 'question-1', expectedRevision: 1 }],
      questionWithdrawals: [{ questionId: 'question-1', expectedRevision: 1 }],
      questionnaire: { additionalItems: { response: 'answered', rows: [{ item: '합성 추가 질문', dueNote: '다음 상담 전' }] } },
    });
  });

  it('keeps retained questions open when the table records a nonanswer', async () => {
    const h = await harness({ direct: true, saved: true });
    await h.select('intake-additionalItems-response', 'unknown');
    await h.submit();
    expect(h.writes[0]).toMatchObject({
      schemaVersion: 3,
      questionnaire: { additionalItems: { response: 'unknown' } },
      additionalItemRefs: [],
      questionWithdrawals: [],
    });
  });

  it('restores an omitted retained question with its existing identity and revision', async () => {
    const h = await harness({ direct: true, saved: true, omitted: true });
    expect(h.container.textContent).toContain('합성 추가 질문');
    const restore = [...h.container.querySelectorAll('button')].find((button) => button.textContent === '다시 넣기')!;
    expect(restore).not.toBeUndefined();
    await act(async () => { restore.click(); });
    expect(h.container.querySelector<HTMLInputElement>('#additionalItems-0-item')?.value).toBe('합성 추가 질문');
    await h.submit();
    expect(h.writes[0]).toMatchObject({
      schemaVersion: 3,
      additionalItemRefs: [{ rowIndex: 0, questionId: 'question-1', expectedRevision: 1 }],
      questionWithdrawals: [],
    });
  });

  it('shows withdrawn questions and requires an explicit replacement response before another save', async () => {
    const h = await harness({ direct: true, saved: true, withdrawn: true });
    expect(h.container.textContent).toContain('합성 추가 질문');
    expect(h.container.textContent).toContain('철회');
    expect(h.container.textContent).toContain('새 질문을 추가하거나 응답 종류를');
    expect(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await h.select('intake-additionalItems-response', 'unknown');
    expect(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('requires explicit legacy conversion, preserving channel and original revision without reclassification', async () => {
    const h = await harness({ direct: true, legacy: true });
    expect(h.container.textContent).toContain('즉시 개입 필요'); expect(h.container.textContent).toContain('구 사유');
    expect(h.container.querySelector('form')).toBeNull(); await h.click('#intake-conversion');
    expect(h.container.querySelector<HTMLSelectElement>('#intake-summary_urgency-response')?.value).toBe('');
    await h.completeCommon(); await h.submit();
    expect(h.writes[0]).toMatchObject({ schemaVersion: 3, expectedRevision: 1, heldAt, channel: 'phone',
      additionalItemRefs: [{ rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 }],
      questionWithdrawals: [], conversion: { confirmed: true, sourceRevision: 1 } });
    expect(JSON.stringify(h.writes[0]!.questionnaire)).not.toContain('즉시 개입 필요');
    expect(h.container.textContent).toContain('구 사유');
  });

  it('requires explicit conversion for an unbound v2 intake without inventing question identity', async () => {
    const h = await harness({ direct: true, saved: true, unbound: true });
    expect(h.container.querySelector('form')).toBeNull();
    await h.click('#intake-conversion');
    await h.submit();
    expect(h.writes[0]).toMatchObject({
      schemaVersion: 3, expectedRevision: 1,
      additionalItemRefs: [{ rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 }],
      conversion: { confirmed: true, sourceRevision: 1 },
    });
  });

  it('blocks resubmission on 409 until the user explicitly reloads and uses the fresh revision', async () => {
    const h = await harness({ direct: true, saved: true, writeFailure: 'conflict' }); await h.submit();
    expect(h.calls).toEqual([`GET ${contextPath}`, `PUT ${contextPath}`]);
    expect(h.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(h.container.querySelector<HTMLTextAreaElement>('#intake-application_reason_detail')?.value).toBe(narrative);
    await act(async () => { [...h.container.querySelectorAll('button')].find((button) => button.textContent?.includes('최신 기록 불러오기'))!.click(); });
    await h.submit(); expect((h.writes[1] as IntakeUpdateRequest).expectedRevision).toBe(2);
  });

  it('rechecks context rather than trusting the creation CTA and preserves read access', async () => {
    const h = await harness({ saved: true, canWrite: false }); await h.register();
    await act(async () => { await h.router.navigate(intakePath); });
    expect(h.container.textContent).toContain(narrative); expect(h.container.querySelector('form')).toBeNull();
  });

  it('does not infer writing from a worker role or replayed primary assignment', async () => {
    const h = await harness({ canWriteIntake: false, replayed: true }); await h.register();
    expect(h.container.querySelector(`a[href="${intakePath}"]`)).toBeNull(); expect(h.container.querySelector('form')).toBeNull();
    expect(h.calls).toEqual(['GET /program-options', 'POST /participants']);
  });

  it('retries a failed context read without creating the person again', async () => {
    const h = await harness({ contextFailure: true }); await h.register();
    await act(async () => { await h.router.navigate(intakePath); }); expect(h.container.querySelector('[role="alert"]')).not.toBeNull();
    h.recover(); await h.click('button'); expect(h.calls.filter((call) => call === 'POST /participants')).toHaveLength(1);
    expect(h.container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it.each([true, false])('rejects mixed person/case routes before rendering saved data (canWrite=%s)', async (canWrite) => {
    const h = await harness({ direct: true, saved: true, canWrite, routeBeneficiaryId: 'otter-011' });
    expect(h.container.querySelector('[role="alert"]')).not.toBeNull(); expect(h.container.textContent).not.toContain(narrative);
    expect(h.container.querySelector('form')).toBeNull();
    await act(async () => { await h.router.navigate(intakePath); }); expect(h.container.querySelector('[role="alert"]')).toBeNull();
    if (!canWrite) expect(h.container.textContent).toContain(narrative);
    else expect(h.container.querySelector<HTMLTextAreaElement>('#intake-application_reason_detail')?.value).toBe(narrative);
  });

  it.each([undefined, null, 'true', 1])('rejects invalid context permission %s', async (canWrite) => {
    const h = await harness({ direct: true, canWrite }); expect(h.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(h.container.querySelector('form')).toBeNull();
  });

  it('preserves registration admission, consent and explicit server errors', async () => {
    const blank = await harness(); expect(blank.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    const locked = await harness({ admissionReady: false }); expect(locked.container.querySelector('option[value="program-1"]')).toBeNull();
    const rejected = await harness({ registrationFailure: true }); await rejected.register();
    expect(rejected.container.querySelector('[role="alert"]')).not.toBeNull(); expect(rejected.container.querySelector(`a[href="${intakePath}"]`)).toBeNull();
  });
});
