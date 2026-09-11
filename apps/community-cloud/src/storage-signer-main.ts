/**
 * StorageSigner 전용 진입점. 업무 runtime 과 같은 서명된 설치 manifest 만 믿고,
 * 업무 비밀이 하나라도 주입되어 있으면 listen 전에 죽는다(S11 §2.7-2.8).
 */
import { verifySignedInstallManifest } from '@ccc/contracts/install-manifest';
import { createStorageSignerHandler } from './storage-signer';

declare const Deno: {
  env: { get(name: string): string | undefined; has(name: string): boolean };
  serve(options: { hostname: string; port: number; onListen: () => void }, handler: (request: Request) => Promise<Response>): unknown;
  exit(code: number): never;
};

/** 이 배포 단위는 서명만 한다. 업무 자료와 설치 권한에는 어떤 경로로도 닿지 않는다. */
const FORBIDDEN_BINDINGS = [
  'CCC_DATABASE_URL',
  'CODEX_API_KEY',
  'PII_ENC_KEY',
  'NOTIFY_WEBHOOK_URL',
  'SCHEDULER_SECRET',
  'CCC_INSTALL_DATABASE_URL',
  'CCC_INSTALL_SIGNING_PRIVATE_KEY',
  'CCC_BETA_ROOT_SIGNING_PRIVATE_KEY',
  'CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY',
  'CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY',
  'CCC_RELEASE_SIGNING_PRIVATE_KEY',
  'CCC_INSTALL_APPROVAL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_DB_URL',
  'SUPABASE_ACCESS_TOKEN',
] as const;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim().length === 0) throw new Error('storage_signer_unavailable');
  return value;
}

function parseSigningKeys(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('storage_signer_unavailable');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Object.values(parsed).some((value) => typeof value !== 'string')) {
    throw new Error('storage_signer_unavailable');
  }
  return parsed as Record<string, string>;
}

async function initialize(): Promise<(request: Request) => Promise<Response>> {
  if (FORBIDDEN_BINDINGS.some((name) => Deno.env.has(name))) throw new Error('storage_signer_unavailable');
  let raw: unknown;
  try {
    raw = JSON.parse(required('CCC_INSTALL_MANIFEST'));
  } catch {
    throw new Error('storage_signer_unavailable');
  }
  const manifest = await verifySignedInstallManifest(raw, {
    publicKeys: parseSigningKeys(required('CCC_INSTALL_SIGNING_KEYS')),
    now: new Date(),
  });
  if (manifest.mode !== 'community-cloud' || manifest.supabaseAuthOrigin === null) {
    throw new Error('storage_signer_unavailable');
  }
  return createStorageSignerHandler({
    apiBase: manifest.apiBase,
    installationId: manifest.installationId,
    supabaseOrigin: manifest.supabaseAuthOrigin,
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    region: 'ap-northeast-2',
  });
}

try {
  const portText = required('PORT');
  const port = Number(portText);
  if (!/^[0-9]+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('storage_signer_unavailable');
  }
  const handler = await initialize();
  Deno.serve({ hostname: '0.0.0.0', port, onListen: () => {} }, handler);
} catch {
  // 실패 원인과 주입값은 어디에도 남기지 않는다.
  console.error('storage_signer_unavailable');
  Deno.exit(1);
}
