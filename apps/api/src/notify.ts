import { type ApiEnv } from './identity';

/**
 * 관리자 알림 시임(seam) — D8.
 *
 * 발송 경로는 두 겹이다:
 *   1. console.error — 항상 남긴다(`wrangler tail`에서 아래 프리픽스로 필터).
 *   2. 웹훅 POST — `NOTIFY_WEBHOOK_URL` 시크릿이 설정된 경우에만. Slack/Discord
 *      incoming webhook이 받는 `{ "text": ... }` JSON을 보낸다. 발송 실패는
 *      console.error로만 기록하고 삼킨다 — 알림 채널 장애가 워치독(cron)을
 *      죽이면 안 된다.
 *
 * 알림 본문에는 기관 ID·시각·건수만 담는다. 케이스·세션 내용, PII는 넣지 않는다 (R3).
 * 다른 채널(이메일 등)을 붙일 때도 이 함수 한 곳만 고친다 — 워치독(scheduled 핸들러)은
 * 여기만 호출하므로 알림 채널 결합이 이 시임에 격리된다.
 */
export const WATCHDOG_ALERT_PREFIX = '[WATCHDOG ALERT]';

export async function notifyAdmins(env: ApiEnv, message: string): Promise<void> {
  const line = `${WATCHDOG_ALERT_PREFIX} ${message}`;
  console.error(line);

  const webhookUrl = env.NOTIFY_WEBHOOK_URL?.trim();
  if (webhookUrl === undefined || webhookUrl === '') {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: line }),
    });
    if (!response.ok) {
      // 웹훅 URL은 시크릿이라 로그에 싣지 않는다 — 상태 코드만 남긴다.
      console.error(`${WATCHDOG_ALERT_PREFIX} webhook delivery failed: status ${response.status}`);
    }
  } catch {
    console.error(`${WATCHDOG_ALERT_PREFIX} webhook delivery failed: network error`);
  }
}
