import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../eval/run-memory-trial.ts', import.meta.url));
const caseId = '00000000-0000-4000-8000-000000000001';
describe('memory trial CLI terminal outcomes', () => {
  it.each([
    { command: 'check', status: 'blocked', exit: 1 },
    { command: 'step', status: 'blocked', exit: 1 },
    { command: 'step', status: 'backfill', exit: 3 },
  ])('returns $exit for $command with persisted $status work', async ({ command, status, exit }) => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ready: true, status, providerMode: 'fixture', draftMode: 'fixture',
        generation: 2, appliedGeneration: 1, revision: 1, backfillDone: true,
        dirtySources: 0, pendingMasks: 1, itemCount: 1, blockers: [],
        counters: { claimed: 0, updated: 0, failed: 0, superseded: 0 } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server address missing');
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-transform-types',
      entry, command, caseId, ...(command === 'step' ? ['--allow-external-ai'] : [])], {
      env: { ...process.env, CCC_MEMORY_API_ORIGIN: `http://127.0.0.1:${address.port}`,
        CCC_MEMORY_API_TOKEN: '', CCC_MEMORY_PREVIEW_CODE: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    try {
      const [code] = await once(child, 'close');
      expect(JSON.parse(stdout).status).toBe(status);
      expect(code).toBe(exit);
    } finally {
      child.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
