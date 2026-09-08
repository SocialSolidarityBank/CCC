# CCC-216 PostgreSQL Baseline and Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow the ownership boundaries below. Main runs validation after concurrent edits settle.

**Goal:** Reproduce SQLite's cumulative 0045 schema in PostgreSQL, replay every subsequent logical migration, and reject structural or behavioral drift using disposable live databases.

**Architecture:** Hand-written PostgreSQL DDL supplies the baseline and missing paired Agent migration. A contract harness replays both migration histories, captures complete live catalogs at each logical checkpoint, and compares stored canonical fingerprints plus common business fixtures. No runtime SQL translation or alternate gateway is introduced.

**Tech Stack:** Node 24, pnpm 11.5.3, TypeScript, Vitest, Miniflare D1, the existing encrypted SQLite and PostgreSQL adapters, the existing digest-pinned disposable PostgreSQL Docker harness.

**Spec:** `docs/specs/S1-database-sql-subset.md` sections 2.3, 2.4, 3.2, 3.3, 3.4 and 5; `CCC_OPEN_PILOT_PLAN.md` E3-4; ADR-0041 D79. The master plan and S1 say 0045; Linear's older 0044 wording is superseded by those authorities.

## Global Constraints

- CCC-214 and CCC-222 are Done. The live Linear blocked-by list has no open prerequisite as of 2026-09-08.
- Worktree: `.worktrees/ccc-216-postgres-baseline-parity`, branch `feat/ccc-216-postgres-baseline-parity`, base `2092ebd`.
- SQLite 0001 through 0045 belong to the baseline. Do not silently fold 0046 through 0049 into it.
- Preserve every existing test and assertion. No skip, shortened fixture, or replacement of live engine checks with mocks.
- Synthetic data only. No production URL, hosted database mutation, real key, connection-string output, or provider error reflection.
- PostgreSQL failure or missing Docker is a failed check, never a skipped pass.
- DDL is authored explicitly for each engine. Do not build a SQLite-to-PostgreSQL translator, ORM, repository layer, or UnitOfWork.
- The existing PostgreSQL adapter's transaction, safe-number, owned-byte and structured-error contracts remain unchanged.
- Catalog fingerprints include tables, column types/defaults/nullability, primary/unique/foreign/check constraints, indexes and partial predicates, triggers including function bodies, views, and semantic annotations for operation markers and timestamp normalization.
- Physical engine representations may differ, but each difference needs an explicit normalization rule or named semantic fixture. Do not erase a constraint or trigger merely to obtain equal hashes.
- Public runtime APIs, UI, RLS policy, production import and installation are not this ticket's scope.

## Ownership and Shared Contract

Two Herdr workers edit concurrently in this worktree. They skip all validation, tests, builds, linters and formatters during the batch. Main owns integration and final validation.

| Owner | Files | Deliverable |
| --- | --- | --- |
| `ccc216-baseline` | `migrations/postgres/*.sql` | Complete manually authored baseline, missing Agent pair, correctly ordered memory pair |
| `ccc216-parity` | `apps/api/test/support/migration-parity.ts`, `apps/api/test/migration-parity.test.ts`, `apps/api/test/database-parity.test.ts`, `apps/api/test/support/postgres.ts` | Live catalogs, manifest generation/check contract, migration fixtures and three-profile business comparison |
| Main | `migrations/parity.yaml`, `adapters/db-postgres/src/index.ts`, `apps/api/test/postgres-database.contract.test.ts`, package scripts, suite dispatcher, CI integration, relevant existing documentation | Generated fingerprints, legacy primary-key error equivalence, runnable commands and integration evidence |

No worker edits another owner's paths. A missing cross-boundary change is reported to Main rather than patched concurrently.

The migration sequence is fixed:

```ts
const checkpoints = [
  { id: 'baseline-0045', sqliteThrough: '0045_identity_revocation.sql', postgres: '0001_baseline.sql' },
  { id: 'sql-portability', sqlite: '0046_sql_portability.sql', postgres: '0002_sql_portability.sql' },
  { id: 'timestamp-normalization', sqlite: '0047_timestamp_normalization.sql', postgres: '0003_timestamp_normalization.sql' },
  { id: 'agent-jobs', sqlite: '0048_agent_jobs.sql', postgres: '0004_agent_jobs.sql' },
  { id: 'counseling-memory', sqlite: '0049_counseling_memory.sql', postgres: '0005_counseling_memory.sql' },
] as const;
```

The current PostgreSQL memory migration is `0004_counseling_memory.sql`; rename it to `0005_counseling_memory.sql` because the missing Agent pair must precede it. The missing baseline means this repository has no completed deployable PostgreSQL history to upgrade in place. Preserve the existing memory migration's semantics and update any live references if found.

The manifest uses JSON syntax, a strict subset of YAML, so Node can read `migrations/parity.yaml` without adding a YAML dependency. It records each checkpoint's source filenames and SHA-256, live SQLite and PostgreSQL catalog fingerprints, and semantic annotations. Distinct engine catalog fingerprints are expected; logical inventory comparisons and semantic fixtures establish equivalence rather than pretending different DDL text is identical.

Live integration decision: SQLite nullable TEXT primary keys remain nullable PostgreSQL UNIQUE constraints. Each is explicitly annotated with `COMMENT ON CONSTRAINT ... IS 'ccc:sqlite-primary-key'`. The adapter's existing catalog lookup treats this exact annotation as a logical `primary_key`; ordinary unique constraints, misleading names and unrecognized comments remain `unique`. The live catalog includes this annotation in fingerprints and logical normalization. This preserves nullable legacy data and duplicate-key error classification without pretending PostgreSQL supports nullable physical primary keys.

The historical cutover manifest is legally a singleton. Its timestamp proof uses independently migrated legal snapshots, then the same engine's TEXT ordering over the recovered observations. Constraints stay enabled; the manifest records this singleton-snapshot proof strategy rather than inserting two illegal rows.

Integration also normalizes PostgreSQL boolean predicate results to SQLite/D1 numeric 0/1, preserving SQL NULL. A bare-predicate shared contract and the actual counseling-record write/replay/read/rollback smoke defend the gateway authorization boundary.

SQLite 0046 validates `pragma_foreign_key_check` before clearing deferred bookkeeping at the end of its table rebuild. Actual foreign keys remain enabled. PostgreSQL creation defaults and memory debounce clocks use `statement_timestamp()` to preserve SQLite's statement-stable clock. Literal defaults are compared by value; retention NULL behavior and clock stability are exercised from installed schema expressions, including deliberate default and helper mutations.

Ordinary checks never rewrite the manifest. The explicit generator invocation is:

```sh
CCC_UPDATE_MIGRATION_PARITY=1 pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts --maxWorkers 1
```

That mode still executes schema/semantic assertions before writing expected fingerprints. The test supports `CCC_UPDATE_MIGRATION_PARITY=1` only for its own disposable databases, not arbitrary external URLs. Main alone invokes it once implementations settle.

## Task 1: Complete the PostgreSQL Migration History

**Files:** Create `migrations/postgres/0001_baseline.sql` and `0004_agent_jobs.sql`; rename the memory migration to `0005_counseling_memory.sql`; correct existing PostgreSQL pairs only where live replay exposes an actual mismatch.

**Consumes:** SQLite migrations 0001 through 0049 and their live cumulative catalog. Existing PostgreSQL 0002, 0003 and memory SQL define established PostgreSQL conventions.

**Produces:** The exact five PostgreSQL paths in the shared checkpoint contract. No TypeScript interface is introduced.

- [ ] Read existing PostgreSQL conventions and the SQLite cumulative schema through 0045. Use live SQLite catalog output to inventory surviving objects; do not replay dropped historical objects into the baseline.
- [ ] Hand-write all tables, indexes, views, constraints and triggers at the 0045 boundary. Preserve names where practical. Map INTEGER to bigint, REAL to double precision, BLOB to bytea, and timestamp columns to text.
- [ ] Port schema-only expressions explicitly. Preserve NULL-safe equality using `IS NOT DISTINCT FROM`, inequality using `IS DISTINCT FROM`, nullable scalar min/max semantics, leap-day retention behavior, JSON validity and character-class restrictions.
- [ ] Preserve trigger failures and source-verified application codes. Keep append-only audit behavior, approval fences, identity revocation, retention and PII lifecycle constraints.
- [ ] Add the missing Agent jobs pair and rename the existing memory pair according to the checkpoint contract. Keep marker/timestamp pairs separate from the baseline.
- [ ] Report paths, intentional physical differences, and any semantic risk to Main. Do not run tests or formatters while the parity worker is editing.

A representative required NULL-safe trigger form is:

```sql
CREATE FUNCTION example_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value IS DISTINCT FROM OLD.value THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_draft_version';
  END IF;
  RETURN NEW;
END;
$$;
```

Use actual source-verified tables and codes, not this example object, in the migration.

## Task 2: Live Catalog and Behavioral Parity

**Files:** Create `apps/api/test/support/migration-parity.ts`, `apps/api/test/migration-parity.test.ts`, `apps/api/test/database-parity.test.ts`; extend `apps/api/test/support/postgres.ts` only as needed for trusted multi-statement migration application and catalog access.

**Consumes:** The fixed migration checkpoint sequence and existing `Database` adapters. Reuse the PostgreSQL harness and D1 migration-loading patterns rather than introducing another Docker launcher.

**Produces:** Two Vitest files runnable from `apps/api`, and the explicit catalog generation mode above. Helpers remain in the contract harness, not production packages.

- [ ] Add deterministic catalog collection from actual SQLite `sqlite_schema`/PRAGMA results and PostgreSQL catalogs. Include PostgreSQL trigger function definitions, partial-index predicates and complete constraints. Ignore engine-owned catalog objects, never application-owned ones.
- [ ] Replay migrations and capture each checkpoint. Validate the baseline boundary and every pair. Reject missing, extra, duplicate or reordered migration entries and changed source bytes not represented by the checked manifest.
- [ ] Compare logical tables, columns/types, keys, indexes and named triggers. Record physical normalization rules explicitly, including default/trigger implementations and any legacy primary-key semantics; do not silently drop differences.
- [ ] Keep catalog generation separate from ordinary verification. Add mutation fixtures that alter or drop a constraint/index/trigger and demonstrate fingerprint verification fails.
- [ ] Reuse the existing E3-2 timestamp fixture and live timestamp inventory. For every inventoried legacy column, prove data rewrite, ISO default/trigger output and same-day ordering after migration. Use actual row creation and trigger paths, not a self-authored list of claimed columns.
- [ ] Compare D1, encrypted SQLite and PostgreSQL with identical deterministic gateway inputs and normalized outputs. Exercise successful business persistence/re-read, conditional mutation plus audit, failed middle-of-batch rollback, duplicate keys, missing foreign keys, checks and application-trigger error classifications.
- [ ] Exercise S1 F09's date, NULL-safe equality, scalar NULL, character-class and ordered aggregation semantics through the real migration constraints/probes. Preserve the leap-day expected cap `2029-02-28T00:00:00.000Z`.
- [ ] Report paths, exact invocation contract and remaining integration requirements. Do not run tests, builds, linters or formatters during the concurrent batch.

Required observable assertions include:

```ts
expect(afterFailure).toEqual(beforeFailure);
expect(normalizedPostgresResult).toEqual(normalizedSqliteResult);
expect(normalizedD1Result).toEqual(normalizedSqliteResult);
expect(migratedLegacyTimestamp).toBe('2026-01-01T09:00:00.000Z');
expect(orderedIds).toEqual(['legacy-0ms', 'new-500ms']);
```

The fixture variables are collected from real engine operations. Do not construct them by echoing the input or hardcode a successful fingerprint.

## Task 3: Integrate and Verify the Public Commands

**Files:** Modify root `package.json`, `scripts/test-suite.mjs`, `scripts/test-suite.test.mjs`, and the existing CI workflow where appropriate. Generate `migrations/parity.yaml`. Update existing docs only where this implementation changes their current command/history contract.

**Consumes:** Both worker outputs. Main is the sole integration owner.

**Produces:** `pnpm test:db-parity` and `pnpm guard:migration-parity`, both failing on unavailable engines, schema drift or behavioral mismatch.

- [ ] Add suite dispatch entries selecting `test/database-parity.test.ts` and `test/migration-parity.test.ts` respectively. Preserve the existing safe workerd environment wrapper and strict test argument forwarding.
- [ ] Generate the manifest from live checkpoint catalogs after semantic assertions pass. Run ordinary verification again with update mode absent to prove the checked artifact is consumed read-only.
- [ ] Add the new checks to existing CI at the appropriate database-contract stage. Keep the PostgreSQL image and lifecycle from CCC-222.
- [ ] Run the focused commands below. Diagnose actual failures and fix their source without weakening old or new contracts.

```sh
pnpm guard:migration-parity
pnpm test:db-parity
pnpm test:contracts --db=d1
pnpm test:contracts --db=sqlite
pnpm test:contracts --db=postgres
pnpm guard:sql-dialect
pnpm guard:db
pnpm guard:core-imports
pnpm typecheck
```

- [ ] Run the existing API suite once after integration, plus the suite-dispatch tests. Use an actual disposable PostgreSQL gateway write/re-read/rollback smoke scenario as deliverable evidence.
- [ ] Request independent spec and security/correctness review. Resolve findings and rerun affected scenarios.
- [ ] Record actual evidence in the ticket. Do not claim production PostgreSQL installation, RLS completion, or hosted data migration from these checks.
