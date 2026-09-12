// Prebuild from the repository root with the EXISTING verifier/builder:
// pnpm --filter @ccc/client run build:release -- --config /absolute/public-release-config.json
// The config contains manifestPath + PUBLIC publicKeys, never a private signing key.
// Run: deno run --no-config --no-lock --no-remote --no-prompt --allow-read=apps/client/dist \
//   --allow-env=PORT --allow-net=0.0.0.0:8080 apps/client/tools/serve-release.mjs
// Optional first argument: a prebuilt release directory. PORT defaults to 8080.
// Signature verification belongs to build:release. Startup checks artifact completeness
// and cross-file binding; it neither signs nor rebuilds anything. Rebuild/restart to update.
import { join } from 'node:path';

const MIME = {
  js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm',
};
const PUBLIC_FILES = {
  'index.html': 'text/html; charset=utf-8',
  'ccc-bootstrap.json': 'application/json; charset=utf-8',
  'ccc-install-manifest.json': 'application/json; charset=utf-8',
  'manifest.webmanifest': 'application/manifest+json; charset=utf-8',
  'sw.js': MIME.js,
  'icon.svg': MIME.svg,
};
const HEADER_NAMES = ['Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options', 'Cache-Control'];
const fail = () => { throw new Error('static_release_invalid'); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const httpsUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};

/** Load a sealed public snapshot: requests never become filesystem paths. */
export async function createStaticReleaseHandler(directory) {
  try {
    const root = await Deno.realPath(directory);
    const read = async (name) => {
      const path = join(root, name);
      const info = await Deno.lstat(path);
      if (!info.isFile || info.isSymlink || await Deno.realPath(path) !== path) fail();
      return await Deno.readFile(path);
    };
    const json = async (name) => {
      const value = JSON.parse(new TextDecoder().decode(await read(name)));
      if (!object(value)) fail();
      return value;
    };
    const metadata = await json('ccc-deploy-headers.json');
    const bootstrapBytes = await read('ccc-bootstrap.json');
    const manifestBytes = await read('ccc-install-manifest.json');
    const bootstrap = JSON.parse(new TextDecoder().decode(bootstrapBytes));
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    if (!object(bootstrap) || !object(manifest) || !object(metadata.headers)
      || bootstrap.mode !== 'community-cloud' || manifest.mode !== bootstrap.mode
      || Object.keys(bootstrap).length !== 2 || bootstrap.apiBase !== manifest.apiBase
      || metadata.apiBase !== manifest.apiBase || !httpsUrl(metadata.apiBase)
      || metadata.clientOrigin !== manifest.clientOrigin || !httpsUrl(metadata.clientOrigin)
      || new URL(metadata.clientOrigin).origin !== metadata.clientOrigin
      || metadata.supabaseAuthOrigin !== manifest.supabaseAuthOrigin || !httpsUrl(metadata.supabaseAuthOrigin)
      || new URL(metadata.supabaseAuthOrigin).origin !== metadata.supabaseAuthOrigin
      || !Array.isArray(metadata.allowedOrigins) || !metadata.allowedOrigins.includes(metadata.clientOrigin)
      || !metadata.allowedOrigins.every((origin) => httpsUrl(origin) && new URL(origin).origin === origin)
      || JSON.stringify(metadata.allowedOrigins) !== JSON.stringify(manifest.allowedOrigins)
      || manifest.schemaVersion !== 1 || typeof manifest.signingKeyId !== 'string' || !manifest.signingKeyId
      || typeof manifest.ed25519Signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.ed25519Signature)
      || Object.keys(metadata.headers).length !== HEADER_NAMES.length
      || !HEADER_NAMES.every((name) => typeof metadata.headers[name] === 'string'
        && metadata.headers[name].trim() !== '' && !/[\r\n]/.test(metadata.headers[name]))
      || metadata.headers['Referrer-Policy'] !== 'no-referrer'
      || metadata.headers['X-Content-Type-Options'] !== 'nosniff'
      || metadata.headers['Cache-Control'] !== 'no-store'
      || !metadata.headers['Content-Security-Policy'].includes("default-src 'self'")) fail();
    const headers = new Headers(metadata.headers);
    const files = new Map();
    // ponytail: release bytes stay in memory; stream immutable file handles if bundles outgrow container memory.
    for (const [name, type] of Object.entries(PUBLIC_FILES)) {
      const bytes = name === 'ccc-bootstrap.json' ? bootstrapBytes
        : name === 'ccc-install-manifest.json' ? manifestBytes : await read(name);
      if (bytes.length === 0) fail();
      files.set(`/${name}`, new Blob([bytes], { type }));
    }
    const assets = async (relative) => {
      const path = join(root, relative);
      const info = await Deno.lstat(path);
      if (!info.isDirectory || info.isSymlink || await Deno.realPath(path) !== path) fail();
      for await (const entry of Deno.readDir(path)) {
        if (entry.isSymlink) fail();
        if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(entry.name)) continue;
        const name = `${relative}/${entry.name}`;
        if (entry.isDirectory) await assets(name);
        else if (entry.isFile) {
          const extension = entry.name.split('.').at(-1);
          if (Object.hasOwn(MIME, extension)) files.set(`/${name}`, new Blob([await read(name)], { type: MIME[extension] }));
        }
      }
    };
    await assets('assets');
    const index = await files.get('/index.html').text();
    if (!/<!doctype html>/i.test(index) || !/<div\b[^>]*\bid=["']root["']/i.test(index)
      || !/<script\b[^>]*\bsrc=["']\/assets\/[^"']+\.js["']/i.test(index)) fail();
    for (const reference of index.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
      if (!files.has(reference[1])) fail();
    }
    const pwa = JSON.parse(await files.get('/manifest.webmanifest').text());
    if (!object(pwa) || typeof pwa.name !== 'string' || typeof pwa.start_url !== 'string') fail();

    return (request) => {
      const head = request.method === 'HEAD';
      const reply = (status, body, extra = {}) => {
        const responseHeaders = new Headers(headers);
        responseHeaders.set('Content-Type', 'text/plain; charset=utf-8');
        for (const [name, value] of Object.entries(extra)) responseHeaders.set(name, value);
        return new Response(head ? null : body, { status, headers: responseHeaders });
      };
      if (request.method !== 'GET' && !head) return reply(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      let path;
      try {
        const raw = request.url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
        if (/%(?:2f|5c)/i.test(raw)) return reply(400, 'Invalid path');
        path = decodeURIComponent(raw);
        if (!path.startsWith('/') || /[\\%?#\x00-\x20\x7f]/.test(path)
          || path.split('/').some((segment) => segment.startsWith('.')) || path.includes('//')) {
          return reply(400, 'Invalid path');
        }
      } catch { return reply(400, 'Invalid path'); }
      let file = files.get(path);
      if (!file && !path.startsWith('/assets') && !path.includes('.')) file = files.get('/index.html');
      if (!file) return reply(404, 'Not found');
      const immutable = path.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path);
      return reply(200, file, {
        'Content-Type': file.type,
        'Content-Length': String(file.size),
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      });
    };
  } catch { fail(); }
}

if (import.meta.main) {
  try {
    const portText = Deno.env.get('PORT') ?? '8080';
    const port = Number(portText);
    if (!/^[0-9]+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) fail();
    const handler = await createStaticReleaseHandler(Deno.args[0] ?? new URL('../dist/', import.meta.url));
    Deno.serve({ hostname: '0.0.0.0', port, onListen: () => {} }, handler);
  } catch {
    console.error('static_release_invalid');
    Deno.exit(1);
  }
}
