import {
  InstallManifestError,
  verifySignedInstallManifest as verifyContractManifest,
  type VerifyInstallManifestOptions,
} from '@ccc/contracts/install-manifest';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import type { SignedInstallManifest } from '@ccc/contracts/runtime';

const ED25519 = { name: 'Ed25519' } as const;
const encoder = new TextEncoder();

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function verifySignedInstallManifest(
  value: unknown,
  options: VerifyInstallManifestOptions,
): Promise<SignedInstallManifest> {
  const manifest = await verifyContractManifest(value, options);
  if (Date.parse(manifest.publishedAt) > options.now.getTime()) {
    throw new InstallManifestError('invalid_shape', 'publishedAt');
  }
  return manifest;
}

export async function verifyEd25519Bytes(
  message: Uint8Array<ArrayBuffer>,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    const signature = bytesFromBase64(signatureBase64);
    const publicKey = bytesFromBase64(publicKeyBase64);
    return signature.byteLength === 64 && publicKey.byteLength === 32 && await crypto.subtle.verify(
      ED25519,
      await crypto.subtle.importKey('raw', publicKey, ED25519, false, ['verify']),
      signature,
      message,
    );
  } catch {
    return false;
  }
}

export async function verifyJcsEd25519Signature(
  value: unknown,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    return await verifyEd25519Bytes(
      encoder.encode(canonicalizeJcs(value)),
      signatureBase64,
      publicKeyBase64,
    );
  } catch {
    return false;
  }
}

export async function sha256Jcs(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalizeJcs(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export { canonicalizeJcs, InstallManifestError };
