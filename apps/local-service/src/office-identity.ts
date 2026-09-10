import { argon2, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Actor, ActorRole, Identity } from '@ccc/contracts/runtime';
import { ActorAuthenticationError, IdentityStoreUnavailableError, MfaRequiredError } from '@ccc/contracts/runtime';
import { ForbiddenError, type OfficeAccountStore, type OfficeAccountRecord, type OfficeSessionRecord } from '@ccc/core/gateway';
export type { OfficeAccountStore, OfficeAccountRecord } from '@ccc/core/gateway';

const BEARER_PREFIX = 'CCC-LOCAL-OFFICEv1-';
const ABSOLUTE_TTL = 12 * 60 * 60_000;
const IDLE_TTL = 30 * 60_000;
const MFA_PENDING_TTL = 5 * 60_000;
const PRIVILEGED: readonly ActorRole[] = ['institution-admin', 'technical-admin', 'supervisor'];

export class LocalAuthError extends Error {
  constructor(readonly code: 'account_locked' | 'payload_too_large' | 'invalid_request', readonly status: number) { super(code); }
}
export interface LocalOfficeIdentityConfig { orgId: string; accountStore: OfficeAccountStore }
export interface LoginResult { bearer: string; sessionId: string; mfaRequired: boolean; userId: string }
export interface LocalOfficeIdentity extends Identity {
  login(username: string, password: Uint8Array): Promise<LoginResult>;
  verifyMfa(bearer: string, code: string): Promise<void>;
  logout(bearer: string): Promise<void>;
  close(): void;
}

async function derive(password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (typeof argon2 !== 'function') throw new IdentityStoreUnavailableError();
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  argon2('argon2id', { message: password, nonce: salt, memory: 65536, passes: 3, parallelism: 1, tagLength: 32 }, (error, output) => {
    if (error || output.length !== 32) { output?.fill(0); reject(new IdentityStoreUnavailableError()); }
    else resolve(output);
  });
  return promise;
}

export async function verifyPassword(password: Uint8Array, saltText: string, hashText: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(saltText) || !/^[A-Za-z0-9_-]{43}$/.test(hashText)) {
    throw new IdentityStoreUnavailableError();
  }
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  let actual: Uint8Array | undefined;
  try { actual = await derive(password, salt); return timingSafeEqual(actual, expected); }
  finally { salt.fill(0); expected.fill(0); actual?.fill(0); }
}

export async function hashPassword(password: Uint8Array): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  let derived: Uint8Array | undefined;
  try {
    derived = await derive(password, salt);
    return { hash: Buffer.from(derived.buffer, derived.byteOffset, derived.byteLength).toString('base64url'), salt: salt.toString('base64url') };
  } finally { salt.fill(0); derived?.fill(0); password.fill(0); }
}

/** RFC 6238 counter, consumed atomically by the gateway to prevent code replay. */
function totpCounter(secretText: string, code: string): number | null {
  if (!/^[A-Z2-7]{16,128}$/.test(secretText) || !/^\d{6}$/.test(code)) return null;
  const secret = new Uint8Array(Math.floor(secretText.length * 5 / 8));
  let bits = 0, value = 0, index = 0;
  for (const character of secretText) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += 5;
    if (bits >= 8) { bits -= 8; secret[index++] = (value >>> bits) & 255; }
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  const supplied = Buffer.from(code);
  try {
    for (const delta of [0, -1, 1]) {
      buffer.writeBigUInt64BE(BigInt(counter + delta));
      const digest = createHmac('sha1', secret).update(buffer).digest();
      const offset = digest[19]! & 15;
      const expected = Buffer.from(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0'));
      const match = timingSafeEqual(supplied, expected);
      digest.fill(0); expected.fill(0);
      if (match) return counter + delta;
    }
    return null;
  } finally { secret.fill(0); buffer.fill(0); supplied.fill(0); }
}

export function createLocalOfficeIdentity(config: LocalOfficeIdentityConfig): LocalOfficeIdentity {
  if (config.orgId.trim().length === 0) throw new Error('identity_invalid');
  const store = config.accountStore;
  let closed = false;
  // Serialize password/MFA attempts so parallel HTTP requests cannot reset a lockout in flight.
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }
  async function stored<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch { throw new IdentityStoreUnavailableError(); }
  }
  function assertOpen(): void { if (closed) throw new ActorAuthenticationError(); }
  function assertAccount(account: OfficeAccountRecord | null): asserts account is OfficeAccountRecord {
    if (account === null || !account.enabled) throw new ForbiddenError('account unavailable');
    if (account.lockedUntil !== null) {
      const until = Date.parse(account.lockedUntil);
      if (!Number.isFinite(until)) throw new IdentityStoreUnavailableError();
      if (until > Date.now()) throw new LocalAuthError('account_locked', 423);
    }
  }
  function needsMfa(account: OfficeAccountRecord): boolean {
    return account.mfaRequired || account.roles.some((role) => PRIVILEGED.includes(role));
  }
  async function sessionFor(bearer: string): Promise<{ session: OfficeSessionRecord; account: OfficeAccountRecord; actor: Actor }> {
    assertOpen();
    if (!/^CCC-LOCAL-OFFICEv1-[A-Za-z0-9_-]{43}$/.test(bearer)) throw new ActorAuthenticationError();
    const session = await stored(() => store.getSession(createHash('sha256').update(bearer).digest('hex')));
    if (session === null) throw new ActorAuthenticationError();
    const expiry = Date.parse(session.expiresAt), lastUsed = Date.parse(session.lastUsedAt), issued = Date.parse(session.issuedAt);
    if (![expiry, lastUsed, issued].every(Number.isFinite)) throw new IdentityStoreUnavailableError();
    if (Date.now() >= expiry || Date.now() - lastUsed >= IDLE_TTL) throw new ActorAuthenticationError();
    if (session.revokedAt !== null) throw new ForbiddenError('session unavailable');
    const account = await stored(() => store.getById(session.userId));
    assertAccount(account);
    const actor = await stored(() => store.resolveActor(session));
    if (actor === null || actor.orgId !== config.orgId || actor.kind !== 'human') throw new ForbiddenError('account unavailable');
    account.roles = actor.roles;
    if (needsMfa(account) && session.mfaVerifiedAt === null && Date.now() - issued >= MFA_PENDING_TTL) throw new ActorAuthenticationError();
    assertOpen();
    return { session, account, actor };
  }
  return {
    login(username, password) {
      return serial(async () => {
        try {
          assertOpen();
          const account = await stored(() => store.getByUsername(username));
          if (account === null || !account.enabled) throw new ActorAuthenticationError();
          assertAccount(account);
          if (!await verifyPassword(password, account.salt, account.passwordHash)) {
            await stored(() => store.recordFailure(account.userId));
            throw new ActorAuthenticationError();
          }
          const at = Date.now();
          const random = randomBytes(32);
          const bearer = BEARER_PREFIX + random.toString('base64url');
          random.fill(0);
          const session: OfficeSessionRecord = {
            sessionId: randomUUID(), userId: account.userId, issuedAt: new Date(at).toISOString(),
            expiresAt: new Date(at + ABSOLUTE_TTL).toISOString(), lastUsedAt: new Date(at).toISOString(),
            mfaVerifiedAt: null, revokedAt: null,
          };
          assertOpen();
          if (!await stored(() => store.createSession(account, session, createHash('sha256').update(bearer).digest('hex')))) throw new ActorAuthenticationError();
          return { bearer, sessionId: session.sessionId, userId: account.userId, mfaRequired: needsMfa(account) };
        } finally { password.fill(0); }
      });
    },
    verifyMfa(bearer, code) {
      return serial(async () => {
        const { session, account } = await sessionFor(bearer);
        const counter = account.mfaSecret === null ? null : totpCounter(account.mfaSecret, code);
        if (counter === null || !await stored(() => store.completeMfa(session.sessionId, counter))) {
          await stored(() => store.recordFailure(account.userId));
          throw new ActorAuthenticationError();
        }
      });
    },
    async resolve(request) {
      const authorization = request.headers.get('authorization');
      if (authorization === null || !/^Bearer [^\s]+$/i.test(authorization)) throw new ActorAuthenticationError();
      const { session, account, actor } = await sessionFor(authorization.slice(7));
      if (needsMfa(account) && session.mfaVerifiedAt === null) throw new MfaRequiredError();
      if (actor.roles.length === 0) throw new ForbiddenError('account unavailable');
      await stored(() => store.touchSession(session.sessionId));
      return actor;
    },
    async revokeAll(userId, reason) { assertOpen(); await stored(() => store.revokeAll(userId, reason)); },
    async revokeSession(sessionId, reason) { assertOpen(); await stored(() => store.revokeSession(sessionId, reason)); },
    async logout(bearer) {
      const { session } = await sessionFor(bearer);
      await stored(() => store.revokeSession(session.sessionId, 'logout'));
    },
    close() { closed = true; },
  };
}
