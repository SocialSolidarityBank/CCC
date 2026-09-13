import {
  ForbiddenError,
  ValidationError,
  resolveDirectoryActorByAuthSubject,
  revokeActorSessions,
  revokeIdentitySession,
  type AuthenticatedIdentityClaims,
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

/** 자격에서 Bearer 하나만 꺼낸다. 형태가 다르면 전부 같은 인증 실패다. */
function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization');
  const match = authorization === null ? null : /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  if (match?.[1] === undefined) throw new ActorAuthenticationError('a Bearer credential is required');
  return match[1];
}

/** 신원 어댑터에 첫 로그인 연결용 claim 검증만 더한 형태. MFA 관문·디렉터리 조회는 `resolve` 에만 있다. */
export interface SupabaseIdentity extends Identity {
  verifyLinkClaims(request: Request): Promise<AuthenticatedIdentityClaims>;
}

/** Keep one instance per trusted installation so requests share its bounded signing-key cache. */
export function createSupabaseIdentity(env: GatewayEnv, config: SupabaseIdentityConfig): SupabaseIdentity {
  const verify = createVerifier(config);
  return {
    async resolve(request) {
      const claims = await verify(bearerToken(request));
      // MFA 는 선택이다(D89). aal1 세션도 업무를 본다. 실제 보증 수준은 그대로 기록한다.
      const actor = await directoryOperation(() => {
        const directoryEnv = config.databaseForSession === undefined
          ? env
          : { ...env, DB: config.databaseForSession(claims.sub, claims.sessionId) };
        return resolveDirectoryActorByAuthSubject(directoryEnv, claims.sub, {
          source: 'supabase-jwt', assurance: claims.aal, sessionId: claims.sessionId,
        }, claims.issuedAt);
      });
      if (actor === null || actor.kind !== 'human' || actor.orgId === null) {
        throw new ForbiddenError('authenticated identity is not available in the app user directory');
      }
      return actor;
    },
    // 첫 로그인 연결은 MFA 등록 전(aal1)에 일어나므로 MFA 관문을 지나지 않는다. 이메일 통제는
    // 토큰이 아니라 설치가 증명한다 — Auth 가 이메일 확인을 요구해야 하고 doctor 가 이를 막는다.
    async verifyLinkClaims(request) {
      const claims = await verify(bearerToken(request));
      return { subject: claims.sub, email: claims.email, issuedAt: claims.issuedAt };
    },
    revokeAll(userId, reason) {
      return directoryOperation(() => revokeActorSessions(env, userId, reason));
    },
    revokeSession(sessionId, reason) {
      return directoryOperation(() => revokeIdentitySession(env, sessionId, reason));
    },
  };
}
