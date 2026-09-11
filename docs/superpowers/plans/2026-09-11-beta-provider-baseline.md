# Beta Provider Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a beta-only signed Supabase provider baseline that lets the existing S11 read-only plan approve exact provider-managed objects and grants without weakening the clean-project gate.

**Architecture:** Add one deep installer-only module for trust and baseline verification, one module that produces stable catalog inventory, and one explicit baseline generator. `bootstrap.mjs` verifies the two private signed documents before Management API access, then `plan.mjs` compares two live inventories exactly. The S2 public manifest remains unchanged, business runtime bindings remain allowlisted, and DB apply remains blocked.

**Tech Stack:** Node.js 24, Ed25519, RFC 8785 JCS, PostgreSQL 17 catalogs, postgres.js 3.4.9, Supabase Management API read-only query endpoint, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-11-beta-provider-baseline-design.md`

## Global Constraints

- `BetaTrustRootV1` and `SupabaseProviderBaselineV1` are closed exact JSON objects, duplicate-key rejecting, UTF-8 and at most 1 MiB each.
- The development trust is valid only for `profile='development'`, `channel='beta'`, `provider='supabase'`, the signed Relayer project/owner, `ap-northeast-2`, and at most 30 days.
- External `CCC_BETA_TRUST_ROOT_KEYS` is the only root of trust. Signed documents cannot add or replace root keys.
- Signatures use Ed25519 over the specified ASCII domain prefix plus RFC 8785 JCS UTF-8. Public keys are canonical standard Base64 44 characters; signatures are canonical standard Base64 88 characters.
- `objects` has at most 5,000 records, `grants` at most 20,000 records, and each record string at most 1,024 UTF-8 bytes.
- OIDs and row data never enter the durable baseline. Object identity uses stable schema/name/type/arguments/definition hashes.
- Any extra, missing or changed object/grant fails `PROVIDER_BASELINE_MISMATCH`. There is no schema-name allowlist fallback.
- S2 and `packages/contracts` remain unchanged. The baseline and beta trust never enter browser responses.
- No task in this plan applies a DB migration, creates the journal, creates `ccc_api`, deploys Azure, invites Auth users, or activates AI/STT.
- Actual baseline generation requires business tables/rows, Auth users, buckets and Storage objects all to remain exactly zero.
- Korean docs and comments do not use the long dash character.

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/supabase/provider-baseline.mjs` | Parse, verify and compare the two signed installer-only objects. No network or filesystem mutation. |
| `scripts/supabase/provider-baseline.test.mjs` | Closed-schema, crypto, binding, size, ordering and mismatch contracts. |
| `scripts/supabase/provider-inventory.mjs` | PostgreSQL catalog query, stable record normalization and inventory hashes. |
| `scripts/supabase/provider-inventory.test.mjs` | Stable identity, sorting, duplicate and catalog-shape contracts. |
| `scripts/supabase/provider-baseline-generate.mjs` | Explicit read-only generator. Verifies official-source review, observes twice, signs, and atomically writes two owner-only files. |
| `scripts/supabase/provider-baseline-generate.test.mjs` | Generator no-write-on-failure, two-observation and source-evidence contracts. |
| `scripts/supabase/manifest-preflight.mjs` | Export the existing bounded duplicate-key JSON reader instead of duplicating it. |
| `scripts/supabase/hosted-inspector.mjs` | Add exact inventory observation while preserving existing count and redaction paths. |
| `scripts/supabase/plan.mjs` | Bind exact baseline to plan/state/resource fingerprints and fresh/resumed cleanliness checks. |
| `scripts/supabase/plan.test.mjs` | Baseline success and fail-closed plan/doctor scenarios. |
| `scripts/supabase/bootstrap.mjs` | Load external beta trust inputs, verify before provider access, pass verified baseline to plan/doctor. |
| `scripts/supabase/bootstrap.test.mjs` | CLI input, ordering and redacted output contracts. |
| `apps/community-cloud/src/main.ts` | Reject every beta private document/key binding before DB creation and listen. |
| `apps/community-cloud/test/installer-private-key.test.mjs` | Empty and populated forbidden-binding startup denials. |
| `apps/community-cloud/RUN.md` | Exact private input names, read-only command and non-goals. |
| `artifacts/beta-0.9/2026-09-11-provider-source-review.json` | Value-free official source mapping and aggregate hashes. Created only after every record maps. |
| `artifacts/beta-0.9/2026-09-11-provider-baseline-plan.json` | Redacted live plan evidence. Never contains signed document bodies or keys. |

---

### Task 1: Closed Beta Trust and Baseline Verification

**Files:**
- Create: `scripts/supabase/provider-baseline.mjs`
- Create: `scripts/supabase/provider-baseline.test.mjs`
- Modify: `scripts/supabase/manifest-preflight.mjs:113-137`

**Interfaces:**
- Consumes: `readStrictJsonDocument(input)` exported from `manifest-preflight.mjs`; `canonicalizeJcs` from the built Community Cloud verifier.
- Produces:

```js
export const BETA_TRUST_DOMAIN = 'CCC-BETA-TRUST-ROOT-V1\0';
export const PROVIDER_BASELINE_DOMAIN = 'CCC-SUPABASE-PROVIDER-BASELINE-V1\0';
export async function requireProviderBaseline({
  releaseTrust, providerBaseline, rootKeys, revokedRootKeyIds,
  authorization, manifestExpiresAt, now = new Date(), verifier,
})
// => frozen {
//   baselineVersion, projectRefSha256, ownerOrgIdSha256, region,
//   databaseVersion, objects, grants, objectInventorySha256,
//   grantInventorySha256, baselineSha256, releaseTrustSha256, expiresAt
// }

export function compareProviderInventory(verifiedBaseline, observedInventory)
// => { matched: boolean, code: null | 'PROVIDER_BASELINE_MISMATCH',
//      expectedObjectCount, observedObjectCount, expectedGrantCount, observedGrantCount }
```

- [ ] **Step 1: Export the existing strict document reader**

Rename the private `documentInput` function to `readStrictJsonDocument`, export it, and update the two existing calls inside `requireSignedOwnerPreflight`. Do not change its 1 MiB bound, local-file handling, duplicate-key parser, or error normalization.

```js
export async function readStrictJsonDocument(input) {
  // Existing documentInput body, unchanged.
}
```

- [ ] **Step 2: Write failing closed-schema and trust-root tests**

Use generated Ed25519 keys and fixed `NOW`. The first test must prove that a valid root-signed release trust and release-signed baseline returns the frozen verification result. The negative table must cover unknown field, duplicate JSON key, `stable`, `formal`, wrong project/owner/region, unknown/revoked root, changed release public key, future `notBefore`, expired document, lifetime over 30 days, baseline expiry beyond trust/S2/approval, noncanonical Base64, and bad signature.

```js
test('valid beta root delegation verifies one exact provider baseline', async () => {
  const fixture = await signedBaselineFixture();
  const verified = await requireProviderBaseline(fixture.inputs);
  assert.equal(verified.baselineVersion, 'supabase-hosted-pg17-20260911-v1');
  assert.equal(verified.objects.length, 2);
  assert.equal(verified.grants.length, 1);
  assert.ok(Object.isFrozen(verified));
});
```

Run:

```bash
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/provider-baseline.test.mjs
```

Expected: FAIL because `provider-baseline.mjs` does not exist.

- [ ] **Step 3: Implement the minimum parser and verifier**

Use constant exact-key arrays for every object shape. Reject arrays that are unsorted by `canonicalizeJcs(record)`, duplicated, above count bounds, or contain strings over the UTF-8 byte limit. Verify external root key shape before importing it. Verify release trust first, then use only its `releasePublicKey` for the baseline signature.

```js
async function verifyDomainSignature(unsigned, signature, publicKey, domain, verifier) {
  const message = Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(verifier.canonicalizeJcs(unsigned), 'utf8'),
  ]);
  return verifier.verifyEd25519Bytes(message, signature, publicKey);
}
```

If the current built verifier lacks `verifyEd25519Bytes`, add that narrow exported primitive in `apps/community-cloud/src/install-manifest-verifier.ts` and keep existing `verifyJcsEd25519Signature` behavior unchanged.

- [ ] **Step 4: Write failing inventory comparison tests**

Assert exact array equality and both aggregate hashes. One extra object, one missing object, definition hash drift, owner drift, grantor/grantee drift, `grantable` drift, and changed ordering must return `PROVIDER_BASELINE_MISMATCH`. Never return record names from the comparison result.

- [ ] **Step 5: Run Task 1 tests and existing authorization tests**

```bash
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/provider-baseline.test.mjs scripts/supabase/install-authorization.test.mjs
```

Expected: all tests pass with no network access.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/supabase/provider-baseline.mjs scripts/supabase/provider-baseline.test.mjs scripts/supabase/manifest-preflight.mjs apps/community-cloud/src/install-manifest-verifier.ts
git commit -m "feat(supabase): verify beta provider baseline trust"
```

Only add `install-manifest-verifier.ts` if Step 3 required the byte-verification export.

---

### Task 2: Stable Provider Catalog Inventory

**Files:**
- Create: `scripts/supabase/provider-inventory.mjs`
- Create: `scripts/supabase/provider-inventory.test.mjs`
- Modify: `scripts/supabase/hosted-inspector.mjs:7-449,535-585,646-723`
- Test: `scripts/supabase/bootstrap.test.mjs`

**Interfaces:**
- Consumes: Management API `database/query/read-only` callback already owned by `createHostedInspector`.
- Produces:

```js
export const PROVIDER_INVENTORY_QUERY;
export function normalizeProviderInventory(row)
// => frozen { objects, grants, objectInventorySha256, grantInventorySha256 }

export function providerInventoryFingerprint(inventory)
// => { objectInventorySha256, grantInventorySha256 }
```

- [ ] **Step 1: Write failing normalization tests**

Create synthetic rows for schema, relation, routine, type and catalog object plus schema, relation, column, default and role grant. Assert that OIDs are ignored, stable fields remain, records sort by canonical JSON, definition bodies become SHA-256, and duplicate stable identities fail `PROVIDER_UNREADABLE`.

```js
test('normalizes provider catalogs without persisting OIDs or definitions', () => {
  const inventory = normalizeProviderInventory(rawProviderRows());
  assert.equal(JSON.stringify(inventory).includes('object_oid'), false);
  assert.equal(JSON.stringify(inventory).includes('CREATE FUNCTION'), false);
  assert.match(inventory.objects[0].definitionSha256, /^[0-9a-f]{64}$/);
});
```

Run:

```bash
node --test scripts/supabase/provider-inventory.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement a separate read-only inventory query**

Do not weaken or delete `DATABASE_STATE_QUERY`. `PROVIDER_INVENTORY_QUERY` must reuse the same `non_system_namespace`, extension membership and `pg_init_privs` predicates, but return exact records for the objects and grants currently counted as unowned/unexpected.

For each object, query only stable identity inputs:

```sql
SELECT object_kind,
       namespace_name,
       object_identity,
       owner_name,
       definition_text,
       provenance
FROM provider_object_inventory
ORDER BY object_kind, namespace_name, object_identity;
```

Build `object_identity` with `pg_identify_object` or `pg_get_function_identity_arguments`, not OIDs. Use `pg_get_viewdef`, `pg_get_functiondef`, `pg_get_indexdef`, constraint definitions and stable catalog attributes where relevant. Return definition text only to the local normalizer, which hashes and discards it before the snapshot leaves `createHostedInspector`.

For each grant, retain grant kind, stable object identity, grantor, grantee, privilege and `is_grantable`. Do not collapse default privileges or role membership into an opaque count.

- [ ] **Step 3: Integrate inventory into hosted observation**

Call `readOnlyQuery(PROVIDER_INVENTORY_QUERY)` in the same `inspect()` pass as `DATABASE_STATE_QUERY`. Normalize before returning. Add only these fields to the internal snapshot:

```js
providerInventory: {
  objects,
  grants,
  objectInventorySha256,
  grantInventorySha256,
}
```

Do not include arrays in public plan/doctor output. Keep the existing count validation and ensure the inventory lengths equal `unowned_object_count` and `unexpected_grant_count`; mismatch is `PROVIDER_UNREADABLE`.

- [ ] **Step 4: Prove hidden provider objects and grants remain observable**

Extend the hosted inspector fixture tests with:

- one table under `extensions`
- one routine under `auth`
- one standalone type under a provider-looking schema
- one default `SELECT` grant to an unrelated role
- one role membership

Each must appear as one stable record and increment the matching count. Provider-looking names alone must not change provenance to trusted.

- [ ] **Step 5: Run Task 2 tests**

```bash
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/provider-inventory.test.mjs scripts/supabase/bootstrap.test.mjs
```

Expected: all tests pass. Output fixtures contain no row data or credentials.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/supabase/provider-inventory.mjs scripts/supabase/provider-inventory.test.mjs scripts/supabase/hosted-inspector.mjs scripts/supabase/bootstrap.test.mjs
git commit -m "feat(supabase): observe exact provider inventory"
```

---

### Task 3: Read-Only Baseline Generator and Source Evidence Gate

**Files:**
- Create: `scripts/supabase/provider-baseline-generate.mjs`
- Create: `scripts/supabase/provider-baseline-generate.test.mjs`
- Modify: `apps/community-cloud/RUN.md`

**Interfaces:**
- Consumes: verified S11 owner authorization, verified `BetaTrustRootV1`, two `createHostedInspector().inspect()` snapshots, a strict source-evidence JSON file, and beta root/release private keys from process memory.
- Produces:

```js
export async function generateProviderBaseline({
  authorization, releaseTrustUnsigned, rootPrivateKey, releasePrivateKey,
  rootKeys, revokedRootKeyIds, sourceEvidenceInput, inspector, now, outputPaths,
})
// => { releaseTrustSha256, baselineSha256, baselineVersion,
//      objectCount, grantCount, sourceEvidenceSha256 }
```

The function writes two owner-only files only after all checks pass. The CLI prints only the returned hashes, counts and baselineVersion.

- [ ] **Step 1: Write failing source-evidence and no-partial-file tests**

The strict source evidence shape is:

```ts
type ProviderSourceEvidenceV1 = {
  schemaVersion: 1;
  provider: 'supabase';
  sourceRevision: string; // exactly /^[0-9a-f]{40}$/
  databaseVersion: string; // exactly /^[0-9]+(?:\.[0-9]+)*$/
  records: Array<{
    kind: 'schema' | 'relation' | 'routine' | 'type' | 'catalog'
      | 'column' | 'default' | 'role';
    identitySha256: string; // 64 lowercase hexadecimal characters
    sourceUrl: 'https://github.com/supabase/supabase'
      | 'https://github.com/supabase/postgres';
    sourcePath: string; // normalized nonempty relative path
    sourceSha256: string; // 64 lowercase hexadecimal characters
  }>;
};
```

Tests must reject a missing mapping, duplicate mapping, non-GitHub origin, moving branch URL, wrong source hash, DB version mismatch, first/second inventory change, nonempty business state, and existing output file. Assert output paths do not exist after every failure.

- [ ] **Step 2: Implement source evidence validation**

Every `provenance='supabase_managed'` object and grant must map one-to-one by `identitySha256`. Extension and initial-privilege records do not require a manual mapping because PostgreSQL supplies their provenance. Fetch no source in this module; the evidence file contains already downloaded and SHA-256-checked source facts. This keeps generation deterministic and reviewable.

- [ ] **Step 3: Implement two-observation signing and atomic output**

Verify owner authorization and beta root before calling `inspector.inspect()`. Require exact equality of the two inventory hashes and all empty-business counters. Build and sign `BetaTrustRootV1`, then build and sign `SupabaseProviderBaselineV1`. Write temporary files with mode `0600`, `fsync`, no-follow checks and atomic rename with `wx` semantics. Never overwrite a prior trust or baseline.

The CLI accepts only:

```text
node scripts/supabase/provider-baseline-generate.mjs \
  --source-evidence artifacts/beta-0.9/2026-09-11-provider-source-review.json \
  --release-trust-output /tmp/relayer-beta-release-trust-20260911.json \
  --baseline-output /tmp/relayer-provider-baseline-20260911.json
```

Project, owner, keys and signed S11 documents come from the approved environment. No URL, project, owner or key command-line overrides are allowed.

- [ ] **Step 4: Add redacted CLI tests**

Capture stdout/stderr with synthetic key-like values. Assert the output contains only baselineVersion, counts and hashes and does not contain URLs, project refs, object/grant names, public/private keys, signatures, connection strings or bearer-like text.

- [ ] **Step 5: Run Task 3 tests**

```bash
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/provider-baseline-generate.test.mjs scripts/supabase/provider-baseline.test.mjs
```

Expected: all tests pass with fake inspectors and no network.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/supabase/provider-baseline-generate.mjs scripts/supabase/provider-baseline-generate.test.mjs apps/community-cloud/RUN.md
git commit -m "feat(supabase): generate beta provider baselines"
```

---

### Task 4: Bind Exact Baseline into Plan, Doctor and Runtime Isolation

**Files:**
- Modify: `scripts/supabase/bootstrap.mjs:11-66,122-177`
- Modify: `scripts/supabase/plan.mjs:43-159,191-228,348-493`
- Modify: `scripts/supabase/plan.test.mjs`
- Modify: `scripts/supabase/bootstrap.test.mjs`
- Modify: `apps/community-cloud/src/main.ts:19-33`
- Modify: `apps/community-cloud/test/installer-private-key.test.mjs`

**Interfaces:**
- Consumes: `requireProviderBaseline(...)` result and `snapshot.providerInventory` from Tasks 1 and 2.
- Produces: `buildSupabasePlan({ target, inspector, authorization, providerBaseline, renewAuthorization })` and doctor with redacted baseline evidence.

- [ ] **Step 1: Write failing plan tests before integration**

Add one exact baseline success fixture with provider counts `101` and `903`. It must return `ready=true` while business counters remain zero. Add failures for absent baseline, bad baseline signature, extra/missing record, inventory hash drift between observations, DB version mismatch and valid baseline plus one business table/user/bucket.

```js
test('exact signed provider baseline approves only managed inventory', async () => {
  const observed = snapshotWithProviderInventory(providerFixture());
  const result = await buildSupabasePlan({
    target: 'hosted', authorization: observationAuthorization(),
    providerBaseline: verifiedProviderFixture(),
    inspector: inspector(observed, observed),
  });
  assert.equal(result.ready, true);
  assert.equal(result.providerBaseline.matched, true);
  assert.equal(result.observed.userTableCount, 0);
});
```

Run:

```bash
node --test --test-name-pattern="provider baseline" scripts/supabase/plan.test.mjs
```

Expected: FAIL because plan ignores `providerBaseline`.

- [ ] **Step 2: Verify baseline before provider access in bootstrap**

Load these installer-only inputs:

- `CCC_BETA_TRUST_ROOT_KEYS`
- `CCC_BETA_REVOKED_ROOT_KEY_IDS`, default `[]`
- `CCC_BETA_RELEASE_TRUST`
- `CCC_PROVIDER_BASELINE`

Call `requireSignedOwnerPreflight` first, then `requireProviderBaseline`, then construct `createHostedInspector`. A malformed or expired beta input must stop before `SUPABASE_ACCESS_TOKEN` consumption or any fetch. Keep local plan behavior unchanged.

Add exit codes and safe Korean messages for `BETA_TRUST_INVALID`, `PROVIDER_BASELINE_INVALID`, and `PROVIDER_BASELINE_MISMATCH`. Do not put object/grant names in recovery text.

- [ ] **Step 3: Make baseline part of plan identity**

Add exact comparison before fresh/resumed cleanliness. A valid baseline may account only for `unownedObjectCount`, `unexpectedGrantCount`, `unknownObjectCount` and `customSchemaCount` records that are present in its exact arrays. It cannot exempt business tables/rows, Auth users, buckets, Storage objects, public routines/types, private installation tables, cron or unowned installation resources.

Include the following in `installationStateFingerprint`, `resourcesSha256` and `planFingerprint`:

```js
providerBaselineVersion: providerBaseline.baselineVersion,
providerBaselineSha256: providerBaseline.baselineSha256,
providerObjectsSha256: snapshot.providerInventory.objectInventorySha256,
providerGrantsSha256: snapshot.providerInventory.grantInventorySha256,
```

This binds journal resume and doctor drift checks without adding a DB column. A provider configuration change requires a new signed baseline and produces a different state/resource/plan fingerprint.

- [ ] **Step 4: Keep output redacted**

Public plan JSON may add only:

```js
providerBaseline: {
  matched: true,
  baselineVersion,
  expectedObjectCount,
  observedObjectCount,
  expectedGrantCount,
  observedGrantCount,
  objectInventorySha256,
  grantInventorySha256,
}
```

`assertSafeOutput` must still reject URLs, tokens and signed document bodies. Test that object/grant names and signatures never appear.

- [ ] **Step 5: Expand business runtime forbidden bindings**

Add all four private names from the spec to `PRIVILEGED_BINDINGS`. Extend the existing child-process startup test table so each name is tested both empty and populated. Assert DB initialization marker and listen marker remain false.

- [ ] **Step 6: Run Task 4 tests and regressions**

```bash
pnpm --filter @ccc/community-cloud build
node --test \
  scripts/supabase/provider-baseline.test.mjs \
  scripts/supabase/provider-inventory.test.mjs \
  scripts/supabase/provider-baseline-generate.test.mjs \
  scripts/supabase/install-authorization.test.mjs \
  scripts/supabase/plan.test.mjs \
  scripts/supabase/bootstrap.test.mjs \
  apps/community-cloud/test/installer-private-key.test.mjs
pnpm --filter @ccc/community-cloud typecheck
pnpm guard:migration-parity
```

Expected: all tests pass. Migration parity remains read-only and unchanged.

- [ ] **Step 7: Commit Task 4**

```bash
git add scripts/supabase/bootstrap.mjs scripts/supabase/plan.mjs scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs apps/community-cloud/src/main.ts apps/community-cloud/test/installer-private-key.test.mjs
git commit -m "feat(supabase): require exact beta provider baseline"
```

---

### Task 5: Review Official Sources, Issue Baseline and Re-run Live Plan

**Files:**
- Create: `artifacts/beta-0.9/2026-09-11-provider-source-review.json`
- Create: `artifacts/beta-0.9/2026-09-11-provider-baseline-plan.json`
- Modify: `docs/superpowers/plans/2026-09-10-cloud-beta-deploy-runbook.md`

**Interfaces:**
- Consumes: verified code from Tasks 1-4, actual Relayer S11 documents, Supabase official CA, in-memory Management API token, RELAYER SecretStore and pinned official source commits.
- Produces: `CCC_BETA_RELEASE_TRUST`, `CCC_PROVIDER_BASELINE`, public beta root map and revoked-root list in RELAYER prod plus two value-free repository artifacts.

- [ ] **Step 1: Re-run the pre-generation safety observation**

Use the existing approved `opsvc` and RELAYER Universal Auth procedure. Obtain the Supabase Management API token through the official browser ECDH flow and keep it in memory. Verify:

```text
project ref: wtbdqyedyimivdbgljcs
owner hash: c8db45a82b044761ec94b5feb2d5a1387ec5370ab301faec766dce9038c8df41
region: ap-northeast-2
business tables/rows: 0/0
Auth users: 0
Storage buckets/objects: 0/0
private installer tables: 0
```

A nonzero value stops Task 5. Do not delete or alter anything.

- [ ] **Step 2: Pin and review official Supabase sources**

Resolve immutable commits with `git ls-remote` for the official `supabase/supabase` and `supabase/postgres` repositories. Fetch only the files needed to map each `supabase_managed` identity. Compute every source file SHA-256. For each live record, write one source evidence row. If one record cannot be mapped to a pinned official source or PostgreSQL-supplied extension/init privilege, stop without generating keys or baseline.

The artifact contains only source provenance, counts and aggregate hashes. It must not contain database URLs, access tokens, signed documents, provider definitions, user data or keys.

- [ ] **Step 3: Generate beta root and release keys once**

Use Node Ed25519 in memory. Create these RELAYER prod SecretStore names only after source review passes:

- `CCC_BETA_ROOT_SIGNING_PRIVATE_KEY`
- `CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY`
- `CCC_BETA_TRUST_ROOT_KEYS`
- `CCC_BETA_REVOKED_ROOT_KEY_IDS` with exact value `[]`

The root map contains only the new beta root public key. Verify fresh injection by signing and verifying a fixed synthetic message, then discard in-memory key copies. Never print lengths, prefixes or values beyond public SHA-256 fingerprints.

- [ ] **Step 4: Generate and store the signed trust and baseline**

Run the generator with explicit temporary owner-only output paths. Verify both outputs again with `requireProviderBaseline`, then create:

- `CCC_BETA_RELEASE_TRUST`
- `CCC_PROVIDER_BASELINE`

in RELAYER prod. Fresh injection must reproduce the same baseline and trust SHA-256. Remove temporary signed files after successful storage and verification.

- [ ] **Step 5: Run the actual signed read-only plan**

Run through `apps/community-cloud/with-ca.sh` with the official Supabase CA and the newly obtained Management API token in child memory only:

```bash
node scripts/supabase/bootstrap.mjs plan --target hosted --format json
```

Required result:

```json
{
  "operation": "plan",
  "readOnly": true,
  "ready": true,
  "unchanged": true,
  "productionReady": false,
  "blockers": []
}
```

Also require `providerBaseline.matched=true`, expected/observed counts equal, both inventory hashes equal the signed baseline, and DB writes remain 0. Zero the Management API token immediately after the child exits.

- [ ] **Step 6: Persist only redacted evidence and update the runbook**

Write `2026-09-11-provider-baseline-plan.json` with source commit, public key fingerprints, signed document hashes, baselineVersion, counts, inventory hashes, plan hashes, read-only/unchanged/ready flags and `databaseWrites: 0`. Do not include document bodies, signatures, object/grant names, URLs containing credentials or token material.

Update the runbook to state that this is a development beta baseline, not S12 formal release trust and not DB apply approval.

- [ ] **Step 7: Run full verification**

```bash
pnpm run build
pnpm run typecheck
pnpm run test
node scripts/guard-db-gateway.mjs
node scripts/guard-core-imports.mjs
pnpm guard:migration-parity
node scripts/guard-secrets.mjs
```

Expected: every command exits 0. The live plan evidence is `ready=true`, but `apply` still exits with `RELEASE_PREREQUISITES_MISSING` until a separately approved S12 development release/backup implementation exists.

- [ ] **Step 8: Commit Task 5**

```bash
git add artifacts/beta-0.9/2026-09-11-provider-source-review.json artifacts/beta-0.9/2026-09-11-provider-baseline-plan.json docs/superpowers/plans/2026-09-10-cloud-beta-deploy-runbook.md
git commit -m "docs(beta): record signed provider baseline plan"
```

## Final Review Gate

After each task, request a fresh standards/spec review. Before Task 5, run a dedicated security review over Tasks 1-4. The review must specifically challenge self-trust, signature domain confusion, baseline auto-adoption, OID instability, record omission, grant omission, output leakage, runtime private-key binding and first/second observation races. Fix every critical or important finding before live generation.
