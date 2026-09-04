import { describe, expect, it } from 'vitest';
import {
  assertBootstrapMatchesManifest,
  InstallManifestError,
  isSupabasePublishableKey,
  parsePublicBootstrap,
  resolveEffectiveApiBase,
  verifySignedInstallManifest,
} from '@ccc/contracts/install-manifest';
import { createTestSigner, FIXTURE_EXPIRES_AT, signedManifest, TEST_INSTALLATION_ID, unsignedManifest } from './support/install-manifest';

// S2 §2.7 · §5 `pnpm test:security --bootstrap`. 실제 기관 키·값은 없다.
const NOW = new Date();
const signerPromise = createTestSigner();

async function verifyWith(value: unknown, overrides: Partial<Parameters<typeof verifySignedInstallManifest>[1]> = {}) {
  const signer = await signerPromise;
  return verifySignedInstallManifest(value, { publicKeys: signer.publicKeys, now: NOW, ...overrides });
}

async function expectCode(promise: Promise<unknown>, code: InstallManifestError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(InstallManifestError);
}

function legacyJwt(role: string): string {
  const b64 = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify({ role }))}.${b64('sig')}`;
}

describe('signed install manifest', () => {
  it('verifies a valid manifest in each mode and returns the parsed registry', async () => {
    const signer = await signerPromise;
    for (const mode of ['community-cloud', 'local-single', 'local-office'] as const) {
      const manifest = await signedManifest(signer, mode, { approvedSttEngineIds: [{ id: 'azure-speech-koreacentral', mode: 'azure' }, { id: 'local-whisper-medium', mode: 'local' }] });
      const verified = await verifyWith(manifest, { minSequence: 3, expectedInstallationId: TEST_INSTALLATION_ID });
      expect(verified.mode).toBe(mode);
      expect(verified.approvedSttEngineIds).toHaveLength(2);
      expect(verified.installationId).toBe(TEST_INSTALLATION_ID);
    }
  });

  it('rejects tampered, expired, replayed, wrong-install and revoked-key manifests', async () => {
    const signer = await signerPromise;
    const manifest = await signedManifest(signer, 'local-office');
    await expectCode(verifyWith({ ...manifest, apiBase: 'https://evil.example/api' }), 'signature_mismatch');
    await expectCode(verifyWith({ ...manifest, approvedSttEngineIds: [{ id: 'local-whisper-medium', mode: 'local' }] }), 'signature_mismatch');
    await expectCode(verifyWith({ ...manifest, ed25519Signature: manifest.ed25519Signature.slice(0, -4) + 'AAAA' }), 'signature_mismatch');
    await expectCode(verifyWith(manifest, { now: new Date(Date.parse(FIXTURE_EXPIRES_AT) + 1000) }), 'expired');
    await expectCode(verifyWith(manifest, { minSequence: 4 }), 'sequence_replay');
    await expectCode(verifyWith(manifest, { expectedInstallationId: 'other-install' }), 'wrong_install');
    await expectCode(verifyWith(manifest, { revokedKeyIds: [signer.keyId] }), 'key_revoked');
    await expectCode(verifyWith(manifest, { publicKeys: {} }), 'unknown_key');
    const otherSigner = await createTestSigner(signer.keyId);
    await expectCode(verifyWith(manifest, { publicKeys: otherSigner.publicKeys }), 'signature_mismatch');
  });

  it('rejects malformed shapes before trusting the signature', async () => {
    const signer = await signerPromise;
    const manifest = await signedManifest(signer, 'local-office');
    const { host: _host, ...missingHost } = manifest;
    await expectCode(verifyWith(missingHost), 'invalid_shape');
    await expectCode(verifyWith({ ...manifest, extra: 1 }), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { allowedOrigins: ['*'] })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { allowedOrigins: ['https://other.internal'] })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { clientOrigin: 'https://ccc.office.internal/app', allowedOrigins: ['https://ccc.office.internal/app'] })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { approvedSttEngineIds: [{ id: 'local-whisper-medium', mode: 'local' }, { id: 'azure-speech-koreacentral', mode: 'azure' }] })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { approvedSttEngineIds: [{ id: 'https://stt.example', mode: 'local' }] })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { sequence: -1 })), 'invalid_shape');
  });

  it('single-dynamic-port: loopback base is signed, the port comes from the endpoint record', async () => {
    const signer = await signerPromise;
    const manifest = await verifyWith(await signedManifest(signer, 'local-single'));
    expect(resolveEffectiveApiBase(manifest, { installationId: TEST_INSTALLATION_ID, port: 47123 })).toBe('http://127.0.0.1:47123');
    expect(() => resolveEffectiveApiBase(manifest, null)).toThrow(InstallManifestError);
    expect(() => resolveEffectiveApiBase(manifest, { installationId: 'other', port: 47123 })).toThrow(/wrong_install/);
    expect(() => resolveEffectiveApiBase(manifest, { installationId: TEST_INSTALLATION_ID, port: 70000 })).toThrow(/endpoint/);
    // non-loopback 서명 base 는 mode_fields 로 거부된다.
    await expectCode(verifyWith(await signedManifest(signer, 'local-single', { apiBase: 'http://192.168.0.10' })), 'mode_fields');
    await expectCode(verifyWith(await signedManifest(signer, 'local-single', { endpointDiscovery: 'static' })), 'mode_fields');
    const office = await verifyWith(await signedManifest(signer, 'local-office'));
    expect(resolveEffectiveApiBase(office, null)).toBe(office.apiBase);
  });

  it('local modes must not carry Supabase fields; cloud must', async () => {
    const signer = await signerPromise;
    await expectCode(verifyWith(await signedManifest(signer, 'local-office', { supabaseProjectRef: 'abcdefghijklmnopqrst' })), 'mode_fields');
    await expectCode(verifyWith(await signedManifest(signer, 'local-single', { supabasePublishableKey: 'sb_publishable_x' })), 'mode_fields');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabaseAuthOrigin: null })), 'mode_fields');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { apiBase: 'http://abcdefghijklmnopqrst.supabase.co/functions/v1' })), 'mode_fields');
  });

  it('Supabase auth origin and project ref equality', async () => {
    const signer = await signerPromise;
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabaseAuthOrigin: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1' })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabaseAuthOrigin: 'https://user:pw@abcdefghijklmnopqrst.supabase.co' })), 'invalid_shape');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabaseAuthOrigin: 'http://abcdefghijklmnopqrst.supabase.co' })), 'auth_origin');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabaseAuthOrigin: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' })), 'project_ref_mismatch');
    await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { apiBase: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1' })), 'project_ref_mismatch');
  });

  it('publishable key fixtures', async () => {
    const signer = await signerPromise;
    expect(isSupabasePublishableKey('sb_publishable_abc-DEF_123')).toBe(true);
    expect(isSupabasePublishableKey(legacyJwt('anon'))).toBe(true);
    expect(isSupabasePublishableKey('sb_secret_abc')).toBe(false);
    expect(isSupabasePublishableKey(legacyJwt('service_role'))).toBe(false);
    expect(isSupabasePublishableKey('not.a.key.at.all')).toBe(false);
    expect(isSupabasePublishableKey('')).toBe(false);
    for (const bad of ['sb_secret_abc', legacyJwt('service_role'), 'malformed', '']) {
      await expectCode(verifyWith(await signedManifest(signer, 'community-cloud', { supabasePublishableKey: bad })), 'publishable_key');
    }
    await expect(verifyWith(await signedManifest(signer, 'community-cloud', { supabasePublishableKey: legacyJwt('anon') }))).resolves.toBeDefined();
  });
});

describe('public bootstrap', () => {
  it('has exactly two keys and must equal the signed manifest', async () => {
    const signer = await signerPromise;
    const manifest = await verifyWith(await signedManifest(signer, 'community-cloud'));
    const bootstrap = parsePublicBootstrap({ apiBase: manifest.apiBase, mode: manifest.mode });
    expect(() => assertBootstrapMatchesManifest(bootstrap, manifest)).not.toThrow();
    expect(() => parsePublicBootstrap({ apiBase: manifest.apiBase, mode: manifest.mode, supabasePublishableKey: 'x' })).toThrow(InstallManifestError);
    expect(() => parsePublicBootstrap({ apiBase: manifest.apiBase })).toThrow(InstallManifestError);
    expect(() => parsePublicBootstrap({ apiBase: manifest.apiBase, mode: 'cloud' })).toThrow(InstallManifestError);
    // unsigned bootstrap 이 다른 API 를 가리키면 client 는 멈춘다.
    expect(() => assertBootstrapMatchesManifest({ apiBase: 'https://evil.example', mode: manifest.mode }, manifest)).toThrow(/bootstrap_mismatch/);
    expect(() => assertBootstrapMatchesManifest({ apiBase: manifest.apiBase, mode: 'local-office' }, manifest)).toThrow(/bootstrap_mismatch/);
    // Single 은 서명된 loopback base 와 exact equality 다(port 없음).
    const single = await verifyWith(await signedManifest(signer, 'local-single'));
    expect(() => assertBootstrapMatchesManifest({ apiBase: 'http://127.0.0.1:47123', mode: 'local-single' }, single)).toThrow(/bootstrap_mismatch/);
    expect(() => assertBootstrapMatchesManifest({ apiBase: 'http://127.0.0.1', mode: 'local-single' }, single)).not.toThrow();
    // 저장소의 example 은 값이 비어 있어 그대로는 통과하지 않는다.
    expect(unsignedManifest('local-single').apiBase).toBe('http://127.0.0.1');
  });
});
