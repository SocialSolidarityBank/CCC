/**
 * 로컬 프리뷰 전용 액터 리졸버 (운영 무영향 — 이중 잠금).
 *
 * 배경: 배포 워커의 신원은 Cloudflare Access JWT 검증(identity.ts)뿐이라 브라우저
 * 로컬 실행(next dev + wrangler dev)은 항상 401 이었다. 로컬에서 화면을 눌러 보려면
 * 개발 환경에서만 열리는 신원 공급 경로가 필요하다.
 *
 * 이중 잠금:
 *   ① LOCAL_ACTOR_HEADER_MODE === 'true' — wrangler.toml 최상위 [vars](로컬 dev)에만
 *      있고 [env.production.vars] 에는 없다(named env 는 vars 를 상속하지 않는다).
 *   ② Access 설정(ACCESS_TEAM_DOMAIN·ACCESS_AUD)이 하나라도 있으면 무조건 비활성 —
 *      운영에 ①이 실수로 새어 들어가도 열리지 않는다.
 *
 * 신원은 헤더가 아니라 LOCAL_DEV_ACTOR_EMAIL(.dev.vars) → users 디렉터리 조회로 정한다.
 * 디렉터리에 없거나 비활성이면 403 — 권한 모델은 로컬에서도 그대로 작동한다.
 */
import { findUserByEmail, ForbiddenError, type Actor } from '@ccc/core/gateway';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import type { ActorResolver } from '@ccc/http-api';

export function localDevActorResolver(env: ApiEnv): ActorResolver | undefined {
  if (env.LOCAL_ACTOR_HEADER_MODE !== 'true') return undefined;
  const accessConfigured = (env.ACCESS_TEAM_DOMAIN?.trim().length ?? 0) > 0
    || (env.ACCESS_AUD?.trim().length ?? 0) > 0;
  if (accessConfigured) return undefined;

  return async (_request: Request, runtimeEnv: ApiEnv): Promise<Actor> => {
    const email = runtimeEnv.LOCAL_DEV_ACTOR_EMAIL?.trim();
    if (email === undefined || email.length === 0) {
      throw new ActorAuthenticationError('LOCAL_DEV_ACTOR_EMAIL is required for local preview identity');
    }
    const user = await findUserByEmail(runtimeEnv, email);
    if (user === null || !user.active) {
      throw new ForbiddenError('local preview identity is not provisioned in the user directory');
    }
    return { userId: user.id, orgId: user.orgId, role: user.role };
  };
}
