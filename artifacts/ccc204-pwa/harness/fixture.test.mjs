import { it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1TestContext, testActors } from 'fixture-d1';
import { createTestSigner, signedManifest } from 'fixture-install';
import { createSupabaseIdentity } from 'fixture-identity';
import { handleRequest } from 'fixture-http';
import { verifiedInstallManifest } from 'fixture-capabilities';

const out = dirname(fileURLToPath(import.meta.url));
const { snapshot, runtime } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8'));
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const listen = (server, address) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(address, () => { server.off('error', reject); resolve(); });
});
const close = server => new Promise(resolve => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

it('runs the bounded synthetic issuer and real Identity HTTP bridge until evidence collection finishes', async () => {
  let context, tls, proxy, control;
  const sockets = new Set();
  const requests = [];
  const counts = { passwordAccepted: 0, passwordRejected: 0, userVerified: 0, refreshAccepted: 0, jwks: 0, actualApi: 0, deniedProxy: 0, externalConnections: 0, runtimeErrors: 0 };
  let finished;
  const finish = new Promise(resolve => { finished = resolve; });
  const stop = () => finished();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    context = await createD1TestContext();
    const subject = randomUUID();
    const inactiveSubject = randomUUID();
    const email = testActors.counselor.userId;
    const password = randomBytes(32).toString('base64url');
    const passwordHash = createHash('sha256').update(password).digest();
    const privateMarkers = [password];
    await context.db.prepare('UPDATE users SET auth_subject = ?, name = ? WHERE id = ?')
      .bind(subject, 'ccc204-synthetic-response-canary', email).run();
    await context.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?')
      .bind(inactiveSubject, testActors.inactiveCounselor.userId).run();
    const signer = await createTestSigner();
    const manifest = await signedManifest(signer, 'community-cloud');
    const environment = { ...context.env, installationOrgId: testActors.counselor.orgId,
      CCC_INSTALL_MANIFEST: JSON.stringify(manifest), CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys) };
    await verifiedInstallManifest(environment);
    const issuer = manifest.supabaseAuthOrigin + '/auth/v1';
    const jwksUri = issuer + '/.well-known/jwks.json';
    const allowedHosts = new Set([manifest.clientOrigin, manifest.apiBase, manifest.supabaseAuthOrigin].map(url => new URL(url).hostname));
    const jwtPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = { ...await crypto.subtle.exportKey('jwk', jwtPair.publicKey), alg: 'ES256', kid: 'ccc204-synthetic-es256', use: 'sig' };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    async function token(claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      const input = encode({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' }) + '.' + encode({
        iss: issuer, aud: 'authenticated', sub: subject, session_id: randomUUID(), role: 'authenticated',
        is_anonymous: false, aal: 'aal1', email, amr: [{ method: 'password', timestamp: now }], iat: now, exp: now + 3600, ...claims,
      });
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, jwtPair.privateKey, new TextEncoder().encode(input));
      const value = input + '.' + Buffer.from(signature).toString('base64url');
      privateMarkers.push(value);
      return value;
    }
    const user = { id: subject, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, factors: [] };
    const refreshTokens = new Set();
    async function session() {
      const refresh = randomBytes(32).toString('base64url');
      refreshTokens.add(refresh); privateMarkers.push(refresh);
      return { access_token: await token(), refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    }
    // Only this runtime trusts this ephemeral TLS key. No filesystem key or global trust changes.
    const tlsPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tlsKey = tlsPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
    const cert = execFileSync('openssl', ['req', '-new', '-x509', '-key', '/dev/stdin', '-subj', '/CN=ccc204-synthetic-only', '-days', '1',
      '-addext', 'subjectAltName=' + [...allowedHosts].map(host => 'DNS:' + host).join(','), '-addext', 'extendedKeyUsage=serverAuth'], { input: tlsKey });
    const spki = createHash('sha256').update(tlsPair.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
    let tlsPort;
    // Preserve logical URL, Host and TLS servername; only TCP destination is process-local.
    function localFetch(input, init = {}) {
      const url = new URL(String(input));
      if (url.protocol !== 'https:' || url.port || !allowedHosts.has(url.hostname) || url.username || url.password || url.hash) throw Error('fixture_destination_denied');
      return new Promise((resolve, reject) => {
        const req = httpsRequest(url, { hostname: '127.0.0.1', port: tlsPort, servername: url.hostname, ca: cert,
          method: init.method ?? 'GET', headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host }, signal: init.signal }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const response = new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers });
            Object.defineProperty(response, 'url', { value: url.href });
            resolve(response);
          });
        });
        req.on('error', () => reject(Error('fixture_local_tls_failed')));
        req.end(init.body);
      });
    }
    const identity = createSupabaseIdentity(environment, { issuer, jwksUri, fetch: async (input, init) => {
      assert.equal(String(input), jwksUri); assert.equal(init.redirect, 'error');
      return localFetch(input, init);
    } });
    async function auth(request) {
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/.well-known/jwks.json' && request.method === 'GET') { counts.jwks++; return json({ keys: [jwk] }); }
      if (request.headers.get('apikey') !== manifest.supabasePublishableKey) return json({ code: 'bad_jwt' }, 401);
      if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
        const body = await request.json();
        if (url.searchParams.get('grant_type') === 'password') {
          const matches = typeof body.password === 'string' && timingSafeEqual(createHash('sha256').update(body.password).digest(), passwordHash);
          if (body.email !== email || !matches) { counts.passwordRejected++; return json({ code: 'invalid_credentials' }, 400); }
          counts.passwordAccepted++; return json(await session());
        }
        if (url.searchParams.get('grant_type') === 'refresh_token' && refreshTokens.delete(body.refresh_token)) {
          counts.refreshAccepted++; return json(await session());
        }
        return json({ code: 'invalid_credentials' }, 400);
      }
      if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
        try { const actor = await identity.resolve(request); if (actor.userId !== email) return json({ code: 'bad_jwt' }, 401); }
        catch { return json({ code: 'bad_jwt' }, 401); }
        counts.userVerified++; return json(user);
      }
      return json({ code: 'not_found' }, 404);
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const dist = join(snapshot, 'apps/client/dist');
    const assets = {};
    async function dispatch(request) {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (!allowedHosts.has(url.host)) return json({ error: 'forbidden' }, 403);
      if (origin !== null && !manifest.allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403);
      if (request.method === 'OPTIONS') {
        const authOrigin = url.origin === manifest.supabaseAuthOrigin;
        const allowedHeaders = authOrigin ? ['apikey', 'authorization', 'content-type', 'x-client-info', 'x-supabase-api-version'] : ['authorization', 'content-type', 'x-request-id'];
        const requested = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (origin !== manifest.clientOrigin || !['GET', 'POST'].includes(request.headers.get('access-control-request-method')) || requested.some(x => !allowedHeaders.includes(x))) return json({ error: 'forbidden' }, 403);
        return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': allowedHeaders.join(', '), vary: 'Origin' } });
      }
      if (url.origin === manifest.supabaseAuthOrigin) return auth(request);
      if (url.origin === new URL(manifest.apiBase).origin) {
        if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
        url.pathname = url.pathname.slice(4);
        counts.actualApi++;
        return handleRequest(new Request(url, request), environment, credential => identity.resolve(credential));
      }
      if (request.method !== 'GET') return json({ error: 'not_found' }, 404);
      if (url.pathname === '/ccc-install-manifest.json') return json(manifest);
      if (url.pathname === '/ccc-bootstrap.json') return json({ mode: manifest.mode, apiBase: manifest.apiBase });
      const asset = assets[url.pathname] ?? (request.headers.get('accept')?.includes('text/html') ? assets['/index.html'] : undefined);
      if (!asset) return json({ error: 'not_found' }, 404);
      const headers = { 'content-type': asset.type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': `default-src 'self'; script-src 'self'; connect-src 'self' ${manifest.apiBase}/ ${manifest.supabaseAuthOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; form-action 'self'` };
      return new Response(asset.bytes, { headers });
    }
    tls = httpsServer({ key: tlsKey, cert }, async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request('https://' + req.headers.host + req.url, { method: req.method, headers: req.headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
        const response = await dispatch(request);
        const origin = request.headers.get('origin');
        if (origin === manifest.clientOrigin) { response.headers.set('access-control-allow-origin', origin); response.headers.set('access-control-expose-headers', 'X-CCC-Installation-Id'); response.headers.set('vary', 'Origin'); }
        response.headers.set('cache-control', 'no-store');
        const url = new URL(request.url);
        requests.push({ host: url.hostname, path: url.pathname, method: req.method, status: response.status });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      } catch { counts.runtimeErrors++; res.writeHead(500, { 'cache-control': 'no-store' }); res.end(); }
    });
    await listen(tls, { host: '127.0.0.1', port: 0 }); tlsPort = tls.address().port;
    proxy = httpServer((req, res) => { counts.deniedProxy++; res.writeHead(403); res.end(); });
    proxy.on('connect', (req, client, head) => {
      if (![...allowedHosts].some(host => req.url === host + ':443')) { counts.deniedProxy++; client.destroy(); return; }
      const upstream = connect(tlsPort, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
      for (const socket of [client, upstream]) { sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); }
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
    });
    await listen(proxy, { host: '127.0.0.1', port: 0 });

    const api = async (value, path = '/me', origin = manifest.clientOrigin) => localFetch(manifest.apiBase + path, { headers: { ...(value ? { authorization: 'Bearer ' + value } : {}), origin } });
    const controlRows = [];
    const good = await token();
    const bits = good.split('.'); const changed = Buffer.from(bits[2], 'base64url'); changed[0] ^= 1;
    const vectors = [
      ['valid-linked-worker', good, 200], ['missing-bearer', null, 401],
      ['tampered-signature', bits[0] + '.' + bits[1] + '.' + changed.toString('base64url'), 401],
      ['unlinked-subject', await token({ sub: randomUUID() }), 403], ['inactive-subject', await token({ sub: inactiveSubject }), 403],
      ['wrong-issuer', await token({ iss: 'https://other.supabase.co/auth/v1' }), 401],
      ['wrong-audience', await token({ aud: 'service_role' }), 401],
      ['expired-token', await token({ iat: Math.floor(Date.now() / 1000) - 4000, exp: Math.floor(Date.now() / 1000) - 400 }), 401],
      ['empty-session-id', await token({ session_id: '' }), 401],
    ];
    for (const [name, value, expectedStatus] of vectors) {
      const response = await api(value); const body = await response.json();
      controlRows.push({ name, status: response.status, expectedStatus, passed: response.status === expectedStatus,
        ...(name === 'valid-linked-worker' ? { linkedWorker: body.id === email && body.roles?.join(',') === 'worker', responseCanaryPresent: body.name === 'ccc204-synthetic-response-canary' } : {}) });
    }
    const roleResponse = await api(await token({ email: testActors.admin.userId, app_metadata: { roles: ['institution-admin'] } }), '/settings/accounts');
    controlRows.push({ name: 'token-role-escalation', status: roleResponse.status, expectedStatus: 403, passed: roleResponse.status === 403 });
    const originResponse = await api(good, '/me', 'https://untrusted.invalid');
    controlRows.push({ name: 'untrusted-browser-origin', status: originResponse.status, expectedStatus: 403, passed: originResponse.status === 403 });
    const cap = await api(good, '/capabilities');
    const capability = await cap.json();
    controlRows.push({ name: 'real-capabilities-installation-binding', status: cap.status, expectedStatus: 200,
      passed: cap.status === 200 && cap.headers.get('x-ccc-installation-id') === manifest.installationId && capability.sttMode === 'off' && capability.sttEngine === null && capability.llmMode === 'off' });
    const wrong = await localFetch(issuer + '/token?grant_type=password', { method: 'POST', headers: { apikey: manifest.supabasePublishableKey, 'content-type': 'application/json', origin: manifest.clientOrigin }, body: JSON.stringify({ email, password: 'not-the-seeded-password' }) });
    controlRows.push({ name: 'wrong-seeded-password', status: wrong.status, expectedStatus: 400, passed: wrong.status === 400 });
    save('negative-controls.json', { controls: controlRows, actualHandlers: true, noFixedMeOrCapabilities: true });
    assert.equal(controlRows.every(row => row.passed && row.linkedWorker !== false), true, 'fixture_controls_failed');

    const buildStartedAt = new Date().toISOString();
    const buildOutput = execFileSync(process.execPath, [join(out, '..', 'build.mjs'), out], {
      cwd: snapshot,
      env: { ...process.env, NODE_ENV: 'production', VITE_CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys) },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    save('build-command.json', { command: 'node ../build.mjs <owned-evidence-dir>', nodeEnv: 'production',
      exitCode: 0, stdoutSha256: sha(buildOutput), priorBuildProbeReused: true });
    function collect(dir) { for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) collect(path);
      else { const route = '/' + relative(dist, path); const bytes = readFileSync(path); assets[route] = { bytes, type: mime['.' + name.split('.').at(-1)] ?? 'application/octet-stream' }; }
    } }
    collect(dist);
    save('build.json', { startedAt: buildStartedAt, finishedAt: new Date().toISOString(), exitCode: 0, publicTrustOnly: true,
      assets: Object.fromEntries(Object.entries(assets).map(([path, asset]) => [path, { sha256: sha(asset.bytes), bytes: asset.bytes.length }])) });
    // A permission-restricted local control socket supplies credentials directly to browser automation memory.
    control = httpServer(async (req, res) => {
      res.setHeader('cache-control', 'no-store'); res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/input') { res.end(JSON.stringify({ email, password })); return; }
      if (req.method === 'POST' && req.url === '/scan') {
        const chunks = []; for await (const c of req) chunks.push(c);
        const value = Buffer.concat(chunks).toString();
        res.end(JSON.stringify({ credentialFound: privateMarkers.some(marker => value.includes(marker)), dynamicCanaryFound: value.includes('ccc204-synthetic-response-canary') })); return;
      }
      if (req.method === 'GET' && req.url === '/evidence') { res.end(JSON.stringify({ counts, requests })); return; }
      if (req.method === 'POST' && req.url === '/finish') { res.end('{}'); finished(); return; }
      res.writeHead(404); res.end('{}');
    });
    const socketPath = join(runtime, 'control.sock');
    // macOS AF_UNIX paths are limited; the socket itself stays inside the owned runtime.
    process.chdir(runtime);
    rmSync('control.sock', { force: true });
    await listen(control, 'control.sock'); chmodSync('control.sock', 0o600);
    save('ready.json', { clientOrigin: manifest.clientOrigin, apiBase: manifest.apiBase, authOrigin: manifest.supabaseAuthOrigin,
      tlsPort, proxyPort: proxy.address().port, socketPath, spki, issuer, jwksUri,
      installPublicKeyFingerprints: Object.fromEntries(Object.entries(signer.publicKeys).map(([id, key]) => [id, sha(Buffer.from(key, 'base64'))])),
      jwtPublicKeyFingerprint: sha(JSON.stringify(jwk)), privateKeysAndTokensPersisted: false });
    console.log('CCC204_FIXTURE_READY');
    await finish;
    save('server-evidence.json', { counts, requests, seededAccounts: 1, privateKeysAndTokensPersisted: false });
  } catch (error) {
    save('runtime-failure.json', { errorClass: error?.constructor?.name ?? 'Unknown', code: /^[a-z_]+$/.test(error?.code ?? '') ? error.code : null });
    throw Error('ccc204_fixture_failed_see_sanitized_evidence');
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of [control, proxy, tls]) if (server?.listening) await close(server);
    if (context) await context.dispose();
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    save('fixture-cleanup.json', { servicesClosed: true, databaseDisposed: Boolean(context), secretsMemoryOnly: true });
  }
});
