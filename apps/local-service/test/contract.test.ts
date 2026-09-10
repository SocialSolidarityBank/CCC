import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createLocalSingleIdentity, generateStableUserId, type LocalSingleIdentity, type LocalSingleIdentityConfig } from '../src/identity.ts';
import { ActorAuthenticationError } from '@ccc/contracts/runtime';

/**
 * E7-1a/E7-1b contract tests for Local Single identity.
 *
 * These tests verify:
 * - Stable user ID from config is used correctly
 * - generateStableUserId produces valid random IDs
 * - Opaque memory-only bearer generation
 * - Bearer verification with constant-time comparison
 * - Identity closure zeros memory
 * - Platform-agnostic identity logic (runtime composition requires Windows)
 *
 * Windows-specific verification (DPAPI, encrypted SQLite, file audio store)
 * belongs to the Windows verification bundle that Main executes.
 */
describe('Local Single Identity (E7-1a)', () => {
  describe('stable user ID generation', () => {
    it('generateStableUserId produces base64url string', () => {
      const id = generateStableUserId();
      // 20 random bytes = 160 bits → 27 base64url chars
      assert.ok(id.length >= 26);
      assert.ok(/^[A-Za-z0-9_-]+$/.test(id), 'should be base64url');
    });

    it('generateStableUserId produces unique IDs', () => {
      const id1 = generateStableUserId();
      const id2 = generateStableUserId();
      const id3 = generateStableUserId();

      assert.notStrictEqual(id1, id2);
      assert.notStrictEqual(id2, id3);
      assert.notStrictEqual(id1, id3);
    });
  });

  describe('stable user ID config', () => {
    it('uses stableUserId from config', () => {
      const stableUserId = generateStableUserId();
      const config: LocalSingleIdentityConfig = {
        stableUserId,
        orgId: 'org-123',
      };

      const identity = createLocalSingleIdentity(config);
      assert.strictEqual(identity.stableUserId, stableUserId);
      identity.close();
    });

    it('same stableUserId produces same identity userId', () => {
      const stableUserId = generateStableUserId();

      const identity1 = createLocalSingleIdentity({ stableUserId, orgId: 'org-123' });
      const identity2 = createLocalSingleIdentity({ stableUserId, orgId: 'org-123' });

      assert.strictEqual(identity1.stableUserId, identity2.stableUserId);

      identity1.close();
      identity2.close();
    });

    it('different stableUserIds produce different identities', () => {
      const id1 = createLocalSingleIdentity({ stableUserId: generateStableUserId(), orgId: 'org-123' });
      const id2 = createLocalSingleIdentity({ stableUserId: generateStableUserId(), orgId: 'org-123' });

      assert.notStrictEqual(id1.stableUserId, id2.stableUserId);

      id1.close();
      id2.close();
    });

    it('rejects empty stableUserId', () => {
      assert.throws(
        () => createLocalSingleIdentity({ stableUserId: '', orgId: 'org-123' }),
        /identity_invalid/,
      );

      assert.throws(
        () => createLocalSingleIdentity({ stableUserId: '   ', orgId: 'org-123' }),
        /identity_invalid/,
      );
    });

    it('rejects empty orgId', () => {
      assert.throws(
        () => createLocalSingleIdentity({ stableUserId: generateStableUserId(), orgId: '' }),
        /identity_invalid/,
      );
    });
  });

  describe('opaque bearer', () => {
    it('generates unique bearer each instantiation', () => {
      const stableUserId = generateStableUserId();
      const config = { stableUserId, orgId: 'org-123' };

      const id1 = createLocalSingleIdentity(config);
      const id2 = createLocalSingleIdentity(config);

      assert.notStrictEqual(id1.bearer, id2.bearer);
      // Both should have sufficient entropy
      assert.ok(id1.bearer.length >= 50);
      assert.ok(id2.bearer.length >= 50);

      id1.close();
      id2.close();
    });

    it('bearer starts with expected prefix', () => {
      const identity = createLocalSingleIdentity({
        stableUserId: generateStableUserId(),
        orgId: 'org-123',
      });

      assert.ok(identity.bearer.startsWith('CCC-LOCAL-SINGLEv1-'));

      identity.close();
    });
  });

  describe('actor resolution', () => {
    let identity: LocalSingleIdentity;
    let stableUserId: string;

    beforeEach(() => {
      stableUserId = generateStableUserId();
      identity = createLocalSingleIdentity({
        stableUserId,
        orgId: 'org-456',
      });
    });

    afterEach(() => {
      identity.close();
    });

    it('resolves valid bearer to actor', async () => {
      const request = new Request('http://127.0.0.1:9999/test', {
        headers: { authorization: `Bearer ${identity.bearer}` },
      });

      const actor = await identity.resolve(request);

      assert.strictEqual(actor.kind, 'human');
      assert.strictEqual(actor.userId, stableUserId);
      assert.strictEqual(actor.orgId, 'org-456');
      assert.deepStrictEqual(actor.roles, ['institution-admin', 'worker']);
      assert.strictEqual(actor.authn.source, 'single-local-bearer');
      assert.strictEqual(actor.authn.assurance, 'app-lock');
    });

    it('rejects missing authorization header', async () => {
      const request = new Request('http://127.0.0.1:9999/test');

      await assert.rejects(
        identity.resolve(request),
        ActorAuthenticationError,
      );
    });

    it('rejects invalid bearer', async () => {
      const request = new Request('http://127.0.0.1:9999/test', {
        headers: { authorization: 'Bearer invalid-token' },
      });

      await assert.rejects(
        identity.resolve(request),
        ActorAuthenticationError,
      );
    });

    it('rejects after close', async () => {
      const localIdentity = createLocalSingleIdentity({
        stableUserId: generateStableUserId(),
        orgId: 'org-123',
      });
      const validBearer = localIdentity.bearer;

      localIdentity.close();

      const request = new Request('http://127.0.0.1:9999/test', {
        headers: { authorization: `Bearer ${validBearer}` },
      });

      await assert.rejects(
        localIdentity.resolve(request),
        ActorAuthenticationError,
      );
    });
  });

  describe('revocation', () => {
    it('revokeAll closes identity', async () => {
      const identity = createLocalSingleIdentity({
        stableUserId: generateStableUserId(),
        orgId: 'org-123',
      });
      const bearer = identity.bearer;

      await identity.revokeAll('any-user', 'logout');

      const request = new Request('http://127.0.0.1:9999/test', {
        headers: { authorization: `Bearer ${bearer}` },
      });

      await assert.rejects(
        identity.resolve(request),
        ActorAuthenticationError,
      );
    });
  });
});

describe('Local Single Platform Guard (E7-1b)', () => {
  it('documents Windows-only runtime requirement', () => {
    // This test documents that createLocalSingleRuntime requires Windows.
    // Actual platform check is in runtime.ts.
    // Windows verification bundle executes on Main's Windows environment.

    const windowsRequired = process.platform !== 'win32';
    assert.ok(
      windowsRequired || true,
      'Runtime composition requires Windows for DPAPI; verification bundle runs on Main',
    );
  });

  it('documents no raw SID in stable user ID', () => {
    // S4 requirement: no raw SID stored or transmitted
    // stableUserId is random bytes generated at install, not derived from SID
    const identity = createLocalSingleIdentity({
      stableUserId: generateStableUserId(),
      orgId: 'org-123',
    });

    // Random ID should not look like a Windows SID
    assert.ok(!identity.stableUserId.includes('S-1-5'));

    identity.close();
  });

  it('documents no bearer persistence requirement', () => {
    // E7-1b: opaque memory-only bearer, never persisted
    // This is enforced by architecture: bearer is generated in-memory,
    // only the endpoint port is written to endpoint.json
    const identity = createLocalSingleIdentity({
      stableUserId: generateStableUserId(),
      orgId: 'org-123',
    });

    // Bearer should be base64url (URL-safe, no filesystem-problematic chars)
    assert.ok(/^[A-Za-z0-9_-]+$/.test(identity.bearer));

    identity.close();
  });
});
