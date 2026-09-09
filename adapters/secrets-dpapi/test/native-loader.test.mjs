import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

test('loader rejects absent receipt, altered binary and unpatched marker before exposing native methods', async () => {
  // Synthetic module loading only, not Windows or DPAPI execution.
  const root = await mkdtemp(join(tmpdir(), 'ccc-dpapi-loader-'));
  const require = createRequire(import.meta.url);
  const extension = require.extensions['.node'];
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let loads = 0;
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'native-build/source/build/Release'), { recursive: true });
    await copyFile(new URL('../src/native.mjs', import.meta.url), join(root, 'src/native.mjs'));
    const expected = JSON.stringify({ hardeningVersion: 1 });
    await writeFile(join(root, 'native-provenance.json'), expected);
    const binary = join(root, 'native-build/source/build/Release/dpapi.node');
    await writeFile(binary, 'synthetic-unpatched-binary');
    const { loadNative, sha256 } = await import(pathToFileURL(join(root, 'src/native.mjs')).href);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    require.extensions['.node'] = module => { loads++; module.exports = { cccHardeningVersion: 0, protectData() {}, unprotectData() {} }; };
    assert.throws(loadNative, /^Error: secret_access_denied$/); assert.equal(loads, 0);
    const receipt = { sourceProvenanceSha256: sha256(expected), platform: 'win32', arch: process.arch, node: process.version, binarySha256: sha256('different-bytes') };
    await writeFile(join(root, 'native-build/provenance.json'), JSON.stringify(receipt));
    assert.throws(loadNative, /^Error: secret_access_denied$/); assert.equal(loads, 0);
    receipt.binarySha256 = sha256('synthetic-unpatched-binary');
    await writeFile(join(root, 'native-build/provenance.json'), JSON.stringify(receipt));
    assert.throws(loadNative, /^Error: secret_access_denied$/); assert.equal(loads, 1);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    require.extensions['.node'] = extension;
    await rm(root, { recursive: true, force: true });
  }
});
