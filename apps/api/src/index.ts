import { adaptD1Environment } from '@ccc/db-d1';
import { createR2AudioStore } from '@ccc/audio-r2';
import { createEnvironmentSecretStore, SECRET_NAMES } from '@ccc/secrets-env';
import type { SecretName, ScheduledJobKind } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import { localDevActorResolver } from './local-actor';
import { handlePreviewUnlock, previewActorResolver } from '@ccc/http-api/preview-gate';
import { handleRequest } from '@ccc/http-api';
import { createScheduledJobRunner } from '@ccc/core/scheduled-job-runner';
import { createAccessIdentity } from '@ccc/identity-access';
import { createAgentBearerResolver } from '@ccc/http-api/agent-identity';
import { createWorkerSupabaseIdentity, hasSupabaseBearerCredential } from './supabase-identity';

import { AUDIO_EXPIRY_CRON, PURGE_CRON, WATCHDOG_CRON } from './cron-schedule';

/** Raw provider bindings exist only at the Workers composition boundary. */
type WorkerEnv = Omit<ApiEnv, 'secretStore'> & Partial<Record<SecretName, string>> & Pick<Partial<ApiEnv>, 'secretStore'>;

function adaptWorkerEnvironment(bindings: WorkerEnv): ApiEnv {
  // Strip descriptors without evaluating key getters; only SecretStore.get may read them.
  const descriptors = Object.getOwnPropertyDescriptors(bindings);
  for (const name of Object.keys(SECRET_NAMES)) delete descriptors[name];
  const runtime = Object.defineProperties({}, descriptors) as Omit<WorkerEnv, SecretName>;
  const env: ApiEnv = {
    ...runtime,
    secretStore: runtime.secretStore ?? createEnvironmentSecretStore(bindings),
  };
  const environment = env.audioStore === undefined
    ? {
        ...env,
        audioStore: createR2AudioStore(
          (env as ApiEnv & { AUDIO_BUCKET: R2Bucket }).AUDIO_BUCKET,
        ),
      }
    : env;
  const { DB: database } = environment;
  if (database === undefined) return environment;
  return adaptD1Environment(environment);
}

/** wrangler.toml [triggers].crons 와 1:1. 여기 없는 표현식은 fail-closed 다. */
const CRON_JOBS: Record<string, ScheduledJobKind> = {
  [WATCHDOG_CRON]: 'pipeline_watchdog',
  [PURGE_CRON]: 'pii_retention',
  [AUDIO_EXPIRY_CRON]: 'audio_expiry',
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const runtimeEnv = adaptWorkerEnvironment(env);
    // 미리보기 코드 게이트(CCC-6, 이중 잠금)에서만 리졸버가 반환된다. 활성이면
    // /preview/unlock(코드 제출)을 여기서 처리하고, 그 외 요청은 쿠키 토큰 검증
    // 리졸버로 handleRequest 에 넘긴다. 비활성이면 아래로 흘러 운영 경로 불변.
    const previewResolver = previewActorResolver(runtimeEnv);
    if (previewResolver !== undefined) {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/preview/unlock') {
        return handlePreviewUnlock(request, runtimeEnv);
      }
      return handleRequest(request, runtimeEnv, previewResolver);
    }
    // Preview keeps its isolated resolver; authenticated metadata retains the full canonical role set.
    const localResolver = localDevActorResolver(runtimeEnv);
    if (localResolver !== undefined) return handleRequest(request, runtimeEnv, localResolver);
    // S2 §2.2 L64: agent-bearer 레인이 사람 신원 앞에 온다. bearer 가 Agent 자격이
    // 아니면 그대로 아래로 흐르므로 사람 경로 동작은 바뀌지 않는다.
    //
    // 사람 신원은 둘이다(앱 직접 로그인 도입, Access 제거는 별도 결정):
    //   - Authorization: Bearer <JWT> 형태 → Supabase 레인. 검증된 sub 를 users
    //     디렉터리의 auth_subject 와 대조해(resolveDirectoryActorByAuthSubject)
    //     등재·활성·미해지 사람만 Actor 가 된다. Supabase 계정 존재만으로는 안 된다.
    //   - 그 외 → Access 레인(Cf-Access-Jwt-Assertion / X-CCC-Access-Jwt).
    // Bearer JWT 를 먼저 보는 이유: 웹이 싣는 사람 자격이 그것 하나이고, 형태가
    // 다른 자격을 Supabase 검증기에 내면 의미 없는 401 이 된다. Supabase 레인이
    // 없으면(SUPABASE_AUTH_ORIGIN 미설정) Bearer JWT 도 Access 레인으로 흘러 401 — 없음이 곧 닫힘.
    const supabase = createWorkerSupabaseIdentity(runtimeEnv);
    if (supabase !== undefined) {
      // 초대 수락(POST /staff-invites/token/:token/accept)이 요구하는 신원 연결 포트.
      // 이 배선이 없으면 그 라우트는 404 로 닫힌다(포트 부재 = 표면 없음).
      runtimeEnv.verifyIdentityLinkClaims = (linkRequest) => supabase.verifyLinkClaims(linkRequest);
    }
    const identity = createAccessIdentity(runtimeEnv);
    return handleRequest(request, runtimeEnv, createAgentBearerResolver({
      inner: (nextRequest) => (
        supabase !== undefined && hasSupabaseBearerCredential(nextRequest)
          ? supabase.resolve(nextRequest)
          : identity.resolve(nextRequest)
      ),
    }));
  },
  // Cron trigger: only exact configured expressions may enqueue D8 or D10 work.
  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const kind = CRON_JOBS[controller.cron];
    if (kind === undefined) throw new Error('unexpected_scheduled_trigger');
    const nowIso = new Date(controller.scheduledTime ?? Date.now()).toISOString();
    const runtimeEnv = adaptWorkerEnvironment(env);
    if (runtimeEnv.audioStore === null) throw new Error('scheduled_audio_store_unavailable');
    ctx.waitUntil(createScheduledJobRunner({ ...runtimeEnv, audioStore: runtimeEnv.audioStore }).run(kind, nowIso));
  },
} satisfies ExportedHandler<WorkerEnv>;
