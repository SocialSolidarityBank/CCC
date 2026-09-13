import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@ccc/contracts/database';
import {
  decodeStorageSignerDecision,
  decodeStorageSignerRequest,
  type StorageSignerRequest,
} from '@ccc/contracts/audio';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { ActorAuthenticationError, IdentityStoreUnavailableError, type Actor as IdentityActor } from '@ccc/contracts/runtime';
import {
  admitRecordingUpload,
  appendSupportCaseConsentEvent,
  authorizeStorageSignerOperation,
  beginRecordingUploadIntent,
  claimAgentJobs,
  createCase,
  createManualSession,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  recordSttReadiness,
  type Actor,
  type AgentRuntime,
} from '@ccc/core/gateway';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import type { ApiEnv } from '@ccc/http-api/identity';
import {
  seedTestProgramWithRuntimeModes,
  setupD1,
  testActors,
  testProgramId,
  type TestApiEnv,
} from './support/d1';
import {
  agentManifestEnv,
  claimRequest,
  registerFixtureRecording,
  seedCanonicalSttConsent,
  seedNerQualification,
  sha256Hex,
} from './support/agent-jobs';
import { registrationInput } from './support/registration';
import { createStorageSignerHandler } from '../../community-cloud/src/storage-signer';

const { counselor, service, unassignedCounselor } = testActors;
const CLOUD_RUNTIME: AgentRuntime = {
  route: 'community-cloud-agent',
  sttEngine: 'local',
  sttEngineId: 'qwen3-asr',
  audioDelivery: 'protected-get',
};
const humanActor: IdentityActor = {
  kind: 'human',
  userId: counselor.userId,
  orgId: counselor.orgId,
  roles: ['worker'],
  scopes: [],
  authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'fixture-session' },
};
const agentActor: IdentityActor = {
  kind: 'agent',
  userId: service.userId,
  orgId: service.orgId,
  roles: ['service'],
  scopes: ['audio:read'],
  authn: { source: 'agent-bearer', assurance: 'none', sessionId: null },
};
const schedulerActor: IdentityActor = {
  kind: 'system',
  userId: 'ccc_scheduler',
  orgId: counselor.orgId,
  roles: ['service'],
  scopes: ['/internal/storage/authorize'],
  authn: { source: 'scheduler-secret', assurance: 'none', sessionId: null },
};
const t = setupD1();
let env: TestApiEnv;

beforeEach(async () => {
  await t.reset();
  env = await agentManifestEnv(t.env, { mode: 'community-cloud', stt: 'local' });
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
    deploymentMode: 'community-cloud',
    sttMode: 'local',
    llmMode: 'off',
  });
});

async function createSession(): Promise<{ sessionId: string; supportCaseId: string }> {
  const participant = await createCase(env, counselor, await registrationInput(env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  const session = await createManualSession(env, counselor, participant.id, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-10T10:00:00.000Z',
    channel: 'in_person',
    memo: 'Synthetic storage authorization fixture.',
    gasScores: [],
  });
  const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=? AND org_id=?')
    .bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
  if (scope === null) throw new Error('missing support case fixture');
  await seedCanonicalSttConsent(env, counselor, scope.support_case_id);
  return { sessionId: session.id, supportCaseId: scope.support_case_id };
}

async function pendingUpload(): Promise<{ request: StorageSignerRequest; supportCaseId: string; audioObjectId: string }> {
  const { sessionId, supportCaseId } = await createSession();
  await recordSttReadiness(env, service, {
    schemaVersion: 1,
    sttMode: 'local',
    sttEngineId: 'qwen3-asr',
    state: 'ready',
    capacity: 1,
  });
  const admission = await admitRecordingUpload(env, counselor, sessionId, CLOUD_RUNTIME);
  const intent = await beginRecordingUploadIntent(env, counselor, sessionId, admission, 'protected-get', {
    contentLength: 128,
    contentType: 'audio/wav',
    clientAssertedSha256: null,
    storageSha256: null,
    uploadExpiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  });
  return {
    supportCaseId,
    audioObjectId: intent.audioObjectId,
    request: {
      bucket: 'ccc-audio',
      objectKey: intent.key,
      action: 'upload',
      principal: 'client',
      objectSha256: null,
      context: { kind: 'upload', audioObjectId: intent.audioObjectId },
    },
  };
}

async function audioUploadRow(audioObjectId: string): Promise<{ upload_expires_at: string; updated_at: string }> {
  const row = await t.db.prepare(
    'SELECT upload_expires_at,updated_at FROM audio_objects WHERE id=? AND org_id=?',
  ).bind(audioObjectId, counselor.orgId).first<{ upload_expires_at: string; updated_at: string }>();
  if (row === null) throw new Error('missing audio object fixture');
  return row;
}

async function withdrawRecordingConsent(supportCaseId: string): Promise<void> {
  const current = (await getSupportCaseConsent(env, counselor, supportCaseId))
    .find((item) => item.domain === 'counseling_recording');
  const disclosure = (await issueSupportCaseConsentDisclosures(env, counselor, supportCaseId))
    .find((item) => item.domain === 'counseling_recording');
  if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
    throw new Error('missing recording consent fixture');
  }
  await appendSupportCaseConsentEvent(env, counselor, supportCaseId, {
    domain: 'counseling_recording',
    decision: 'withdraw',
    provider: current.provider,
    providerLegalRecipient: current.providerLegalRecipient,
    providerCountry: current.providerCountry,
    purpose: current.purpose,
    retentionDuration: current.retentionDuration,
    copyVersion: disclosure.copyVersion,
    copyHash: disclosure.copyHash,
    disclosureSnapshotId: disclosure.snapshotId,
    effectiveAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
    correctionOfEventId: null,
    expectedRevision: current.revision,
  });
}

/**
 * Consent withdrawal leaves a `deletion_pending` row; the scheduler's authority is that row plus
 * its append-only requested attempt, which `delete` and `absence` share.
 */
async function durableDeletionIntent(action: 'delete' | 'absence'): Promise<{
  request: StorageSignerRequest;
  audioObjectId: string;
  generationId: string;
  deletionAttemptId: string;
}> {
  const pending = await pendingUpload();
  await withdrawRecordingConsent(pending.supportCaseId);
  const row = await t.db.prepare(
    `SELECT id,key,generation_id,deletion_attempt_id,deletion_reason,object_sha256
     FROM audio_objects WHERE id=? AND org_id=?`,
  ).bind(pending.audioObjectId, counselor.orgId)
    .first<{ id: string; key: string; generation_id: string; deletion_attempt_id: string; deletion_reason: string; object_sha256: string | null }>();
  if (row === null || row.deletion_attempt_id === null) throw new Error('missing deletion intent fixture');
  const requestedAt = new Date().toISOString();
  await t.db.prepare(
    `INSERT INTO audio_deletion_attempts(
       id,deletion_attempt_id,phase,org_id,audio_object_id,generation_id,reason,requested_at,created_at
     ) VALUES(?,?,'requested',?,?,?,?,?,?)`,
  ).bind(
    `${row.deletion_attempt_id}:requested`, row.deletion_attempt_id, counselor.orgId,
    row.id, row.generation_id, row.deletion_reason, requestedAt, requestedAt,
  ).run();
  return {
    request: {
      bucket: 'ccc-audio',
      objectKey: row.key,
      action,
      principal: 'scheduler',
      objectSha256: row.object_sha256,
      context: {
        kind: 'deletion',
        audioObjectId: row.id,
        generationId: row.generation_id,
        deletionAttemptId: row.deletion_attempt_id,
      },
    },
    audioObjectId: row.id,
    generationId: row.generation_id,
    deletionAttemptId: row.deletion_attempt_id,
  };
}

function resolver(actor: IdentityActor): ActorResolver {
  return async (request) => {
    if (request.headers.get('authorization') !== 'Bearer fixture-token') {
      throw new ActorAuthenticationError();
    }
    return actor;
  };
}

async function postAuthorization(
  request: StorageSignerRequest,
  actor: IdentityActor = humanActor,
  targetEnv: ApiEnv = env,
  resolveActor: ActorResolver = resolver(actor),
): Promise<Response> {
  return handleRequest(new Request('https://api.example.invalid/internal/storage/authorize', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }), targetEnv, resolveActor);
}

describe('StorageSigner closed contracts', () => {
  it('accepts only the exact bounded request and decision shapes', () => {
    const request = {
      bucket: 'ccc-audio',
      objectKey: 'audio/session_1/00000000-0000-4000-8000-000000000001',
      action: 'agent_read',
      principal: 'agent',
      objectSha256: null,
      context: { kind: 'claim', jobId: 'job-1', claimToken: 'token-1', attempt: 1 },
    } as const;
    expect(decodeStorageSignerRequest(request)).toEqual(request);
    expect(() => decodeStorageSignerRequest({ ...request, url: 'https://attacker.invalid' })).toThrow();
    expect(() => decodeStorageSignerRequest({
      ...request,
      context: { ...request.context, claimToken: 'x'.repeat(513) },
    })).toThrow();

    const authorizedAt = new Date().toISOString();
    const decision = {
      allowed: true,
      requestSha256: 'a'.repeat(64),
      generationId: 'generation-1',
      authorizedAt,
      authorizationExpiresAt: new Date(Date.parse(authorizedAt) + 5_000).toISOString(),
      expiresAt: null,
    } as const;
    expect(decodeStorageSignerDecision(decision)).toEqual(decision);
    expect(() => decodeStorageSignerDecision({ ...decision, authorizationExpiresAt: new Date(Date.parse(authorizedAt) + 5_001).toISOString() })).toThrow();
    expect(() => decodeStorageSignerDecision({ ...decision, claimToken: 'secret' })).toThrow();
  });
});

describe('StorageSigner gateway authorization', () => {
  it('allows a current assigned human upload and binds the exact JCS request', async () => {
    const { request } = await pendingUpload();
    const decision = await authorizeStorageSignerOperation(env, humanActor, request);
    expect(decision.allowed).toBe(true);
    expect(decision.requestSha256).toBe(await sha256Hex(canonicalizeJcs(request)));
    expect(decision.expiresAt).toBeTruthy();
    expect(Date.parse(decision.authorizationExpiresAt) - Date.parse(decision.authorizedAt)).toBe(5_000);
  });

  it('moves the upload ceiling to the authorization expiry plus two hours on every upload decision', async () => {
    const { request, audioObjectId } = await pendingUpload();
    const before = await audioUploadRow(audioObjectId);
    const first = await authorizeStorageSignerOperation(env, humanActor, request);
    expect(first.expiresAt).toBe(
      new Date(Date.parse(first.authorizationExpiresAt) + 2 * 60 * 60_000).toISOString(),
    );
    expect((await audioUploadRow(audioObjectId)).upload_expires_at).toBe(first.expiresAt);
    expect(Date.parse(first.expiresAt!)).toBeGreaterThan(Date.parse(before.upload_expires_at));

    // A later decision sits on a lower live ceiling; compressing that gap keeps the forward move
    // observable without making the assertion depend on wall-clock drift between two decisions.
    await t.db.prepare('UPDATE audio_objects SET upload_expires_at=? WHERE id=? AND org_id=?')
      .bind(new Date(Date.now() + 60_000).toISOString(), audioObjectId, counselor.orgId).run();
    const second = await authorizeStorageSignerOperation(env, humanActor, request);
    expect(second.expiresAt).toBe(
      new Date(Date.parse(second.authorizationExpiresAt) + 2 * 60 * 60_000).toISOString(),
    );
    expect(Date.parse(second.expiresAt!)).toBeGreaterThan(Date.now() + 60_000);
    expect((await audioUploadRow(audioObjectId)).upload_expires_at).toBe(second.expiresAt);
  });

  it('writes nothing for the client metadata read', async () => {
    const { request, audioObjectId } = await pendingUpload();
    const before = await audioUploadRow(audioObjectId);
    const decision = await authorizeStorageSignerOperation(env, humanActor, { ...request, action: 'head' });
    expect(decision.expiresAt).toBeNull();
    expect(await audioUploadRow(audioObjectId)).toEqual(before);
  });

  it('refuses to move the upload ceiling past the retention hard cap and writes nothing', async () => {
    const { request, audioObjectId } = await pendingUpload();
    await t.db.prepare('UPDATE audio_objects SET retention_hard_cap_at=? WHERE id=? AND org_id=?')
      .bind(new Date(Date.now() + 60 * 60_000).toISOString(), audioObjectId, counselor.orgId).run();
    const before = await audioUploadRow(audioObjectId);
    await expect(authorizeStorageSignerOperation(env, humanActor, request)).rejects.toThrow();
    expect(await audioUploadRow(audioObjectId)).toEqual(before);
  });

  it('rejects unassigned, cross-organization and spoofed principals', async () => {
    const { request } = await pendingUpload();
    const unassigned: IdentityActor = { ...humanActor, userId: unassignedCounselor.userId };
    const otherOrg: IdentityActor = { ...humanActor, userId: 'other-org-user', orgId: 'org_other' };
    await expect(authorizeStorageSignerOperation(env, unassigned, request)).rejects.toThrow();
    await expect(authorizeStorageSignerOperation(env, otherOrg, request)).rejects.toThrow();
    await expect(authorizeStorageSignerOperation(env, humanActor, { ...request, principal: 'agent' })).rejects.toThrow();
    await expect(authorizeStorageSignerOperation(env, humanActor, {
      ...request,
      objectSha256: 'b'.repeat(64),
    })).rejects.toThrow();
  });

  it('rechecks current consent and D87 program admission on every upload authorization', async () => {
    const first = await pendingUpload();
    await expect(authorizeStorageSignerOperation(env, humanActor, first.request)).resolves.toMatchObject({ allowed: true });
    await withdrawRecordingConsent(first.supportCaseId);
    await expect(authorizeStorageSignerOperation(env, humanActor, first.request)).rejects.toThrow();

    const second = await pendingUpload();
    await expect(authorizeStorageSignerOperation(env, humanActor, second.request)).resolves.toMatchObject({ allowed: true });
    await t.db.prepare('UPDATE program_admission_policies SET version=version+1 WHERE org_id=?')
      .bind(counselor.orgId).run();
    await expect(authorizeStorageSignerOperation(env, humanActor, second.request)).rejects.toThrow();
  });

  it('binds agent reads to the live claim token, attempt, generation and deadlines', async () => {
    const { sessionId } = await createSession();
    const stored = await registerFixtureRecording(env, counselor, service, sessionId, CLOUD_RUNTIME);
    const qualification = await seedNerQualification(t.db);
    const claimed = await claimAgentJobs(env, service, CLOUD_RUNTIME, claimRequest(qualification));
    const job = claimed.jobs[0];
    if (job === undefined) throw new Error('missing claimed audio job');
    const request: StorageSignerRequest = {
      bucket: 'ccc-audio',
      objectKey: stored.key,
      action: 'agent_read',
      principal: 'agent',
      objectSha256: null,
      context: { kind: 'claim', jobId: job.jobId, claimToken: job.claimToken, attempt: job.attempt },
    };
    const decision = await authorizeStorageSignerOperation(env, agentActor, request);
    expect(decision.generationId).toBe(stored.generationId);
    expect(decision.expiresAt).not.toBeNull();
    expect(Date.parse(decision.expiresAt!)).toBeLessThanOrEqual(Date.now() + 600_000);
    const wrongAttempt: StorageSignerRequest = {
      ...request,
      context: { kind: 'claim', jobId: job.jobId, claimToken: job.claimToken, attempt: job.attempt + 1 },
    };
    await expect(authorizeStorageSignerOperation(env, agentActor, wrongAttempt)).rejects.toThrow();
    await t.db.prepare('UPDATE agent_jobs SET lease_expires_at=? WHERE id=?')
      .bind(new Date(Date.now() - 1_000).toISOString(), job.jobId).run();
    await expect(authorizeStorageSignerOperation(env, agentActor, request)).rejects.toThrow();
  });

  it('keeps exact durable deletion authorized after consent withdrawal without performing storage work', async () => {
    const intent = await durableDeletionIntent('delete');
    await expect(authorizeStorageSignerOperation(env, schedulerActor, intent.request)).resolves.toMatchObject({
      allowed: true,
      generationId: intent.generationId,
      expiresAt: null,
    });
    const staleAttempt: StorageSignerRequest = {
      ...intent.request,
      context: {
        kind: 'deletion',
        audioObjectId: intent.audioObjectId,
        generationId: intent.generationId,
        deletionAttemptId: `${intent.deletionAttemptId}:stale`,
      },
    };
    await expect(authorizeStorageSignerOperation(env, schedulerActor, staleAttempt)).rejects.toThrow();
    expect((await t.bucket.list()).objects).toHaveLength(0);
  });

  it('authorizes absence evidence on the same durable intent as deletion and audits the action', async () => {
    const intent = await durableDeletionIntent('absence');
    await expect(authorizeStorageSignerOperation(env, schedulerActor, intent.request)).resolves.toMatchObject({
      allowed: true,
      generationId: intent.generationId,
      // Absence evidence mints no URL, so there is nothing to expire.
      expiresAt: null,
    });
    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE org_id=? AND target_table='audio_objects' AND target_id=? ORDER BY id DESC LIMIT 1`,
    ).bind(counselor.orgId, intent.audioObjectId).first<{ detail: string }>();
    expect(JSON.parse(String(audit?.detail))).toEqual({ storageAction: 'absence', principal: 'scheduler' });

    const staleAttempt: StorageSignerRequest = {
      ...intent.request,
      context: {
        kind: 'deletion',
        audioObjectId: intent.audioObjectId,
        generationId: intent.generationId,
        deletionAttemptId: `${intent.deletionAttemptId}:stale`,
      },
    };
    await expect(authorizeStorageSignerOperation(env, schedulerActor, staleAttempt)).rejects.toThrow();
    expect((await t.bucket.list()).objects).toHaveLength(0);
  });

  it('refuses absence outside the scheduler deletion lane', async () => {
    const intent = await durableDeletionIntent('absence');
    await expect(authorizeStorageSignerOperation(env, humanActor, intent.request)).rejects.toThrow();
    expect(() => decodeStorageSignerRequest({ ...intent.request, principal: 'client' })).toThrow();
  });
});

describe('POST /internal/storage/authorize', () => {
  it('uses the resolved canonical actor and returns no-store installation-bound decisions', async () => {
    const { request } = await pendingUpload();
    const response = await postAuthorization(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-ccc-installation-id')).toBe(
      (JSON.parse(env.CCC_INSTALL_MANIFEST!) as { installationId: string }).installationId,
    );
    expect(decodeStorageSignerDecision(await response.json())).toMatchObject({ allowed: true });
  });

  it('rejects spoofing, browser origins, query strings, malformed authorization and legacy actors', async () => {
    const { request } = await pendingUpload();
    expect((await postAuthorization({ ...request, principal: 'agent' })).status).toBe(403);
    const origin = await handleRequest(new Request('https://api.example.invalid/internal/storage/authorize', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json', origin: 'https://client.invalid' },
      body: JSON.stringify(request),
    }), env, resolver(humanActor));
    expect(origin.status).toBe(403);
    const query = await handleRequest(new Request('https://api.example.invalid/internal/storage/authorize?x=1', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }), env, resolver(humanActor));
    expect(query.status).toBe(400);
    expect((await handleRequest(new Request('https://api.example.invalid/internal/storage/authorize', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    }), env, resolver(humanActor))).status).toBe(401);
    const legacy: Actor = counselor;
    expect((await postAuthorization(request, humanActor, env, async () => legacy)).status).toBe(403);
  });

  it('fails closed on identity and database outages', async () => {
    const { request } = await pendingUpload();
    const identityOutage = await postAuthorization(request, humanActor, env, async () => {
      throw new IdentityStoreUnavailableError();
    });
    expect(identityOutage.status).toBe(503);
    expect(await identityOutage.json()).not.toMatchObject({ allowed: true });

    const unavailableDb = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property === 'prepare') return () => { throw new Error('database unavailable'); };
        return Reflect.get(target, property, receiver);
      },
    }) as Database;
    const databaseOutage = await postAuthorization(request, humanActor, { ...env, DB: unavailableDb });
    expect(databaseOutage.status).toBe(500);
    expect(await databaseOutage.json()).not.toMatchObject({ allowed: true });
  });
});

describe('StorageSigner handler against the real callback', () => {
  it('re-authorizes every operation and stops touching storage once consent is withdrawn', async () => {
    const apiBase = 'https://api.example.invalid/functions/v1/ccc-api';
    const providerOrigin = 'https://provider.example.invalid';
    const { request: uploadRequest, supportCaseId } = await pendingUpload();
    const headRequest: StorageSignerRequest = { ...uploadRequest, action: 'head' };
    const calls: string[] = [];
    const handler = createStorageSignerHandler({
      apiBase,
      installationId: (JSON.parse(env.CCC_INSTALL_MANIFEST!) as { installationId: string }).installationId,
      supabaseOrigin: providerOrigin,
      serviceRoleKey: 'fixture-service-role-key',
      region: 'ap-northeast-2',
      fetch: (async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url === `${apiBase}/internal/storage/authorize`) {
          // The Community Cloud runtime strips the manifest route prefix before handleRequest.
          const routed = new URL(url);
          routed.pathname = routed.pathname.slice(new URL(apiBase).pathname.length);
          return handleRequest(new Request(routed.href, {
            method: 'POST',
            headers: new Headers(init?.headers),
            body: typeof init?.body === 'string' ? init.body : null,
          }), env, resolver(humanActor));
        }
        return new Response(JSON.stringify({
          version: 'provider-generation-1',
          size: 128,
          content_type: 'audio/wav',
          etag: null,
          last_modified: null,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });

    const signerRequest = () => new Request('https://signer.example.invalid/storage-signer', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
      body: JSON.stringify(headRequest),
    });

    const allowed = await handler(signerRequest());
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ action: 'head', exists: true });
    expect(calls.filter((url) => url.startsWith(providerOrigin))).toHaveLength(1);

    await withdrawRecordingConsent(supportCaseId);
    const denied = await handler(signerRequest());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    // The second operation asked the business API again and never reached storage.
    expect(calls.filter((url) => url === `${apiBase}/internal/storage/authorize`)).toHaveLength(2);
    expect(calls.filter((url) => url.startsWith(providerOrigin))).toHaveLength(1);
  });
});
