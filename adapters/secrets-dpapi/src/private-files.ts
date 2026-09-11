import { constants } from 'node:fs';
import { lstat, mkdir, realpath, open, link, unlink, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadNative } from './native.mjs';

const LIMIT = 64 * 1024 * 1024 + 4121;
function denied(): never { throw new Error('secret_access_denied'); }
function code(error: unknown, value: string): boolean { return error !== null && typeof error === 'object' && 'code' in error && error.code === value; }
async function syncPosixDirectory(path: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
/** Internal storage for ciphertext/public metadata; never authorizes a recovery operation. */
export async function createPrivateFiles(rootPath: string) {
  const windows = process.platform === 'win32' ? loadNative() : null;
  async function checkDirectory(path: string): Promise<void> {
    if (windows) { windows.assertPrivateDirectory(path); return; }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) denied();
  }
  async function createDirectory(path: string): Promise<void> {
    if (windows) { windows.createPrivateDirectory(path); return; }
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (!code(error, 'EEXIST')) throw error; }
    await checkDirectory(path); await syncPosixDirectory(dirname(path));
  }
  let root: string;
  try { root = resolve(rootPath); await createDirectory(root); root = await realpath(root); await checkDirectory(root); }
  catch { return denied(); }
  function pathFor(name: string): string {
    if (!/^(?:generation-[1-9][0-9]*\/)?[a-z0-9][a-z0-9.-]*$/.test(name)) denied();
    return join(root, name);
  }
  async function readPath(path: string, limit: number): Promise<Uint8Array> {
    if (windows) windows.assertPrivateFile(path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Uint8Array | undefined;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > limit || !windows && (info.mode & 0o077) !== 0) denied();
      bytes = new Uint8Array(info.size); let offset = 0;
      while (offset < bytes.length) {
        const result = await file.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) denied(); offset += result.bytesRead;
      }
      if ((await file.stat()).size !== info.size) denied(); return bytes;
    } catch { bytes?.fill(0); return denied(); }
    finally { await file.close(); }
  }
  return {
    async ensureGeneration(generation: number): Promise<void> {
      try {
        if (!Number.isSafeInteger(generation) || generation < 1) denied();
        await checkDirectory(root); await createDirectory(join(root, `generation-${generation}`));
      } catch { denied(); }
    },
    async read(name: string, limit = LIMIT): Promise<Uint8Array> {
      try {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT) denied();
        const path = pathFor(name); await checkDirectory(root); await checkDirectory(dirname(path));
        return await readPath(path, limit);
      } catch { return denied(); }
    },
    async publish(name: string, bytes: Uint8Array, replace = false): Promise<void> {
      let temporary: string | undefined, verified: Uint8Array | undefined;
      try {
        if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > LIMIT) denied();
        const destination = pathFor(name), directory = dirname(destination);
        await checkDirectory(root); await checkDirectory(directory);
        temporary = join(directory, `.temporary-${randomUUID()}`);
        if (windows) windows.writePrivateTemporary(temporary, bytes);
        else {
          const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try {
            let offset = 0;
            while (offset < bytes.length) {
              const result = await file.write(bytes, offset, bytes.length - offset, offset);
              if (result.bytesWritten === 0) denied(); offset += result.bytesWritten;
            }
            await file.sync();
          } finally { await file.close(); }
        }
        verified = await readPath(temporary, LIMIT);
        if (verified.length !== bytes.length || !timingSafeEqual(verified, bytes)) denied();
        verified.fill(0); verified = undefined;
        if (windows) {
          if (windows.publishPrivateFile(temporary, destination, replace)) temporary = undefined;
        } else {
          if (replace) { await rename(temporary, destination); temporary = undefined; }
          else { try { await link(temporary, destination); } catch (error) { if (!code(error, 'EEXIST')) throw error; } }
        }
        if (temporary) { await unlink(temporary); temporary = undefined; }
        // Windows publication uses MoveFileExW(WRITE_THROUGH); POSIX flushes its namespace here.
        if (!windows) await syncPosixDirectory(directory);
        verified = await readPath(destination, LIMIT);
        if (verified.length !== bytes.length || !timingSafeEqual(verified, bytes)) denied();
      } catch { denied(); }
      finally {
        verified?.fill(0);
        if (temporary) { try { await unlink(temporary); } catch (error) { if (!code(error, 'ENOENT')) denied(); } }
      }
    },
  };
}
