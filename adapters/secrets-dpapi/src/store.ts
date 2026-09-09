/// <reference lib="es2024.arraybuffer" />
import type { RecoverySecretStore, VersionedSecretBytes } from '@ccc/contracts/runtime';

type Name = Parameters<RecoverySecretStore['getBytesWithVersion']>[0];
/** In-memory record contract only; persistence/activation belongs to the S9 generation writer. */
export interface DpapiRecord { schemaVersion: 1; name: Name; version: number; blob: Uint8Array }
export interface NativeDpapi {
  protectData(data: Uint8Array, entropy: Uint8Array | null, scope: 'CurrentUser'): Uint8Array;
  unprotectData(data: Uint8Array, entropy: Uint8Array | null, scope: 'CurrentUser'): Uint8Array;
}
const names = new Set<Name>(['DB_MASTER_KEY', 'FILE_ENC_KEY', 'PII_ENC_KEY', 'OFFICE_CA_KEY']);
function validName(name: Name) { if (!names.has(name)) throw new Error('secret_invalid'); }
function validBytes(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype
    || !(bytes.buffer instanceof ArrayBuffer) || bytes.buffer.resizable || bytes.byteLength === 0) throw new Error('secret_invalid');
}
function validVersion(version: number) { if (!Number.isSafeInteger(version) || version < 1) throw new Error('secret_invalid'); }
function material(name: Name, value: VersionedSecretBytes) {
  validBytes(value.bytes); validVersion(value.version);
  if (name !== 'OFFICE_CA_KEY' && value.bytes.length !== 32) throw new Error('secret_invalid');
}
function entropy(name: Name, version: number) { return new TextEncoder().encode(`CCC-DPAPI\0v1\0${name}\0${version}`); }

/** Internal seam for synthetic tests. Production gets the verified binding only via index.ts. */
export function byteStore(native: NativeDpapi, mode: 'local-single' | 'local-office', records: readonly DpapiRecord[]) {
  if (mode !== 'local-single' && mode !== 'local-office') throw new Error('secret_invalid');
  const owned = new Map<Name, DpapiRecord>();
  try {
    for (const record of records) {
      validName(record.name); validVersion(record.version); validBytes(record.blob);
      if (record.schemaVersion !== 1 || owned.has(record.name) || (mode === 'local-single' && record.name === 'OFFICE_CA_KEY')
        || Object.keys(record).sort().join(',') !== 'blob,name,schemaVersion,version') throw new Error('secret_invalid');
      owned.set(record.name, { ...record, blob: new Uint8Array(record.blob) });
    }
  } catch { for (const record of owned.values()) record.blob.fill(0); throw new Error('secret_invalid'); }
  let closed = false;
  return {
    async getBytesWithVersion(name: Name): Promise<VersionedSecretBytes | null> {
      validName(name);
      if (closed) throw new Error('secret_access_denied');
      const record = owned.get(name); if (!record) return null;
      const binding = entropy(name, record.version); let output: Uint8Array | undefined; let bytes: Uint8Array | undefined;
      try {
        output = native.unprotectData(record.blob, binding, 'CurrentUser');
        bytes = new Uint8Array(output);
        material(name, { bytes, version: record.version });
        return { bytes, version: record.version };
      } catch { bytes?.fill(0); throw new Error('secret_access_denied'); }
      finally { output?.fill(0); binding.fill(0); }
    },
    /** Caller must authorize/audit before protect/read; this primitive does not authenticate actors. */
    protect(name: Name, value: VersionedSecretBytes): DpapiRecord {
      validName(name); material(name, value);
      if (closed || (mode === 'local-single' && name === 'OFFICE_CA_KEY')) throw new Error('secret_access_denied');
      const input = new Uint8Array(value.bytes); const binding = entropy(name, value.version); let output: Uint8Array | undefined;
      try {
        output = native.protectData(input, binding, 'CurrentUser');
        if (!(output instanceof Uint8Array) || output.length === 0) throw new Error();
        return { schemaVersion: 1, name, version: value.version, blob: new Uint8Array(output) };
      } catch { throw new Error('secret_access_denied'); }
      finally { input.fill(0); binding.fill(0); output?.fill(0); }
    },
    close() { closed = true; for (const record of owned.values()) record.blob.fill(0); owned.clear(); },
  };
}
