import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const out = resolve('artifacts/ccc212-browser-auth');
const request = JSON.parse(readFileSync('artifacts/orchestration/ccc212-browser-auth-request.json', 'utf8'));
const run = (file, args, cwd = root) => execFileSync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');

mkdirSync(out, { recursive: true });
const pane = JSON.parse(run('herdr', ['pane', 'current', '--current'])).result.pane;
const info = JSON.parse(run('herdr', ['pane', 'process-info', '--current'])).result.process_info;
const sessionId = pane.agent_session.value.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\.jsonl)?$/i)?.[1] ?? null;
const branch = run('git', ['branch', '--show-current']).trim();
const identity = {
  observedAt: new Date().toISOString(), pane: pane.pane_id, sessionId, cwd: root,
  foregroundCwd: pane.foreground_cwd, branch,
  processes: info.foreground_processes.map(process => ({ pid: process.pid, name: process.name, cwd: process.cwd })),
  matches: pane.pane_id === request.workerPane && sessionId === request.workerSessionId && root === request.cwd && branch === request.branch,
};
if (!identity.matches) throw new Error('executor_identity_mismatch');
save('identity.json', identity);

const source = request.sourceWorktreeReadOnly;
const sourceHead = run('git', ['rev-parse', 'HEAD'], source).trim();
const sourceStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], source);
if (sourceHead !== request.sourceCommit || sourceStatus !== '') throw new Error('source_pin_mismatch');
const sourceFiles = run('git', ['ls-files', '-z'], source).split('\0').filter(Boolean);
const originalSourceHashes = Object.fromEntries(sourceFiles
  .filter(path => existsSync(join(source, path)) && lstatSync(join(source, path)).isFile())
  .map(path => [path, hash(join(source, path))]));

const own = path => path.startsWith('artifacts/ccc212-browser-auth/')
  || path === 'artifacts/orchestration/ccc212-browser-auth-result.json'
  || path === 'docs/superpowers/plans/2026-09-14-CCC-212-browser-api-auth-verification.md';
const dirty = run('git', ['diff', '--name-only', '-z']).split('\0');
const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
const preservedPaths = [...new Set([...dirty, ...untracked])]
  .filter(path => path && !own(path) && existsSync(join(root, path)) && lstatSync(join(root, path)).isFile());
save('preservation-before.json', {
  source, sourceHead, sourceStatus, originalSourceHashes,
  orchestratorHashes: Object.fromEntries(preservedPaths.map(path => [path, hash(join(root, path))])),
});

const runtime = mkdtempSync(join(out, '.runtime-'));
const snapshot = join(runtime, 'source');
for (const path of [snapshot, join(runtime, 'home'), join(runtime, 'tmp')]) mkdirSync(path, { recursive: true });
const paths = [
  'apps/client', 'apps/web', 'apps/api/test', 'apps/api/package.json', 'apps/api/vitest.config.ts',
  'apps/community-cloud', 'packages', 'adapters', 'migrations', 'patches', 'scripts', 'design',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json',
];
const archive = execFileSync('git', ['archive', '--format=tar', request.sourceCommit, ...paths], { cwd: source, maxBuffer: 128 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-', '-C', snapshot], { input: archive });
const pinned = run('git', ['ls-tree', '-r', '--name-only', '-z', request.sourceCommit, '--', ...paths], source).split('\0').filter(Boolean);
const snapshotHashes = Object.fromEntries(pinned
  .filter(path => lstatSync(join(snapshot, path)).isFile())
  .map(path => [path, hash(join(snapshot, path))]));
const linkProof = [];
for (const packageFile of pinned.filter(path => path === 'package.json' || path.endsWith('/package.json'))) {
  const moduleDir = join(dirname(packageFile), 'node_modules');
  const origin = join(source, moduleDir);
  if (!existsSync(origin)) continue;
  const entries = readdirSync(origin).filter(name => !name.startsWith('.')).flatMap(name =>
    name.startsWith('@') ? readdirSync(join(origin, name)).map(child => `${name}/${child}`) : [name]);
  for (const name of entries) {
    const original = realpathSync(join(origin, name));
    const workspace = original.startsWith(source + '/') && !original.includes('/node_modules/');
    const target = workspace ? join(snapshot, relative(source, original)) : original;
    if (!existsSync(target)) throw new Error('snapshot_dependency_missing');
    const link = join(snapshot, moduleDir, name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    linkProof.push({ from: relative(snapshot, link), target, workspace });
  }
}
save('source-pin.json', { sourceCommit: request.sourceCommit, snapshotHashes });
save('runtime-setup.json', { runtime, snapshot, linkProof, archiveFromCommit: true, privateMaterialWritten: false });
save('lsp-evidence.json', { attempted: true, available: false, diagnostic: 'No language server found for references on pinned source worktree; direct imports and source hash tracing used instead.' });
console.log(JSON.stringify({ identityMatches: true, sourceCommit: request.sourceCommit, pinnedFiles: pinned.length,
  originalSourceFiles: sourceFiles.length, preservedFiles: preservedPaths.length, workspaceLinks: linkProof.filter(link => link.workspace).length,
  runtime, snapshot }));
