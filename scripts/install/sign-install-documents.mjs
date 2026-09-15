#!/usr/bin/env bun
/**
 * sign-install-documents.mjs — 대상 Supabase 프로젝트용 install manifest 와 소유권 승인서를
 * 기존 설치 서명 키로 다시 만든다.
 *
 * 실행: scripts/install/stage-env.sh bun scripts/install/sign-install-documents.mjs
 *   bun 이 필요하다. @ccc/contracts 는 TS 소스만 배포하고 node 는 그 import 를 열지 못한다.
 *
 * 규칙:
 *   - 새 키, 새 서명 방식, 새 신뢰 뿌리를 만들지 않는다. 서명은
 *     packages/contracts/src/install-manifest.ts 의 signInstallManifest 를 그대로 호출한다.
 *   - 시크릿 값, 서명, 연결 문자열, 프로젝트 참조 원본을 출력하지 않는다.
 *   - 쓰기는 artifacts/install/<ref6>/ 두 파일뿐이고 권한은 600 이다.
 *   - Management API 는 GET 만 호출한다.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configuredInstallTrust,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';

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

// --- 1. 주입된 기존 서명 자원 ---
const organizationId = required('CCC_ORGANIZATION_ID');
const accessToken = required('SUPABASE_ACCESS_TOKEN');
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

// --- 3. 대상 프로젝트 확인. 확정된 속성(이름 Relayer, ap-northeast-2, ACTIVE_HEALTHY)으로 정확히 하나를 고른다 ---
const projects = await fetch('https://api.supabase.com/v1/projects', {
  headers: { authorization: `Bearer ${accessToken}` },
}).then((r) => (r.ok ? r.json() : fail(`GET /v1/projects → ${r.status}`)));
const targets = projects.filter((p) => p.name === 'Relayer'
  && p.region === 'ap-northeast-2' && p.status === 'ACTIVE_HEALTHY');
if (targets.length !== 1) fail(`대상 프로젝트가 ${targets.length}개다.`);
const project = targets[0];
const projectRef = project.ref ?? project.id;

// 대상 프로젝트의 publishable 키. publishable 유형을 우선하고 없으면 legacy anon JWT 를 쓴다.
const apiKeys = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
  headers: { authorization: `Bearer ${accessToken}` },
}).then((r) => (r.ok ? r.json() : fail(`GET api-keys → ${r.status}`)));
const publishable = apiKeys.filter((k) => k.type === 'publishable');
const anon = apiKeys.filter((k) => k.type === 'legacy' && k.name === 'anon');
const publishableKey = publishable.length === 1 ? publishable[0].api_key
  : anon.length === 1 ? anon[0].api_key : null;
if (typeof publishableKey !== 'string' || publishableKey.length === 0) {
  fail('대상 프로젝트의 publishable 키를 하나로 못 고른다.');
}

// --- 4. 만료: release trust 가 manifest/approval 만료의 상한이다(baseline.mjs:169-170,200-202).
//        신뢰 수명이 어차피 trust 만료에 묶이므로 가장 짧은 유효 선택은 trust 만료와 같게 두는 것.
const releaseTrust = await readStrictJsonDocument(required('CCC_BETA_RELEASE_TRUST'));
const expiresAt = releaseTrust.expiresAt;
if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
  fail('release trust expiresAt 이 미래가 아니다.');
}

// --- 5. 새 manifest: 바뀌는 것은 프로젝트 결속 3키, STT 승인, 발행·만료뿐. 나머지는 그대로 ---
const { ed25519Signature: _oldSig, ...unsignedBase } = oldManifest;
const signedManifest = await signInstallManifest({
  ...unsignedBase,
  supabaseProjectRef: projectRef,
  supabaseAuthOrigin: `https://${projectRef}.supabase.co`,
  supabasePublishableKey: publishableKey,
  approvedSttEngineIds: [{ id: 'azure-speech-koreacentral', mode: 'azure' }],
  publishedAt: now.toISOString(),
  expiresAt,
  signingKeyId,
}, privateKey);

// --- 6. 소유권 승인서: 서명된 manifest 전체의 sha256Jcs 와 짝을 맞춘다 ---
const runtimeManifestSha256 = await verifier.sha256Jcs(signedManifest);
const unsignedApproval = {
  schemaVersion: 1,
  contractVersion: 'S11-install-approval-v1',
  institutionId: oldApproval.institutionId,
  projectRef,
  expectedOwnerOrgId: String(project.organization_id),
  installationId: signedManifest.installationId,
  runtimeManifestSha256,
  expiresAt,
  signingKeyId,
};
const approvalSignature = await crypto.subtle.sign(
  ED25519, privateKey, encoder.encode(verifier.canonicalizeJcs(unsignedApproval)),
);
const signedApproval = {
  ...unsignedApproval,
  ed25519Signature: btoa(String.fromCharCode(...new Uint8Array(approvalSignature))),
};

// --- 7. 쓰기(600) ---
const outDir = resolve(here, `../../artifacts/install/${projectRef.slice(0, 6)}`);
await mkdir(outDir, { recursive: true });
const manifestPath = resolve(outDir, 'install-manifest.json');
const approvalPath = resolve(outDir, 'install-approval.json');
const manifestJson = JSON.stringify(signedManifest);
const approvalJson = JSON.stringify(signedApproval);
await writeFile(manifestPath, manifestJson, { mode: 0o600 });
await writeFile(approvalPath, approvalJson, { mode: 0o600 });
await chmod(manifestPath, 0o600);
await chmod(approvalPath, 0o600);

// --- 8. 자가 확인: 생산물을 기존 검사에 그대로 통과시킨다 ---
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

console.log(JSON.stringify({
  ok: true,
  projectRefPrefix: projectRef.slice(0, 6),
  signingKeyId,
  manifestPath,
  manifestBytes: Buffer.byteLength(manifestJson),
  approvalPath,
  approvalBytes: Buffer.byteLength(approvalJson),
  expiresAt,
  installationId: signedManifest.installationId,
  sequence: signedManifest.sequence,
  preflight: 'requireSignedOwnerPreflight 통과',
}));
