# E1-4 Scheduler Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the watchdog and retention cron bodies from the Workers entry so that Workers cron and a Node fixture call one `ScheduledJobRunner.run(kind, nowIso): Promise<JobReport>`.

**Architecture:** `packages/contracts/src/runtime.ts` (created by E1-3) gains `ScheduledJobKind`, `JobReport`, `ScheduledJobRunner`, and `Scheduler`, matching plan line 84 and the runtime port block. `apps/api/src/scheduled-job-runner.ts` owns the job bodies (moved out of `index.ts`) and `createScheduledJobRunner(env)`; it moves to `packages/core/src/scheduled-job-runner.ts` in E1-5 with the other core modules. `index.ts` keeps only the cron expression to kind map and the `waitUntil` hand-off. Local Single/Office call the same runner in-process later (S2 §scheduler); this ticket adds no HTTP route and no `Scheduler.schedule` implementation.

**Base:** the branch is stacked on `e1-3-audio-store` (PR #262) because `runtime.ts` is born there. The PR targets that branch and retargets to `main` when #262 merges.

**Spec:** `CCC_OPEN_PILOT_PLAN.md` line 84, runtime port block (`ScheduledJobKind`, `Scheduler`), line 131 (`run(kind, nowIso): Promise<JobReport>`), E1-4 row, S2 `scheduled-job-runner` paragraph.

## Global Constraints

- `run(kind, nowIso)` is the only entry and returns `JobReport { kind, nowIso, completedAt, counters }`. `nowIso` is the cron tick instant (`controller.scheduledTime`); retention receives it as `at`, the watchdog does not take a clock parameter today and keeps its own.
- Unknown cron expressions still fail closed in `scheduled` with `unexpected_scheduled_trigger`; `audio_expiry` fails closed in the runner with `unsupported_scheduled_job` until E5-6 creates `audio_objects.purge_due` and its body. No query is invented here.
- No re-export or alias of the moved functions from `index.ts`; callers move to the new module.
- No new SQL, migration, route, or secret.

---

### Task 1: Contract

- Append `ScheduledJobKind`, `JobReport`, `ScheduledJobRunner`, `Scheduler` to `packages/contracts/src/runtime.ts` (exported via the existing `./runtime` entry).

### Task 2: Runner

- Create `apps/api/src/scheduled-job-runner.ts`; move `runWatchdog`, `remindEmergencyConsentDeadlines` there; add `createScheduledJobRunner(env)`.
- `index.ts`: map `WATCHDOG_CRON` and `PURGE_CRON` to kinds, compute `nowIso`, call the runner inside `ctx.waitUntil`. Delete `runRetentionLifecycle`.

### Task 3: Fixture and verification

- `apps/api/test/watchdog-purge.test.ts`: import `runWatchdog` from the runner module; add a Node fixture that calls `createScheduledJobRunner(t.env).run('pipeline_watchdog', nowIso)` and asserts the same audit row as the Workers path; assert `audio_expiry` rejects.

```bash
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/watchdog-purge.test.ts apps/api/test/retention-lifecycle.test.ts
pnpm --filter @ccc/api run typecheck
pnpm guard:db
```
