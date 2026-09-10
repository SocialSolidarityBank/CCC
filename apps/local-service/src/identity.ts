import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Actor, type Identity, ActorAuthenticationError, IdentityStoreUnavailableError } from '@ccc/contracts/runtime';
import type { SingleInstallData } from '@ccc/secrets-dpapi';
import { ForbiddenError } from '@ccc/core/gateway';
import { LocalAuthError, verifyPassword } from './office-identity.ts';

export interface LocalSingleIdentityConfig {
  install: SingleInstallData;
  resolveActor(sessionId: string, issuedAt: string): Promise<Actor | null>;
}
export interface LocalSingleIdentity extends Identity {
  readonly stableUserId: string;
  challenge(): string;
  unlock(challenge: string, proof: string, password: Uint8Array): Promise<{ bearer: string; sessionId: string }>;
  lock(): void;
  close(): void;
}

export function generateStableUserId(): string { return randomUUID(); }

/** Starts locked. DPAPI possession plus the app passphrase is required for each new bearer. */
export function createLocalSingleIdentity(config: LocalSingleIdentityConfig): LocalSingleIdentity {
  const { install } = config;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(install.stableUserId)
    || !install.orgId || install.handshakeKey.length !== 32) throw new Error('identity_invalid');
  const handshakeKey = new Uint8Array(install.handshakeKey);
  let closed = false, pendingNonce: string | null = null, nonceExpires = 0;
  let session: { id: string; hash: Buffer; issuedAt: number; lastUsedAt: number } | null = null;
  let failures = 0, lockedUntil = 0, unlocking = false, lockVersion = 0;
  function lock(): void { lockVersion++; session?.hash.fill(0); session = null; pendingNonce = null; }
  return {
    stableUserId: install.stableUserId,
    challenge() {
      if (closed) throw new ActorAuthenticationError();
      if (Date.now() < lockedUntil) throw new LocalAuthError('account_locked', 423);
      pendingNonce = randomBytes(32).toString('base64url');
      nonceExpires = Date.now() + 30_000;
      return pendingNonce;
    },
    async unlock(challenge, proof, password) {
      try {
        if (closed || unlocking) throw new ActorAuthenticationError();
        if (Date.now() < lockedUntil) throw new LocalAuthError('account_locked', 423);
        if (challenge !== pendingNonce || Date.now() >= nonceExpires) throw new ActorAuthenticationError();
        pendingNonce = null;
        const expected = createHmac('sha256', handshakeKey).update(`${install.installationId}\0${challenge}`).digest();
        const supplied = Buffer.from(proof, 'base64url');
        const match = expected.length === supplied.length && timingSafeEqual(expected, supplied);
        expected.fill(0); supplied.fill(0);
        if (!match) throw new ActorAuthenticationError();
        unlocking = true;
        const version = lockVersion;
        try {
          if (!await verifyPassword(password, install.salt, install.passwordHash)) {
            failures++;
            if (failures >= 5) { lockedUntil = Date.now() + 15 * 60_000; failures = 0; }
            throw new ActorAuthenticationError();
          }
          if (closed || lockVersion !== version) throw new ActorAuthenticationError();
          const id = randomUUID(), at = Date.now();
          let actor: Actor | null;
          try { actor = await config.resolveActor(id, new Date(at).toISOString()); }
          catch { throw new IdentityStoreUnavailableError(); }
          if (actor === null || actor.roles.length === 0) throw new ForbiddenError('account unavailable');
          if (closed || lockVersion !== version) throw new ActorAuthenticationError();
          lock();
          const bytes = randomBytes(32);
          const bearer = `CCC-LOCAL-SINGLEv1-${bytes.toString('base64url')}`;
          bytes.fill(0);
          session = { id, hash: createHash('sha256').update(bearer).digest(), issuedAt: at, lastUsedAt: at };
          failures = 0;
          return { bearer, sessionId: id };
        } finally { unlocking = false; }
      } finally { password.fill(0); }
    },
    async resolve(request) {
      const authorization = request.headers.get('authorization');
      const current = session;
      if (closed || current === null || authorization === null || !/^Bearer CCC-LOCAL-SINGLEv1-[A-Za-z0-9_-]{43}$/i.test(authorization)) throw new ActorAuthenticationError();
      const hash = createHash('sha256').update(authorization.slice(7)).digest();
      const match = timingSafeEqual(hash, current.hash);
      hash.fill(0);
      if (!match) throw new ActorAuthenticationError();
      if (Date.now() - current.issuedAt >= 12 * 60 * 60_000 || Date.now() - current.lastUsedAt >= 30 * 60_000) {
        lock(); throw new ActorAuthenticationError();
      }
      let actor: Actor | null;
      try { actor = await config.resolveActor(current.id, new Date(current.issuedAt).toISOString()); }
      catch { throw new IdentityStoreUnavailableError(); }
      if (actor === null || actor.roles.length === 0) { lock(); throw new ForbiddenError('account unavailable'); }
      if (closed || session !== current) throw new ActorAuthenticationError();
      current.lastUsedAt = Date.now();
      return actor;
    },
    async revokeAll(userId) { if (userId === install.stableUserId) lock(); },
    async revokeSession(sessionId) { if (session?.id === sessionId) lock(); },
    lock,
    close() { closed = true; lock(); handshakeKey.fill(0); },
  };
}
