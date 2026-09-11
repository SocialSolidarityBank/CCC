import { adaptD1Environment } from '@ccc/db-d1';
import { createR2AudioStore } from '@ccc/audio-r2';
import { createEnvironmentSecretStore, SECRET_NAMES } from '@ccc/secrets-env';
import type { SecretName, ScheduledJobKind } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import { localDevActorResolver } from './local-actor';
import { handlePreviewUnlock, previewActorResolver } from '@ccc/http-api/preview-gate';
import { handleRequest } from '@ccc/http-api';
import { runCounselingMemory } from '@ccc/http-api/counseling-memory-runner';
import { createScheduledJobRunner } from '@ccc/core/scheduled-job-runner';
import { createAccessIdentity } from '@ccc/identity-access';

import { AUDIO_EXPIRY_CRON, MEMORY_CRON, PURGE_CRON, WATCHDOG_CRON } from './cron-schedule';

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
  [MEMORY_CRON]: 'counseling_memory',
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
    const identity = createAccessIdentity(runtimeEnv);
    return handleRequest(request, runtimeEnv, (nextRequest) => identity.resolve(nextRequest));
  },
  // Cron trigger: only exact configured expressions may enqueue D8 or D10 work.
  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const kind = CRON_JOBS[controller.cron];
    if (kind === undefined) throw new Error('unexpected_scheduled_trigger');
    const nowIso = new Date(controller.scheduledTime ?? Date.now()).toISOString();
    const runtimeEnv = adaptWorkerEnvironment(env);
    if (runtimeEnv.audioStore === null) throw new Error('scheduled_audio_store_unavailable');
    ctx.waitUntil(createScheduledJobRunner({ ...runtimeEnv, audioStore: runtimeEnv.audioStore }, () => runCounselingMemory(runtimeEnv)).run(kind, nowIso));
  },
} satisfies ExportedHandler<WorkerEnv>;
