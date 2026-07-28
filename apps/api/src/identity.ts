import { ForbiddenError, findUserByEmail, type Actor, type Env as GatewayEnv } from '../../../db/gateway';
import type { AiProviderRuntimeEnv } from './ai-provider';
import { verifyAccessJwt } from './access-jwt';

export interface ApiEnv extends GatewayEnv, AiProviderRuntimeEnv {
  /**
   * 상담 녹음 원본 임시 보관 버킷 (R2, wrangler.toml의 AUDIO_BUCKET 바인딩).
   * gateway는 D1 전용이므로(R1) R2 접근은 audio-store.ts에서만 이 바인딩을 쓴다.
   */
  AUDIO_BUCKET: R2Bucket;
  /**
   * Cloudflare Access 팀 도메인 (예: "ggbss.cloudflareaccess.com"). iss 검증과
   * JWKS 출처를 결정한다. Access 애플리케이션 생성 후 설정한다(D16).
   */
  ACCESS_TEAM_DOMAIN?: string;
  /**
   * Access 애플리케이션의 AUD 태그. JWT의 aud claim이 이 값을 포함해야 한다.
   * Access 애플리케이션 생성 후 대시보드에서 확인해 설정한다(D16).
   */
  ACCESS_AUD?: string;
  /**
   * 관리자 알림 웹훅 URL (Workers 시크릿, D8). Slack/Discord incoming webhook 등
   * `{"text": ...}` JSON POST를 받는 주소. 미설정이면 console.error 폴백만 동작한다.
   */
  NOTIFY_WEBHOOK_URL?: string;
  /**
   * 로컬 프리뷰 스위치(dev 전용, local-actor.ts). 'true' 이면서 위 Access env 가 전부
   * 비어 있을 때만 이메일 기반 로컬 리졸버가 활성화된다. [env.production.vars]에는
   * 정의하지 않는다 — Access 설정 존재가 2차 잠금이라 값이 새어 들어가도 열리지 않는다.
   */
  LOCAL_ACTOR_HEADER_MODE?: string;
  /** 로컬 프리뷰에서 신원으로 쓸 users 디렉터리 이메일(.dev.vars, local-actor.ts). */
  LOCAL_DEV_ACTOR_EMAIL?: string;
  /**
   * 미리보기 코드 게이트 스위치(CCC-6, preview-gate.ts). 'true' 이면서 위 Access env 가
   * 전부 비어 있을 때만 코드 게이트가 활성화된다. [env.preview.vars]에만 두고 운영
   * env 에는 정의하지 않는다 — Access 설정 존재가 2차 잠금이라 값이 새어 들어가도 열리지 않는다.
   */
  PREVIEW_MODE?: string;
  /** 미리보기 지정 코드(Workers 시크릿, preview-gate.ts). 값은 로그·응답에 싣지 않는다(이름만 커밋). */
  PREVIEW_ACCESS_CODE?: string;
  /** 미리보기 세션이 신원으로 쓸 고정 데모 실무자 이메일(users 디렉터리, preview-gate.ts). */
  PREVIEW_ACTOR_EMAIL?: string;
}

export class ActorAuthenticationError extends Error {}


/**
 * Cloudflare Access가 서명한 JWT(`Cf-Access-Jwt-Assertion`)를 검증하고,
 * 신원(email 또는 서비스 토큰 common_name)을 users 디렉터리에서 조회한다.
 * 로컬·테스트 헤더 인증은 배포 번들 밖의 테스트 전용 resolver가 담당한다.
 *
 * 401(ActorAuthenticationError): 헤더 없음 / Access env 미설정 / JWT 서명·iss·aud·exp 실패.
 * 403(ForbiddenError): JWT는 유효하나 디렉터리에 없거나 비활성인 신원(앱 프로비저닝 안 됨).
 */
export async function actorFromRequest(request: Request, env: ApiEnv): Promise<Actor> {

  // Access 설정이 없으면 계정 미개설 상태에서도 fail closed 한다(D16).
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const configuredAudiences = env.ACCESS_AUD
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (teamDomain === undefined || teamDomain.length === 0 || configuredAudiences === undefined || configuredAudiences.length === 0) {
    throw new ActorAuthenticationError('Cloudflare Access env vars are not configured');
  }

  const token = (
    request.headers.get('Cf-Access-Jwt-Assertion')
    ?? request.headers.get('X-CCC-Access-Jwt')
  )?.trim();
  if (token === undefined || token.length === 0) {
    throw new ActorAuthenticationError('a Cloudflare Access JWT assertion is required');
  }

  let email: string | undefined;
  try {
    const claims = await verifyAccessJwt(token, { teamDomain, aud: configuredAudiences });
    // 사람 로그인은 email, 서비스 토큰은 common_name을 싣는다(email 없음).
    email = claims.email ?? claims.common_name;
  } catch {
    // 서명·iss·aud·exp 등 검증 실패는 세부 사유를 노출하지 않고 401로 통일한다.
    throw new ActorAuthenticationError('Cloudflare Access JWT verification failed');
  }

  if (email === undefined || email.trim().length === 0) {
    throw new ActorAuthenticationError('Access JWT is missing an email or common_name claim');
  }

  const user = await findUserByEmail(env, email.trim());
  if (user === null || !user.active) {
    throw new ForbiddenError('authenticated identity is not provisioned in the app user directory');
  }

  return { userId: user.id, orgId: user.orgId, role: user.role };
}
