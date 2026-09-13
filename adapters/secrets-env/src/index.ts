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
export function createEnvironmentSecretStore(environment: Partial<Record<SecretName | 'PII_KEY_VERSION', string | undefined>>): SecretStore {
  function read(name: SecretName | 'PII_KEY_VERSION'): string | null {
    let value: unknown;
    try { value = Object.hasOwn(environment, name) ? environment[name] : undefined; }
    catch { throw new Error('secret_access_denied'); }
    if (value === undefined) return null;
    if (typeof value !== 'string') throw new Error('secret_invalid');
    return value.trim().length === 0 ? null : value;
  }
  return {
    async get(name) {
      if (!Object.hasOwn(SECRET_NAMES, name) || String(name) === 'PII_ENC_KEY') throw new Error('secret_invalid');
      return read(name);
    },
    async getBytesWithVersion(name) {
      if (name !== 'PII_ENC_KEY') throw new Error('secret_invalid');
      const encoded = read(name);
      if (encoded === null) return null;
      const versionText = read('PII_KEY_VERSION') ?? '1';
      if (!/^[1-9][0-9]*$/.test(versionText) || !Number.isSafeInteger(Number(versionText))
        || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('secret_invalid');
      // Decode provider-owned base64 directly into mutable bytes, without an atob binary string.
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const bytes = new Uint8Array(32);
      let bits = 0, value = 0, offset = 0;
      for (let index = 0; index < 43; index++) {
        value = (value << 6) | alphabet.indexOf(encoded[index]!); bits += 6;
        if (bits >= 8) { bits -= 8; bytes[offset++] = (value >> bits) & 255; }
        value &= (1 << bits) - 1;
      }
      if (value !== 0) { bytes.fill(0); throw new Error('secret_invalid'); }
      return { bytes, version: Number(versionText) };
    },
  };
}
