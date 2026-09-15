import { decodeCapabilityManifest } from '@ccc/contracts/capabilities';
import type { CapabilityManifest } from '@ccc/contracts/runtime';
import { assertInstallationCurrent, type VerifiedInstallation } from './installation';
import { BusinessError, httpError, safeError } from './errors';

const AUDIT_QUERY_KEYS = ['limit', 'cursor', 'actorId', 'from', 'to', 'supportCaseId'];
const HISTORY_QUERY_KEYS = ['limit', 'cursor'];
const CURSOR_QUERY_KEYS = ['cursor'];
/** 일정 화면은 서버가 정한 달만 고른다. 임의 필터를 주소로 붙이지 않는다. */
const MONTH_QUERY_KEYS = ['month'];
/** 기록 목록은 공식 기록만 고른다. 승인 전 초안을 주소로 불러올 길을 열지 않는다. */
const OFFICIAL_QUERY_KEYS = ['official'];


/** 한 인증 상태에만 속한다. refresh, 계정 변경, 로그아웃 때 버리고 다시 검증한다. */
export class BusinessTransport {
  private readonly lifetime = new AbortController();
  private capabilityToken: string | null = null;


  constructor(
    private readonly installation: VerifiedInstallation,
    private readonly token: () => string | null,
    // 브라우저 fetch는 Window 수신자를 요구한다(CloudAuth와 같은 이유).
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  dispose(): void {
    this.capabilityToken = null;
    this.lifetime.abort();
  }

  private target(path: string): string {
    assertInstallationCurrent(this.installation);
    // 경로는 고정된 API 세그먼트만 허용하고, 식별자의 percent-encoding과 감사 목록의 제한된 쿼리만 허용한다.
    const queryAt = path.indexOf('?');
    const pathname = queryAt < 0 ? path : path.slice(0, queryAt);
    const query = queryAt < 0 ? undefined : path.slice(queryAt + 1);
    if (!/^\/(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+(?:\/(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+)*$/.test(pathname)
      || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(pathname)
      || (query !== undefined && !/^(?:[A-Za-z0-9._~-]+=[A-Za-z0-9._~%+-]*)(?:&[A-Za-z0-9._~-]+=[A-Za-z0-9._~%+-]*)*$/.test(query))) {
      throw new BusinessError('invalid_api_path');
    }
    if (query !== undefined) {
      const permitted = pathname === '/audit-log' ? AUDIT_QUERY_KEYS
        : pathname === '/schedules/month' ? MONTH_QUERY_KEYS
        : /^\/support-cases\/[^/]+\/records$/.test(pathname) ? OFFICIAL_QUERY_KEYS
          : /^\/support-cases\/[^/]+\/export-history$/.test(pathname) ? HISTORY_QUERY_KEYS
            : pathname === '/exports/cases' || pathname === '/settings/accounts' || pathname === '/settings/assignments/cases'
              ? CURSOR_QUERY_KEYS : [];
      const seen = new Set<string>();
      for (const key of new URLSearchParams(query).keys()) {
        if (!permitted.includes(key) || seen.has(key)) throw new BusinessError('invalid_api_path');
        seen.add(key);
      }
    }
    return `${this.installation.apiBase.replace(/\/$/, '')}${path}`;
  }

  private currentToken(): string {
    if (this.lifetime.signal.aborted) throw new BusinessError('session_changed');
    const token = this.token();
    if (!token) throw new BusinessError('unauthenticated', 401);
    return token;
  }

  private async exchange(
    path: string,
    method: 'GET' | 'PATCH' | 'PUT' | 'POST',
    body: unknown,
    token: string,
    accept = 'application/json',
    raw?: { body: File; contentType: string; timeoutMs?: number },
  ) {
    const target = this.target(path);
    try {
      const response = await this.fetcher(target, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(raw?.timeoutMs ?? 30_000)]),
        headers: { Accept: accept, Authorization: `Bearer ${token}`,
          ...(raw !== undefined ? { 'Content-Type': raw.contentType }
            : body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(raw !== undefined ? { body: raw.body } : body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (this.lifetime.signal.aborted || this.token() !== token) throw new BusinessError('session_changed');
      if (response.redirected) throw new BusinessError('invalid_response');
      if (path === '/auth/logout' && response.status === 204) return { response, value: null };
      if (accept !== 'application/json' && response.ok) {
        if (!(response.headers.get('content-type') ?? '').startsWith(accept)) throw new BusinessError('invalid_response');
        return { response, value: await response.blob() };
      }
      const value: unknown = await response.json().catch(() => null);
      if (this.lifetime.signal.aborted || this.token() !== token) throw new BusinessError('session_changed');
      if (!response.ok) throw httpError(response.status, value);
      if (value === null) throw new BusinessError('invalid_response');
      return { response, value };
    } catch (error) {
      if (this.lifetime.signal.aborted) throw new BusinessError('session_changed');
      throw safeError(error);
    }
  }

  async initialize(): Promise<CapabilityManifest> {
    this.capabilityToken = null;
    const token = this.currentToken();
    const { response, value } = await this.exchange('/capabilities', 'GET', undefined, token);
    if (response.headers.get('X-CCC-Installation-Id') !== this.installation.manifest.installationId) {
      throw new BusinessError('installation_mismatch');
    }
    let capabilities: CapabilityManifest;
    try {
      capabilities = decodeCapabilityManifest(value, this.installation.manifest.approvedSttEngineIds);
    } catch {
      throw new BusinessError('capabilities_invalid');
    }
    if (capabilities.mode !== this.installation.manifest.mode) throw new BusinessError('installation_mismatch');
    this.capabilityToken = token;
    return capabilities;
  }

  /** MFA나 capability 확인 실패 때도 자기 세션은 폐기할 수 있어야 한다. */
  async revokeSession(): Promise<void> {
    const { response } = await this.exchange('/auth/logout', 'POST', {}, this.currentToken());
    if (response.status !== 204) throw new BusinessError('invalid_response');
  }

  async request(path: string, method: 'GET' | 'PATCH' | 'PUT' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
    this.target(path);
    const token = this.currentToken();
    if (this.capabilityToken !== token) throw new BusinessError('capabilities_required');
    const { value } = await this.exchange(path, method, body, token);
    return value;
  }

  /** 서버가 만든 CSV를 그대로 받는다. 본문은 화면에 쓰지 않고 파일로만 넘긴다. */
  async download(path: string): Promise<{ blob: Blob; filename: string | null }> {
    this.target(path);
    const token = this.currentToken();
    if (this.capabilityToken !== token) throw new BusinessError('capabilities_required');
    const { response, value } = await this.exchange(path, 'GET', undefined, token, 'text/csv');
    if (!(value instanceof Blob)) throw new BusinessError('invalid_response');
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
    let filename: string | null = null;
    try { filename = encoded !== undefined ? decodeURIComponent(encoded) : plain ?? null; }
    catch { filename = plain ?? null; }
    return { blob: value, filename };
  }

  /**
   * 녹음 원음을 본문 그대로 올리는 Local 경로(PUT /sessions/:id/audio). JSON 계열과 달리
   * 파일을 스트리밍하고 서버가 돌려주는 세션 응답을 그대로 넘긴다.
   */
  async putFile(path: string, file: File, contentType: string): Promise<unknown> {
    this.target(path);
    const token = this.currentToken();
    if (this.capabilityToken !== token) throw new BusinessError('capabilities_required');
    const { value } = await this.exchange(path, 'PUT', undefined, token, 'application/json',
      { body: file, contentType, timeoutMs: 300_000 });
    return value;
  }

  /**
   * 서버가 발급한 업로드 대상(Supabase signed URL)으로만 본다. Bearer 를 붙이지 않고,
   * 대상은 설치가 서명한 API 와 같은 origin 이어야 한다.
   */
  async putSigned(url: string, file: File, contentType: string): Promise<void> {
    let target: URL;
    try { target = new URL(url); } catch { throw new BusinessError('invalid_response'); }
    if (target.origin !== new URL(this.installation.apiBase).origin) throw new BusinessError('invalid_response');
    try {
      const response = await this.fetcher(target.href, {
        method: 'PUT', credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000)]),
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (this.lifetime.signal.aborted) throw new BusinessError('session_changed');
      if (response.redirected || !response.ok) throw new BusinessError('unavailable', response.status);
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      if (this.lifetime.signal.aborted) throw new BusinessError('session_changed');
      throw safeError(error);
    }
  }
}

/**
 * 인증 없이 토큰만으로 도는 공개 경로 전송기(D86 ③④). Bearer 를 붙이지 않고, 아래 세 모양의
 * 경로만 허용한다. 업무 API 는 이 전송기로 부르지 않는다.
 */
const PUBLIC_PATHS: readonly RegExp[] = [
  /^\/invites\/participant\/[A-Za-z0-9_-]{1,300}$/u,
  /^\/invites\/participant\/[A-Za-z0-9_-]{1,300}\/consent\/disclosures$/u,
  /^\/signup\/participant$/u,
];

export class PublicTransport {
  constructor(
    private readonly installation: VerifiedInstallation,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
    assertInstallationCurrent(this.installation);
    if (!PUBLIC_PATHS.some((pattern) => pattern.test(path))) throw new BusinessError('invalid_api_path');
    const target = `${this.installation.apiBase.replace(/\/$/, '')}${path}`;
    try {
      const response = await this.fetcher(target, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.redirected) throw new BusinessError('invalid_response');
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) throw httpError(response.status, value);
      if (value === null) throw new BusinessError('invalid_response');
      return value;
    } catch (error) {
      throw safeError(error);
    }
  }
}
