import { Buffer } from 'node:buffer';

export const PINNED_RELEASE_ORIGIN = 'https://ccc-releases.account-855.workers.dev';

const RELEASE_BUNDLE_URL = `${PINNED_RELEASE_ORIGIN}/.well-known/ccc/release-bundle.json`;
const MAX_DOCUMENT_BYTES = 1_048_576;

export class ReleaseOriginError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseOriginError';
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseOriginError(code);
}

function instant(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4_096) return Number.NaN;
  return Date.parse(value);
}

function httpDate(value) {
  const parsed = instant(value);
  return Number.isFinite(parsed) && new Date(parsed).toUTCString() === value ? parsed : Number.NaN;
}

async function responseDocument(response) {
  let document;
  if (typeof response.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) fail('BUNDLE_ENTRY_INVALID');
    try {
      document = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('BUNDLE_ENTRY_INVALID');
    }
  } else if (typeof response.text === 'function') {
    document = await response.text();
    if (typeof document !== 'string' || Buffer.byteLength(document, 'utf8') === 0
      || Buffer.byteLength(document, 'utf8') > MAX_DOCUMENT_BYTES) fail('BUNDLE_ENTRY_INVALID');
  } else {
    fail('BUNDLE_ENTRY_INVALID');
  }
  return document;
}

export async function fetchPinnedRelease({ fetchImpl, floorStore, now, verifyBundle }) {
  if (typeof fetchImpl !== 'function' || typeof verifyBundle !== 'function'
    || typeof floorStore?.read !== 'function' || typeof floorStore?.updateVerified !== 'function'
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) fail('RELEASE_ORIGIN_INVALID');

  let response;
  try {
    response = await fetchImpl(RELEASE_BUNDLE_URL, { method: 'GET', redirect: 'error' });
  } catch {
    fail('TRUSTED_TIME_UNAVAILABLE');
  }

  let responseUrl;
  try {
    responseUrl = new URL(response?.url);
  } catch {
    fail('RELEASE_ORIGIN_INVALID');
  }
  if (responseUrl.origin !== PINNED_RELEASE_ORIGIN || response?.ok !== true) fail('RELEASE_ORIGIN_INVALID');

  const dateHeader = response.headers?.get?.('date');
  const serverTime = httpDate(dateHeader);
  if (!Number.isFinite(serverTime)) fail('TRUSTED_TIME_UNAVAILABLE');

  let document;
  try {
    document = await responseDocument(response);
  } catch (error) {
    if (error instanceof ReleaseOriginError) throw error;
    fail('TRUSTED_TIME_UNAVAILABLE');
  }
  let bundle;
  try {
    bundle = await verifyBundle(document, new Date(serverTime));
  } catch (error) {
    if (error?.code === 'BUNDLE_LIFETIME_INVALID') fail('TRUSTED_TIME_UNAVAILABLE');
    throw error;
  }
  const publishedAt = instant(bundle?.publishedAt);
  const expiresAt = instant(bundle?.expiresAt);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(expiresAt)
    || publishedAt > serverTime || serverTime >= expiresAt) fail('TRUSTED_TIME_UNAVAILABLE');

  const existing = await floorStore.read();
  const previousTime = instant(existing?.lastTrustedTime);
  if (existing !== null && (!Number.isFinite(previousTime)
    || serverTime < previousTime || now.getTime() < previousTime)) fail('TRUSTED_TIME_ROLLBACK');

  const trustedTime = new Date(Math.max(publishedAt, serverTime)).toISOString();
  const state = await floorStore.updateVerified({
    sequenceFloor: bundle.sequenceFloor,
    trustedTime,
  });
  return {
    bundle,
    trustedTime: state.lastTrustedTime,
    floor: state.sequenceFloor,
  };
}
