import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { createCase, registerPii, revealPii } from '@ccc/core/gateway';
import worker from '../src/index';
import { setupD1, testActors, testProgramId, TEST_PII_KEY } from './support/d1';
import { registrationInput } from './support/registration';

const t = setupD1();
const pii = { name: 'SYNTHETIC_SECRETSTORE_PERSON' };

describe('SecretStore PII and Workers composition', () => {
  it('uses owned PII bytes without a string read and wipes them after imports and failures', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
    const issued: Uint8Array[] = [];
    let version = 7;
    const env = {
      ...t.env, PII_KEY_VERSION: '7',
      secretStore: {
        async get() { throw new Error('string key access forbidden'); },
        async getBytesWithVersion() {
          const bytes = new Uint8Array(32).fill(19); issued.push(bytes);
          return { bytes, version };
        },
      },
    };
    await registerPii(env, testActors.admin, created.id, pii);
    expect((await revealPii(env, testActors.admin, created.id)).name).toBe(pii.name);
    expect(issued.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    version = 8;
    await expect(registerPii(env, testActors.admin, created.id, { name: 'SHOULD_NOT_REPLACE' })).rejects.toThrow('secret_invalid');
    expect(issued.at(-1)).toEqual(new Uint8Array(32));
    version = 7;
    expect((await revealPii(env, testActors.admin, created.id)).name).toBe(pii.name);
  });
  it('decrypts stored PII through raw Worker bindings without exposing key material', async () => {
    await t.reset();
    const created = await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
    await registerPii(t.env, testActors.admin, created.id, pii);
    const { secretStore: _store, ...bindings } = t.env;
    const key = TEST_PII_KEY;
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
    const created = await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
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
    const created = await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
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
    const created = await createCase(t.env, testActors.counselor, await registrationInput(t.env, testActors.counselor, { programId: testProgramId(testActors.counselor.orgId) }));
    await registerPii(t.env, testActors.admin, created.id, pii);
    const { secretStore: _store, ...bindings } = t.env;
    const inherited = Object.assign(Object.create({ PII_ENC_KEY: TEST_PII_KEY }), {
      ...bindings, LOCAL_ACTOR_HEADER_MODE: 'true', LOCAL_DEV_ACTOR_EMAIL: testActors.admin.userId,
    });
    const response = await worker.fetch(new Request(`http://localhost/participants/${created.id}/hub`), inherited);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
