import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes, createHmac } from 'node:crypto';
import { createLocalSingleIdentity, generateStableUserId } from '../src/identity.ts';
import { hashPassword } from '../src/office-identity.ts';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';
import type { SingleInstallData } from '@ccc/secrets-dpapi';

// Focused state-machine regression, not Windows runtime evidence. The real startup scenario is separate.
test('Single lock revokes the old bearer and an unlock proof cannot be replayed', async () => {
  const verifier = await hashPassword(new TextEncoder().encode('Synthetic local passphrase'));
  const install: SingleInstallData = {
    schemaVersion: 1, installationId: 'synthetic-install', orgId: 'synthetic-org', sequence: 1,
    stableUserId: generateStableUserId(), passwordHash: verifier.hash, salt: verifier.salt, handshakeKey: new Uint8Array(randomBytes(32)),
  };
  const identity = createLocalSingleIdentity({ install, async resolveActor(sessionId) {
    return { kind: 'human', userId: install.stableUserId, orgId: install.orgId, roles: ['worker'], scopes: [],
      authn: { source: 'single-local-bearer', assurance: 'app-lock', sessionId } };
  } });
  try {
    await assert.rejects(identity.resolve(new Request('http://127.0.0.1/me')), ActorAuthenticationError);
    const challenge = identity.challenge();
    const proof = createHmac('sha256', install.handshakeKey).update(`${install.installationId}\0${challenge}`).digest('base64url');
    const login = await identity.unlock(challenge, proof, new TextEncoder().encode('Synthetic local passphrase'));
    const request = new Request('http://127.0.0.1/me', { headers: { authorization: `Bearer ${login.bearer}` } });
    assert.equal((await identity.resolve(request)).userId, install.stableUserId);
    await assert.rejects(identity.unlock(challenge, proof, new TextEncoder().encode('Synthetic local passphrase')), ActorAuthenticationError);
    identity.lock();
    await assert.rejects(identity.resolve(request), ActorAuthenticationError);
  } finally { identity.close(); install.handshakeKey.fill(0); }
});
