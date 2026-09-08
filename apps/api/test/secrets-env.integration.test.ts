import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { createCase, registerPii, revealPii } from '@ccc/core/gateway';
import worker from '../src/index';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const pii = { name: 'SYNTHETIC_SECRETSTORE_PERSON' };

describe('SecretStore PII and Workers composition', () => {
  it('decrypts stored PII through raw Worker bindings without exposing key material', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, {});
    await registerPii(t.env, testActors.admin, created.id, pii);
    const { secretStore, ...bindings } = t.env;
    const key = await secretStore.get('PII_ENC_KEY');
    if (key === null) throw new Error('synthetic fixture key missing');
    const runtime = {
      ...bindings,
      PII_ENC_KEY: key,
      LOCAL_ACTOR_HEADER_MODE: 'true',
      LOCAL_DEV_ACTOR_EMAIL: testActors.admin.userId,
    };
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), runtime);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(pii.name);
      expect(body).not.toContain(key);
      expect(body).not.toContain('PII_ENC_KEY');
      expect(JSON.stringify(output.mock.calls)).not.toContain(key);

      const missing = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), {
        ...bindings,
        LOCAL_ACTOR_HEADER_MODE: 'true',
        LOCAL_DEV_ACTOR_EMAIL: testActors.admin.userId,
      });
      expect(missing.status).toBe(500);
      expect(await missing.json()).toEqual({ error: 'internal_error' });
    } finally {
      output.mockRestore();
    }
  });

  it('rejects missing and malformed PII keys without overwriting encrypted records', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, {});
    await registerPii(t.env, testActors.admin, created.id, pii);
    for (const [value, errorCode] of [
      [undefined, 'secret_missing'],
      ['synthetic%%%invalid-base64', 'secret_invalid'],
      [btoa('short-synthetic-key'), 'secret_invalid'],
    ] as const) {
      const env = { ...t.env, secretStore: createEnvironmentSecretStore({ PII_ENC_KEY: value }) };
      await expect(registerPii(env, testActors.admin, created.id, { ...pii, name: 'SHOULD_NOT_REPLACE' }))
        .rejects.toThrow(errorCode);
    }
    const revealed = await revealPii(t.env, testActors.admin, created.id);
    expect(revealed.name).toBe(pii.name);
  });

  it('does not evaluate unused or shadowed raw bindings during composition', async () => {
    await t.reset();
    const { secretStore, ...bindings } = t.env;
    for (const base of [bindings, { ...bindings, secretStore }]) {
      const getter = vi.fn(() => { throw new Error('synthetic-sensitive-binding-error'); });
      const env = Object.defineProperty(base, 'NOTIFY_WEBHOOK_URL', { enumerable: true, get: getter });
      const response = await worker.fetch(new Request('http://localhost/health'), env);
      expect(response.status).toBe(200);
      expect(getter).not.toHaveBeenCalled();
    }
  });

  it('contains a required key getter failure within the HTTP error boundary', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, {});
    await registerPii(t.env, testActors.admin, created.id, pii);
    const { secretStore: _store, ...bindings } = t.env;
    const env = Object.defineProperty({
      ...bindings, LOCAL_ACTOR_HEADER_MODE: 'true', LOCAL_DEV_ACTOR_EMAIL: testActors.admin.userId,
    }, 'PII_ENC_KEY', {
      enumerable: true,
      get() { throw new Error('synthetic-sensitive-binding-error'); },
    });
    const response = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    Object.defineProperty(env, 'secretStore', { value: t.env.secretStore, enumerable: true });
    const injected = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), env);
    expect(injected.status).toBe(200);
    expect(await injected.text()).toContain(pii.name);
  });

  it('does not promote an inherited raw key into an own binding', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, {});
    await registerPii(t.env, testActors.admin, created.id, pii);
    const { secretStore, ...bindings } = t.env;
    const inherited = Object.assign(Object.create({ PII_ENC_KEY: await secretStore.get('PII_ENC_KEY') }), {
      ...bindings, LOCAL_ACTOR_HEADER_MODE: 'true', LOCAL_DEV_ACTOR_EMAIL: testActors.admin.userId,
    });
    const response = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), inherited);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
