import { describe, expect, it } from 'vitest';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import { localDevActorResolver } from '../src/local-actor';

// 이중 잠금 게이트만 검증한다(순수 로직, DB 불요). 디렉터리 조회 경로는
// 로컬 프리뷰 기동 자체가 실사용 검증이다.
function env(overrides: Partial<ApiEnv>): ApiEnv {
  return overrides as ApiEnv;
}

describe('localDevActorResolver 이중 잠금', () => {
  it('플래그가 없으면 비활성(undefined) — 기본 Access 검증으로 흐른다', () => {
    expect(localDevActorResolver(env({}))).toBeUndefined();
    expect(localDevActorResolver(env({ LOCAL_ACTOR_HEADER_MODE: 'false' }))).toBeUndefined();
  });

  it('플래그가 있어도 Access 설정이 하나라도 있으면 비활성 — 2차 잠금', () => {
    expect(
      localDevActorResolver(env({ LOCAL_ACTOR_HEADER_MODE: 'true', ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com' })),
    ).toBeUndefined();
    expect(
      localDevActorResolver(env({ LOCAL_ACTOR_HEADER_MODE: 'true', ACCESS_AUD: 'aud-tag' })),
    ).toBeUndefined();
  });

  it('플래그 ON + Access 미설정에서만 리졸버가 반환되고, 이메일 미설정이면 401', async () => {
    const resolver = localDevActorResolver(env({ LOCAL_ACTOR_HEADER_MODE: 'true' }));
    expect(resolver).toBeTypeOf('function');
    await expect(
      resolver!(new Request('http://localhost/health'), env({ LOCAL_ACTOR_HEADER_MODE: 'true' })),
    ).rejects.toBeInstanceOf(ActorAuthenticationError);
  });
});
