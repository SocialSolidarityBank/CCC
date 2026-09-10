import type { ScheduledJobKind, ScheduledJobRunner, Scheduler } from '@ccc/contracts/runtime';

export interface NodeScheduler extends Scheduler {
  /** Stop future ticks and drain in-flight runner calls before service shutdown. */
  close(): Promise<void>;
}
export interface SchedulerFailure {
  kind: ScheduledJobKind;
  nowIso: string;
  code: 'scheduled_job_failed';
}
interface Registration {
  kind: ScheduledJobKind;
  expression: string;
  minutes: number[];
  hours: number[];
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | undefined;
}
function field(value: string, limit: number): number[] {
  if (/^\d{1,2}$/.test(value)) {
    const number = Number(value);
    if (number < limit) return [number];
  } else {
    const step = value === '*' ? 1 : /^\*\/[1-9]\d?$/.test(value) ? Number(value.slice(2)) : 0;
    if (step > 0 && step <= limit) return Array.from({ length: Math.ceil(limit / step) }, (_, index) => index * step);
  }
  throw new Error('unsupported_cron_expression');
}
function nextTick(entry: Registration, after: number): number {
  const date = new Date(after);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  for (const offset of [0, 86_400_000]) {
    for (const hour of entry.hours) {
      if (offset === 0 && hour < date.getUTCHours()) continue;
      for (const minute of entry.minutes) {
        const candidate = day + offset + hour * 3_600_000 + minute * 60_000;
        if (candidate > after) return candidate;
      }
    }
  }
  throw new Error('scheduler_clock_invalid');
}
/** UTC numeric/wildcard/step minute and hour fields; calendar fields must be '*'.
 * This covers existing 2m/5m/30m and daily cron registrations. Unsupported syntax fails closed.
 * A late tick runs once with the actual invocation clock; busy periods do not create a replay queue.
 * Startup reconciliation, persistence, retries and business policy remain the runner/assembly's responsibility.
 */
export function createNodeScheduler(runner: ScheduledJobRunner, onError: (failure: SchedulerFailure) => void): NodeScheduler {
  const registrations = new Map<ScheduledJobKind, Registration>();
  let closed = false;
  let reportingFailed = false;
  function stopTimers() { for (const entry of registrations.values()) clearTimeout(entry.timer); }
  function arm(entry: Registration, at = nextTick(entry, Date.now())) {
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (closed) return;
      if (Date.now() < at) { arm(entry, at); return; }
      let nowIso: string;
      entry.running = Promise.resolve().then(() => {
        nowIso = new Date(Date.now()).toISOString();
        return runner.run(entry.kind, nowIso);
      }).then(() => undefined, () => {
        onError({ kind: entry.kind, nowIso, code: 'scheduled_job_failed' });
      }).catch(() => {
        // A broken reporting callback is a service failure, never an unhandled raw error.
        reportingFailed = true; closed = true; stopTimers();
      }).finally(() => {
        entry.running = undefined;
        if (!closed) arm(entry);
      });
    }, Math.max(1, at - Date.now()));
  }
  return {
    async schedule(kind, cron) {
      if (closed) throw new Error('scheduler_closed');
      if (!['pipeline_watchdog', 'pii_retention', 'audio_expiry', 'counseling_memory'].includes(kind)) throw new Error('unsupported_scheduled_job');
      const parts = cron.trim().split(/\s+/);
      if (parts.length !== 5 || parts.slice(2).some(part => part !== '*')) throw new Error('unsupported_cron_expression');
      const minutes = field(parts[0]!, 60); const hours = field(parts[1]!, 24);
      const expression = parts.join(' ');
      const existing = registrations.get(kind);
      if (existing?.expression === expression) return;
      const entry = existing ?? { kind, expression, minutes, hours, timer: undefined, running: undefined };
      clearTimeout(entry.timer);
      entry.expression = expression; entry.minutes = minutes; entry.hours = hours;
      registrations.set(kind, entry);
      if (entry.running === undefined) arm(entry);
    },
    async close() {
      closed = true; stopTimers();
      await Promise.all([...registrations.values()].map(entry => entry.running));
      if (reportingFailed) throw new Error('scheduler_error_handler_failed');
    },
  };
}
