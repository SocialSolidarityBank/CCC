import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import { PlanFailure } from './plan.mjs';

const MAX_MANIFEST_BYTES = 1_048_576;

async function manifestInput(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  if (value.trimStart().startsWith('{')) {
    if (Buffer.byteLength(value, 'utf8') > MAX_MANIFEST_BYTES) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
    return JSON.parse(value);
  }
  // Explicit local file input only; never fetch a manifest URL or echo its path.
  const file = await open(value, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length === 0 || length > MAX_MANIFEST_BYTES) throw new PlanFailure('OWNER_EVIDENCE_MISSING');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally {
    await file.close();
  }
}

/**
 * S11 §2.1 requires private institutionId/expectedOwnerOrgId bindings. S2 §2.7's
 * exact public manifest has neither, and its verifier rejects extra fields.
 * Verify what S2 actually defines, then fail closed instead of inventing a private
 * envelope or treating the provider's observed owner as institution approval.
 * This function intentionally cannot authorize apply until that contract is resolved.
 */
export async function requireSignedOwnerPreflight({ installManifest, signingKeys, projectRef }) {
  let manifest;
  let publicKeys;
  try {
    manifest = await manifestInput(installManifest);
    publicKeys = JSON.parse(signingKeys);
    if (!publicKeys || typeof publicKeys !== 'object' || Array.isArray(publicKeys)
      || Object.values(publicKeys).some(value => typeof value !== 'string')) throw new Error();
  } catch {
    throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  }
  let verifier;
  try {
    // Optional built artifact: a static import would bypass sanitized startup failure
    // when Main has not built this source-only handoff. No remote module is loaded.
    const verifierUrl = new URL('../../apps/community-cloud/dist/install-manifest-verifier.js', import.meta.url);
    verifier = await import(verifierUrl.href);
  } catch {
    throw new PlanFailure('MANIFEST_VERIFIER_UNAVAILABLE');
  }
  try {
    const verified = await verifier.verifySignedInstallManifest(manifest, { publicKeys, now: new Date() });
    if (verified.mode !== 'community-cloud' || typeof projectRef !== 'string'
      || verified.supabaseProjectRef !== projectRef) throw new Error();
  } catch {
    throw new PlanFailure('OWNER_EVIDENCE_MISSING');
  }
  // No unsigned --owner flag, runtime-field extension, live-response inference,
  // credential access, SQL transaction, or Management API request may bypass this.
  throw new PlanFailure('OWNER_MANIFEST_CONTRACT_UNRESOLVED');
}
