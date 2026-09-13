import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import { extract, list } from 'tar';

const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_TAR_BYTES = 256 * 1024 * 1024;
const REGULAR_TYPES = new Set(['File', 'OldFile']);

function failure() {
  return Object.assign(new Error('EDGE_COMPONENT_SET_MISMATCH'), {
    code: 'EDGE_COMPONENT_SET_MISMATCH',
  });
}

function normalizedPath(value) {
  if (typeof value !== 'string' || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 4096
    || /[\\\u0000-\u001f\u007f]/u.test(value)
    || isAbsolute(value)) throw failure();
  const parts = value.split('/');
  while (parts[0] === '.') parts.shift();
  while (parts.at(-1) === '') parts.pop();
  if (parts.length === 0) return '.';
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw failure();
  return parts.join('/');
}

function inspectEntry(entry, state) {
  state.count += 1;
  if (state.count > MAX_ENTRIES || !Number.isSafeInteger(entry.size)
    || entry.size < 0 || entry.size > MAX_ENTRY_BYTES) throw failure();
  state.bytes += entry.size;
  if (state.bytes > MAX_EXPANDED_BYTES) throw failure();
  if (entry.meta) return null;
  if (!REGULAR_TYPES.has(entry.type) && entry.type !== 'Directory') throw failure();
  if (entry.type === 'Directory' && entry.size !== 0) throw failure();
  const path = normalizedPath(entry.path);
  if (state.paths.has(path)) throw failure();
  state.paths.add(path);
  return Object.freeze({ path, type: entry.type, size: entry.size });
}

function inspectionState() {
  return { bytes: 0, count: 0, paths: new Set() };
}

async function streamArchive(archivePath, createParser, sourceFactory) {
  const source = sourceFactory(archivePath);
  const gunzip = createGunzip();
  let expandedBytes = 0;
  let prefix = Buffer.alloc(0);
  let parser;
  let limiter;
  let aborted = false;
  const abort = error => {
    if (aborted) return;
    aborted = true;
    source.destroy();
    gunzip.destroy();
    limiter?.destroy();
    parser?.abort(error);
  };
  limiter = new Transform({
    transform(chunk, _encoding, callback) {
      expandedBytes += chunk.byteLength;
      if (expandedBytes > MAX_TAR_BYTES) {
        abort(failure());
        callback();
        return;
      }
      if (prefix !== null) {
        prefix = Buffer.concat([prefix, chunk]);
        if (prefix.length < 4) {
          callback();
          return;
        }
        const nestedGzip = prefix[0] === 0x1f && prefix[1] === 0x8b;
        const nestedZstd = prefix[0] === 0x28 && prefix[1] === 0xb5
          && prefix[2] === 0x2f && prefix[3] === 0xfd;
        if (nestedGzip || nestedZstd) {
          abort(failure());
          callback();
          return;
        }
        const output = prefix;
        prefix = null;
        callback(null, output);
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (prefix !== null && prefix.length > 0) this.push(prefix);
      callback();
    },
  });
  parser = createParser(abort);
  try {
    await pipeline(source, gunzip, limiter, parser);
  } catch {
    abort(failure());
    throw failure();
  }
  if (aborted) throw failure();
}

export async function extractReleaseArchive(
  { archivePath, destination },
  { sourceFactory = path => createReadStream(path) } = {},
) {
  const entries = [];
  const preflight = inspectionState();
  let created = false;
  try {
    await streamArchive(archivePath, abort => list({
      gzip: false,
      brotli: false,
      strict: true,
      zstd: false,
      onReadEntry(entry) {
        try {
          const inspected = inspectEntry(entry, preflight);
          if (inspected !== null) entries.push(inspected);
        } catch (error) {
          abort(error);
        }
      },
    }), sourceFactory);
    if (entries.length === 0) throw failure();

    await mkdir(destination, { mode: 0o700 });
    created = true;
    let index = 0;
    const extraction = inspectionState();
    await streamArchive(archivePath, abort => extract({
      cwd: destination,
      gzip: false,
      brotli: false,
      strict: true,
      zstd: false,
      keep: true,
      preservePaths: false,
      noChmod: true,
      noMtime: true,
      umask: 0o077,
      dmode: 0o700,
      fmode: 0o600,
      filter(_path, entry) {
        try {
          const inspected = inspectEntry(entry, extraction);
          const expected = entries[index];
          if (inspected === null || expected === undefined
            || inspected.path !== expected.path || inspected.type !== expected.type
            || inspected.size !== expected.size) throw failure();
          index += 1;
          return true;
        } catch (error) {
          abort(error);
          return false;
        }
      },
    }), sourceFactory);
    if (index !== entries.length) throw failure();
  } catch {
    if (created) await rm(destination, { recursive: true, force: true });
    throw failure();
  }
}
