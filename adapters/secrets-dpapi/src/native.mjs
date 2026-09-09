import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Never require @primno/dpapi: its selector can load an unpatched published prebuild. */
export function loadNative() {
  try {
    if (process.platform !== 'win32') throw new Error();
    const expectedBytes = readFileSync(new URL('../native-provenance.json', import.meta.url));
    const expected = JSON.parse(expectedBytes);
    const receipt = JSON.parse(readFileSync(new URL('../native-build/provenance.json', import.meta.url)));
    const binary = fileURLToPath(new URL('../native-build/source/build/Release/dpapi.node', import.meta.url));
    if (receipt.sourceProvenanceSha256 !== sha256(expectedBytes) || receipt.platform !== 'win32'
      || receipt.arch !== process.arch || receipt.node !== process.version
      || receipt.binarySha256 !== sha256(readFileSync(binary))) throw new Error();
    const binding = require(binary);
    if (binding.cccHardeningVersion !== expected.hardeningVersion
      || typeof binding.protectData !== 'function' || typeof binding.unprotectData !== 'function') throw new Error();
    if (expected.recordStorageVersion !== 1 || binding.cccRecordStorageVersion !== expected.recordStorageVersion
      || ['createPrivateDirectory', 'assertPrivateDirectory', 'assertPrivateFile', 'writePrivateTemporary', 'publishPrivateFile']
        .some(name => typeof binding[name] !== 'function')) throw new Error();
    return binding;
  } catch { throw new Error('secret_access_denied'); }
}
