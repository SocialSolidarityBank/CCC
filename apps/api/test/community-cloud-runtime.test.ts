import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPostgresDatabase, type PostgresDatabase } from '@ccc/db-postgres';
import type * as PostgresModule from '@ccc/db-postgres';
import type { Database, PreparedStatement } from '@ccc/contracts/database';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { createCommunityCloudRuntime, type CommunityCloudRuntimeConfig } from '../../community-cloud/src/runtime';
import { createTestSigner, signedManifest, TEST_INSTALLATION_ID } from './support/install-manifest';

vi.mock('@ccc/db-postgres', async importOriginal => ({
  ...await importOriginal<typeof PostgresModule>(),
  createPostgresDatabase: vi.fn(),
}));

const apiOrigin = 'https://api.example.invalid';
const clientOrigin = 'https://ccc.example.org';
const authOrigin = 'https://abcdefghijklmnopqrst.supabase.co';
const signerPromise = createTestSigner();

// Mini-only attestation outcomes, not PostgreSQL/RLS proof. Any business SQL here is a fixture error.
function attestedDatabase(allowed = 1): PostgresDatabase {
  const forbidden = () => { throw new Error('unexpected_business_database_access'); };
  const scoped: Database = { prepare: forbidden, batch: forbidden };
  const statement: PreparedStatement = {
    bind() { return this; },
    async first<T>() { return { allowed } as T; },
    all: forbidden, run: forbidden,
  };
  return { ...scoped, prepare: () => statement, forActor: () => scoped, close: async () => {} };
}

async function config(apiBase = `${apiOrigin}/api`): Promise<CommunityCloudRuntimeConfig> {
  const signer = await signerPromise;
  return {
    database: attestedDatabase(), secretStore: createEnvironmentSecretStore({}), organizationId: 'synthetic-org',
    installManifest: JSON.stringify(await signedManifest(signer, 'community-cloud', { apiBase })),
    signingKeys: JSON.stringify(signer.publicKeys),
    fetch: async () => { throw new Error('unexpected_provider_request'); },
  };
}

async function expectFailure(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('independent Community Cloud runtime', () => {
  it.each(['/api', '/tenant/api/', '/'])('serves only beneath the exact signed base %s', async path => {
    const handler = await createCommunityCloudRuntime(await config(`${apiOrigin}${path}`));
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const response = await handler(new Request(`${apiOrigin}${prefix}health`, { headers: { origin: clientOrigin } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'ccc-api' });
    expect(response.headers.get('x-ccc-installation-id')).toBe(TEST_INSTALLATION_ID);
    expect(response.headers.get('access-control-allow-origin')).toBe(clientOrigin);
    if (path.endsWith('/') && path !== '/') {
      await expectFailure(await handler(new Request(`${apiOrigin}${path.slice(0, -1)}`)), 404, 'not_found');
    }
  });

  it('rejects a wrong API origin even with trusted browser Origin and spoofed forwarding headers', async () => {
    const handler = await createCommunityCloudRuntime(await config());
    await expectFailure(await handler(new Request('https://other.example.invalid/api/health', {
      headers: { origin: clientOrigin, host: 'api.example.invalid', 'x-forwarded-host': 'api.example.invalid', 'x-forwarded-proto': 'https' },
    })), 403, 'forbidden');
  });

  it('rejects prefix siblings and legacy ingress paths instead of stripping a guessed prefix', async () => {
    const handler = await createCommunityCloudRuntime(await config());
    for (const path of ['/apix/health', '/health', '/functions/v1/api/health']) {
      await expectFailure(await handler(new Request(`${apiOrigin}${path}`)), 404, 'not_found');
    }
  });

  it('retains exact CORS and preflight method/header restrictions', async () => {
    const handler = await createCommunityCloudRuntime(await config());
    const denied = await handler(new Request(`${apiOrigin}/api/health`, { headers: { origin: `${clientOrigin}.evil.invalid` } }));
    await expectFailure(denied, 403, 'forbidden');
    expect(denied.headers.has('access-control-allow-origin')).toBe(false);
    const preflight = (method: string, headers: string) => new Request(`${apiOrigin}/api/me`, {
      method: 'OPTIONS', headers: { origin: clientOrigin, 'access-control-request-method': method, 'access-control-request-headers': headers },
    });
    expect((await handler(preflight('GET', 'authorization, content-type'))).status).toBe(204);
    await expectFailure(await handler(preflight('TRACE', 'authorization')), 403, 'forbidden');
    await expectFailure(await handler(preflight('GET', 'x-forwarded-host')), 403, 'forbidden');
  });

  it('requires Bearer identity and continues to refuse audio bodies', async () => {
    const handler = await createCommunityCloudRuntime(await config());
    await expectFailure(await handler(new Request(`${apiOrigin}/api/me`)), 401, 'actor_authentication_required');
    await expectFailure(await handler(new Request(`${apiOrigin}/api/sessions/synthetic/audio`, {
      method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: 'synthetic-audio',
    })), 415, 'AUDIO_BODY_FORBIDDEN');
  });

  it('keeps Auth issuer and JWKS on the signed Supabase origin, not the independent API origin', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'synthetic-auth', alg: 'ES256', use: 'sig' };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = async (issuer: string) => {
      const now = Math.floor(Date.now() / 1000);
      const input = `${encode({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })}.${encode({
        iss: issuer, aud: 'authenticated', sub: 'synthetic-subject', session_id: 'synthetic-session',
        role: 'authenticated', is_anonymous: false, aal: 'aal1', iat: now, exp: now + 3600,
      })}`;
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input));
      return `${input}.${Buffer.from(signature).toString('base64url')}`;
    };
    const configuration = await config();
    configuration.fetch = async input => {
      if (String(input) !== `${authOrigin}/auth/v1/.well-known/jwks.json`) throw new Error('untrusted_auth_endpoint');
      return Response.json({ keys: [jwk] });
    };
    const handler = await createCommunityCloudRuntime(configuration);
    const request = (value: string) => new Request(`${apiOrigin}/api/me`, { headers: { authorization: `Bearer ${value}` } });
    await expectFailure(await handler(request(await token(`${authOrigin}/auth/v1`))), 403, 'mfa_required');
    await expectFailure(await handler(request(await token(`${apiOrigin}/auth/v1`))), 401, 'actor_authentication_required');
  });

  it('closes an existing handler when its signed installation expires', async () => {
    const configuration = await config();
    const handler = await createCommunityCloudRuntime(configuration);
    const manifest = JSON.parse(configuration.installManifest);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(manifest.expiresAt));
    await expectFailure(await handler(new Request(`${apiOrigin}/api/health`)), 503, 'service_unavailable');
  });

  it('refuses startup when the database boundary does not attest a restricted identity', async () => {
    const configuration = await config();
    configuration.database = attestedDatabase(0);
    await expect(createCommunityCloudRuntime(configuration)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('refuses a privileged secret supplied through the runtime factory', async () => {
    const configuration = await config();
    configuration.secretStore = createEnvironmentSecretStore({ SUPABASE_SERVICE_ROLE_KEY: 'synthetic-not-a-credential' });
    await expect(createCommunityCloudRuntime(configuration)).rejects.toThrow('storage_signer_required');
  });

  it('answers readiness without database access or configuration headers and expires with the manifest', async () => {
    const configuration = await config();
    const handler = await createCommunityCloudRuntime(configuration);
    configuration.database.prepare = () => { throw new Error('readiness_touched_database'); };
    const probe = new URL('/readyz', clientOrigin);
    const response = await handler(new Request(probe));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(Object.fromEntries(response.headers)).toEqual({
      'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8',
    });
    const head = await handler(new Request(probe, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await handler(new Request(probe, { method: 'POST' }))).status).toBe(405);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(JSON.parse(configuration.installManifest).expiresAt));
    const expired = await handler(new Request(probe));
    expect(expired.status).toBe(503);
    expect(await expired.json()).toEqual({ status: 'unavailable' });
  });

  it('normalizes opted-in HTTP ingress only for the signed host, never forwarding headers', async () => {
    const configuration = await config();
    const internal = new URL('/api/health', apiOrigin);
    internal.protocol = 'http:';
    const direct = await createCommunityCloudRuntime(configuration);
    await expectFailure(await direct(new Request(internal)), 403, 'forbidden');
    const ingress = await createCommunityCloudRuntime({ ...configuration, allowHttpIngress: true });
    expect((await ingress(new Request(internal))).status).toBe(200);
    await expectFailure(await ingress(new Request(new URL('/api/me', internal))), 401, 'actor_authentication_required');
    const wrongHost = new URL('/api/health', clientOrigin);
    wrongHost.protocol = 'http:';
    await expectFailure(await ingress(new Request(wrongHost, { headers: {
      'x-forwarded-host': new URL(apiOrigin).host, 'x-forwarded-proto': 'https',
    } })), 403, 'forbidden');
  });
});

describe('Deno business entry privilege defense', () => {
  async function boot(extra: Record<string, string> = {}) {
    vi.resetModules();
    const configuration = await config();
    const environment: Record<string, string> = {
      CCC_DATABASE_URL: 'postgres://synthetic.invalid/disconnected-fixture', CCC_ORGANIZATION_ID: configuration.organizationId,
      CCC_INSTALL_MANIFEST: configuration.installManifest, CCC_INSTALL_SIGNING_KEYS: configuration.signingKeys, ...extra,
    };
    vi.mocked(createPostgresDatabase).mockReturnValue(configuration.database);
    let serve: ((request: Request) => Promise<Response>) | undefined;
    let exitCode: number | undefined;
    let listenOptions: { hostname: string; port: number } | undefined;
    const diagnostics: unknown[][] = [];
    const processExit = new Error('simulated_process_exit');
    const stderr = vi.spyOn(console, 'error').mockImplementation((...values) => { diagnostics.push(values); });
    vi.stubGlobal('Deno', {
      env: { get: (name: string) => environment[name], has: (name: string) => Object.hasOwn(environment, name) },
      serve: (options: typeof listenOptions, handler: typeof serve) => { listenOptions = options; serve = handler; },
      exit: (code: number) => { exitCode = code; throw processExit; },
    });
    // Module-loading boundary: the entry must initialize after this test installs its synthetic Deno.
    try {
      await import('../../community-cloud/src/main');
    } catch (error) {
      if (error !== processExit) throw error;
    } finally {
      stderr.mockRestore();
    }
    return {
      response: serve === undefined ? null : await serve(new Request(`${apiOrigin}/api/health`)),
      exitCode, listenOptions, diagnostics,
    };
  }

  it('serves with only the business installation bindings', async () => {
    const result = await boot({ PORT: '9099' });
    expect(result.exitCode).toBeUndefined();
    expect(result.listenOptions).toMatchObject({ hostname: '0.0.0.0', port: 9099 });
    expect(result.response?.status).toBe(200);
    expect(await result.response?.json()).toEqual({ status: 'ok', service: 'ccc-api' });
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN'])(
    'fails closed when the process contains %s instead of hiding it behind SecretStore', async name => {
      const result = await boot({ [name]: 'synthetic-not-a-credential' });
      expect(result).toEqual({
        response: null, exitCode: 1, listenOptions: undefined, diagnostics: [['installation_unavailable']],
      });
    },
  );

  it('exits without serving or exposing configuration when installation input is missing or PORT is invalid', async () => {
    for (const extra of [{ CCC_DATABASE_URL: '' }, { PORT: '0' }, { PORT: '65536' }, { PORT: 'invalid' }]) {
      const result = await boot(extra);
      expect(result).toEqual({
        response: null, exitCode: 1, listenOptions: undefined, diagnostics: [['installation_unavailable']],
      });
    }
  });
});
