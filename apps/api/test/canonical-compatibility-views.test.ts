import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import { checkpointSources, proveCanonicalCompatibilityViews } from './support/migration-parity';

it('exposes canonical initial cases without losing historical identities or write guards', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-compat-views-'));
  const db = openEncryptedSqlite({ filename: join(directory, 'proof.db'), key: new Uint8Array(32).fill(37) });
  try {
    for (const checkpoint of checkpointSources()) db.applyMigrations(checkpoint.sqlite);
    await proveCanonicalCompatibilityViews(db);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
