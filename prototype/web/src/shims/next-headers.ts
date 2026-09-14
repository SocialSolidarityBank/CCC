// 쿠키·헤더 shim — 프로토타입은 클라이언트 전용이라 빈 구현.
export function cookies() {
  return { get: () => undefined, set: () => {}, delete: () => {} };
}
export function headers() {
  return new Headers();
}
