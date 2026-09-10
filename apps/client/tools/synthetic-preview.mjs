// 합성 전용 production 미리보기. 실제 기관 자료, 실제 Supabase, 실제 사업자 연결이 없다.
//
// 실행: bun apps/client/tools/synthetic-preview.mjs [--port 4173]
// 세 origin을 띄운다 - 클라이언트, 서명된 독립 API, 분리된 Auth. 인증서는 자체 서명이라
// 브라우저가 경고를 낸다. 검수자는 그 경고를 넘긴 뒤 클라이언트 주소를 연다.

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { signInstallManifest } from '@ccc/contracts/install-manifest';
import { PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
import { sha256Hex } from '@ccc/contracts/consent';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { createSyntheticState, handleApi, handleAuth } from './synthetic-api.mjs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const basePort = portArg === -1 ? 4173 : Number(args[portArg + 1]);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65_000) throw new Error('--port is invalid');
const clientPort = basePort;
const apiPort = basePort + 1;
const authPort = basePort + 2;
const API_BASE_PATH = '/api/v1';
const INSTALLATION_ID = 'synthetic-preview';

const clientOrigin = `https://127.0.0.1:${clientPort}`;
const apiOrigin = `https://127.0.0.1:${apiPort}`;
const authOrigin = `https://127.0.0.1:${authPort}`;

const workDir = mkdtempSync(join(tmpdir(), 'ccc-synthetic-preview-'));
const keyPath = join(workDir, 'key.pem');
const certPath = join(workDir, 'cert.pem');
const certificate = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
  '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
], { stdio: 'ignore' });
if (certificate.status !== 0) throw new Error('self-signed certificate generation failed');

const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const signingKeys = JSON.stringify({ preview: btoa(String.fromCharCode(...rawPublicKey)) });

const distDir = join(workDir, 'dist');
const build = spawnSync('pnpm', ['--filter', '@ccc/client', 'exec', 'vite', 'build', '--outDir', distDir, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_CCC_INSTALL_SIGNING_KEYS: signingKeys },
});
if (build.status !== 0) throw new Error('client build failed');

const manifest = await signInstallManifest({
  schemaVersion: 1, mode: 'community-cloud', apiBase: `${apiOrigin}${API_BASE_PATH}`,
  clientOrigin, allowedOrigins: [clientOrigin], host: '127.0.0.1', scheme: 'https',
  endpointDiscovery: 'static', installationId: INSTALLATION_ID, sequence: 1,
  publishedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  approvedSttEngineIds: [], supabaseProjectRef: '127', supabaseAuthOrigin: authOrigin,
  supabasePublishableKey: 'sb_publishable_synthetic', signingKeyId: 'preview',
}, pair.privateKey);

// 검수용 스위치. 기본은 켬이고 `CCC_PREVIEW_PUBLIC_SIGNUP=0` 이면 끈 설치를 흉내 낸다.
const PUBLIC_SIGNUP_ENABLED = process.env.CCC_PREVIEW_PUBLIC_SIGNUP !== '0';
const state = createSyntheticState();
const tls = { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') };
const admissionCopyHash = await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
const capabilities = buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: PUBLIC_SIGNUP_ENABLED,
});
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
      return new Response(Bun.file(asset), {
        headers: { 'content-type': CONTENT_TYPES[extname(asset)] ?? 'application/octet-stream' },
      });
    }
    return new Response(Bun.file(join(distDir, 'index.html')), { headers: { 'content-type': CONTENT_TYPES['.html'] } });
  },
});

Bun.serve({
  port: apiPort, hostname: '127.0.0.1', tls,
  fetch: (request) => handleApi(request, state, {
    clientOrigin, installationId: INSTALLATION_ID, basePath: API_BASE_PATH,
    admissionCopyHash, admissionCopyVersion: PROGRAM_ADMISSION_COPY_VERSION, capabilities,
    publicSignupEnabled: PUBLIC_SIGNUP_ENABLED,
  }),
});

Bun.serve({
  port: authPort, hostname: '127.0.0.1', tls,
  fetch: (request) => handleAuth(request, state, clientOrigin),
});

console.log(JSON.stringify({
  client: clientOrigin, api: `${apiOrigin}${API_BASE_PATH}`, auth: authOrigin,
  installationId: INSTALLATION_ID, synthetic: true, hostedAuth: false,
  login: '아무 이메일과 비밀번호로 로그인한 뒤 인증 번호 123456을 넣는다',
}, null, 2));
