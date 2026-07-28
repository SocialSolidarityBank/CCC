import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { ApiEnv } from '../src/identity';
import type { AiProviderAdapter } from '../src/ai-provider';

const healthEnv: ApiEnv = {
  DB: undefined as unknown as D1Database,
  PII_ENC_KEY: 'local-test-key-not-for-production',
  AUDIO_BUCKET: undefined as unknown as R2Bucket,
};

describe('health route', () => {
  it('returns the local API health payload', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/health'),
      healthEnv,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'ccc-api' });
  });
  it('does not invoke a configured provider for health', async () => {
    let calls = 0;
    const adapter: AiProviderAdapter = {
      providerId: 'codex',
      adapterVersion: 'test.v1',
      async generate() {
        calls += 1;
        throw new Error('provider must not run for health');
      },
    };

    const response = await worker.fetch(
      new Request('http://localhost/health'),
      { ...healthEnv, AI_PROVIDER_ADAPTER: adapter },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'ccc-api' });
    expect(calls).toBe(0);
  });
});
