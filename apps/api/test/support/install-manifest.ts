import { signInstallManifest } from '@ccc/contracts/install-manifest';
import type { ApprovedSttEngineEntry, DeploymentMode, SignedInstallManifest } from '@ccc/contracts/runtime';

export const TEST_KEY_ID = 'test-key-2026-09';
export const TEST_INSTALLATION_ID = '6f3a8d0c-2b1e-4f7a-9c5d-0e1f2a3b4c5d';
export const SYNTHETIC_LOCAL_REGISTRY: ApprovedSttEngineEntry[] = [{ id: 'local-whisper-medium', mode: 'local' }];
export const SYNTHETIC_AZURE_REGISTRY: ApprovedSttEngineEntry[] = [{ id: 'azure-speech-koreacentral', mode: 'azure' }];

export interface TestSigner {
  keyId: string;
  publicKeys: Record<string, string>;
  privateKey: CryptoKey;
}

/** 테스트 전용 Ed25519 키. 실제 기관 키는 fixture 에 쓰지 않는다(S2 §5). */
export async function createTestSigner(keyId = TEST_KEY_ID): Promise<TestSigner> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { keyId, publicKeys: { [keyId]: btoa(String.fromCharCode(...raw)) }, privateKey: pair.privateKey };
}

type Unsigned = Omit<SignedInstallManifest, 'ed25519Signature'>;

export function unsignedManifest(mode: DeploymentMode, overrides: Partial<Unsigned> = {}): Unsigned {
  const base: Unsigned = mode === 'community-cloud'
    ? {
      schemaVersion: 1, mode, apiBase: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1',
      clientOrigin: 'https://ccc.example.org', allowedOrigins: ['https://ccc.example.org'],
      host: 'ccc.example.org', scheme: 'https', endpointDiscovery: 'static',
      installationId: TEST_INSTALLATION_ID, sequence: 3,
      publishedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2027-09-01T00:00:00.000Z',
      approvedSttEngineIds: [], supabaseProjectRef: 'abcdefghijklmnopqrst',
      supabaseAuthOrigin: 'https://abcdefghijklmnopqrst.supabase.co',
      supabasePublishableKey: 'sb_publishable_test_not_a_real_key', signingKeyId: TEST_KEY_ID,
    }
    : mode === 'local-office'
      ? {
        schemaVersion: 1, mode, apiBase: 'https://ccc.office.internal/api',
        clientOrigin: 'https://ccc.office.internal', allowedOrigins: ['https://ccc.office.internal'],
        host: 'ccc.office.internal', scheme: 'https', endpointDiscovery: 'static',
        installationId: TEST_INSTALLATION_ID, sequence: 3,
        publishedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2027-09-01T00:00:00.000Z',
        approvedSttEngineIds: [], supabaseProjectRef: null, supabaseAuthOrigin: null, supabasePublishableKey: null,
        signingKeyId: TEST_KEY_ID,
      }
      : {
        schemaVersion: 1, mode, apiBase: 'http://127.0.0.1',
        clientOrigin: 'ccc://app', allowedOrigins: ['ccc://app'],
        host: '127.0.0.1', scheme: 'ccc', endpointDiscovery: 'dpapi-record',
        installationId: TEST_INSTALLATION_ID, sequence: 3,
        publishedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2027-09-01T00:00:00.000Z',
        approvedSttEngineIds: [], supabaseProjectRef: null, supabaseAuthOrigin: null, supabasePublishableKey: null,
        signingKeyId: TEST_KEY_ID,
      };
  return { ...base, ...overrides };
}

export async function signedManifest(signer: TestSigner, mode: DeploymentMode, overrides: Partial<Unsigned> = {}): Promise<SignedInstallManifest> {
  return signInstallManifest(unsignedManifest(mode, { signingKeyId: signer.keyId, ...overrides }), signer.privateKey);
}
