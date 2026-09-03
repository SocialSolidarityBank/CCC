import { describe, expect, it } from 'vitest';
import type { Database } from '@ccc/contracts/database';
import worker from '../src/index';
import { resolvePreviewE2eActorEmail } from '../src/preview-gate';
import type { ApiEnv } from '../src/identity';

// 테스트 전용 고정 코드(실제 지정 코드 아님 — 픽스처 리터럴). 실제 코드는 시크릿으로만 주입한다.
const TEST_CODE = 'test-preview-code-1234';
// 관리자 시점 픽스처(2026-07-30). 실무자 코드와 **다른 값**이어야 두 경로가 갈린다.
const TEST_ADMIN_CODE = 'test-preview-admin-code-5678';
// 종단 점검 코드 픽스처(D57). 위 둘과 또 달라야 세 경로가 갈린다.
const TEST_E2E_CODE = 'test-preview-e2e-code-9012';

const baseEnv: ApiEnv = {
  DB: undefined as unknown as Database,
  PII_ENC_KEY: 'local-test-key-not-for-production',
  AUDIO_BUCKET: undefined as unknown as R2Bucket,
};

// 코드 게이트가 열린 미리보기 env(이중 잠금 충족: PREVIEW_MODE + Access 미설정).
const previewEnv: ApiEnv = {
  ...baseEnv,
  PREVIEW_MODE: 'true',
  PREVIEW_ACCESS_CODE: TEST_CODE,
  PREVIEW_ACTOR_EMAIL: 'account@bss.or.kr',
  // 공개 가입 표면 스위치(CCC-112). 실제 [env.preview.vars] 와 동일하게 켠다 —
  // 켜져 있어도 미리보기에서는 아래 테스트대로 코드 세션이 먼저다.
  PUBLIC_SIGNUP_ENABLED: '1',
};

// 관리자 시점이 켜진 env — 코드와 이메일이 **둘 다** 있어야 경로가 열린다.
const adminPreviewEnv: ApiEnv = {
  ...previewEnv,
  PREVIEW_ADMIN_ACCESS_CODE: TEST_ADMIN_CODE,
  PREVIEW_ADMIN_ACTOR_EMAIL: 'admin@bss.or.kr',
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

async function unlockAndGetCookie(env: ApiEnv, code: string = TEST_CODE): Promise<string> {
  const response = await worker.fetch(unlockRequest(code), env);
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

  /**
   * 미리보기에는 공개 표면을 두지 않는다(2026-07-28 Q 결정, ADR-0016 개정).
   *
   * 당사자 자기 가입 경로 2개는 운영에서 resolveActor 앞에 있어 Access 없이 열린다
   * (당사자는 users 미등재 — 토큰이 곧 자격). 그 성질이 미리보기 워커에도 그대로
   * 딸려오면, 미리보기는 링크+지정 코드로 잠갔다면서 정작 이 두 경로만 코드 없이
   * 열린다. 그래서 미리보기에서는 이 경로도 코드 세션을 먼저 요구한다.
   *
   * DB 가 undefined 인 env 에서 401 이 난다는 것은 **DB 에 닿기 전에** 막혔다는 뜻이다.
   */
  it('가입 경로 2개도 미리보기에서는 코드 세션이 없으면 막힌다', async () => {
    const invite = await worker.fetch(
      new Request('http://localhost/invites/participant/0000000000000000000000000000000000000000000000000000000000000000'),
      previewEnv,
    );
    expect(invite.status).toBe(401);

    const signup = await worker.fetch(
      new Request('http://localhost/signup/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'x'.repeat(64), name: '테스트', consent: { privacy: true, recordingAi: true } }),
      }),
      previewEnv,
    );
    expect(signup.status).toBe(401);
  });

  /**
   * 기능 스위치(CCC-112)는 미리보기 코드 게이트보다 **앞**이다: 스위치가 닫힌 배포에서는
   * 코드가 있어도 공개 가입 표면 자체가 존재하지 않는다(404). 401(코드 요구)이 아니라
   * 404 라는 것이 순서의 증거다.
   */
  it('스위치가 닫히면 미리보기에서도 가입 경로는 코드와 무관하게 404', async () => {
    const closedEnv: ApiEnv = { ...previewEnv };
    delete closedEnv.PUBLIC_SIGNUP_ENABLED;
    const invite = await worker.fetch(
      new Request('http://localhost/invites/participant/0000000000000000000000000000000000000000000000000000000000000000'),
      closedEnv,
    );
    expect(invite.status).toBe(404);
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

  // ── 관리자 시점(2026-07-30 Q 요청) ──────────────────────────────────────
  // 팀원용 실무자 코드는 그대로 두고, **다른 코드**로 들어오면 기관 관리자 신원이 된다.
  // 토큰은 발급에 쓰인 코드를 HMAC 키로 서명하므로 형식을 바꾸지 않고 갈린다.

  it('관리자 코드도 세션 쿠키를 발급한다', async () => {
    const response = await worker.fetch(unlockRequest(TEST_ADMIN_CODE), adminPreviewEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ccc_preview=');
  });

  it('관리자 코드로 받은 쿠키는 인증 경계를 통과한다', async () => {
    const cookie = await unlockAndGetCookie(adminPreviewEnv, TEST_ADMIN_CODE);
    const response = await worker.fetch(meRequest(cookie), adminPreviewEnv);
    expect(response.status).not.toBe(401);
  });

  it('`red` 관리자 코드로 받은 쿠키는 관리자 경로가 꺼진 env 에서 거부된다', async () => {
    // 이것이 "토큰이 코드에 묶여 있다"의 증거다 — 아무 유효 쿠키나 통하는 게 아니다.
    const cookie = await unlockAndGetCookie(adminPreviewEnv, TEST_ADMIN_CODE);
    const response = await worker.fetch(meRequest(cookie), previewEnv);
    expect(response.status).toBe(401);
  });

  it('관리자 코드는 그 경로가 설정되지 않은 env 에서 통하지 않는다', async () => {
    const response = await worker.fetch(unlockRequest(TEST_ADMIN_CODE), previewEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('`red` 코드만 있고 이메일이 없으면 관리자 경로가 열리지 않는다 (하다 만 설정)', async () => {
    // 반쪽 설정에서 열어 주면 실무자 이메일로 관리자 코드가 통해 의도하지 않은 경로가 생긴다.
    const halfConfigured: ApiEnv = { ...previewEnv, PREVIEW_ADMIN_ACCESS_CODE: TEST_ADMIN_CODE };
    const response = await worker.fetch(unlockRequest(TEST_ADMIN_CODE), halfConfigured);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('관리자 경로를 켜도 실무자 코드는 그대로 동작한다', async () => {
    const response = await worker.fetch(unlockRequest(TEST_CODE), adminPreviewEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ccc_preview=');
  });

  it('둘 다 아닌 코드는 관리자 경로가 켜져 있어도 거부된다', async () => {
    const response = await worker.fetch(unlockRequest('neither-code'), adminPreviewEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

// 종단 점검(E2E) 코드 — 미리보기에서 처리 장비(service) 시점을 여는 유일한 경로.
// 이 경로가 넓어지면 미리보기가 사실상 무인증이 되므로, 아래 셋을 테스트로 고정한다.
describe('preview E2E code (D57 · ADR-0027)', () => {
  const e2ePreviewEnv: ApiEnv = {
    ...adminPreviewEnv,
    PREVIEW_E2E_ACCESS_CODE: TEST_E2E_CODE,
    PREVIEW_SERVICE_ACTOR_EMAIL: 'service-token-client-id.access',
  };

  it('`red` 코드만 있고 장비 이메일이 없으면 열리지 않는다 (하다 만 설정)', async () => {
    const halfConfigured: ApiEnv = { ...previewEnv, PREVIEW_E2E_ACCESS_CODE: TEST_E2E_CODE };
    const response = await worker.fetch(unlockRequest(TEST_E2E_CODE), halfConfigured);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('E2E 코드를 켜도 실무자·관리자 코드는 그대로 동작한다', async () => {
    for (const code of [TEST_CODE, TEST_ADMIN_CODE]) {
      const response = await worker.fetch(unlockRequest(code), e2ePreviewEnv);
      expect(response.status).toBe(200);
    }
    const rejected = await worker.fetch(unlockRequest('neither-code'), e2ePreviewEnv);
    expect(rejected.status).toBe(401);
  });

  it('`red` 목록 밖 이메일은 신원이 되지 않는다 — 장비로 떨어진다', () => {
    // 디렉터리의 다른 사용자를 헤더로 지목해도 통과하면 게이트의 의미가 없어진다.
    expect(resolvePreviewE2eActorEmail(e2ePreviewEnv, 'counselor-03@example.test'))
      .toBe('service-token-client-id.access');
    expect(resolvePreviewE2eActorEmail(e2ePreviewEnv, null))
      .toBe('service-token-client-id.access');
    expect(resolvePreviewE2eActorEmail(e2ePreviewEnv, '  '))
      .toBe('service-token-client-id.access');
  });

  it('목록 안 이메일(실무자·관리자·장비)은 그대로 신원이 된다', () => {
    for (const email of ['account@bss.or.kr', 'admin@bss.or.kr', 'service-token-client-id.access']) {
      expect(resolvePreviewE2eActorEmail(e2ePreviewEnv, email)).toBe(email);
    }
    // 공백은 다듬어 비교한다 — 헤더에 공백이 섞여도 같은 신원이어야 한다.
    expect(resolvePreviewE2eActorEmail(e2ePreviewEnv, ' admin@bss.or.kr ')).toBe('admin@bss.or.kr');
  });
});
