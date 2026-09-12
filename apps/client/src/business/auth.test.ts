import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAuth, type AuthSnapshot } from './auth';
import { installation, json } from './test-support';

const sessions = new Set<CloudAuth>();
afterEach(async () => {
  for (const auth of sessions) await auth.signOut();
  sessions.clear();
  vi.useRealTimers();
});

async function waitForPhase(auth: CloudAuth, phase: AuthSnapshot['phase']): Promise<void> {
  if (auth.getSnapshot().phase === phase) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = auth.subscribe(() => {
      if (auth.getSnapshot().phase !== phase) return;
      unsubscribe();
      resolve();
    });
  });
}

// 실제 SDK와 메모리 세션을 사용하고 네트워크 경계만 합성 Auth 서버로 바꾼다.
async function authServer(options: { enrolled?: boolean; revokeFails?: boolean; confirmEmail?: boolean } = {}) {
  const verified = await installation();
  const requests: Request[] = [];
  let enrolled = options.enrolled ?? true;
  let pendingEnrollment = false;
  let verifiedFactorId = 'totp-factor';
  let level: 'aal1' | 'aal2' = 'aal1';
  const user = () => ({
    id: 'a800424b-7cb1-49f5-8bb4-8989d586c455', aud: 'authenticated', role: 'authenticated',
    email: 'synthetic@example.invalid', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {},
    factors: [
      ...(enrolled ? [{ id: verifiedFactorId, factor_type: 'totp', status: 'verified', friendly_name: 'Test authenticator',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] : []),
      ...(pendingEnrollment ? [{ id: 'new-totp', factor_type: 'totp', status: 'unverified', friendly_name: 'New authenticator',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] : []),
    ],
  });
  function session() {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const iat = Math.floor(Date.now() / 1000);
    return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user().id, aud: 'authenticated',
      role: 'authenticated', aal: level, amr: [], session_id: 'synthetic-session', iat, exp: iat + 3600 })}.c3ludGhldGlj`,
    refresh_token: 'synthetic-refresh-token', expires_in: 3600, expires_at: iat + 3600, token_type: 'bearer', user: user() };
  }
  const auth = new CloudAuth(verified, async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/token') return json(session());
    if (url.pathname === '/auth/v1/signup') {
      const body: unknown = await request.clone().json();
      if (typeof body === 'object' && body !== null && 'password' in body && String(body.password).length < 8) {
        return json({ code: 'weak_password', error_code: 'weak_password', msg: 'provider-private-detail' }, 422);
      }
      // 이메일 확인이 켜진 프로젝트의 응답에는 access_token 이 없다(SDK는 세션 없음으로 읽는다).
      return json(options.confirmEmail ? user() : session());
    }
    if (url.pathname === '/auth/v1/user') return json(user());
    if (url.pathname === '/auth/v1/factors' && request.method === 'POST') {
      pendingEnrollment = true;
      return json({
        id: 'new-totp', type: 'totp', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', secret: 'SYNTHETICONLY', uri: 'otpauth://totp/synthetic' },
      });
    }
    if (url.pathname.endsWith('/challenge')) return json({ id: 'challenge', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (url.pathname.endsWith('/verify')) {
      const body: unknown = await request.clone().json();
      if (typeof body !== 'object' || body === null || !('code' in body) || body.code !== '123456') {
        return json({ code: 'mfa_verification_failed', error_code: 'mfa_verification_failed', msg: 'provider-private-detail' }, 422);
      }
      enrolled = true;
      verifiedFactorId = url.pathname.split('/')[4] ?? 'totp-factor';
      pendingEnrollment = false;
      level = 'aal2';
      // 실제 MFA 응답에는 expires_at이 없다. SDK 저장 과정에서만 계산된다.
      const { expires_at: _expiresAt, ...verifiedSession } = session();
      return json(verifiedSession);
    }
    if (url.pathname === '/auth/v1/factors/new-totp' && request.method === 'DELETE') {
      pendingEnrollment = false;
      return json({ id: 'new-totp' });
    }
    if (url.pathname === '/functions/v1/ccc/auth/logout') {
      return options.revokeFails ? json({ message: 'private-server-error' }, 503) : new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    return json({ code: 'not_found' }, 404);
  });
  sessions.add(auth);
  return { auth, requests };
}

describe('official Supabase password and MFA lifecycle', () => {
  it('withholds business tokens until an existing TOTP challenge succeeds', async () => {
    const { auth } = await authServer();
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    expect(auth.getToken()).toBeNull();
    expect(auth.getSnapshot().factors.map((factor) => factor.id)).toEqual(['totp-factor']);
    await auth.verify('totp-factor', '000000');
    expect(auth.getSnapshot().error?.code).toBe('mfa_invalid');
    expect(auth.getToken()).toBeNull();
    const previousRevision = auth.getSnapshot().revision;
    await auth.verify('totp-factor', '123456');
    await waitForPhase(auth, 'ready');
    expect(auth.getSnapshot().revision).toBeGreaterThan(previousRevision);
    expect(auth.getToken()).not.toBeNull();
    expect(auth.getSnapshot().enrollment).toBeNull();
    expect(JSON.stringify(auth.getSnapshot())).not.toContain('synthetic-refresh-token');
  });

  it('clears first-enrollment material when the user cancels', async () => {
    const { auth, requests } = await authServer({ enrolled: false });
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    await auth.enroll();
    expect(auth.getSnapshot().enrollment?.id).toBe('new-totp');
    await auth.cancelEnrollment();
    expect(auth.getSnapshot().enrollment).toBeNull();
    expect(auth.getToken()).toBeNull();
    expect(requests.some((request) => request.method === 'DELETE' && request.url.endsWith('/factors/new-totp'))).toBe(true);
  });

  it('revokes the backend session before SDK signout while the token getter is still alive', async () => {
    const { auth, requests } = await authServer();
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    await auth.verify('totp-factor', '123456');
    await waitForPhase(auth, 'ready');
    const token = auth.getToken();
    await auth.signOut();
    const logout = requests.filter((request) => new URL(request.url).pathname.endsWith('/logout'));
    expect(logout.map((request) => new URL(request.url).pathname)).toEqual(['/functions/v1/ccc/auth/logout', '/auth/v1/logout']);
    expect(logout[0]?.method).toBe('POST');
    expect(logout[0]?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(await logout[0]?.clone().json()).toEqual({});
    expect(auth.getToken()).toBeNull();
    expect(auth.getSnapshot().phase).toBe('signed-out');
    expect(auth.getSnapshot().error).toBeNull();
  });

  it('still clears local authentication and reports uncertainty when revocation fails', async () => {
    const { auth, requests } = await authServer({ revokeFails: true });
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    await auth.signOut();
    expect(auth.getToken()).toBeNull();
    expect(auth.getSnapshot().phase).toBe('signed-out');
    expect(auth.getSnapshot().error?.code).toBe('signout_failed');
    expect(requests.filter((request) => new URL(request.url).pathname.endsWith('/logout')).length).toBe(2);
    expect(JSON.stringify(auth.getSnapshot())).not.toContain('private-server-error');
  });

  it('does not revive an idle session when activity resumes after thirty minutes', async () => {
    const { auth } = await authServer();
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    await auth.verify('totp-factor', '123456');
    await waitForPhase(auth, 'ready');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    auth.recordActivity();
    await waitForPhase(auth, 'signed-out');
    expect(auth.getToken()).toBeNull();
    expect(auth.getSnapshot().error?.code).toBe('unauthenticated');
  });
});

describe('first TOTP enrollment completion', () => {
  it('replaces enrollment material with the SDK-normalized authenticated session', async () => {
    const { auth } = await authServer({ enrolled: false });
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'mfa');
    await auth.enroll();
    await auth.verify('new-totp', '123456');
    await waitForPhase(auth, 'ready');
    expect(auth.getSnapshot().enrollment).toBeNull();
    expect(auth.getToken()).not.toBeNull();
  });
});

describe('초대 수락 뒤 첫 계정 생성', () => {
  it('같은 설치 클라이언트로 계정을 만들고 연결용 접근 토큰만 돌려준다', async () => {
    const { auth, requests } = await authServer({ enrolled: false });
    const { accessToken } = await auth.signUpWithPassword('invited@example.invalid', 'synthetic-passphrase');
    expect(accessToken).not.toBeNull();
    const signup = requests.filter((request) => new URL(request.url).pathname === '/auth/v1/signup');
    expect(signup.length).toBe(1);
    expect(await signup[0]?.clone().json()).toMatchObject({ email: 'invited@example.invalid', password: 'synthetic-passphrase' });
    // 비밀번호는 가입 요청 본문에만 실린다. 나머지 경계에는 남지 않는다.
    for (const request of requests.filter((candidate) => candidate !== signup[0])) {
      expect(await request.clone().text()).not.toContain('synthetic-passphrase');
    }
    expect(JSON.stringify(auth.getSnapshot())).not.toContain('synthetic-passphrase');
    expect(JSON.stringify(auth.getSnapshot())).not.toContain(accessToken);
  });

  it('이메일 확인이 필요한 프로젝트에서는 연결할 토큰이 없다고 알린다', async () => {
    const { auth } = await authServer({ enrolled: false, confirmEmail: true });
    await expect(auth.signUpWithPassword('invited@example.invalid', 'synthetic-passphrase'))
      .resolves.toEqual({ accessToken: null });
  });

  it('공급자 거절은 고정된 인증 오류로 바꿔 올린다', async () => {
    const { auth } = await authServer({ enrolled: false });
    const failure = await auth.signUpWithPassword('invited@example.invalid', 'short').catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ code: 'auth_failed', status: 422 });
    expect(JSON.stringify(failure)).not.toContain('provider-private-detail');
    expect((failure as Error).message).not.toContain('provider-private-detail');
  });
});
