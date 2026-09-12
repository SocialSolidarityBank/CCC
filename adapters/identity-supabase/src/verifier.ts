import { ActorAuthenticationError, IdentityStoreUnavailableError } from '@ccc/contracts/runtime';
import type { SupabaseIdentityConfig } from './index';

const CACHE_MS = 3_600_000;
const COOLDOWN_MS = 60_000;
const MAX_KEYS = 64;
const MAX_NEGATIVE_KEYS = 256;
type Algorithm = 'ES256' | 'RS256';
interface CachedKey { key: CryptoKey; alg: Algorithm; expiresAt: number }
interface VerifiedClaims {
  sub: string; sessionId: string; issuedAt: string; aal: unknown;
  /** Directory-facing claims. `email_verified` is absent unless the installation adds it, so absence is "not verified". */
  email: string; emailVerified: boolean;
}

function invalid(): never {
  throw new ActorAuthenticationError('Supabase credential is invalid');
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
}
/** RFC 5321 caps an address at 320 bytes; whitespace and control characters are never part of one. */
function emailClaim(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value)
    && new TextEncoder().encode(value).length <= 320;
}
function bytes(segment: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) invalid();
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4));
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return result.buffer;
}
function json(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(segment)));
  if (!object(value)) invalid();
  return value;
}

/** Per-installation verifier. The cooldown is shared by all kids, not keyed by attacker input. */
export function createVerifier(config: SupabaseIdentityConfig): (token: string) => Promise<VerifiedClaims> {
  const { issuer, jwksUri } = config;
  try {
    const origin = new URL(issuer);
    const jwks = new URL(jwksUri);
    if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)
      || origin.port !== '' || origin.username !== '' || origin.password !== ''
      || origin.pathname !== '/auth/v1' || origin.href !== issuer || /[?#]/.test(issuer)
      || jwks.origin !== origin.origin || jwks.username !== '' || jwks.password !== ''
      || jwks.href !== `${issuer}/.well-known/jwks.json` || /[?#]/.test(jwksUri)) {
      throw new Error();
    }
  } catch {
    throw new IdentityStoreUnavailableError('Supabase identity configuration is invalid');
  }
  const fetcher = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  const keys = new Map<string, CachedKey>();
  const negative = new Map<string, number>();
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let lastFailure = false;
  let pending: Promise<void> | undefined;

  async function refresh(): Promise<void> {
    if (pending !== undefined) return pending;
    lastAttempt = now();
    const attempt = (async () => {
      try {
        const response = await fetcher(jwksUri, {
          method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok || response.redirected || (response.url !== '' && response.url !== jwksUri) || response.body === null) throw new Error();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 65_536) {
              await reader.cancel();
              throw new Error();
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        if (!object(document) || !Array.isArray(document.keys) || document.keys.length > MAX_KEYS) throw new Error();
        const receivedAt = now();
        const imported = new Map<string, CachedKey>();
        const seen = new Set<string>();
        for (const entry of document.keys) {
          if (!object(entry) || !identifier(entry.kid)) continue;
          // Ambiguous duplicate IDs must not let document ordering choose the signing key.
          if (seen.has(entry.kid)) throw new Error();
          seen.add(entry.kid);
          if ((entry.alg !== 'ES256' && entry.alg !== 'RS256')
            || (entry.use !== undefined && entry.use !== 'sig')
            || (entry.key_ops !== undefined && (!Array.isArray(entry.key_ops) || entry.key_ops.length !== 1 || entry.key_ops[0] !== 'verify'))
            || entry.d !== undefined || entry.k !== undefined
            || (entry.alg === 'ES256' && (entry.kty !== 'EC' || entry.crv !== 'P-256'))
            || (entry.alg === 'RS256' && entry.kty !== 'RSA')) continue;
          try {
            const key = await crypto.subtle.importKey('jwk', entry as JsonWebKey,
              entry.alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' }
                : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
            if (entry.alg === 'RS256' && (key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) continue;
            imported.set(entry.kid, { key, alg: entry.alg, expiresAt: receivedAt + CACHE_MS });
          } catch {
            // An unsupported or invalid public key is not authentication material.
          }
        }
        for (const [kid, cached] of keys) {
          // Retired keys keep their original deadline, never a renewed grace period.
          if (cached.expiresAt <= receivedAt || seen.has(kid)) keys.delete(kid);
        }
        for (const [kid, cached] of imported) keys.set(kid, cached);
        while (keys.size > MAX_KEYS) {
          const oldest = keys.keys().next().value;
          if (oldest !== undefined) keys.delete(oldest);
        }
        negative.clear();
        lastFailure = false;
      } catch {
        lastFailure = true;
        throw new IdentityStoreUnavailableError('Supabase signing keys are unavailable');
      }
    })();
    pending = attempt;
    try { await attempt; } finally { pending = undefined; }
  }

  async function signingKey(kid: string, alg: Algorithm): Promise<CryptoKey> {
    let timestamp = now();
    for (const [id, cached] of keys) if (cached.expiresAt <= timestamp) keys.delete(id);
    for (const [id, expiresAt] of negative) if (expiresAt <= timestamp) negative.delete(id);
    let cached = keys.get(kid);
    if (cached !== undefined) {
      if (cached.alg !== alg) invalid();
      return cached.key;
    }
    if (pending !== undefined) await pending;
    else if (!negative.has(kid) && timestamp - lastAttempt >= COOLDOWN_MS) await refresh();
    timestamp = now();
    cached = keys.get(kid);
    if (cached !== undefined && cached.expiresAt > timestamp) {
      if (cached.alg !== alg) invalid();
      return cached.key;
    }
    if (lastFailure) throw new IdentityStoreUnavailableError('Supabase signing keys are unavailable');
    if (!negative.has(kid)) {
      if (negative.size >= MAX_NEGATIVE_KEYS) {
        const oldest = negative.keys().next().value;
        if (oldest !== undefined) negative.delete(oldest);
      }
      negative.set(kid, timestamp + COOLDOWN_MS);
    }
    return invalid();
  }

  return async (token) => {
    try {
      if (token.length > 16_384) invalid();
      const parts = token.split('.');
      if (parts.length !== 3) invalid();
      const [head, payload, signature] = parts;
      if (head === undefined || payload === undefined || signature === undefined) invalid();
      const header = json(head);
      if ((header.alg !== 'ES256' && header.alg !== 'RS256') || !identifier(header.kid)
        || header.crit !== undefined || header.b64 !== undefined
        || (header.typ !== undefined && header.typ !== 'JWT')) invalid();
      const claims = json(payload);
      const signatureBytes = bytes(signature);
      const key = await signingKey(header.kid, header.alg);
      const valid = await crypto.subtle.verify(header.alg === 'ES256'
        ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }, key,
      signatureBytes, new TextEncoder().encode(`${head}.${payload}`));
      if (!valid) invalid();
      const timestamp = now() / 1000;
      const { iat, exp, nbf } = claims;
      if (claims.iss !== issuer || claims.aud !== 'authenticated' || claims.role !== 'authenticated'
        || claims.is_anonymous !== false || !identifier(claims.sub) || !identifier(claims.session_id)
        || (claims.aal !== 'aal1' && claims.aal !== 'aal2')
        || !emailClaim(claims.email)
        || (claims.email_verified !== undefined && typeof claims.email_verified !== 'boolean')
        || typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0
        || typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= iat || exp - iat > 3600
        || iat > timestamp + 60 || exp <= timestamp - 60
        || (nbf !== undefined && (typeof nbf !== 'number' || !Number.isSafeInteger(nbf) || nbf > timestamp + 60 || nbf >= exp))) invalid();
      return {
        sub: claims.sub, sessionId: claims.session_id, issuedAt: new Date(iat * 1000).toISOString(),
        aal: claims.aal, email: claims.email, emailVerified: claims.email_verified === true,
      };
    } catch (error) {
      if (error instanceof IdentityStoreUnavailableError) throw error;
      return invalid();
    }
  };
}
