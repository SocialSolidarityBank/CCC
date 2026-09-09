import type { NativeDpapi } from './store.ts';
export function loadNative(): NativeDpapi;
export const packageRoot: string;
export function sha256(bytes: Uint8Array | string): string;
