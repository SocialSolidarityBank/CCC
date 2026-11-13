// The harness's isolated evaluate world bypasses service-worker fetches.
// Default-context CDP execution is required for real page network behavior.
export async function mainEvaluate(page, fn, ...args) {
  const cdp = await page.createCDPSession();
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`,
      awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  } finally { await cdp.detach(); }
}

export async function cacheSnapshot(page) {
  return mainEvaluate(page, async () => {
    const cachesObserved = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const entries = [];
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        const response = await cache.match(request);
        const body = await response.text();
        entries.push({
          pathname: url.pathname, queryPresent: Boolean(url.search), hashPresent: Boolean(url.hash),
          authorizationHeaderPresent: request.headers.has('authorization'), status: response.status,
          contentType: response.headers.get('content-type'),
          syntheticResponseCanaryPresent: body.includes('ccc204-synthetic-response-canary'),
          syntheticCredentialCanaryPresent: body.includes('ccc204-synthetic-credential-canary'),
        });
      }
      cachesObserved.push({ name, entries });
    }
    return { caches: cachesObserved, localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage), indexedDBNames: (await indexedDB.databases()).map(x => x.name), cookiePresent: document.cookie !== '' };
  });
}

export async function registerAndProbe(page) {
  const network = [];
  const onResponse = response => network.push({ pathname: new URL(response.url()).pathname, status: response.status(), fromServiceWorker: response.fromServiceWorker(), resourceType: response.request().resourceType() });
  page.on('response', onResponse);
  await page.setCacheEnabled(false);
  await page.goto('http://127.0.0.1:46173/welcome', { waitUntil: 'networkidle0' });
  const before = await mainEvaluate(page, async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).length, controlled: Boolean(navigator.serviceWorker.controller) }));
  const registered = await mainEvaluate(page, async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, activeScript: registration.active?.scriptURL, activeState: registration.active?.state, waiting: Boolean(registration.waiting), controllerBeforeReload: Boolean(navigator.serviceWorker.controller) };
  });
  await page.reload({ waitUntil: 'networkidle0' });
  const controlled = await mainEvaluate(page, () => ({ script: navigator.serviceWorker.controller?.scriptURL, state: navigator.serviceWorker.controller?.state }));
  const afterInstall = await cacheSnapshot(page);
  const paths = [
    ['/__ccc204_audit__/api', 'GET', false],
    ['/__ccc204_audit__/private-pii', 'GET', true],
    ['/__ccc204_audit__/auth', 'POST', false],
    ['/__ccc204_audit__/audio', 'GET', true],
    ['/__ccc204_audit__/denied', 'GET', true],
    ['/__ccc204_audit__/unlisted.js', 'GET', false],
    ['/__ccc204_audit__/unlisted.css', 'GET', false],
  ];
  const requests = await mainEvaluate(page, async paths => {
    const results = [];
    for (const [pathname, method, credential] of paths) {
      const response = await fetch(pathname, { method, cache: 'no-store', headers: credential ? { Authorization: 'Bearer ccc204-synthetic-credential-canary' } : {} });
      const body = await response.json();
      results.push({ pathname, method, syntheticAuthorizationSent: credential, status: response.status, syntheticBodyReceived: body.marker === 'ccc204-synthetic-response-canary', serverObservedAuthorization: body.authorizationPresent });
    }
    return results;
  }, paths);
  const asset = afterInstall.caches[0].entries.find(e => e.pathname.endsWith('.js')).pathname;
  const staticRequest = await mainEvaluate(page, async pathname => {
    const response = await fetch(pathname + '?audit=ccc204-synthetic-credential-canary', { headers: { Authorization: 'Bearer ccc204-synthetic-credential-canary' }, cache: 'no-store' });
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return { pathname, status: response.status, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') };
  }, asset);
  const bootstrapProbes = await mainEvaluate(page, async () => {
    const rows = [];
    for (const pathname of ['/ccc-bootstrap.json', '/ccc-install-manifest.json']) {
      const response = await fetch(pathname, { cache: 'no-store' });
      rows.push({ pathname, status: response.status, contentType: response.headers.get('content-type'), returnedHtml: (await response.text()).startsWith('<!doctype html>') });
    }
    return rows;
  });
  const cdp = await page.createCDPSession();
  const manifest = await cdp.send('Page.getAppManifest');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  await cdp.detach();
  page.off('response', onResponse);
  return { executionContext: 'default-page-world', network, registrationMode: 'AUDITOR_MANUAL_UNCHANGED_EMITTED_WORKER_NOT_APP_TRIGGERED', before, registered, controlled, afterInstall, requests, staticRequest, bootstrapProbes, afterRequests: await cacheSnapshot(page), manifest: { url: manifest.url, errors: manifest.errors, data: manifest.data ? JSON.parse(manifest.data) : null }, installability };
}
