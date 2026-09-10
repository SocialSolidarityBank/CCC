import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { stageNativeSource } from '../scripts/build-native.mjs';

const adapterRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = join(adapterRoot, 'node_modules/@primno/dpapi');
const vendorFiles = [
  'LICENSE',
  'binding.gyp',
  'src/dpapi_addon.h',
  'src/dpapi_win.cpp',
  'src/dpapi_not_supported.cpp',
  'src/main.cpp',
];

async function clonePinnedInputs() {
  const temp = await mkdtemp(join(tmpdir(), 'ccc-dpapi-preflight-'));
  const root = join(temp, 'adapters/secrets-dpapi');
  await mkdir(join(root, 'node_modules/@primno/dpapi/src'), { recursive: true });
  await mkdir(join(root, 'native'), { recursive: true });
  await mkdir(join(temp, 'patches'), { recursive: true });
  await copyFile(join(adapterRoot, 'native-provenance.json'), join(root, 'native-provenance.json'));
  await copyFile(join(adapterRoot, 'native/record_files.h'), join(root, 'native/record_files.h'));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(join(adapterRoot, 'scripts/build-native.mjs'), join(root, 'scripts/build-native.mjs'));
  await copyFile(join(vendorRoot, 'package.json'), join(root, 'node_modules/@primno/dpapi/package.json'));
  await copyFile(join(adapterRoot, '../../patches/@primno__dpapi@2.0.1.patch'), join(temp, 'patches/@primno__dpapi@2.0.1.patch'));
  for (const file of vendorFiles) await copyFile(join(vendorRoot, file), join(root, 'node_modules/@primno/dpapi', file));
  return { temp, root };
}

async function alter(root, relativePath) {
  const path = join(root, relativePath);
  await writeFile(path, `${await readFile(path, 'utf8')}\n`);
}

for (const [label, relativePath, stage] of [
  ['build script', 'scripts/build-native.mjs', 'provenance'],
  ['vendor source', 'node_modules/@primno/dpapi/src/main.cpp', 'vendor'],
  ['record storage header', 'native/record_files.h', 'records'],
  ['pinned patch', '../../patches/@primno__dpapi@2.0.1.patch', 'provenance'],
]) {
  test(`rejects altered ${label} before staging`, async () => {
    const { temp, root } = await clonePinnedInputs();
    const output = join(temp, 'native-build');
    try {
      const staged = await stageNativeSource({ root, output });
      const before = await readFile(join(staged.source, 'src/main.cpp'));
      await alter(root, relativePath);
      await assert.rejects(
        stageNativeSource({ root, output }),
        error => error?.stage === stage,
      );
      assert.deepEqual(await readFile(join(output, 'source/src/main.cpp')), before);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}
