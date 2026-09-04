/**
 * RFC 8785 JSON Canonicalization Scheme, 작은 부분집합.
 * 유한한 JSON primitive, 배열, plain object 만 다루고 JSON.stringify 가 조용히 바꿔 버리는
 * 값(NaN, 깨진 surrogate)은 거부한다. 영수증 hash 와 signed install manifest 가 같은 함수를 쓴다.
 */
export function canonicalizeJcs(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON number is invalid');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) throw new TypeError('canonical JSON string is invalid');
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new TypeError('canonical JSON string is invalid');
      }
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeJcs(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Object.keys().sort() 는 UTF-16 code unit 순이라 RFC 8785 §3.2.3 과 같다.
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${canonicalizeJcs(key)}:${canonicalizeJcs(record[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON value is invalid');
}
