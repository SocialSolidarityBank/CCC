import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type Actor,
  type ActorRole,
  type Identity,
  ActorAuthenticationError,
  type RevocationReason,
} from '@ccc/contracts/runtime';

const BEARER_PREFIX = 'CCC-LOCAL-SINGLEv1-';

/**
 * E7-1a stable local identity. No raw SID, no email, no persisted bearer.
 * The token lives in memory only and regenerates on each service start.
 */
export interface LocalSingleIdentityConfig {
  /**
   * Stable user ID loaded from DPAPI. Must be random UUID generated at install,
   * preserved through recovery. NEVER derived from username, SID, or email.
   * S4 §2.2: "Single stable user ID는 설치 때 무작위로 생성하고 SID에서 파생하지 않는다"
   */
  stableUserId: string;
  /** Organization ID from install manifest. */
  orgId: string;
  /** Roles assigned to the single local user. Default: institution-admin + worker. */
  roles?: ActorRole[];
}

export interface LocalSingleIdentity extends Identity {
  /** Memory-only bearer for same-origin Electron requests. Never persisted. */
  readonly bearer: string;
  /** Stable user ID from hashed username. No raw SID or email. */
  readonly stableUserId: string;
  /** Zeros memory and invalidates all further requests. */
  close(): void;
}

/** Generate a new stable user ID for install. Store result in DPAPI. */
export function generateStableUserId(): string {
  // 20 random bytes = 160 bits, base64url encoded
  return randomBytes(20).toString('base64url');
}

function generateOpaqueBearer(): { bearer: string; secretBytes: Uint8Array } {
  // 32 random bytes for 256-bit entropy, base64url encoded
  const secretBytes = randomBytes(32);
  const bearer = BEARER_PREFIX + secretBytes.toString('base64url');
  return { bearer, secretBytes };
}

export function createLocalSingleIdentity(config: LocalSingleIdentityConfig): LocalSingleIdentity {
  if (!config.orgId || config.orgId.trim().length === 0) {
    throw new Error('identity_invalid');
  }
  if (!config.stableUserId || config.stableUserId.trim().length === 0) {
    throw new Error('identity_invalid');
  }
  const stableUserId = config.stableUserId;
  const { bearer, secretBytes } = generateOpaqueBearer();
  const roles: ActorRole[] = config.roles ?? ['institution-admin', 'worker'];
  let closed = false;

  const actor: Actor = {
    kind: 'human',
    userId: stableUserId,
    orgId: config.orgId,
    roles,
    scopes: ['*'],
    authn: {
      source: 'single-local-bearer',
      assurance: 'app-lock',
      sessionId: null, // No session tracking for single user
    },
  };

  function verifyBearer(authorization: string): void {
    if (closed) throw new ActorAuthenticationError('identity closed');
    // Constant-time comparison to prevent timing attacks
    const expected = Buffer.from(bearer);
    const provided = Buffer.from(authorization.replace(/^Bearer\s+/i, ''));
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new ActorAuthenticationError('invalid bearer');
    }
  }

  return {
    bearer,
    stableUserId,

    async resolve(request: Request): Promise<Actor> {
      const authorization = request.headers.get('authorization');
      if (!authorization) throw new ActorAuthenticationError('missing authorization');
      verifyBearer(authorization);
      return actor;
    },

    async revokeAll(_userId: string, _reason: RevocationReason): Promise<void> {
      // Single user mode: revoke means close the service
      closed = true;
      secretBytes.fill(0);
    },

    async revokeSession(_sessionId: string, _reason: RevocationReason): Promise<void> {
      // No session tracking in single mode
    },

    close(): void {
      closed = true;
      secretBytes.fill(0);
    },
  };
}
