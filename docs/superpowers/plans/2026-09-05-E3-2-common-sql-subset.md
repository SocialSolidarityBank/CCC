# E3-2 Common SQL Subset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every runtime gateway statement valid in the S1 SQLite/PostgreSQL subset, add the shared placeholder scanner and deterministic dialect guard, and land the paired SQL-portability migrations required before the PostgreSQL adapter.

**Architecture:** `@ccc/contracts/sql` owns one dependency-free lexical scanner that validates SQL and converts only real bare `?` placeholders to PostgreSQL `$n` placeholders. `packages/core/src/gateway.ts` continues to own all business SQL, but it binds one application-generated ISO timestamp per operation, uses explicit `ON CONFLICT`, computes SQLite-only date/string operations in TypeScript, and proves mutation/audit coupling with a unique operation marker plus post-state `EXISTS`. SQLite 0046/PostgreSQL 0002 add marker storage and canonical defaults; SQLite 0047/PostgreSQL 0003 normalize the remaining legacy timestamp data without leaving guards disabled.

**Tech Stack:** TypeScript 5.9, Node 24, Vitest 4, TypeScript compiler API, Cloudflare D1 fixture, encrypted SQLite adapter, SQLite/PostgreSQL SQL migration files.

**Spec:** `CCC_OPEN_PILOT_PLAN.md:267-279,557-565`; `docs/specs/S1-database-sql-subset.md` §2.2-§3.4; Linear CCC-218.

**Understood as:** Complete E3-2 in one reviewable PR. Do not stop at a guard-only result; runtime SQL, atomic audit markers, both logical migration pairs, migration-number shifts, and focused behavior evidence are all part of the cutover approved on 2026-09-05.

**Execution status:** Tasks 1-5 are complete on `e3-2-common-sql-subset`. The verified implementation is in PR #275; Linear CCC-218 remains In Review until merge.

## Global Constraints

- Keep R1: business SQL remains in `packages/core/src/gateway.ts`; adapters, migration runners, and contract harnesses are the only raw-driver exceptions.
- Do not add an ORM, SQL translator, query builder, interactive transaction API, `UnitOfWork`, dependency, compatibility alias, or deprecated path.
- The scanner preserves single-quoted literals including `''`, double-quoted identifiers including `""`, line comments, and block comments. It converts only bare `?`; `?N`, backticks, unterminated literals, and unterminated block comments are syntax errors before driver execution.
- Runtime values, dates, JSON, and bytes are bound. Runtime SQL must not call `datetime`, `strftime`, `julianday`, `instr`, `char`, JSON SQL functions, scalar `min/max`, `GROUP_CONCAT`, `changes()`, or `INSERT OR ...`.
- Each mutation and its audit row stays in one `Database.batch`. Marker columns exist on `support_cases`, `support_case_assignees`, `participant_pii_vault`, `counseling_schedules`, `sessions`, and `action_items`; `invite_tokens.consumption_id` binds token use to downstream inserts. Globally unique inserted row IDs identify append-only mutations.
- New timestamps are canonical `YYYY-MM-DDTHH:mm:ss.sssZ`. Legacy `YYYY-MM-DD HH:MM:SS` rows normalize once to `.000Z`, preserving `ORDER BY timestamp, id` chronology. SQLite 0046 rebuilds 11 immutable legacy-default tables, adds seven safe default-normalization triggers, and restores every affected index, view, and original trigger; SQLite 0047 normalizes the remaining 32 timestamp-bearing tables with their update guards suspended only inside that migration.
- SQLite 0046/PostgreSQL 0002 are the `sql_portability` pair; SQLite 0047/PostgreSQL 0003 are the `timestamp_normalization` pair. Shift only unstarted future references: Supabase platform to PostgreSQL 0004, consent to SQLite 0048/PostgreSQL 0005, audio to SQLite 0049/PostgreSQL 0006.
- Existing tests remain enabled and assertions are not weakened.

---

### Task 1: Shared placeholder scanner and dialect guard

**Files:**
- Create: `packages/contracts/src/sql.ts`
- Modify: `packages/contracts/package.json`
- Create: `apps/api/test/sql-placeholder-scanner.test.ts`
- Create: `scripts/guard-sql-dialect.mjs`
- Create: `scripts/guard-sql-dialect.test.mjs`
- Modify: `package.json`, `scripts/test-suite.mjs`, `scripts/test-suite.test.mjs`

**Interfaces:**

```ts
export class SqlLexicalError extends Error {}
export interface ScannedSql {
  postgresSql: string;
  parameterCount: number;
}
export function scanSqlPlaceholders(sql: string): ScannedSql;
```

- [x] Write scanner tests for S1 F01: quoted `?`, doubled quotes, line/block comments, one real placeholder, ordered `$1..$n`, `?N`, backticks, and unterminated literal/comment failures.
- [x] Run `pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/sql-placeholder-scanner.test.ts`; RED was the missing `@ccc/contracts/sql` export.
- [x] Implement the one-pass scanner with no regex replacement and export `./sql` from `@ccc/contracts`.
- [x] Re-run the scanner test; GREEN 6/6.
- [x] Write guard tests with temporary fixture trees. Require AST extraction of `.prepare(...)` and helper SQL through the installed TypeScript compiler, exact runtime violation locations, migration-pair checks, and zero false positives from TypeScript comments or non-SQL strings.
- [x] Run `node --test scripts/guard-sql-dialect.test.mjs`; RED was the missing guard, then missing nullable/helper/post-state/migration-pair enforcement.
- [x] Implement `guard:sql-dialect`. Reject the forbidden runtime forms from S1 §2.2-§2.4, numbered and non-bare placeholders, direct transaction statements, scalar `min/max`, JSON functions, unresolved SQL, and implicit nullable ordering. Inventory SQLite-only migration forms separately.
- [x] Add `guard:sql-dialect` and its test to the existing script dispatcher; the guard test is GREEN 7/7 and the repository reports zero runtime violations.

### Task 2: Portable runtime SQL cutover

**Files:**
- Modify: `packages/core/src/gateway.ts`
- Modify: `adapters/db-d1/src/index.ts`
- Modify: `adapters/db-sqlite/src/index.ts`
- Modify: `apps/api/test/support/database-contract.ts`
- Modify: `apps/api/test/gateway-pseudonym-id.test.ts`, `apps/api/test/new-signup-badge.test.ts`, `apps/api/test/retention-invariants.test.ts`
- Exercise existing text-work, retention, signup, briefing, schedule, and assignment suites.

**Interfaces:**
- D1 and SQLite `prepare(sql)` call `scanSqlPlaceholders(sql)` for lexical validation but execute the unchanged SQLite SQL.
- PostgreSQL E3-3 will consume `ScannedSql.postgresSql` and `parameterCount` directly.
- Gateway-local `insertIfAbsent(...)` and `upsertByKey(...)` name explicit portable SQL intent; they do not generate vendor-specific SQL.

- [x] Extend the D1 and encrypted SQLite contract cases with F01 lexical failures and bind-count behavior; both profiles failed before adapter validation and pass after it.
- [x] Add focused behavior coverage for malformed stored pseudonyms and same-day retention deadlines; reuse the existing text-work, consent, invite, briefing, and pending-fixture suites for unchanged behavior.
- [x] Run the dialect guard against the original runtime SQL; RED reported numbered placeholders, database clocks, `INSERT OR IGNORE`, `GLOB`, `GROUP_CONCAT`, `changes()`, and nullable ordering.
- [x] Replace `?1.. ?4` with bare `?` while preserving bind order.
- [x] Replace the two text-work `INSERT OR IGNORE` statements with explicit `ON CONFLICT (org_id, session_id) WHERE status IN ('pending', 'processing') DO NOTHING` through the named conflict helper.
- [x] Generate one ISO time per operation and bind it to effective-at, audit, invite-use, scheduler, and upcoming/past comparisons.
- [x] Replace beneficiary `GLOB`/numeric casting with a portable prefix query plus `isBeneficiaryId`/application parsing. Preserve organization-local and global maxima and retry behavior.
- [x] Replace retention `julianday`, modifier `datetime`, `strftime`, and scalar `min` with application-calculated ISO candidates while preserving NULL and leap-day semantics.
- [x] Replace pending `GROUP_CONCAT` with ordered row results and one application aggregation pass. No N+1 query was introduced.
- [x] Run D1, SQLite, focused runtime suites, and the dialect guard GREEN.

### Task 3: Marker-based mutation and audit atomicity

**Files:**
- Modify: `packages/core/src/gateway.ts`
- Create: `apps/api/test/sql-operation-marker.test.ts`
- Create: `migrations/sqlite/0046_sql_portability.sql`
- Create: `migrations/postgres/0002_sql_portability.sql`
- Create: `apps/api/test/sql-portability-migration.test.ts`

**Interfaces:**

```ts
interface AuditPostState {
  sql: string;       // EXISTS subquery body over explicit trusted identifiers
  bindings: Bindable[];
}

function conditionalCanonicalAuditStatement(
  env: Env,
  actor: Actor,
  entry: CanonicalAuditEntry,
  postState: AuditPostState,
  createdAt: string,
): PreparedStatement;
```

- [x] Write F10-focused tests proving marker uniqueness, matching mutation/audit, rollback when the audit fails, and one successor under same-millisecond transfer races.
- [x] Run the original marker and dialect checks RED against missing marker columns and `changes()`.
- [x] Add nullable `operation_marker` storage and unique partial indexes to mutable tables reached by conditional audit flows; globally unique insert IDs remain the marker for append-only inserts.
- [x] Change conditional mutations to write a fresh marker or supplied consumption ID and make each adjacent audit query the exact post-state.
- [x] Replace close-case and invite-consumption `changes()` chains with marker/post-state rules; schedule-goal and assignment transitions claim the marker before dependent writes.
- [x] Run marker, assignment, schedule, signup, and affected gateway suites GREEN.

### Task 4: Timestamp normalization and logical migration pairs

**Files:**
- Modify: `migrations/sqlite/0046_sql_portability.sql`
- Create: `migrations/sqlite/0047_timestamp_normalization.sql`
- Modify: `migrations/postgres/0002_sql_portability.sql`
- Create: `migrations/postgres/0003_timestamp_normalization.sql`
- Modify: `apps/api/test/sql-portability-migration.test.ts`
- Modify: `CCC_OPEN_PILOT_PLAN.md`
- Modify: `docs/specs/S7-consent-six-domains.md`
- Modify: `docs/superpowers/plans/2026-09-03-SG7-consent-six-domains.md`
- Modify: `docs/specs/S11-supabase-edge-template.md`
- Do not modify archived 2026-08-31 plans or design-owned files.

**Interfaces:**
- The migration test derives the live timestamp, trigger, view, and index inventory from `sqlite_schema` rather than a hand-maintained list.
- SQLite 0046/PostgreSQL 0002 own markers and canonical defaults; SQLite 0047/PostgreSQL 0003 own the full legacy data rewrite. E3-2 validates both SQLite migrations now. E3-3/E3-4 intentionally own PostgreSQL execution, baseline triggers, live-catalog hashes, and three-profile parity because baseline 0001 does not exist yet.

- [x] Derive the 0045 live default-column, trigger, view, and index inventory before applying 0046. Seed legacy and same-day ISO audit values, verify every legacy default becomes canonical, compare every restored trigger/view/index, and exercise the retention deadline trigger with a same-day before/after regression.
- [x] Run migration tests RED before the SQLite/PostgreSQL pairs existed.
- [x] In SQLite 0046, rebuild legacy-clock-default tables, normalize copied values, restore every affected index/view/trigger without a writable bypass, and emit ISO timestamps from retained trigger paths.
- [x] In SQLite 0047, normalize the remaining timestamp inventory while dropping and restoring update-side guards inside the migration transaction only.
- [x] In PostgreSQL 0002/0003, separate marker/default changes from the legacy rewrite and suspend/restore user triggers around normalization. E3-3/E3-4 own execution against baseline 0001.
- [x] Shift only unstarted migration references to the numbering in Global Constraints. Archived 2026-08-31 plans remain unchanged.
- [x] Re-run the migration, schema-trigger, retention, D1, and encrypted SQLite tests GREEN with foreign-key violations 0.

### Task 5: Full verification, review, and delivery

**Files:**
- Modify only files required by failures caused by this cutover.

- [x] Run `pnpm test:contracts --db=d1`; GREEN 10/10.
- [x] Run `pnpm test:contracts --db=sqlite`; GREEN 12/12.
- [x] Run `pnpm test:contracts --sql`; GREEN 10/10, including exhaustive timestamp probes and marker races.
- [x] Run `pnpm --filter @ccc/api run test` (61 files, 734 tests), `pnpm test:scripts` (26 tests), API typecheck, encrypted SQLite build, `guard:sql-dialect`, `guard:db`, `guard:core-imports`, `guard:doc-numbers`, and `guard:secrets`.
- [x] Run `pnpm release:verify` (569 SBOM dependencies) and the complete API/web production build; run `git diff --check`.
- [x] Independent review found and closed retention deadline, transfer race, timestamp guard, SQL coverage, per-column F06, and F10 gaps. Final focused review reported no remaining blocker; E3-3/E3-4 retain PostgreSQL runtime and parity proof.
- [x] Commit explicit paths, push `e3-2-common-sql-subset`, open review-ready PR #275 linked to Linear CCC-218, and keep Linear In Review until merge.
