import {
  listEmergencyConsentDeadlines,
  processParticipantPiiRetention,
  runPipelineWatchdog,
  type PipelineHealth,
  type Env,
} from './gateway';
import type { JobReport, ScheduledJobKind, ScheduledJobRunner } from '@ccc/contracts/runtime';
import { notifyAdmins, type NotifyEnv } from './notify';

export type ScheduledJobEnv = Env & NotifyEnv;

/**
 * 폴링 워치독 1회 실행 (D8). 전 기관 건강도를 계산하고 stale인 기관마다 관리자 알림
 * 시임(notifyAdmins)을 호출한다. 계산·감사는 gateway(runPipelineWatchdog)가, 알림 발송
 * 판단은 여기가 담당한다. 테스트가 직접 부를 수 있도록 export한다.
 */
export async function runWatchdog(env: ScheduledJobEnv): Promise<PipelineHealth[]> {
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
export async function remindEmergencyConsentDeadlines(env: ScheduledJobEnv): Promise<void> {
  for (const summary of await listEmergencyConsentDeadlines(env)) {
    await notifyAdmins(
      env,
      `emergency registration consent follow-up for org ${summary.orgId}: `
        + `${summary.overdue} overdue, ${summary.dueSoon} due soon`,
    );
  }
}

async function jobCounters(env: ScheduledJobEnv, kind: ScheduledJobKind, nowIso: string): Promise<Record<string, number>> {
  switch (kind) {
    case 'pipeline_watchdog': {
      const healths = await runWatchdog(env);
      return { orgs: healths.length, stale: healths.filter((health) => health.stale).length };
    }
    case 'pii_retention':
      return processParticipantPiiRetention(env, { at: nowIso });
    default:
      // audio_expiry 는 E5-6 이 audio_objects.purge_due 와 몸체를 만들기 전까지 fail-closed 다.
      throw new Error('unsupported_scheduled_job');
  }
}

/**
 * 예약 작업 몸체의 단일 입구. Workers cron 도, 나중의 Local 프로세스 타이머와 Supabase
 * tick 도 이 runner 만 부른다. 워치독은 gateway 가 자기 시계를 쓰므로 `nowIso` 를 받지 않는다.
 * 보존 생애주기(D32·D46)는 예약 시각을 `at` 으로 받아 아카이브·재검토만 하고 파기하지 않는다.
 */
export function createScheduledJobRunner(env: ScheduledJobEnv): ScheduledJobRunner {
  return {
    async run(kind, nowIso): Promise<JobReport> {
      const counters = await jobCounters(env, kind, nowIso);
      return { kind, nowIso, completedAt: new Date().toISOString(), counters };
    },
  };
}
