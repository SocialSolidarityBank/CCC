import { createPostgresDatabase } from '@ccc/db-postgres';
import { createEnvironmentSecretStore, SECRET_NAMES } from '@ccc/secrets-env';
import type { SecretName } from '@ccc/contracts/runtime';
import { createCommunityCloudRuntime } from './runtime';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

const SETTING_NAMES = [
  'CCC_STT_MODE', 'CCC_LLM_MODE', 'TEXT_AI_PILOT_ENABLED',
  'EXTERNAL_AI_CALLS_ENABLED', 'PUBLIC_SIGNUP_ENABLED', 'PII_PURGE_ENABLED',
] as const;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim().length === 0) throw new Error('installation_unavailable');
  return value;
}

async function initialize() {
  const secretBindings: Partial<Record<SecretName, string | undefined>> = {};
  for (const name of Object.keys(SECRET_NAMES)) {
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
      secretStore: createEnvironmentSecretStore(secretBindings),
      organizationId: required('CCC_ORGANIZATION_ID'),
      installManifest: required('CCC_INSTALL_MANIFEST'),
      signingKeys: required('CCC_INSTALL_SIGNING_KEYS'),
      settings,
    });
  } catch {
    await database.close();
    throw new Error('installation_unavailable');
  }
}

const runtime = initialize().catch(() => null);
Deno.serve(async (request) => {
  const handler = await runtime;
  if (handler === null) {
    return new Response(JSON.stringify({ error: 'service_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return handler(request);
});
