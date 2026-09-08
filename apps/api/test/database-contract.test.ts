import type { Database } from '@ccc/contracts/database';
import { createD1Database } from '@ccc/db-d1';
import { setupD1 } from './support/d1';
import { defineDatabaseContract } from './support/database-contract';

const t = setupD1({ provisionDirectory: false });

async function openD1Database(): Promise<Database> {
  await t.reset();
  return createD1Database(t.db);
}

defineDatabaseContract('D1', openD1Database);
