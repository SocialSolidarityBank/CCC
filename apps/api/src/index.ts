import {
  listEmergencyConsentDeadlines,
  processParticipantPiiRetention,
  runPipelineWatchdog,
  type PipelineHealth,
} from '../../../db/gateway';
import { adaptD1Environment } from '@ccc/db-d1';
import { createR2AudioStore } from '@ccc/audio-r2';
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

 

/**
 * 폴링 워치독 1회 실행 (D8). 전 기관 건강도를 계산하고 stale인 기관마다 관리자 알림
 * 시임(notifyAdmins)을 호출한다. 계산·감사는 gateway(runPipelineWatchdog)가, 알림 발송
 * 판단은 여기가 담당한다. 테스트가 직접 부를 수 있도록 export한다.
 */
export async function runWatchdog(env: ApiEnv): Promise<PipelineHealth[]> {
  const healths = await runPipelineWatchdog(env);
  for (const health of healths) {
    if (health.stale) {
      await notifyAdmins(
        env,
        `pipeline stale for org ${health.orgId} [${health.staleReasons.join(', ')}]: `
          + `last poll ${health.lastPolledAt ?? 'never'}, last completion ${health.lastCompletedAt ?? 'never'}, `
          + `${health.pendingTotalCount} job(s) waiting (audio ${health.pendingJobCount}, text ${health.pendingTextWorkCount}), `
          + `oldest waiting ${health.oldestPendingHours ?? 0}h `
          + `(poll threshold ${health.thresholdHours}h, queue threshold ${health.queueThresholdHours}h)`,
      );
    }
  }
  await remindEmergencyConsentDeadlines(env);
  return healths;
}

/**
 * 긴급 등록의 ① 동의 보완 기한 알림 (G1). 워치독과 같은 주기를 탄다 — 알림 채널을 새로
 * 만들지 않고 기존 시임(notifyAdmins) 하나만 쓴다. 본문은 기관 ID·건수뿐이다(R3 · notify.ts 계약).
 * 실무자 개인에게 보내는 채널은 아직 없으므로(사이드바 배지 인프라 미구현) 현 단계는
 * 관리자 알림 + `GET /consent/follow-ups` 보완 대상 리포트가 그 자리를 맡는다.
 */
export async function remindEmergencyConsentDeadlines(env: ApiEnv): Promise<void> {
  for (const summary of await listEmergencyConsentDeadlines(env)) {
    await notifyAdmins(
      env,
      `emergency registration consent follow-up for org ${summary.orgId}: `
        + `${summary.overdue} overdue, ${summary.dueSoon} due soon`,
    );
  }
}

/** D32·D46 보존 생애주기. cron은 아카이브·재검토만 하고 파기하지 않는다. */
export async function runRetentionLifecycle(
  env: ApiEnv,
): Promise<{ attempted: number; archived: number; requeued: number }> {
  return processParticipantPiiRetention(env);
}

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
    const runtimeEnv = adaptWorkerEnvironment(env);
    if (controller.cron === PURGE_CRON) {
      ctx.waitUntil(runRetentionLifecycle(runtimeEnv));
      return;
    }
    if (controller.cron === WATCHDOG_CRON) {
      ctx.waitUntil(runWatchdog(runtimeEnv));
      return;
    }
    throw new Error('unexpected_scheduled_trigger');
  },
} satisfies ExportedHandler<ApiEnv>;
