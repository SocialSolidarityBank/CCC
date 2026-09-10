import { createHash } from 'node:crypto';
import { createPrivateFiles } from '#private-files';
import { copyDpapiRecords, type DpapiRecord } from '#dpapi-store';
import { decodeCbor, encodeCbor, wipeCbor, type CborValue } from '#recovery-cbor';

const LIMIT = 64 * 1024 * 1024;
function denied(): never { throw new Error('secret_access_denied'); }
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
/** Staged ciphertext only. No key generation, authentication, decryption or active pointer mutation. */
export async function createProtectedRecordRepository(rootPath: string, mode: 'local-single' | 'local-office') {
  if (mode !== 'local-single' && mode !== 'local-office') denied();
  const files = await createPrivateFiles(rootPath);
  function path(generation: number): string {
    if (!Number.isSafeInteger(generation) || generation < 1) denied();
    return `generation-${generation}/keys.cbor`;
  }
  function decodedRecords(bytes: Uint8Array): DpapiRecord[] {
    const decoded = decodeCbor(bytes);
    try {
      if (!Array.isArray(decoded) || decoded.length > 4) denied();
      // copyDpapiRecords validates every exact record field, name, version and byte type.
      const records = Array.from(copyDpapiRecords(mode, decoded as unknown as DpapiRecord[]).values());
      for (let i = 1; i < records.length; i++) {
        if (records[i - 1]!.name >= records[i]!.name) { for (const record of records) record.blob.fill(0); denied(); }
      }
      return records;
    } finally { wipeCbor(decoded); }
  }
  return {
    async read(generation: number, expectedSha256: string): Promise<DpapiRecord[]> {
      let bytes: Uint8Array | undefined;
      try {
        if (!/^[0-9a-f]{64}$/.test(expectedSha256)) denied();
        bytes = await files.read(path(generation), LIMIT);
        if (hash(bytes) !== expectedSha256) denied();
        return decodedRecords(bytes);
      } catch { denied(); }
      finally { bytes?.fill(0); }
    },
    async stage(generation: number, input: readonly DpapiRecord[]): Promise<string> {
      let encoded: Uint8Array | undefined; let verified: Uint8Array | undefined;
      let owned: Map<string, DpapiRecord> | undefined;
      try {
        owned = copyDpapiRecords(mode, input);
        const records = Array.from(owned.values()).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        encoded = encodeCbor(records as unknown as CborValue);
        const digest = hash(encoded);
        await files.ensureGeneration(generation);
        await files.publish(path(generation), encoded);
        verified = await files.read(path(generation), LIMIT);
        if (hash(verified) !== digest) denied();
        const reopened = decodedRecords(verified); for (const record of reopened) record.blob.fill(0);
        return digest;
      } catch { denied(); }
      finally {
        encoded?.fill(0); verified?.fill(0);
        if (owned) for (const record of owned.values()) record.blob.fill(0);
      }
    },
  };
}
