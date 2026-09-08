# CCC-221 RLS Default Deny Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Main owns integration and all validation after parallel edits settle.

**Goal:** Deny browser database access and isolate trusted API operations by transaction-local organization context without weakening gateway authorization.

**Architecture:** Add a forward PostgreSQL security migration after the five existing migrations. Keep the shared Database port unchanged. The PostgreSQL adapter exposes immutable actor-scoped Database views over one pool; every scoped operation establishes transaction-local context. A paired SQLite migration adds organization scope to the existing memory transaction-fence table, whose current schema lacks an organization column.

**Tech Stack:** Node 24, TypeScript, postgres 3.4.9, Vitest, existing pinned disposable PostgreSQL Docker harness, encrypted SQLite and Miniflare D1.

**Spec:** `docs/specs/S11-supabase-edge-template.md` §2.4-2.5, `docs/specs/S1-database-sql-subset.md`, `CCC_OPEN_PILOT_PLAN.md` E3-5, Linear CCC-221. User approved this scope in the current conversation. CCC-216 is Done and the ticket has no open blocker.

## Global Constraints

- Worktree `.worktrees/ccc-221-rls-default-deny`, branch `feat/ccc-221-rls-default-deny`, based on fetched `origin/main`.
- No hosted database changes, credentials acquisition, preview data mutations, merge or deployment in this implementation task.
- Use synthetic fixtures only. Never print connection strings, passwords, vendor errors or fixture SQL containing a password.
- Existing tests are not removed, skipped or weakened. Missing Docker is failure.
- The common Database interface stays prepare/bind/first/all/run/batch. No UnitOfWork, public begin/commit, SQL translator or new repository abstraction.
- `ccc_schema_owner` is NOLOGIN. `ccc_api` is LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, not a table owner or member of the owner role.
- `anon`, `authenticated` and PUBLIC receive no business-table access. Browser roles have no policies. Application functions remain SECURITY INVOKER; no SECURITY DEFINER workaround.
- Every public application table has RLS enabled. Context absence/empty context denies access. Tenant policies have both USING and WITH CHECK. Views must not bypass underlying RLS through owner privileges.
- Same-organization access still goes through existing gateway checks. RLS does not replace worker assignments or administrator read-only restrictions.
- PostgreSQL context is `app.org_id` and `app.actor_id`, established with bound `set_config(..., true)` on the same transaction/connection as the operation.
- Historical migrations remain immutable. New pair: SQLite `0050_rls_scope.sql`, PostgreSQL `0006_rls_default_deny.sql`. Old reserved platform numbers in specifications must be reconciled with the actual five-migration history, not reused.

## Ownership and Interface Contract

Two independent implementation slices can run concurrently after Main establishes baseline evidence. They skip tests, builds, linters and formatters during the concurrent edit batch. Main performs integration and verification.

- Schema owner: only `migrations/postgres/0006_rls_default_deny.sql`, `migrations/sqlite/0050_rls_scope.sql`, `apps/api/test/postgres-rls.security.test.ts`.
- Adapter owner: only `adapters/db-postgres/src/index.ts`, `apps/api/test/postgres-context.contract.test.ts`.
- Main: `packages/core/src/gateway.ts` memory-fence SQL, `apps/api/test/support/postgres.ts`, parity harness/manifest, suite dispatcher, documentation and final validation.

Adapter interface:

```ts
export interface PostgresActorContext {
  readonly orgId: string;
  readonly actorId: string;
}
export interface PostgresDatabase extends Database {
  forActor(context: PostgresActorContext): Database;
  close(): Promise<void>;
}
```

`forActor` copies and validates both nonempty identifiers. The returned value shares the root pool, not mutable actor state. Its prepared statements cannot be batched by another actor-scoped view or the root. Root close invalidates all views. Unscoped administrative fixture behavior, including CREATE DATABASE outside transactions, remains supported. Future trusted runtime composition supplies verified identity; this method is never an HTTP/browser capability.

Main adds this harness method for a real restricted API connection:

```ts
openApiDatabase(database: PostgresDatabase, maxConnections?: number): Promise<PostgresDatabase>;
```

It only opens a database already owned by this disposable harness, uses the actual `ccc_api` LOGIN role with a generated in-memory fixture password, and cleans up its pools. Browser-role tests use transaction-local SET ROLE on a disposable administrative fixture, matching the role switch used by PostgREST. Role creation for anon/authenticated belongs to the fixture, not to hosted Auth provisioning.

### Implementation rulings

- `auth_revocations` is live Identity state, not installation metadata. Actor events follow their `users` parent for reads and inserts. Opaque session events remain insert-only under nonempty organization and actor context; the current Identity API has no session-to-organization lookup and no session-event read consumer. API sessions cannot select these global events or update/delete revocations. This preserves current logout recording without inventing a privileged global reader. A future session-event reader must establish ownership before granting access.
- Preserve `ccc_audit_rowid` and `ccc_goal_revision_rowid` trigger names and explicit NULL-to-generated-ID behavior. Sequence defaults alone do not cover SQLite INTEGER PRIMARY KEY's explicit NULL case.
- The disposable harness accepts `openDatabase(maxConnections = 4)` so cleanup/interleaving proofs use exactly one physical pooled connection. Existing callers keep their previous behavior.
- The real two-organization registration smoke exposed a second global-read dependency: `allocateBeneficiaryId` searched other organizations' participant rows. The paired migration adds `beneficiary_id_counters(animal,last_value)`, containing no participant, actor or organization identifiers. Preserve the existing organization-local next number and three-attempt retry boundary: only after an actual primary-key collision does atomic UPSERT RETURNING skip through this shared metadata. Matching insert triggers advance counters for explicit imports. Browser and unscoped metadata access remain denied. Both initial registration and invite self-signup consume the same allocator. Existing pseudonym and historical migration tests remain unchanged.
- Table ownership does not itself grant schema USAGE. The NOLOGIN owner receives USAGE/CREATE for ownership transfers and owner-executed foreign-key checks; API receives USAGE only. The installer must own public schema, not merely hold its USAGE/CREATE grants. A real non-superuser schema-owner fixture proves browser denial and normal API writes; a grant-only installer is rejected atomically.
- Global default function privileges must be revoked as well as public-schema additions. PostgreSQL schema-local REVOKE cannot cancel its global PUBLIC EXECUTE default. Both the migration executor and dedicated schema owner are hardened, and new-helper fixtures prove the effective grants.
- Independent review exposed retained third-party/default grants and incomplete inbound-role checks. Six new assertions failed before remediation. Catalog-driven revocation now includes explicit column privileges and synthetic BYPASSRLS service grants; unexpected inbound/transitive membership fails atomically. Audit/goal-history UPDATE/DELETE grants are also revoked. PostgreSQL's MEMBER check was measured as true even for ADMIN TRUE/SET FALSE/INHERIT FALSE, and that rejection is covered by a regression fixture.
- Security catalog evidence includes both public and private schemas; a temporary private-table grant mutant proves that private security objects are not silently omitted. Business logical parity remains the public schema. The RLS fixture applies all forward migrations and checks every business relation's ownership/protection.

## Task 1: Database Role and Policy Boundary

**Files:** new migration pair and `apps/api/test/postgres-rls.security.test.ts`.

- [x] Inventory every table and view from the five installed migrations. Direct tenant tables use `org_id`. Tables without it require explicit classification: child tables follow an RLS-protected parent; the historical cutover manifest is installation-only and unavailable to `ccc_api`.
- [x] Add `org_id TEXT NOT NULL DEFAULT ''` to `counseling_memory_guards` in both engines. Existing empty/legacy guard rows remain inaccessible through API RLS. Main updates every fence INSERT to supply its already-known organization. Do not give an unscoped guard table a permissive policy.
- [x] Create constrained owner/API roles without passwords in tracked SQL. Reject unsafe pre-existing role attributes/membership rather than silently broadening access. Revoke browser/PUBLIC table, sequence and application-function access. Grant only API operations needed by the current gateway and trigger call graph. No schema CREATE/TRUNCATE/TRIGGER privileges for API.
- [x] Transfer application object ownership to the NOLOGIN owner. Enable and preferably force RLS; ordinary API cannot disable it. Make public compatibility views security_invoker.
- [x] Scope `agent_job_result_acceptances` through its `agent_jobs` parent. Inventory and handle every additional parent-only table rather than assuming this is the sole exception.
- [x] Replace the existing max(id)+1 rowid allocation for audit and goal revisions with global sequences owned by the schema owner. RLS would otherwise make each organization allocate the same IDs. Seed from existing rows before enabling policies. Do not use a SECURITY DEFINER function to read across organizations. Preserve explicit-ID imports and document sequence advancement requirements if ordinary PostgreSQL explicit-ID behavior is retained.
- [x] Add meaningful fixtures for anonymous/authenticated denial, missing context, two-organizations SELECT/INSERT/UPDATE/DELETE boundaries, indirect child tables, views, immutable audit, role escalation denial and normal same-org gateway behavior. Prove multi-org audit allocation does not collide.

Example security assertions against real database operations:

```ts
expect(await api.forActor({ orgId: 'org-a', actorId: 'worker-a' })
  .prepare('SELECT org_id FROM organization_settings').all())
  .toMatchObject({ results: [{ org_id: 'org-a' }] });
await expect(api.forActor({ orgId: 'org-a', actorId: 'worker-a' })
  .prepare('INSERT INTO counseling_memory_guards(id,ok,org_id) VALUES(?,1,?)')
  .bind('cross-org-fence', 'org-b').run()).rejects.toThrow();
```

Do not pin raw PostgreSQL permission messages; the common error vocabulary has no authorization subtype and must not leak vendor text.

## Task 2: Immutable Transaction-Local Adapter Context

**Files:** adapter and `apps/api/test/postgres-context.contract.test.ts`.

- [x] Add the interface above. Preserve all existing safe-number, binary ownership, predicate normalization, error classification and atomic batch behavior.
- [x] Each scoped first/all/run opens one internal transaction, sets both GUCs using bound parameters and then runs the statement. Scoped batch sets context once for its entire existing transaction. No mutable global context, new pool per actor, or session-global SET.
- [x] Keep prepared-statement ownership per scoped view. Same actor identifiers in different views do not authorize cross-view batching. A binding created before the caller mutates its input context keeps the original organization.
- [x] Reject empty/invalid context without reflecting its content. Avoid logging context values or vendor errors.
- [x] Add focused real-DB tests selecting current_setting through first/all/run and batch; cover concurrent interleaving with maxConnections=1, rollback after a middle failure, unscoped observation after success/failure, foreign-scope statements and root close.

```ts
const context = { orgId: 'org-a', actorId: 'actor-a' };
const a = db.forActor(context);
context.orgId = 'org-b';
expect(await a.prepare("SELECT current_setting('app.org_id', true) AS org").first('org')).toBe('org-a');
```

## Task 3: Integrate Current Gateway and Parity

**Files:** `packages/core/src/gateway.ts`, `apps/api/test/support/postgres.ts`, `apps/api/test/support/migration-parity.ts`, `apps/api/test/migration-parity.test.ts`, `migrations/parity.yaml`, `scripts/test-suite.mjs`, relevant dispatcher tests/docs.

- [x] Add the restricted API connection helper without exposing connection strings. Existing openDatabase/applyMigration consumers remain unchanged.
- [x] Update every memory-fence INSERT with org_id from the same actor/work/material scope already used in its predicate. Keep bind arity, transaction order and cleanup unchanged. Use LSP references for affected exported functions before editing.
- [x] Extend checkpoint replay with the new logical pair. Include RLS flags, policies, grants, owners, view security options and relevant role attributes in physical security evidence. Plain data parity does not erase security differences. Ensure metadata collection remains available from privileged fixture connections.
- [x] Make future unprotected tables/views fail security coverage. Account explicitly for PostgreSQL sequence allocation and private security objects rather than dropping all private objects from security proof.
- [x] Register focused RLS/context tests through existing suite conventions; full API CI already discovers new tests. Do not add duplicate CI runs.
- [x] Generate parity only after all semantic assertions pass, then prove ordinary guard is read-only. Extend existing drift mutants to cover removing an RLS policy or changing grant/owner/security flags.

## Task 4: Verification and Delivery

Main runs validation after implementation edits settle:

```sh
pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/postgres-context.contract.test.ts apps/api/test/postgres-rls.security.test.ts --maxWorkers 1
pnpm guard:migration-parity
pnpm test:db-parity
pnpm test:contracts --db=postgres
pnpm test:contracts --db=sqlite
pnpm test:contracts --db=d1
pnpm typecheck
pnpm test:scripts
pnpm guard:sql-dialect
pnpm guard:db
pnpm guard:core-imports
pnpm guard:doc-numbers
pnpm --filter @ccc/api run test
```

- [x] Prove missing protection before applying the forward migration and passing protection after it, using actual server roles rather than schema-text assertions.
- [x] Run a standalone real restricted-API gateway smoke: two organizations, permitted record save/replay/read, nonassigned denial, cross-org isolation, audit rows and failed-batch rollback. No superuser substituted for the API role.
- [x] Obtain independent security/spec review and fix evidence-backed findings. Only claim what the real fixtures exercise.
- [x] After smoke proof, update existing operations/spec references, remove throwaway scripts, record actual evidence in Linear. Leave merge/deployment for an explicit later instruction. Linear remains In Progress pending integration; its newly required CCC-223 dependency matches the updated master plan.
