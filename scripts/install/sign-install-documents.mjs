#!/usr/bin/env bun
/**
 * sign-install-documents.mjs — Infisical /current 정본 manifest 를 재료로
 * approvedSttEngineIds 만 채운 새 manifest 와 짝맞는 소유권 승인서를 기존 설치 서명 키로 다시 만든다.
 *
 * 실행: scripts/install/stage-env.sh bun scripts/install/sign-install-documents.mjs
 *   bun 이 필요하다. @ccc/contracts 는 TS 소스만 배포하고 node 는 그 import 를 열지 못한다.
 *
 * 규칙:
 *   - 새 키, 새 서명 방식, 새 신뢰 뿌리를 만들지 않는다. 서명은
 *     packages/contracts/src/install-manifest.ts 의 signInstallManifest 를 그대로 호출한다.
 *   - installationId, supabaseProjectRef, publishedAt, expiresAt 을 포함해
 *     approvedSttEngineIds·sequence·서명을 뺀 모든 키를 기존 문서 그대로 보존한다.
 *   - --renew 를 주면 sequence 를 기존 값 +1 로 올린다. journal 의 현재
 *     runtime_sequence 는 이 스크립트가 읽지 않으므로 실행 전에 읽기 전용
 *     probe 로 확인하고, renewal 은 next.sequence > journal.sequence 만 요구한다
 *     (manifest-preflight.mjs:252-254).
 *   - 시크릿 값, 서명, 연결 문자열, 프로젝트 참조 원본을 출력하지 않는다.
 *   - 쓰기는 artifacts/install/current/ 두 파일뿐이고 권한은 600 이다.
 *   - 네트워크를 호출하지 않는다.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configuredInstallTrust,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';
import { requireProviderBaseline } from '../supabase/provider-baseline.mjs';
import { assertProviderBaselineCurrent } from '../supabase/plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ED25519 = { name: 'Ed25519' };
const encoder = new TextEncoder();

function fail(message) {
  console.error(`sign-install-documents: ${message}`);
  process.exit(2);
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) fail(`missing env ${name}`);
  return value;
}

// @ccc/contracts 는 TS 소스만 배포한다. node 로 실행하면 여기서 멈춘다.
const { signInstallManifest } = await import('@ccc/contracts/install-manifest')
  .catch(() => fail('@ccc/contracts import 실패. bun 으로 실행하라.'));
const verifier = await import(new URL(
  '../../apps/community-cloud/dist/install-manifest-verifier.js',
  import.meta.url,
).href).catch(() => fail('install-manifest-verifier.js 빌드가 없다.'));

// --- 1. 주입된 기존 서명 자원(/current 정본) ---
const organizationId = required('CCC_ORGANIZATION_ID');
const trust = configuredInstallTrust({
  organizationId,
  publicKeys: required('CCC_INSTALL_SIGNING_KEYS'),
  revokedKeyIds: process.env.CCC_INSTALL_REVOKED_KEY_IDS,
});

// 개인키는 base64 pkcs8(48바이트). raw 32바이트 시드면 pkcs8 로 감싼다.
function importPrivateKey(value) {
  let der = Buffer.from(value, 'base64');
  if (der.length === 32) {
    der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), der]);
  }
  return crypto.subtle.importKey('pkcs8', der, ED25519, true, ['sign']);
}
const privateKey = await importPrivateKey(required('CCC_INSTALL_SIGNING_PRIVATE_KEY'))
  .catch(() => fail('CCC_INSTALL_SIGNING_PRIVATE_KEY import 실패'));

// 개인키에서 공개키를 도출해 신뢰 목록의 keyId 와 맞춘다. 어느 키로 서명하는지를 값이 아니라 매칭으로 증명한다.
const { x } = await crypto.subtle.exportKey('jwk', privateKey);
const derivedPublic = Buffer.from(x, 'base64url').toString('base64');
const keyIds = Object.entries(trust.publicKeys)
  .filter(([, publicKey]) => publicKey === derivedPublic)
  .map(([keyId]) => keyId);
if (keyIds.length !== 1) fail('개인키에 대응하는 공개키가 CCC_INSTALL_SIGNING_KEYS 에 정확히 하나 없다.');
const signingKeyId = keyIds[0];

// --- 2. 기존 문서를 재료로 읽는다(기존 검증 함수로 shape·서명·만료까지 확인) ---
const now = new Date();
const oldManifest = await verifier.verifySignedInstallManifest(
  await readStrictJsonDocument(required('CCC_INSTALL_MANIFEST')),
  { publicKeys: trust.publicKeys, revokedKeyIds: trust.revokedKeyIds, now },
).catch((error) => fail(`기존 manifest 검증 실패: ${error?.code ?? error?.message}`));
const oldApproval = await readStrictJsonDocument(required('CCC_INSTALL_APPROVAL'))
  .catch(() => fail('기존 approval 읽기 실패'));
if (oldApproval.institutionId !== organizationId) fail('기존 approval 의 institutionId 가 CCC_ORGANIZATION_ID 와 다르다.');
if (oldApproval.signingKeyId !== signingKeyId || oldManifest.signingKeyId !== signingKeyId) {
  fail('기존 문서의 signingKeyId 가 개인키에서 도출한 keyId 와 다르다.');
}
if (oldApproval.projectRef !== oldManifest.supabaseProjectRef
  || oldApproval.installationId !== oldManifest.installationId) {
  fail('기존 approval 이 기존 manifest 와 같은 설치를 가리키지 않는다.');
}
if (Number.isNaN(Date.parse(oldApproval.expiresAt)) || Date.parse(oldApproval.expiresAt) <= now.getTime()) {
  fail('기존 approval expiresAt 이 미래가 아니다.');
}

// --- 3. 새 manifest: 바뀌는 것은 approvedSttEngineIds·(--renew 시)sequence·서명뿐 ---
// publishedAt 을 그대로 둬도 되는 근거: verifier 는 미래의 publishedAt 만 거부한다
// (install-manifest-verifier.js 의 verifySignedInstallManifest2). expiresAt 은 기존 값이
// release trust·baseline·approval 의 공통 상한 2026-10-10T16:50:18.708Z 라서 그대로 둔다.
// renewal 도 expiresAt 변경을 요구하지 않는다(assertAuthorizationMatches 의 stable 비교에
// expiresAt 은 없고 artifactsMatch·renewalAdvances 에도 없다: manifest-preflight.mjs:236-254).
const renew = process.argv.includes('--renew');
const { ed25519Signature: _oldSig, ...unsignedBase } = oldManifest;
const signedManifest = await signInstallManifest({
  ...unsignedBase,
  approvedSttEngineIds: [{ id: 'azure-speech-koreacentral', mode: 'azure' }],
  ...(renew ? { sequence: unsignedBase.sequence + 1 } : {}),
}, privateKey);

// --- 4. 소유권 승인서: 서명된 manifest 전체의 sha256Jcs 와 짝을 맞춘다 ---
//        바뀌는 것은 runtimeManifestSha256 과 서명뿐. 나머지 키는 기존 approval 그대로.
const runtimeManifestSha256 = await verifier.sha256Jcs(signedManifest);
const { ed25519Signature: _oldApprovalSig, ...unsignedApproval } = oldApproval;
unsignedApproval.runtimeManifestSha256 = runtimeManifestSha256;
const approvalSignature = await crypto.subtle.sign(
  ED25519, privateKey, encoder.encode(verifier.canonicalizeJcs(unsignedApproval)),
);
const signedApproval = {
  ...unsignedApproval,
  ed25519Signature: btoa(String.fromCharCode(...new Uint8Array(approvalSignature))),
};

// --- 5. 쓰기(600) ---
const outDir = resolve(here, '../../artifacts/install/current');
await mkdir(outDir, { recursive: true });
const manifestPath = resolve(outDir, 'install-manifest.json');
const approvalPath = resolve(outDir, 'install-approval.json');
const manifestJson = JSON.stringify(signedManifest);
const approvalJson = JSON.stringify(signedApproval);
await writeFile(manifestPath, manifestJson, { mode: 0o600 });
await writeFile(approvalPath, approvalJson, { mode: 0o600 });
await chmod(manifestPath, 0o600);
await chmod(approvalPath, 0o600);

// --- 6. 자가 확인: 생산물을 기존 검사에 그대로 통과시킨다 ---
const projectRef = signedManifest.supabaseProjectRef;
const authorization = await requireSignedOwnerPreflight({
  installManifest: manifestPath,
  installApproval: approvalPath,
  trust,
  organizationId,
  projectRef,
}).catch((error) => fail(`requireSignedOwnerPreflight 실패: ${error?.code ?? error?.message}`));
if (authorization.installationId !== signedManifest.installationId
  || authorization.runtimeManifestSha256 !== runtimeManifestSha256) {
  fail('자가 확인 불일치');
}

// /current 의 trust·baseline 과 새 authorization 조합이 plan 의 게이트를 그대로 통과하는지 확인한다.
const providerBaseline = await requireProviderBaseline({
  releaseTrust: required('CCC_BETA_RELEASE_TRUST'),
  providerBaseline: required('CCC_PROVIDER_BASELINE'),
  rootKeys: JSON.parse(required('CCC_BETA_TRUST_ROOT_KEYS')),
  revokedRootKeyIds: JSON.parse(process.env.CCC_BETA_REVOKED_ROOT_KEY_IDS ?? '[]'),
  authorization,
  manifestExpiresAt: authorization.expiresAt,
}).catch((error) => fail(`requireProviderBaseline 실패: ${error?.code ?? error?.message}`));
try {
  assertProviderBaselineCurrent(providerBaseline, authorization);
} catch (error) {
  fail(`assertProviderBaselineCurrent 실패: ${error?.code ?? error?.message}`);
}

console.log(JSON.stringify({
  ok: true,
  projectRefPrefix: projectRef.slice(0, 6),
  signingKeyId,
  manifestPath,
  manifestBytes: Buffer.byteLength(manifestJson),
  approvalPath,
  approvalBytes: Buffer.byteLength(approvalJson),
  installationId: signedManifest.installationId,
  sequence: signedManifest.sequence,
  publishedAt: signedManifest.publishedAt,
  expiresAt: signedManifest.expiresAt,
  approvedSttEngineIds: signedManifest.approvedSttEngineIds,
  preflight: 'requireSignedOwnerPreflight 통과',
  baseline: 'requireProviderBaseline + assertProviderBaselineCurrent 통과',
}));
