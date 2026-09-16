/**
 * supabase-workerd.test.ts 가 esbuild 로 묶어 miniflare(workerd) 안에서 돌리는 엔트리.
 *
 * 운영과 같은 배선을 그대로 쓴다 — createWorkerSupabaseIdentity(SUPABASE_AUTH_ORIGIN →
 * issuer·JWKS 파생) + adaptD1Environment(D1 바인딩 → Database). 테스트 전용 우회는 없다.
 * 응답은 { status, body } JSON 하나다 — 라우트가 아니라 신원 해석만 본다.
 */
import { adaptD1Environment } from '@ccc/db-d1';
import {
  ActorAuthenticationError,
  IdentityStoreUnavailableError,
} from '@ccc/contracts/runtime';
import { ForbiddenError } from '@ccc/core/gateway';
import type { ApiEnv } from '@ccc/http-api/identity';
import { createWorkerSupabaseIdentity, hasSupabaseBearerCredential } from '../../src/supabase-identity';

interface TestEnv extends ApiEnv {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    if (!hasSupabaseBearerCredential(request)) {
      return Response.json({ status: 401, body: 'no_bearer' });
    }
    const identity = createWorkerSupabaseIdentity(adaptD1Environment(env) as ApiEnv);
    if (identity === undefined) return Response.json({ status: 503, body: 'no_lane' });
    try {
      const actor = await identity.resolve(request);
      return Response.json({ status: 200, body: { userId: actor.userId, orgId: actor.orgId } });
    } catch (error) {
      if (error instanceof ActorAuthenticationError) return Response.json({ status: 401, body: 'auth' });
      if (error instanceof ForbiddenError) return Response.json({ status: 403, body: 'forbidden' });
      if (error instanceof IdentityStoreUnavailableError) return Response.json({ status: 503, body: 'store' });
      return Response.json({ status: 500, body: String(error) });
    }
  },
};
