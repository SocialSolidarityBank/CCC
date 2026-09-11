import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createNodeScheduler } from '../src/index.ts';
import type { ScheduledJobRunner } from '@ccc/contracts/runtime';

const report: ScheduledJobRunner['run'] = async (kind, nowIso) => ({ kind, nowIso, completedAt: new Date().toISOString(), counters: {} });
test('UTC minute boundaries and daily retention receive invocation instants rather than completion time', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-09-09T02:59:59.999Z') });
  const ticks: string[] = [];
  const scheduler = createNodeScheduler({ async run(kind, nowIso) { ticks.push(`${kind}:${nowIso}`); return report(kind, nowIso); } }, () => assert.fail('unexpected runner failure'));
  try {
    await scheduler.schedule('audio_expiry', '*/5 * * * *');
    await scheduler.schedule('pii_retention', '0 3 * * *');
    assert.deepEqual(ticks, []);
    t.mock.timers.tick(1); await setImmediate();
    assert.deepEqual(ticks.sort(), ['audio_expiry:2026-09-09T03:00:00.000Z', 'pii_retention:2026-09-09T03:00:00.000Z']);
    t.mock.timers.tick(300_000); await setImmediate();
    assert.equal(ticks.at(-1), 'audio_expiry:2026-09-09T03:05:00.000Z');
  } finally { await scheduler.close(); }
});
test('rescheduling preserves one active invocation and close drains it without future work', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-09-09T00:00:00.000Z') });
  const gate = Promise.withResolvers<void>(); let runs = 0;
  const scheduler = createNodeScheduler({ async run(kind, nowIso) { runs += 1; await gate.promise; return report(kind, nowIso); } }, () => assert.fail());
  await scheduler.schedule('audio_expiry', '*/5 * * * *');
  await scheduler.schedule('audio_expiry', '*/2 * * * *');
  t.mock.timers.tick(120_000); await setImmediate(); assert.equal(runs, 1);
  await scheduler.schedule('audio_expiry', '* * * * *');
  t.mock.timers.tick(600_000); await setImmediate(); assert.equal(runs, 1);
  let closed = false; const closing = scheduler.close().then(() => { closed = true; });
  await setImmediate(); assert.equal(closed, false);
  gate.resolve(); await closing;
  t.mock.timers.tick(600_000); await setImmediate(); assert.equal(runs, 1);
  await assert.rejects(scheduler.schedule('audio_expiry', '* * * * *'));
});
test('runner rejection is safely reported and does not disable the next scheduled invocation', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-09-09T00:00:00.000Z') });
  const failures: unknown[] = []; let runs = 0;
  const scheduler = createNodeScheduler({ async run(kind, nowIso) { if (++runs === 1) throw new Error('sensitive provider detail'); return report(kind, nowIso); } }, failure => failures.push(failure));
  try {
    await scheduler.schedule('counseling_memory', '*/2 * * * *');
    t.mock.timers.tick(120_000); await setImmediate();
    assert.deepEqual(failures, [{ kind: 'counseling_memory', nowIso: '2026-09-09T00:02:00.000Z', code: 'scheduled_job_failed' }]);
    t.mock.timers.tick(120_000); await setImmediate(); assert.equal(runs, 2);
  } finally { await scheduler.close(); }
});
test('unsupported syntax fails before scheduling and late wake uses actual time without replaying a backlog', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-09-09T00:00:00.000Z') });
  const ticks: string[] = [];
  const scheduler = createNodeScheduler({ async run(kind, nowIso) { ticks.push(nowIso); return report(kind, nowIso); } }, () => assert.fail());
  try {
    for (const cron of ['0 0 1 * *', '*/0 * * * *', '60 * * * *', '* 24 * * *', '@daily', '* * * * * *']) await assert.rejects(scheduler.schedule('audio_expiry', cron));
    await scheduler.schedule('pipeline_watchdog', '*/30 * * * *');
    t.mock.timers.setTime(new Date('2026-09-09T06:00:00.000Z').getTime());
    t.mock.timers.tick(1); await setImmediate();
    assert.deepEqual(ticks, ['2026-09-09T06:00:00.001Z']);
    t.mock.timers.tick(1); await setImmediate(); assert.equal(ticks.length, 1);
  } finally { await scheduler.close(); }
});
