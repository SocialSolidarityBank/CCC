import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@ccc/contracts/database';
import { createD1Database } from '@ccc/db-d1';
import type { Env } from '@ccc/core/gateway';
import { setupD1 } from './support/d1';
import { defineDatabaseContract } from './support/database-contract';

const t = setupD1({ provisionDirectory: false });
const gatewayEnvWithPort: Pick<Env, 'DB'> = { DB: {} as Database };

async function openD1Database(): Promise<Database> {
  await t.reset();
  return createD1Database(t.db);
}

defineDatabaseContract('D1', openD1Database);

describe('D1 adapter boundary', () => {
  it('does not translate SQL', () => {
    const makePrepared = (sql: string) => ({
      bind: (..._values: unknown[]) => makePrepared(sql),
      first: async () => null,
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    });
    const prepare = vi.fn(makePrepared);
    const d1 = { prepare, batch: async () => [] } as unknown as D1Database;
    const db = createD1Database(d1);
    db.prepare('SELECT $1 AS value');
    expect(prepare).toHaveBeenCalledWith('SELECT $1 AS value');
  });

  it('keeps the gateway environment assignable from the public port', () => {
    expect(gatewayEnvWithPort.DB).toBeDefined();
  });
});
