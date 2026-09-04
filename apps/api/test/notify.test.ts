import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyAdmins, WATCHDOG_ALERT_PREFIX } from '@ccc/core/notify';
import { type ApiEnv } from '@ccc/http-api/identity';

// notify는 D1을 쓰지 않으므로 env는 웹훅 변수만 있는 빈 껍데기로 충분하다.
function envWith(webhookUrl?: string): ApiEnv {
  return { NOTIFY_WEBHOOK_URL: webhookUrl } as ApiEnv;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('notifyAdmins (D8 알림 시임)', () => {
  it('웹훅 미설정이면 console.error만 남기고 fetch를 부르지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await notifyAdmins(envWith(undefined), 'pipeline stale for org bss');

    expect(consoleError).toHaveBeenCalledWith(`${WATCHDOG_ALERT_PREFIX} pipeline stale for org bss`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('웹훅 설정 시 {text: ...} JSON을 POST한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await notifyAdmins(envWith('https://hooks.example/T/B/x'), 'stale');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example/T/B/x');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ text: `${WATCHDOG_ALERT_PREFIX} stale` });
  });

  it('웹훅 비정상 응답은 상태 코드만 로그로 남기고 던지지 않는다 (cron 보호)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(notifyAdmins(envWith('https://hooks.example/x'), 'stale')).resolves.toBeUndefined();

    const logged = consoleError.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes('webhook delivery failed: status 500'))).toBe(true);
    // 웹훅 URL은 시크릿 — 로그에 노출되지 않는다.
    expect(logged.every((line) => !line.includes('hooks.example'))).toBe(true);
  });

  it('웹훅 네트워크 오류도 삼키고 폴백 로그만 남긴다 (cron 보호)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(notifyAdmins(envWith('https://hooks.example/x'), 'stale')).resolves.toBeUndefined();

    const logged = consoleError.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes('webhook delivery failed: network error'))).toBe(true);
  });
});
