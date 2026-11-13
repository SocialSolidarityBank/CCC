# CCC-212 Browser API and Authentication Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline under the controller assignment. Do not delegate, commit, or modify product source.

**Goal:** Verify the pinned existing E2-3 browser API and authentication implementation against the complete approved contract and record defects without repairing source.

**Architecture:** Export commit `f7194dc88064455f3eb6be02abb5aae836981612` into a disposable runtime under `artifacts/ccc212-browser-auth/`, link only already-installed dependencies, and run test-only probes against unchanged validators, transports, consumers, release server, Community Cloud runtime, and the prior real synthetic Identity/gateway bridge pattern. Browser evidence uses a fresh isolated context and records only allowlisted booleans, status codes, counts, and hashes.

**Tech Stack:** TypeScript, Vitest, Bun, Deno, Chromium, existing React and Supabase client, existing Identity, D1 gateway, HTTP handler, Community Cloud runtime, install manifest validators.

**Spec:** `artifacts/orchestration/ccc212-browser-auth-request.json`, `CCC_OPEN_PILOT_PLAN.md` E2-3, `docs/specs/S2-auth-capability-manifest.md`

## Global Constraints

- Writes are limited to this plan, `artifacts/ccc212-browser-auth/**`, and `artifacts/orchestration/ccc212-browser-auth-result.json`.
- Product, frontend, design, shared contract, runtime, migration, controller, and Linear sources remain unchanged.
- No live providers or credentials, new dependencies, worktrees, agents, broad TLS bypass, deployment, commit, push, or next ticket.
- Preserve CCC-204 evidence byte-for-byte and stop every owned runtime.
- Distinguish fixture-authored headers from headers emitted by `apps/client/tools/serve-release.mjs` and `apps/community-cloud/src/runtime.ts`.

---

### Task 1: Freeze source and acceptance matrix

**Files:**
- Create: `artifacts/ccc212-browser-auth/harness/setup.mjs`
- Create: `artifacts/ccc212-browser-auth/source-pin.json`
- Create: `artifacts/ccc212-browser-auth/preservation-before.json`

- [ ] Verify pane, session, cwd, and branch from the controller request and live Herdr process metadata.
- [ ] Hash the pinned source worktree and all pre-existing orchestration files outside CCC-212 ownership.
- [ ] Export only commit-pinned source and link existing dependencies; record every imported source hash.

### Task 2: Error, DTO, transport, and bootstrap probes

**Files:**
- Create: `artifacts/ccc212-browser-auth/harness/audit.test.ts`
- Create: `artifacts/ccc212-browser-auth/harness/vitest.config.mjs`
- Create: `artifacts/ccc212-browser-auth/error-code-coverage.json`
- Create: `artifacts/ccc212-browser-auth/decoder-transport.json`
- Create: `artifacts/ccc212-browser-auth/bootstrap-allowlist.json`

- [ ] Map all 21 legacy `ApiErrorCode` values to actual `BusinessError` and consumer behavior, listing additions, missing codes, and semantic changes.
- [ ] Exercise canonical capability and representative business DTO decoders with valid, nullable or optional, malformed, and unauthorized/error responses.
- [ ] Exercise exact destination construction, Bearer attachment, no-store and omit credentials, no retry, cancellation, token change, capability binding, logout, and redacted errors.
- [ ] Exercise unchanged manifest, bootstrap, API/Auth origin, project-ref, publishable-key, installation-id, sequence, expiry, and URL rejection validators.

### Task 3: Browser storage and authentication lifecycle

**Files:**
- Create: `artifacts/ccc212-browser-auth/harness/browser-check.mjs`
- Create: `artifacts/ccc212-browser-auth/browser-storage-lifecycle.json`

- [ ] Start the bounded synthetic issuer and real Identity, D1 directory, HTTP handler, and gateway bridge with memory-only credentials.
- [ ] Observe wrong credentials, valid login, authenticated reads, reload, stale-session or logout transition, and reauthentication in a fresh browser context.
- [ ] Scan browser storage and static cache in runtime memory, persisting only counts, booleans, paths, and content hashes.

### Task 4: Actual runtime headers and Electron capability

**Files:**
- Create: `artifacts/ccc212-browser-auth/actual-headers.json`
- Create: `artifacts/ccc212-browser-auth/electron-origin.json`

- [ ] Build a signed release from the pinned snapshot and query the actual static release server for CSP and related headers.
- [ ] Invoke the actual Community Cloud runtime for trusted, untrusted, null, absent, and preflight Origin cases; compare exact CORS fields to S2.
- [ ] Locate and run an actual Electron runtime or existing real-runtime harness. If absent, record the exact missing package, entrypoint, and E7-2 ownership without substituting Chrome or source text.

### Task 5: Preservation, cleanup, and result

**Files:**
- Create: `artifacts/ccc212-browser-auth/preservation-after.json`
- Create: `artifacts/ccc212-browser-auth/cleanup.json`
- Create: `artifacts/orchestration/ccc212-browser-auth-result.json`

- [ ] Run the targeted pinned tests once, collect exit codes and sanitized evidence, and classify each acceptance criterion as passed, failed, or blocked.
- [ ] Stop owned services, remove the disposable snapshot and memory-only secret material, and prove owned job count is zero.
- [ ] Re-hash original source and pre-existing artifacts, record source defects with owners, hash all final evidence, and write the contracted result JSON.
