import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import type { CoreSecretStore, SecretName } from '@ccc/contracts/runtime';
import { resolveAiProviderAdapter } from '@ccc/ai-runtime';
import { notifyAdmins } from '@ccc/core/notify';

// Compile-time capability boundary; never executed.
function coreBoundary(store: CoreSecretStore) {
  // @ts-expect-error Platform keys cannot be read by core consumers.
  void store.get('DB_MASTER_KEY');
  // @ts-expect-error Python Agent keys are not TypeScript secrets.
  void store.get('AZURE_SPEECH_KEY');
}
void coreBoundary;

describe('environment SecretStore', () => {
  it('reads core and platform values without changing nonempty material', async () => {
    const store = createEnvironmentSecretStore({ PII_ENC_KEY: ' synthetic material ', SCHEDULER_SECRET: 'synthetic-scheduler' });
    expect(await store.get('PII_ENC_KEY')).toBe(' synthetic material ');
    expect(await store.get('SCHEDULER_SECRET')).toBe('synthetic-scheduler');
    expect(JSON.stringify(store)).toBe('{}');
  });

  it('returns null for absent, empty, whitespace-only and inherited values', async () => {
    const environment = Object.assign(Object.create({ CODEX_API_KEY: 'inherited-synthetic' }), {
      PII_ENC_KEY: '', NOTIFY_WEBHOOK_URL: ' \t ',
    });
    const store = createEnvironmentSecretStore(environment);
    expect(await store.get('DB_MASTER_KEY')).toBeNull();
    expect(await store.get('PII_ENC_KEY')).toBeNull();
    expect(await store.get('NOTIFY_WEBHOOK_URL')).toBeNull();
    expect(await store.get('CODEX_API_KEY')).toBeNull();
  });

  it('rejects names outside the contract without evaluating their getter', async () => {
    const getter = vi.fn(() => 'synthetic-private-value');
    const environment = Object.defineProperty({}, 'AZURE_SPEECH_KEY', { get: getter });
    const store = createEnvironmentSecretStore(environment);
    await expect(store.get('AZURE_SPEECH_KEY' as SecretName)).rejects.toThrow('secret_invalid');
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not expose environment getter errors or values in diagnostics', async () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = createEnvironmentSecretStore(Object.defineProperty({}, 'PII_ENC_KEY', {
        get() { throw new Error('synthetic-sensitive-provider-message'); },
      }));
      const error = await store.get('PII_ENC_KEY').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe('Error: secret_access_denied');
      expect(JSON.stringify(error)).not.toContain('synthetic-sensitive');
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });
});

describe('secret-consuming services', () => {
  it('keeps the provider credential out of serialized diagnostic objects', async () => {
    const credential = 'synthetic-diagnostic-canary';
    const resolved = await resolveAiProviderAdapter({
      AI_PROVIDER_CONFIG: JSON.stringify({
        registryVersion: 'phase1.v1', providerId: 'codex', adapterVersion: 'v1',
        configVersion: 'v1', model: 'synthetic-model',
      }),
      secretStore: createEnvironmentSecretStore({ CODEX_API_KEY: credential }),
      EXTERNAL_AI_CALLS_ENABLED: '1',
    });
    expect(JSON.stringify(resolved)).not.toContain(credential);
    expect(Object.values(resolved.adapter)).not.toContain(credential);
  });
  it('does not call a provider when its key is missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
    try {
      await expect(resolveAiProviderAdapter({
        AI_PROVIDER_CONFIG: JSON.stringify({
          registryVersion: 'phase1.v1', providerId: 'codex', adapterVersion: 'v1',
          configVersion: 'v1', model: 'synthetic-model',
        }),
        secretStore: createEnvironmentSecretStore({}),
        EXTERNAL_AI_CALLS_ENABLED: '1',
      })).rejects.toMatchObject({ reason: 'api_key_missing' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('keeps notification secret access failures out of logs and does not stop the caller', async () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'));
    try {
      const secretStore = createEnvironmentSecretStore(Object.defineProperty({}, 'NOTIFY_WEBHOOK_URL', {
        get() { throw new Error('synthetic-sensitive-webhook-url'); },
      }));
      await expect(notifyAdmins({ secretStore }, 'synthetic-watchdog-event')).resolves.toBeUndefined();
      expect(JSON.stringify(output.mock.calls)).not.toContain('synthetic-sensitive-webhook-url');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
      fetchMock.mockRestore();
    }
  });
});
