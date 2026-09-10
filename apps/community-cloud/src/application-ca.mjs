import { Buffer } from 'node:buffer';
import { X509Certificate } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const MAX_CA_BYTES = 256 * 1024;
const CERTIFICATE_PEM = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu;

function unavailable() {
  throw new Error('installation_unavailable');
}

function readBoundedRegularFile(path) {
  let file;
  try {
    file = openSync(path, 'r');
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CA_BYTES) unavailable();

    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(file, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size) unavailable();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    if (file !== undefined) closeSync(file);
  }
}

export function assertApplicationCaBinding(env = globalThis.process?.env ?? {}) {
  const path = env.CCC_DATABASE_CA_FILE;
  if (path === undefined) return;
  if (path.trim().length === 0 || env.NODE_EXTRA_CA_CERTS !== path || env.DENO_CERT !== path) unavailable();

  try {
    const source = readBoundedRegularFile(path);
    const certificates = source.match(CERTIFICATE_PEM);
    if (certificates === null || source.replace(CERTIFICATE_PEM, '').trim().length !== 0) unavailable();
    for (const pem of certificates) {
      if (!new X509Certificate(pem).ca) unavailable();
    }
  } catch {
    unavailable();
  }
}
