import { resolveAgentBearer } from '@ccc/core/gateway';
import type { ActorResolver } from './request-handler';

/**
 * S2 §2.2 L64 · E6-4. Agent 의 자격은 페어링 뒤 발급한 opaque bearer 하나이며 사람용
 * bearer 와 섞지 않는다. 제시된 값의 hash 가 `agent_credentials` 의 bearer 행에 있을
 * 때만 이 레인이 Agent Actor 를 만들고, 없으면 사람 신원 resolver 로 그대로 흘려보낸다
 * — 사람 JWT 도 같은 `Authorization: Bearer` 를 쓰므로 여기서 갈라져도 응답은 같다.
 *
 * 자격이 이 표에 있는데 만료·소비·폐기됐거나 연결 users 행이 계약과 다르면 gateway 가
 * 각각 401·403 을 던진다. 그 판정을 사람 레인으로 내려보내 다시 물어보지 않는다.
 */
export interface AgentBearerResolverOptions {
  inner: ActorResolver;
}

/** Agent bearer 는 32바이트 base64url(43자)뿐이다. JWT(점 포함)는 이 레인에 닿지 않아 사람 요청은 자격 표를 읽지 않는다. */
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

export function createAgentBearerResolver(options: AgentBearerResolverOptions): ActorResolver {
  return async (request, env) => {
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer === undefined) return options.inner(request, env);
    return await resolveAgentBearer(env, bearer) ?? options.inner(request, env);
  };
}
