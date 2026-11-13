import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Execute observations in the default page world, not the tool's isolated world.
async function observe(page, fn) {
  const cdp = await page.createCDPSession();
  try {
    const value = await cdp.send('Runtime.evaluate', { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw Error('default_world_observer_failed');
    return value.result.value;
  } finally { await cdp.detach(); }
}
async function loaderId(page) {
  const cdp = await page.createCDPSession();
  try { return (await cdp.send('Page.getFrameTree')).frameTree.frame.loaderId; }
  finally { await cdp.detach(); }
}
async function ipc(ready, path, body) {
  const old = process.cwd();
  process.chdir(dirname(ready.socketPath));
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ socketPath: 'control.sock', path, method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close' } }, res => {
        const chunks = []; res.on('data', x => chunks.push(x));
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(Error('fixture_ipc_invalid')); } });
      });
      req.on('error', () => reject(Error('fixture_ipc_unavailable')));
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } finally { process.chdir(old); }
}

export async function run(browser, out) {
  const ready = JSON.parse(readFileSync(join(out, 'ready.json'), 'utf8'));
  const build = JSON.parse(readFileSync(join(out, 'build.json'), 'utf8'));
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const events = [];
  const canaryTasks = [];
  const errors = { pageErrors: 0, consoleErrors: 0 };
  let actualMeCanaryObserved = false;
  let stage = 'fresh browser';
  let result;
  page.on('pageerror', () => { errors.pageErrors++; });
  page.on('console', message => { if (message.type() === 'error') errors.consoleErrors++; });
  page.on('response', response => {
    const url = new URL(response.url());
    events.push({ host: url.hostname, path: url.pathname, method: response.request().method(), status: response.status(),
      fromServiceWorker: response.fromServiceWorker(), type: response.request().resourceType() });
    if (url.origin === new URL(ready.apiBase).origin && url.pathname === '/api/me' && response.status() === 200) {
      canaryTasks.push(response.text().then(body => { actualMeCanaryObserved ||= body.includes('ccc204-synthetic-response-canary'); }).catch(() => {}));
    }
  });
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(ready.clientOrigin + '/settings', { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForSelector('#login-email', { timeout: 20_000 });
    const baseline = await observe(page, async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controlled: Boolean(navigator.serviceWorker.controller), cacheCount: (await caches.keys()).length,
      businessShellVisible: Boolean(document.querySelector('#business-navigation')), secureContext: isSecureContext }));
    save('browser-baseline.json', baseline);
    assert.equal(baseline.registrations, 0); assert.equal(baseline.controlled, false); assert.equal(baseline.cacheCount, 0);
    const input = await ipc(ready, '/input');
    async function signIn(password) {
      await page.type('#login-email', input.email);
      await page.type('#login-password', password);
      await page.click('form button[type="submit"]');
    }
    stage = 'wrong credential UI rejection';
    const wrongResponse = page.waitForResponse(response => response.url().startsWith(ready.authOrigin + '/auth/v1/token') && response.status() === 400, { timeout: 15_000 });
    await signIn('not-the-seeded-password');
    await wrongResponse;
    await page.waitForSelector('#login-password:not(:disabled)', { timeout: 15_000 });
    const rejected = await observe(page, () => ({ stillLogin: Boolean(document.querySelector('#login-password')), shellAbsent: !document.querySelector('#business-navigation'), passwordCleared: document.querySelector('#login-password')?.value === '' }));
    save('browser-wrong-credentials.json', rejected);
    assert.equal(rejected.stillLogin && rejected.shellAbsent && rejected.passwordCleared, true);

    stage = 'valid credential real SDK session';
    await signIn(input.password);
    await page.waitForSelector('#business-navigation', { timeout: 30_000 });
    const initialLoader = await loaderId(page);
    stage = 'natural worker activation';
    const worker = await observe(page, async () => {
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(Error('worker_activation_timeout')), 20_000))]);
      return { registrationCount: (await navigator.serviceWorker.getRegistrations()).length, scope: registration.scope,
        activeScript: registration.active?.scriptURL, activeState: registration.active?.state,
        controllerBeforeReload: Boolean(navigator.serviceWorker.controller), businessShellVisible: Boolean(document.querySelector('#business-navigation')) };
    });
    const serverAtActivation = await ipc(ready, '/evidence');
    save('natural-registration.json', { registrationMode: 'UNCHANGED_APPLICATION_ONLY', defaultPageWorld: true, manualRegisterCalls: 0, injectedAppState: false,
      worker, swRequestObserved: serverAtActivation.requests.some(e => e.host === new URL(ready.clientOrigin).hostname && e.path === '/sw.js' && e.status === 200),
      emittedWorkerSha256: build.assets['/sw.js'].sha256 });
    assert.equal(worker.activeState, 'activated'); assert.equal(worker.activeScript, ready.clientOrigin + '/sw.js');
    stage = 'business route navigation';
    await page.click('nav a[href="/schedule"]');
    await page.waitForFunction(() => location.pathname === '/schedule');
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 20_000 });
    const navigation = await observe(page, () => ({ path: location.pathname, businessShellVisible: Boolean(document.querySelector('#business-navigation')),
      activeScheduleLink: document.querySelector('nav a[href="/schedule"]')?.getAttribute('aria-current') === 'page' }));
    navigation.documentPreserved = initialLoader === await loaderId(page);
    assert.equal(navigation.path, '/schedule'); assert.equal(navigation.documentPreserved, true); assert.equal(navigation.businessShellVisible, true);
    // The business route has no account fields or credential form in this screenshot.
    await page.screenshot({ path: join(out, 'business-route.png'), fullPage: false });
    stage = 'reload and memory-only authentication boundary';
    const beforeReload = await loaderId(page);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-password', { timeout: 20_000 });
    const reloaded = await observe(page, () => ({ path: location.pathname, loginRequired: Boolean(document.querySelector('#login-password')),
      businessShellAbsent: !document.querySelector('#business-navigation'), controllerScript: navigator.serviceWorker.controller?.scriptURL,
      controllerState: navigator.serviceWorker.controller?.state }));
    reloaded.newDocument = beforeReload !== await loaderId(page);
    save('routing.json', { navigation, reload: reloaded });
    assert.equal(reloaded.newDocument && reloaded.loginRequired && reloaded.businessShellAbsent, true);
    assert.equal(reloaded.controllerScript, ready.clientOrigin + '/sw.js'); assert.equal(reloaded.controllerState, 'activated');
    stage = 'reauthentication under natural controller';
    await signIn(input.password);
    await page.waitForSelector('#business-navigation', { timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 20_000 });
    await Promise.all(canaryTasks);
    stage = 'natural cache and credential boundary';
    // Raw cache/storage contents never leave runtime memory or enter an artifact/tool result.
    const raw = await observe(page, async () => {
      const entries = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          entries.push({ name, url: request.url, hasAuthorization: request.headers.has('authorization'), body: await response.text() });
        }
      }
      const storage = { local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie,
        indexedDB: (await indexedDB.databases()).map(db => db.name) };
      return { entries, storage };
    });
    const scan = await ipc(ready, '/scan', raw);
    const cached = raw.entries.map(entry => { const url = new URL(entry.url); const hash = digest(entry.body); return {
      cache: entry.name, path: url.pathname, sameOrigin: url.origin === ready.clientOrigin, queryPresent: Boolean(url.search),
      hasAuthorization: entry.hasAuthorization, sha256: hash, matchesEmittedAsset: build.assets[url.pathname]?.sha256 === hash,
    }; });
    // The emitted worker's own allow-list is the contract, not every file the build wrote.
    const workerSource = readFileSync(join(dirname(ready.socketPath), 'source/apps/client/dist/sw.js'), 'utf8');
    const expectedAssets = JSON.parse(/const ASSETS = (\[[^\]]*\]);/.exec(workerSource)[1]).sort();
    const observedAssets = cached.map(row => row.path).sort();
    const storageEmpty = Object.keys(raw.storage.local).length === 0 && Object.keys(raw.storage.session).length === 0 && raw.storage.cookies === '' && raw.storage.indexedDB.length === 0;
    const cacheEvidence = { entries: cached, onlyEmittedAssets: JSON.stringify(expectedAssets) === JSON.stringify(observedAssets),
      credentialFound: scan.credentialFound, dynamicCanaryFound: scan.dynamicCanaryFound, actualMeCanaryObserved, storageEmpty,
      localStorageCount: Object.keys(raw.storage.local).length, sessionStorageCount: Object.keys(raw.storage.session).length, indexedDBCount: raw.storage.indexedDB.length };
    save('cache.json', cacheEvidence);
    assert.equal(cacheEvidence.onlyEmittedAssets && cached.every(row => row.sameOrigin && row.matchesEmittedAsset && !row.queryPresent && !row.hasAuthorization), true);
    assert.equal(scan.credentialFound || scan.dynamicCanaryFound, false); assert.equal(actualMeCanaryObserved && storageEmpty, true);
    result = { status: 'PASS', naturalRegistration: true, activatedController: true, businessNavigation: true, reloadRequiresLogin: true,
      credentialValidatingSdkLogin: true, wrongCredentialsRejected: true, cacheStaticOnly: true, defaultPageWorld: true, errors };
  } catch (error) {
    result = { status: 'FAILED', stage, errorClass: error?.constructor?.name ?? 'Unknown',
      networkCode: String(error?.message).match(/net::[A-Z_]+/)?.[0] ?? null, errors };
  } finally {
    save('browser-network.json', { events, errors });
    save('browser-result.json', result);
    const server = await ipc(ready, '/evidence'); save('server-observed.json', server);
    const cleared = await observe(page, async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const unregistered = await Promise.all(registrations.map(registration => registration.unregister()));
      const names = await caches.keys(); const removed = await Promise.all(names.map(name => caches.delete(name)));
      return { unregistered, removed, registrations: (await navigator.serviceWorker.getRegistrations()).length, cacheCount: (await caches.keys()).length };
    }).catch(() => ({ unreachable: true }));
    await context.close();
    save('browser-cleanup.json', { ...cleared, incognitoContextClosed: true, persistedCredentialsProfile: false });
  }
  return result;
}
