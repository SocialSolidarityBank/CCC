#!/usr/bin/env node
// probe-journal.mjs — 읽기 전용. journal 의 runtimeSequence·runtimeConfigurationSha256·
// expiresAt·phase 와 새 문서의 authorization 지문을 대조한다. 시크릿 값을 출력하지 않는다.
import { createHostedInspector } from '../supabase/hosted-inspector.mjs';
import {
  configuredInstallTrust,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';

const env = process.env;
// CCC_SUPABASE_PROJECT_REF 는 /INSTALL 의 stale 값이 올 수 있으므로
// 서명된 manifest 가 들고 있는 ref 를 정본으로 쓴다.
const manifestDoc = JSON.parse(
  env.CCC_INSTALL_MANIFEST.trim().startsWith('{')
    ? env.CCC_INSTALL_MANIFEST
    : await (await import('node:fs/promises')).readFile(env.CCC_INSTALL_MANIFEST, 'utf8'),
);
const projectRef = manifestDoc.supabaseProjectRef;
const authorize = () => requireSignedOwnerPreflight({
  installManifest: env.CCC_INSTALL_MANIFEST,
  installApproval: env.CCC_INSTALL_APPROVAL,
  trust: configuredInstallTrust({
    organizationId: env.CCC_ORGANIZATION_ID,
    publicKeys: env.CCC_INSTALL_SIGNING_KEYS,
    revokedKeyIds: env.CCC_INSTALL_REVOKED_KEY_IDS,
  }),
  organizationId: env.CCC_ORGANIZATION_ID,
  projectRef,
});
const authorization = await authorize();
const inspector = createHostedInspector({
  accessToken: env.SUPABASE_ACCESS_TOKEN,
  projectRef: authorization.projectRef,
  authorization,
  authorize,
});
const snapshot = await inspector.inspect();
const journal = snapshot.installState?.journal ?? null;
console.log(JSON.stringify({
  journalFound: journal !== null,
  runtimeSequence: journal?.runtimeSequence ?? null,
  phase: journal?.phase ?? null,
  expiresAt: journal?.expiresAt ?? null,
  journalRuntimeConfigurationSha256: journal?.runtimeConfigurationSha256 ?? null,
  newRuntimeConfigurationSha256: authorization.runtimeConfigurationSha256,
  configurationMatches: journal?.runtimeConfigurationSha256 === authorization.runtimeConfigurationSha256,
  journalRuntimeManifestSha256: journal?.runtimeManifestSha256 ?? null,
  newRuntimeManifestSha256: authorization.runtimeManifestSha256,
  journalApprovalSha256: journal?.approvalSha256 ?? null,
  newApprovalSha256: authorization.approvalSha256,
  authorizationHistorySequences: (snapshot.installState?.authorizationHistory ?? [])
    .map(entry => entry.runtimeSequence),
}));
