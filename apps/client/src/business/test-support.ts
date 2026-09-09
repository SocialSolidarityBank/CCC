import { CONSENT_DOMAINS } from '@ccc/contracts/consent';
import { signInstallManifest } from '@ccc/contracts/install-manifest';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import type { SignedInstallManifest } from '@ccc/contracts/runtime';
import { loadInstallation } from './installation';

// 테스트 전용이다. 이 키와 주소는 런타임 진입점에서 가져오지 않는다.
export const origin = 'https://client.example';
export const apiBase = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/ccc';
export const installationId = 'client-boundary-test';

export async function fixture(overrides: Partial<Omit<SignedInstallManifest, 'ed25519Signature'>> = {}) {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  if (!('publicKey' in pair)) throw new Error('Expected an Ed25519 key pair');
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keys = JSON.stringify({ test: btoa(String.fromCharCode(...raw)) });
  const manifest = await signInstallManifest({
    schemaVersion: 1, mode: 'community-cloud', apiBase, clientOrigin: origin,
    allowedOrigins: [origin], host: 'abcdefghijklmnopqrst.supabase.co', scheme: 'https',
    endpointDiscovery: 'static', installationId, sequence: 1,
    publishedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    approvedSttEngineIds: [], supabaseProjectRef: 'abcdefghijklmnopqrst',
    supabaseAuthOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
    supabasePublishableKey: 'sb_publishable_synthetic', signingKeyId: 'test', ...overrides,
  }, pair.privateKey);
  return { manifest, keys };
}

export function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export async function installation() {
  const { manifest, keys } = await fixture();
  return loadInstallation(origin, keys, async (input) => String(input).endsWith('/ccc-install-manifest.json')
    ? json(manifest) : json({ mode: manifest.mode, apiBase: manifest.apiBase }));
}

export const capabilities = () => buildCapabilityManifest({
  mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
  sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
  llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: false,
});

/** 합성 준비 관측값. 실제 기관 준비나 hosted 인증을 뜻하지 않는다. */
export const readiness = (orgId = 'org-1', overrides: Record<string, unknown> = {}) => ({
  orgId,
  orgName: '합성 기관',
  settingsState: 'present',
  creatorLinkState: 'unlinked',
  initialSetupState: 'not_set_up',
  firstProgramAdmissionState: 'not_admitted',
  firstProgram: null,
  installationState: 'available',
  retentionPolicyStatus: 'configured',
  consentCopy: {
    version: 'synthetic-copy-v1',
    status: 'available',
    domains: CONSENT_DOMAINS.map((domain) => ({ domain, disclosureAvailable: true })),
  },
  ...overrides,
});
