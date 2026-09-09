// RFC 8949 deterministic subset used by S9: no tags, floats, indefinite items or non-string map keys.
export type CborValue = null | boolean | number | string | Uint8Array | CborValue[] | { [key: string]: CborValue };
const MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function invalid(): never { throw new Error('recovery_kit_invalid'); }
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
function width(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value < 24 ? 1 : value <= 255 ? 2 : value <= 65535 ? 3 : value <= 0xffffffff ? 5 : 9;
}
function text(value: string): Uint8Array {
  if (/[\uD800-\uDFFF]/u.test(value)) invalid();
  return encoder.encode(value);
}
function entries(value: { [key: string]: CborValue }): [Uint8Array, CborValue][] {
  if (![null, Object.prototype].includes(Object.getPrototypeOf(value))) invalid();
  return Object.entries(value).map(([key, item]): [Uint8Array, CborValue] => [encodeCbor(key), item])
    .sort(([a], [b]) => compare(a, b));
}
export function encodeCbor(value: CborValue): Uint8Array {
  function size(item: CborValue, depth: number): number {
    if (depth > 32) invalid();
    if (item === null || typeof item === 'boolean') return 1;
    if (typeof item === 'number') return width(item);
    if (typeof item === 'string') { const bytes = text(item); return width(bytes.length) + bytes.length; }
    if (item instanceof Uint8Array) return width(item.length) + item.length;
    if (Array.isArray(item)) return width(item.length) + item.reduce<number>((n, child) => n + size(child, depth + 1), 0);
    if (typeof item !== 'object') invalid();
    return width(Object.keys(item).length) + entries(item).reduce((n, [key, child]) => n + key.length + size(child, depth + 1), 0);
  }
  const length = size(value, 0);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BYTES) invalid();
  const output = new Uint8Array(length); const view = new DataView(output.buffer); let offset = 0;
  function head(major: number, n: number) {
    const bytes = width(n);
    output[offset++] = (major << 5) | (bytes === 1 ? n : bytes === 2 ? 24 : bytes === 3 ? 25 : bytes === 5 ? 26 : 27);
    if (bytes === 2) output[offset++] = n;
    else if (bytes === 3) { view.setUint16(offset, n); offset += 2; }
    else if (bytes === 5) { view.setUint32(offset, n); offset += 4; }
    else if (bytes === 9) { view.setBigUint64(offset, BigInt(n)); offset += 8; }
  }
  function put(item: CborValue) {
    if (item === null) output[offset++] = 246;
    else if (typeof item === 'boolean') output[offset++] = item ? 245 : 244;
    else if (typeof item === 'number') head(0, item);
    else if (typeof item === 'string') { const bytes = text(item); head(3, bytes.length); output.set(bytes, offset); offset += bytes.length; }
    else if (item instanceof Uint8Array) { head(2, item.length); output.set(item, offset); offset += item.length; }
    else if (Array.isArray(item)) { head(4, item.length); for (const child of item) put(child); }
    else { const sorted = entries(item); head(5, sorted.length); for (const [key, child] of sorted) { output.set(key, offset); offset += key.length; put(child); } }
  }
  try { put(value); if (offset !== length) invalid(); return output; }
  catch { output.fill(0); invalid(); }
}
export function wipeCbor(value: CborValue): void {
  const seen = new WeakSet<object>();
  function wipe(item: CborValue): void {
    if (item instanceof Uint8Array) item.fill(0);
    else if (item !== null && typeof item === 'object' && !seen.has(item)) {
      seen.add(item);
      for (const child of Object.values(item)) wipe(child);
    }
  }
  wipe(value);
}
export function decodeCbor(input: Uint8Array): CborValue {
  if (input.length < 1 || input.length > MAX_BYTES) invalid();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const allocated: Uint8Array[] = []; let offset = 0;
  function take(n: number): Uint8Array {
    if (!Number.isSafeInteger(n) || n < 0 || n > input.length - offset) invalid();
    const value = input.subarray(offset, offset + n); offset += n; return value;
  }
  function get(depth: number): CborValue {
    if (depth > 32 || offset >= input.length) invalid();
    const initial = take(1)[0]!; const major = initial >> 5; const additional = initial & 31;
    if (major === 7) { if (initial === 244) return false; if (initial === 245) return true; if (initial === 246) return null; invalid(); }
    if (![0, 2, 3, 4, 5].includes(major) || additional > 27) invalid();
    let count = additional;
    if (additional >= 24) {
      const bytes = 2 ** (additional - 24); const start = offset; take(bytes);
      count = bytes === 1 ? view.getUint8(start) : bytes === 2 ? view.getUint16(start) : bytes === 4 ? view.getUint32(start) : Number(view.getBigUint64(start));
      if (width(count) !== bytes + 1) invalid();
    }
    if (major === 0) return count;
    if (major === 2) { const bytes = new Uint8Array(take(count)); allocated.push(bytes); return bytes; }
    if (major === 3) return decoder.decode(take(count));
    if (count > input.length - offset) invalid();
    if (major === 4) { const array: CborValue[] = []; for (let i = 0; i < count; i++) array.push(get(depth + 1)); return array; }
    const result: { [key: string]: CborValue } = Object.create(null); let previous: Uint8Array | undefined;
    for (let i = 0; i < count; i++) {
      const start = offset; const key = get(depth + 1); const encoded = input.subarray(start, offset);
      if (typeof key !== 'string' || previous && compare(previous, encoded) >= 0 || Object.hasOwn(result, key)) invalid();
      previous = encoded; result[key] = get(depth + 1);
    }
    return result;
  }
  try { const result = get(0); if (offset !== input.length) invalid(); return result; }
  catch { for (const bytes of allocated) bytes.fill(0); invalid(); }
}
