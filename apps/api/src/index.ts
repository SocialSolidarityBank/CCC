import { adaptD1Environment } from '@ccc/db-d1';
import { createR2AudioStore } from '@ccc/audio-r2';
import type { ScheduledJobKind } from '@ccc/contracts/runtime';
import { type ApiEnv } from './identity';
import { localDevActorResolver } from './local-actor';
import { handlePreviewUnlock, previewActorResolver } from './preview-gate';
import { handleRequest } from './request-handler';
import { createScheduledJobRunner } from './scheduled-job-runner';

export { handleRequest } from './request-handler';
export {
  CodexProviderAdapter,
  type AiProviderAdapter,
  type AiProviderConfig,
  type AiProviderMetadata,
} from './ai-provider';

import { PURGE_CRON, WATCHDOG_CRON } from './cron-schedule';

function adaptWorkerEnvironment(env: ApiEnv): ApiEnv {
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
};

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
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
    // 로컬 프리뷰(dev 이중 잠금)에서만 리졸버가 반환된다. undefined 면 기본
    // Access JWT 검증(actorFromRequest)으로 그대로 흘러간다 — 운영 경로 불변.
    return handleRequest(request, runtimeEnv, localDevActorResolver(runtimeEnv) ?? undefined);
  },
  // Cron trigger: only exact configured expressions may enqueue D8 or D10 work.
  async scheduled(controller: ScheduledController, env: ApiEnv, ctx: ExecutionContext): Promise<void> {
    const kind = CRON_JOBS[controller.cron];
    if (kind === undefined) throw new Error('unexpected_scheduled_trigger');
    const nowIso = new Date(controller.scheduledTime ?? Date.now()).toISOString();
    ctx.waitUntil(createScheduledJobRunner(adaptWorkerEnvironment(env)).run(kind, nowIso));
  },
} satisfies ExportedHandler<ApiEnv>;
