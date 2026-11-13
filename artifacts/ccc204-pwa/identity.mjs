import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const request = JSON.parse(readFileSync('artifacts/orchestration/ccc204-pwa-acceptance-request.json', 'utf8'));
const pane = JSON.parse(run('herdr', ['pane', 'current', '--current'])).result.pane;
const info = JSON.parse(run('herdr', ['pane', 'process-info', '--current'])).result.process_info;
const actual = {
  observedAt: new Date().toISOString(),
  bashEnvironment: { HERDR_PANE_ID: process.env.HERDR_PANE_ID ?? null, WEZTERM_PANE: process.env.WEZTERM_PANE ?? null },
  cwd: process.cwd(), branch: run('git', ['branch', '--show-current']),
  head: run('git', ['rev-parse', 'HEAD']), paneId: pane.pane_id,
  session: pane.agent_session, agentStatus: pane.agent_status,
  foregroundCwd: pane.foreground_cwd, shellPid: info.shell_pid,
  foregroundProcessGroupId: info.foreground_process_group_id,
  processes: info.foreground_processes.map(p => ({ pid: p.pid, name: p.name, cwd: p.cwd })),
};
actual.sessionId = actual.session.value.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\.jsonl)?$/i)?.[1] ?? null;
actual.matches = {
  bashPane: actual.bashEnvironment.HERDR_PANE_ID === request.workerPane,
  livePane: actual.paneId === request.workerPane,
  session: actual.sessionId === request.workerSessionId,
  cwd: actual.cwd === request.cwd,
  branch: actual.branch === request.branch,
  ompProcess: actual.processes.some(p => p.name.includes('omp') && p.cwd === request.cwd),
};
writeFileSync(resolve('artifacts/ccc204-pwa/identity.json'), JSON.stringify(actual, null, 2) + '\n');
console.log(JSON.stringify(actual, null, 2));
if (!Object.values(actual.matches).every(Boolean)) process.exitCode = 1;
