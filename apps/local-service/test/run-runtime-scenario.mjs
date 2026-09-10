import './source-loader.mjs';
import { scenarioDiagnostics } from './scenario-diagnostics.mjs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runId = randomUUID();
const report = {
  runId, startedAt: new Date().toISOString(), node: process.versions.node, platform: process.platform,
  scope: 'synthetic-local-source-runtime-http-and-encrypted-persistence',
  notProven: ['full-S4-SG4', 'Windows-installer', 'dedicated-service-account-and-SCM', 'two-client-devices',
    'firewall-and-external-reachability', 'full-SG9-and-cross-SID-restore', 'S12-credential-reset-and-installer-bootstrap',
    'Authenticode-and-update-rollback', 'E8-8-load-gate'],
  verdict: 'FAIL', stages: [], proofSourceHashes: {},
};
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
let phase = 'source-hashes';
try {
  for (const path of ['apps/local-service', 'packages/core/src', 'packages/contracts/src', 'packages/http-api/src', 'packages/ai-runtime/src', 'adapters/db-sqlite/src', 'adapters/audio-file/src', 'adapters/secrets-dpapi/src', 'adapters/scheduler-node/src', 'migrations/sqlite', 'migrations/postgres']) await hashTree(resolve(root, path));
  phase = 'runtime-module-load';
  const { startLocalSingle, startLocalOffice } = await import('../src/main.ts');
  if (process.platform !== 'win32') {
    report.notProven.push('Windows-DPAPI-and-encrypted-runtime-HTTP');
    for (const [mode, start] of [['local-single', startLocalSingle], ['local-office', startLocalOffice]]) {
      try { await start({}); throw new Error('unexpected_start'); }
      catch (error) { if (error.message !== 'platform_unsupported') throw error; }
      report.stages.push({ mode, stage: 'actual-startup-platform-guard', verdict: 'EXPECTED_DENIAL' });
    }
    report.verdict = 'WINDOWS_REQUIRED';
    process.exitCode = 2;
  } else {
    phase = 'source-runtime-scenario';
    const { runRuntimeScenario } = await import('./runtime-scenario.mjs');
    await runRuntimeScenario(root, report);
    report.verdict = 'PASS';
  }
} catch (error) {
  report.verdict = 'FAIL';
  report.failedStage = report.stages.findLast((stage) => stage.verdict === 'FAIL')?.stage ?? phase;
  report.error = scenarioDiagnostics(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ runId, verdict: report.verdict, scope: report.scope, notProven: report.notProven,
    output, failedStage: report.failedStage, error: report.error, stages: report.stages }));
}
