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

test('installer pins the constructed client port despite inherited PGPORT', async context => {
  let attemptedPort;
  context.mock.method(Socket.prototype, 'connect', function (port) {
    attemptedPort = port;
    this.destroy(new Error('synthetic-network-forbidden'));
    return this;
  });
  const previousUrl = process.env.CCC_INSTALL_DATABASE_URL;
  const previousPort = process.env.PGPORT;
  process.env.CCC_INSTALL_DATABASE_URL = 'postgresql://postgres:synthetic@db.fixture-ref.supabase.co/postgres';
  process.env.PGPORT = '6543';
  try {
    await assert.rejects(
      withInstallerConnection({ projectRef: 'fixture-ref' }, async () => assert.fail('network boundary bypassed')),
      error => error.code === 'PROVIDER_UNREADABLE',
    );
    assert.equal(attemptedPort, 5432);
    assert.equal(process.env.PGPORT, '6543');
  } finally {
    if (previousUrl === undefined) delete process.env.CCC_INSTALL_DATABASE_URL;
    else process.env.CCC_INSTALL_DATABASE_URL = previousUrl;
    if (previousPort === undefined) delete process.env.PGPORT;
    else process.env.PGPORT = previousPort;
  }
});
