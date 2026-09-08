import { afterAll, beforeAll, expect, it } from 'vitest';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';

let harness: PostgresHarness;
beforeAll(async () => { harness = await startPostgresHarness(); }, 240_000);
afterAll(async () => { await harness?.dispose(); });

function expectUnsupported(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ kind: 'unsupported' });
    return;
  }
  throw new Error('Expected a structured database rejection.');
}

it('keeps actor context immutable across scoped operations and transactions', async () => {
  const db = await harness.openDatabase(1);
  await db.prepare('CREATE TABLE scoped_run_fixture (org TEXT NOT NULL, actor TEXT NOT NULL)').run();
  const context = { orgId: 'org-a', actorId: 'actor-a' };
  const scoped = db.forActor(context);
  context.orgId = 'org-b';
  context.actorId = 'actor-b';

  const settingSql = "SELECT current_setting('app.org_id',true) AS org, current_setting('app.actor_id',true) AS actor";
  expect(await scoped.prepare(settingSql).first()).toEqual({ org: 'org-a', actor: 'actor-a' });
  expect(await scoped.prepare(settingSql).all()).toEqual({
    results: [{ org: 'org-a', actor: 'actor-a' }],
    success: true,
    meta: { changes: 0 },
  });
  await scoped.prepare(
    "INSERT INTO scoped_run_fixture (org, actor) SELECT current_setting('app.org_id',true), current_setting('app.actor_id',true)",
  ).run();
  expect(await db.prepare('SELECT org, actor FROM scoped_run_fixture').first()).toEqual({
    org: 'org-a',
    actor: 'actor-a',
  });
  expect(await scoped.batch([
    scoped.prepare(settingSql),
    scoped.prepare("SELECT current_setting('app.org_id',true) AS org"),
  ])).toMatchObject({
    0: { results: [{ org: 'org-a', actor: 'actor-a' }] },
    1: { results: [{ org: 'org-a' }] },
  });
  const unscopedSettingSql = "SELECT NULLIF(current_setting('app.org_id',true),'') AS org, NULLIF(current_setting('app.actor_id',true),'') AS actor";
  expect(await db.prepare(unscopedSettingSql).first()).toEqual({ org: null, actor: null });

  const other = db.forActor({ orgId: 'org-b', actorId: 'actor-b' });
  const [a, b] = await Promise.all([
    scoped.prepare("SELECT pg_sleep(0.05), current_setting('app.org_id',true) AS org").first('org'),
    other.prepare("SELECT pg_sleep(0.01), current_setting('app.org_id',true) AS org").first('org'),
  ]);
  expect(a).toBe('org-a');
  expect(b).toBe('org-b');
});

it('rolls back scoped batches and clears transaction-local context', async () => {
  const db = await harness.openDatabase(1);
  await db.prepare('CREATE TABLE scoped_rollback_fixture (id TEXT PRIMARY KEY)').run();
  const scoped = db.forActor({ orgId: 'org-a', actorId: 'actor-a' });
  await expect(scoped.batch([
    scoped.prepare('INSERT INTO scoped_rollback_fixture (id) VALUES (?)').bind('rolled-back'),
    scoped.prepare('INSERT INTO absent_scoped_rollback_fixture (id) VALUES (?)').bind('never'),
  ])).rejects.toMatchObject({ kind: 'syntax' });
  expect(await db.prepare('SELECT COUNT(*) AS count FROM scoped_rollback_fixture').first('count')).toBe(0);
  expect(await db.prepare(
    "SELECT NULLIF(current_setting('app.org_id',true),'') AS org, NULLIF(current_setting('app.actor_id',true),'') AS actor",
  ).first()).toEqual({ org: null, actor: null });
});

it('rejects malformed contexts and prepared statements from another owner', async () => {
  const db = await harness.openDatabase(1);
  expectUnsupported(() => db.forActor({ orgId: '', actorId: 'actor-a' }));
  expectUnsupported(() => db.forActor({ orgId: '   ', actorId: 'actor-a' }));
  expectUnsupported(() => db.forActor({ orgId: 'org-a', actorId: '' }));
  expectUnsupported(() => db.forActor(null as never));

  const first = db.forActor({ orgId: 'org-a', actorId: 'same' });
  const second = db.forActor({ orgId: 'org-a', actorId: 'same' });
  const childStatement = first.prepare('SELECT 1 AS value');
  const rootStatement = db.prepare('SELECT 2 AS value');
  await expect(second.batch([childStatement])).rejects.toMatchObject({ kind: 'unsupported' });
  await expect(db.batch([childStatement])).rejects.toMatchObject({ kind: 'unsupported' });
  await expect(first.batch([rootStatement])).rejects.toMatchObject({ kind: 'unsupported' });
});

it('invalidates scoped views when their root closes and close is idempotent', async () => {
  const db = await harness.openDatabase(1);
  const scoped = db.forActor({ orgId: 'org-a', actorId: 'actor-a' });
  const prepared = scoped.prepare("SELECT current_setting('app.org_id',true) AS org");
  await db.close();
  await expect(db.close()).resolves.toBeUndefined();
  await expect(prepared.first('org')).rejects.toMatchObject({ kind: 'unsupported' });
  await expect(scoped.batch([])).rejects.toMatchObject({ kind: 'unsupported' });
});

