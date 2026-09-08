import type { SecretName, SecretStore } from '@ccc/contracts/runtime';

export const SECRET_NAMES: Readonly<Record<SecretName, true>> = Object.freeze({
  CODEX_API_KEY: true,
  PII_ENC_KEY: true,
  NOTIFY_WEBHOOK_URL: true,
  DB_MASTER_KEY: true,
  FILE_ENC_KEY: true,
  OFFICE_CA_KEY: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
  SCHEDULER_SECRET: true,
});

/** Synthetic development or provider-injected bindings; never reads ambient process.env. */
export function createEnvironmentSecretStore(environment: Partial<Record<SecretName, string | undefined>>): SecretStore {
  return {
    async get(name) {
      if (!Object.hasOwn(SECRET_NAMES, name)) throw new Error('secret_invalid');
      let value: unknown;
      try {
        value = Object.hasOwn(environment, name) ? environment[name] : undefined;
      } catch {
        throw new Error('secret_access_denied');
      }
      if (value === undefined) return null;
      if (typeof value !== 'string') throw new Error('secret_invalid');
      return value.trim().length === 0 ? null : value;
    },
  };
}
