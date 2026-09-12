// P5 검증 전용: production client build + 실제 handleRequest + 제한된 ccc_api PostgreSQL.
// 신원 공급자와 AI provider만 in-process 합성이다. 실제 provider/key/network, STT, 운영 시크릿은 없다.
//
// 실행: bun apps/api/test/tools/ai-review-preview.mjs
// 고정 포트: client 4281, API 4282, Auth 4283.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { signInstallManifest } from '@ccc/contracts/install-manifest';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import { handleRequest } from '@ccc/http-api';
import {
  activateAiProviderConfiguration,
  createCase,
  createCounselingSchedule,
  createManualSession,
  enqueueTextWorkItem,
  registerAiProviderConfiguration,
  resolveDirectoryActorByAuthSubject,
} from '@ccc/core/gateway';
import {
  AI_PROVIDER_REGISTRY_VERSION,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  canonicalAiProviderConfigHash,
} from '@ccc/ai-runtime';
import { seedTestProgramWithRuntimeModes, testProgramId } from '../support/d1.ts';
import { createTestSigner, signedManifest } from '../support/install-manifest.ts';
import worker from '../support/local-worker.ts';
import { seedProviderRegistry, registrationInput } from '../support/registration.ts';
import { startPostgresHarness } from '../support/postgres.ts';

const CLIENT_PORT = 4281;
const API_PORT = 4282;
const AUTH_PORT = 4283;
const API_BASE_PATH = '/api/v1';
const INSTALLATION_ID = 'ai-review-preview';
const ORG_ID = 'org-ai-review-preview';
const clientOrigin = `https://127.0.0.1:${CLIENT_PORT}`;
const apiOrigin = `https://127.0.0.1:${API_PORT}`;
const authOrigin = `https://127.0.0.1:${AUTH_PORT}`;

const ACTORS = {
  assigned: {
    id: '11000000-0000-4000-8000-000000000001',
    subject: '21000000-0000-4000-8000-000000000001',
    email: 'assigned@example.invalid',
    legacyRole: 'counselor',
    canonicalRole: 'practitioner',
    name: '합성 담당 실무자',
  },
  admin: {
    id: '11000000-0000-4000-8000-000000000002',
    subject: '21000000-0000-4000-8000-000000000002',
    email: 'admin@example.invalid',
    legacyRole: 'admin',
    canonicalRole: 'institution_admin',
    name: '합성 비담당 관리자',
  },
  unassigned: {
    id: '11000000-0000-4000-8000-000000000003',
    subject: '21000000-0000-4000-8000-000000000003',
    email: 'unassigned@example.invalid',
    legacyRole: 'counselor',
    canonicalRole: 'practitioner',
    name: '합성 비담당 실무자',
  },
  service: {
    id: '11000000-0000-4000-8000-000000000004',
    subject: '21000000-0000-4000-8000-000000000004',
    email: 'service@example.invalid',
    legacyRole: 'service',
    canonicalRole: null,
    name: '합성 처리 장비',
  },
};

const ASSIGNED_ACTOR = { userId: ACTORS.assigned.id, orgId: ORG_ID, role: 'counselor' };
const ADMIN_ACTOR = { userId: ACTORS.admin.id, orgId: ORG_ID, role: 'admin' };
const SERVICE_HEADERS = {
  'content-type': 'application/json',
  'X-CCC-User-Id': ACTORS.service.id,
  'X-CCC-Org-Id': ORG_ID,
  'X-CCC-Role': 'service',
};

const PROVIDER_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'ai-review-preview-v1',
  model: 'test-only-no-network',
};

function firstEvidence(request) {
  const evidence = request.materials[0]?.evidence[0];
  if (evidence === undefined) throw new Error('fixture_contract_missing_evidence');
  return evidence;
}

/** testOnly adapter. 실제 네트워크·키를 쓰지 않고 provider validator를 그대로 지난다. */
class FakeAiProviderAdapter {
  providerId = CODEX_PROVIDER_ID;
  adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;
  testOnly = true;
  config = PROVIDER_CONFIG;
  calls = 0;

  async generate(request) {
    this.calls += 1;
    const evidence = { ...firstEvidence(request) };
    return {
      claims: [{
        claimKey: 'stored-household-expense',
        section: 'other_topics',
        text: '합성 상담에서 생활비 지출을 확인했습니다.',
        evidence: [{ ...evidence }],
      }],
      questions: [{
        title: '생활비 변동이 있었나요?',
        reason: '저장된 수기 기록에 생활비 확인 내용이 있습니다.',
        evidence: [{ ...evidence }],
      }],
      oneLiner: '생활비 지출 상황을 확인했습니다.',
      contrast: {
        missing_from_memo: [],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
      flagSuggestions: [],
    };
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, if-match, x-request-id',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers': 'ETag, X-Request-ID, X-CCC-Installation-Id',
    'access-control-max-age': '600',
    vary: 'Origin',
    'x-ccc-installation-id': INSTALLATION_ID,
    'cache-control': 'no-store',
  };
}

function sha256Hex(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function encodeToken(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.dGVzdC1vbmx5`;
}

function tokenPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function bearer(request) {
  const header = request.headers.get('authorization');
  if (header === null || !/^Bearer\s+/i.test(header)) return null;
  return header.replace(/^Bearer\s+/i, '');
}

function publicUser(actor) {
  return {
    id: actor.subject,
    aud: 'authenticated',
    role: 'authenticated',
    email: actor.email,
    created_at: '2026-09-10T00:00:00.000Z',
    app_metadata: {},
    user_metadata: { name: actor.name },
    factors: [{
      id: `factor-${actor.subject}`,
      factor_type: 'totp',
      status: 'verified',
      friendly_name: '합성 인증 앱',
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    }],
  };
}

/**
 * 사용자마다 별도 session/refresh/challenge를 갖는 test-only Supabase Auth 모양.
 * 역할은 저장하지 않는다. API는 JWT sub를 실제 users.auth_subject로 다시 푼다.
 */
function createAuthHandler() {
  const sessions = new Map();
  const refreshIndex = new Map();
  const challenges = new Map();
  const actorsByEmail = new Map(Object.values(ACTORS)
    .filter((actor) => actor !== ACTORS.service)
    .map((actor) => [actor.email, actor]));

  const accessToken = (session) => {
    const now = Math.floor(Date.now() / 1000);
    return encodeToken({
      sub: session.actor.subject,
      aud: 'authenticated',
      role: 'authenticated',
      aal: session.aal,
      amr: [],
      session_id: session.id,
      iat: session.issuedAt,
      exp: now + 3600,
    });
  };
  const responseSession = (session) => ({
    access_token: accessToken(session),
    refresh_token: session.refresh,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: publicUser(session.actor),
  });
  const sessionFromRequest = (request) => {
    const payload = tokenPayload(bearer(request) ?? '');
    if (payload === null || typeof payload.session_id !== 'string') return null;
    const session = sessions.get(payload.session_id) ?? null;
    return session !== null && session.actor.subject === payload.sub ? session : null;
  };

  return async (request) => {
    const url = new URL(request.url);
    const cors = corsHeaders(clientOrigin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/auth/v1/token') {
      const body = await request.json().catch(() => ({}));
      if (url.searchParams.get('grant_type') === 'password') {
        const actor = actorsByEmail.get(typeof body.email === 'string' ? body.email.toLowerCase() : '');
        if (actor === undefined || body.password !== 'synthetic-password') {
          return json({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'invalid_credentials' }, 400, cors);
        }
        const session = {
          id: crypto.randomUUID(),
          refresh: `refresh-${crypto.randomUUID()}`,
          actor,
          aal: 'aal1',
          issuedAt: Math.floor(Date.now() / 1000),
        };
        sessions.set(session.id, session);
        refreshIndex.set(session.refresh, session.id);
        return json(responseSession(session), 200, cors);
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const sessionId = refreshIndex.get(body.refresh_token);
        const session = sessionId === undefined ? null : sessions.get(sessionId) ?? null;
        return session === null
          ? json({ code: 'invalid_grant', error_code: 'invalid_grant', msg: 'invalid_grant' }, 400, cors)
          : json(responseSession(session), 200, cors);
      }
    }

    const session = sessionFromRequest(request);
    if (session === null) return json({ code: 'not_found' }, 404, cors);
    if (url.pathname === '/auth/v1/user') return json(publicUser(session.actor), 200, cors);
    if (url.pathname.endsWith('/challenge')) {
      const challengeId = crypto.randomUUID();
      challenges.set(challengeId, session.id);
      return json({ id: challengeId, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }, 200, cors);
    }
    if (url.pathname.endsWith('/verify')) {
      const body = await request.json().catch(() => ({}));
      if (body.code !== '123456' || challenges.get(body.challenge_id) !== session.id) {
        return json({ code: 'mfa_verification_failed', error_code: 'mfa_verification_failed', msg: 'mfa_verification_failed' }, 422, cors);
      }
      challenges.delete(body.challenge_id);
      session.aal = 'aal2';
      session.issuedAt = Math.floor(Date.now() / 1000);
      return json(responseSession(session), 200, cors);
    }
    if (url.pathname === '/auth/v1/logout') {
      sessions.delete(session.id);
      refreshIndex.delete(session.refresh);
      return new Response(null, { status: 204, headers: cors });
    }
    return json({ code: 'not_found' }, 404, cors);
  };
}

async function expectStatus(response, expected, label) {
  if (response.status === expected) return response;
  const body = await response.clone().json().catch(() => null);
  const code = body && typeof body.error === 'string' ? body.error : 'unknown';
  throw new Error(`${label}: HTTP ${response.status} ${code}`);
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'ccc-ai-review-preview-'));
  const keyPath = join(workDir, 'key.pem');
  const certPath = join(workDir, 'cert.pem');
  let harness;
  const servers = [];
  let closing = false;

  const close = async (exitCode = 0) => {
    if (closing) return;
    closing = true;
    for (const server of servers) server.stop(true);
    await harness?.dispose().catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
    process.exit(exitCode);
  };
  process.once('SIGINT', () => { void close(0); });
  process.once('SIGTERM', () => { void close(0); });

  try {
    if (spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' }).status !== 0) throw new Error('self_signed_certificate_failed');

    const clientKeyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', clientKeyPair.publicKey));
    const signingKeys = JSON.stringify({ preview: btoa(String.fromCharCode(...rawPublicKey)) });
    const distDir = join(workDir, 'dist');
    if (spawnSync('pnpm', [
      '--filter', '@ccc/client', 'exec', 'vite', 'build', '--outDir', distDir, '--emptyOutDir',
    ], {
      stdio: 'inherit',
      env: { ...process.env, VITE_CCC_INSTALL_SIGNING_KEYS: signingKeys },
    }).status !== 0) throw new Error('client_build_failed');

    const manifest = await signInstallManifest({
      schemaVersion: 1,
      mode: 'community-cloud',
      apiBase: `${apiOrigin}${API_BASE_PATH}`,
      clientOrigin,
      allowedOrigins: [clientOrigin],
      host: '127.0.0.1',
      scheme: 'https',
      endpointDiscovery: 'static',
      installationId: INSTALLATION_ID,
      sequence: 1,
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      approvedSttEngineIds: [],
      supabaseProjectRef: '127',
      supabaseAuthOrigin: authOrigin,
      supabasePublishableKey: 'sb_publishable_ai_review_preview',
      signingKeyId: 'preview',
    }, clientKeyPair.privateKey);

    harness = await startPostgresHarness();
    const adminDb = await harness.openDatabase(4);
    const migrationsDir = new URL('../../../../migrations/postgres/', import.meta.url);
    for (const name of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
      await harness.applyMigration(adminDb, readFileSync(new URL(name, migrationsDir), 'utf8'));
    }

    await adminDb.prepare(
      `INSERT INTO organization_settings (org_id, org_name, time_zone, pii_purge_grace_days, version)
       VALUES (?, '합성 검증 기관', 'Asia/Seoul', 365, 1)`,
    ).bind(ORG_ID).run();
    for (const actor of Object.values(ACTORS)) {
      await adminDb.prepare(
        `INSERT INTO users (id, org_id, email, role, active, name, auth_subject)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).bind(actor.id, ORG_ID, actor.email, actor.legacyRole, actor.name, actor.subject).run();
      if (actor.canonicalRole !== null) {
        await adminDb.prepare(
          `INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by, granted_at)
           VALUES (?, ?, ?, ?, 'manual', ?, '2026-09-10T00:00:00.000Z')`,
        ).bind(`role-${actor.id}`, ORG_ID, actor.id, actor.canonicalRole, ACTORS.admin.id).run();
      }
    }

    await seedTestProgramWithRuntimeModes(adminDb, ORG_ID, ACTORS.admin.id, {
      deploymentMode: 'community-cloud', sttMode: 'off', llmMode: 'openai',
    }, '합성 AI 검토 사업');
    await seedProviderRegistry(adminDb, ORG_ID);

    const apiDb = await harness.openApiDatabase(adminDb, 8);
    const piiKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const secretStore = createEnvironmentSecretStore({ PII_ENC_KEY: piiKey });
    const adapter = new FakeAiProviderAdapter();
    const baseEnv = {
      secretStore,
      audioStore: null,
      installationMode: 'community-cloud',
      TEXT_AI_PILOT_ENABLED: '1',
      AI_PROVIDER_ADAPTER: adapter,
    };
    const envFor = (actorId, extra = {}) => ({
      ...baseEnv,
      ...extra,
      DB: apiDb.forActor({ orgId: ORG_ID, actorId }),
    });
    const assignedEnv = envFor(ACTORS.assigned.id);
    const adminEnv = envFor(ACTORS.admin.id);
    const serviceEnv = envFor(ACTORS.service.id);

    const providerConfig = await registerAiProviderConfiguration(adminEnv, ADMIN_ACTOR, {
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: await canonicalAiProviderConfigHash(adapter.config),
      approvalRefs: ['synthetic-ai-review-preview'],
    });
    await activateAiProviderConfiguration(adminEnv, ADMIN_ACTOR, providerConfig.id);

    const agentSigner = await createTestSigner('ai-review-agent-test-key');
    const agentManifest = await signedManifest(agentSigner, 'local-single', { approvedSttEngineIds: [] });
    const agentEnv = {
      ...serviceEnv,
      CCC_INSTALL_MANIFEST: JSON.stringify(agentManifest),
      CCC_INSTALL_SIGNING_KEYS: JSON.stringify(agentSigner.publicKeys),
      CCC_STT_MODE: 'off',
    };

    async function canonicalSupportCaseId(beneficiaryId) {
      const row = await adminDb.prepare(
        `SELECT id FROM support_cases WHERE org_id = ? AND beneficiary_id = ? ORDER BY created_at, id LIMIT 1`,
      ).bind(ORG_ID, beneficiaryId).first();
      if (row === null || typeof row.id !== 'string') throw new Error('fixture_support_case_missing');
      return row.id;
    }

    async function createGraph(label, ordinal) {
      const registration = await registrationInput(assignedEnv, ASSIGNED_ACTOR, {
        programId: testProgramId(ORG_ID),
        name: `합성 ${label}`,
      });
      const caseRecord = await createCase(assignedEnv, ASSIGNED_ACTOR, registration);
      const supportCaseId = await canonicalSupportCaseId(caseRecord.id);
      const session = await createManualSession(assignedEnv, ASSIGNED_ACTOR, caseRecord.id, {
        submissionId: `31000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
        heldAt: `2026-09-${String(10 + ordinal).padStart(2, '0')}T01:00:00.000Z`,
        channel: 'in_person',
        memo: `SYNTHETIC_${label}_MANUAL_MEMO`,
        gasScores: [],
      });
      return { beneficiaryId: caseRecord.id, supportCaseId, sessionId: session.id };
    }

    async function seedQualification() {
      const receiptId = `receipt-${crypto.randomUUID()}`;
      const attestation = {
        id: `attestation-${crypto.randomUUID()}`,
        modelId: 'FrameByFrame/korean-pii-e5-base',
        modelRevision: 'fixture-rev-1',
        labelSetHash: 'a'.repeat(64),
        corpusHash: 'b'.repeat(64),
        resultHash: 'c'.repeat(64),
        validatedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        status: 'passed',
      };
      await adminDb.prepare(
        `INSERT INTO ner_release_qualification_receipts (
           id, org_id, model_id, model_revision, label_set_hash, corpus_hash, result_hash,
           validated_at, expires_at, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?)`,
      ).bind(
        receiptId, ORG_ID, attestation.modelId, attestation.modelRevision,
        attestation.labelSetHash, attestation.corpusHash, attestation.resultHash,
        attestation.validatedAt, attestation.expiresAt, attestation.validatedAt,
      ).run();
      return { receiptId, attestation };
    }

    async function recordSourceSnapshot(graph, suffix) {
      await enqueueTextWorkItem(assignedEnv, ASSIGNED_ACTOR, graph.sessionId, 'manual_record');
      const qualification = await seedQualification();
      const claim = await expectStatus(await worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
        method: 'POST',
        headers: SERVICE_HEADERS,
        body: JSON.stringify({
          limit: 1,
          nerAttestation: qualification.attestation,
          releaseQualificationReceiptId: qualification.receiptId,
        }),
      }), agentEnv), 200, 'agent_claim');
      const claimed = (await claim.json()).jobs?.[0];
      if (claimed === undefined || claimed.kind !== 'text' || claimed.sessionId !== graph.sessionId) {
        throw new Error('agent_claim_wrong_fixture');
      }

      const maskedText = `SYNTHETIC_${suffix}_MASKED_TEXT`;
      const sourceSha256 = await sha256Hex(maskedText);
      const evidence = [{
        id: `evidence-${crypto.randomUUID()}`,
        sourceRef: `memo:${suffix}`,
        sourceSha256,
        evidenceQuote: maskedText,
        sourceStart: 0,
        sourceEnd: [...maskedText].length,
      }];
      const result = {
        kind: 'text',
        maskedText,
        sha256: sourceSha256,
        maskingPipelineVersion: 'ner-mask-v1-addr-cond-dict',
        maskingPipelineHash: 'd'.repeat(64),
        nerAvailable: true,
        nerAttestationId: qualification.attestation.id,
        nerAttestationResultHash: qualification.attestation.resultHash,
        releaseQualificationReceiptId: qualification.receiptId,
        evidenceHash: await sha256Hex(canonicalizeJcs(evidence)),
        evidence,
      };
      const resultBody = {
        schemaVersion: 2,
        claimToken: claimed.claimToken,
        attempt: claimed.attempt,
        resultId: `result-${crypto.randomUUID()}`,
        payloadSha256: await sha256Hex(canonicalizeJcs({
          schemaVersion: 2, attempt: claimed.attempt, result,
        })),
        result,
      };
      await expectStatus(await worker.fetch(new Request(
        `http://localhost/pipeline/jobs/${claimed.jobId}/result`,
        { method: 'POST', headers: SERVICE_HEADERS, body: JSON.stringify(resultBody) },
      ), agentEnv), 204, 'agent_result');

      const snapshot = await adminDb.prepare(
        `SELECT id FROM ai_masked_source_snapshots
         WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      ).bind(graph.sessionId).first();
      if (snapshot === null || typeof snapshot.id !== 'string') throw new Error('source_snapshot_missing');
      return snapshot.id;
    }

    async function generateDraft(graph, sourceSnapshotId) {
      const response = await expectStatus(await worker.fetch(new Request(
        `http://localhost/sessions/${graph.sessionId}/ai/generate`,
        {
          method: 'POST',
          headers: SERVICE_HEADERS,
          body: JSON.stringify({ sourceSnapshotId }),
        },
      ), serviceEnv), 201, 'draft_generate');
      const draft = await response.json();
      if (draft.origin !== 'generated' || draft.creationMode !== 'provider_generated') {
        throw new Error('draft_provenance_invalid');
      }
      return draft;
    }

    const approve = await createGraph('APPROVE', 1);
    await generateDraft(approve, await recordSourceSnapshot(approve, 'APPROVE_V1'));

    const stale = await createGraph('REJECT_STALE', 2);
    await generateDraft(stale, await recordSourceSnapshot(stale, 'REJECT_STALE_V1'));

    const regenerate = await createGraph('REGENERATE', 3);
    await generateDraft(regenerate, await recordSourceSnapshot(regenerate, 'REGENERATE_V1'));
    await recordSourceSnapshot(regenerate, 'REGENERATE_V2');

    const adminDenied = await createGraph('ADMIN_DENIED', 4);
    await generateDraft(adminDenied, await recordSourceSnapshot(adminDenied, 'ADMIN_DENIED_V1'));

    const conflict = await createGraph('RECORD_CONFLICT', 5);
    const schedule = await createCounselingSchedule(assignedEnv, ASSIGNED_ACTOR, {
      beneficiaryId: conflict.beneficiaryId,
      supportCaseId: conflict.supportCaseId,
      scheduledAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      sessionKind: 'regular',
      channel: 'in_person',
      sessionGoals: [],
      customQuestions: [],
    });

    const capabilities = buildCapabilityManifest({
      mode: 'community-cloud',
      requestedSttMode: 'off',
      requestedLlmMode: 'openai',
      registry: [],
      sttGatePassed: { local: false, azure: false },
      azureKeyPresent: false,
      llmKeyPresent: true,
      llmGateOpen: true,
      agentStatus: 'connected',
      publicSignupEnabled: false,
    });
    const authHandler = createAuthHandler();

    async function resolveActor(request, environment) {
      const payload = tokenPayload(bearer(request) ?? '');
      if (payload === null || typeof payload.sub !== 'string' || typeof payload.session_id !== 'string'
        || payload.aal !== 'aal2' || typeof payload.iat !== 'number') {
        throw new ActorAuthenticationError('synthetic aal2 session is required');
      }
      const actor = await resolveDirectoryActorByAuthSubject(environment, payload.sub, {
        source: 'supabase-jwt',
        assurance: 'aal2',
        sessionId: payload.session_id,
      }, new Date(payload.iat * 1000).toISOString());
      if (actor === null) throw new ActorAuthenticationError('synthetic subject is not in the directory');
      return actor;
    }

    async function handleRealApi(request) {
      const url = new URL(request.url);
      const cors = corsHeaders(clientOrigin);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (!url.pathname.startsWith(API_BASE_PATH)) return json({ error: 'not_found' }, 404, cors);
      const path = url.pathname.slice(API_BASE_PATH.length) || '/';
      if (path === '/capabilities') return json(capabilities, 200, cors);

      const environment = {
        ...baseEnv,
        PUBLIC_SIGNUP_ENABLED: '0',
        DB: apiDb.forActor({ orgId: ORG_ID, actorId: 'identity-directory' }),
      };
      const scopedUrl = new URL(url);
      scopedUrl.pathname = path;
      const response = await handleRequest(new Request(scopedUrl, request), environment, async (credentialRequest) => {
        const actor = await resolveActor(credentialRequest, environment);
        environment.DB = apiDb.forActor({ orgId: actor.orgId, actorId: actor.userId });
        return actor;
      });
      for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
      return response;
    }

    const tls = { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json',
    };
    servers.push(Bun.serve({
      port: CLIENT_PORT,
      hostname: '127.0.0.1',
      tls,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/ccc-install-manifest.json') return Response.json(manifest);
        if (url.pathname === '/ccc-bootstrap.json') {
          return Response.json({ mode: manifest.mode, apiBase: manifest.apiBase });
        }
        const asset = join(distDir, url.pathname);
        if (url.pathname !== '/' && existsSync(asset) && !asset.endsWith('/')) {
          return new Response(Bun.file(asset), {
            headers: { 'content-type': contentTypes[extname(asset)] ?? 'application/octet-stream' },
          });
        }
        return new Response(Bun.file(join(distDir, 'index.html')), {
          headers: { 'content-type': contentTypes['.html'] },
        });
      },
    }));
    servers.push(Bun.serve({ port: API_PORT, hostname: '127.0.0.1', tls, fetch: handleRealApi }));
    servers.push(Bun.serve({ port: AUTH_PORT, hostname: '127.0.0.1', tls, fetch: authHandler }));

    const reviewRoute = (graph) => `/participants/${graph.beneficiaryId}/programs/${graph.supportCaseId}/records/${graph.sessionId}/review`;
    const briefingRoute = (graph) => `/participants/${graph.beneficiaryId}/programs/${graph.supportCaseId}/briefing`;
    console.log(JSON.stringify({
      ready: true,
      ports: { client: CLIENT_PORT, api: API_PORT, auth: AUTH_PORT },
      routes: {
        approveBriefing: briefingRoute(approve),
        approveReview: reviewRoute(approve),
        rejectStaleReview: reviewRoute(stale),
        regenerateReview: reviewRoute(regenerate),
        adminDeniedReview: reviewRoute(adminDenied),
        recordConflict: `/participants/${conflict.beneficiaryId}/programs/${conflict.supportCaseId}/records/new?scheduleId=${schedule.id}`,
      },
      fixtureIds: {
        approve: approve.sessionId,
        rejectStale: stale.sessionId,
        regenerate: regenerate.sessionId,
        adminDenied: adminDenied.sessionId,
        recordConflictSchedule: schedule.id,
      },
      providerCallsDuringSeed: adapter.calls,
      realDatabase: 'postgres-container',
      realBusinessRuntime: true,
      syntheticIdentityProvider: 'distinct-subject-session',
      hostedProviderCalls: 0,
    }, null, 2));
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':').slice(0, 2).join(':') : 'unknown';
    console.error(`ai-review-preview: setup failed (${code})`);
    await close(1);
  }
}

await main();
