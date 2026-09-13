import type { CborValue } from '#recovery-cbor';

export interface RecoveryBinding {
  schemaVersion: number;
  schemaDigest: Uint8Array;
  mode: 'community-cloud' | 'local-single' | 'local-office';
  kitId: string;
  s10PayloadSha256: Uint8Array;
  sourceInstallationId: string;
  sourceOrgId: string | null;
  createdAt: string;
}
export type RecoveryPayload = { [key: string]: CborValue };
function invalid(): never { throw new Error('recovery_kit_invalid'); }
function object(value: CborValue, keys: string[]): RecoveryPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid();
  return value;
}
function positive(value: CborValue): void { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(); }
function string(value: CborValue): asserts value is string { if (typeof value !== 'string' || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) invalid(); }
function bytes(value: CborValue, length?: number): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
    || !(value.buffer instanceof ArrayBuffer) || value.buffer.resizable || (length === undefined ? value.length === 0 : value.length !== length)) invalid();
}
function strings(value: CborValue): void {
  if (!Array.isArray(value)) invalid();
  for (const item of value) string(item);
  if (new Set(value).size !== value.length) invalid();
}
function hashes(value: CborValue): void { if (!Array.isArray(value)) invalid(); for (const item of value) bytes(item, 32); }
function instant(value: CborValue): void {
  string(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
function sameBytes(a: CborValue, b: Uint8Array): boolean { return a instanceof Uint8Array && a.length === b.length && a.every((byte, index) => byte === b[index]); }
/** Exact wire shape only. Full database/actor/CA trust verification belongs to the restore transaction. */
export function validateRecoveryPayload(value: CborValue, expected?: RecoveryBinding): RecoveryPayload {
  const payload = object(value, ['payloadVersion', 'schemaVersion', 'schemaDigest', 'mode', 'kitId', 's10PayloadSha256',
    'sourceInstallationId', 'sourceOrgId', 'createdAt', 'generation', 'previousKitHash', 'stableUserId',
    'dbMasterKey', 'fileMasterKey', 'piiEncKey', 'officeCaKey', 'identityContinuity']);
  if (payload.payloadVersion !== 1 || typeof payload.mode !== 'string' || !['community-cloud', 'local-single', 'local-office'].includes(payload.mode)) invalid();
  positive(payload.schemaVersion!); positive(payload.generation!);
  bytes(payload.schemaDigest!, 32); bytes(payload.s10PayloadSha256!, 32);
  if (payload.previousKitHash !== null) bytes(payload.previousKitHash!, 32);
  string(payload.kitId!); string(payload.sourceInstallationId!); instant(payload.createdAt!);
  if (payload.sourceOrgId !== null) string(payload.sourceOrgId!);
  if (payload.mode !== 'local-single' && payload.sourceOrgId === null) invalid();
  if (payload.mode === 'local-single') string(payload.stableUserId!); else if (payload.stableUserId !== null) invalid();
  for (const name of ['dbMasterKey', 'fileMasterKey', 'piiEncKey']) {
    const key = object(payload[name]!, ['key', 'version']); bytes(key.key!, 32); positive(key.version!);
  }
  if (payload.officeCaKey !== null) {
    if (payload.mode !== 'local-office') invalid();
    const ca = object(payload.officeCaKey!, ['key', 'version', 'certificateDer', 'chainDer', 'fingerprintSha256', 'subject', 'serial', 'notBefore', 'notAfter', 'nameConstraints']);
    bytes(ca.key!); positive(ca.version!); bytes(ca.certificateDer!); bytes(ca.fingerprintSha256!, 32);
    if (!Array.isArray(ca.chainDer)) invalid(); for (const cert of ca.chainDer) bytes(cert);
    string(ca.subject!); string(ca.serial!); instant(ca.notBefore!); instant(ca.notAfter!); strings(ca.nameConstraints!);
    if (String(ca.notBefore) >= String(ca.notAfter)) invalid();
  }
  const identity = object(payload.identityContinuity!, ['mode', 'stableUserId', 'actors']);
  if (identity.mode !== payload.mode || identity.stableUserId !== payload.stableUserId || !Array.isArray(identity.actors)) invalid();
  if (payload.mode === 'local-single' && identity.actors.length !== 0) invalid();
  const ids = new Set<string>();
  for (const item of identity.actors) {
    const actor = object(item, ['actorId', 'kind', 'roleIds', 'assignmentIds', 'credentialRefHashes', 'mfa', 'active']);
    string(actor.actorId!);
    if (ids.has(actor.actorId!) || typeof actor.kind !== 'string' || !['human', 'agent', 'system'].includes(actor.kind) || typeof actor.active !== 'boolean') invalid();
    ids.add(actor.actorId!); strings(actor.roleIds!); strings(actor.assignmentIds!); hashes(actor.credentialRefHashes!);
    const mfa = object(actor.mfa!, ['required', 'enrolled', 'methodRefHashes']);
    if (typeof mfa.required !== 'boolean' || typeof mfa.enrolled !== 'boolean') invalid(); hashes(mfa.methodRefHashes!);
  }
  if (expected) {
    for (const name of ['schemaVersion', 'mode', 'kitId', 'sourceInstallationId', 'sourceOrgId', 'createdAt'] as const)
      if (payload[name] !== expected[name]) invalid();
    if (!sameBytes(payload.schemaDigest!, expected.schemaDigest) || !sameBytes(payload.s10PayloadSha256!, expected.s10PayloadSha256)) invalid();
  }
  return payload;
}
