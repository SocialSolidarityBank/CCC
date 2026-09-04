# E3-1a SQLite Migration Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 43 applied SQLite migration files from `migrations/` to `migrations/sqlite/` without changing file identity, D1 history, schema behavior, or pending-migration state.

**Architecture:** `migrations/sqlite/` becomes the single SQLite source for Wrangler, tests, and migration-number validation. A shared test-loader path in `apps/api/test/support/d1.ts` removes six independently computed paths. PostgreSQL receives its separate sibling directory in E3-4.

**Tech Stack:** Wrangler 4.107.1, Cloudflare D1, Miniflare, Vitest, Node 24.

**Spec:** `CCC_OPEN_PILOT_PLAN.md:271` (E3-1a); ADR-0041 D79.

## Global Constraints

- Keep all 43 `.sql` filenames and bytes unchanged. Wrangler identifies applied migrations by full filename; renaming a file would create a new pending identity.
- Preserve both applied `0009` files. `KNOWN_DUPLICATES` moves from `migrations/0009` to `migrations/sqlite/0009`; no broader exception.
- Update the top-level, `env.production`, and `env.preview` `migrations_dir` bindings in `apps/api/wrangler.toml` to `../../migrations/sqlite`.
- `SQLITE_MIGRATIONS_PATH` in `apps/api/test/support/d1.ts` is the sole test loader path. Direct migration tests import it instead of rebuilding relative URLs.
- `guard-doc-numbers` must fail if `migrations/sqlite/` is missing or unreadable; an absent directory must not silently pass as zero migrations.
- Update current source and canonical documentation links to the new SQLite path. Historical evidence artifacts preserve the path recorded at capture time.
- Before move baseline, run `pnpm --filter @ccc/api exec wrangler d1 migrations list ccc-preview --env preview --remote` and `pnpm --filter @ccc/api exec wrangler d1 execute ccc-preview --env preview --remote --command "SELECT COUNT(*) AS applied_count, MIN(id) AS first_id, MAX(id) AS last_id FROM d1_migrations"`. Record the output in the PR body. Expected: no pending migrations; 43 rows, IDs 1–43. Project-local Wrangler OAuth must already be active; never print environment values or credentials.

---

### Task 1: Make the expected test path fail before the move

**Files:**
- Modify: `apps/api/test/support/d1.ts`
- Modify: `apps/api/test/schema-animal-slug.test.ts`
- Modify: `apps/api/test/schema-triggers.test.ts`
- Modify: `apps/api/test/text-work-materials.test.ts`
- Update sites: `support/d1.ts:113`; `schema-animal-slug.test.ts:24`; `schema-triggers.test.ts:92,900,1711`; `text-work-materials.test.ts:455` (pre-cutover line numbers).

**Interfaces:**
- Produces: `SQLITE_MIGRATIONS_PATH: string`
- Consumes: `readD1Migrations(SQLITE_MIGRATIONS_PATH)`

- [x] Export `SQLITE_MIGRATIONS_PATH`, pointing to repository `migrations/sqlite/`.
- [x] Replace all six local URL constructions with that export.
- [x] Run `pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/settings-routes.test.ts`; its `beforeEach` calls `setupD1()`, so RED was `ENOENT ... migrations/sqlite` before files moved.

### Task 2: Move migrations and runtime consumers

**Files:**
- Move: `migrations/*.sql` → `migrations/sqlite/*.sql` (43 files, filenames and bytes unchanged)
- Modify: `apps/api/wrangler.toml`
- Modify: `scripts/guard-doc-numbers.mjs`

- [x] Record filename→SHA-256 values before the move; move the directory entries with `git mv`; compare the same map after the move.
- [x] Update the top-level, production, and preview Wrangler bindings.
- [x] Point the number guard at `migrations/sqlite`; any `readdir` error exits non-zero; move the one exact duplicate exception. `scripts/guard-doc-numbers.test.mjs` proves missing-directory failure, new-duplicate failure, and the exact applied `0009` exception.
- [x] Run the focused settings route test; GREEN was 9/9.

### Task 3: Update live path references

**Files:**
- Modify: `CLAUDE.md`, `db/schema.sql`, `packages/core/src/gateway.ts`, `packages/http-api/src/request-handler.ts`
- Modify: `docs/ops.md`, `docs/decisions-detail.md`, `docs/adr/0035-contest-scope-and-deployment-doors.md`, `docs/consent/legal-review-open-items-v1.md`, `docs/policy/deferred-blockers-v1.md`, `docs/specs/S1-database-sql-subset.md`, `docs/specs/S5-agent-job-contract-v2.md`, `docs/specs/S7-consent-six-domains.md`, and still-executable plans dated 2026-08-31/2026-09-02 that name a SQLite migration file
- Preserve: historical evidence under `artifacts/`

- [x] Rewrite concrete SQLite paths `migrations/00*.sql` and `migrations/00*` to `migrations/sqlite/...`.
- [x] Keep generic parent-boundary references only where they intentionally cover both future `sqlite/` and `postgres/`.
- [x] Search for `migrations/(?:\*|0[0-9]{3}|participant_support_case)` and separately for `readD1Migrations(` plus `migrations_dir`. No live concrete root SQLite path remains; only historical `artifacts/`, SG11's intentional parent glob, and this before→after plan retain `migrations/` references.

### Task 4: Verify local schema and remote history

- [x] Run `pnpm guard:doc-numbers`, `pnpm guard:db`, `pnpm guard:core-imports`, and `pnpm typecheck`.
- [x] Run migration consumers: `schema-animal-slug`, `schema-triggers`, `text-work-materials`, `database-contract`, and `health` (41/41).
- [x] Run `pnpm --filter @ccc/api exec wrangler d1 migrations list ccc-preview --env preview --remote`; result: no migrations to apply.
- [x] Query preview history with the exact `SELECT COUNT(*) AS applied_count, MIN(id) AS first_id, MAX(id) AS last_id FROM d1_migrations`; result: 43 applied rows with IDs 1–43, unchanged from baseline. Wrangler output is the durable PR evidence; no extra status artifact.
- [x] Compare all 43 pre/post SHA-256 values; names and hashes are identical.

### Task 5: Commit and PR

- [x] Commit as `refactor(db): move SQLite migrations under provider directory (E3-1a)`, push `e3-1a-migration-path`, and open a review-ready PR titled `refactor(db): move SQLite migrations under provider directory (E3-1a)`. Link Linear CCC-214 in the PR body and include the local 41-test result, script/guard/typecheck results, 43-file hash comparison, and preview before/after history.
