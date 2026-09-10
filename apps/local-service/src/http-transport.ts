import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { ActorAuthenticationError, IdentityStoreUnavailableError, MfaRequiredError, type SignedInstallManifest } from '@ccc/contracts/runtime';
import { ForbiddenError } from '@ccc/core/gateway';
import { LocalAuthError } from './office-identity.ts';

export function localRequest(req: IncomingMessage, origin: string, manifest: SignedInstallManifest): Request {
  if (Date.parse(manifest.expiresAt) <= Date.now()) throw new IdentityStoreUnavailableError();
  if (req.headers.host !== new URL(origin).host || !req.url?.startsWith('/') || req.url.startsWith('//')) throw new ForbiddenError('request origin unavailable');
  const url = new URL(req.url, origin);
  if (url.origin !== origin || url.username || url.password) throw new ForbiddenError('request origin unavailable');
  const originHeader = req.headers.origin;
  if (originHeader !== undefined && !manifest.allowedOrigins.includes(originHeader)) throw new ForbiddenError('request origin unavailable');
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  const method = req.method ?? 'GET';
  // Original audio reaches the shared AudioStore streaming limit without a Buffer.concat in this adapter.
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') { init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
  return new Request(url, init);
}

/** Only local authentication JSON uses this cap. Business JSON/audio keep their shared contracts. */
export async function authBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 4096;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new LocalAuthError('payload_too_large', 413);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || request.body === null) throw new LocalAuthError('invalid_request', 400);
  const reader = request.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (size + part.value.length > limit) throw new LocalAuthError('payload_too_large', 413);
      buffer.set(part.value, size); size += part.value.length;
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
    catch { throw new LocalAuthError('invalid_request', 400); }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new LocalAuthError('invalid_request', 400);
    return body as Record<string, unknown>;
  } finally { buffer.fill(0); reader.releaseLock(); }
}

export function localError(error: unknown): Response {
  if (error instanceof LocalAuthError) return Response.json({ error: error.code }, { status: error.status });
  if (error instanceof ActorAuthenticationError) return Response.json({ error: 'actor_authentication_required' }, { status: 401 });
  if (error instanceof MfaRequiredError) return Response.json({ error: 'mfa_required' }, { status: 403 });
  if (error instanceof ForbiddenError) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (error instanceof IdentityStoreUnavailableError) return Response.json({ error: 'identity_store_unavailable' }, { status: 503 });
  return Response.json({ error: 'internal_error' }, { status: 500 });
}

export async function sendLocalResponse(req: IncomingMessage, res: ServerResponse, response: Response, manifest: SignedInstallManifest): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  if (manifest.mode === 'local-office') res.setHeader('strict-transport-security', 'max-age=31536000');
  if (req.headers.origin !== undefined && manifest.allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Authorization, Content-Type, If-Match, X-Request-ID, X-CCC-Install-Id');
    res.setHeader('access-control-expose-headers', 'ETag, X-Request-ID, X-CCC-Installation-Id');
    res.setHeader('access-control-max-age', '600');
  }
  if (!req.complete) { res.setHeader('connection', 'close'); req.resume(); }
  if (response.body === null) res.end();
  else await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), res);
}

export async function closeLocalServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.close((error) => error ? reject(error) : resolve());
  server.closeIdleConnections();
  await promise;
}
