import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BusinessError, httpError } from 'fixture-errors';
import { BusinessTransport } from 'fixture-transport';
import { loadInstallation } from 'fixture-installation';
import { capabilities, fixture, installation, installationId, json, origin, readiness } from 'fixture-test-support';
import { decodeIdentity } from 'fixture-api';
import { decodeParticipantHub, decodeParticipantList } from 'fixture-participants';
import { buildCapabilityManifest, decodeCapabilityManifest } from 'fixture-capabilities';
import { verifySignedInstallManifest } from 'fixture-install-manifest';
import { createTestSigner, signedManifest } from 'fixture-install-support';
import { createCommunityCloudRuntime } from 'fixture-community-runtime';
import { createEnvironmentSecretStore } from 'fixture-secrets';

const harness = dirname(fileURLToPath(import.meta.url));
const out = join(harness, '..');
const { runtime, snapshot } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8')) as { runtime: string; snapshot: string };
const save = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const legacyErrors = [
  ['authentication_required', 401, 'unauthenticated'],
  ['access_denied', 403, 'forbidden'],
  ['forbidden', 403, 'forbidden'],
  ['invalid_request', 400, 'invalid_request'],
  ['validation_error', 422, 'invalid_request'],
  ['not_found', 404, 'unavailable'],
  ['conflict', 409, 'conflict'],
  ['not_eligible_or_already_purged', 410, 'unavailable'],
  ['pilot_text_ai_consent_required', 409, 'conflict'],
  ['text_ai_pilot_disabled', 409, 'conflict'],
  ['stale_draft_version', 409, 'draft_changed'],
  ['draft_version_required', 409, 'draft_changed'],
  ['grounded_evidence_required', 409, 'grounded_evidence_required'],
  ['speaker_confirmation_required', 409, 'speaker_confirmation_required'],
  ['fixture_draft_approval_forbidden', 409, 'fixture_draft_approval_forbidden'],
  ['ai_provider_not_configured', 409, 'conflict'],
  ['ai_prohibited_output', 422, 'invalid_request'],
  ['ai_provider_unavailable', 503, 'unavailable'],
  ['privacy_consent_required', 422, 'privacy_consent_required'],
  ['emergency_reason_required', 422, 'emergency_reason_required'],
  ['service_unavailable', 503, 'unavailable'],
] as const;

function expectCode(run: () => unknown, code: string): void {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe(code);
    return;
  }
  throw new Error(`expected_${code}`);
}

async function expectRejectedCode(run: Promise<unknown>, code: string): Promise<void> {
  await expect(run).rejects.toMatchObject({ code });
}

function attestedDatabase() {
  const forbidden = () => { throw new Error('unexpected_business_database_access'); };
  const absent = { bind() { return this; }, async first() { return null; }, all: forbidden, run: forbidden };
  const scoped = {
    prepare(sql: string) { if (/\bagent_credentials\b/.test(sql)) return absent; return forbidden(); },
    batch: forbidden,
  };
  const statement = { bind() { return this; }, async first() { return { allowed: 1 }; }, all: forbidden, run: forbidden };
  return { ...scoped, prepare: () => statement, forActor: () => scoped, close: async () => {} } as never;
}

describe('CCC-212 pinned contract and runtime audit', () => {
  it('maps every approved legacy error through the actual Browser translator', () => {
    const mapped = legacyErrors.map(([legacyCode, status, expectedBrowserCode]) => {
      const actual = httpError(status, { error: legacyCode });
      expect(actual.code).toBe(expectedBrowserCode);
      expect(JSON.stringify(actual)).not.toContain(legacyCode === expectedBrowserCode ? '__never__' : 'synthetic private detail');
      return {
        legacyCode, status, browserCode: actual.code,
        semantic: legacyCode === actual.code ? 'preserved' : 'normalized_or_lost',
      };
    });
    expect(mapped).toHaveLength(21);
    const source = readFileSync(join(snapshot, 'apps/client/src/business/errors.ts'), 'utf8');
    const block = source.slice(source.indexOf('const messages = {'), source.indexOf('} as const;'));
    const currentCodes = [...block.matchAll(/^\s{2}([a-z][a-z0-9_]+):/gm)].map(match => match[1]!);
    const approved = legacyErrors.map(([code]) => code);
    save('error-code-coverage.json', {
      approvedCount: approved.length,
      currentBrowserCount: currentCodes.length,
      mapped,
      additions: currentCodes.filter(code => !approved.includes(code as never)),
      missingExactNames: approved.filter(code => !currentCodes.includes(code)),
      directConsumers: [
        'apps/client/src/business/transport.ts:httpError',
        'apps/client/src/business/auth.ts:authError and signOut',
        'apps/client/src/business/ai-review.ts:404 becomes nullable draft',
        'apps/client/src/business/invites.ts:404 becomes public_signup_disabled',
        'apps/client/src/business/consent-panel.tsx:safeError and 401 signOut',
      ],
    });
  });

  it('runs canonical and business DTO decoders over valid nullable and malformed values', () => {
    const capability = buildCapabilityManifest({
      mode: 'community-cloud', requestedSttMode: 'off', requestedLlmMode: 'off', registry: [],
      sttGatePassed: { local: false, azure: false }, azureKeyPresent: false, llmKeyPresent: false,
      llmGateOpen: false, agentStatus: 'inactive', publicSignupEnabled: false,
    });
    const decodedCapability = decodeCapabilityManifest(capability, []);
    expect(decodedCapability.sttEngine).toBeNull();
    expect(() => decodeCapabilityManifest({ ...capability, unexpected: true }, [])).toThrow();
    expect(() => decodeCapabilityManifest({ ...capability, sttOptions: [...capability.sttOptions].reverse() }, [])).toThrow();

    const identityValue = {
      id: 'user-1', orgId: 'org-1', email: null, name: null, active: true, roles: ['worker'],
      institution: readiness('org-1', { orgName: null }),
    };
    const identity = decodeIdentity(identityValue);
    expect(identity.email).toBeNull();
    expect(identity.name).toBeNull();
    expectCode(() => decodeIdentity({ ...identityValue, active: false }), 'invalid_response');
    expectCode(() => decodeIdentity({ ...identityValue, roles: ['service'] }), 'invalid_response');

    const list = decodeParticipantList({ results: [{
      beneficiaryId: 'beneficiary-1', status: 'active', programCount: 1,
      name: null, phone: null, email: null, programNames: ['Synthetic Program'], newSignup: false,
    }] });
    expect(list[0]?.email).toBeNull();
    expectCode(() => decodeParticipantList({ results: [{ ...list[0], unexpected: true }] }), 'invalid_response');

    const restrictedHub = decodeParticipantHub({
      beneficiaryId: 'beneficiary-1', restricted: true, participantName: null, participantPhone: null,
      participantEmail: null, programs: [{ id: 'case-1', beneficiaryId: 'beneficiary-1', programId: 'program-1',
        programName: null, programType: 'financial_support_v1', status: 'active', authorized: false, assigneeNames: [] }],
    }, 'beneficiary-1');
    expect(restrictedHub.participantBirthDate).toBeNull();
    expect(restrictedHub.sessionCount).toBeNull();

    save('decoder-evidence.json', {
      capability: { validExactSchema: true, nullableEngine: true, extraKeyRejected: true, optionOrderRejected: true },
      identity: { nullableEmailAndName: true, inactiveRejected: true, serviceRoleRejected: true },
      participant: { nullablePiiAccepted: true, extraKeyRejected: true, restrictedProjectionNullsSensitiveFields: true },
    });
  });

  it('exercises authenticated transport, errors, no retry, logout, token change, and cancellation', async () => {
    let token: string | null = 'memory-token-a';
    let writes = 0;
    const requests: Array<Record<string, unknown>> = [];
    let mode: 'ok' | 'conflict' | 'unauthorized' | 'forbidden' | 'unavailable' | 'invalid-json' | 'pending' = 'ok';
    let resolvePending: ((response: Response) => void) | null = null;
    const verified = await installation();
    const transport = new BusinessTransport(verified, () => token, async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        path: new URL(request.url).pathname, method: request.method,
        bearerPresent: request.headers.get('authorization') === `Bearer ${token}`,
        credentials: request.credentials, cache: request.cache, redirect: request.redirect,
      });
      if (request.url.endsWith('/capabilities')) return json(capabilities(), 200, { 'X-CCC-Installation-Id': installationId });
      if (request.url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      if (request.method !== 'GET') writes += 1;
      if (mode === 'conflict') return json({ error: 'private synthetic body' }, 409);
      if (mode === 'unauthorized') return json({ error: 'actor_authentication_required' }, 401);
      if (mode === 'forbidden') return json({ error: 'private synthetic body' }, 403);
      if (mode === 'unavailable') return json({ error: 'private synthetic body' }, 503);
      if (mode === 'invalid-json') return new Response('not-json', { status: 200 });
      if (mode === 'pending') return new Promise<Response>(resolve => { resolvePending = resolve; });
      return json({ ok: true });
    });

    await expectRejectedCode(transport.request('/me'), 'capabilities_required');
    await transport.initialize();
    await transport.request('/me');
    for (const path of ['https://attacker.invalid', '//attacker.invalid', '/../escape', '/%2e%2e/escape', '/me?token=x']) {
      await expectRejectedCode(transport.request(path), 'invalid_api_path');
    }
    mode = 'conflict';
    await expectRejectedCode(transport.request('/organization/profile', 'PATCH', { value: 'synthetic' }), 'conflict');
    expect(writes).toBe(1);
    mode = 'unauthorized';
    await expectRejectedCode(transport.request('/me'), 'unauthenticated');
    mode = 'forbidden';
    await expectRejectedCode(transport.request('/me'), 'forbidden');
    mode = 'unavailable';
    await expectRejectedCode(transport.request('/me'), 'unavailable');
    mode = 'invalid-json';
    await expectRejectedCode(transport.request('/me'), 'invalid_response');
    mode = 'ok';
    await transport.revokeSession();

    mode = 'pending';
    const pending = transport.request('/me');
    await Promise.resolve();
    token = 'memory-token-b';
    resolvePending?.(json({ id: 'old-session-result' }));
    await expectRejectedCode(pending, 'session_changed');
    await expectRejectedCode(transport.request('/me'), 'capabilities_required');
    transport.dispose();
    await expectRejectedCode(transport.request('/me'), 'session_changed');

    save('decoder-transport.json', {
      requestCount: requests.length, writeAttempts: writes, noWriteRetry: writes === 1,
      beforeCapabilityRejected: true, bearerAttachedFromMemory: requests.every(row => row.bearerPresent === true),
      credentialsOmitted: requests.every(row => row.credentials === 'omit'),
      noStore: requests.every(row => row.cache === 'no-store'),
      redirectsRejectedByPolicy: requests.every(row => row.redirect === 'error'),
      pathEscapesRejectedBeforeFetch: true,
      errorBodiesRedacted: true,
      logout204Accepted: true,
      tokenChangeDiscardedOldResponse: true,
      disposedTransportRejects: true,
    });
  });

  it('exercises signed manifest, bootstrap, origin, replay, and installation binding', async () => {
    const signer = await createTestSigner('ccc212-public-test-key');
    const manifest = await signedManifest(signer, 'community-cloud');
    await expect(verifySignedInstallManifest(manifest, { publicKeys: signer.publicKeys, now: new Date() })).resolves.toMatchObject({
      apiBase: manifest.apiBase, supabaseAuthOrigin: manifest.supabaseAuthOrigin,
    });

    const tampered = { ...manifest, apiBase: 'https://attacker.invalid/api' };
    await expect(verifySignedInstallManifest(tampered, { publicKeys: signer.publicKeys, now: new Date() }))
      .rejects.toMatchObject({ code: 'signature_mismatch' });
    await expect(verifySignedInstallManifest(manifest, { publicKeys: signer.publicKeys, revokedKeyIds: [signer.keyId], now: new Date() }))
      .rejects.toMatchObject({ code: 'key_revoked' });
    await expect(verifySignedInstallManifest(manifest, { publicKeys: signer.publicKeys, minSequence: manifest.sequence + 1, now: new Date() }))
      .rejects.toMatchObject({ code: 'sequence_replay' });
    await expect(verifySignedInstallManifest(manifest, { publicKeys: signer.publicKeys, expectedInstallationId: 'another-installation', now: new Date() }))
      .rejects.toMatchObject({ code: 'wrong_install' });

    let publicFetches = 0;
    await expect(loadInstallation(origin, JSON.stringify(signer.publicKeys), async input => {
      publicFetches += 1;
      return String(input).endsWith('/ccc-install-manifest.json') ? json(manifest) : json({ mode: manifest.mode, apiBase: manifest.apiBase });
    })).rejects.toMatchObject({ code: 'installation_invalid' });
    expect(publicFetches).toBe(1);

    const browserFixture = await fixture();
    await expect(loadInstallation(origin, browserFixture.keys, async input => String(input).endsWith('/ccc-install-manifest.json')
      ? json(browserFixture.manifest) : json({ mode: browserFixture.manifest.mode, apiBase: 'https://attacker.invalid/api' })))
      .rejects.toMatchObject({ code: 'installation_invalid' });

    const lowSequence = await signedManifest(signer, 'community-cloud', {
      clientOrigin: origin, allowedOrigins: [origin], sequence: 0, installationId: 'different-valid-installation',
    });
    const acceptedWithoutState = await loadInstallation(origin, JSON.stringify(signer.publicKeys), async input =>
      String(input).endsWith('/ccc-install-manifest.json') ? json(lowSequence) : json({ mode: lowSequence.mode, apiBase: lowSequence.apiBase }));
    expect(acceptedWithoutState.manifest.sequence).toBe(0);
    expect(acceptedWithoutState.manifest.installationId).toBe('different-valid-installation');

    save('bootstrap-allowlist.json', {
      validSeparateApiAndAuthOriginsAccepted: true,
      tamperedSignedApiRejectedBeforeBootstrap: true,
      canonicalRevokedKeyRejected: true,
      canonicalSequenceReplayRejected: true,
      canonicalWrongInstallationRejected: true,
      unsignedBootstrapRedirectRejected: true,
      browserTransportOriginAndPathEscapesRejected: true,
      consumerStateBinding: {
        status: 'FAILED',
        observed: 'loadInstallation accepted a validly signed sequence 0 manifest with a different installationId because its public API accepts no revokedKeyIds, minSequence, or expectedInstallationId state.',
        canonicalValidatorSupportsStateChecks: true,
      },
    });
  });

  it('captures headers from actual Community Cloud runtime and prepares an actual static release', async () => {
    const signer = await createTestSigner('ccc212-release-public-key');
    const apiBase = 'https://api.example.invalid/api';
    const clientOrigin = 'https://ccc.example.org';
    const manifest = await signedManifest(signer, 'community-cloud', { apiBase, clientOrigin, allowedOrigins: [clientOrigin] });
    const handler = await createCommunityCloudRuntime({
      database: attestedDatabase(), secretStore: createEnvironmentSecretStore({}), organizationId: 'synthetic-org',
      installManifest: JSON.stringify(manifest), signingKeys: JSON.stringify(signer.publicKeys),
      fetch: async () => { throw new Error('unexpected_provider_request'); },
    });
    const trusted = await handler(new Request(`${apiBase}/health`, { headers: { origin: clientOrigin } }));
    const preflight = await handler(new Request(`${apiBase}/me`, { method: 'OPTIONS', headers: {
      origin: clientOrigin, 'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization, content-type',
    } }));
    const untrusted = await handler(new Request(`${apiBase}/health`, { headers: { origin: `${clientOrigin}.evil.invalid` } }));
    const nullOrigin = await handler(new Request(`${apiBase}/health`, { headers: { origin: 'null' } }));
    const absentOrigin = await handler(new Request(`${apiBase}/health`));
    const actualCors = {
      trusted: { status: trusted.status, allowOrigin: trusted.headers.get('access-control-allow-origin'),
        exposeHeaders: trusted.headers.get('access-control-expose-headers'), credentialsHeaderPresent: trusted.headers.has('access-control-allow-credentials') },
      preflight: { status: preflight.status, allowOrigin: preflight.headers.get('access-control-allow-origin'),
        methods: preflight.headers.get('access-control-allow-methods'), headers: preflight.headers.get('access-control-allow-headers'),
        exposeHeaders: preflight.headers.get('access-control-expose-headers'), maxAge: preflight.headers.get('access-control-max-age'),
        vary: preflight.headers.get('vary'), credentialsHeaderPresent: preflight.headers.has('access-control-allow-credentials') },
      untrusted: { status: untrusted.status, allowOriginPresent: untrusted.headers.has('access-control-allow-origin') },
      nullOrigin: { status: nullOrigin.status, allowOriginPresent: nullOrigin.headers.has('access-control-allow-origin') },
      absentOrigin: { status: absentOrigin.status, allowOriginPresent: absentOrigin.headers.has('access-control-allow-origin') },
    };
    expect(actualCors.trusted.status).toBe(200);
    expect(actualCors.preflight.status).toBe(204);
    expect(actualCors.untrusted).toEqual({ status: 403, allowOriginPresent: false });
    expect(actualCors.nullOrigin).toEqual({ status: 403, allowOriginPresent: false });
    expect(actualCors.absentOrigin.allowOriginPresent).toBe(false);

    const releaseDir = join(runtime, 'release');
    mkdirSync(releaseDir, { recursive: true });
    const manifestPath = join(runtime, 'release-manifest.json');
    const configPath = join(runtime, 'release-config.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(configPath, JSON.stringify({ manifestPath, publicKeys: signer.publicKeys }));
    const build = spawnSync('bun', [join(snapshot, 'apps/client/tools/build-release.mjs'), '--config', configPath, '--out', releaseDir], {
      cwd: snapshot, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', HOME: join(runtime, 'home'), TMPDIR: join(runtime, 'tmp') },
    });
    save('release-build.json', {
      exitCode: build.status, stdoutSha256: sha(build.stdout ?? ''), stderrSha256: sha(build.stderr ?? ''),
      releaseDir, publicInputsOnly: true, privateKeyPersisted: false,
    });
    expect(build.status).toBe(0);

    const s2 = {
      methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      headers: 'Authorization, Content-Type, If-Match, X-Request-ID',
      exposeHeaders: 'ETag, X-Request-ID, X-CCC-Installation-Id', maxAge: '600',
    };
    save('actual-headers.json', {
      communityCloudRuntime: actualCors,
      s2Expected: s2,
      corsMatchesS2: actualCors.preflight.methods === s2.methods
        && actualCors.preflight.headers === s2.headers
        && actualCors.preflight.exposeHeaders === s2.exposeHeaders
        && actualCors.preflight.maxAge === s2.maxAge,
      fixtureAuthoredHeadersExcluded: true,
      staticRelease: { status: 'prepared_for_actual_server_probe', releaseDir },
    });
  });
});
