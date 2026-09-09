import { describe, expect, it } from 'vitest';
import { decodeAssignmentRequests, decodeIdentity, decodeMemorySettings, SettingsApi } from './api';
import { initialEditor, reduceEditor } from './editing';
import { BusinessError } from './errors';
import { capabilities, installation, installationId, json } from './test-support';

describe('settings response boundaries', () => {
  it('accepts a nullable own-account email without manufacturing one', () => {
    const me = decodeIdentity({ id: 'user-1', orgId: 'org-1', email: null, name: null, active: true,
      roles: ['worker'] });
    expect(me.email).toBeNull();
  });

  it('rejects active assignments and path-bearing IDs in pending requests', () => {
    const request = {
      id: 'assignment-1', supportCaseId: 'case-1', beneficiaryId: 'beneficiary-1',
      participantName: null, programType: 'financial_support_v1', role: 'secondary',
      status: 'requested', requestedAt: '2026-09-09T12:00:00.000Z',
    };
    expect(() => decodeAssignmentRequests({ requests: [{ ...request, status: 'active' }] })).toThrow(BusinessError);
    expect(() => decodeAssignmentRequests({ requests: [{ ...request, id: 'assignment/1' }] })).toThrow(BusinessError);
  });

  it('does not retry or fabricate acceptance after a conflict', async () => {
    let writes = 0;
    const transport = new (await import('./transport')).BusinessTransport(await installation(), () => 'token', async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/capabilities')) return json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId });
      writes += 1;
      return json({ error: 'conflict' }, 409);
    });
    const api = new SettingsApi(transport);
    await transport.initialize();
    await expect(api.acceptAssignment('case-1', 'assignment-1')).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await expect(api.acceptAssignment('case-1', 'assignment-1')).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(writes).toBe(2);
    transport.dispose();
  });

  it('retains a technical administrator without manufacturing institution-admin authority', () => {
    const me = decodeIdentity({ id: 'technical-user', orgId: 'synthetic-org', email: 'technical@example.invalid',
      name: null, active: true, roles: ['technical-admin'], role: 'admin' });
    expect(me.roles).toEqual(['technical-admin']);
    expect(() => decodeIdentity({ ...me, roles: ['admin'] })).toThrow(BusinessError);
    expect(() => decodeIdentity({ ...me, active: false })).toThrow(BusinessError);
  });

  it('rejects unexpected memory content and invalid counters rather than rendering them', () => {
    const counters = { enabled: false, version: 1, pendingCases: 0, blockedCases: 0, failedCases: 0, lastSuccessAt: null };
    expect(() => decodeMemorySettings({ ...counters, participantText: 'unexpected-content' })).toThrow(BusinessError);
    expect(() => decodeMemorySettings({ ...counters, pendingCases: -1 })).toThrow(BusinessError);
    expect(() => decodeMemorySettings({ ...counters, version: 1.5 })).toThrow(BusinessError);
  });
});

describe('compare-and-swap editor', () => {
  it('preserves a draft through conflict and explicit refresh, without adopting a new baseline before refresh', () => {
    let state = initialEditor<{ orgName: string }, string>();
    state = reduceEditor(state, { type: 'loaded', value: { orgName: 'Before' }, draft: 'Before' });
    state = reduceEditor(state, { type: 'edit', draft: 'My change' });
    state = reduceEditor(state, { type: 'saving' });
    state = reduceEditor(state, { type: 'failed', error: new BusinessError('conflict', 409), write: true });
    expect(state.draft).toBe('My change');
    expect(state.value?.orgName).toBe('Before');
    expect(state.needsRefresh).toBe(true);
    state = reduceEditor(state, { type: 'loaded', value: { orgName: 'Their change' }, draft: 'Their change' });
    expect(state.draft).toBe('My change');
    expect(state.value?.orgName).toBe('Their change');
    expect(state.needsRefresh).toBe(false);
  });

  it('requires reading the outcome of an uncertain write before another save', () => {
    let state = initialEditor<{ version: number; enabled: boolean }, boolean>();
    state = reduceEditor(state, { type: 'loaded', value: { version: 1, enabled: false }, draft: false });
    state = reduceEditor(state, { type: 'edit', draft: true });
    state = reduceEditor(state, { type: 'failed', error: new BusinessError('unavailable', 503), write: true });
    expect(state.draft).toBe(true);
    expect(state.value?.version).toBe(1);
    expect(state.needsRefresh).toBe(true);
    state = reduceEditor(state, { type: 'saved', value: { version: 2, enabled: true }, draft: true });
    expect(state.value?.version).toBe(2);
    expect(state.needsRefresh).toBe(false);
    expect(state.saved).toBe(true);
  });
});
