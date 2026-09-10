import { registerHooks } from 'node:module';
import { access, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repository TypeScript sources without changing package manifests or mocking a runtime port.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') || !specifier.startsWith('.')) throw error;
      for (const candidate of specifier.endsWith('.js') ? [specifier.slice(0, -3) + '.ts'] : [specifier + '.ts', specifier + '/index.ts']) {
        try { return nextResolve(candidate, context); } catch (next) { if (next.code !== 'ERR_MODULE_NOT_FOUND' && next.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw next; }
      }
      throw error;
    }
  },
});
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runId = randomUUID();
const report = { runId, startedAt: new Date().toISOString(), node: process.versions.node, platform: process.platform, verdict: 'FAIL', stages: [], proofSourceHashes: {} };
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = outputArgument ? resolve(outputArgument.slice(9)) : resolve(root, `artifacts/local-runtime-${runId}.json`);
async function hashTree(path) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await hashTree(child);
    else if (/\.(?:ts|mjs|sql|json)$/.test(entry.name)) report.proofSourceHashes[relative(root, child).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(child)).digest('hex');
  }
}
try {
  for (const path of ['apps/local-service', 'packages/core/src', 'packages/contracts/src', 'packages/http-api/src', 'packages/ai-runtime/src', 'adapters/db-sqlite/src', 'adapters/audio-file/src', 'adapters/secrets-dpapi/src', 'adapters/scheduler-node/src', 'migrations/sqlite']) await hashTree(resolve(root, path));
  // Old proof source is evidence, not an executable caller of this new scenario.
  const oldProof = resolve(root, 'artifacts/run-windows-proof.ps1');
  await access(oldProof);
  report.proofSourceHashes['artifacts/run-windows-proof.ps1'] = createHash('sha256').update(await readFile(oldProof)).digest('hex');
  const { startLocalSingle, startLocalOffice } = await import('../src/main.ts');
  if (process.platform !== 'win32') {
    for (const [mode, start] of [['local-single', startLocalSingle], ['local-office', startLocalOffice]]) {
      try { await start({}); throw new Error('unexpected_start'); }
      catch (error) { if (error.message !== 'platform_unsupported') throw error; }
      report.stages.push({ mode, stage: 'actual-startup-platform-guard', verdict: 'EXPECTED_DENIAL' });
    }
    report.verdict = 'WINDOWS_REQUIRED';
    process.exitCode = 2;
  } else {
    const { runRuntimeScenario } = await import('./runtime-scenario.mjs');
    await runRuntimeScenario(root, report);
    report.verdict = 'PASS';
  }
} catch {
  report.verdict = 'FAIL';
  report.error = 'runtime_scenario_failed';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ runId, verdict: report.verdict, output, stages: report.stages }));
}
