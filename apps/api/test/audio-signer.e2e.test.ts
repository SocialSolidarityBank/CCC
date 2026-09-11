import { beforeEach, describe, expect, it } from 'vitest';
import { ActorAuthenticationError, type Actor as IdentityActor } from '@ccc/contracts/runtime';
import { createSignerAudioStore } from '../../../adapters/audio-signer/src/index';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import {
  appendSupportCaseConsentEvent,
  createCase,
  createManualSession,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  recordSttReadiness,
  reconcileAudioObjectDeletion,
} from '@ccc/core/gateway';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import { createSchedulerSecretResolver } from '@ccc/http-api/scheduler-identity';
import { createStorageSignerHandler } from '../../community-cloud/src/storage-signer';
import {
  seedTestProgramWithRuntimeModes,
  setupD1,
  testActors,
  testProgramId,
  TEST_PII_KEY,
  type TestApiEnv,
} from './support/d1';
import { agentManifestEnv, seedCanonicalSttConsent } from './support/agent-jobs';
import { registrationInput } from './support/registration';

const { counselor, service } = testActors;
const API_BASE = 'https://api.example.invalid/functions/v1/ccc-api';
const PROVIDER_ORIGIN = 'https://provider.example.invalid';
const STORAGE_BASE = `${PROVIDER_ORIGIN}/storage/v1`;
const SIGNER_URL = 'https://auth.example.invalid/functions/v1/ccc-storage-signer';
const SCHEDULER_SECRET = 'scheduler-shared-secret-0123456789abcdef';
const HUMAN_BEARER = 'Bearer fixture-token';
const GENERATION = 'provider-generation-1';
const CONTENT_LENGTH = 128;

const humanActor: IdentityActor = {
  kind: 'human',
  userId: counselor.userId,
  orgId: counselor.orgId,
  roles: ['worker'],
  scopes: [],
  authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'fixture-session' },
};

const t = setupD1();
let env: TestApiEnv;
/** The fake Supabase storage provider: the only place audio "bytes" exist in this test. */
let objects: Map<string, { size: number; contentType: string; version: string }>;
let installationId: string;
let resolver: ActorResolver;
let signerCalls: string[];

function providerToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

function providerJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** Supabase storage endpoints the Signer actually speaks, and nothing else. */
async function provider(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.pathname.slice(new URL(STORAGE_BASE).pathname.length);
  const key = [...objects.keys()].find((candidate) => path.endsWith(`/ccc-audio/${encodeObjectKey(candidate)}`));
  const stored = key === undefined ? undefined : objects.get(key);

  if (method === 'POST' && path.startsWith('/object/upload/sign/ccc-audio/')) {
    const objectKey = decodeURIComponent(path.slice('/object/upload/sign/ccc-audio/'.length));
    return providerJson({
      url: `${path}?token=${providerToken({
        url: `ccc-audio/${objectKey}`,
        scope: 'upload',
        exp: Math.floor((Date.now() + 3_600_000) / 1_000),
      })}`,
    });
  }
  if (method === 'GET' && path.startsWith('/object/info/ccc-audio/')) {
    const versionId = url.searchParams.get('versionId');
    if (stored === undefined || (versionId !== null && versionId !== stored.version)) {
      return providerJson({ error: 'not_found' }, 404);
    }
    return providerJson({
      version: stored.version,
      size: stored.size,
      content_type: stored.contentType,
      etag: null,
      last_modified: null,
    });
  }
  if (method === 'DELETE' && path.startsWith('/object/ccc-audio/')) {
    const versionId = url.searchParams.get('versionId');
    if (key === undefined || stored === undefined || versionId !== stored.version) {
      return providerJson({ error: 'not_found' }, 404);
    }
    objects.delete(key);
    return providerJson({ message: 'Successfully deleted' });
  }
  if (method === 'POST' && path === '/object/list/ccc-audio') {
    const body = JSON.parse(String(init.body)) as { prefix: string; search: string };
    const present = [...objects.keys()].some((candidate) => candidate === `${body.prefix}/${body.search}`);
    return providerJson(present ? [{ name: body.search }] : []);
  }
  if (method === 'GET' && path.startsWith('/object/authenticated/ccc-audio/')) {
    const versionId = url.searchParams.get('versionId');
    if (stored === undefined || versionId !== stored.version) return providerJson({ error: 'not_found' }, 404);
    return new Response(new Uint8Array([0x00]), { status: 206, headers: { 'content-type': stored.contentType } });
  }
  return providerJson({ error: 'unexpected_provider_call' }, 500);
}

/** The Signer's own fetch: the business API for authorization, the fake provider for storage. */
const signerConfigFetch = (async (input: unknown, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.href === `${API_BASE}/internal/storage/authorize`) {
    // The Community Cloud runtime strips the manifest route prefix before handleRequest.
    const routed = new URL(url.href);
    routed.pathname = routed.pathname.slice(new URL(API_BASE).pathname.length);
    return handleRequest(new Request(routed.href, {
      method: 'POST',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    }), env, resolver);
  }
  return provider(url, init ?? {});
}) as typeof fetch;

/** The business runtime's fetch: the caller's own Bearer travels to the real Signer handler. */
function audioStoreFor(authorization: string) {
  const handler = createStorageSignerHandler({
    apiBase: API_BASE,
    installationId,
    supabaseOrigin: PROVIDER_ORIGIN,
    serviceRoleKey: 'fixture-service-role-key',
    region: 'ap-northeast-2',
    fetch: signerConfigFetch,
  });
  const storeFetch = (async (input: unknown, init?: RequestInit) => {
    const sent: unknown = JSON.parse(String(init?.body));
    if (sent !== null && typeof sent === 'object' && 'action' in sent) signerCalls.push(String(sent.action));
    return handler(new Request(String(input), {
      method: 'POST',
      headers: new Headers(init?.headers),
      body: String(init?.body),
    }));
  }) as typeof fetch;
  return createSignerAudioStore({
    signerUrl: SIGNER_URL,
    authorization,
    installationId,
    fetch: storeFetch,
  });
}

async function humanRequest(path: string, body: Record<string, unknown> | null): Promise<Response> {
  return handleRequest(new Request(`https://api.example.invalid${path}`, {
    method: 'POST',
    headers: { authorization: HUMAN_BEARER, 'content-type': 'application/json' },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  }), env, resolver);
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

beforeEach(async () => {
  await t.reset();
  objects = new Map();
  signerCalls = [];
  env = await agentManifestEnv(t.env, { mode: 'community-cloud', stt: 'local' });
  // The manifest is written by this repo's own fixture, not external input.
  const manifest = JSON.parse(env.CCC_INSTALL_MANIFEST!) as { installationId: string };
  installationId = manifest.installationId;
  // S2 §2.6: the scheduler lane sits in front of the human identity, exactly as the Cloud runtime wires it.
  resolver = createSchedulerSecretResolver({
    secretStore: createEnvironmentSecretStore({ PII_ENC_KEY: TEST_PII_KEY, SCHEDULER_SECRET }),
    organizationId: counselor.orgId,
    inner: async (request) => {
      if (request.headers.get('authorization') !== HUMAN_BEARER) throw new ActorAuthenticationError();
      return humanActor;
    },
  });
  env.audioStore = audioStoreFor(HUMAN_BEARER);
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
    deploymentMode: 'community-cloud',
    sttMode: 'local',
    llmMode: 'off',
  });
});

describe('Signer-backed AudioStore end to end', () => {
  it('mints, registers and provably deletes an object without the business API touching bytes', async () => {
    const participant = await createCase(env, counselor, await registrationInput(env, counselor, {
      programId: testProgramId(counselor.orgId),
    }));
    const session = await createManualSession(env, counselor, participant.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-09-10T10:00:00.000Z',
      channel: 'in_person',
      memo: 'Synthetic signer end to end fixture.',
      gasScores: [],
    });
    const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=? AND org_id=?')
      .bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('missing support case fixture');
    await seedCanonicalSttConsent(env, counselor, scope.support_case_id);
    await recordSttReadiness(env, service, {
      schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
    });

    const minted = await humanRequest(`/sessions/${session.id}/audio-upload-target`, {
      contentLength: CONTENT_LENGTH, contentType: 'audio/wav', clientAssertedSha256: null,
    });
    expect(minted.status).toBe(201);
    const target = await minted.json() as { audioObjectId: string; url: string; expiresAt: string };
    const pending = await t.db.prepare('SELECT key FROM audio_objects WHERE id=? AND org_id=?')
      .bind(target.audioObjectId, counselor.orgId).first<{ key: string }>();
    if (pending === null) throw new Error('missing audio object fixture');
    expect(target.url.startsWith(`${STORAGE_BASE}/object/upload/sign/ccc-audio/${encodeObjectKey(pending.key)}?token=`))
      .toBe(true);

    // The client PUTs straight to the provider; the business API never sees a byte.
    objects.set(pending.key, { size: CONTENT_LENGTH, contentType: 'audio/wav', version: GENERATION });

    const completed = await humanRequest(
      `/sessions/${session.id}/audio-upload-target/${target.audioObjectId}/complete`, {},
    );
    expect(completed.status).toBe(200);
    await expect(t.db.prepare('SELECT state,generation_id FROM audio_objects WHERE id=?')
      .bind(target.audioObjectId).first()).resolves.toMatchObject({ generation_id: GENERATION });
    expect(signerCalls).toEqual(['upload', 'head']);

    await withdrawRecordingConsent(scope.support_case_id);
    await expect(t.db.prepare('SELECT state,deletion_reason FROM audio_objects WHERE id=?')
      .bind(target.audioObjectId).first()).resolves.toMatchObject({
      state: 'deletion_pending', deletion_reason: 'consent_withdrawal',
    });
    // A protected-get object is only provable once its upload window has closed (S8 §2.2).
    await t.db.prepare('UPDATE audio_objects SET upload_expires_at=? WHERE id=? AND org_id=?')
      .bind(new Date(Date.now() - 120_000).toISOString(), target.audioObjectId, counselor.orgId).run();

    const schedulerStore = audioStoreFor(`Bearer ${SCHEDULER_SECRET}`);
    await expect(reconcileAudioObjectDeletion(env, schedulerStore, target.audioObjectId)).resolves.toBe(true);
    expect(signerCalls).toEqual(['upload', 'head', 'delete', 'absence']);
    expect(objects.size).toBe(0);

    await expect(t.db.prepare(
      'SELECT state,generation_id,deleted_at,deletion_reason FROM audio_objects WHERE id=?',
    ).bind(target.audioObjectId).first()).resolves.toMatchObject({
      state: 'unprocessed_expired',
      generation_id: GENERATION,
      deletion_reason: 'consent_withdrawal',
      deleted_at: expect.any(String),
    });
    await expect(t.db.prepare(
      `SELECT delete_succeeded,absent_from_list,absent_from_metadata,direct_read_absent,verification_method
       FROM audio_deletion_attempts WHERE audio_object_id=? AND phase='verification'`,
    ).bind(target.audioObjectId).first()).resolves.toMatchObject({
      delete_succeeded: 1,
      absent_from_list: 1,
      absent_from_metadata: 1,
      direct_read_absent: 1,
      verification_method: 'authenticated-get-404',
    });
  });

  it('refuses the deletion lane to a human bearer and leaves the object in place', async () => {
    const participant = await createCase(env, counselor, await registrationInput(env, counselor, {
      programId: testProgramId(counselor.orgId),
    }));
    const session = await createManualSession(env, counselor, participant.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-09-10T10:00:00.000Z',
      channel: 'in_person',
      memo: 'Synthetic signer refusal fixture.',
      gasScores: [],
    });
    const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=? AND org_id=?')
      .bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('missing support case fixture');
    await seedCanonicalSttConsent(env, counselor, scope.support_case_id);
    await recordSttReadiness(env, service, {
      schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
    });
    const minted = await humanRequest(`/sessions/${session.id}/audio-upload-target`, {
      contentLength: CONTENT_LENGTH, contentType: 'audio/wav', clientAssertedSha256: null,
    });
    const target = await minted.json() as { audioObjectId: string };
    const pending = await t.db.prepare('SELECT key FROM audio_objects WHERE id=? AND org_id=?')
      .bind(target.audioObjectId, counselor.orgId).first<{ key: string }>();
    objects.set(pending!.key, { size: CONTENT_LENGTH, contentType: 'audio/wav', version: GENERATION });
    await humanRequest(`/sessions/${session.id}/audio-upload-target/${target.audioObjectId}/complete`, {});
    await withdrawRecordingConsent(scope.support_case_id);
    await t.db.prepare('UPDATE audio_objects SET upload_expires_at=? WHERE id=? AND org_id=?')
      .bind(new Date(Date.now() - 120_000).toISOString(), target.audioObjectId, counselor.orgId).run();

    // The human Bearer carries no deletion authority, so the Signer denies and nothing is deleted.
    await expect(reconcileAudioObjectDeletion(env, env.audioStore!, target.audioObjectId)).resolves.toBe(false);
    expect(objects.size).toBe(1);
    await expect(t.db.prepare('SELECT state FROM audio_objects WHERE id=?')
      .bind(target.audioObjectId).first()).resolves.toMatchObject({ state: 'deletion_pending' });
  });
});
