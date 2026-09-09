/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** key ID -> base64 raw Ed25519 public key. 비밀 키를 넣지 않는다. */
  readonly VITE_CCC_INSTALL_SIGNING_KEYS?: string;
}

declare module 'virtual:ccc-shared-css' {
  /** 정본에서 조립해 온 색 토큰과 화면 CSS. vite.config.ts 의 ccc-shared-css 플러그인이 만든다. */
  const css: string;
  export default css;
}
