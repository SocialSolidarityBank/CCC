import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { assertInstallationCurrent, type VerifiedInstallation } from './installation';
import { authError, BusinessError } from './errors';
import { BusinessTransport } from './transport';

export interface TotpFactor { id: string; label: string }
export interface TotpEnrollment { id: string; qrCode: string; secret: string }
export interface AuthSnapshot {
  phase: 'signed-out' | 'signing-in' | 'checking' | 'mfa' | 'ready' | 'signing-out' | 'error';
  revision: number;
  working: boolean;
  factors: readonly TotpFactor[];
  enrollment: TotpEnrollment | null;
  error: BusinessError | null;
}
interface ActiveClient {
  sdk: SupabaseClient;
  lifetime: AbortController;
}

/** SDK 세션은 이 객체 안의 메모리에만 둔다. React snapshot에는 토큰을 싣지 않는다. */
export class CloudAuth {
  private active: ActiveClient | null = null;
  private session: Session | null = null;
  private pendingFactorId: string | null = null;
  private idleDeadline: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private enrollmentTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot: AuthSnapshot = {
    phase: 'signed-out', revision: 0, working: false, factors: [], enrollment: null, error: null,
  };

  // 브라우저의 fetch는 Window 수신자를 요구한다. 클래스 필드로 두면 호출이 illegal invocation 이 된다.
  constructor(private readonly installation: VerifiedInstallation,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    assertInstallationCurrent(installation);
    if (installation.manifest.mode !== 'community-cloud') throw new BusinessError('installation_invalid');
  }

  readonly getSnapshot = (): AuthSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getToken = (): string | null => {
    if (this.snapshot.phase !== 'ready' && this.snapshot.phase !== 'signing-out') return null;
    if (this.snapshot.phase !== 'signing-out' && this.idleDeadline !== null && Date.now() >= this.idleDeadline) return null;
    if (!this.session || (this.session.expires_at ?? 0) * 1000 <= Date.now()) return null;
    return this.session.access_token;
  };

  readonly recordActivity = (): void => {
    if (!this.session || this.snapshot.phase === 'signing-out') return;
    if (this.idleDeadline !== null && Date.now() >= this.idleDeadline) {
      void this.signOut(new BusinessError('unauthenticated', 401));
      return;
    }
    this.idleDeadline = Date.now() + 30 * 60_000;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.signOut(new BusinessError('unauthenticated', 401)); }, 30 * 60_000);
  };

  private publish(patch: Partial<AuthSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private client(): ActiveClient {
    if (this.active) return this.active;
    const { supabaseAuthOrigin, supabasePublishableKey } = this.installation.manifest;
    if (!supabaseAuthOrigin || !supabasePublishableKey) throw new BusinessError('installation_invalid');
    const lifetime = new AbortController();
    const sdk = createClient(supabaseAuthOrigin, supabasePublishableKey, {
      auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true, debug: false,
        storageKey: `ccc-memory-auth-${crypto.randomUUID()}` },
      global: {
        fetch: async (input, init) => {
          assertInstallationCurrent(this.installation);
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          if (url.origin !== supabaseAuthOrigin || !url.pathname.startsWith('/auth/v1/')
            || url.username || url.password || url.hash
            || [...url.searchParams.keys()].some((key) => key !== 'grant_type' && key !== 'scope')) {
            throw new BusinessError('invalid_api_path');
          }
          if (url.searchParams.get('grant_type') === 'refresh_token'
            && (this.snapshot.phase === 'signing-out' || (this.idleDeadline !== null && Date.now() >= this.idleDeadline))) {
            queueMicrotask(() => { void this.signOut(new BusinessError('unauthenticated', 401)); });
            throw new BusinessError('unauthenticated', 401);
          }
          const inputSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
          const response = await this.fetcher(input, {
            ...init, credentials: 'omit', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(30_000), ...(inputSignal ? [inputSignal] : [])]),
          }).catch(() => { throw new BusinessError('unavailable', 503); });
          if (response.redirected) throw new BusinessError('invalid_response');
          if (!response.ok) {
            // SDK의 내부 오류 로그에도 공급자 원문이 들어가지 않도록 먼저 좁힌다.
            const body: unknown = await response.json().catch(() => null);
            const code = typeof body === 'object' && body !== null
              ? ('code' in body ? body.code : 'error_code' in body ? body.error_code : undefined) : undefined;
            const error = authError({ code, status: response.status });
            return new Response(JSON.stringify({ code: error.code, error_code: error.code, msg: error.message, message: error.message }), {
              status: response.status, headers: { 'Content-Type': 'application/json' },
            });
          }
          return response;
        },
      },
    });
    sdk.auth.onAuthStateChange((event, session) => {
      if (this.active?.sdk !== sdk || this.snapshot.phase === 'signing-out') return;
      if (event === 'INITIAL_SESSION' && session === null) return;
      const firstSession = this.session === null && session !== null;
      clearTimeout(this.enrollmentTimer);
      this.session = session;
      if (firstSession) this.recordActivity();
      if (session === null) {
        clearTimeout(this.idleTimer);
        this.idleDeadline = null;
      }
      const revision = this.snapshot.revision + 1;
      if (event === 'MFA_CHALLENGE_VERIFIED' || session === null) this.pendingFactorId = null;
      this.publish({ revision, phase: session ? 'checking' : 'signed-out', working: false,
        factors: [], enrollment: null, error: null });
      // SDK callback 안에서 SDK를 await하면 auth lock과 교착할 수 있다.
      if (session) queueMicrotask(() => { void this.inspect(sdk, revision); });
    });
    this.active = { sdk, lifetime };
    return this.active;
  }

  private isCurrent(sdk: SupabaseClient, revision: number): boolean {
    return this.active?.sdk === sdk && this.snapshot.revision === revision && this.snapshot.phase !== 'signing-out';
  }

  private async inspect(sdk: SupabaseClient, revision: number, forceMfa = false): Promise<void> {
    try {
      // MFA 이벤트와 달리 SDK 저장 세션에는 계산된 expires_at이 있다.
      const current = await sdk.auth.getSession();
      if (current.error) throw current.error;
      if (!this.isCurrent(sdk, revision)) return;
      if (!current.data.session) throw new BusinessError('unauthenticated', 401);
      this.session = current.data.session;
      const assurance = await sdk.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      if (!this.isCurrent(sdk, revision)) return;
      if (assurance.data.currentLevel === 'aal2' && !forceMfa) {
        this.publish({ phase: 'ready', working: false, factors: [], enrollment: null, error: null });
        return;
      }
      const factors = await sdk.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      if (!this.isCurrent(sdk, revision)) return;
      const totp = factors.data.totp.filter((factor) => factor.status === 'verified');
      // 인증 앱이 없으면 등록을 강요하지 않는다(D89). 등록은 내 정보에서 스스로 켠다.
      if (totp.length === 0 && !forceMfa) {
        this.publish({ phase: 'ready', working: false, factors: [], enrollment: null, error: null });
        return;
      }
      if (totp.length === 0 && factors.data.all.some((factor) => factor.status === 'verified')) {
        throw new BusinessError('mfa_unsupported');
      }
      this.publish({ phase: 'mfa', working: false, error: null,
        factors: totp.map((factor, index) => ({ id: factor.id, label: factor.friendly_name || `인증 앱 ${index + 1}` })) });
    } catch (error) {
      if (this.isCurrent(sdk, revision)) this.publish({ phase: 'error', working: false, error: authError(error) });
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    if (this.snapshot.phase !== 'signed-out' || this.snapshot.working) return;
    this.publish({ phase: 'signing-in', working: true, error: null });
    let active: ActiveClient | null = null;
    try {
      active = this.client();
      const result = await active.sdk.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session) throw new BusinessError('auth_failed');
      // SIGNED_IN 이벤트가 다음 단계를 연다. 입력 비밀번호는 호출자도 즉시 비운다.
    } catch (error) {
      if (this.active === active && this.getSnapshot().phase !== 'signing-out') {
        this.publish({ phase: 'signed-out', working: false, error: authError(error) });
      }
    }
  }

  /**
   * 초대 수락 뒤 첫 계정 생성(공개 가입 화면). 같은 설치 SDK 클라이언트를 쓰므로 두 번째
   * Supabase 클라이언트는 만들지 않고, 세션은 SDK 메모리에만 남는다. 신원 연결에 쓸 접근
   * 토큰만 반환값으로 나가고, 프로젝트가 이메일 확인을 요구하면 세션이 없어 `null` 이다.
   */
  async signUpWithPassword(email: string, password: string): Promise<{ accessToken: string | null }> {
    try {
      const result = await this.client().sdk.auth.signUp({ email, password });
      if (result.error) throw result.error;
      return { accessToken: result.data.session?.access_token ?? null };
    } catch (error) {
      throw authError(error);
    }
  }

  recheck(forceMfa = false): void {
    if (!this.active || !this.session || this.snapshot.working || this.snapshot.phase === 'signing-out') return;
    const revision = this.snapshot.revision + 1;
    this.publish({ revision, phase: 'checking', enrollment: null, factors: [], error: null });
    void this.inspect(this.active.sdk, revision, forceMfa);
  }

  async enroll(): Promise<void> {
    const active = this.active;
    if (!active || this.snapshot.phase !== 'mfa' || this.snapshot.working || this.snapshot.factors.length > 0) return;
    const revision = this.snapshot.revision;
    this.publish({ working: true, enrollment: null, error: null });
    try {
      // 중단된 이 화면의 미확인 등록만 정리한다. 기존 verified factor는 지우지 않는다.
      if (this.pendingFactorId) {
        const factors = await active.sdk.auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        const pending = factors.data.all.find((factor) => factor.id === this.pendingFactorId);
        if (pending?.status === 'verified') throw new BusinessError('mfa_enrollment_failed');
        if (pending) {
          const removed = await active.sdk.auth.mfa.unenroll({ factorId: pending.id });
          if (removed.error) throw removed.error;
        }
        this.pendingFactorId = null;
      }
      if (!this.isCurrent(active.sdk, revision)) return;
      const result = await active.sdk.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Relayer ${crypto.randomUUID()}` });
      if (result.error) throw result.error;
      if (this.active !== active) return;
      this.pendingFactorId = result.data.id;
      if (!this.isCurrent(active.sdk, revision)) return;
      // SVG를 HTML로 삽입하지 않는다. 외부 이미지 주소도 받지 않는다.
      const sdkQr = result.data.totp.qr_code;
      const prefix = 'data:image/svg+xml;utf-8,';
      if (!sdkQr.startsWith(prefix)) throw new BusinessError('mfa_enrollment_failed');
      const qrCode = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sdkQr.slice(prefix.length))}`;
      this.publish({ working: false, enrollment: { id: result.data.id, qrCode, secret: result.data.totp.secret } });
      clearTimeout(this.enrollmentTimer);
      this.enrollmentTimer = setTimeout(() => {
        if (this.snapshot.enrollment?.id === result.data.id) this.publish({ enrollment: null });
      }, 5 * 60_000);
    } catch (error) {
      if (this.isCurrent(active.sdk, revision)) this.publish({ working: false, error: authError(error) });
    }
  }

  async verify(factorId: string, code: string): Promise<void> {
    const active = this.active;
    if (!active || this.snapshot.phase !== 'mfa' || this.snapshot.working) return;
    if (!/^\d{6}$/.test(code) || (factorId !== this.snapshot.enrollment?.id
      && !this.snapshot.factors.some((factor) => factor.id === factorId))) {
      this.publish({ error: new BusinessError('mfa_invalid') });
      return;
    }
    const revision = this.snapshot.revision;
    this.publish({ working: true, error: null });
    try {
      const challenge = await active.sdk.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      if (!this.isCurrent(active.sdk, revision)) return;
      const result = await active.sdk.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      if (result.error) throw result.error;
      // MFA_CHALLENGE_VERIFIED 이벤트가 세션을 교체하고 이전 업무 자료를 비운다.
    } catch (error) {
      if (this.isCurrent(active.sdk, revision)) this.publish({ working: false, error: authError(error) });
    }
  }

  async cancelEnrollment(): Promise<void> {
    const active = this.active;
    if (!active || this.snapshot.working || !this.pendingFactorId) return;
    const factorId = this.pendingFactorId;
    const revision = this.snapshot.revision;
    clearTimeout(this.enrollmentTimer);
    this.publish({ working: true, enrollment: null, error: null });
    try {
      const factors = await active.sdk.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      if (!this.isCurrent(active.sdk, revision)) return;
      const pending = factors.data.all.find((factor) => factor.id === factorId);
      if (pending?.status === 'verified') {
        this.pendingFactorId = null;
        this.publish({ working: false });
        this.recheck();
        return;
      }
      const result = await active.sdk.auth.mfa.unenroll({ factorId });
      if (result.error) throw result.error;
      if (this.isCurrent(active.sdk, revision)) {
        this.pendingFactorId = null;
        this.publish({ working: false });
      }
    } catch (error) {
      if (this.isCurrent(active.sdk, revision)) this.publish({ working: false, error: authError(error) });
    }
  }

  async signOut(reason: BusinessError | null = null): Promise<void> {
    if (this.snapshot.phase === 'signing-out') return;
    const active = this.active;
    clearTimeout(this.idleTimer);
    clearTimeout(this.enrollmentTimer);
    // 업무 화면은 먼저 비우지만 서버 세션 폐기까지 token getter는 유지한다.
    this.publish({ phase: 'signing-out', revision: this.snapshot.revision + 1, working: true,
      factors: [], enrollment: null, error: null });
    let failed = false;
    const revocation = new BusinessTransport(this.installation, this.getToken, this.fetcher);
    try {
      if (active) await active.sdk.auth.stopAutoRefresh().catch(() => { failed = true; });
      if (this.session) await revocation.revokeSession();
    } catch {
      failed = true;
    } finally {
      revocation.dispose();
      try {
        if (active) {
          const result = await active.sdk.auth.signOut({ scope: 'local' });
          if (result.error) failed = true;
        }
      } catch {
        failed = true;
      } finally {
        this.session = null;
        this.pendingFactorId = null;
        this.idleDeadline = null;
        this.active = null;
        if (active) {
          active.lifetime.abort();
          await active.sdk.auth.dispose().catch(() => { failed = true; });
        }
        this.publish({ phase: 'signed-out', working: false,
          error: failed ? new BusinessError('signout_failed') : reason });
      }
    }
  }
}
