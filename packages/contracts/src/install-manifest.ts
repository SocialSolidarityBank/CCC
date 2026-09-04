/**
 * 설치 신뢰 경계 (S2 §2.7, E1-7).
 *
 * client 와 서버가 같은 signed install manifest 를 검증한다. 서명은 RFC 8785 JCS 로 정규화한
 * signature 제외 객체에 대한 Ed25519 다. 여기에는 비밀, bearer, orgId, userId, email 이 없다.
 * 설치기가 파일을 만드는 쪽(E6/E7/E8)과 client 가 fetch 하는 쪽(E2-3)은 이 모듈만 부른다.
 */
import { isRecord } from './guards';
import { canonicalizeJcs } from './jcs';
import { isValidSttEngineIdShape } from './capabilities';
import {
  type ApprovedSttEngineEntry,
  DEPLOYMENT_MODES,
  type DeploymentMode,
  type PublicBootstrap,
  type SignedInstallManifest,
} from './runtime';

export type InstallManifestErrorCode =
  | 'invalid_shape'
  | 'unknown_key'
  | 'key_revoked'
  | 'signature_mismatch'
  | 'expired'
  | 'sequence_replay'
  | 'wrong_install'
  | 'mode_fields'
  | 'auth_origin'
  | 'project_ref_mismatch'
  | 'publishable_key'
  | 'endpoint'
  | 'bootstrap_mismatch';

export class InstallManifestError extends Error {
  constructor(readonly code: InstallManifestErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
  }
}

const MANIFEST_KEYS = [
  'schemaVersion', 'mode', 'apiBase', 'clientOrigin', 'allowedOrigins', 'host', 'scheme', 'endpointDiscovery',
  'installationId', 'sequence', 'publishedAt', 'expiresAt', 'approvedSttEngineIds', 'supabaseProjectRef',
  'supabaseAuthOrigin', 'supabasePublishableKey', 'signingKeyId', 'ed25519Signature',
] as const;
const BOOTSTRAP_KEYS = ['apiBase', 'mode'] as const;
const ED25519 = { name: 'Ed25519' } as const;
/** Local Single 의 서명된 base. 실제 random port 는 DPAPI endpoint record 가 더한다. */
export const SINGLE_LOOPBACK_BASE = 'http://127.0.0.1';
export const SINGLE_CLIENT_ORIGIN = 'ccc://app';

export interface InstallSigningKeys {
  /** keyId → base64 raw Ed25519 public key(32 byte). */
  publicKeys: Record<string, string>;
  revokedKeyIds?: readonly string[];
}

export interface VerifyInstallManifestOptions extends InstallSigningKeys {
  now: Date;
  /** 마지막으로 받아들인 sequence. 그보다 작으면 replay 다. */
  minSequence?: number;
  /** DPAPI record 나 이전 manifest 가 아는 installationId. 다르면 wrong_install. */
  expectedInstallationId?: string;
}

export interface SingleEndpointRecord {
  installationId: string;
  port: number;
}

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function exactOrigin(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new InstallManifestError('invalid_shape', what);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InstallManifestError('invalid_shape', what);
  }
  // origin 은 scheme://host[:port] 뿐이다. path, query, fragment, userinfo 는 exact origin 이 아니다.
  const isCustomScheme = parsed.protocol === 'ccc:';
  const origin = isCustomScheme ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  if (origin !== value || parsed.username.length > 0 || parsed.password.length > 0) {
    throw new InstallManifestError('invalid_shape', `${what} must be an exact origin`);
  }
  return value;
}

function projectRefOf(url: string): string {
  return new URL(url).hostname.split('.')[0] ?? '';
}

export function isSupabasePublishableKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return isRecord(payload) && payload.role === 'anon';
  } catch {
    return false;
  }
}

function parseEngineRegistry(value: unknown): ApprovedSttEngineEntry[] {
  if (!Array.isArray(value)) throw new InstallManifestError('invalid_shape', 'approvedSttEngineIds');
  const entries = value.map((item): ApprovedSttEngineEntry => {
    if (!isRecord(item) || typeof item.id !== 'string' || !isValidSttEngineIdShape(item.id)
      || (item.mode !== 'local' && item.mode !== 'azure') || Object.keys(item).length !== 2) {
      throw new InstallManifestError('invalid_shape', 'approvedSttEngineIds entry');
    }
    return { id: item.id, mode: item.mode };
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.id >= entries[index]!.id) {
      throw new InstallManifestError('invalid_shape', 'approvedSttEngineIds must be sorted by id and unique');
    }
  }
  return entries;
}

/** 서명 검증 전 구조 검사. 서명이 맞아도 shape 가 틀리면 신뢰하지 않는다. */
function parseManifestShape(value: unknown): SignedInstallManifest {
  if (!isRecord(value)) throw new InstallManifestError('invalid_shape');
  const keys = Object.keys(value).sort();
  const expected = [...MANIFEST_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new InstallManifestError('invalid_shape', 'keys');
  }
  if (value.schemaVersion !== 1) throw new InstallManifestError('invalid_shape', 'schemaVersion');
  if (!DEPLOYMENT_MODES.includes(value.mode as DeploymentMode)) throw new InstallManifestError('invalid_shape', 'mode');
  if (typeof value.apiBase !== 'string' || typeof value.host !== 'string' || value.host.length === 0) {
    throw new InstallManifestError('invalid_shape', 'apiBase/host');
  }
  try {
    new URL(value.apiBase);
  } catch {
    throw new InstallManifestError('invalid_shape', 'apiBase');
  }
  const clientOrigin = exactOrigin(value.clientOrigin, 'clientOrigin');
  if (!Array.isArray(value.allowedOrigins) || value.allowedOrigins.length === 0) {
    throw new InstallManifestError('invalid_shape', 'allowedOrigins');
  }
  const allowedOrigins = value.allowedOrigins.map((origin) => exactOrigin(origin, 'allowedOrigins'));
  if (!allowedOrigins.includes(clientOrigin)) throw new InstallManifestError('invalid_shape', 'allowedOrigins must include clientOrigin');
  if (value.scheme !== 'https' && value.scheme !== 'http' && value.scheme !== 'ccc') throw new InstallManifestError('invalid_shape', 'scheme');
  if (value.endpointDiscovery !== 'static' && value.endpointDiscovery !== 'dpapi-record') {
    throw new InstallManifestError('invalid_shape', 'endpointDiscovery');
  }
  if (typeof value.installationId !== 'string' || value.installationId.length === 0) throw new InstallManifestError('invalid_shape', 'installationId');
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new InstallManifestError('invalid_shape', 'sequence');
  }
  for (const field of ['publishedAt', 'expiresAt'] as const) {
    const raw = value[field];
    if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) throw new InstallManifestError('invalid_shape', field);
  }
  for (const field of ['supabaseProjectRef', 'supabaseAuthOrigin', 'supabasePublishableKey'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') throw new InstallManifestError('invalid_shape', field);
  }
  if (typeof value.signingKeyId !== 'string' || value.signingKeyId.length === 0) throw new InstallManifestError('invalid_shape', 'signingKeyId');
  if (typeof value.ed25519Signature !== 'string' || value.ed25519Signature.length === 0) throw new InstallManifestError('invalid_shape', 'ed25519Signature');
  return {
    schemaVersion: 1,
    mode: value.mode as DeploymentMode,
    apiBase: value.apiBase,
    clientOrigin,
    allowedOrigins,
    host: value.host,
    scheme: value.scheme,
    endpointDiscovery: value.endpointDiscovery,
    installationId: value.installationId,
    sequence: value.sequence,
    publishedAt: value.publishedAt as string,
    expiresAt: value.expiresAt as string,
    approvedSttEngineIds: parseEngineRegistry(value.approvedSttEngineIds),
    supabaseProjectRef: value.supabaseProjectRef as string | null,
    supabaseAuthOrigin: value.supabaseAuthOrigin as string | null,
    supabasePublishableKey: value.supabasePublishableKey as string | null,
    signingKeyId: value.signingKeyId,
    ed25519Signature: value.ed25519Signature,
  };
}

/** 모드별 규칙(S2 §2.7). Cloud 만 Supabase 세 값을 갖고 Local 은 전부 null 이다. */
function assertModeFields(manifest: SignedInstallManifest): void {
  const api = new URL(manifest.apiBase);
  if (manifest.mode === 'community-cloud') {
    if (api.protocol !== 'https:' || manifest.scheme !== 'https' || manifest.endpointDiscovery !== 'static') {
      throw new InstallManifestError('mode_fields', 'community-cloud requires https static endpoint');
    }
    if (manifest.supabaseProjectRef === null || manifest.supabaseAuthOrigin === null || manifest.supabasePublishableKey === null) {
      throw new InstallManifestError('mode_fields', 'community-cloud requires supabase fields');
    }
    const authOrigin = exactOrigin(manifest.supabaseAuthOrigin, 'supabaseAuthOrigin');
    if (!authOrigin.startsWith('https://')) throw new InstallManifestError('auth_origin', 'must be https');
    if (projectRefOf(authOrigin) !== manifest.supabaseProjectRef || projectRefOf(manifest.apiBase) !== manifest.supabaseProjectRef) {
      throw new InstallManifestError('project_ref_mismatch');
    }
    if (!isSupabasePublishableKey(manifest.supabasePublishableKey)) throw new InstallManifestError('publishable_key');
    return;
  }
  if (manifest.supabaseProjectRef !== null || manifest.supabaseAuthOrigin !== null || manifest.supabasePublishableKey !== null) {
    throw new InstallManifestError('mode_fields', 'local modes must not carry supabase fields');
  }
  if (manifest.mode === 'local-office') {
    if (api.protocol !== 'https:' || manifest.scheme !== 'https' || manifest.endpointDiscovery !== 'static') {
      throw new InstallManifestError('mode_fields', 'local-office requires https static endpoint');
    }
    return;
  }
  if (manifest.apiBase !== SINGLE_LOOPBACK_BASE || manifest.scheme !== 'ccc' || manifest.endpointDiscovery !== 'dpapi-record'
    || manifest.clientOrigin !== SINGLE_CLIENT_ORIGIN) {
    throw new InstallManifestError('mode_fields', 'local-single requires loopback base, ccc scheme and dpapi-record discovery');
  }
}

export async function verifySignedInstallManifest(
  value: unknown,
  options: VerifyInstallManifestOptions,
): Promise<SignedInstallManifest> {
  const manifest = parseManifestShape(value);
  const publicKey = options.publicKeys[manifest.signingKeyId];
  if (publicKey === undefined) throw new InstallManifestError('unknown_key');
  if (options.revokedKeyIds?.includes(manifest.signingKeyId)) throw new InstallManifestError('key_revoked');
  const { ed25519Signature, ...unsigned } = manifest;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      ED25519,
      await crypto.subtle.importKey('raw', bytesFromBase64(publicKey), ED25519, false, ['verify']),
      bytesFromBase64(ed25519Signature),
      new TextEncoder().encode(canonicalizeJcs(unsigned)),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new InstallManifestError('signature_mismatch');
  if (Date.parse(manifest.expiresAt) <= options.now.getTime()) throw new InstallManifestError('expired');
  if (options.minSequence !== undefined && manifest.sequence < options.minSequence) throw new InstallManifestError('sequence_replay');
  if (options.expectedInstallationId !== undefined && manifest.installationId !== options.expectedInstallationId) {
    throw new InstallManifestError('wrong_install');
  }
  assertModeFields(manifest);
  return manifest;
}

/** 설치기와 테스트가 쓰는 서명. private key 는 호출자가 SecretStore 에서 꺼낸다. */
export async function signInstallManifest(
  unsigned: Omit<SignedInstallManifest, 'ed25519Signature'>,
  privateKey: CryptoKey,
): Promise<SignedInstallManifest> {
  const signature = await crypto.subtle.sign(ED25519, privateKey, new TextEncoder().encode(canonicalizeJcs(unsigned)));
  return { ...unsigned, ed25519Signature: btoa(String.fromCharCode(...new Uint8Array(signature))) };
}

/** public bootstrap 은 정확히 `{ apiBase, mode }` 두 키다. */
export function parsePublicBootstrap(value: unknown): PublicBootstrap {
  if (!isRecord(value)) throw new InstallManifestError('invalid_shape', 'bootstrap');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== BOOTSTRAP_KEYS[0] || keys[1] !== BOOTSTRAP_KEYS[1]) {
    throw new InstallManifestError('invalid_shape', 'bootstrap keys');
  }
  if (typeof value.apiBase !== 'string' || !DEPLOYMENT_MODES.includes(value.mode as DeploymentMode)) {
    throw new InstallManifestError('invalid_shape', 'bootstrap values');
  }
  return { apiBase: value.apiBase, mode: value.mode as DeploymentMode };
}

/** unsigned bootstrap 은 signed manifest 와 mode·apiBase 가 exact equality 여야 한다. */
export function assertBootstrapMatchesManifest(bootstrap: PublicBootstrap, manifest: SignedInstallManifest): void {
  if (bootstrap.mode !== manifest.mode || bootstrap.apiBase !== manifest.apiBase) {
    throw new InstallManifestError('bootstrap_mismatch');
  }
}

/**
 * 실제 호출에 쓸 apiBase. Single 만 DPAPI endpoint record 의 random port 를 더하고,
 * record 의 installationId 가 다르거나 loopback 이 아니면 거부한다.
 */
export function resolveEffectiveApiBase(manifest: SignedInstallManifest, endpointRecord: SingleEndpointRecord | null): string {
  if (manifest.mode !== 'local-single') return manifest.apiBase;
  if (endpointRecord === null) throw new InstallManifestError('endpoint', 'local-single requires an endpoint record');
  if (endpointRecord.installationId !== manifest.installationId) throw new InstallManifestError('wrong_install');
  if (!Number.isInteger(endpointRecord.port) || endpointRecord.port < 1 || endpointRecord.port > 65535) {
    throw new InstallManifestError('endpoint', 'port');
  }
  return `${SINGLE_LOOPBACK_BASE}:${endpointRecord.port}`;
}
