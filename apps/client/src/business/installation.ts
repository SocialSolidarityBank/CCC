import {
  assertBootstrapMatchesManifest, parsePublicBootstrap, resolveEffectiveApiBase, verifySignedInstallManifest,
} from '@ccc/contracts/install-manifest';
import type { SignedInstallManifest } from '@ccc/contracts/runtime';
import { BusinessError, safeError } from './errors';

const verified = new WeakSet<VerifiedInstallation>();
export interface VerifiedInstallation {
  readonly manifest: Readonly<SignedInstallManifest>;
  readonly apiBase: string;
}

export function assertInstallationCurrent(installation: VerifiedInstallation): void {
  if (!verified.has(installation)) throw new BusinessError('installation_invalid');
  if (Date.parse(installation.manifest.expiresAt) <= Date.now()) throw new BusinessError('installation_expired');
}

/** 공개 키만 받는다. 서명 대상 문서에서 신뢰할 키를 가져오지 않는다. */
function trustedKeys(config: string | undefined): Record<string, string> {
  if (!config) throw new BusinessError('trust_missing');
  try {
    const parsed: unknown = JSON.parse(config);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const entries = Object.entries(parsed);
    if (entries.length === 0) throw new Error();
    const keys: Record<string, string> = Object.create(null);
    for (const [id, key] of entries) {
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id) || typeof key !== 'string'
        || !/^[A-Za-z0-9+/]{43}=$/.test(key) || atob(key).length !== 32) throw new Error();
      keys[id] = key;
    }
    return keys;
  } catch {
    throw new BusinessError('trust_missing');
  }
}

export async function loadInstallation(
  clientOrigin: string,
  publicKeyConfig: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedInstallation> {
  const publicKeys = trustedKeys(publicKeyConfig);
  async function publicJson(path: string): Promise<unknown> {
    try {
      const response = await fetcher(`${clientOrigin}${path}`, {
        method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || response.redirected) throw new BusinessError('installation_invalid');
      return await response.json();
    } catch (error) {
      throw safeError(error);
    }
  }
  try {
    const manifest = await verifySignedInstallManifest(await publicJson('/ccc-install-manifest.json'), {
      publicKeys, now: new Date(),
    });
    if (manifest.clientOrigin !== clientOrigin || !manifest.allowedOrigins.includes(clientOrigin)) {
      throw new BusinessError('installation_invalid');
    }
    const bootstrap = parsePublicBootstrap(await publicJson('/ccc-bootstrap.json'));
    assertBootstrapMatchesManifest(bootstrap, manifest);
    if (manifest.mode === 'local-single') throw new BusinessError('local_single_unsupported');
    if (manifest.mode === 'local-office') throw new BusinessError('local_office_unsupported');
    const apiBase = resolveEffectiveApiBase(manifest, null);
    const url = new URL(apiBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || /[%\\]/.test(url.pathname)) throw new BusinessError('installation_invalid');
    Object.freeze(manifest.allowedOrigins);
    for (const engine of manifest.approvedSttEngineIds) Object.freeze(engine);
    Object.freeze(manifest.approvedSttEngineIds);
    const installation = Object.freeze({ manifest: Object.freeze(manifest), apiBase });
    verified.add(installation);
    return installation;
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('installation_invalid');
  }
}
