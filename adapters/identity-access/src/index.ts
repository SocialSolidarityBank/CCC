import {
  ForbiddenError,
  ValidationError,
  resolveDirectoryActorByPrincipal,
  revokeActorSessions,
  revokeIdentitySession,
  type Env as GatewayEnv,
} from '@ccc/core/gateway';
import {
  ActorAuthenticationError,
  IdentityStoreUnavailableError,
  type Identity,
  type RevocationReason,
} from '@ccc/contracts/runtime';
import { AccessJwksUnavailableError, verifyAccessJwt } from './access-jwt';

export * from './access-jwt';

export interface AccessIdentityEnv extends GatewayEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

async function unavailable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActorAuthenticationError || error instanceof ValidationError) throw error;
    throw new IdentityStoreUnavailableError('identity store unavailable');
  }
}

/** Transitional Cloudflare Access Identity. E2-7 removes it after the final Bearer cutover. */
export function createAccessIdentity(env: AccessIdentityEnv): Identity {
  return {
    async resolve(request) {
      const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
      const audiences = env.ACCESS_AUD?.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
      if (teamDomain === undefined || teamDomain.length === 0 || audiences === undefined || audiences.length === 0) {
        throw new ActorAuthenticationError('Cloudflare Access env vars are not configured');
      }
      const token = (request.headers.get('Cf-Access-Jwt-Assertion') ?? request.headers.get('X-CCC-Access-Jwt'))?.trim();
      if (token === undefined || token.length === 0) {
        throw new ActorAuthenticationError('a Cloudflare Access JWT assertion is required');
      }

      let principal: string | undefined;
      let credentialIssuedAt: string | null = null;
      try {
        const claims = await verifyAccessJwt(token, { teamDomain, aud: audiences });
        principal = claims.email ?? claims.common_name;
        if (typeof claims.iat === 'number' && Number.isFinite(claims.iat)) {
          const issuedAt = new Date(claims.iat * 1000);
          if (!Number.isNaN(issuedAt.getTime()) && issuedAt.getTime() <= Date.now() + 60_000) {
            credentialIssuedAt = issuedAt.toISOString();
          }
        }
      } catch (error) {
        if (error instanceof AccessJwksUnavailableError) {
          throw new IdentityStoreUnavailableError('JWKS unavailable');
        }
        throw new ActorAuthenticationError('Cloudflare Access JWT verification failed');
      }
      if (principal === undefined || principal.trim().length === 0) {
        throw new ActorAuthenticationError('Access JWT is missing an email or common_name claim');
      }

      const actor = await unavailable(() => resolveDirectoryActorByPrincipal(env, principal, {
        source: 'cloudflare-access',
        assurance: 'none',
        sessionId: null,
      }, credentialIssuedAt));
      if (actor === null) throw new ForbiddenError('authenticated identity is not provisioned in the app user directory');
      return actor;
    },
    revokeAll(userId: string, reason: RevocationReason) {
      return unavailable(() => revokeActorSessions(env, userId, reason));
    },
    revokeSession(sessionId: string, reason: RevocationReason) {
      return unavailable(() => revokeIdentitySession(env, sessionId, reason));
    },
  };
}
