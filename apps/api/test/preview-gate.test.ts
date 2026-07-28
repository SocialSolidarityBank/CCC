import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { ApiEnv } from '../src/identity';

// 테스트 전용 고정 코드(실제 지정 코드 아님 — 픽스처 리터럴). 실제 코드는 시크릿으로만 주입한다.
const TEST_CODE = 'test-preview-code-1234';

const baseEnv: ApiEnv = {
  DB: undefined as unknown as D1Database,
  PII_ENC_KEY: 'local-test-key-not-for-production',
  AUDIO_BUCKET: undefined as unknown as R2Bucket,
};

// 코드 게이트가 열린 미리보기 env(이중 잠금 충족: PREVIEW_MODE + Access 미설정).
const previewEnv: ApiEnv = {
  ...baseEnv,
  PREVIEW_MODE: 'true',
  PREVIEW_ACCESS_CODE: TEST_CODE,
  PREVIEW_ACTOR_EMAIL: 'account@bss.or.kr',
};

function unlockRequest(code: unknown): Request {
  return new Request('http://localhost/preview/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

function meRequest(cookie?: string): Request {
  return new Request('http://localhost/me', {
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function unlockAndGetCookie(env: ApiEnv): Promise<string> {
  const response = await worker.fetch(unlockRequest(TEST_CODE), env);
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).not.toBeNull();
  const token = /ccc_preview=([^;]+)/.exec(setCookie as string)?.[1];
  expect(token).toBeTruthy();
  return `ccc_preview=${token}`;
}

describe('preview code gate (CCC-6)', () => {
  it('issues an HttpOnly session cookie for the correct code', async () => {
    const response = await worker.fetch(unlockRequest(TEST_CODE), previewEnv);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('ccc_preview=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');

    const body = await response.json() as { token?: unknown; maxAgeSeconds?: unknown };
    expect(typeof body.token).toBe('string');
    expect(body.maxAgeSeconds).toBe(7 * 24 * 60 * 60);
  });

  it('rejects the wrong code with 401 and returns no data or cookie', async () => {
    const response = await worker.fetch(unlockRequest('definitely-wrong'), previewEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();

    const body = await response.json() as Record<string, unknown>;
    expect(body.token).toBeUndefined();
    expect('token' in body).toBe(false);
  });

  it('blocks API access without a session cookie (401)', async () => {
    const response = await worker.fetch(meRequest(), previewEnv);
    expect(response.status).toBe(401);
  });

  it('rejects a tampered session cookie (signature verification)', async () => {
    const cookie = await unlockAndGetCookie(previewEnv);
    // 서명 **첫** 문자를 뒤집어 위조한다.
    //
    // 마지막 문자를 뒤집으면 안 된다(2026-07-26 간헐 실패 원인 확정). HMAC-SHA256 은 32바이트라
    // base64url 로 43자가 되는데, 42자까지가 252비트를 채우고 **마지막 문자는 4비트만 유효하다**
    // — 남은 2비트는 디코딩에서 버려진다. 그래서 마지막 문자를 뒤집어도 바이트열이 그대로일 수
    // 있고, 그때 쿠키는 여전히 유효해 인증을 통과한 뒤 /me 로 흘러 (이 환경은 DB 미바인딩이라)
    // 500 이 된다. 서명값에 따라 갈리므로 전체 스위트에서 간헐로만 터졌다.
    const separator = cookie.indexOf('.');
    const head = cookie.slice(0, separator + 1);
    const signature = cookie.slice(separator + 1);
    const tampered = head + (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    const response = await worker.fetch(meRequest(tampered), previewEnv);
    expect(response.status).toBe(401);
  });

  it('accepts a freshly minted cookie past the auth boundary', async () => {
    const cookie = await unlockAndGetCookie(previewEnv);
    // 유효 쿠키는 인증(401)을 통과하고 신원 조회(findUserByEmail)로 진행한다 —
    // 401 이 아니라는 것이 토큰 서명·만료 검증 통과의 증거다(DB 미바인딩이라 그 뒤 단계는 무관).
    const response = await worker.fetch(meRequest(cookie), previewEnv);
    expect(response.status).not.toBe(401);
  });

  it('fail-closed: unlock does not open when PREVIEW_MODE is unset (production)', async () => {
    // 운영: PREVIEW_MODE 없음 + Access 미설정 → actorFromRequest 로 흘러 401. 코드가 맞아도 열리지 않는다.
    const response = await worker.fetch(unlockRequest(TEST_CODE), baseEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('fail-closed: second lock — Access configured disables the gate even with PREVIEW_MODE', async () => {
    const leakedEnv: ApiEnv = {
      ...previewEnv,
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'aud-tag',
    };
    const response = await worker.fetch(unlockRequest(TEST_CODE), leakedEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
