# E1-2 Database Port and D1 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move gateway storage behind a narrow public `Database` port and provide a D1 adapter that preserves the current D1 API behavior without changing gateway SQL.

**Architecture:** `packages/contracts/src/database.ts` is the provider-neutral source of truth for prepared statements, result metadata, bindable values, and structured errors. `adapters/db-d1` wraps Cloudflare's `D1Database`, copying binary values at both ownership boundaries and translating D1 result/error shapes into the port contract. `db/gateway.ts` consumes `Database` through `Env.DB`; all SQL remains in the gateway and is not translated by this ticket.

**Tech Stack:** TypeScript 5.9, pnpm workspaces, Vitest 4, Cloudflare Workers D1 types, Miniflare D1 test harness.

**Spec:** `docs/specs/S1-database-sql-subset.md` §2.1, §2.3, §3.2–§3.3 (F01, F02, F03, F05, F10), and ADR-0041 D79.

## Global Constraints

- `Database` exposes only `prepare(sql)`, `batch(statements)`, and the prepared statement methods `bind`, `first`, `all`, and `run`; `batch()` is the only transaction boundary.
- `Bindable` is `string | number | null | Uint8Array`; application booleans are converted to `0` or `1` before binding.
- `first()` returns `null` for no row and for a selected SQL `NULL`; `first(column)` raises a structured syntax error when the named result column is absent.
- `all()` returns `{ results: [], success: true, meta }` for an empty result; `run()` returns no row results and reports `meta.changes`.
- Bind input bytes are copied immediately, returned BLOB bytes are fresh caller-owned `Uint8Array` copies, and D1-native `ArrayBuffer` values are normalized at the adapter boundary.
- `batch()` executes statements in order and rolls back all earlier mutations when a later statement fails; it does not return a partial result array.
- `DatabaseError` exposes only `kind`, optional `constraintSubtype`, and allowlisted `applicationCode`; vendor error text must not leak to the gateway or contract output.
- The D1 adapter forwards SQL unchanged. Placeholder translation belongs to a future PostgreSQL adapter; this ticket does not alter SQL in `db/gateway.ts`.
- This ticket does not add `exec`, `dump`, interactive `begin`/`commit`/`rollback`, a `UnitOfWork`, repositories, migrations, or a second gateway implementation.

---

### Task 1: Add the provider-neutral Database contract

**Files:**
- Create: `packages/contracts/src/database.ts`
- Modify: `packages/contracts/package.json`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Produces `Database`, `PreparedStatement`, `DatabaseResult<T>`, `Bindable`, and `DatabaseError` with the exact signatures below.
- Consumes no runtime package and must remain free of Cloudflare, SQLite, PostgreSQL, or gateway imports.

- [ ] **Step 1: Write the contract before implementation**

```ts
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]>;
}

export interface PreparedStatement {
  bind(...values: Bindable[]): PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<DatabaseResult<T>>;
  run(): Promise<DatabaseResult<unknown>>;
}

export interface DatabaseResult<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}

export type Bindable = string | number | null | Uint8Array;

export interface DatabaseError extends Error {
  kind: 'constraint' | 'syntax' | 'bind_arity' | 'unsupported';
  constraintSubtype?: 'unique' | 'primary_key' | 'foreign_key' | 'check' | 'trigger';
  applicationCode?: string;
}
```

Use a concrete error class internally if needed, but the public module must export the interface and must not widen `Bindable` to `unknown`.

- [ ] **Step 2: Register the package without adding implementation files**

`packages/contracts/package.json` must remain a private ESM workspace package and export `./database` to `./src/database.ts`. The root workspace must include `packages/*` and `adapters/*` in addition to `apps/*`.

- [ ] **Step 3: Typecheck the contract consumer**

Run: `pnpm --filter @ccc/api exec tsc --noEmit --project apps/api/tsconfig.json`

Expected: PASS once Tasks 1–3 are complete; a consumer importing `@ccc/contracts/database` must see the exact five public types and no platform-specific types.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/package.json packages/contracts/src/database.ts pnpm-workspace.yaml
git commit -m "refactor(contracts): add database port types"
```

---

### Task 2: Implement the D1 adapter behind the contract

**Files:**
- Create: `adapters/db-d1/src/index.ts`
- Modify: `adapters/db-d1/package.json`
- Test: `apps/api/test/database-contract.test.ts`

**Interfaces:**
- Consumes `D1Database` from `@cloudflare/workers-types` and the provider-neutral types from `@ccc/contracts/database`.
- Produces `createD1Database(d1: D1Database): Database` from the package root (`@ccc/db-d1`).
- The returned `Database` must expose no D1-only method such as `exec`, `dump`, or a direct transaction method.

- [ ] **Step 1: Run the red contract command before implementing**

Run: `pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts`

Expected RED before Tasks 1–2: module resolution fails for the wished-for public modules, first at `@ccc/contracts/database` or `@ccc/db-d1`, because their source exports do not yet exist. This is an intentional missing-module/API failure, not a test syntax failure.

- [ ] **Step 2: Wrap D1 prepare and bind immutably**

`createD1Database` must call the supplied D1 `prepare(sql)` exactly once per port `prepare` call and forward the SQL string unchanged. Each `bind` call must return a new wrapper and must not mutate the source wrapper or any previously bound wrapper. Copy every `Uint8Array` input immediately; for the adapter-only D1 boundary, normalize an `ArrayBuffer` to a copied `Uint8Array` before forwarding it to D1.

- [ ] **Step 3: Normalize first/all/run results**

Map D1 result values recursively where required by the existing rows: convert D1 `ArrayBuffer` BLOBs to fresh `Uint8Array` values, preserve strings, numbers, and `null`, and avoid returning a reference that the D1 result owns. Preserve D1's no-row `null`, selected-column `null`, empty `all()` results, `success`, `meta.changes`, and optional `meta.last_row_id`. For `first(column)`, distinguish a missing output column from an existing SQL NULL and throw `DatabaseError` with `kind: 'syntax'` for the former.

- [ ] **Step 4: Normalize errors at the adapter boundary**

Translate D1 errors into `DatabaseError` categories: bind count failures to `bind_arity`, malformed/missing SQL objects or missing columns to `syntax`, and constraint failures to `constraint` with one of `unique`, `primary_key`, `foreign_key`, `check`, or `trigger`. Preserve only the three S1 application trigger codes (`stale_draft_version`, `invite_token_already_used`, `participant_schema_violation`) and discard vendor messages/codes from the exposed error message. Do not translate `$1`, `:name`, or other SQL placeholders in this adapter.

- [ ] **Step 5: Preserve atomic batch behavior**

Forward one ordered statement array to D1's `batch`. Return the ordered normalized results on success. On any error, propagate the normalized `DatabaseError` and do not synthesize or return a partial results array; D1's rollback must leave all statements in that batch unapplied.

- [ ] **Step 6: Run the focused contract tests**

Run: `pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts`

Expected: PASS for the focused D1 contract tests after Tasks 1–2, including immutable binding, byte ownership, first/all/run metadata, successful ordered batch, failed-batch rollback, error classification, and SQL pass-through.

- [ ] **Step 7: Commit**

```bash
git add adapters/db-d1/package.json adapters/db-d1/src/index.ts apps/api/test/database-contract.test.ts
git commit -m "feat(db): add D1 database adapter"
```

---

### Task 3: Change gateway dependency injection to the port

**Files:**
- Modify: `db/gateway.ts:29-63`
- Test: `apps/api/test/database-contract.test.ts`

**Interfaces:**
- Consumes `Database` from `@ccc/contracts/database`.
- Produces `Env.DB: Database` while preserving every other `Env` property and all gateway function signatures.
- The D1-specific conversion belongs at the worker composition root, not in gateway SQL functions.

- [ ] **Step 1: Change only the environment type**

Replace the `D1Database` import/use for `Env.DB` with the public `Database` type. Do not modify query text, bind order, error branches, or gateway behavior. The compile-time consumer in `apps/api/test/database-contract.test.ts` must assign a `Database` to `Pick<Env, 'DB'>` and therefore fail before this task and pass after it.

- [ ] **Step 2: Migrate the composition boundary**

At the existing worker environment construction boundary (not inside gateway functions), wrap the platform D1 binding with `createD1Database(env.DB)` so callers still provide the same operational D1 binding while gateway receives only the port. Keep this change limited to the actual composition boundary discovered by the existing API entrypoint; do not duplicate or reimplement SQL.

- [ ] **Step 3: Run type and focused contract checks**

Run:

```bash
pnpm --filter @ccc/api exec tsc --noEmit --project apps/api/tsconfig.json
pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts
```

Expected: both commands pass; the compile-time consumer proves gateway accepts a provider-neutral `Database`, and the runtime tests prove D1 compatibility.

- [ ] **Step 4: Commit**

```bash
git add db/gateway.ts apps/api/src apps/api/test/database-contract.test.ts
git commit -m "refactor(db): inject database port into gateway"
```

---

### Task 4: Final repository checks and handoff

**Files:**
- Review only: `db/gateway.ts`, `packages/contracts/src/database.ts`, `adapters/db-d1/src/index.ts`, `apps/api/test/database-contract.test.ts`, workspace manifests.

- [ ] **Step 1: Confirm SQL is unchanged**

Compare the gateway diff and verify this ticket changed only the `Env.DB` type/import and composition wiring; no SQL text or bind order changed.

- [ ] **Step 2: Run the parent-owned gates**

Run from the repository root:

```bash
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts
pnpm --filter @ccc/api run test
pnpm guard:db
```

Expected: typecheck, focused contract tests, API regression tests, and the DB gateway guard all pass. Record the exact outputs and any pre-existing failures in the parent ticket; do not claim parity or PostgreSQL behavior from this ticket.

- [ ] **Step 3: Commit only the scoped implementation**

```bash
git diff --check
git status --short
git log -3 --oneline
```

The final branch contains only the public contract, D1 adapter, workspace manifests, gateway type/composition cutover, and focused contract tests. No migrations, SQL rewrites, PostgreSQL adapter, or unrelated cleanup is included.
