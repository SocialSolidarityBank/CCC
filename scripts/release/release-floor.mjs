import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
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
import { setTimeout as delay } from 'node:timers/promises';

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
const LOCK_ATTEMPTS = 500;
const PRODUCTION_FLOOR_PATH = process.platform === 'win32'
  ? 'C:\\ProgramData\\CCC\\update\\release-floor.json'
  : process.platform === 'darwin'
    ? '/Library/Application Support/CCC/update/release-floor.json'
    : '/var/lib/ccc/update/release-floor.json';
const WINDOWS_ACL_SCRIPT = String.raw`
$Action = $env:CCC_RELEASE_ACL_ACTION
$Target = $env:CCC_RELEASE_ACL_TARGET
$Kind = $env:CCC_RELEASE_ACL_KIND
$ErrorActionPreference = 'Stop'
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Action -eq 'establish') {
  $acl = Get-Acl -LiteralPath $Target
  $acl.SetOwner($current)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }
  $inheritance = if ($Kind -eq 'directory') {
    [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $current,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Target -AclObject $acl
}
$actual = Get-Acl -LiteralPath $Target
try { $owner = ([System.Security.Principal.SecurityIdentifier]$actual.Owner).Value }
catch {
  $owner = ([System.Security.Principal.NTAccount]$actual.Owner).Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
}
$rules = @($actual.Access)
if (-not $actual.AreAccessRulesProtected -or $owner -ne $current.Value -or $rules.Count -ne 1) { exit 7 }
$identity = $rules[0].IdentityReference.Translate(
  [System.Security.Principal.SecurityIdentifier]
).Value
if ($identity -ne $current.Value -or $rules[0].AccessControlType -ne 'Allow' -or
    $rules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
    $rules[0].IsInherited) { exit 7 }
`;
const WINDOWS_ACL_COMMAND = Buffer.from(WINDOWS_ACL_SCRIPT, 'utf16le').toString('base64');

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

function runWindowsAcl(action, path, kind) {
  const result = spawnSync(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    WINDOWS_ACL_COMMAND,
  ], {
    env: {
      SystemRoot: String.raw`C:\Windows`,
      WINDIR: String.raw`C:\Windows`,
      CCC_RELEASE_ACL_ACTION: action,
      CCC_RELEASE_ACL_TARGET: path,
      CCC_RELEASE_ACL_KIND: kind,
    },
    stdio: 'ignore',
    timeout: 10_000,
    windowsHide: true,
  });
  return result.status === 0 && result.error === undefined;
}

const productionWindowsAcl = Object.freeze({
  establish: (path, kind) => runWindowsAcl('establish', path, kind),
  verify: (path, kind) => runWindowsAcl('verify', path, kind),
});

function securityOptions({ platform = process.platform, windowsAcl = productionWindowsAcl } = {}) {
  return { platform, windowsAcl };
}

async function requireProtected(path, kind, security, { establish = false } = {}) {
  if (security.platform === 'win32') {
    if ((establish && !await security.windowsAcl.establish(path, kind))
      || !await security.windowsAcl.verify(path, kind)) fail('RELEASE_FLOOR_PERMISSIONS_INVALID');
    return;
  }
  const info = await lstat(path);
  const uid = currentUid();
  const expectedMode = kind === 'directory' ? 0o700 : 0o600;
  if (uid === null || info.uid !== uid || (info.mode & 0o777) !== expectedMode) {
    fail('RELEASE_FLOOR_PERMISSIONS_INVALID');
  }
}

async function ensureSafeDirectory(directory, security) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== resolve(directory)) fail();
  await requireProtected(directory, 'directory', security, { establish: security.platform === 'win32' });
}

async function requireSafeFile(path, info, security, { establish = false } = {}) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail();
  await requireProtected(path, 'file', security, { establish });
}

async function readState(path, security) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail();
  }
  try {
    await ensureSafeDirectory(dirname(path), security);
    await requireSafeFile(path, info, security);
  } catch (error) {
    if (security.platform === 'win32' && error instanceof ReleaseFloorError) throw error;
    fail();
  }
  try {
    return validateState(await readStrictJsonDocument(path));
  } catch (error) {
    if (error instanceof ReleaseFloorError) throw error;
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

async function writeState(path, state, security) {
  const directory = dirname(path);
  await ensureSafeDirectory(directory, security);
  const tempPath = join(directory, `.release-floor.${randomUUID()}.tmp`);
  let handle;
  let installed = false;
  try {
    handle = await open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let tempInfo = await handle.stat();
    await requireSafeFile(tempPath, tempInfo, security, { establish: security.platform === 'win32' });
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    tempInfo = await handle.stat();
    await requireSafeFile(tempPath, tempInfo, security);
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
    installed = true;
    await requireSafeFile(path, await lstat(path), security);
    if (security.platform !== 'win32') {
      const directoryHandle = await open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (!installed) await unlink(tempPath).catch(() => {});
    if (error instanceof ReleaseFloorError) throw error;
    fail();
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function acquireLock(path, security, onLockBusy) {
  const directory = dirname(path);
  await ensureSafeDirectory(directory, security);
  const lockPath = `${path}.lock`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    let handle;
    let created = false;
    try {
      handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
      let info = await handle.stat();
      await requireSafeFile(lockPath, info, security, { establish: security.platform === 'win32' });
      await handle.chmod(0o600);
      await handle.sync();
      info = await handle.stat();
      await requireSafeFile(lockPath, info, security);
      return { handle, info, lockPath };
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => {});
      if (created) await unlink(lockPath).catch(() => fail('RELEASE_FLOOR_LOCK_UNAVAILABLE'));
      if (error?.code !== 'EEXIST') {
        if (error instanceof ReleaseFloorError) throw error;
        fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
      }
      let info;
      try {
        if (onLockBusy !== undefined) await onLockBusy(lockPath);
        info = await lstat(lockPath);
        await requireSafeFile(lockPath, info, security);
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') continue;
        if (lockError instanceof ReleaseFloorError) throw lockError;
        fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
      }
      await delay(10);
    }
  }
  fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
}

async function releaseLock(lock, security) {
  await lock.handle.close().catch(() => fail('RELEASE_FLOOR_LOCK_UNAVAILABLE'));
  let current;
  try {
    current = await lstat(lock.lockPath);
    await requireSafeFile(lock.lockPath, current, security);
  } catch {
    fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
  }
  if (!sameFile(current, lock.info)) fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
  try {
    await unlink(lock.lockPath);
  } catch {
    fail('RELEASE_FLOOR_LOCK_UNAVAILABLE');
  }
}

async function withLock(path, security, operation, onLockBusy) {
  const lock = await acquireLock(path, security, onLockBusy);
  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  await releaseLock(lock, security);
  if (operationError !== undefined) throw operationError;
  return result;
}

function floorStore(path, { beforeWrite, onLockBusy, ...securityInput } = {}) {
  const security = securityOptions(securityInput);
  return Object.freeze({
    path,
    read: () => readState(path, security),
    async updateVerified({ sequenceFloor, trustedTime }) {
      validateFloor(sequenceFloor, { requireFactory: true });
      if (!validInstant(trustedTime)) fail('RELEASE_FLOOR_INVALID');
      return await withLock(path, security, async () => {
        const existing = await readState(path, security);
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
        if (beforeWrite !== undefined) await beforeWrite(structuredClone(state));
        await writeState(path, state, security);
        return structuredClone(state);
      }, onLockBusy);
    },
  });
}

export function createReleaseFloorStore() {
  return floorStore(PRODUCTION_FLOOR_PATH);
}

export function createReleaseFloorStoreForTest(directory, options) {
  if (typeof directory !== 'string' || !directory.startsWith(resolve(directory))) fail();
  return floorStore(join(realpathSync(directory), 'release-floor.json'), options);
}
