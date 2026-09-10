/**
 * E4-3 / E8-1 Local Office identity with Argon2id accounts.
 * - Argon2id password verification (Node 24 crypto.argon2)
 * - Account lockout after failed attempts
 * - Session expiry
 * - Administrator MFA requirement
 */
import * as nodeCrypto from 'node:crypto';
const { createHash, randomBytes, timingSafeEqual, argon2: nodeArgon2 } = nodeCrypto;
import type {
  Actor,
  ActorRole,
  Identity,
  RevocationReason,
} from '@ccc/contracts/runtime';
import { ActorAuthenticationError, MfaRequiredError } from '@ccc/contracts/runtime';

const BEARER_PREFIX = 'CCC-LOCAL-OFFICEv1-';
const SESSION_ID_PREFIX = 'session-';

// Argon2id parameters matching S9/S10 envelope
const ARGON2_MEMORY_KIB = 65536;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_OUTPUT_BYTES = 32;

// Security parameters per S4 spec
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MFA_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours for MFA sessions

// Roles requiring MFA per S4 identity: { kind: 'argon2id-account'; adminMfa: true }
const MFA_REQUIRED_ROLES: readonly ActorRole[] = ['institution-admin', 'technical-admin', 'supervisor'];

export interface OfficeAccountRecord {
  /** Unique user ID (UUID). */
  userId: string;
  /** Username for login. */
  username: string;
  /** Argon2id hash of password (base64url). */
  passwordHash: string;
  /** Salt used for Argon2id (base64url, 16 bytes). */
  salt: string;
  /** Assigned roles. */
  roles: ActorRole[];
  /** MFA secret (base32 TOTP). Null if not enrolled. */
  mfaSecret: string | null;
  /** Whether MFA is required for this account. */
  mfaRequired: boolean;
  /** Account enabled flag. */
  enabled: boolean;
  /** Failed login attempts since last success. */
  failedAttempts: number;
  /** Lockout end timestamp (ISO). Null if not locked. */
  lockedUntil: string | null;
  /** Created timestamp (ISO). */
  createdAt: string;
}

interface ActiveSession {
  sessionId: string;
  userId: string;
  bearer: string;
  bearerHash: Buffer;
  mfaVerified: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface LocalOfficeIdentityConfig {
  /** Organization ID from install manifest. */
  orgId: string;
  /** Account storage interface. */
  accountStore: OfficeAccountStore;
}

/** Storage interface for accounts (backed by encrypted SQLite). */
export interface OfficeAccountStore {
  getByUsername(username: string): Promise<OfficeAccountRecord | null>;
  getById(userId: string): Promise<OfficeAccountRecord | null>;
  updateFailedAttempts(userId: string, attempts: number, lockedUntil: string | null): Promise<void>;
  updateLastLogin(userId: string): Promise<void>;
}

export interface LocalOfficeIdentity extends Identity {
  /** Authenticate with username/password, returns session bearer. */
  login(username: string, password: Uint8Array): Promise<LoginResult>;
  /** Complete MFA challenge for a session. */
  verifyMfa(sessionId: string, code: string): Promise<void>;
  /** Get active session count (for monitoring). */
  activeSessionCount(): number;
  /** Zeros memory and invalidates all sessions. */
  close(): void;
}

export interface LoginResult {
  bearer: string;
  sessionId: string;
  mfaRequired: boolean;
  userId: string;
}

/**
 * Verify Argon2id password hash using Node 24's crypto.argon2.
 * Fails closed if Argon2id is unavailable.
 */
async function verifyArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  expectedHash: Uint8Array,
): Promise<boolean> {
  if (typeof nodeArgon2 !== 'function') {
    throw new Error('argon2id_unavailable');
  }

  return new Promise((resolve, reject) => {
    nodeArgon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_OUTPUT_BYTES,
      },
      (error: Error | null, derived: Uint8Array) => {
        if (error || !(derived instanceof Uint8Array) || derived.length !== ARGON2_OUTPUT_BYTES) {
          if (derived instanceof Uint8Array) derived.fill(0);
          reject(new Error('argon2id_failed'));
          return;
        }
        const match = derived.length === expectedHash.length && timingSafeEqual(derived, expectedHash);
        derived.fill(0);
        resolve(match);
      },
    );
  });
}

/**
 * Hash password with Argon2id for storage.
 */
export async function hashPassword(password: Uint8Array): Promise<{ hash: string; salt: string }> {
  if (typeof nodeArgon2 !== 'function') {
    throw new Error('argon2id_unavailable');
  }

  const salt = randomBytes(16);

  return new Promise((resolve, reject) => {
    nodeArgon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISM,
        tagLength: ARGON2_OUTPUT_BYTES,
      },
      (error: Error | null, derived: Uint8Array) => {
        if (error || !(derived instanceof Uint8Array) || derived.length !== ARGON2_OUTPUT_BYTES) {
          if (derived instanceof Uint8Array) derived.fill(0);
          salt.fill(0);
          reject(new Error('argon2id_failed'));
          return;
        }
        const hashB64 = Buffer.from(derived).toString('base64url');
        const saltB64 = salt.toString('base64url');
        derived.fill(0);
        salt.fill(0);
        resolve({ hash: hashB64, salt: saltB64 });
      },
    );
  });
}

function generateSessionId(): string {
  return SESSION_ID_PREFIX + randomBytes(16).toString('hex');
}

function generateOpaqueBearer(): { bearer: string; secretBytes: Uint8Array } {
  const secretBytes = randomBytes(32);
  const bearer = BEARER_PREFIX + secretBytes.toString('base64url');
  return { bearer, secretBytes };
}

function hashBearer(bearer: string): Buffer {
  return createHash('sha256').update(bearer).digest();
}

function requiresMfa(roles: ActorRole[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}

export function createLocalOfficeIdentity(config: LocalOfficeIdentityConfig): LocalOfficeIdentity {
  if (!config.orgId || config.orgId.trim().length === 0) {
    throw new Error('identity_invalid');
  }

  const sessions = new Map<string, ActiveSession>();
  let closed = false;

  function cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt < now) {
        session.bearerHash.fill(0);
        sessions.delete(sessionId);
      }
    }
  }

  function findSessionByBearer(bearer: string): ActiveSession | null {
    const bearerHash = hashBearer(bearer);
    for (const session of sessions.values()) {
      if (timingSafeEqual(session.bearerHash, bearerHash)) {
        return session;
      }
    }
    return null;
  }

  return {
    async login(username: string, password: Uint8Array): Promise<LoginResult> {
      if (closed) throw new ActorAuthenticationError('identity closed');

      cleanExpiredSessions();

      const account = await config.accountStore.getByUsername(username);
      if (!account || !account.enabled) {
        // Wipe password immediately
        password.fill(0);
        throw new ActorAuthenticationError('invalid credentials');
      }

      // Check lockout
      if (account.lockedUntil) {
        const lockedUntilTime = new Date(account.lockedUntil).getTime();
        if (Date.now() < lockedUntilTime) {
          password.fill(0);
          throw new ActorAuthenticationError('account locked');
        }
      }

      // Verify password
      const salt = Buffer.from(account.salt, 'base64url');
      const expectedHash = Buffer.from(account.passwordHash, 'base64url');

      let passwordValid: boolean;
      try {
        passwordValid = await verifyArgon2id(password, salt, expectedHash);
      } finally {
        password.fill(0);
        salt.fill(0);
        expectedHash.fill(0);
      }

      if (!passwordValid) {
        const newAttempts = account.failedAttempts + 1;
        let lockedUntil: string | null = null;
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
        }
        await config.accountStore.updateFailedAttempts(account.userId, newAttempts, lockedUntil);
        throw new ActorAuthenticationError('invalid credentials');
      }

      // Success: reset failed attempts and create session
      await config.accountStore.updateFailedAttempts(account.userId, 0, null);
      await config.accountStore.updateLastLogin(account.userId);

      const sessionId = generateSessionId();
      const { bearer, secretBytes } = generateOpaqueBearer();
      const bearerHash = hashBearer(bearer);
      secretBytes.fill(0);

      const mfaRequired = requiresMfa(account.roles) && account.mfaRequired;
      const now = Date.now();
      const ttl = mfaRequired ? MFA_SESSION_TTL_MS : SESSION_TTL_MS;

      const session: ActiveSession = {
        sessionId,
        userId: account.userId,
        bearer,
        bearerHash,
        mfaVerified: false,
        createdAt: now,
        expiresAt: now + ttl,
      };

      sessions.set(sessionId, session);

      return {
        bearer,
        sessionId,
        mfaRequired,
        userId: account.userId,
      };
    },

    async verifyMfa(sessionId: string, code: string): Promise<void> {
      if (closed) throw new ActorAuthenticationError('identity closed');

      const session = sessions.get(sessionId);
      if (!session) {
        throw new ActorAuthenticationError('invalid session');
      }

      if (session.expiresAt < Date.now()) {
        session.bearerHash.fill(0);
        sessions.delete(sessionId);
        throw new ActorAuthenticationError('session expired');
      }

      const account = await config.accountStore.getById(session.userId);
      if (!account || !account.mfaSecret) {
        throw new ActorAuthenticationError('mfa not enrolled');
      }

      // TOTP verification (RFC 6238)
      // For now, accept a simple 6-digit code check
      // Full TOTP implementation would use the mfaSecret
      const validCode = verifyTotp(account.mfaSecret, code);
      if (!validCode) {
        throw new ActorAuthenticationError('invalid mfa code');
      }

      session.mfaVerified = true;
    },

    async resolve(request: Request): Promise<Actor> {
      if (closed) throw new ActorAuthenticationError('identity closed');

      const authorization = request.headers.get('authorization');
      if (!authorization) throw new ActorAuthenticationError('missing authorization');

      const bearer = authorization.replace(/^Bearer\s+/i, '');
      if (!bearer.startsWith(BEARER_PREFIX)) {
        throw new ActorAuthenticationError('invalid bearer format');
      }

      cleanExpiredSessions();

      const session = findSessionByBearer(bearer);
      if (!session) {
        throw new ActorAuthenticationError('invalid bearer');
      }

      if (session.expiresAt < Date.now()) {
        session.bearerHash.fill(0);
        sessions.delete(session.sessionId);
        throw new ActorAuthenticationError('session expired');
      }

      const account = await config.accountStore.getById(session.userId);
      if (!account || !account.enabled) {
        throw new ActorAuthenticationError('account disabled');
      }

      // Check MFA requirement
      const needsMfa = requiresMfa(account.roles) && account.mfaRequired;
      if (needsMfa && !session.mfaVerified) {
        throw new MfaRequiredError('mfa verification required');
      }

      return {
        kind: 'human',
        userId: account.userId,
        orgId: config.orgId,
        roles: account.roles,
        scopes: ['*'],
        authn: {
          source: 'office-local-bearer',
          assurance: session.mfaVerified ? 'mfa' : 'aal1',
          sessionId: session.sessionId,
        },
      };
    },

    async revokeAll(userId: string, _reason: RevocationReason): Promise<void> {
      for (const [sessionId, session] of sessions) {
        if (session.userId === userId) {
          session.bearerHash.fill(0);
          sessions.delete(sessionId);
        }
      }
    },

    async revokeSession(sessionId: string, _reason: RevocationReason): Promise<void> {
      const session = sessions.get(sessionId);
      if (session) {
        session.bearerHash.fill(0);
        sessions.delete(sessionId);
      }
    },

    activeSessionCount(): number {
      cleanExpiredSessions();
      return sessions.size;
    },

    close(): void {
      closed = true;
      for (const session of sessions.values()) {
        session.bearerHash.fill(0);
      }
      sessions.clear();
    },
  };
}

/**
 * TOTP verification (RFC 6238).
 * Uses 30-second time steps and accepts ±1 step for clock drift.
 */
function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  const secret = base32Decode(secretBase32);
  if (!secret) return false;

  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / timeStep);

  // Check current, previous, and next time step
  for (const offset of [0, -1, 1]) {
    const expected = generateTotp(secret, counter + offset);
    if (expected === code) {
      secret.fill(0);
      return true;
    }
  }

  secret.fill(0);
  return false;
}

function generateTotp(secret: Uint8Array, counter: number): string {
  // HMAC-SHA1 per RFC 4226/6238
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHash('sha1');
  // Use HMAC manually since we need the raw output
  const blockSize = 64;
  const key = secret.length > blockSize
    ? createHash('sha1').update(secret).digest()
    : Buffer.from(secret);

  const ipad = Buffer.alloc(blockSize, 0x36);
  const opad = Buffer.alloc(blockSize, 0x5c);
  for (let i = 0; i < key.length; i++) {
    const k = key[i];
    if (k !== undefined) {
      ipad[i]! ^= k;
      opad[i]! ^= k;
    }
  }

  const inner = createHash('sha1').update(ipad).update(counterBuffer).digest();
  const outer = createHash('sha1').update(opad).update(inner).digest();

  // Dynamic truncation (SHA-1 digest is always 20 bytes)
  const offset = (outer[outer.length - 1] ?? 0) & 0x0f;
  const b0 = outer[offset] ?? 0;
  const b1 = outer[offset + 1] ?? 0;
  const b2 = outer[offset + 2] ?? 0;
  const b3 = outer[offset + 3] ?? 0;
  const binary = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

function base32Decode(input: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (cleaned.length === 0) return null;

  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}
