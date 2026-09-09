import { describe, expect, it } from 'vitest';
import { createCase, getCase, listCases, ProgramAdmissionRequiredError, type Actor } from '@ccc/core/gateway';
import type { PreparedStatement } from '@ccc/contracts/database';
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

interface ProgramResponse {
  program: { id: string; displayName: string; version: number; admissionState: string };
}
interface ProgramListResponse {
  programs: ProgramResponse['program'][];
  admissionCopy: { version: string; hash: string };
  installation: { policyVersion: number; configHash: string };
}

describe('program admission boundary', () => {
  it('keeps an unconfirmed program locked while allowing its administrator to finish confirmation', async () => {
    await t.reset();
    const createdResponse = await request('/programs', 'POST', {
      displayName: '합성 사업', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ProgramResponse;
    expect(created.program.admissionState).toBe('confirmation_required');
    await expect(createCase(t.env, worker, { programId: created.program.id }))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);

    const contextResponse = await request('/programs');
    expect(contextResponse.status).toBe(200);
    const context = await contextResponse.json() as ProgramListResponse;
    const confirmedResponse = await request(`/programs/${created.program.id}`, 'PATCH', {
      expectedVersion: created.program.version,
      confirmation: {
        copyVersion: context.admissionCopy.version,
        copyHash: context.admissionCopy.hash,
        installationPolicyVersion: context.installation.policyVersion,
        installationConfigHash: context.installation.configHash,
      },
    });
    expect(confirmedResponse.status).toBe(200);
    const confirmed = await confirmedResponse.json() as ProgramResponse;
    expect(confirmed.program.admissionState).toBe('ready');
    const participant = await createCase(t.env, worker, { programId: created.program.id });
    expect(await t.db.prepare('SELECT program_id FROM support_cases WHERE beneficiary_id = ?')
      .bind(participant.id).first()).toEqual({ program_id: created.program.id });
  });

  it('rejects stale settings without overwriting the newer program or confirmation', async () => {
    await t.reset();
    const id = testProgramId(admin.orgId);
    const first = await request(`/programs/${id}`, 'PATCH', { expectedVersion: 1, displayName: '새 이름' });
    expect(first.status).toBe(200);
    const second = await request(`/programs/${id}`, 'PATCH', { expectedVersion: 1, displayName: '늦은 이름' });
    expect(second.status).toBe(409);
    const listing = await (await request('/programs')).json() as ProgramListResponse;
    expect(listing.programs.find((program) => program.id === id)).toMatchObject({
      displayName: '새 이름', version: 2, admissionState: 'ready',
    });
  });

  it('denies worker mutations and cross-institution identifiers', async () => {
    await t.reset();
    const id = testProgramId(admin.orgId);
    expect((await request(`/programs/${id}`, 'PATCH', { expectedVersion: 1, displayName: '거부' }, worker)).status).toBe(403);
    expect((await request(`/programs/${id}`, 'PATCH', { expectedVersion: 1, displayName: '거부' }, testActors.otherOrgAdmin)).status).toBe(403);
    expect((await request('/programs', 'POST', { displayName: '거부', storageMode: 'naver_public' })).status).toBe(400);
  });

  it('does not revive an old confirmation after installation policy ABA', async () => {
    await t.reset();
    await t.db.prepare('UPDATE program_admission_policies SET version = version + 2 WHERE org_id = ?')
      .bind(admin.orgId).run();
    await expect(createCase(t.env, worker, { programId: testProgramId(worker.orgId) }))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
  });

  it('rolls back participant and audit writes when admission changes after preflight', async () => {
    await t.reset();
    const racedEnv = { ...t.env, DB: {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      batch: async <T>(statements: PreparedStatement[]) => {
        await t.db.prepare('UPDATE program_admission_policies SET version = version + 1 WHERE org_id = ?')
          .bind(worker.orgId).run();
        return t.env.DB.batch<T>(statements);
      },
    } };
    await expect(createCase(racedEnv, worker, { programId: testProgramId(worker.orgId) }))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM beneficiaries WHERE org_id = ?')
      .bind(worker.orgId).first()).toEqual({ n: 0 });
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND action = 'create'")
      .bind(worker.orgId).first()).toEqual({ n: 0 });
  });

  it('keeps program staff membership separate from case access', async () => {
    await t.reset();
    const participant = await createCase(t.env, worker, { programId: testProgramId(worker.orgId) });
    const other = testActors.unassignedCounselor;
    const response = await request(`/programs/${encodeURIComponent(testProgramId(worker.orgId))}`, 'PATCH', {
      expectedVersion: 1, staff: [{ userId: other.userId, isResponsible: true }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      program: { staff: [{ userId: other.userId, isResponsible: true, active: true }] },
    });
    expect(await listCases(t.env, other)).toEqual([]);
    expect(await getCase(t.env, worker, participant.id)).toMatchObject({ id: participant.id, status: 'active' });
  });

  it('closes new admission without closing existing cases', async () => {
    await t.reset();
    const programId = testProgramId(worker.orgId);
    const participant = await createCase(t.env, worker, { programId });
    const response = await request(`/programs/${encodeURIComponent(programId)}`, 'PATCH', {
      expectedVersion: 1, status: 'closed',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ program: { status: 'closed' } });
    expect(await (await request('/program-options', 'GET', undefined, worker)).json()).toEqual({ programs: [] });
    await expect(createCase(t.env, worker, { programId })).rejects.toMatchObject({ reason: 'program_closed' });
    expect(await getCase(t.env, worker, participant.id)).toMatchObject({ id: participant.id, status: 'active' });
  });
});
