import { purgeExpiredParticipantPii, runPipelineWatchdog, type PipelineHealth } from '../../../db/gateway';
import { type ApiEnv } from './identity';
import { localDevActorResolver } from './local-actor';
import { notifyAdmins } from './notify';
import { handlePreviewUnlock, previewActorResolver } from './preview-gate';
import { handleRequest } from './request-handler';

export { handleRequest } from './request-handler';
export {
  CodexProviderAdapter,
  type AiProviderAdapter,
  type AiProviderConfig,
  type AiProviderMetadata,
} from './ai-provider';

import { PURGE_CRON, WATCHDOG_CRON } from './cron-schedule';

/**
 * 폴링 워치독 1회 실행 (D8). 전 조직 건강도를 계산하고 stale인 조직마다 관리자 알림
 * 시임(notifyAdmins)을 호출한다. 계산·감사는 gateway(runPipelineWatchdog)가, 알림 발송
 * 판단은 여기가 담당한다. 테스트가 직접 부를 수 있도록 export한다.
 */
export async function runWatchdog(env: ApiEnv): Promise<PipelineHealth[]> {
  const healths = await runPipelineWatchdog(env);
  for (const health of healths) {
    if (health.stale) {
      await notifyAdmins(
        env,
        `pipeline stale for org ${health.orgId}: last poll ${health.lastPolledAt ?? 'never'}, `
          + `${health.pendingJobCount} job(s) waiting (threshold ${health.thresholdHours}h)`,
      );
    }
  }
  return healths;
}

/** Canonical participant PII purge (D10), safe for scheduled execution and direct tests. */
export async function runPurge(env: ApiEnv): Promise<{ attempted: number; purged: number; noops: number }> {
  return purgeExpiredParticipantPii(env);
}

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    // 미리보기 코드 게이트(CCC-6, 이중 잠금)에서만 리졸버가 반환된다. 활성이면
    // /preview/unlock(코드 제출)을 여기서 처리하고, 그 외 요청은 쿠키 토큰 검증
    // 리졸버로 handleRequest 에 넘긴다. 비활성이면 아래로 흘러 운영 경로 불변.
    const previewResolver = previewActorResolver(env);
    if (previewResolver !== undefined) {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/preview/unlock') {
        return handlePreviewUnlock(request, env);
      }
      return handleRequest(request, env, previewResolver);
    }
    // 로컬 프리뷰(dev 이중 잠금)에서만 리졸버가 반환된다. undefined 면 기본
    // Access JWT 검증(actorFromRequest)으로 그대로 흘러간다 — 운영 경로 불변.
    return handleRequest(request, env, localDevActorResolver(env) ?? undefined);
  },
  // Cron trigger: only exact configured expressions may enqueue D8 or D10 work.
  async scheduled(controller: ScheduledController, env: ApiEnv, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === PURGE_CRON) {
      ctx.waitUntil(runPurge(env));
      return;
    }
    if (controller.cron === WATCHDOG_CRON) {
      ctx.waitUntil(runWatchdog(env));
      return;
    }
    throw new Error('unexpected_scheduled_trigger');
  }
} satisfies ExportedHandler<ApiEnv>;
