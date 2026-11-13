export async function offlineProbe(page, assets, mainEvaluate) {
  const network = [];
  const onResponse = response => network.push({ pathname: new URL(response.url()).pathname, status: response.status(), fromServiceWorker: response.fromServiceWorker(), resourceType: response.request().resourceType() });
  page.on('response', onResponse);
  const routes = [];
  for (const pathname of ['/welcome', '/schedule', '/k/offline-audit']) {
    const response = await page.goto('http://127.0.0.1:46173' + pathname, { waitUntil: 'networkidle0' });
    routes.push({ pathname, status: response?.status(), fromServiceWorker: response?.fromServiceWorker(), state: await mainEvaluate(page, () => ({ rootMounted: Boolean(document.querySelector('#root h1')), heading: document.querySelector('h1')?.textContent, missingSigningKey: document.body.innerText.includes('공개 키가 없습니다'), controlled: Boolean(navigator.serviceWorker.controller) })) });
  }
  const fetchedAssets = await mainEvaluate(page, async paths => {
    const rows = [];
    for (const pathname of paths) {
      const response = await fetch('/' + pathname, { cache: 'no-store' });
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      rows.push({ pathname, status: response.status, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') });
    }
    return rows;
  }, Object.keys(assets).filter(p => p !== 'sw.js'));
  const notCached = await mainEvaluate(page, async () => {
    const rows = [];
    for (const pathname of ['/__ccc204_audit__/api', '/__ccc204_audit__/private-pii', '/__ccc204_audit__/audio', '/__ccc204_audit__/denied', '/__ccc204_audit__/unlisted.js', '/__ccc204_audit__/unlisted.css', '/ccc-bootstrap.json', '/ccc-install-manifest.json']) {
      try {
        const response = await fetch(pathname, { cache: 'no-store', headers: { Authorization: 'Bearer ccc204-synthetic-credential-canary' } });
        rows.push({ pathname, networkRejected: false, status: response.status });
      } catch (error) {
        rows.push({ pathname, networkRejected: true, errorName: error.name });
      }
    }
    try {
      const response = await fetch('/__ccc204_audit__/auth', { method: 'POST', cache: 'no-store' });
      rows.push({ pathname: '/__ccc204_audit__/auth', method: 'POST', networkRejected: false, status: response.status });
    } catch (error) { rows.push({ pathname: '/__ccc204_audit__/auth', method: 'POST', networkRejected: true, errorName: error.name }); }
    return rows;
  });
  page.off('response', onResponse);
  return { routes, assets: fetchedAssets.map(row => ({ ...row, matchesBuiltAsset: row.sha256 === assets[row.pathname] })), notCached, network };
}
