/** 패키지 공용 런타임 type guard. 필드 검증은 호출자가 한다. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
