// Main 검증 전용: 실제 업무 런타임(handleRequest) + 실제 PostgreSQL + 실제 클라이언트 빌드.
// 신원 공급자만 합성이다(hosted Supabase Auth 미프로비저닝). 실제 기관 자료는 없다.
//
// 실행: bun tools/real-backend-preview.mjs [--port 4183]
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { signInstallManifest } from '@ccc/contracts/install-manifest';
import { PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
import { sha256Hex, CONSENT_COPY, CONSENT_DOMAINS } from '@ccc/contracts/consent';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { handleRequest } from '@ccc/http-api';
import { findUserByEmail, installConsentProviderRegistry } from '@ccc/core/gateway';
import { startPostgresHarness } from '../support/postgres.ts';
import { createSyntheticState, handleAuth } from '../../../client/tools/synthetic-api.mjs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const basePort = portArg === -1 ? 4183 : Number(args[portArg + 1]);
const clientPort = basePort, apiPort = basePort + 1, authPort = basePort + 2;
const API_BASE_PATH = '/api/v1';
const INSTALLATION_ID = 'real-backend-preview';
const ORG_ID = 'org-real-preview';
const PII_KEY = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';
const WORKER_SUBJECT = 'a800424b-7cb1-49f5-8bb4-8989d586c455';
const WORKER_EMAIL = 'worker@example.invalid';
const ADMIN_EMAIL = 'admin@example.invalid';

const clientOrigin = `https://127.0.0.1:${clientPort}`;
const apiOrigin = `https://127.0.0.1:${apiPort}`;
const authOrigin = `https://127.0.0.1:${authPort}`;

const workDir = mkdtempSync(join(tmpdir(), 'ccc-real-preview-'));
const keyPath = join(workDir, 'key.pem'), certPath = join(workDir, 'cert.pem');
if (spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
  '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('self-signed certificate generation failed');
}

const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const signingKeys = JSON.stringify({ preview: btoa(String.fromCharCode(...rawPublicKey)) });

const distDir = join(workDir, 'dist');
if (spawnSync('pnpm', ['--filter', '@ccc/client', 'exec', 'vite', 'build', '--outDir', distDir, '--emptyOutDir'], {
  stdio: 'inherit', env: { ...process.env, VITE_CCC_INSTALL_SIGNING_KEYS: signingKeys },
}).status !== 0) throw new Error('client build failed');

const manifest = await signInstallManifest({
  schemaVersion: 1, mode: 'community-cloud', apiBase: `${apiOrigin}${API_BASE_PATH}`,
  clientOrigin, allowedOrigins: [clientOrigin], host: '127.0.0.1', scheme: 'https',
  endpointDiscovery: 'static', installationId: INSTALLATION_ID, sequence: 1,
  publishedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  approvedSttEngineIds: [], supabaseProjectRef: '127', supabaseAuthOrigin: authOrigin,
  supabasePublishableKey: 'sb_publishable_synthetic', signingKeyId: 'preview',
}, pair.privateKey);

// 실제 PostgreSQL: 컨테이너 기동, 실제 migration, 제한 역할 연결.
const harness = await startPostgresHarness();
const admin = await harness.openDatabase(2);
const migrationsDir = new URL('../../../../migrations/postgres/', import.meta.url);
for (const name of readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql')).sort()) {
  await harness.applyMigration(admin, readFileSync(new URL(name, migrationsDir), 'utf8'));
}
const admissionCopyHash = await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
const installationConfigHash = await sha256Hex(canonicalizeJcs({
  deploymentMode: 'community-cloud', sttMode: 'off', llmMode: 'off',
}));
await admin.prepare(
  `INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days, version)
   VALUES (?, 'Asia/Seoul', 365, 1)`,
).bind(ORG_ID).run();
await admin.prepare(
  `INSERT INTO users (id, org_id, email, role, active, name, auth_subject)
   VALUES (?, ?, ?, 'counselor', 1, '합성 실무자', ?)`,
).bind(WORKER_SUBJECT, ORG_ID, WORKER_EMAIL, WORKER_SUBJECT).run();
await admin.prepare(
  `INSERT INTO users (id, org_id, email, role, active, name, auth_subject)
   VALUES ('real-preview-admin', ?, ?, 'admin', 1, '합성 관리자', 'real-preview-admin')`,
).bind(ORG_ID, ADMIN_EMAIL).run();
await admin.prepare(
  `INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode) VALUES (?, 1, 'off', 'off')`,
).bind(ORG_ID).run();

// 실제 설치 경로의 writer. 신뢰 연결(admin)로만 돈다.
const registryProviders = [...new Set(CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].provider))]
  .map((provider) => ({
    provider,
    legalRecipient: `합성 수신자 ${provider}`,
    country: provider === 'openai' ? 'US' : 'KR',
    validUntil: null,
  }));
const installedRegistry = await installConsentProviderRegistry(admin, {
  schemaVersion: 1, orgId: ORG_ID, approvedBy: 'real-preview-admin',
  approvedAt: new Date().toISOString(), approvalRef: 'synthetic-approval-001',
  providers: registryProviders,
});

const api = await harness.openApiDatabase(admin, 4);
const secretStore = createEnvironmentSecretStore({ PII_ENC_KEY: PII_KEY });
const capabilities = buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: true,
});
const state = createSyntheticState();

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-request-id',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
    'access-control-expose-headers': 'X-CCC-Installation-Id',
    'x-ccc-installation-id': INSTALLATION_ID,
    'cache-control': 'no-store',
  };
}

/** 합성 토큰의 sub로 실제 사용자 디렉터리를 조회한다. 권한 판정은 전부 실제 gateway가 한다. */
async function resolveActor(request, env) {
  const header = request.headers.get('authorization');
  if (header === null) throw new Error('actor_authentication_required');
  const payload = JSON.parse(Buffer.from(header.replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString());
  const email = state.role === 'institution-admin' ? ADMIN_EMAIL : WORKER_EMAIL;
  const user = await findUserByEmail(env, email);
  if (user === null || !user.active) throw new Error('forbidden');
  if (payload.aal !== 'aal2') throw new Error('actor_authentication_required');
  return { userId: user.id, orgId: user.orgId, role: user.role };
}

async function handleRealApi(request) {
  const url = new URL(request.url);
  const cors = corsHeaders(clientOrigin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!url.pathname.startsWith(API_BASE_PATH)) {
    return Response.json({ error: 'not_found' }, { status: 404, headers: cors });
  }
  const path = url.pathname.slice(API_BASE_PATH.length) || '/';
  if (path === '/capabilities') return Response.json(capabilities, { status: 200, headers: cors });
  const environment = {
    DB: api.forActor({ orgId: ORG_ID, actorId: 'identity-directory' }),
    secretStore, audioStore: null, installationMode: 'community-cloud',
    PUBLIC_SIGNUP_ENABLED: '1',
  };
  const scopedUrl = new URL(url); scopedUrl.pathname = path;
  const response = await handleRequest(new Request(scopedUrl, request), environment, async (credentialRequest) => {
    const actor = await resolveActor(credentialRequest, environment);
    environment.DB = api.forActor({ orgId: actor.orgId, actorId: actor.userId });
    return actor;
  });
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

const tls = { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

Bun.serve({
  port: clientPort, hostname: '127.0.0.1', tls,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ccc-install-manifest.json') return Response.json(manifest);
    if (url.pathname === '/ccc-bootstrap.json') return Response.json({ mode: manifest.mode, apiBase: manifest.apiBase });
    const asset = join(distDir, url.pathname);
    if (url.pathname !== '/' && existsSync(asset) && !asset.endsWith('/')) {
      return new Response(Bun.file(asset), { headers: { 'content-type': CONTENT_TYPES[extname(asset)] ?? 'application/octet-stream' } });
    }
    return new Response(Bun.file(join(distDir, 'index.html')), { headers: { 'content-type': CONTENT_TYPES['.html'] } });
  },
});
Bun.serve({ port: apiPort, hostname: '127.0.0.1', tls, fetch: handleRealApi });
Bun.serve({ port: authPort, hostname: '127.0.0.1', tls, fetch: (request) => handleAuth(request, state, clientOrigin) });

console.log(JSON.stringify({
  client: clientOrigin, api: `${apiOrigin}${API_BASE_PATH}`, auth: authOrigin,
  installationId: INSTALLATION_ID, realDatabase: 'postgres-container', realBusinessRuntime: true,
  syntheticIdentityProvider: true, orgId: ORG_ID,
  login: 'worker@example.invalid 또는 admin@example.invalid, 비밀번호 아무거나, 인증 번호 123456',
}, null, 2));
