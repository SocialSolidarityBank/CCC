import { createPostgresDatabase } from '@ccc/db-postgres';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import type { CoreSecretName } from '@ccc/contracts/runtime';
import { createCommunityCloudRuntime } from './runtime';
import { assertApplicationCaBinding } from './application-ca.mjs';

declare const Deno: {
  env: { get(name: string): string | undefined; has(name: string): boolean };
  serve(options: { hostname: string; port: number; onListen: () => void }, handler: (request: Request) => Promise<Response>): unknown;
  exit(code: number): never;
};

const SETTING_NAMES = [
  'CCC_STT_MODE', 'CCC_LLM_MODE', 'TEXT_AI_PILOT_ENABLED',
  'EXTERNAL_AI_CALLS_ENABLED', 'PUBLIC_SIGNUP_ENABLED', 'PII_PURGE_ENABLED', 'PII_KEY_VERSION',
] as const;

const BUSINESS_SECRET_NAMES = ['CODEX_API_KEY', 'PII_ENC_KEY', 'NOTIFY_WEBHOOK_URL'] as const satisfies readonly CoreSecretName[];
const PRIVILEGED_BINDINGS = [
  'CCC_INSTALL_SIGNING_PRIVATE_KEY',
  'CCC_INSTALL_DATABASE_URL',
  'CCC_INSTALL_APPROVAL',
  'CCC_BETA_ROOT_SIGNING_PRIVATE_KEY',
  'CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY',
  'CCC_PROVIDER_BASELINE',
  'CCC_BETA_RELEASE_TRUST',
  'CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY',
  'CCC_RELEASE_SIGNING_PRIVATE_KEY',
  'CCC_RELEASE_TRUST_STORE',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_DB_URL', 'SUPABASE_ACCESS_TOKEN',
] as const;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim().length === 0) throw new Error('installation_unavailable');
  return value;
}

async function initialize() {
  // Defense only: deployment identity and injection policy must separately prove privilege isolation.
  if (PRIVILEGED_BINDINGS.some((name) => Deno.env.has(name))) throw new Error('installation_unavailable');
  assertApplicationCaBinding({
    CCC_DATABASE_CA_FILE: Deno.env.get('CCC_DATABASE_CA_FILE'),
    NODE_EXTRA_CA_CERTS: Deno.env.get('NODE_EXTRA_CA_CERTS'),
    DENO_CERT: Deno.env.get('DENO_CERT'),
  });
  const secretBindings: Partial<Record<CoreSecretName, string | undefined>> = {};
  for (const name of BUSINESS_SECRET_NAMES) {
    Object.defineProperty(secretBindings, name, { enumerable: true, get: () => Deno.env.get(name) });
  }
  // Never fall back to Supabase's owner connection. This credential must be for ccc_api.
  const database = createPostgresDatabase({
    connectionString: required('CCC_DATABASE_URL'), maxConnections: 1, ssl: 'verify-full',
  });
  try {
    const settings = Object.fromEntries(SETTING_NAMES.flatMap((name) => {
      const value = Deno.env.get(name);
      return value === undefined ? [] : [[name, value]];
    }));
    return await createCommunityCloudRuntime({
      database,
      secretStore: createEnvironmentSecretStore(Object.defineProperty(secretBindings, 'PII_KEY_VERSION', {
        enumerable: true, get: () => Deno.env.get('PII_KEY_VERSION'),
      })),
      organizationId: required('CCC_ORGANIZATION_ID'),
      installManifest: required('CCC_INSTALL_MANIFEST'),
      signingKeys: required('CCC_INSTALL_SIGNING_KEYS'),
      settings,
      allowHttpIngress: true,
    });
  } catch {
    await database.close();
    throw new Error('installation_unavailable');
  }
}

try {
  const portText = Deno.env.get('PORT') ?? '8080';
  const port = Number(portText);
  if (!/^[0-9]+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('installation_unavailable');
  }
  const runtime = await initialize();
  Deno.serve({ hostname: '0.0.0.0', port, onListen: () => {} }, runtime);
} catch {
  console.error('installation_unavailable');
  Deno.exit(1);
}
