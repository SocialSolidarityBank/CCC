import { describe, expect, it } from 'vitest';
import { apiBase, capabilities, fixture, installation, installationId, json, origin } from './test-support';
import { loadInstallation } from './installation';
import { BusinessTransport } from './transport';

describe('verified browser installation', () => {
  it('accepts a signed Cloud installation with separate client and API hosts', async () => {
    const { manifest, keys } = await fixture({ host: new URL(origin).host });
    await expect(loadInstallation(origin, keys, async (input) =>
      String(input).endsWith('/ccc-install-manifest.json')
        ? json(manifest) : json({ mode: manifest.mode, apiBase: manifest.apiBase })))
      .resolves.toMatchObject({ apiBase });
  });

  it('does not consult unsigned bootstrap after a tampered signature', async () => {
    const { manifest, keys } = await fixture();
    const destinations: string[] = [];
    await expect(loadInstallation(origin, keys, async (input) => {
      destinations.push(String(input));
      return json({ ...manifest, apiBase: 'https://attacker.example/collect' });
    })).rejects.toMatchObject({ code: 'installation_invalid' });
    expect(destinations).toEqual([`${origin}/ccc-install-manifest.json`]);
  });

  it('fails before any network request when no public trust keys are configured', async () => {
    await expect(loadInstallation(origin, undefined, async () => {
      throw new Error('Network must not be reached');
    })).rejects.toMatchObject({ code: 'trust_missing' });
  });

  it('rejects bootstrap redirection and a signed but different client origin', async () => {
    const { manifest, keys } = await fixture();
    await expect(loadInstallation(origin, keys, async (input) => String(input).endsWith('/ccc-install-manifest.json')
      ? json(manifest) : json({ mode: manifest.mode, apiBase: 'https://attacker.example' })))
      .rejects.toMatchObject({ code: 'installation_invalid' });
    await expect(loadInstallation('https://other.example', keys, async () => json(manifest)))
      .rejects.toMatchObject({ code: 'installation_invalid' });
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
