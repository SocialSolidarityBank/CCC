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

  private async exchange(path: string, method: 'GET' | 'PATCH' | 'PUT' | 'POST', body: unknown, token: string) {
    const target = this.target(path);
    try {
      const response = await this.fetcher(target, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30_000)]),
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (this.lifetime.signal.aborted || this.token() !== token) throw new BusinessError('session_changed');
      if (response.redirected) throw new BusinessError('invalid_response');
      if (path === '/auth/logout' && response.status === 204) return { response, value: null };
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
}
