// 해시 라우팅용 next/navigation shim. useRouter().push 는 location.hash 를 바꾼다.
export function useRouter() {
  return {
    push: (href: string) => { location.hash = href.startsWith('#') ? href : `#${href}`; },
    back: () => history.back(),
    replace: (href: string) => { location.replace(`#${href}`); },
  };
}
export function usePathname() {
  return location.hash.replace(/^#/, '') || '/';
}
export function useSearchParams() {
  const q = (location.hash.split('?')[1] ?? '');
  return new URLSearchParams(q);
}
export function redirect(href: string): never {
  location.hash = href;
  throw new Error('redirect');
}
