import { describe, expect, it } from 'vitest';
import {
  admitRecordingUpload, createCase, createManualSession, getCase, listCases,
  listSupportCasesForBeneficiary, ProgramAdmissionRequiredError, recordSttReadiness, type Actor,
} from '@ccc/core/gateway';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { ProgramMutationResponse, ProgramListResponse } from '@ccc/contracts/program-admission';
import { handleRequest } from '@ccc/http-api';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import { LOCAL_SINGLE_RUNTIME, seedCanonicalSttConsent } from './support/agent-jobs';
import { registrationInput } from './support/registration';

const t = setupD1();
const admin = testActors.admin;
const worker = testActors.counselor;
const request = (path: string, method = 'GET', body?: unknown, actor: Actor = admin) => handleRequest(
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }), t.env, async () => actor,
);


describe('program admission boundary', () => {
  it('keeps an unconfirmed program locked while allowing its administrator to finish confirmation', async () => {
    await t.reset();
    const createdResponse = await request('/programs', 'POST', {
      displayName: '합성 사업', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ProgramMutationResponse;
    expect(created.program.admissionState).toBe('confirmation_required');
    // 동의 6종은 승인이 살아 있는 기본 사업에서 미리 받아 둔다 — 여기서 보려는 것은
    // 등록이 **승인 관문**에서 먼저 막히는지이고, 고지 발급 단계에서 막히면 무엇이
    // 막았는지 흐려진다(승인 판정은 동의 검증보다 앞선다).
    const preIssued = await registrationInput(t.env, worker, { programId: testProgramId(worker.orgId) });
    await expect(createCase(t.env, worker, { ...preIssued, programId: created.program.id }))
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
    const confirmed = await confirmedResponse.json() as ProgramMutationResponse;
    expect(confirmed.program.admissionState).toBe('ready');
    const participant = await createCase(t.env, worker, await registrationInput(t.env, worker, {
      programId: created.program.id,
    }));
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
    // 승인이 아직 살아 있는 동안 등록 입력 한 벌을 만들어 둔다 — 정책 버전을 올린 뒤에는
    // 고지 발급도 같은 관문에 막히므로, 그러면 등록 자체를 시험할 수 없다.
    const input = await registrationInput(t.env, worker, { programId: testProgramId(worker.orgId) });
    await t.db.prepare('UPDATE program_admission_policies SET version = version + 2 WHERE org_id = ?')
      .bind(admin.orgId).run();
    await expect(createCase(t.env, worker, input))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
  });

  it('rolls back participant and audit writes when admission changes after preflight', async () => {
    await t.reset();
    // 고지 발급은 경쟁을 심기 전에 끝낸다 — racedEnv 는 batch 마다 버전을 올린다.
    const input = await registrationInput(t.env, worker, { programId: testProgramId(worker.orgId) });
    const racedEnv = { ...t.env, DB: {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      batch: async <T>(statements: PreparedStatement[]) => {
        await t.db.prepare('UPDATE program_admission_policies SET version = version + 1 WHERE org_id = ?')
          .bind(worker.orgId).run();
        return t.env.DB.batch<T>(statements);
      },
    } };
    await expect(createCase(racedEnv, worker, input))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM beneficiaries WHERE org_id = ?')
      .bind(worker.orgId).first()).toEqual({ n: 0 });
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND action = 'create'")
      .bind(worker.orgId).first()).toEqual({ n: 0 });
  });

  it('keeps program staff membership separate from case access', async () => {
    await t.reset();
    const participant = await createCase(t.env, worker, await registrationInput(t.env, worker, {
      programId: testProgramId(worker.orgId),
    }));
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

  it('requires participant consent and current program admission independently for audio', async () => {
    await t.reset();
    await seedTestProgramWithRuntimeModes(t.db, worker.orgId, worker.userId, {
      deploymentMode: 'local-single', sttMode: 'local', llmMode: 'off',
    });
    t.env.installationMode = 'local-single';
    // 녹음 계열 4종은 등록에서 거절해 둔다 — 녹음 허가가 동의 없이는 열리지 않음을 먼저 본다.
    const participant = await createCase(t.env, worker, await registrationInput(
      t.env,
      worker,
      { programId: testProgramId(worker.orgId) },
      {
        counseling_recording: 'decline',
        external_stt_processing: 'decline',
        external_llm_cross_border_processing: 'decline',
        voice_original_retention_period: 'decline',
      },
    ));
    const { programs } = await listSupportCasesForBeneficiary(t.env, worker, participant.id);
    const supportCaseId = programs[0]!.supportCase.id;
    const session = await createManualSession(t.env, worker, participant.id, {
      submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z',
      channel: 'in_person', memo: 'Synthetic admission boundary', gasScores: [],
    });
    await recordSttReadiness(t.env, testActors.service, {
      schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
    });
    await expect(admitRecordingUpload(t.env, worker, session.id, LOCAL_SINGLE_RUNTIME))
      .rejects.toMatchObject({ code: 'consent_not_effective' });
    await seedCanonicalSttConsent(t.env, worker, supportCaseId, [
      'personal_data_collection_use', 'sensitive_information_processing', 'counseling_recording',
    ]);
    await expect(admitRecordingUpload(t.env, worker, session.id, LOCAL_SINGLE_RUNTIME))
      .resolves.toMatchObject({ sttEngine: 'local', requiredConsent: ['counseling_recording'] });
    await t.db.prepare('UPDATE program_admission_policies SET version = version + 1 WHERE org_id = ?')
      .bind(worker.orgId).run();
    await expect(admitRecordingUpload(t.env, worker, session.id, LOCAL_SINGLE_RUNTIME))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM audio_objects WHERE org_id = ?')
      .bind(worker.orgId).first()).toEqual({ n: 0 });
  });

  it('closes new admission without closing existing cases', async () => {
    await t.reset();
    const programId = testProgramId(worker.orgId);
    const participant = await createCase(t.env, worker, await registrationInput(t.env, worker, { programId }));
    // 닫기 전에 두 번째 등록 입력을 받아 둔다 — 닫힌 뒤에는 고지 발급도 같은 이유로 막힌다.
    const afterClose = await registrationInput(t.env, worker, { programId });
    const response = await request(`/programs/${encodeURIComponent(programId)}`, 'PATCH', {
      expectedVersion: 1, status: 'closed',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ program: { status: 'closed' } });
    expect(await (await request('/program-options', 'GET', undefined, worker)).json()).toEqual({ programs: [] });
    await expect(createCase(t.env, worker, afterClose)).rejects.toMatchObject({ reason: 'program_closed' });
    expect(await getCase(t.env, worker, participant.id)).toMatchObject({ id: participant.id, status: 'active' });
  });
});
