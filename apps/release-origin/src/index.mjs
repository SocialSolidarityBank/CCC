// S12 pinned release origin (scripts/release/release-origin.mjs PINNED_RELEASE_ORIGIN).
// Serves exactly three path families from static assets, byte for byte, with no redirect.
const ALLOWED = /^\/(?:\.well-known\/ccc\/release-bundle\.json|manifests\/[A-Za-z0-9._-]+\.manifest\.json|artifacts\/[A-Za-z0-9._-]+\.tar\.gz)$/;

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (!ALLOWED.test(url.pathname) || url.search !== '') return new Response(null, { status: 404 });
    const asset = await env.ASSETS.fetch(new Request(url.origin + url.pathname, { method: request.method }));
    if (asset.status !== 200) return new Response(null, { status: 404 });
    const headers = new Headers({
      'content-type': url.pathname.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/gzip',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    const length = asset.headers.get('content-length');
    if (length !== null) headers.set('content-length', length);
    return new Response(asset.body, { status: 200, headers });
  },
};
