import { decodeCapabilityManifest } from '@ccc/contracts/capabilities';
import type { CapabilityManifest } from '@ccc/contracts/runtime';
import { assertInstallationCurrent, type VerifiedInstallation } from './installation';
import { BusinessError, httpError, safeError } from './errors';

/** 한 인증 상태에만 속한다. refresh, 계정 변경, 로그아웃 때 버리고 다시 검증한다. */
export class BusinessTransport {
  private readonly lifetime = new AbortController();
  private capabilityToken: string | null = null;

  constructor(
    private readonly installation: VerifiedInstallation,
    private readonly token: () => string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  dispose(): void {
    this.capabilityToken = null;
    this.lifetime.abort();
  }

  private target(path: string): string {
    assertInstallationCurrent(this.installation);
    // 현재 업무 API는 고정 경로뿐이다. 인코딩, dot segment, 쿼리와 절대 주소는 받지 않는다.
    if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path)) throw new BusinessError('invalid_api_path');
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

  async request(path: string, method: 'GET' | 'PATCH' | 'PUT' = 'GET', body?: unknown): Promise<unknown> {
    this.target(path);
    const token = this.currentToken();
    if (this.capabilityToken !== token) throw new BusinessError('capabilities_required');
    const { value } = await this.exchange(path, method, body, token);
    return value;
  }
}
