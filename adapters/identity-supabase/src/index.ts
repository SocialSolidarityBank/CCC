import {
  ForbiddenError,
  ValidationError,
  resolveDirectoryActorByAuthSubject,
  revokeActorSessions,
  revokeIdentitySession,
  type Env as GatewayEnv,
} from '@ccc/core/gateway';
import {
  ActorAuthenticationError,
  IdentityStoreUnavailableError,
  MfaRequiredError,
  type Identity,
} from '@ccc/contracts/runtime';
import { createVerifier } from './verifier';
import type { Database } from '@ccc/contracts/database';

/** Trusted installation configuration, never derived from a JWT or public bootstrap. */
export interface SupabaseIdentityConfig {
  issuer: string;
  jwksUri: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Installation-owned database scope, invoked only after signature and MFA verification. */
  databaseForSession?: (subject: string, sessionId: string) => Database;
}

async function directoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) throw error;
    throw new IdentityStoreUnavailableError('identity store unavailable');
  }
}

/** Keep one instance per trusted installation so requests share its bounded signing-key cache. */
export function createSupabaseIdentity(env: GatewayEnv, config: SupabaseIdentityConfig): Identity {
  const verify = createVerifier(config);
  return {
    async resolve(request) {
      const authorization = request.headers.get('Authorization');
      const match = authorization === null ? null : /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
      if (match === null || match[1] === undefined) throw new ActorAuthenticationError('a Bearer credential is required');
      const claims = await verify(match[1]);
      if (claims.aal !== 'aal2') throw new MfaRequiredError('MFA is required');
      const actor = await directoryOperation(() => {
        const directoryEnv = config.databaseForSession === undefined
          ? env
          : { ...env, DB: config.databaseForSession(claims.sub, claims.sessionId) };
        return resolveDirectoryActorByAuthSubject(directoryEnv, claims.sub, {
          source: 'supabase-jwt', assurance: 'aal2', sessionId: claims.sessionId,
        }, claims.issuedAt);
      });
      if (actor === null || actor.kind !== 'human' || actor.orgId === null) {
        throw new ForbiddenError('authenticated identity is not available in the app user directory');
      }
      return actor;
    },
    revokeAll(userId, reason) {
      return directoryOperation(() => revokeActorSessions(env, userId, reason));
    },
    revokeSession(sessionId, reason) {
      return directoryOperation(() => revokeIdentitySession(env, sessionId, reason));
    },
  };
}
