import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const out = resolve('artifacts/ccc204-pwa/harness');
const request = JSON.parse(readFileSync('artifacts/orchestration/ccc204-pwa-harness-request.json', 'utf8'));
const run = (file, args, cwd = root) => execFileSync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
const pane = JSON.parse(run('herdr', ['pane', 'current', '--current'])).result.pane;
const info = JSON.parse(run('herdr', ['pane', 'process-info', '--current'])).result.process_info;
const sessionId = pane.agent_session.value.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\.jsonl)?$/i)?.[1];
const branch = run('git', ['branch', '--show-current']).trim();
const identity = { observedAt: new Date().toISOString(), pane: pane.pane_id, sessionId, cwd: root, foregroundCwd: pane.foreground_cwd, branch,
  processes: info.foreground_processes.map(p => ({ pid: p.pid, name: p.name, cwd: p.cwd })),
  matches: pane.pane_id === request.workerPane && sessionId === request.workerSessionId && root === request.cwd && branch === request.branch };
if (!identity.matches) throw Error('executor_identity_mismatch');
save('identity.json', identity);
save('understood-as.json', { assignmentId: request.assignmentId, understoodAs: 'Compose one disposable seeded-password issuer with real JWT verification, real seeded D1 directory and actual HTTP/gateway handlers, then observe the unchanged production client naturally registering its worker. Synthetic integration only; no production authentication claim.', authorizedWrites: request.ownedWrites, sourceCommit: request.sourceCommit });
const source = request.sourceWorktreeReadOnly;
const sourceFiles = run('git', ['ls-files', '-z'], source).split('\0').filter(Boolean);
const originalSourceHashes = Object.fromEntries(sourceFiles.filter(p => existsSync(join(source, p)) && lstatSync(join(source, p)).isFile()).map(p => [p, hash(join(source, p))]));
const sourceWip = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], source);
const own = p => p.startsWith('artifacts/ccc204-pwa/harness/') || p === 'artifacts/orchestration/ccc204-pwa-harness-result.json';
const dirty = run('git', ['diff', '--name-only', '-z']).split('\0');
const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
const preservedPaths = [...new Set([...dirty, ...untracked])].filter(p => p && !own(p) && existsSync(join(root, p)) && lstatSync(join(root, p)).isFile());
save('preservation-before.json', { source, originalSourceHashes, sourceWip, orchestratorHashes: Object.fromEntries(preservedPaths.map(p => [p, hash(join(root, p))])) });
const runtime = mkdtempSync(join(out, '.runtime-'));
const snapshot = join(runtime, 'source');
for (const p of [snapshot, join(runtime, 'home'), join(runtime, 'tmp')]) mkdirSync(p, { recursive: true });
const paths = ['apps/client', 'apps/web', 'apps/api/test', 'apps/api/package.json', 'apps/api/vitest.config.ts', 'packages', 'adapters', 'migrations', 'scripts', 'design', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json'];
const archive = execFileSync('git', ['archive', '--format=tar', request.sourceCommit, ...paths], { cwd: source, maxBuffer: 128 * 1024 * 1024 });
execFileSync('tar', ['-xf', '-', '-C', snapshot], { input: archive });
const pinned = run('git', ['ls-tree', '-r', '--name-only', '-z', request.sourceCommit, '--', ...paths], source).split('\0').filter(Boolean);
const snapshotHashes = Object.fromEntries(pinned.filter(p => lstatSync(join(snapshot, p)).isFile()).map(p => [p, hash(join(snapshot, p))]));
const linkProof = [];
for (const pkg of pinned.filter(p => p === 'package.json' || p.endsWith('/package.json'))) {
  const moduleDir = join(dirname(pkg), 'node_modules');
  const origin = join(source, moduleDir);
  if (!existsSync(origin)) continue;
  const entries = readdirSync(origin).filter(n => !n.startsWith('.')).flatMap(n => n.startsWith('@') ? readdirSync(join(origin, n)).map(c => `${n}/${c}`) : [n]);
  for (const name of entries) {
    const original = realpathSync(join(origin, name));
    const workspace = original.startsWith(source + '/') && !original.includes('/node_modules/');
    const target = workspace ? join(snapshot, relative(source, original)) : original;
    if (!existsSync(target)) throw Error('snapshot_dependency_missing');
    const link = join(snapshot, moduleDir, name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    linkProof.push({ from: relative(snapshot, link), target, workspace });
  }
}
save('source-pin.json', { sourceCommit: request.sourceCommit, snapshotHashes });
save('runtime-setup.json', { runtime, snapshot, linkProof, privateMaterialWritten: false, archiveFromCommit: true });
console.log(JSON.stringify({ identityMatches: true, sourceCommit: request.sourceCommit, pinnedFiles: pinned.length, originalSourceHashes: sourceFiles.length, preservedFiles: preservedPaths.length, workspaceLinks: linkProof.filter(p => p.workspace).length, runtime, snapshot }));
