import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { packageRoot, sha256, loadNative } from '../src/native.mjs';

const require = createRequire(import.meta.url);
const out = join(packageRoot, 'native-build');
try {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new Error();
  const provenanceBytes = await readFile(join(packageRoot, 'native-provenance.json'));
  const expected = JSON.parse(provenanceBytes);
  const dep = join(packageRoot, 'node_modules/@primno/dpapi');
  const manifest = JSON.parse(await readFile(join(dep, 'package.json'), 'utf8'));
  if (manifest.name !== expected.package || manifest.version !== expected.version || manifest.license !== expected.license) throw new Error();
  if (sha256(await readFile(join(packageRoot, '../../patches/@primno__dpapi@2.0.1.patch'))) !== expected.patchSha256) throw new Error();
  for (const [file, hash] of Object.entries(expected.sources)) {
    if (sha256(await readFile(join(dep, file))) !== hash) throw new Error();
  }
  const recordsHeader = await readFile(join(packageRoot, 'native/record_files.h'));
  if (sha256(recordsHeader) !== expected.recordStorageSourceSha256 || expected.recordStorageVersion !== 1) throw new Error();
  for (const [name, version] of [['node-gyp', expected.nodeGyp], ['node-addon-api', expected.nodeAddonApi]]) {
    if (require(`${name}/package.json`).version !== version) throw new Error();
  }
  // Only this adapter's reproducible build output is removed. Published prebuilds are never copied.
  await rm(out, { recursive: true, force: true });
  const source = join(out, 'source');
  await mkdir(join(source, 'src'), { recursive: true });
  for (const file of Object.keys(expected.sources)) await copyFile(join(dep, file), join(source, file));
  await writeFile(join(source, 'src/ccc_record_files.h'), recordsHeader);
  let main = await readFile(join(source, 'src/main.cpp'), 'utf8');
  if (main.split('return exports;').length !== 2) throw new Error();
  main = '#include "ccc_record_files.h"\n' + main.replace('return exports;', 'ccc_records::Export(env, exports);\n\treturn exports;');
  await writeFile(join(source, 'src/main.cpp'), main);
  let gyp = await readFile(join(source, 'binding.gyp'), 'utf8');
  const include = require.resolve('node-addon-api/package.json').replace(/[/\\]package\.json$/, '').replaceAll('\\', '/');
  const includeExpression = String.raw`<!(node -p "require(\'node-addon-api\').include_dir")`;
  if (!gyp.includes(includeExpression)) throw new Error();
  gyp = gyp.replace(includeExpression, include.replaceAll("'", "\\'"));
  await writeFile(join(source, 'binding.gyp'), gyp);
  const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', `--arch=${process.arch}`], { cwd: source, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error();
  const receipt = { sourceProvenanceSha256: sha256(provenanceBytes), platform: process.platform, arch: process.arch, node: process.version, nodeGyp: expected.nodeGyp, nodeAddonApi: expected.nodeAddonApi, configuredBindingSha256: sha256(gyp), configuredMainSha256: sha256(main), binarySha256: sha256(await readFile(join(source, 'build/Release/dpapi.node'))) };
  await writeFile(join(out, 'provenance.json'), JSON.stringify(receipt, null, 2) + '\n');
  // Synthetic only: verifies the rebuilt path, byte subviews and native scope rejection.
  const native = loadNative();
  const input = new Uint8Array([0, 19, 31, 0]); let encrypted; let clear;
  try {
    encrypted = native.protectData(input.subarray(1, 3), null, 'CurrentUser');
    clear = native.unprotectData(encrypted, null, 'CurrentUser');
    if (clear.length !== 2 || clear[0] !== 19 || clear[1] !== 31) throw new Error();
    let refused = false;
    try { native.protectData(input, null, 'LocalMachine'); } catch { refused = true; }
    if (!refused) throw new Error();
  } finally { input.fill(0); encrypted?.fill(0); clear?.fill(0); }
  console.log(JSON.stringify({ status: 'synthetic-build-verified', ...receipt }));
} catch {
  if (process.platform === 'win32') await rm(join(out, 'provenance.json'), { force: true }).catch(() => {});
  console.error('secret_access_denied');
  process.exitCode = 1;
}
