import type { NativeDpapi } from './store.ts';
interface NativeBinding extends NativeDpapi {
  createPrivateDirectory(path: string): void;
  assertPrivateDirectory(path: string): void;
  assertPrivateFile(path: string): void;
  writePrivateTemporary(path: string, bytes: Uint8Array): void;
  publishPrivateFile(source: string, target: string, replace: boolean): boolean;
}
export function loadNative(): NativeBinding;
export const packageRoot: string;
export function sha256(bytes: Uint8Array | string): string;
