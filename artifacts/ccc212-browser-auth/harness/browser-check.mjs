import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
async function observe(page, fn) {
  const cdp = await page.createCDPSession();
  try {
    const value = await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true,
    });
    if (value.exceptionDetails) throw new Error('default_world_observer_failed');
    return value.result.value;
  } finally {
    await cdp.detach();
  }
}
async function ipc(ready, path, body) {
  const old = process.cwd();
  process.chdir(dirname(ready.socketPath));
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        socketPath: 'ccc212-control.sock', path, method: body === undefined ? 'GET' : 'POST',
        headers: { connection: 'close' },
      }, res => {
        const chunks = [];
        res.on('data', value => chunks.push(value));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('fixture_ipc_invalid')); }
        });
      });
      req.on('error', () => reject(new Error('fixture_ipc_unavailable')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } finally {
    process.chdir(old);
  }
}
async function storageSnapshot(page) {
  return observe(page, async () => {
    const entries = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ name, url: request.url, hasAuthorization: request.headers.has('authorization'), body: await response.text() });
      }
    }
    return {
      entries,
      storage: {
        local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie,
        indexedDB: (await indexedDB.databases()).map(database => database.name),
      },
    };
  });
}

export async function run(browser, out) {
  const ready = JSON.parse(readFileSync(join(out, 'browser-ready.json'), 'utf8'));
  const { runtime } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8'));
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const events = [];
  const errors = { pageErrors: 0, consoleErrors: 0 };
  let documentCsp = null;
  let result;
  let stage = 'fresh browser';
  page.on('pageerror', () => { errors.pageErrors += 1; });
  page.on('console', message => { if (message.type() === 'error') errors.consoleErrors += 1; });
  page.on('response', response => {
    const url = new URL(response.url());
    events.push({
      host: url.hostname, path: url.pathname, method: response.request().method(), status: response.status(),
      fromServiceWorker: response.fromServiceWorker(), type: response.request().resourceType(),
    });
    if (url.origin === ready.clientOrigin && response.request().resourceType() === 'document') {
      documentCsp = response.headers()['content-security-policy'] ?? null;
    }
  });
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(ready.clientOrigin + '/settings', { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForSelector('#login-email', { timeout: 20_000 });
    const baseline = await observe(page, async () => ({
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controlled: Boolean(navigator.serviceWorker.controller), cacheCount: (await caches.keys()).length,
      businessShellVisible: Boolean(document.querySelector('#business-navigation')), secureContext: isSecureContext,
    }));
    assert.equal(baseline.registrations, 0);
    assert.equal(baseline.controlled, false);
    assert.equal(baseline.cacheCount, 0);

    const input = await ipc(ready, '/input');
    async function signIn(password) {
      await page.type('#login-email', input.email);
      await page.type('#login-password', password);
      await page.click('form button[type="submit"]');
    }
    stage = 'wrong credential rejection';
    const wrongResponse = page.waitForResponse(response => response.url().startsWith(ready.authOrigin + '/auth/v1/token')
      && response.status() === 400, { timeout: 15_000 });
    await signIn('not-the-seeded-password');
    await wrongResponse;
    await page.waitForSelector('#login-password:not(:disabled)', { timeout: 15_000 });
    const rejected = await observe(page, () => ({
      stillLogin: Boolean(document.querySelector('#login-password')),
      shellAbsent: !document.querySelector('#business-navigation'),
      passwordCleared: document.querySelector('#login-password')?.value === '',
    }));
    assert.equal(rejected.stillLogin && rejected.shellAbsent && rejected.passwordCleared, true);

    stage = 'valid synthetic issuer login';
    await signIn(input.password);
    await page.waitForSelector('#business-navigation', { timeout: 30_000 });
    const readyState = await observe(page, () => ({
      shellVisible: Boolean(document.querySelector('#business-navigation')),
      mfaPromptAbsent: ![...document.querySelectorAll('h1,h2')].some(node => node.textContent?.includes('추가 인증')),
    }));
    assert.equal(readyState.shellVisible && readyState.mfaPromptAbsent, true);

    stage = 'service worker activation';
    const worker = await observe(page, async () => {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('worker_activation_timeout')), 20_000)),
      ]);
      return {
        registrationCount: (await navigator.serviceWorker.getRegistrations()).length,
        scope: registration.scope, activeScript: registration.active?.scriptURL,
        activeState: registration.active?.state, controlled: Boolean(navigator.serviceWorker.controller),
      };
    });
    assert.equal(worker.activeScript, ready.clientOrigin + '/sw.js');
    assert.equal(worker.activeState, 'activated');

    stage = 'authenticated storage scan';
    const authenticatedRaw = await storageSnapshot(page);
    const authenticatedScan = await ipc(ready, '/scan', authenticatedRaw);
    const release = join(runtime, 'release');
    const workerSource = readFileSync(join(release, 'sw.js'), 'utf8');
    const expectedAssets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(workerSource)[1]).sort();
    const cached = authenticatedRaw.entries.map(entry => {
      const url = new URL(entry.url);
      const hash = digest(entry.body);
      let emitted = null;
      try { emitted = digest(readFileSync(join(release, url.pathname))); } catch {}
      return {
        cache: entry.name, path: url.pathname, sameOrigin: url.origin === ready.clientOrigin,
        queryPresent: Boolean(url.search), hasAuthorization: entry.hasAuthorization,
        sha256: hash, matchesReleaseAsset: emitted === hash,
      };
    });
    const authenticatedStorageEmpty = Object.keys(authenticatedRaw.storage.local).length === 0
      && Object.keys(authenticatedRaw.storage.session).length === 0
      && authenticatedRaw.storage.cookies === '' && authenticatedRaw.storage.indexedDB.length === 0;
    assert.equal(authenticatedScan.credentialFound, false);
    assert.equal(authenticatedScan.dynamicCanaryFound, false);
    assert.equal(authenticatedStorageEmpty, true);
    assert.deepEqual(cached.map(row => row.path).sort(), expectedAssets);
    assert.equal(cached.every(row => row.sameOrigin && !row.queryPresent && !row.hasAuthorization && row.matchesReleaseAsset), true);

    stage = 'logout and local clear';
    const clicked = await observe(page, () => {
      const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === '로그아웃');
      button?.click();
      return Boolean(button);
    });
    assert.equal(clicked, true);
    await page.waitForSelector('#login-password', { timeout: 20_000 });
    const loggedOut = await observe(page, () => ({
      loginRequired: Boolean(document.querySelector('#login-password')),
      businessShellAbsent: !document.querySelector('#business-navigation'),
    }));
    const loggedOutRaw = await storageSnapshot(page);
    const loggedOutScan = await ipc(ready, '/scan', loggedOutRaw);
    const loggedOutStorageEmpty = Object.keys(loggedOutRaw.storage.local).length === 0
      && Object.keys(loggedOutRaw.storage.session).length === 0
      && loggedOutRaw.storage.cookies === '' && loggedOutRaw.storage.indexedDB.length === 0;
    assert.equal(loggedOut.loginRequired && loggedOut.businessShellAbsent, true);
    assert.equal(loggedOutScan.credentialFound || loggedOutScan.dynamicCanaryFound, false);
    assert.equal(loggedOutStorageEmpty, true);

    stage = 'reload after logout';
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-password', { timeout: 20_000 });
    const reload = await observe(page, () => ({
      loginRequired: Boolean(document.querySelector('#login-password')),
      businessShellAbsent: !document.querySelector('#business-navigation'),
      controllerScript: navigator.serviceWorker.controller?.scriptURL ?? null,
    }));
    assert.equal(reload.loginRequired && reload.businessShellAbsent, true);

    const server = await ipc(ready, '/evidence');
    assert.equal(server.counts.businessLogout, 1);
    save('browser-storage-lifecycle.json', {
      baseline, wrongCredentials: rejected, optionalCloudMfa: { aal1ReachedBusinessShell: true, promptAbsent: true },
      worker,
      authenticated: {
        storageEmpty: authenticatedStorageEmpty, credentialFound: authenticatedScan.credentialFound,
        piiCanaryFound: authenticatedScan.dynamicCanaryFound, cache: cached,
      },
      logout: {
        ...loggedOut, businessRevocationRequests: server.counts.businessLogout,
        authLogoutRequests: server.counts.authLogout, storageEmpty: loggedOutStorageEmpty,
        credentialFound: loggedOutScan.credentialFound, piiCanaryFound: loggedOutScan.dynamicCanaryFound,
      },
      reloadAfterLogout: reload,
      tokenOrPiiBodiesPersisted: false,
      rawStorageOrResponseBodiesWrittenToEvidence: false,
    });
    save('actual-static-browser-headers.json', {
      headerSource: ready.staticHeaderSource,
      documentStatusObserved: events.some(event => event.host === new URL(ready.clientOrigin).hostname && event.type === 'document' && event.status === 200),
      contentSecurityPolicy: documentCsp,
      cspAllowsSignedApiDescendants: documentCsp?.includes(`${ready.apiBase.replace(/\/$/, '')}/`) ?? false,
      cspAllowsSignedAuthOrigin: documentCsp?.includes(ready.authOrigin) ?? false,
    });
    result = {
      status: 'PASS', credentialValidatingSdkLogin: true, optionalAal1Accepted: true,
      businessRevocationObserved: true, logoutAndReloadRequireLogin: true,
      storageAndCacheBoundaryPassed: true, actualStaticCspObserved: true,
      defaultPageWorld: true, errors,
    };
  } catch (error) {
    result = {
      status: 'FAILED', stage, errorClass: error?.constructor?.name ?? 'Unknown',
      networkCode: String(error?.message).match(/net::[A-Z_]+/)?.[0] ?? null, errors,
    };
  } finally {
    save('browser-network.json', { events, errors, bodiesCaptured: false });
    save('browser-result.json', result);
    const cleared = await observe(page, async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const unregistered = await Promise.all(registrations.map(registration => registration.unregister()));
      const names = await caches.keys();
      const removed = await Promise.all(names.map(name => caches.delete(name)));
      localStorage.clear();
      sessionStorage.clear();
      return {
        unregistered, removed, registrations: (await navigator.serviceWorker.getRegistrations()).length,
        cacheCount: (await caches.keys()).length, localStorageCount: localStorage.length,
        sessionStorageCount: sessionStorage.length, cookies: document.cookie.length,
      };
    }).catch(() => ({ unreachable: true }));
    await context.close();
    save('browser-cleanup.json', { ...cleared, incognitoContextClosed: true, persistedCredentialsProfile: false });
    await ipc(ready, '/finish', {}).catch(() => undefined);
  }
  return result;
}
