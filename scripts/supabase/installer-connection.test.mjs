import assert from 'node:assert/strict';
import test from 'node:test';
import { Socket } from 'node:net';
import { withInstallerConnection } from './installer-connection.mjs';

test('installer connection rejects an alternate same-project database before opening it', async context => {
  context.mock.method(Socket.prototype, 'connect', () => {
    throw new Error('synthetic-network-forbidden');
  });
  const previous = process.env.CCC_INSTALL_DATABASE_URL;
  process.env.CCC_INSTALL_DATABASE_URL = 'postgresql://postgres:secret@db.fixture-ref.supabase.co/alternate';
  try {
    await assert.rejects(
      withInstallerConnection({ projectRef: 'fixture-ref' }, async () => assert.fail('connection opened')),
      error => error.code === 'CREDENTIAL_INSUFFICIENT',
    );
  } finally {
    if (previous === undefined) delete process.env.CCC_INSTALL_DATABASE_URL;
    else process.env.CCC_INSTALL_DATABASE_URL = previous;
  }
});
