/** 비밀값이 아닌 배포 설정만 받는다. 경로와 인증 정보를 origin으로 숨겨 바꾸지 않는다. */
export function businessClientOrigin(value: string | undefined, publicOrigin: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.origin === publicOrigin
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}
