import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAuth, type AuthSnapshot } from './auth';
import { installation, json } from './test-support';
import { createClient } from '@supabase/supabase-js';
import type * as SupabaseSdk from '@supabase/supabase-js';

vi.mock('@supabase/supabase-js', async (original) => {
  const sdk = await original<typeof SupabaseSdk>();
  return { ...sdk, createClient: vi.fn(sdk.createClient) };
});

const sessions = new Set<CloudAuth>();
afterEach(async () => {
  for (const auth of sessions) await auth.signOut();
  sessions.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
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
async function authServer(options: { enrolled?: boolean; revokeFails?: boolean } = {}) {
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

  it('signs in without an authenticator because MFA is optional', async () => {
    const { auth } = await authServer({ enrolled: false });
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'ready');
    expect(auth.getToken()).not.toBeNull();
  });

  it('clears first-enrollment material when the user cancels', async () => {
    const { auth, requests } = await authServer({ enrolled: false });
    await auth.signIn('synthetic@example.invalid', 'synthetic-password');
    await waitForPhase(auth, 'ready');
    await auth.recheck(true);
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
    await waitForPhase(auth, 'ready');
    await auth.recheck(true);
    await waitForPhase(auth, 'mfa');
    await auth.enroll();
    await auth.verify('new-totp', '123456');
    await waitForPhase(auth, 'ready');
    expect(auth.getSnapshot().enrollment).toBeNull();
    expect(auth.getToken()).not.toBeNull();
  });
});


async function manualHarness(search = '', hash = '', capture = true) {
  // Bootstrap lifetime is per document; static imports cannot isolate its one-shot state.
  vi.resetModules();
  const boundary = await import('./auth');
  const support = await import('./test-support');
  const verified = await support.installation();
  const location = { pathname: '/auth/invite', search, hash };
  const history = { state: { idx: 2 }, replaceState: vi.fn(() => { location.search = ''; location.hash = ''; }) };
  if (capture) boundary.captureInviteUrlBeforeRender(location, history);
  const requests: Request[] = [];
  const email = 'otp-person@example.invalid', password = 'Synthetic-Password-Only', code = '739162';
  const user = { id: 'validated-provider-subject', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: [], created_at: '2026-01-01T00:00:00Z' };
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = encode({ alg: 'HS256' }) + '.' + encode({ aal: 'aal1', amr: [], exp: Math.floor(Date.now()/1000)+3600 }) + '.c3ludGhldGlj';
  const session = { access_token: token, refresh_token: 'otp-refresh-private', token_type: 'bearer', expires_in: 3600, user };
  const control = { verifyStatus: 200, updateStatus: 200, logoutStatus: 204, tokenStatus: 200,
    code: 'private-provider-code', network: '', malformed: '', gate: null as Promise<void> | null,
    tokenGate: null as Promise<void> | null };
  const auth = new boundary.CloudAuth(verified, async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    const path = new URL(request.url).pathname;
    if (control.network === path) throw new Error('private-provider-message');
    const fail = (status: number) => json({ code: control.code, message: 'private-provider-message' }, status);
    if (path === '/auth/v1/verify') {
      await control.gate;
      if (control.verifyStatus !== 200) return fail(control.verifyStatus);
      if (control.malformed === 'session') return json({ user });
      if (control.malformed === 'subject') return json({ ...session, user: { ...user, id: '' } });
      if (control.malformed === 'email') return json({ ...session, user: { ...user, email: 'other@example.invalid' } });
      return json(session);
    }
    if (path === '/auth/v1/user' && request.method === 'PUT') {
      if (control.updateStatus !== 200) return fail(control.updateStatus);
      return json(control.malformed === 'update' ? { ...user, id: 'another-subject' } : user);
    }
    if (path === '/auth/v1/token') {
      await control.tokenGate;
      return control.tokenStatus === 200 ? json(session) : fail(control.tokenStatus);
    }
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/logout')) return control.logoutStatus === 204 ? new Response(null,{status:204}) : fail(control.logoutStatus);
    return fail(404);
  });
  sessions.add(auth);
  const complete = () => auth.completeFirstAdminInvite(email,code,password);
  const paths = () => requests.map(request => request.method+' '+new URL(request.url).pathname);
  return { auth,boundary,control,complete,paths,requests,location,history,email,password,code,token };
}

describe('manual invitation OTP boundary', () => {
  it('classifies clean startup without creating Auth and never replaces its first classification', async () => {
    const h=await manualHarness();
    expect(h.boundary.firstAdminInviteBootstrap()).toBe('entry');
    expect(h.requests).toHaveLength(0);
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    h.boundary.captureInviteUrlBeforeRender({pathname:'/auth/invite',search:'?x=synthetic',hash:''},h.history);
    expect(h.boundary.firstAdminInviteBootstrap()).toBe('entry');
  });
  it.each([['?x=synthetic',''],['','#synthetic'],['?x=synthetic','#synthetic']])('rejects dirty startup without Auth (%s %s)',async(search,hash)=>{
    const h=await manualHarness(search,hash);
    expect(h.location).toEqual({pathname:'/auth/invite',search:'',hash:''});
    expect(h.history.replaceState).toHaveBeenCalledWith(h.history.state,'','/auth/invite');
    expect(await h.complete()).toEqual({status:'failure',code:'invite_invalid',retry:'none'});
    expect(h.requests).toHaveLength(0);
  });
  it('rejects unseen startup and leaves participant fragments and legacy classification separate',async()=>{
    const h=await manualHarness('','',false);
    expect(h.boundary.firstAdminInviteBootstrap()).toBe('invite_invalid');
    const location={pathname:'/join',search:'',hash:'#t=synthetic'};
    h.boundary.captureInviteUrlBeforeRender(location,h.history);
    expect(location.hash).toBe('#t=synthetic'); expect(h.history.replaceState).not.toHaveBeenCalled();
    h.boundary.captureInviteUrlBeforeRender({pathname:'/staff/join',search:'',hash:'#synthetic'},h.history);
    expect(h.boundary.firstAdminInviteBootstrap()).toBe('invite_invalid');
    expect(await h.complete()).toMatchObject({retry:'none'}); expect(h.requests).toHaveLength(0);
  });
  it('throws a fixed bootstrap failure if dirty history cannot be replaced',async()=>{
    const h=await manualHarness('','',false);
    expect(()=>h.boundary.captureInviteUrlBeforeRender({pathname:'/auth/invite',search:'?x=synthetic',hash:''},{state:null,replaceState(){throw new Error('private-provider-message');}})).toThrow('invite_bootstrap_invalid');
    expect(h.boundary.firstAdminInviteBootstrap()).toBe('invite_invalid');
  });
  it('verifies once, updates once and disposes without opening business access',async()=>{
    const h=await manualHarness(); const phases:string[]=[];
    h.auth.subscribe(()=>phases.push(h.auth.getSnapshot().phase));
    const first=h.complete(),second=h.complete(); expect(first).toBe(second);
    expect(h.auth.getToken()).toBeNull();
    expect(await first).toEqual({status:'complete'});
    expect(h.paths()).toEqual(['POST /auth/v1/verify','PUT /auth/v1/user','POST /auth/v1/logout']);
    expect(await h.requests[0]!.clone().json()).toEqual({email:h.email,token:h.code,type:'invite',gotrue_meta_security:{}});
    expect(await h.requests[1]!.clone().json()).toMatchObject({password:h.password});
    expect(phases.includes('ready')).toBe(false); expect(h.auth.getToken()).toBeNull();
    expect(vi.mocked(createClient).mock.calls).toHaveLength(1);
    expect(vi.mocked(createClient).mock.calls[0]![2]!.auth).toMatchObject({persistSession:false,detectSessionInUrl:false});
    for(const value of [h.email,h.code,h.password,h.token,'otp-refresh-private','validated-provider-subject','private-provider-message']) expect(JSON.stringify(h.auth).includes(value)).toBe(false);
  });
  it('preserves any ordinary current session without verification or logout',async()=>{
    const h=await manualHarness();await h.auth.signIn('ordinary@example.invalid','ordinary-password');await waitForPhase(h.auth,'ready');
    const count=h.requests.length;
    expect(await h.complete()).toEqual({status:'failure',code:'invite_session_conflict',retry:'none'});
    await h.auth.cancelFirstAdminInvite(); expect(h.auth.getToken()!==null).toBe(true); expect(h.requests).toHaveLength(count);
  });
  it('preserves a pending ordinary sign-in without verification or logout',async()=>{
    const h=await manualHarness(),gate=Promise.withResolvers<void>();h.control.tokenGate=gate.promise;
    const signIn=h.auth.signIn('ordinary@example.invalid','ordinary-password');
    await vi.waitFor(()=>expect(h.paths()).toContain('POST /auth/v1/token'));const count=h.requests.length;
    expect(await h.complete()).toEqual({status:'failure',code:'invite_session_conflict',retry:'none'});
    expect(h.requests).toHaveLength(count);
    gate.resolve();await signIn;await waitForPhase(h.auth,'ready');expect(h.auth.getToken()).not.toBeNull();
  });
  it('maps a failed pre-OTP session check to an empty provider retry',async()=>{
    const h=await manualHarness();h.control.tokenStatus=400;
    await h.auth.signIn('ordinary@example.invalid','ordinary-password');
    const sdk=vi.mocked(createClient).mock.results.at(-1)?.value;
    expect(sdk).toBeDefined();
    vi.spyOn(sdk!.auth,'getSession').mockResolvedValue({
      data:{session:null},error:Object.assign(new Error('private-provider-message'),{status:400,code:'otp_expired'}),
    } as never);
    const count=h.requests.length;
    expect(await h.complete()).toEqual({status:'failure',code:'provider_unavailable',retry:'entry'});
    expect(h.requests).toHaveLength(count);
  });
  it.each([400,429,503])('returns full entry retry for unconfirmed verify status %i',async(status)=>{
    const h=await manualHarness();h.control.verifyStatus=status;
    expect(await h.complete()).toEqual({status:'failure',code:status===400?'invite_invalid':'provider_unavailable',retry:'entry'});
    expect(h.paths()).toEqual(['POST /auth/v1/verify']);
    h.control.verifyStatus=200;expect(await h.complete()).toEqual({status:'complete'});
  });
  it.each(['otp_expired','invite_not_found','session_expired'])('treats %s as terminal at both provider stages',async(code)=>{
    const h=await manualHarness();h.control.code=code;h.control.verifyStatus=401;
    expect(await h.complete()).toEqual({status:'failure',code:'invite_expired',retry:'none'});
    const other=await manualHarness();other.control.code=code;other.control.updateStatus=401;
    expect(await other.complete()).toEqual({status:'failure',code:'invite_expired',retry:'none'});
    expect(other.auth.getToken()).toBeNull();
  });
  it.each(['session','subject','email','update'])('disposes malformed %s success without a retry',async(malformed)=>{
    const h=await manualHarness();h.control.malformed=malformed;
    expect(await h.complete()).toEqual({status:'failure',code:'provider_unavailable',retry:'none'});
    expect(await h.auth.retryFirstAdminPassword('new-password')).toMatchObject({retry:'none'});
    if(malformed!=='update')expect(h.paths().includes('PUT /auth/v1/user')).toBe(false);
  });
  it.each([422,429,503])('retains only the verified session for password retry at %i',async(status)=>{
    const h=await manualHarness();h.control.updateStatus=status;
    expect(await h.complete()).toEqual({status:'failure',code:status===422?'password_rejected':'provider_unavailable',retry:'password'});
    h.control.updateStatus=200;
    const a=h.auth.retryFirstAdminPassword('fresh-password'),b=h.auth.retryFirstAdminPassword('another-password');expect(a).toBe(b);
    expect(await a).toEqual({status:'complete'});
    expect(h.paths().filter(path=>path==='POST /auth/v1/verify')).toHaveLength(1);
  });
  it('handles network loss by stage and makes local signout failure complete',async()=>{
    const h=await manualHarness();h.control.network='/auth/v1/verify';expect(await h.complete()).toMatchObject({code:'provider_unavailable',retry:'entry'});
    h.control.network='/auth/v1/user';expect(await h.complete()).toMatchObject({code:'provider_unavailable',retry:'password'});
    h.control.network='';h.control.logoutStatus=503;
    expect(await h.auth.retryFirstAdminPassword('fresh-password')).toEqual({status:'complete'});
    expect(h.auth.getSnapshot()).toMatchObject({phase:'signed-out',error:null});
  });
  it('cancels an in-flight verification without starting password update or double disposal',async()=>{
    const h=await manualHarness(),gate=Promise.withResolvers<void>();h.control.gate=gate.promise;
    const completion=h.complete();await vi.waitFor(()=>expect(h.paths()).toContain('POST /auth/v1/verify'));
    const cancel=h.auth.cancelFirstAdminInvite();gate.resolve();await completion;await cancel;await h.auth.cancelFirstAdminInvite();
    expect(h.paths().includes('PUT /auth/v1/user')).toBe(false);expect(h.auth.getToken()).toBeNull();
    expect(h.paths().filter(path=>path==='POST /auth/v1/logout').length).toBeLessThanOrEqual(1);
  });
});

it('restores an ordinary sign-in inspection interrupted by an invitation submit', async () => {
  const h = await manualHarness();
  await h.auth.signIn('ordinary@example.invalid', 'ordinary-password');
  expect(await h.complete()).toMatchObject({ code: 'invite_session_conflict', retry: 'none' });
  await vi.waitFor(() => expect(h.auth.getSnapshot().phase).toBe('ready'));
  await h.auth.cancelFirstAdminInvite();
  expect(h.auth.getToken()).not.toBeNull();
  expect(h.paths().includes('POST /auth/v1/verify')).toBe(false);
});
