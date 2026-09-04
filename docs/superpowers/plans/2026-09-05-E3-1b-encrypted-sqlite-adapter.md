# E3-1b Encrypted SQLite Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `adapters/db-sqlite`, backed by `better-sqlite3-multiple-ciphers@13.0.3`, that satisfies the same `Database` contract and migration set as D1 and proves encrypted create/reopen under Electron 44 on Windows x64.

**Architecture:** The adapter wraps the synchronous native API behind the existing Promise-based `Database` port. Prepared statements keep SQL and copied bindings until execution, so `bind()` remains immutable. Each `batch()` executes through one native transaction and returns normalized D1-compatible results or one redacted `DatabaseError`. The adapter accepts exactly one 32-byte key, copies it into a temporary `Buffer`, calls native `key()`, zeroes the temporary buffer, and never provides a plaintext file mode.

**Tech Stack:** TypeScript 5.9, Node 24, Electron 44.1.1, `better-sqlite3-multiple-ciphers` 13.0.3, SQLite 3.53.4 / SQLite3MultipleCiphers 2.4.0, Vitest, GitHub Actions Windows 2022 x64.

**Spec:** `CCC_OPEN_PILOT_PLAN.md:272,583`; `docs/specs/S1-database-sql-subset.md` §2.1, §3.2, §5; ADR-0041 D79; Linear CCC-220.

**Verified dependency facts:** npm integrity is `sha512-UYabM82r1J84TLWc/SszoHs6XopWpl/2HCg3Nui1JUaFXg/VLswzkPowYiRhK/4CftI8dgtikwyZQecMldrGxQ==`, license is MIT (allowed by `supply-chain/license-allowlist.json`), and npm publishes SLSA provenance bound to upstream tag `v13.0.3` / commit `227825029b1bbf80917d5a26a37ac9c00bf5e0d3`. Upstream bundles a Windows x64 Node-API prebuild; PR #273 run `33910770634` proved it under Electron 44.1.1.

**Execution status:** Shared fixtures, adapter, local evidence, independent review, PR delivery, normal CI, and Windows/Electron runtime evidence are complete. Linear remains In Review until merge.

**Database contract:** `Database.prepare(sql)` returns a `PreparedStatement`; `bind(...values)` returns a new statement; `first(column?)`, `all()`, and `run()` return Promises. Bindings are `string | number | null | Uint8Array`. Results are `{results:T[],success:boolean,meta:{changes?,last_row_id?}}`. Structured errors are `{kind:'constraint'|'syntax'|'bind_arity'|'unsupported',constraintSubtype?,applicationCode?}`. Shared tests cover immutable binding, owned BLOB copies, no-row/NULL/missing-column semantics, run metadata, ordered atomic batch rollback, syntax/bind/unique/primary-key/trigger classification, and allowed application trigger codes.

## Global Constraints

- No plaintext file fallback. The trimmed filename must be nonempty and not `:memory:`; the key must be exactly 32 bytes. Wrong key, corrupt file, missing native binding, rejected WAL mode, or unsafe integer fails closed with a fixed-message structured error.
- The caller owns its input key. The adapter copies but never mutates it; every internal temporary key buffer is zeroed in `finally` immediately after native `key()`.
- No key, filename, SQL value, native error text, stack, or plaintext sentinel appears in error messages or CI evidence.
- `prepare` does not touch the native driver. `bind` returns a new statement with copied `Uint8Array` values. Execution prepares a fresh native statement so sibling bindings cannot interfere.
- Native integer mode is safe-integer aware: `bigint` is converted only within JavaScript's safe range; otherwise `DatabaseError.kind='unsupported'`.
- `first(column)` distinguishes no row / SQL NULL from a missing result column. `run()` always returns `results: []`. Buffers returned to callers are owned `Uint8Array` copies.
- `batch()` accepts only statements created by the same adapter instance and runs them in one immediate native transaction. Any middle failure rolls back all prior statements and returns no partial array.
- Migration names must match `^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$`, be bytewise strictly increasing and unique, and all names are validated before mutation. Each supplied SQL body runs unchanged in one immediate transaction. The adapter has no ledger; the Application Service must pass only the not-yet-applied set.
- Open order is constructor → `key(Buffer)` → `defaultSafeIntegers(true)` → `SELECT COUNT(*) FROM sqlite_schema` probe → `foreign_keys=ON` → require `journal_mode=WAL`. Before close, tests require both WAL and SHM files and scan them for the sentinel; after close they scan the main DB header and all remaining bytes.
- Package version is exact `13.0.3`; no caret/range and no substitute cipher library.
- Windows evidence fields are exactly `schemaVersion`, `platform`, `arch`, `electron`, `napi`, `encryptedHeaderAbsent`, `plaintextSentinelAbsent`, `walInspected`, `shmInspected`, `wrongKeyRejected`, `reopenRead`, `migration0045`, and `cleanup`. All booleans must be true; the file is written only after success and contains no path, key, SQL, native error, or sentinel.

---

### Task 1: Share the existing Database fixture

**Files:**
- Create: `apps/api/test/support/database-contract.ts`
- Modify: `apps/api/test/database-contract.test.ts`
- Modify: `scripts/test-suite.mjs`, `scripts/test-suite.test.mjs`

- [x] Extract the seven consumer-observable tests into `defineDatabaseContract(name, openDatabase: () => Promise<Database>)` without weakening assertions; add the previously missing `missingColumn.kind='syntax'` assertion.
- [x] Keep D1-only native pass-through and gateway assignability tests in `database-contract.test.ts`.
- [x] Add dispatcher entries `pnpm test:contracts --db=d1` and `--db=sqlite`; keep existing `--database` as the D1 alias.
- [x] Run D1 contract first; GREEN 9/9.

### Task 2: RED encrypted SQLite contract

**Files:**
- Create: `apps/api/test/sqlite-database.contract.test.ts`

- [x] Call `openEncryptedSqlite({ filename, key, fileMustExist? })` from the shared Database fixture; RED was unresolved `@ccc/db-sqlite`.
- [x] Add create/close/reopen persistence, wrong-key and input rejection, copied caller key, DB/WAL/SHM plaintext scans, migrations 0001-0045, unsafe integers, foreign-owner batch, and middle-batch rollback assertions.
- [x] Run `pnpm test:contracts --db=sqlite`; RED before implementation, GREEN 11/11 after implementation.

### Task 3: Implement the minimal adapter

**Files:**
- Create: `adapters/db-sqlite/package.json`
- Create: `adapters/db-sqlite/src/index.ts`, `adapters/db-sqlite/src/native.d.ts`
- Create: `adapters/db-sqlite/tsconfig.build.json`
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/guard-db-gateway.mjs`

**Interfaces:**

```ts
export interface SqliteMigration { name: string; sql: string }
export interface EncryptedSqliteOptions {
  filename: string;
  key: Uint8Array;
  fileMustExist?: boolean;
  timeoutMs?: number;
}
export interface EncryptedSqliteDatabase extends Database {
  applyMigrations(migrations: readonly SqliteMigration[]): void;
  close(): void;
}
export function openEncryptedSqlite(options: EncryptedSqliteOptions): EncryptedSqliteDatabase;
```

- [x] Add exact native dependency `better-sqlite3-multiple-ciphers: 13.0.3`; explicitly disable its implicit pnpm build because the provenance-pinned package bundles Node-API platform prebuilds.
- [x] Implement immutable prepared bindings, owned byte conversion, safe integer normalization, D1-compatible results, exact native bind-arity classification, and redacted errors.
- [x] Open/key/probe the database, zero the copied key, require `foreign_keys=ON` and `journal_mode=WAL`, and expose idempotent redacted `close()`.
- [x] Validate all migration identities before mutation; execute each supplied SQL body unchanged in one transaction and document Application Service ledger ownership.
- [x] Run SQLite contract 11/11 and D1 contract 9/9.

### Task 4: Windows x64 Electron 44 runtime proof

**Files:**
- Create: `adapters/db-sqlite/test/electron-smoke.mjs`
- Create: `.github/workflows/sqlite-windows.yml`

- [x] Build the adapter to ESM `dist/`; configure `windows-2022` / Node 24 to run the contract directly, then launch `npm exec --yes --package=electron@44.1.1 -- electron ...`.
- [x] Generate random keys in memory; create an encrypted DB, apply all migrations, write a sentinel, inspect live WAL/SHM, close and inspect DB bytes, require wrong-key `kind='unsupported'`, reopen/read, zero keys, and remove temp data.
- [x] Configure boolean/version/platform-only evidence and `app.exit(1)` on any failure.
- [x] Run `33910770634` `electron44-windows-x64` passed in 1m30s and uploaded evidence: win32/x64, Electron 44.1.1, N-API 10, encrypted header absent, DB/WAL/SHM sentinel absent, wrong key rejected, correct-key reopen/read, migration 0045 present, cleanup true.

### Task 5: Verification and delivery

- [x] Run D1 9/9, SQLite 11/11, API 58 files/720 tests, adapter build, script tests 18, typecheck, DB/core-import/doc-number guards, `actionlint`, `release:verify` (569 SBOM dependencies), staged `guard:secrets`, and `git diff --cached --check`.
- [x] Independent security review found Windows portability and evidence gaps; applied portable file URLs, direct Windows Vitest invocation, live WAL/SHM scans, redacted close, exact wrong-key classification, hard failure exit, filename/arity guards, one-prepare batch writes, action version alignment, and stronger contract assertions. Focused re-review found no remaining blocker.
- [x] Commit and push `e3-1b-encrypted-sqlite`; open PR #273 linked to Linear CCC-220. Normal CI and `sqlite-windows` both passed.
