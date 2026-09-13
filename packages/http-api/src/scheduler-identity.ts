import type { Actor, SecretStore } from '@ccc/contracts/runtime';
import type { ActorResolver } from './request-handler';

/**
 * S2 §2.6 · S11 §2.8 (2026-09-12 Q 확정). Cloud scheduler 의 자격은 rotating 공유 비밀
 * `SCHEDULER_SECRET` 하나다. bearer 가 그 값과 같을 때만 system Actor 를 만들고, 그 밖의
 * 모든 경우(비밀 부재, bearer 아님, 값 불일치)는 안쪽 resolver 로 그대로 넘긴다 —
 * 어느 쪽에서 갈렸는지 응답으로 드러내지 않는다.
 */
export interface SchedulerSecretResolverOptions {
  secretStore: SecretStore;
  /** 설치 기관. scheduler Actor 의 `orgId` 이며 기관 밖 데이터는 이 값으로 막힌다. */
  organizationId: string;
  inner: ActorResolver;
}

const BEARER = /^Bearer ([^\s,]+)$/;

/**
 * 길이에서도 내용에서도 조기 반환하지 않도록 두 값을 고정 길이 SHA-256 으로 바꾼 뒤
 * 전 byte 를 XOR 누적해 한 번에 판정한다. 비밀 값은 비교 밖으로 나가지 않는다.
 */
async function secretsEqual(candidate: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const digests = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const left = new Uint8Array(digests[0]);
  const right = new Uint8Array(digests[1]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

export function createSchedulerSecretResolver(options: SchedulerSecretResolverOptions): ActorResolver {
  return async (request, env) => {
    const bearer = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (bearer === undefined) return options.inner(request, env);
    // 비밀이 없는 설치에는 scheduler lane 자체가 없다.
    const secret = await options.secretStore.get('SCHEDULER_SECRET');
    if (secret === null || !await secretsEqual(bearer, secret)) return options.inner(request, env);
    return {
      kind: 'system',
      userId: 'system:scheduler',
      orgId: options.organizationId,
      roles: ['service'],
      scopes: ['scheduler:run', '/internal/storage/authorize'],
      authn: { source: 'scheduler-secret', assurance: 'none', sessionId: null },
    } satisfies Actor;
  };
}
