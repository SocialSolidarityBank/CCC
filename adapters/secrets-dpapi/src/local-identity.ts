import { createHash } from 'node:crypto';
import { loadNative } from './native.mjs';
import { createPrivateFiles } from '#private-files';
import { decodeCbor, encodeCbor, wipeCbor, type CborValue } from '#recovery-cbor';
import type { SingleEndpointRecord } from '@ccc/contracts/install-manifest';
import { validateRecoveryPayload, type RecoveryPayload } from '#recovery-payload';

export interface SingleInstallData {
  schemaVersion: 1;
  installationId: string;
  orgId: string;
  sequence: number;
  stableUserId: string;
  passwordHash: string;
  salt: string;
  handshakeKey: Uint8Array;
}

function validate(value: unknown): asserts value is SingleInstallData {
  if (value === null || typeof value !== 'object') throw new Error('secret_access_denied');
  const item = value as SingleInstallData;
  if (Object.keys(item).sort().join(',') !== 'handshakeKey,installationId,orgId,passwordHash,salt,schemaVersion,sequence,stableUserId'
    || item.schemaVersion !== 1 || !Number.isSafeInteger(item.sequence) || item.sequence < 1
    || typeof item.installationId !== 'string' || item.installationId.length < 1
    || typeof item.orgId !== 'string' || item.orgId.length < 1
    || typeof item.stableUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.stableUserId)
    || typeof item.passwordHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(item.passwordHash)
    || typeof item.salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(item.salt)
    || !(item.handshakeKey instanceof Uint8Array) || item.handshakeKey.length !== 32) throw new Error('secret_access_denied');
}

/** Installer/recovery primitive. Caller authorizes staging; startup never generates replacement identity. */
export async function createLocalIdentityRepository(root: string) {
  const native = loadNative();
  const files = await createPrivateFiles(root);
  async function protect(name: string, value: CborValue, replace: boolean): Promise<string> {
    const plain = encodeCbor(value);
    const entropy = new TextEncoder().encode(`CCC-LOCAL-IDENTITY\0v1\0${name}`);
    let blob: Uint8Array | undefined;
    try {
      blob = native.protectData(plain, entropy, 'CurrentUser');
      await files.publish(name, blob, replace);
      return createHash('sha256').update(blob).digest('hex');
    } catch { throw new Error('secret_access_denied'); }
    finally { plain.fill(0); entropy.fill(0); blob?.fill(0); }
  }
  async function unprotect(name: string, expectedHash?: string): Promise<CborValue> {
    const entropy = new TextEncoder().encode(`CCC-LOCAL-IDENTITY\0v1\0${name}`);
    let blob: Uint8Array | undefined, plain: Uint8Array | undefined;
    try {
      blob = await files.read(name, 16_384);
      if (expectedHash !== undefined && createHash('sha256').update(blob).digest('hex') !== expectedHash) throw new Error();
      plain = native.unprotectData(blob, entropy, 'CurrentUser');
      return decodeCbor(plain);
    } catch { throw new Error('secret_access_denied'); }
    finally { entropy.fill(0); blob?.fill(0); plain?.fill(0); }
  }
  return {
    async stageSingle(generation: number, data: SingleInstallData): Promise<string> {
      validate(data);
      await files.ensureGeneration(generation);
      // Recovery passes the verified Kit's original stableUserId here, never a new UUID.
      return protect(`generation-${generation}/single.cbor`, data as unknown as CborValue, false);
    },
    /** Staging primitive for an authorized restore transaction after openRecoveryKit; not activation. */
    async stageRecoveredSingle(generation: number, target: Omit<SingleInstallData, 'stableUserId'>, openedKit: RecoveryPayload): Promise<string> {
      const payload = validateRecoveryPayload(openedKit);
      if (payload.mode !== 'local-single' || payload.sourceOrgId !== target.orgId || typeof payload.stableUserId !== 'string') {
        throw new Error('recovery_restore_blocked');
      }
      const data: SingleInstallData = { ...target, stableUserId: payload.stableUserId };
      validate(data);
      await files.ensureGeneration(generation);
      return protect(`generation-${generation}/single.cbor`, data as unknown as CborValue, false);
    },
    async stageOfficeTlsKey(privateKey: Uint8Array): Promise<void> {
      if (privateKey.length < 1 || privateKey.length > 12_000) throw new Error('secret_access_denied');
      await protect('office-tls-key.cbor', privateKey, false);
    },
    async readOfficeTlsKey(): Promise<Uint8Array> {
      const value = await unprotect('office-tls-key.cbor');
      if (!(value instanceof Uint8Array) || value.length < 1) { wipeCbor(value); throw new Error('secret_access_denied'); }
      return value;
    },
    async readSingle(generation: number, expectedHash: string): Promise<SingleInstallData> {
      if (!Number.isSafeInteger(generation) || generation < 1 || !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('secret_access_denied');
      const value = await unprotect(`generation-${generation}/single.cbor`, expectedHash);
      try { validate(value); return { ...value, handshakeKey: new Uint8Array(value.handshakeKey) }; }
      finally { wipeCbor(value); }
    },
    async writeEndpoint(record: SingleEndpointRecord): Promise<void> {
      if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !record.installationId) throw new Error('secret_access_denied');
      await protect('endpoint.cbor', { installationId: record.installationId, port: record.port }, true);
    },
    async readEndpoint(installationId: string): Promise<SingleEndpointRecord> {
      const value = await unprotect('endpoint.cbor');
      try {
        if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array
          || Object.keys(value).sort().join(',') !== 'installationId,port' || value.installationId !== installationId
          || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('secret_access_denied');
        return { installationId, port: value.port };
      } finally { wipeCbor(value); }
    },
  };
}
