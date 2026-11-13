import { it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1TestContext, testActors } from 'fixture-d1';
import { createSupabaseIdentity } from 'fixture-identity';
import { handleRequest } from 'fixture-http';
import { verifiedInstallManifest } from 'fixture-capability-handler';

const harness = dirname(fileURLToPath(import.meta.url));
const out = join(harness, '..');
const { runtime } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8'));
const staticPort = Number(process.env.CCC212_STATIC_PORT);
if (!Number.isInteger(staticPort)) throw new Error('static_release_port_missing');
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

it('runs the bounded real Identity and gateway bridge for CCC-212 browser observations', async () => {
  let context, tls, proxy, control;
  const sockets = new Set();
  const requests = [];
  const counts = {
    passwordAccepted: 0, passwordRejected: 0, userVerified: 0, refreshAccepted: 0,
    jwks: 0, actualApi: 0, businessLogout: 0, authLogout: 0,
    staticReleaseRequests: 0, deniedProxy: 0, runtimeErrors: 0,
  };
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
    const canary = 'ccc212-synthetic-response-canary';
    await context.db.prepare('UPDATE users SET auth_subject = ?, name = ? WHERE id = ?')
      .bind(subject, canary, email).run();
    await context.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?')
      .bind(inactiveSubject, testActors.inactiveCounselor.userId).run();

    const manifest = JSON.parse(readFileSync(join(runtime, 'release/ccc-install-manifest.json'), 'utf8'));
    const publicKeys = JSON.parse(readFileSync(join(runtime, 'release-config.json'), 'utf8')).publicKeys;
    const environment = {
      ...context.env, installationOrgId: testActors.counselor.orgId,
      CCC_INSTALL_MANIFEST: JSON.stringify(manifest), CCC_INSTALL_SIGNING_KEYS: JSON.stringify(publicKeys),
    };
    await verifiedInstallManifest(environment);
    const issuer = manifest.supabaseAuthOrigin + '/auth/v1';
    const jwksUri = issuer + '/.well-known/jwks.json';
    const allowedHosts = new Set([manifest.clientOrigin, manifest.apiBase, manifest.supabaseAuthOrigin].map(url => new URL(url).hostname));
    const jwtPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = { ...await crypto.subtle.exportKey('jwk', jwtPair.publicKey), alg: 'ES256', kid: 'ccc212-synthetic-es256', use: 'sig' };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    async function token(claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      const input = encode({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' }) + '.' + encode({
        iss: issuer, aud: 'authenticated', sub: subject, session_id: randomUUID(), role: 'authenticated',
        is_anonymous: false, aal: 'aal1', email, amr: [{ method: 'password', timestamp: now }],
        iat: now, exp: now + 3600, ...claims,
      });
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, jwtPair.privateKey, new TextEncoder().encode(input));
      const value = input + '.' + Buffer.from(signature).toString('base64url');
      privateMarkers.push(value);
      return value;
    }
    const user = {
      id: subject, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, factors: [],
    };
    const refreshTokens = new Set();
    async function session() {
      const refresh = randomBytes(32).toString('base64url');
      refreshTokens.add(refresh);
      privateMarkers.push(refresh);
      return {
        access_token: await token(), refresh_token: refresh, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user,
      };
    }

    const tlsPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tlsKey = tlsPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
    const cert = execFileSync('openssl', ['req', '-new', '-x509', '-key', '/dev/stdin', '-subj', '/CN=ccc212-synthetic-only', '-days', '1',
      '-addext', 'subjectAltName=' + [...allowedHosts].map(host => 'DNS:' + host).join(','), '-addext', 'extendedKeyUsage=serverAuth'], { input: tlsKey });
    const spki = createHash('sha256').update(tlsPair.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
    let tlsPort;

    function localFetch(input, init = {}) {
      const url = new URL(String(input));
      if (url.protocol !== 'https:' || url.port || !allowedHosts.has(url.hostname) || url.username || url.password || url.hash) {
        throw new Error('fixture_destination_denied');
      }
      return new Promise((resolve, reject) => {
        const req = httpsRequest(url, {
          hostname: '127.0.0.1', port: tlsPort, servername: url.hostname, ca: cert,
          method: init.method ?? 'GET', headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host }, signal: init.signal,
        }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const response = new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers });
            Object.defineProperty(response, 'url', { value: url.href });
            resolve(response);
          });
        });
        req.on('error', () => reject(new Error('fixture_local_tls_failed')));
        req.end(init.body);
      });
    }

    function staticRelease(request) {
      const url = new URL(request.url);
      return new Promise((resolve, reject) => {
        const req = httpRequest({
          hostname: '127.0.0.1', port: staticPort, path: url.pathname + url.search,
          method: request.method, headers: Object.fromEntries(request.headers),
        }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            counts.staticReleaseRequests += 1;
            resolve(new Response(request.method === 'HEAD' ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }));
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    const identity = createSupabaseIdentity(environment, {
      issuer, jwksUri,
      fetch: async (input, init) => {
        assert.equal(String(input), jwksUri);
        assert.equal(init.redirect, 'error');
        return localFetch(input, init);
      },
    });

    async function auth(request) {
      const url = new URL(request.url);
      if (url.pathname === '/auth/v1/.well-known/jwks.json' && request.method === 'GET') {
        counts.jwks += 1;
        return json({ keys: [jwk] });
      }
      if (request.headers.get('apikey') !== manifest.supabasePublishableKey) return json({ code: 'bad_jwt' }, 401);
      if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
        const body = await request.json();
        if (url.searchParams.get('grant_type') === 'password') {
          const matches = typeof body.password === 'string'
            && timingSafeEqual(createHash('sha256').update(body.password).digest(), passwordHash);
          if (body.email !== email || !matches) {
            counts.passwordRejected += 1;
            return json({ code: 'invalid_credentials' }, 400);
          }
          counts.passwordAccepted += 1;
          return json(await session());
        }
        if (url.searchParams.get('grant_type') === 'refresh_token' && refreshTokens.delete(body.refresh_token)) {
          counts.refreshAccepted += 1;
          return json(await session());
        }
        return json({ code: 'invalid_credentials' }, 400);
      }
      if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
        try {
          const actor = await identity.resolve(request);
          if (actor.userId !== email) return json({ code: 'bad_jwt' }, 401);
        } catch {
          return json({ code: 'bad_jwt' }, 401);
        }
        counts.userVerified += 1;
        return json(user);
      }
      if (url.pathname === '/auth/v1/logout' && request.method === 'POST') {
        counts.authLogout += 1;
        return new Response(null, { status: 204 });
      }
      return json({ code: 'not_found' }, 404);
    }

    async function dispatch(request) {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (!allowedHosts.has(url.hostname)) return json({ error: 'forbidden' }, 403);
      if (url.origin === manifest.clientOrigin) return staticRelease(request);
      if (origin !== null && !manifest.allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403);
      if (request.method === 'OPTIONS') {
        const authOrigin = url.origin === manifest.supabaseAuthOrigin;
        const allowedHeaders = authOrigin
          ? ['apikey', 'authorization', 'content-type', 'x-client-info', 'x-supabase-api-version']
          : ['authorization', 'content-type', 'x-request-id'];
        const requested = (request.headers.get('access-control-request-headers') ?? '').toLowerCase()
          .split(',').map(value => value.trim()).filter(Boolean);
        if (origin !== manifest.clientOrigin || !['GET', 'POST'].includes(request.headers.get('access-control-request-method'))
          || requested.some(value => !allowedHeaders.includes(value))) return json({ error: 'forbidden' }, 403);
        return new Response(null, { status: 204, headers: {
          'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': allowedHeaders.join(', '), vary: 'Origin',
        } });
      }
      if (url.origin === manifest.supabaseAuthOrigin) return auth(request);
      if (url.origin === new URL(manifest.apiBase).origin) {
        if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
        if (url.pathname === '/api/auth/logout') counts.businessLogout += 1;
        url.pathname = url.pathname.slice(4);
        counts.actualApi += 1;
        return handleRequest(new Request(url, request), environment, credential => identity.resolve(credential));
      }
      return json({ error: 'not_found' }, 404);
    }

    tls = httpsServer({ key: tlsKey, cert }, async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request('https://' + req.headers.host + req.url, {
          method: req.method, headers: req.headers,
          ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        });
        const response = await dispatch(request);
        const url = new URL(request.url);
        if (url.origin !== manifest.clientOrigin) {
          const origin = request.headers.get('origin');
          if (origin === manifest.clientOrigin) {
            response.headers.set('access-control-allow-origin', origin);
            response.headers.set('access-control-expose-headers', 'X-CCC-Installation-Id');
            response.headers.set('vary', 'Origin');
          }
          response.headers.set('cache-control', 'no-store');
        }
        requests.push({ host: url.hostname, path: url.pathname, method: req.method, status: response.status,
          headerSource: url.origin === manifest.clientOrigin ? 'actual-static-release' : 'fixture-authored-cors' });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        counts.runtimeErrors += 1;
        res.writeHead(500, { 'cache-control': 'no-store' });
        res.end();
      }
    });
    await listen(tls, { host: '127.0.0.1', port: 0 });
    tlsPort = tls.address().port;

    proxy = httpServer((req, res) => { counts.deniedProxy += 1; res.writeHead(403); res.end(); });
    proxy.on('connect', (req, client, head) => {
      if (![...allowedHosts].some(host => req.url === host + ':443')) {
        counts.deniedProxy += 1;
        client.destroy();
        return;
      }
      const upstream = connect(tlsPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.on('error', () => socket.destroy());
        socket.on('close', () => sockets.delete(socket));
      }
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await listen(proxy, { host: '127.0.0.1', port: 0 });

    const directToken = await token();
    const direct = async (value, originValue = manifest.clientOrigin) => localFetch(manifest.apiBase + '/me', {
      headers: { ...(value ? { authorization: 'Bearer ' + value } : {}), origin: originValue },
    });
    const valid = await direct(directToken);
    const missing = await direct(null);
    const wrongOrigin = await direct(directToken, 'https://untrusted.invalid');
    save('real-bridge-controls.json', {
      validLinkedWorkerStatus: valid.status, missingBearerStatus: missing.status,
      wrongOriginStatus: wrongOrigin.status, actualHandlers: true,
    });
    assert.equal(valid.status, 200);
    assert.equal(missing.status, 401);
    assert.equal(wrongOrigin.status, 403);

    control = httpServer(async (req, res) => {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/input') { res.end(JSON.stringify({ email, password })); return; }
      if (req.method === 'POST' && req.url === '/scan') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const value = Buffer.concat(chunks).toString();
        res.end(JSON.stringify({
          credentialFound: privateMarkers.some(marker => value.includes(marker)),
          dynamicCanaryFound: value.includes(canary),
        }));
        return;
      }
      if (req.method === 'GET' && req.url === '/evidence') { res.end(JSON.stringify({ counts, requests })); return; }
      if (req.method === 'POST' && req.url === '/finish') { res.end('{}'); finished(); return; }
      res.writeHead(404);
      res.end('{}');
    });
    const socketPath = join(runtime, 'ccc212-control.sock');
    process.chdir(runtime);
    rmSync('ccc212-control.sock', { force: true });
    await listen(control, 'ccc212-control.sock');
    chmodSync('ccc212-control.sock', 0o600);
    save('browser-ready.json', {
      clientOrigin: manifest.clientOrigin, apiBase: manifest.apiBase, authOrigin: manifest.supabaseAuthOrigin,
      tlsPort, proxyPort: proxy.address().port, socketPath, spki, issuer, jwksUri,
      staticReleasePort: staticPort, staticHeaderSource: 'apps/client/tools/serve-release.mjs via Deno runtime',
      installPublicKeyFingerprints: Object.fromEntries(Object.entries(publicKeys).map(([id, key]) => [id, sha(Buffer.from(key, 'base64'))])),
      jwtPublicKeyFingerprint: sha(JSON.stringify(jwk)), privateKeysAndTokensPersisted: false,
    });
    console.log('CCC212_FIXTURE_READY');
    await finish;
    save('browser-server-evidence.json', { counts, requests, seededAccounts: 1, privateKeysAndTokensPersisted: false });
  } catch (error) {
    save('browser-runtime-failure.json', { errorClass: error?.constructor?.name ?? 'Unknown', code: /^[a-z_]+$/.test(error?.code ?? '') ? error.code : null });
    throw new Error('ccc212_fixture_failed_see_sanitized_evidence');
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of [control, proxy, tls]) if (server?.listening) await close(server);
    if (context) await context.dispose();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    save('browser-fixture-cleanup.json', { servicesClosed: true, databaseDisposed: Boolean(context), secretsMemoryOnly: true });
  }
});
