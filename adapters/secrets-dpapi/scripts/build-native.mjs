import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { packageRoot, sha256, loadNative } from '../src/native.mjs';

const require = createRequire(import.meta.url);
const out = join(packageRoot, 'native-build');
const includeExpression = String.raw`<!(node -p "require(\'node-addon-api\').include_dir")`;
const STAGES = Object.freeze({
  platform: 'platform',
  provenance: 'provenance',
  vendor: 'vendor',
  records: 'records',
  dependencies: 'dependencies',
  staging: 'staging',
  transform: 'transform',
  configure: 'configure',
  compile: 'compile',
  receipt: 'receipt',
  runtime: 'runtime',
});

class BuildFailure extends Error {
  constructor(stage, exitCode = 'none', signal = 'none', compilerCodes = []) {
    super();
    this.stage = stage;
    this.exitCode = exitCode;
    this.signal = signal;
    this.compilerCodes = compilerCodes;
  }
}

function assertStage(condition, stage) {
  if (!condition) throw new BuildFailure(stage);
}

async function stageOperation(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BuildFailure) throw error;
    throw new BuildFailure(stage);
  }
}

export async function validateNativeInputs({ root = packageRoot, moduleRequire = require } = {}) {
  const provenanceBytes = await stageOperation(STAGES.provenance,
    () => readFile(join(root, 'native-provenance.json')));
  const expected = await stageOperation(STAGES.provenance, () => JSON.parse(provenanceBytes));
  const buildScript = await stageOperation(STAGES.provenance,
    () => readFile(join(root, 'scripts/build-native.mjs')));
  assertStage(typeof expected.buildScriptSha256 === 'string'
    && sha256(buildScript) === expected.buildScriptSha256, STAGES.provenance);
  const dep = join(root, 'node_modules/@primno/dpapi');
  const manifestBytes = await stageOperation(STAGES.vendor,
    () => readFile(join(dep, 'package.json'), 'utf8'));
  const manifest = await stageOperation(STAGES.vendor, () => JSON.parse(manifestBytes));
  assertStage(manifest.name === expected.package && manifest.version === expected.version
    && manifest.license === expected.license, STAGES.vendor);
  const patch = await stageOperation(STAGES.provenance,
    () => readFile(join(root, '../../patches/@primno__dpapi@2.0.1.patch')));
  assertStage(sha256(patch) === expected.patchSha256, STAGES.provenance);
  for (const [file, hash] of Object.entries(expected.sources)) {
    const source = await stageOperation(STAGES.vendor, () => readFile(join(dep, file)));
    assertStage(sha256(source) === hash, STAGES.vendor);
  }
  const recordsHeader = await stageOperation(STAGES.records,
    () => readFile(join(root, 'native/record_files.h')));
  assertStage(sha256(recordsHeader) === expected.recordStorageSourceSha256
    && expected.recordStorageVersion === 1, STAGES.records);
  for (const [name, version] of [['node-gyp', expected.nodeGyp], ['node-addon-api', expected.nodeAddonApi]]) {
    const actual = await stageOperation(STAGES.dependencies, () => moduleRequire(`${name}/package.json`).version);
    assertStage(actual === version, STAGES.dependencies);
  }
  return { provenanceBytes, expected, dep, recordsHeader };
}

export function transformMainSource(main) {
  assertStage(main.split('return exports;').length === 2, STAGES.transform);
  // uv.h must initialize Winsock2 before the records header reaches windows.h.
  assertStage(main.split('#include <uv.h>').length === 2, STAGES.transform);
  const withRecords = main.replace('#include <uv.h>', '#include <uv.h>\n#include "ccc_record_files.h"');
  return withRecords.replace('return exports;', 'ccc_records::Export(env, exports);\n\treturn exports;');
}

export async function stageNativeSource({ root = packageRoot, output = out, moduleRequire = require } = {}) {
  const validated = await validateNativeInputs({ root, moduleRequire });
  await stageOperation(STAGES.staging, () => rm(output, { recursive: true, force: true }));
  const source = join(output, 'source');
  await stageOperation(STAGES.staging, () => mkdir(join(source, 'src'), { recursive: true }));
  for (const file of Object.keys(validated.expected.sources)) {
    await stageOperation(STAGES.staging,
      () => copyFile(join(validated.dep, file), join(source, file)));
  }
  await stageOperation(STAGES.staging,
    () => writeFile(join(source, 'src/ccc_record_files.h'), validated.recordsHeader));
  const originalMain = await stageOperation(STAGES.staging,
    () => readFile(join(source, 'src/main.cpp'), 'utf8'));
  const main = transformMainSource(originalMain);
  await stageOperation(STAGES.staging, () => writeFile(join(source, 'src/main.cpp'), main));
  let gyp = await stageOperation(STAGES.configure,
    () => readFile(join(source, 'binding.gyp'), 'utf8'));
  const includePath = await stageOperation(STAGES.configure,
    () => moduleRequire.resolve('node-addon-api/package.json'));
  const include = includePath.replace(/[/\\]package\.json$/, '').replaceAll('\\', '/');
  assertStage(gyp.includes(includeExpression), STAGES.configure);
  gyp = gyp.replace(includeExpression, include.replaceAll("'", "\\'"));
  await stageOperation(STAGES.configure, () => writeFile(join(source, 'binding.gyp'), gyp));
  return { ...validated, source, main, gyp };
}

export async function buildNative() {
  let stage = STAGES.platform;
  try {
    if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new BuildFailure(stage);
    stage = STAGES.provenance;
    const staged = await stageNativeSource();
    stage = STAGES.compile;
    const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild',
      `--arch=${process.arch}`], {
      cwd: staged.source, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      const exitCode = Number.isInteger(result.status) && result.status >= -0x80000000 && result.status <= 0xffffffff
        ? result.status >>> 0 : 'none';
      const signal = typeof result.signal === 'string' && ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(result.signal)
        ? result.signal : 'none';
      const compilerCodes = [];
      for (const output of [result.stdout, result.stderr]) {
        for (const match of (output ?? '').matchAll(/\berror\s+((?:C|LNK|MSB)\d{4})\b/g)) {
          if (!compilerCodes.includes(match[1])) compilerCodes.push(match[1]);
          if (compilerCodes.length === 8) break;
        }
        if (compilerCodes.length === 8) break;
      }
      throw new BuildFailure(stage, exitCode, signal, compilerCodes);
    }
    stage = STAGES.receipt;
    const binary = join(staged.source, 'build/Release/dpapi.node');
    const receipt = {
      sourceProvenanceSha256: sha256(staged.provenanceBytes),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      nodeGyp: staged.expected.nodeGyp,
      nodeAddonApi: staged.expected.nodeAddonApi,
      configuredBindingSha256: sha256(staged.gyp),
      configuredMainSha256: sha256(staged.main),
      binarySha256: sha256(await readFile(binary)),
    };
    await writeFile(join(out, 'provenance.json'), JSON.stringify(receipt, null, 2) + '\n');
    stage = STAGES.runtime;
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
  } catch (error) {
    if (process.platform === 'win32') await rm(join(out, 'provenance.json'), { force: true }).catch(() => {});
    const failure = error instanceof BuildFailure ? error : new BuildFailure(stage);
    console.error(`build_stage=${failure.stage} exit_code=${failure.exitCode} signal=${failure.signal} compiler_codes=${failure.compilerCodes.join(',') || 'none'}`);
    console.error('secret_access_denied');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNative();
