import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { startPostgresHarness } from './support/postgres';
import { createTestSigner, signedManifest } from './support/install-manifest';
import { createCommunityCloudRuntime } from '../../community-cloud/src/runtime';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';

// Throwaway smoke: real loopback HTTP, asymmetric JWT verification and restricted PostgreSQL.
// Auth discovery is simulated locally; no hosted authentication or external requests occur.
const check = (ok: boolean, label: string) => { if (!ok) throw new Error(label); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('smoke_response_shape');
  return value as Record<string, unknown>;
}
const harness = await startPostgresHarness();
let server: Server | undefined;
try {
  const db = await harness.openDatabase();
  const directory = new URL('../../../migrations/postgres/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await harness.applyMigration(db, await readFile(new URL(name, directory), 'utf8'));
  }
  const org = 'smoke-org', otherOrg = 'smoke-other-org';
  for (const organization of [org, otherOrg]) {
    await db.prepare('INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES (?, ?, ?)')
      .bind(organization, 'Asia/Seoul', 365).run();
    await db.prepare('INSERT INTO program_admission_policies (org_id) VALUES (?)').bind(organization).run();
  }
  for (const [id, organization, role] of [['smoke-admin', org, 'admin'], ['smoke-worker', org, 'counselor'], ['smoke-other', otherOrg, 'admin']]) {
    await db.prepare('INSERT INTO users (id, org_id, email, role, active, auth_subject) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id!, organization!, `${id}@example.invalid`, role!, `subject-${id}`).run();
  }
  const restricted = await harness.openApiDatabase(db);
  const signing = await createTestSigner();
  const manifest = await signedManifest(signing, 'community-cloud', {
    apiBase: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/ccc-api',
  });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'smoke-key', alg: 'ES256', use: 'sig' };
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = async (id: string) => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${encoded({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })}.${encoded({
      iss: `${manifest.supabaseAuthOrigin}/auth/v1`, aud: 'authenticated', sub: `subject-${id}`,
      session_id: `session-${id}`, role: 'authenticated', is_anonymous: false, aal: 'aal2', iat: now, exp: now + 600,
    })}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`;
  };
  const runtime = await createCommunityCloudRuntime({
    database: restricted, organizationId: org,
    secretStore: createEnvironmentSecretStore({ PII_ENC_KEY: Buffer.alloc(32, 7).toString('base64') }),
    installManifest: JSON.stringify(manifest), signingKeys: JSON.stringify(signing.publicKeys),
    fetch: async () => new Response(JSON.stringify({ keys: [jwk] })),
  });
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, entry);
      }
      const response = await runtime(new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method ?? 'GET', headers,
        ...(body.length ? { body } : {}),
      }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end('{"error":"smoke_runtime_failure"}'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('smoke_listener_unavailable');
  const origin = `http://127.0.0.1:${address.port}/ccc-api`;
  const request = async (path: string, method = 'GET', body?: unknown, user = 'smoke-admin') => {
    const response = await fetch(`${origin}${path}`, { method, headers: {
      authorization: `Bearer ${await token(user)}`, 'content-type': 'application/json',
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: object(await response.json()) };
  };
  const created = await request('/programs', 'POST', { displayName: 'Synthetic smoke program', storageMode: 'supabase_seoul', processingMode: 'external_allowed' });
  check(created.status === 201, `program_create_status_${created.status}`);
  const program = object(created.body.program);
  const id = program.id;
  if (typeof id !== 'string') throw new Error('smoke_program_id_missing');
  const denied = await request('/cases', 'POST', { programId: id }, 'smoke-worker');
  check(denied.status === 409 && denied.body.error === 'program_admission_required', `unconfirmed_denial_status_${denied.status}`);
  const context = await request('/programs');
  check(context.status === 200, 'program_context_failed');
  const copy = object(context.body.admissionCopy);
  const installation = object(context.body.installation);
  const confirmation = { copyVersion: copy.version, copyHash: copy.hash,
    installationPolicyVersion: installation.policyVersion, installationConfigHash: installation.configHash };
  const confirmed = await request(`/programs/${id}`, 'PATCH', { expectedVersion: program.version, confirmation });
  check(confirmed.status === 200 && object(confirmed.body.program).admissionState === 'ready', `confirmation_status_${confirmed.status}`);
  const accepted = await request('/cases', 'POST', { programId: id }, 'smoke-worker');
  check(accepted.status === 201, `admitted_creation_status_${accepted.status}`);
  const stale = await request(`/programs/${id}`, 'PATCH', { expectedVersion: program.version, confirmation });
  check(stale.status === 409, `stale_confirmation_status_${stale.status}`);
  const cross = await request('/programs', 'GET', undefined, 'smoke-other');
  check(cross.status === 403, `cross_org_status_${cross.status}`);
  const foreign = await restricted.forActor({ orgId: otherOrg, actorId: 'smoke-other' })
    .prepare('SELECT id FROM programs WHERE id = ?').bind(id).all();
  check(foreign.results.length === 0, 'restricted_rls_leak');
  console.log(JSON.stringify({ smoke: 'passed', transport: 'loopback-http', database: 'restricted-postgres', auth: 'synthetic-signed-jwt-and-local-jwks', hostedAuth: false,
    checks: { unconfirmedDenial: true, admittedCreation: true, staleConfirmation: true, crossOrgIdentityDenial: true, crossOrgRlsDenial: true } }));
} catch (error) {
  console.error(JSON.stringify({ smoke: 'failed', code: error instanceof Error ? error.message : 'unknown' }));
  process.exitCode = 1;
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await harness.dispose();
}
