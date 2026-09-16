const SAME_ORIGIN_BASE = 'https://ccc.invalid';

/** 앱 안의 경로만 돌려준다. URL 파서가 백슬래시·제어 문자를 정규화한 뒤 출처를 판정한다. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  try {
    const destination = new URL(value, SAME_ORIGIN_BASE);
    if (destination.origin !== SAME_ORIGIN_BASE) return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}
