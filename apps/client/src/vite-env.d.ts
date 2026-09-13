/// <reference types="vite/client" />

declare module 'virtual:ccc-shared.css';

interface ImportMetaEnv {
  readonly VITE_CCC_INSTALL_SIGNING_KEYS?: string;
}
