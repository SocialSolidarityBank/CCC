import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@ccc/core/gateway';
import type { MeResponse, OrganizationOnboardingResponse } from '@ccc/contracts/institution';
import type { ProgramListResponse, ProgramMutationResponse, ProgramOptionsResponse } from '@ccc/contracts/program-admission';
import { handleRequest } from '@ccc/http-api';
import { setupD1, testActors, testProgramId } from './support/d1';

const t = setupD1();
const admin = testActors.admin;
const worker = testActors.counselor;
const request = (path: string, method = 'GET', body?: unknown, actor: Actor = admin) => handleRequest(
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }), t.env, async () => actor,
);

// Identity resolution is injected; database, gateway, HTTP responses and audit are real.
describe('persisted institution first journey', () => {
  it('routes through initial setup and explicit confirmation without granting participant consent or hiding later locks', async () => {
    await t.reset();
    const initial = await (await request('/me')).json() as MeResponse;
    expect(initial.institution).toMatchObject({ settingsState: 'present', onboardingCompleted: false, firstProgram: null });
    // An existing unlinked fixture program must not be guessed to be the initial program.
    const onboardedResponse = await request('/organization/onboarding', 'POST', {
      orgName: '합성 기관', programDisplayName: '첫 사업',
    });
    expect(onboardedResponse.status).toBe(200);
    const onboarded = await onboardedResponse.json() as OrganizationOnboardingResponse;
    expect(onboarded).toMatchObject({ orgId: admin.orgId, orgName: '합성 기관', programDisplayName: '첫 사업',
      institution: { onboardingCompleted: true, firstProgram: { displayName: '첫 사업', version: 1, admissionState: 'undecided' } } });
    const first = onboarded.institution.firstProgram!;
    expect(first.id).not.toBe(testProgramId(admin.orgId));
    const denied = await request('/participants', 'POST', { programId: first.id, consentPrivacy: true }, worker);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: 'program_admission_required', reason: 'undecided' });

    const context = await (await request('/programs')).json() as ProgramListResponse;
    const confirmation = {
      copyVersion: context.admissionCopy.version, copyHash: context.admissionCopy.hash,
      installationPolicyVersion: context.installation.policyVersion, installationConfigHash: context.installation.configHash,
    };
    const patch = { expectedVersion: first.version, storageMode: 'supabase_seoul', processingMode: 'internal_only', confirmation };
    const stale = await request(`/programs/${first.id}`, 'PATCH', {
      ...patch, confirmation: { ...confirmation, copyHash: '0'.repeat(64) },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'conflict' });
    const confirmedResponse = await request(`/programs/${first.id}`, 'PATCH', patch);
    expect(confirmedResponse.status).toBe(200);
    const confirmed = await confirmedResponse.json() as ProgramMutationResponse;
    expect(confirmed.program).toMatchObject({ id: first.id, version: 2, admissionState: 'ready',
      confirmation: { ...confirmation, by: admin.userId, storageMode: 'supabase_seoul', processingMode: 'internal_only' } });
    const options = await (await request('/program-options', 'GET', undefined, worker)).json() as ProgramOptionsResponse;
    expect(options.programs.find(program => program.id === first.id)).toEqual({
      id: first.id, displayName: '첫 사업', programType: 'financial_support_v1', admissionState: 'ready',
    });
    const reread = await (await request('/me', 'GET', undefined, worker)).json() as MeResponse;
    expect(reread.institution.firstProgram).toMatchObject({ id: first.id, admissionState: 'ready', version: 2 });
    const noConsent = await request('/participants', 'POST', { programId: first.id }, worker);
    expect(noConsent.status).toBe(422);
    expect(await noConsent.json()).toEqual({ error: 'privacy_consent_required' });
    expect((await request('/participants', 'POST', { programId: first.id, consentPrivacy: true }, worker)).status).toBe(201);
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM consent_events WHERE org_id = ?').bind(admin.orgId).first('n')).toBe(0);

    await t.db.prepare('UPDATE program_admission_policies SET version = version + 1 WHERE org_id = ?').bind(admin.orgId).run();
    const changed = await (await request('/me')).json() as MeResponse;
    expect(changed.institution.firstProgram?.admissionState).toBe('settings_changed');
    const locked = await request('/participants', 'POST', { programId: first.id, consentPrivacy: true }, worker);
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({ error: 'program_admission_required', reason: 'settings_changed' });
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM support_cases WHERE org_id = ? AND program_id = ?').bind(admin.orgId, first.id).first('n')).toBe(1);
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND action = 'update' AND target_table = 'organization_settings'").bind(admin.orgId).first('n')).toBe(1);
  });

  it('reports missing persisted settings and policy without creating defaults or opening onboarding', async () => {
    await t.reset();
    await t.db.prepare('DELETE FROM organization_settings WHERE org_id = ?').bind(admin.orgId).run();
    await t.db.prepare('DELETE FROM program_admission_policies WHERE org_id = ?').bind(admin.orgId).run();
    const response = await request('/me');
    expect(response.status).toBe(200);
    const me = await response.json() as MeResponse;
    expect(me.institution).toMatchObject({ settingsState: 'missing', orgName: null, onboardingCompleted: false,
      firstProgram: null, installationState: 'unavailable', retentionPolicyStatus: 'missing' });
    const denied = await request('/organization/onboarding', 'POST', { orgName: '기관', programDisplayName: '사업' });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: 'program_admission_required', reason: 'installation_unavailable' });
    expect(await t.db.prepare('SELECT org_id FROM organization_settings WHERE org_id = ?').bind(admin.orgId).first()).toBeNull();
    expect(await t.db.prepare('SELECT org_id FROM program_admission_policies WHERE org_id = ?').bind(admin.orgId).first()).toBeNull();
  });

  it('keeps completed onboarding separate from a closed first program and legacy retention needing review', async () => {
    await t.reset();
    await t.db.prepare('UPDATE organization_settings SET org_name = ?, initial_program_id = ?, pii_purge_grace_days = 2000 WHERE org_id = ?')
      .bind('저장된 기관', testProgramId(admin.orgId), admin.orgId).run();
    await t.db.prepare("UPDATE programs SET status = 'closed' WHERE org_id = ?").bind(admin.orgId).run();
    const me = await (await request('/me')).json() as MeResponse;
    expect(me.institution).toMatchObject({ onboardingCompleted: true, retentionPolicyStatus: 'review_required',
      firstProgram: { id: testProgramId(admin.orgId), status: 'closed', admissionState: 'ready' } });
    expect(await (await request('/program-options', 'GET', undefined, worker)).json()).toEqual({ programs: [] });
    const denied = await request('/participants', 'POST', { programId: testProgramId(admin.orgId), consentPrivacy: true }, worker);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: 'program_admission_required', reason: 'program_closed' });
    expect(await t.db.prepare('SELECT pii_purge_grace_days FROM organization_settings WHERE org_id = ?').bind(admin.orgId).first('pii_purge_grace_days')).toBe(2000);
  });

  it('uses current own-institution registry evidence for all six copy domains without granting consent', async () => {
    await t.reset();
    const at = '2026-09-09T12:00:00.000Z';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    try {
      for (const org of [admin.orgId, testActors.otherOrgAdmin.orgId]) {
        for (const provider of ['institution', 'institution_recording', 'institution_private_storage', 'azure', 'openai']) {
          const approvedAt = org === admin.orgId && provider === 'azure' ? '2026-09-10T12:00:00.000Z' : at;
          const validUntil = org === admin.orgId && provider === 'openai' ? at : null;
          await t.db.prepare(`INSERT INTO consent_provider_registry_snapshots(id,org_id,provider,legal_recipient,country,approved_at,valid_until)
            VALUES (?,?,?,'Synthetic recipient','KR',?,?)`).bind(crypto.randomUUID(), org, provider, approvedAt, validUntil).run();
        }
      }
      const partial = await (await request('/me')).json() as MeResponse;
      expect(partial.institution.consentCopy).toEqual({ version: 'consent-six-domains-v1', status: 'provider_registry_unavailable', domains: [
        { domain: 'personal_data_collection_use', disclosureAvailable: true },
        { domain: 'sensitive_information_processing', disclosureAvailable: true },
        { domain: 'counseling_recording', disclosureAvailable: true },
        { domain: 'external_stt_processing', disclosureAvailable: false },
        { domain: 'external_llm_cross_border_processing', disclosureAvailable: false },
        { domain: 'voice_original_retention_period', disclosureAvailable: true },
      ] });
      const renewedAt = '2026-09-09T12:00:01.000Z';
      vi.setSystemTime(new Date(renewedAt));
      for (const provider of ['azure', 'openai']) {
        await t.db.prepare(`INSERT INTO consent_provider_registry_snapshots(id,org_id,provider,legal_recipient,country,approved_at)
          VALUES (?,?,?,'Synthetic recipient','KR',?)`).bind(crypto.randomUUID(), admin.orgId, provider, renewedAt).run();
      }
      const available = await (await request('/me')).json() as MeResponse;
      expect(available.institution.consentCopy.status).toBe('available');
      expect(available.institution.consentCopy.domains.every(domain => domain.disclosureAvailable)).toBe(true);
      expect(await t.db.prepare('SELECT COUNT(*) AS n FROM consent_disclosure_snapshots').first('n')).toBe(0);
      expect(await t.db.prepare('SELECT COUNT(*) AS n FROM consent_events').first('n')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies non-admin setup and foreign scope while retaining audited same-institution readiness', async () => {
    await t.reset();
    const denied = await request('/organization/onboarding', 'POST', { orgName: '거부', programDisplayName: '거부' }, worker);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
    const unknownField = await request('/organization/onboarding', 'POST', { orgName: '거부', programDisplayName: '거부', orgId: 'org_other' });
    expect(unknownField.status).toBe(400);
    expect(await unknownField.json()).toEqual({ error: 'invalid_request' });
    await request('/organization/onboarding', 'POST', { orgName: '우리 기관', programDisplayName: '우리 첫 사업' });
    const own = await (await request('/me', 'GET', undefined, worker)).json() as MeResponse;
    const foreign = await (await request('/me', 'GET', undefined, testActors.otherOrgCounselor)).json() as MeResponse;
    expect(own.institution.orgName).toBe('우리 기관');
    expect(foreign.institution).toMatchObject({ orgId: testActors.otherOrgCounselor.orgId, orgName: null, firstProgram: null });
    const repeated = await request('/organization/onboarding', 'POST', { orgName: '덮어쓰기', programDisplayName: '덮어쓰기' });
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: 'conflict' });
    const serviceDenied = await request('/me', 'GET', undefined, testActors.service);
    expect(serviceDenied.status).toBe(403);
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND actor_id = ? AND action = 'read' AND target_table = 'organization_settings'")
      .bind(admin.orgId, worker.userId).first('n')).toBe(1);
  });
});
