#!/usr/bin/env node
// regen-baseline-capture.mjs — 정본 generateProviderBaseline 을 CLI 와 같은 입력으로
// 호출하되 실패 code 를 잡아 보고한다. 출력 경로는 쓰지 않는다(실패 시 파일 없음).
import { generateProviderBaseline } from '../supabase/provider-baseline-generate.mjs';
import { createHostedInspector } from '../supabase/hosted-inspector.mjs';
import {
  configuredInstallTrust,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const evidencePath = process.argv[2];
const outDir = process.argv[3];
if (!evidencePath || !outDir) {
  console.error('usage: regen-baseline-capture.mjs <source-evidence.json> <out-dir>');
  process.exit(64);
}

// stage-env 가 파일 우선 주입한 CCC_INSTALL_MANIFEST 를 읽는다. 없으면 /current 정본.
const manifestDoc = await readStrictJsonDocument(
  env.CCC_INSTALL_MANIFEST ?? resolve(here, '../../artifacts/install/current/install-manifest.json'));
const projectRef = manifestDoc.supabaseProjectRef;

const authorize = (current = new Date()) => requireSignedOwnerPreflight({
  installManifest: env.CCC_INSTALL_MANIFEST,
  installApproval: env.CCC_INSTALL_APPROVAL,
  trust: configuredInstallTrust({
    organizationId: env.CCC_ORGANIZATION_ID,
    publicKeys: env.CCC_INSTALL_SIGNING_KEYS,
    revokedKeyIds: env.CCC_INSTALL_REVOKED_KEY_IDS,
  }),
  organizationId: env.CCC_ORGANIZATION_ID,
  projectRef,
  now: current,
});

const importKey = value => crypto.subtle.importKey(
  'pkcs8', Buffer.from(value, 'base64'), { name: 'Ed25519' }, true, ['sign'],
);
const publicKeyOf = async key => Buffer.from(
  (await crypto.subtle.exportKey('jwk', key)).x, 'base64url').toString('base64');

const issuedAt = new Date();
const authorization = await authorize(issuedAt);
const rootKeys = await readStrictJsonDocument(env.CCC_BETA_TRUST_ROOT_KEYS);
const revokedRootKeyIds = JSON.parse(env.CCC_BETA_REVOKED_ROOT_KEY_IDS ?? '[]');
const rootPrivateKey = await importKey(env.CCC_BETA_ROOT_SIGNING_PRIVATE_KEY);
const releasePrivateKey = await importKey(env.CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY);
const rootPublicKey = await publicKeyOf(rootPrivateKey);
const releasePublicKey = await publicKeyOf(releasePrivateKey);
const rootKeyId = Object.entries(rootKeys)
  .filter(([, pk]) => pk === rootPublicKey).map(([id]) => id)[0];

try {
  const result = await generateProviderBaseline({
    authorization,
    releaseTrustUnsigned: {
      schemaVersion: 1, profile: 'development', channel: 'beta', provider: 'supabase',
      projectRefSha256: authorization.projectRefHash,
      ownerOrgIdSha256: authorization.expectedOwnerOrgIdHash,
      region: 'ap-northeast-2', rootKeyId,
      releaseKeyId: `beta-release-${createHash('sha256').update(releasePublicKey, 'base64').digest('hex').slice(0, 16)}`,
      releasePublicKey,
      notBefore: issuedAt.toISOString(),
      expiresAt: new Date(Math.min(
        Date.parse(authorization.expiresAt), issuedAt.getTime() + 30 * 86400e3)).toISOString(),
    },
    rootPrivateKey,
    releasePrivateKey,
    rootKeys,
    revokedRootKeyIds,
    sourceEvidenceInput: evidencePath,
    inspector: createHostedInspector({
      accessToken: env.SUPABASE_ACCESS_TOKEN, projectRef, authorization, authorize,
    }),
    now: () => new Date(),
    outputPaths: {
      releaseTrust: resolve(outDir, 'release-trust.json'),
      baseline: resolve(outDir, 'baseline.json'),
    },
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error?.code ?? error?.name ?? 'UNKNOWN' }));
}
