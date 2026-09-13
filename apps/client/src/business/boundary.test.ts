import { describe, expect, it } from 'vitest';
import { apiBase, capabilities, fixture, installation, installationId, json, origin } from './test-support';
import { loadInstallation, parseInstallationTrust } from './installation';
import { BusinessTransport } from './transport';

describe('verified browser installation', () => {
  it('accepts a signed Cloud installation with separate client and API hosts', async () => {
    const { manifest, trust } = await fixture({ host: new URL(origin).host, sequence: 2,
      supabaseAuthOrigin: 'https://abcdefghijklmnopqrst.auth.example' });
    const verified = await loadInstallation(origin, trust, async (input) =>
      String(input).endsWith('/ccc-install-manifest.json')
        ? json(manifest) : json({ mode: manifest.mode, apiBase: manifest.apiBase }));
    expect(verified.apiBase).toBe(apiBase);
    expect(verified.manifest.supabaseAuthOrigin).toBe('https://abcdefghijklmnopqrst.auth.example');
    const transport = new BusinessTransport(verified, () => 'synthetic-token', async () =>
      json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId }));
    await expect(transport.initialize()).resolves.toMatchObject({ mode: 'community-cloud' });
    transport.dispose();
  });

  it('does not consult unsigned bootstrap after a tampered signature', async () => {
    const { manifest, trust } = await fixture();
    const destinations: string[] = [];
    await expect(loadInstallation(origin, trust, async (input) => {
      destinations.push(String(input));
      return json({ ...manifest, apiBase: 'https://attacker.example/collect' });
    })).rejects.toMatchObject({ code: 'installation_invalid' });
    expect(destinations).toEqual([`${origin}/ccc-install-manifest.json`]);
  });

  it('fails before any network request when no installation trust is configured', async () => {
    await expect(loadInstallation(origin, undefined, async () => {
      throw new Error('Network must not be reached');
    })).rejects.toMatchObject({ code: 'trust_missing' });
  });

  it('rejects bootstrap redirection and a signed but different client origin', async () => {
    const { manifest, trust } = await fixture();
    await expect(loadInstallation(origin, trust, async (input) => String(input).endsWith('/ccc-install-manifest.json')
      ? json(manifest) : json({ mode: manifest.mode, apiBase: 'https://attacker.example' })))
      .rejects.toMatchObject({ code: 'installation_invalid' });
    await expect(loadInstallation('https://other.example', trust, async () => json(manifest)))
      .rejects.toMatchObject({ code: 'installation_invalid' });
  });

  it('rejects incomplete, extra-field and malformed trust before the first fetch', async () => {
    const { trust } = await fixture();
    const valid = JSON.parse(trust);
    const invalid = [
      undefined, '', '{', 'null', '[]', JSON.stringify(valid.publicKeys),
      ...Object.keys(valid).map((key) => JSON.stringify(Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key)))),
      JSON.stringify({ ...valid, privateApproval: 'PRIVATE_APPROVAL_SENTINEL' }),
      JSON.stringify({ ...valid, publicKeys: {} }),
      JSON.stringify({ ...valid, publicKeys: { test: 'not-a-public-key' } }),
      JSON.stringify({ ...valid, publicKeys: { constructor: valid.publicKeys.test } }),
      JSON.stringify({ ...valid, revokedKeyIds: 'test' }),
      JSON.stringify({ ...valid, revokedKeyIds: [''] }),
      JSON.stringify({ ...valid, revokedKeyIds: [1] }),
      JSON.stringify({ ...valid, revokedKeyIds: ['test', 'test'] }),
      ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null].map((minSequence) => JSON.stringify({ ...valid, minSequence })),
      JSON.stringify({ ...valid, expectedInstallationId: '' }),
      JSON.stringify({ ...valid, expectedInstallationId: '   ' }),
    ];
    for (const config of invalid) {
      const requests: string[] = [];
      await expect(loadInstallation(origin, config, async (input) => {
        requests.push(String(input)); return json({});
      })).rejects.toMatchObject({ code: 'trust_missing' });
      expect(requests).toEqual([]);
    }
  });

  it.each([
    { name: 'revoked key', patch: { revokedKeyIds: ['test'] } },
    { name: 'external sequence floor', patch: { minSequence: 2 } },
    { name: 'external installation identity', patch: { expectedInstallationId: 'another-installation' } },
  ])('rejects $name after manifest verification and before bootstrap or API', async ({ patch }) => {
    const { manifest, trust } = await fixture();
    const requests: string[] = [];
    await expect(loadInstallation(origin, JSON.stringify({ ...JSON.parse(trust), ...patch }), async (input) => {
      requests.push(String(input)); return json(manifest);
    })).rejects.toMatchObject({ code: 'installation_invalid' });
    expect(requests).toEqual([`${origin}/ccc-install-manifest.json`]);
  });

  it('keeps accepted trust values immutable without replacing externally supplied identity or floor', async () => {
    const { trust } = await fixture();
    const parsed = parseInstallationTrust(trust);
    expect(parsed).toEqual(JSON.parse(trust));
    expect(Reflect.set(parsed, 'minSequence', 0)).toBe(false);
    expect(Reflect.set(parsed.publicKeys, 'new-key', 'bad')).toBe(false);
    expect(Reflect.set(parsed.revokedKeyIds, '0', 'test')).toBe(false);
    expect(parsed.expectedInstallationId).toBe(installationId);
    expect(parsed.minSequence).toBe(1);
  });

  it('preserves expiry and unsupported local-mode refusals with valid external trust', async () => {
    const expired = await fixture({ expiresAt: '2000-01-01T00:00:00.000Z' });
    await expect(loadInstallation(origin, expired.trust, async () => json(expired.manifest)))
      .rejects.toMatchObject({ code: 'installation_invalid' });
    const local = await fixture({ mode: 'local-office', supabaseProjectRef: null, supabaseAuthOrigin: null, supabasePublishableKey: null });
    await expect(loadInstallation(origin, local.trust, async (input) => String(input).endsWith('/ccc-install-manifest.json')
      ? json(local.manifest) : json({ mode: 'local-office', apiBase })))
      .rejects.toMatchObject({ code: 'local_office_unsupported' });
  });
});

describe('session-bound Bearer transport', () => {
  it('blocks business reads until the installation identity and capability schema both pass', async () => {
    const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async () =>
      json(capabilities(), 200, { 'X-CCC-Installation-Id': 'another-installation' }));
    await expect(transport.request('/me')).rejects.toMatchObject({ code: 'capabilities_required' });
    await expect(transport.initialize()).rejects.toMatchObject({ code: 'installation_mismatch' });
    await expect(transport.request('/me')).rejects.toMatchObject({ code: 'capabilities_required' });
    transport.dispose();
  });

  it('keeps the signed API prefix and refuses all origin and path escapes before sending a token', async () => {
    const requests: Request[] = [];
    const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.url.endsWith('/capabilities')
        ? json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId }) : json({ ok: true });
    });
    await transport.initialize();
    for (const path of ['https://attacker.example', '//attacker.example', '/../escape', '/%2e%2e/escape', '/.%2E/escape', '/%2e/escape', '/a\\escape', '/me?token=x']) {
      await expect(transport.request(path)).rejects.toMatchObject({ code: 'invalid_api_path' });
    }
    await transport.request('/me');
    await transport.request('/settings/accounts/Admin%40example.invalid/roles', 'PATCH', { roles: ['worker'], expectedRoles: ['worker'] });
    expect(requests.map((request) => request.url)).toEqual([
      `${apiBase}/capabilities`, `${apiBase}/me`, `${apiBase}/settings/accounts/Admin%40example.invalid/roles`,
    ]);
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer synthetic-token');
    expect(requests[1]?.credentials).toBe('omit');
    expect(requests[1]?.cache).toBe('no-store');
    expect(requests[1]?.redirect).toBe('error');
    transport.dispose();
  });

  it('preserves the server MFA code without exposing other forbidden details', async () => {
    let responseBody: unknown = { error: 'mfa_required' };
    const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async (input) => {
      if (String(input).endsWith('/capabilities')) {
        return json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId });
      }
      return json(responseBody, 403);
    });
    await transport.initialize();
    await expect(transport.request('/me')).rejects.toMatchObject({ status: 403, code: 'mfa_required' });
    responseBody = { error: 'private-provider-detail' };
    await expect(transport.request('/me')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    transport.dispose();
  });

  it('never retries a conflicting write or publishes its server error body', async () => {
    let writes = 0;
    const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async (input) => {
      if (String(input).endsWith('/capabilities')) return json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId });
      writes += 1;
      return json({ error: 'raw participant details', code: 'not-a-safe-code' }, 409);
    });
    await transport.initialize();
    await expect(transport.request('/organization/profile', 'PATCH', { orgName: 'Changed', expectedOrgName: 'Before' }))
      .rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(writes).toBe(1);
    transport.dispose();
  });

  it('discards a response completed after session invalidation', async () => {
    let finish: ((response: Response) => void) | undefined;
    const transport = new BusinessTransport(await installation(), () => 'synthetic-token', async (input) => {
      if (String(input).endsWith('/capabilities')) return json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId });
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    await transport.initialize();
    const pending = transport.request('/me');
    transport.dispose();
    finish?.(json({ id: 'previous-account' }));
    await expect(pending).rejects.toMatchObject({ code: 'session_changed' });
  });
});
