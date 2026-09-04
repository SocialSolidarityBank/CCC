# E1-5 Common Package Atomic Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the gateway, request handler, and AI provider out of `db/` and `apps/api/src/` into `packages/core`, `packages/http-api`, and `packages/ai-runtime` in one commit, rewrite every caller and test import, and point the R1 guard at the new boundary. No old path, alias, or re-export survives.

**Architecture:** Dependency direction is `apps -> adapters -> packages` (plan line 62). `packages/contracts` gains the dependency-free shared vocabulary (`animal-slugs`, `consent-notice`) that `apps/web` also imports. `packages/core` owns the gateway facade, the access policy, the admin notify seam, and the scheduled job runner (plan line 131). `packages/ai-runtime` owns the OpenAI provider. `packages/http-api` owns the request handler plus its identity, Access JWT, and preview gate modules; E4-1 later carves the Identity port out of these. `apps/api` keeps only the Workers entry, the cron table, and the dev-only local actor resolver.

**Spec:** `CCC_OPEN_PILOT_PLAN.md` lines 7, 62, 63, 131 and the E1-5 row; ADR-0041 D78.

## Global Constraints

- Behavior-preserving move. No SQL, route, schema, or prompt change; the only source edits are import specifiers, the `NotifyEnv` type split so `packages/core` does not import `packages/http-api`, and the removed `index.ts` re-exports that nothing consumed.
- `packages/core` imports only `@ccc/contracts`. `packages/http-api` imports `@ccc/core`, `@ccc/ai-runtime`, `@ccc/contracts`. `packages/ai-runtime` imports nothing from the workspace.
- `scripts/guard-db-gateway.mjs` scans `adapters`, `apps`, `db`, `packages`, `scripts`; raw `env.DB` / `.prepare(` are allowed only in `packages/core/src/gateway.ts`, `adapters/db-d1/src/index.ts`, and the three seed harness files. `apps/*` and `packages/http-api` have no exception.
- `db/schema.sql` stays where it is; it is a schema document, not code.
- `guard:core-imports` (platform import boundary) is E1-6, not this ticket.

---

### Task 1: Move files with `git mv`

- `db/{animal-slugs,consent-notice}.ts` -> `packages/contracts/src/`
- `db/{gateway,access-policy}.ts`, `apps/api/src/{notify,scheduled-job-runner}.ts` -> `packages/core/src/`
- `apps/api/src/ai-provider.ts` -> `packages/ai-runtime/src/`
- `apps/api/src/{request-handler,identity,access-jwt,preview-gate}.ts` -> `packages/http-api/src/`

### Task 2: Package manifests and workspace wiring

- `packages/{core,http-api,ai-runtime}/package.json` with `exports` that map to the `.ts` sources (same shape as `@ccc/contracts`).
- `apps/api` depends on all three; `apps/web` depends on `@ccc/contracts` only (`transpilePackages: ['@ccc/contracts']`); the root depends on `@ccc/core` for `scripts/seed`.
- `apps/api/tsconfig.json` includes `packages/*/src` and `adapters/*/src` so `typecheck` covers the moved files.

### Task 3: Rewrite imports and retype the core seam

- Every `'../../../db/gateway'`, `'../src/ai-provider'`, `'../src/identity'`, etc. becomes the package specifier. `apps/web` `db/animal-slugs` and `db/consent-notice` imports likewise.
- `notify.ts` exports `NotifyEnv`; `scheduled-job-runner.ts` takes `ScheduledJobEnv = Env & NotifyEnv`; `ApiEnv` extends `NotifyEnv` instead of redeclaring `NOTIFY_WEBHOOK_URL`.

### Task 4: Guard and verification

```bash
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/web run typecheck && pnpm --filter @ccc/web run build
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts
pnpm --filter @ccc/web run test
pnpm guard:db
cd apps/api && pnpm exec wrangler deploy --dry-run --outdir /tmp/ccc-dry
```

Guard self-test: append `env.DB.prepare('x')` to a `packages/http-api` file, confirm `guard:db` fails, revert.
