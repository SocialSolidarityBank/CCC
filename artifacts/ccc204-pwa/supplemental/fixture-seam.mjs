import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [snapshot, evidence] = process.argv.slice(2);
const load = relative => import(pathToFileURL(join(snapshot, relative)).href);
try {
  const { createTestSigner, signedManifest } = await load('apps/api/test/support/install-manifest.ts');
  const { loadInstallation } = await load('apps/client/src/business/installation.ts');
  const { createVerifier } = await load('adapters/identity-supabase/src/verifier.ts');
  const signer = await createTestSigner();
  const manifest = await signedManifest(signer, 'community-cloud');
  let manifestReads = 0;
  let bootstrapReads = 0;
  const installation = await loadInstallation(manifest.clientOrigin, JSON.stringify(signer.publicKeys), async input => {
    if (String(input) === manifest.clientOrigin + '/ccc-install-manifest.json') {
      manifestReads++;
      return Response.json(manifest);
    }
    if (String(input) === manifest.clientOrigin + '/ccc-bootstrap.json') {
      bootstrapReads++;
      return Response.json({ mode: manifest.mode, apiBase: manifest.apiBase });
    }
    throw new Error('unexpected_fixture_request');
  });
  let jwksReads = 0;
  const publicIssuer = manifest.supabaseAuthOrigin + '/auth/v1';
  const verifier = createVerifier({ issuer: publicIssuer, jwksUri: publicIssuer + '/.well-known/jwks.json', fetch: async () => {
    jwksReads++;
    throw new Error('unexpected_fixture_jwks_request');
  } });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  // Negative test vector with the same algorithm/placeholder-signature shape as the existing browser preview.
  const previewShape = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: 'synthetic-subject' }) + '.c3ludGhldGlj';
  let previewTokenError = null;
  try { await verifier(previewShape); } catch (error) { previewTokenError = error.constructor.name; }
  let previewOriginError = null;
  try {
    createVerifier({ issuer: 'https://127.0.0.1:4175/auth/v1', jwksUri: 'https://127.0.0.1:4175/auth/v1/.well-known/jwks.json' });
  } catch (error) { previewOriginError = error.constructor.name; }
  const result = {
    executedAgainst: 'unmodified pinned fixture helper, client installation verifier and backend JWT verifier',
    signedInstallationAccepted: installation.apiBase === manifest.apiBase,
    manifestReads, bootstrapReads,
    publicKeyFingerprints: Object.fromEntries(Object.entries(signer.publicKeys).map(([id, value]) => [id, createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex')])),
    previewTokenShapeRejected: previewTokenError === 'ActorAuthenticationError', previewTokenError, jwksReads,
    previewLoopbackIssuerRejected: previewOriginError === 'IdentityStoreUnavailableError', previewOriginError,
    privateKeysAndTokensPersisted: false, browserOrAuthServerStarted: false,
    naturalRegistrationObserved: false,
  };
  writeFileSync(join(evidence, 'fixture-seam.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.signedInstallationAccepted || !result.previewTokenShapeRejected || !result.previewLoopbackIssuerRejected || jwksReads !== 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'fixture_probe_failed', errorClass: error.constructor.name }));
  process.exitCode = 1;
}
