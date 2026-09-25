// Throwaway settings layout comparison. Serves only prototype assets and design tokens.
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const tokens = fileURLToPath(new URL('../../design/tokens.css', import.meta.url));
const server = Bun.serve({
  hostname: process.env.CCC_PREVIEW_HOST ?? '127.0.0.1',
  port: 3112,
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const pathname = new URL(request.url).pathname;
    let target;
    if (pathname === '/design/tokens.css') target = tokens;
    else {
      const relative = pathname === '/' || pathname === '/settings' ? 'index.html' : pathname.slice(1);
      target = resolve(root, relative);
      if (!target.startsWith(root) || !['.html', '.css', '.js', '.svg', '.woff2', '.png'].includes(extname(target))) {
        return new Response('Not found', { status: 404 });
      }
    }
    const file = Bun.file(target);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file, {
      headers: { 'content-type': file.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  },
});
console.log(`Settings layout prototype ready at http://${server.hostname}:${server.port}/settings?variant=A`);
