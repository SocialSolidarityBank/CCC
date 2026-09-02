# E2-1 Screen/API Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, offline verifier that compares the checked S3 screen/API map with the Next route tree, imported server actions, API client calls, request-handler endpoints, DTO wire keys/projections, actor boundaries, PII authorization, and explicitly declared current gaps.

**Architecture:** `scripts/verify-screen-api-map.mjs` will expose one async entry point, `verifyScreenApiMap({ rootDir, map, sourceRoot?, apiSourceRoot? })`. It will discover page entries and route handlers, walk parent layouts and import closures once per route, and compare observations against the machine-readable map. It returns a serializable report (`ok`, `summary`, `routes`, `errors`, `orphans`, `piiMatrix`, `gaps`, and `observed`) rather than performing network or runtime rendering.

**Tech Stack:** Node.js ESM, `node:fs/promises`, `node:path`, `node:test`; no new dependency and no root package-script change.

**Spec:** `docs/specs/S3-screen-api-map.md` (especially §§2.2–2.4, 3, 4.1–4.3, 5, and 8)

## Global Constraints

- The input route set is the 30 unique `routePattern` rows from `scripts/design/route-inventory.json`: 22 operating, 5 public, 2 redirects, and 1 `/kit` control route.
- Root layout shell calls/actions and `/admin` layout identity guard are inherited by descendants exactly once; public routes exclude the business shell.
- Endpoint identity is the exact request-handler method plus path; response objects use exact wire keys, and client projections are checked separately.
- `/` may declare `GET /me` only as its destination-selection prerequisite; other redirect rows have no rendered-screen API/DTO.
- Production public join is token-only; preview join is token plus `ccc_preview` preview Actor; public preview unlock starts with code/no Actor and produces the preview cookie; service Actor never satisfies a human PII row.
- Orphan endpoint/action rows and current contract observations remain named as `unmapped-by-current-page`/declared gaps; they are not counted as implemented screen coverage.
- The probe is deterministic and offline: no fetch, browser, Next runtime, database, or package installation.
- This ticket does not edit `package.json` or implement the verifier; the current commit intentionally remains RED.

---

### Task 1: Implement the verifier against the red contract

**Files:**
- Create: `scripts/verify-screen-api-map.mjs`
- Reference: `scripts/verify-screen-api-map.test.mjs`
- Reference: `scripts/fixtures/e2-1-screen-api-fixture.json`
- Reference: `docs/specs/S3-screen-api-map.md`

**Interfaces:**
- Consumes a parsed JSON map with `routes`, `inherited.root`, `inherited.admin`, `endpoints`, `pii`, and `gaps` fields. `routes` contain `routePattern`, `page`, `kind`, `pageApis`, `actions`, and optional `routeHandler` entries.
- Produces `verifyScreenApiMap(options)`, where `options.rootDir` is the source root and `options.map` is the checked map. Optional `sourceRoot` and `apiSourceRoot` default to the map values.
- Produces diagnostics with stable `error.code` values used by the red tests: `route-not-found`, `inherited-duplicate`, `page-api-missing`, `endpoint-wire-keys-mismatch`, `endpoint-projection-mismatch`, `endpoint-method-path-mismatch`, and `public-auth-leak`.

- [ ] **Step 1: Discover route/page and handler surfaces**

Enumerate `page.tsx` below `sourceRoot`, normalize bracket parameters to `:param`, and compare the observed unique set to the 30 map rows. Discover `preview/unlock/route.ts` separately, without adding it to the 30 page count. Emit `route-not-found` for an expected page absent from the tree and a distinct duplicate diagnostic for duplicate normalized route keys.

- [ ] **Step 2: Walk layout and import closures with deduplication**

For each page, walk `layout.tsx` ancestors and statically follow relative imports. Attach RootLayout's `GET /organization/profile` and `GET /participants/new-signup-count`, plus `toggleThemeAction` and `logoutAction`, once per route. Attach `GET /me` from `admin/layout.tsx` once to `/admin` descendants. Public rows must receive neither inherited business shell calls nor shell actions.

- [ ] **Step 3: Match page/action calls to endpoint catalog**

Extract API client calls from page/import closures and exported action calls from `actions.ts`/action imports. Include action prechecks and route-handler calls. Compare every observed method/path/DTO tuple with its route row and endpoint catalog; report page/action omissions and method/path mismatches rather than silently dropping calls.

- [ ] **Step 4: Validate wire keys and client projections**

Parse the request-handler response declarations and API client decoder/projection declarations. Compare required, optional, nullable, nested, and envelope keys as exact sets. Keep wire keys and projection keys as separate report fields so dropped/merged client fields are visible. Treat `/preview/unlock` API JSON `{token,maxAgeSeconds,expiresAt}` and web projection `{token,maxAgeSeconds}` as separate, explicit boundaries.

- [ ] **Step 5: Enforce redirect, credential, Actor, orphan, PII, and gap contracts**

Validate the `/` prerequisite exception and canonical schedule redirect. Reject Access/Bearer/`accessHeaders`/business-shell use on public rows, while preserving the production token-only versus preview-cookie-plus-preview-Actor distinction. Return the catalog's `unmapped-by-current-page` endpoint/action rows in `orphans`, copy the PII allowlist to `piiMatrix`, and return declared `gaps` unchanged with no inferred implementation status.

- [ ] **Step 6: Run the focused test and then the repository gates**

The red-stage command already recorded by this ticket is:

```bash
node --test scripts/verify-screen-api-map.test.mjs
```

Before implementation, it must fail immediately with `ERR_MODULE_NOT_FOUND` for `scripts/verify-screen-api-map.mjs`. After implementation, run this focused file first, then let the parent session run the repository-wide tests and any format/type checks once all sibling changes are present.

- [ ] **Step 7: Commit the green implementation separately**

```bash
git add scripts/verify-screen-api-map.mjs scripts/verify-screen-api-map.test.mjs scripts/fixtures/e2-1-screen-api-fixture.json docs/superpowers/plans/2026-09-03-E2-1-screen-api-probe.md
git commit -m "feat: add deterministic screen API probe"
```

The current E2-1 red commit contains only the plan, focused tests, and fixture data. It must not include the verifier implementation or a root `package.json` edit.

## Test Coverage Map

- `valid fixture finds all 30 routes...`: route total/subtotals plus one-time RootLayout/admin layout inheritance and public shell exclusion.
- `missing page entries...`: absent route, duplicate inherited edge, and omitted page API diagnostics.
- `endpoint method/path...`: independent exact method/path, wire-key, and projection failures.
- `redirect exceptions...`: explicit redirect allowlist plus public credential and Preview Actor surface distinctions.
- `orphan endpoints...`: orphan catalog preservation, PII matrix preservation, and declared-gap preservation without false implementation.
- `real-repository smoke...`: source-only real-repo discovery, 30 observed page routes, nonzero endpoint observation, and zero network requests.
