import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const out = resolve('artifacts/ccc212-browser-auth');
const before = JSON.parse(readFileSync(join(out, 'preservation-before.json'), 'utf8'));
const pin = JSON.parse(readFileSync(join(out, 'source-pin.json'), 'utf8'));
const run = (file, args, cwd = root) => execFileSync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');

const imports = new Map();
for (const name of ['fixture-imports.jsonl', 'browser-fixture-imports.jsonl']) {
  const path = join(out, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (imports.has(row.path) && imports.get(row.path) !== row.sha256) throw new Error('import_hash_changed');
    imports.set(row.path, row.sha256);
  }
}
const importRows = [...imports].map(([path, sha256]) => ({ path, sha256, matchesPin: pin.snapshotHashes[path] === sha256 }));
if (!importRows.every(row => row.matchesPin)) throw new Error('import_outside_pin');
save('fixture-imports.json', { count: importRows.length, allMatchPin: true, imports: importRows });

const source = before.source;
const sourceHead = run('git', ['rev-parse', 'HEAD'], source).trim();
const sourceStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], source);
const sourceMismatches = Object.entries(before.originalSourceHashes)
  .filter(([path, expected]) => !existsSync(join(source, path)) || hash(join(source, path)) !== expected)
  .map(([path]) => path);
const orchestratorMismatches = Object.entries(before.orchestratorHashes)
  .filter(([path, expected]) => !existsSync(join(root, path)) || !lstatSync(join(root, path)).isFile() || hash(join(root, path)) !== expected)
  .map(([path]) => path);
const priorEvidenceMismatches = orchestratorMismatches.filter(path => path.startsWith('artifacts/ccc204-pwa/')
  || path === 'artifacts/orchestration/ccc204-pwa-harness-result.json');
const controllerOwnedConcurrentChanges = orchestratorMismatches.filter(path =>
  path === 'docs/superpowers/plans/2026-09-13-relayer-two-pane-handoff.md');
const unexpectedOrchestratorMismatches = orchestratorMismatches.filter(path =>
  !controllerOwnedConcurrentChanges.includes(path));
save('preservation-after.json', {
  sourceHead, sourceStatus, sourceFilesVerified: Object.keys(before.originalSourceHashes).length,
  sourceMismatches, orchestratorFilesVerified: Object.keys(before.orchestratorHashes).length,
  orchestratorMismatches, controllerOwnedConcurrentChanges, unexpectedOrchestratorMismatches,
  priorCcc204EvidenceMismatches: priorEvidenceMismatches,
  noProductOrOtherLaneSourceChanged: sourceHead === before.sourceHead && sourceStatus === '' && sourceMismatches.length === 0,
  noUnexpectedPreexistingFileChanged: unexpectedOrchestratorMismatches.length === 0,
  noAcceptedCcc204EvidenceOverwritten: priorEvidenceMismatches.length === 0,
});
if (sourceHead !== before.sourceHead || sourceStatus !== '' || sourceMismatches.length > 0
  || unexpectedOrchestratorMismatches.length > 0) {
  throw new Error('preservation_mismatch');
}

const priorCleanup = existsSync(join(out, 'cleanup.json'))
  ? JSON.parse(readFileSync(join(out, 'cleanup.json'), 'utf8')) : { removedRuntimes: [] };
const currentRuntimes = readdirSync(out).filter(name => name.startsWith('.runtime-'));
for (const name of currentRuntimes) rmSync(join(out, name), { recursive: true, force: true });
const removedRuntimes = [...new Set([...priorCleanup.removedRuntimes, ...currentRuntimes])];
const runtimesRemaining = readdirSync(out).filter(name => name.startsWith('.runtime-'));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const ownedFiles = files(out).filter(path => !path.endsWith('evidence-hashes.json'));
const privatePatternHits = [];
for (const path of ownedFiles) {
  const bytes = readFileSync(path);
  if (bytes.includes(Buffer.from('-----BEGIN ' + 'PRIVATE KEY-----'))
    || /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(bytes.toString('utf8'))) {
    privatePatternHits.push(relative(root, path));
  }
}
save('cleanup.json', {
  ownedServices: [
    { name: 'ccc212-browser-fixture', finalExit: 0 },
    { name: 'ccc212-browser', finalExit: 143, reason: 'intentional stop after browser evidence' },
    { name: 'ccc212-static-release', finalExit: 143, reason: 'intentional stop after actual header evidence' },
  ],
  browserContext: JSON.parse(readFileSync(join(out, 'browser-cleanup.json'), 'utf8')),
  fixture: JSON.parse(readFileSync(join(out, 'browser-fixture-cleanup.json'), 'utf8')),
  removedRuntimes, runtimesRemaining,
  privatePatternHits,
  privateKeysTokensPasswordsPersisted: false,
  ownedJobs: 0,
  unownedProcessesStopped: false,
});
if (runtimesRemaining.length > 0 || privatePatternHits.length > 0) throw new Error('cleanup_incomplete');

const finalFiles = files(out).filter(path => !path.endsWith('evidence-hashes.json'));
save('evidence-hashes.json', {
  algorithm: 'sha256',
  files: Object.fromEntries(finalFiles.sort().map(path => [relative(root, path), hash(path)])),
});
console.log(JSON.stringify({ imports: importRows.length, sourceMismatches: sourceMismatches.length,
  orchestratorMismatches: orchestratorMismatches.length, removedRuntimes: removedRuntimes.length,
  runtimesRemaining: runtimesRemaining.length, privatePatternHits: privatePatternHits.length }));
