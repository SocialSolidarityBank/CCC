# E4-1 Identity Port and Access Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Cloudflare Access authentication out of `packages/http-api` into an Identity adapter that returns the canonical S2 `Actor`, while preserving every existing route authorization result and adding the SQLite identity/revocation schema consumed by later Cloud, Office, Single, and Agent adapters.

**Architecture:** `adapters/identity-access` verifies Access JWTs and implements `Identity`. `packages/core` remains the only DB gateway and resolves a verified Access principal into a lossless canonical actor from `users`, active role assignments, team-supervisor grants, and actor revocations. `apps/api` composes the adapter and projects its canonical actor to the existing gateway actor immediately before `handleRequest`; this intentional migration boundary preserves current behavior without adding aliases or duplicate Access paths. Full gateway authorization migration is outside E4-1.

**Tech Stack:** TypeScript, Web Crypto RS256, Cloudflare Access, D1/SQLite, Vitest, pnpm workspaces.

**Spec:** `CCC_OPEN_PILOT_PLAN.md:285`, `docs/specs/S2-auth-capability-manifest.md` §2.1, §2.2, §2.4, §5; Linear CCC-227.

**Execution status:** Tasks 1-4 and local/remote verification are complete in this worktree. Unchecked boxes are the remaining review and PR delivery gates; checked boxes record observed evidence.

## Global Constraints

- Access JWT input remains `Cf-Access-Jwt-Assertion`, with temporary `X-CCC-Access-Jwt` service-binding fallback. Missing/malformed/signature/issuer/audience/time failure remains 401; verified but unregistered/inactive/revoked principal remains 403; unreadable JWKS, identity directory, or revocation storage becomes 503.
- `Identity.resolve(request)` returns only canonical `Actor`: no email, common_name, token, raw claim, or PII. Access human actors use `kind='human'`, `source='cloudflare-access'`, `assurance='none'`, `sessionId=null`. Transitional Access service principals use `kind='agent'`, `roles=['service']`, and S2's six Agent scopes.
- Role mapping is lossless and deduplicated by the active-role unique index: `institution_admin → institution-admin`, `institution_technical_admin → technical-admin`, active supervisor grant → `supervisor`, `practitioner → worker`, legacy service → `service`. Output order is institution admin, technical admin, supervisor, worker, service. A transitional service principal is recognized only when a verified `common_name` resolves to an active `users.role='service'` row.
- Compatibility projection precedence at the app boundary is service, institution admin, worker/supervisor, then 403. A technical-admin-only identity receives 403. Preview and local-dev resolvers remain their current environment adapters.
- `Identity.revokeAll` and `revokeSession` write only through gateway functions into append-only `auth_revocations`. Adapter code contains no SQL.
- Migration `0045_identity_revocation.sql` is the next free number per `docs/ops.md`. It rebuilds the five-table D74 identity component so `users.email` is nullable and `auth_subject` is partial-unique; all 36 referring triggers, rows, indexes, and foreign keys are preserved. It then adds `auth_revocations` and `agent_installations`.
- Rebuild order is: defer foreign keys; drop only the 36 triggers whose SQL names one of the five tables; create/copy `*_identity_next` tables in parent-first order; drop old tables leaf-first (`team_memberships`, `team_supervisor_grants`, `teams`, `user_role_assignments`, `users`); rename next tables parent-first; recreate eight indexes and all captured triggers. Any failed statement rolls the single `Database.batch` migration back.
- The preserved trigger inventory is generated and tested with `sqlite_schema WHERE type='trigger' AND (sql contains users, user_role_assignments, teams, team_memberships, or team_supervisor_grants)`, ordered by name; expected count is 36 and before/after `{name,sql}` must be identical. Preserved indexes are `idx_users_org`, `idx_user_role_assignments_role`, `uq_user_role_assignments_active`, `idx_teams_org`, `idx_team_memberships_user`, `uq_team_memberships_active`, `idx_team_supervisor_grants_supervisor`, and `uq_team_supervisor_grants_active`.
- Since 0045 is now taken, unstarted SQLite migrations in the master/specs shift only by filename: E3-8 consent 0045→0046 and E5-6 audio 0046→0047. PostgreSQL logical IDs remain unchanged.
- Do not implement Supabase JWT, Office credentials/MFA, Single bearer/DPAPI, Agent pairing, or session TTL here. Those remain E4-2/E4-3/E7/E6-4.

---

### Task 1: RED tests for the new adapter and schema

**Files:**
- Create: `apps/api/test/identity-access.contract.test.ts`
- Modify: `apps/api/test/access-jwt.test.ts`
- Modify: `scripts/test-suite.mjs`, `scripts/test-suite.test.mjs`

- [x] Point Access JWT imports at `@ccc/identity-access`; RED was an unresolved package.
- [x] Add direct `createAccessIdentity(env).resolve()` assertions for canonical counselor/admin/service shapes, no identity fields, revoked actor 403, and DB failure `IdentityStoreUnavailableError`.
- [x] Add migration assertions: nullable email, partial-unique auth_subject, all 36 identity-component triggers and linked rows preserved, append-only revocations, valid/invalid Agent installation binding, clean `PRAGMA foreign_key_check`.
- [x] Register `pnpm test:contracts --auth` to run both Access JWT and identity schema contract files; RED was missing adapter/migration.

### Task 2: SQLite identity and revocation migration

**Files:**
- Create: `migrations/sqlite/0045_identity_revocation.sql`
- Modify: `CCC_OPEN_PILOT_PLAN.md`, `docs/specs/S7-consent-six-domains.md`, and `docs/superpowers/plans/2026-09-03-SG7-consent-six-domains.md`. Search exact strings `0045_consent_six_domains` and `0046_audio_objects`; historical 2026-08-31 plans are not rewritten.

- [x] Rebuild `users`, `user_role_assignments`, `teams`, `team_memberships`, and `team_supervisor_grants` atomically with deferred foreign keys; make `users.email` nullable, add `auth_subject`, and recreate the exact 36 dependent triggers plus eight indexes.
- [x] Create append-only `auth_revocations`; create `agent_installations` with same-org active service-user insert guard, immutable identity fields, one-way revoke, and no delete.
- [x] Shift only unstarted future SQLite migration filenames 0045→0046 and 0046→0047; keep PostgreSQL 0003/0004 and `migrations/parity.yaml` unchanged.
- [x] Run the schema contract until GREEN (2/2).

### Task 3: Core identity directory and revocation gateway

**Files:**
- Modify: `packages/core/src/gateway.ts`
- Modify: `packages/contracts/src/runtime.ts`

- [x] Add `IdentityStoreUnavailableError` and the six `AGENT_SCOPES` to the shared runtime contract.
- [x] Add `resolveDirectoryActorByPrincipal(env, principal, authn, credentialIssuedAt)` and append-only `revokeActorSessions` / `revokeIdentitySession` gateway functions.
- [x] Query only active directory rows; reject credentials issued before actor revocation; map active roles and supervisor grants deterministically; never return the principal.
- [x] Wire user deactivation to append `admin-disable` actor revocation in the same batch; run core/gateway identity tests until GREEN.

### Task 4: Access adapter clean cutover

**Files:**
- Create: `adapters/identity-access/package.json`, `adapters/identity-access/src/index.ts`
- Move: `packages/http-api/src/access-jwt.ts` → `adapters/identity-access/src/access-jwt.ts`
- Modify: `packages/http-api/src/identity.ts`, `packages/http-api/src/request-handler.ts`, `packages/http-api/package.json`
- Modify: `apps/api/src/index.ts`, `apps/api/package.json`

- [x] Implement `createAccessIdentity(env): Identity`; catch directory/revocation read failures as `IdentityStoreUnavailableError`, but preserve 401 and 403 classifications.
- [x] Remove `actorFromRequest` and the Access JWT export from `@ccc/http-api`; no alias or re-export remains.
- [x] In `apps/api`, use the Access Identity by default and project canonical actor at the composition boundary. Preview/local resolver paths remain unchanged.
- [x] Map identity store failure to `{error:'service_unavailable'}` 503.
- [x] Run `pnpm test:contracts --auth` (29/29) and Access/local/preview/role/user regressions (41/41).

### Task 5: Verification and delivery

- [x] Run `pnpm test:contracts --auth` (29/29), identity migration tests, `pnpm --filter @ccc/api test` (57 files, 709 tests), `pnpm test:scripts` (17), `pnpm typecheck`, `pnpm guard:db`, `pnpm guard:core-imports`, `pnpm guard:doc-numbers`, and staged `pnpm guard:secrets`.
- [x] Run `pnpm --filter @ccc/api exec wrangler d1 migrations list ccc-preview --env preview --remote`; exactly `0045_identity_revocation.sql` is pending. It was not applied or deployed.
- [x] Independent security review confirmed the migration and identity boundary. Applied the blocking pre-revocation `iat` test plus fail-closed malformed timestamp, JWKS 503, contract-layer error, reactivation docs, migration-number collision, and index-preservation fixes.
- [x] Commit, push `e4-1-identity-access-adapter`, and open a review-ready PR linked to Linear CCC-227. Keep Linear In Review until merge.
