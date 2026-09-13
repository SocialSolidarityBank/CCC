import { loadNative } from './native.mjs';
import { byteStore, type DpapiRecord } from '#dpapi-store';
export type { DpapiRecord } from '#dpapi-store';

/** No fallback, ambient secrets, published prebuild loader, or caller-supplied native binding. */
export function createDpapiSecretStore(mode: 'local-single' | 'local-office', records: readonly DpapiRecord[]) {
  return byteStore(loadNative(), mode, records);
}
