import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { readStrictJsonDocument } from '../supabase/manifest-preflight.mjs';

const STATE_KEYS = ['lastTrustedTime', 'schemaVersion', 'sequenceFloor'].sort();
const FLOOR_KEYS = ['arch', 'family', 'minimumSequence', 'mode', 'platform'].sort();
const FAMILIES = new Set([
  'community-cloud-cli',
  'local-single',
  'local-office-server',
  'local-office-client',
  'processing-agent',
]);
const MODES = new Set(['community-cloud', 'local-single', 'local-office']);
const PLATFORMS = new Set(['macos', 'windows', 'ubuntu']);
const ARCHES = new Set(['arm64', 'x64']);
const UINT64_MAX = (1n << 64n) - 1n;
const FACTORY_MINIMUM_SEQUENCE = 1n;
const MAX_STRING_BYTES = 4_096;
const PRODUCTION_FLOOR_PATH = process.platform === 'win32'
  ? 'C:\\ProgramData\\CCC\\update\\release-floor.json'
  : process.platform === 'darwin'
    ? '/Library/Application Support/CCC/update/release-floor.json'
    : '/var/lib/ccc/update/release-floor.json';

export class ReleaseFloorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseFloorError';
    this.code = code;
  }
}

function fail(code = 'RELEASE_FLOOR_STATE_INVALID') {
  throw new ReleaseFloorError(code);
}

function exactKeys(value, keys) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === keys.join('\0');
}

function boundedString(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES;
}

function sequence(value) {
  if (!boundedString(value) || !/^(0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= UINT64_MAX ? parsed : null;
}

function tupleKey(record) {
  return `${record.family}\0${record.mode}\0${record.platform}\0${record.arch}`;
}

function validFloor(record, { requireFactory = false } = {}) {
  const minimum = exactKeys(record, FLOOR_KEYS) ? sequence(record.minimumSequence) : null;
  return minimum !== null
    && (!requireFactory || minimum >= FACTORY_MINIMUM_SEQUENCE)
    && FAMILIES.has(record.family)
    && MODES.has(record.mode)
    && PLATFORMS.has(record.platform)
    && ARCHES.has(record.arch);
}

function validateFloor(records, options) {
  if (!Array.isArray(records) || records.length === 0 || records.some(record => !validFloor(record, options))) {
    fail(options?.requireFactory ? 'RELEASE_FLOOR_INVALID' : 'RELEASE_FLOOR_STATE_INVALID');
  }
  const keys = records.map(tupleKey);
  if (new Set(keys).size !== keys.length) {
    fail(options?.requireFactory ? 'RELEASE_FLOOR_INVALID' : 'RELEASE_FLOOR_STATE_INVALID');
  }
}

function validInstant(value) {
  if (!boundedString(value) || value.length === 0) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validateState(value) {
  if (!exactKeys(value, STATE_KEYS) || value.schemaVersion !== 1 || !validInstant(value.lastTrustedTime)) fail();
  validateFloor(value.sequenceFloor, { requireFactory: true });
  return value;
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function ownedByService(info) {
  const uid = currentUid();
  return uid === null || info.uid === uid;
}

async function ensureSafeDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !ownedByService(info)
    || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    || await realpath(directory) !== resolve(directory)) fail();
}

async function readState(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail();
  }
  await ensureSafeDirectory(dirname(path));
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !ownedByService(info)
    || (process.platform !== 'win32' && (info.mode & 0o777) !== 0o600)) fail();
  try {
    return validateState(await readStrictJsonDocument(path));
  } catch {
    fail();
  }
}

function mergeFloors(existing, signed) {
  const merged = new Map((existing ?? []).map(record => [tupleKey(record), { ...record }]));
  for (const record of signed) {
    const key = tupleKey(record);
    const prior = merged.get(key);
    if (prior === undefined || BigInt(record.minimumSequence) > BigInt(prior.minimumSequence)) {
      merged.set(key, { ...record });
    }
  }
  return [...merged.values()].sort((left, right) => tupleKey(left).localeCompare(tupleKey(right), 'en'));
}

async function writeState(path, state) {
  const directory = dirname(path);
  await ensureSafeDirectory(directory);
  const tempPath = join(directory, `.release-floor.${randomUUID()}.tmp`);
  let handle;
  let installed = false;
  try {
    handle = await open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    const tempInfo = await handle.stat();
    if (!tempInfo.isFile() || tempInfo.nlink !== 1 || !ownedByService(tempInfo)
      || (process.platform !== 'win32' && (tempInfo.mode & 0o777) !== 0o600)) fail();
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
    installed = true;
    const resultInfo = await lstat(path);
    if (!resultInfo.isFile() || resultInfo.isSymbolicLink() || resultInfo.nlink !== 1
      || !ownedByService(resultInfo)
      || (process.platform !== 'win32' && (resultInfo.mode & 0o777) !== 0o600)) fail();
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (!installed) await unlink(tempPath).catch(() => {});
    if (error instanceof ReleaseFloorError) throw error;
    fail();
  }
}

function floorStore(path) {
  return Object.freeze({
    path,
    read: () => readState(path),
    async updateVerified({ sequenceFloor, trustedTime }) {
      validateFloor(sequenceFloor, { requireFactory: true });
      if (!validInstant(trustedTime)) fail('RELEASE_FLOOR_INVALID');
      const existing = await readState(path);
      if (existing !== null && Date.parse(trustedTime) < Date.parse(existing.lastTrustedTime)) {
        fail('TRUSTED_TIME_ROLLBACK');
      }
      const state = {
        schemaVersion: 1,
        sequenceFloor: mergeFloors(existing?.sequenceFloor, sequenceFloor),
        lastTrustedTime: existing === null || Date.parse(trustedTime) > Date.parse(existing.lastTrustedTime)
          ? trustedTime
          : existing.lastTrustedTime,
      };
      await writeState(path, state);
      return structuredClone(state);
    },
  });
}

export function createReleaseFloorStore() {
  return floorStore(PRODUCTION_FLOOR_PATH);
}

export function createReleaseFloorStoreForTest(directory) {
  if (typeof directory !== 'string' || !directory.startsWith(resolve(directory))) fail();
  return floorStore(join(realpathSync(directory), 'release-floor.json'));
}
