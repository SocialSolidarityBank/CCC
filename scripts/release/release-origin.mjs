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

const TRUSTED_CLOCK = Symbol('trusted-clock');

export function createTrustedClock(authenticatedTime, {
  monotonicNow = () => process.hrtime.bigint(),
} = {}) {
  const base = authenticatedTime instanceof Date
    ? authenticatedTime.getTime() : Number.NaN;
  const started = monotonicNow();
  if (!Number.isFinite(base) || typeof started !== 'bigint') {
    fail('TRUSTED_TIME_UNAVAILABLE');
  }
  let previous = started;
  const clock = () => {
    const current = monotonicNow();
    if (typeof current !== 'bigint' || current < previous || current < started) {
      fail('TRUSTED_TIME_UNAVAILABLE');
    }
    previous = current;
    const elapsed = Number((current - started) / 1_000_000n);
    const value = base + elapsed;
    if (!Number.isSafeInteger(value)) fail('TRUSTED_TIME_UNAVAILABLE');
    return new Date(value);
  };
  Object.defineProperty(clock, TRUSTED_CLOCK, { value: true });
  return clock;
}

export function asTrustedClock(value) {
  if (value instanceof Date) return createTrustedClock(value);
  if (typeof value === 'function' && value[TRUSTED_CLOCK] === true) return value;
  fail('TRUSTED_TIME_UNAVAILABLE');
}

export function trustedTimeNow(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('TRUSTED_TIME_UNAVAILABLE');
  }
  return value;
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

export async function fetchPinnedRelease({
  fetchImpl,
  floorStore,
  now,
  verifyBundle,
  monotonicNow,
}) {
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
  const trustedTime = createTrustedClock(new Date(serverTime), { monotonicNow });

  let document;
  try {
    document = await responseDocument(response);
  } catch (error) {
    if (error instanceof ReleaseOriginError) throw error;
    fail('TRUSTED_TIME_UNAVAILABLE');
  }
  let bundle;
  try {
    bundle = await verifyBundle(document, trustedTimeNow(trustedTime));
  } catch (error) {
    if (error?.code === 'BUNDLE_LIFETIME_INVALID') fail('TRUSTED_TIME_UNAVAILABLE');
    throw error;
  }
  const publishedAt = instant(bundle?.publishedAt);
  const expiresAt = instant(bundle?.expiresAt);
  const currentTime = trustedTimeNow(trustedTime);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(expiresAt)
    || publishedAt > currentTime.getTime() || currentTime.getTime() >= expiresAt) {
    fail('TRUSTED_TIME_UNAVAILABLE');
  }

  const existing = await floorStore.read();
  const previousTime = instant(existing?.lastTrustedTime);
  if (existing !== null && (!Number.isFinite(previousTime)
    || currentTime.getTime() < previousTime || now.getTime() < previousTime)) {
    fail('TRUSTED_TIME_ROLLBACK');
  }

  const persistedTime = trustedTimeNow(trustedTime).toISOString();
  const state = await floorStore.updateVerified({
    sequenceFloor: bundle.sequenceFloor,
    trustedTime: persistedTime,
  });
  return {
    bundle,
    trustedTime,
    floor: state.sequenceFloor,
  };
}
