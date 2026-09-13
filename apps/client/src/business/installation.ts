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

export interface InstallationTrust {
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly revokedKeyIds: readonly string[];
  readonly minSequence: number;
  readonly expectedInstallationId: string;
}

const TRUST_FIELDS = ['publicKeys', 'revokedKeyIds', 'minSequence', 'expectedInstallationId'] as const;
function isTrustKeyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value)
    && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

/** Installer-owned input only. Fetched documents never supply their own expected state. */
export function parseInstallationTrust(config: string | undefined): InstallationTrust {
  if (!config) throw new BusinessError('trust_missing');
  try {
    const parsed: unknown = JSON.parse(config);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      || Object.keys(parsed).length !== TRUST_FIELDS.length || !TRUST_FIELDS.every((key) => Object.hasOwn(parsed, key))) throw new Error();
    const input = parsed as Record<string, unknown>;
    if (typeof input.publicKeys !== 'object' || input.publicKeys === null || Array.isArray(input.publicKeys)) throw new Error();
    const entries = Object.entries(input.publicKeys);
    if (entries.length === 0) throw new Error();
    const publicKeys: Record<string, string> = Object.create(null);
    for (const [id, key] of entries) {
      if (!isTrustKeyId(id) || typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error();
      const decoded = atob(key);
      if (decoded.length !== 32 || btoa(decoded) !== key) throw new Error();
      publicKeys[id] = key;
    }
    const { revokedKeyIds, minSequence, expectedInstallationId } = input;
    if (!Array.isArray(revokedKeyIds) || !revokedKeyIds.every(isTrustKeyId)
      || new Set(revokedKeyIds).size !== revokedKeyIds.length
      || typeof minSequence !== 'number' || !Number.isSafeInteger(minSequence) || minSequence < 0
      || typeof expectedInstallationId !== 'string' || expectedInstallationId.trim().length === 0) throw new Error();
    return Object.freeze({ publicKeys: Object.freeze(publicKeys), revokedKeyIds: Object.freeze(revokedKeyIds),
      minSequence, expectedInstallationId });
  } catch {
    throw new BusinessError('trust_missing');
  }
}

export async function loadInstallation(
  clientOrigin: string,
  trustConfig: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedInstallation> {
  const trust = parseInstallationTrust(trustConfig);
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
      ...trust, now: new Date(),
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
