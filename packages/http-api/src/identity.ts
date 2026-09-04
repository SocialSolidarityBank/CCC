import { ForbiddenError, type Actor as GatewayActor, type Env as GatewayEnv } from '@ccc/core/gateway';
import type { AiProviderRuntimeEnv } from '@ccc/ai-runtime';
import type { Actor as IdentityActor, AudioStore } from '@ccc/contracts/runtime';
import type { NotifyEnv } from '@ccc/core/notify';

export interface ApiEnv extends GatewayEnv, AiProviderRuntimeEnv, NotifyEnv {
  /** Runtime-neutral original-audio storage port; provider bindings stay in composition roots. */
  audioStore: AudioStore;
  /**
   * Cloudflare Access adapter와 preview/local 이중 잠금이 읽는 공개 설정.
   * 검증 구현은 `adapters/identity-access`; http-api는 값만 전달한다.
   */
  ACCESS_TEAM_DOMAIN?: string;
  /** 쉼표로 나눈 Access 애플리케이션 AUD 태그. */
  ACCESS_AUD?: string;
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
  /**
   * 미리보기 **관리자 시점** 지정 코드(Workers 시크릿, preview-gate.ts). 값은 로그·응답에
   * 싣지 않는다(이름만 커밋). 설정하지 않으면 관리자 경로 자체가 없다 — 팀원용 실무자 코드만
   * 동작하므로, 이 값을 안 넣는 것이 곧 "관리자 시점 없음" 이다.
   */
  PREVIEW_ADMIN_ACCESS_CODE?: string;
  /** 위 관리자 코드로 들어왔을 때 쓸 기관 관리자 이메일(users 디렉터리, preview-gate.ts). */
  PREVIEW_ADMIN_ACTOR_EMAIL?: string;
  /**
   * 미리보기 **종단 점검(E2E) 코드**(Workers 시크릿, preview-gate.ts). 미리보기에는
   * Access 서비스 토큰이 없어 `service` 역할이 될 수 없고, 그래서 "수기 저장 → 장비
   * 마스킹 → 불일치 검출" 종단 경로를 실물로 확인할 수 없다(D57·ADR-0027). 이 코드로
   * 들어오면 `X-CCC-Preview-Actor` 헤더로 신원을 고를 수 있다 — 단 아래 세 이메일
   * 변수에 적힌 값만 허용된다. 설정하지 않으면 이 경로 자체가 없다.
   */
  PREVIEW_E2E_ACCESS_CODE?: string;
  /** E2E 코드의 기본 신원 — 처리 장비 역할(users 디렉터리의 role='service' 행). */
  PREVIEW_SERVICE_ACTOR_EMAIL?: string;
  /**
   * 공개 가입 표면 스위치(CCC-112 · P0-2, request-handler.ts). 정확히 '1'일 때만
   * 공개 초대 조회·가입 라우트(와 초대 발급)가 열리고, 없거나 다른 값이면 404 로
   * fail closed 한다. [env.preview.vars] 에만 "1" 로 두고 운영 env 에는 정의하지
   * 않는다 — 없음이 곧 닫힘이다(EXTERNAL_AI_CALLS_ENABLED 와 같은 규약).
   */
  PUBLIC_SIGNUP_ENABLED?: string;
  /**
   * signed install manifest JSON 원문(S2 §2.7, E1-7). `GET /capabilities` 의 mode, installationId,
   * approved STT registry 는 이 값을 `CCC_INSTALL_SIGNING_KEYS` 로 검증한 결과에서만 읽는다.
   * 둘 중 하나라도 없거나 검증에 실패하면 503 으로 닫힌다. 설치기(E6/E7/E8)가 채운다.
   */
  CCC_INSTALL_MANIFEST?: string;
  /** `{ "<keyId>": "<base64 raw Ed25519 public key>" }`. 공개키뿐이라 시크릿이 아니다. */
  CCC_INSTALL_SIGNING_KEYS?: string;
  /** 관리자가 고른 STT 축(`off | local | azure`). 없거나 다른 값이면 `off`. 실제 선택은 registry·키·Agent 가 정한다. */
  CCC_STT_MODE?: string;
  /** 관리자가 고른 LLM 축(`off | openai`). 없거나 다른 값이면 `off`. */
  CCC_LLM_MODE?: string;
}


/**
 * E4-1 migration boundary. Identity adapters are canonical; the current gateway still consumes one
 * legacy role. Remove this projection when gateway authorization moves to canonical multi-role Actor.
 */
export function gatewayActorFromIdentity(actor: IdentityActor): GatewayActor {
  if (actor.orgId === null) throw new ForbiddenError('system actor is not allowed on business routes');
  if (actor.roles.includes('service')) return { userId: actor.userId, orgId: actor.orgId, role: 'service' };
  if (actor.roles.includes('institution-admin')) return { userId: actor.userId, orgId: actor.orgId, role: 'admin' };
  if (actor.roles.includes('worker') || actor.roles.includes('supervisor')) {
    return { userId: actor.userId, orgId: actor.orgId, role: 'counselor' };
  }
  throw new ForbiddenError('identity has no business role');
}
