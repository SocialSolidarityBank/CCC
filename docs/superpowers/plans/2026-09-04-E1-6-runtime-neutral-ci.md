# E1-6 Runtime-Neutral CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the package boundary from E1-5 a CI gate and give the three deployment modes a single `test:runtime` / `test:golden` entry that reports `UNAVAILABLE` with a non-zero exit until each mode's suite exists.

**Spec:** `CCC_OPEN_PILOT_PLAN.md` lines 62, 129, 247, 560, 564; S4 §runtime commands.

## Global Constraints

- `guard:core-imports` is deterministic and dependency-free (`node:` only). Rules: `packages/*` import no `@cloudflare/*`, `@supabase/*`, `electron`, `node:*`, `cloudflare:*`, `bun:*`, `miniflare`, `wrangler`; direction `apps -> adapters -> packages` (declared deps and actual imports, relative escapes included); no workspace cycle; `packages/core` never mentions a `PlatformSecretName`.
- `test:runtime` / `test:golden` take `--mode=<community-cloud|local-single|local-office>` and pass every other flag through. An unregistered mode prints `UNAVAILABLE kind=<k> mode=<m>` and exits 2; a usage error exits 1. No mode is registered here; E6, E7, E8 register theirs in `scripts/test-mode.mjs` `SUITES`.
- Guard and entry both ship with planted-violation tests (`pnpm test:scripts`) so a silently passing guard is caught.
- `pnpm test:contracts --db=d1` (plan line 560) is SG1/E1-2 territory and is not created here.
- `deno test packages/core/test` (plan line 560) is deferred explicitly: Deno is not in the project toolchain (CI installs only pnpm/Node; a Homebrew `deno` on the dev machine is incidental) and `packages/core/test` does not exist. Core is exercised today through `apps/api/test` (54 files) running against the moved packages, plus `guard:core-imports`. A runtime-neutral core suite belongs with the first non-Workers runtime (E7-1a Node adapters), where it can run under Node's test runner; adding a Deno toolchain solely for this line is not justified before then.

---

### Task 1: `scripts/guard-core-imports.mjs` + `scripts/guard-core-imports.test.mjs`
### Task 2: `scripts/test-mode.mjs` + `scripts/test-mode.test.mjs`
### Task 3: Wire `guard:core-imports`, `test:scripts`, `test:runtime`, `test:golden` in `package.json`; add `test:scripts` and `guard:core-imports` to the CI verify job and `guard:core-imports` to the pre-commit hook.

```bash
pnpm test:scripts
pnpm guard:core-imports
pnpm test:runtime --mode=local-single   # UNAVAILABLE, exit 2
pnpm test:golden --mode=community-cloud # UNAVAILABLE, exit 2
```
