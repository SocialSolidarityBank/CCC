import assert from 'node:assert/strict';
import { chmod, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createReleaseFloorStore,
  createReleaseFloorStoreForTest,
} from './release-floor.mjs';

const ARM_FLOOR = {
  family: 'community-cloud-cli',
  mode: 'community-cloud',
  platform: 'macos',
  arch: 'arm64',
  minimumSequence: '7',
};
const X64_FLOOR = { ...ARM_FLOOR, arch: 'x64', minimumSequence: '4' };

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ccc-release-floor-'));
  try {
    await run(createReleaseFloorStoreForTest(directory), directory);
  } finally {
    await chmod(join(directory, 'release-floor.json'), 0o600).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

test('rejects a signed floor lower than the embedded factory floor', async () => fixture(async store => {
  await rejectCode(store.updateVerified({
    sequenceFloor: [{ ...ARM_FLOOR, minimumSequence: '0' }],
    trustedTime: '2026-09-11T12:00:00.000Z',
  }), 'RELEASE_FLOOR_INVALID');
  assert.equal(await store.read(), null);
}));

test('keeps the maximum existing and signed floor for every tuple', async () => fixture(async store => {
  await store.updateVerified({
    sequenceFloor: [ARM_FLOOR, X64_FLOOR],
    trustedTime: '2026-09-11T12:00:00.000Z',
  });
  const state = await store.updateVerified({
    sequenceFloor: [
      { ...ARM_FLOOR, minimumSequence: '6' },
      { ...X64_FLOOR, minimumSequence: '9' },
    ],
    trustedTime: '2026-09-11T13:00:00.000Z',
  });
  assert.deepEqual(state.sequenceFloor, [ARM_FLOOR, { ...X64_FLOOR, minimumSequence: '9' }]);
  assert.equal(state.lastTrustedTime, '2026-09-11T13:00:00.000Z');
}));

test('writes an owner-only file by atomic replacement', async () => fixture(async (store, directory) => {
  await store.updateVerified({ sequenceFloor: [ARM_FLOOR], trustedTime: '2026-09-11T12:00:00.000Z' });
  const oldHandle = await open(store.path, 'r');
  const oldDocument = await oldHandle.readFile('utf8');
  await store.updateVerified({
    sequenceFloor: [{ ...ARM_FLOOR, minimumSequence: '8' }],
    trustedTime: '2026-09-11T13:00:00.000Z',
  });
  const currentDocument = await readFile(store.path, 'utf8');
  assert.notEqual(currentDocument, oldDocument);
  assert.equal((await oldHandle.stat()).ino === (await stat(store.path)).ino, false);
  assert.equal(await oldHandle.readFile('utf8'), '');
  await oldHandle.close();
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ['release-floor.json']);
}));

test('fails closed on corrupt or unreadable state instead of resetting it', async () => fixture(async store => {
  await writeFile(store.path, '{"schemaVersion":1,"schemaVersion":1}', { mode: 0o600 });
  await rejectCode(store.read(), 'RELEASE_FLOOR_STATE_INVALID');
  await writeFile(store.path, JSON.stringify({
    schemaVersion: 1,
    sequenceFloor: [ARM_FLOOR],
    lastTrustedTime: '2026-09-11T12:00:00.000Z',
  }), { mode: 0o600 });
  await chmod(store.path, 0o000);
  await rejectCode(store.read(), 'RELEASE_FLOOR_STATE_INVALID');
}));

test('production store path cannot be replaced by caller input', () => {
  const requested = join(tmpdir(), 'attacker-floor.json');
  const store = createReleaseFloorStore({ path: requested });
  assert.notEqual(store.path, requested);
  assert.match(store.path, /(?:CCC|ccc).*(?:update|release).*release-floor\.json/u);
});
