# E1-3 AudioStore Port and R2 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SG8's runtime-neutral `AudioStore` contract into `@ccc/contracts/runtime`, provide a streaming R2 reference adapter in `@ccc/audio-r2`, and inject that port into the request handler without exposing `R2Bucket` at the handler boundary.

**Architecture:** `packages/contracts/src/runtime.ts` owns the provider-neutral audio types and exact method signatures from SG8. `adapters/audio-r2` translates the Cloudflare R2 binding into that port: it validates opaque audio keys and metadata before storage, hashes while streaming, preserves stream backpressure, and records fresh R2 deletion evidence without exposing provider details. API composition supplies an `AudioStore` instance to the request handler; request-handler code never imports or types against `R2Bucket`.

**Tech Stack:** TypeScript ESM workspace packages, Cloudflare Workers `R2Bucket`, Web Streams API, Vitest, Web Crypto SHA-256.

**Spec:** `docs/specs/S8-audio-lifecycle-store.md` (especially §§2.1–2.3, §4, and fixtures A1–A5); `CCC_OPEN_PILOT_PLAN.md` E1-3 row.

## Global Constraints

- `AudioStore.put` accepts `ReadableStream<Uint8Array>` and returns `{ sha256: string }`; it must never require an `ArrayBuffer` body or buffer the complete object.
- Only `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/webm`, and `audio/x-m4a` are canonical content types. Header parameters may be inspected separately but cannot broaden the union.
- `contentLength` is an inclusive `1..209715200` byte declaration; short streams and overrun streams fail and never report successful storage.
- Keys are exactly `audio/<sessionId>/<uuid>`, with `[A-Za-z0-9_-]+` session IDs, lowercase canonical UUID final segments, and no traversal, encoded separators, alternate prefixes, or raw file paths.
- `get` returns metadata, an incremental-hash-compatible body stream, and nullable SHA-256; missing/unauthorized objects are `null`, and provider errors never expose raw provider messages, URLs, keys, or response bodies.
- R2 is a reference adapter, not the Community Cloud storage mode; both target methods return `null` and R2 direct absence evidence uses `head` (`r2-head-absent`).
- Deletion evidence contains key hash only, binds generation/attempt fields, distinguishes list, metadata/head, and direct-read absence, and never treats stale cached evidence as fresh proof.
- Request-handler composition accepts the `AudioStore` port and has no raw `R2Bucket` type or binding; only the adapter package may touch the R2 binding.
- E1-3 does not implement the SG8 lifecycle state machine, consent admission, Agent lease/claim, Supabase adapter, migrations, or retention/reconcile jobs; those belong to E5-6/E6-3 and later tickets.
- No external accounts or provider credentials are needed; all adapter tests use a faithful in-memory R2 double with stream, list, head, get, delete, metadata, and provider-error behavior.

---

### Task 1: Publish the runtime AudioStore port

**Files:**
- Create: `packages/contracts/src/runtime.ts`
- Modify: `packages/contracts/package.json`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `AudioContentType`, `AudioObjectMetadata`, `AudioDownload`, `AudioDeleteVerificationMethod`, `AudioDeletionEvidence`, and `AudioStore` exactly as specified in `docs/specs/S8-audio-lifecycle-store.md` §2.1.
- `@ccc/contracts` exports `./runtime`; API consumers can resolve the adapter's port dependency through the workspace.

- [ ] **Step 1: Define the six-value content-type union and metadata types.** Keep `contentLength`, `contentType`, and ISO UTC `expiresAt` in `AudioObjectMetadata`; add `body` and nullable `sha256` to `AudioDownload`.
- [ ] **Step 2: Define deletion evidence and the five `AudioStore` methods.** Preserve `ReadableStream<Uint8Array>`, nullable target returns, the default `expiresInSeconds = 600`, and all evidence fields without adding provider-specific types.
- [ ] **Step 3: Export `./runtime` from `packages/contracts/package.json` and keep the package dependency-free.**
- [ ] **Step 4: Add the workspace audio adapter dependency to `apps/api/package.json` so request-handler composition can receive the adapter at runtime.**

### Task 2: Implement the R2 reference adapter

**Files:**
- Create: `adapters/audio-r2/package.json`
- Create: `adapters/audio-r2/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `R2Bucket` and the `AudioStore` types from `@ccc/contracts/runtime`.
- Produces: `createR2AudioStore(bucket: R2Bucket): AudioStore`.
- `put(key, body, metadata)` validates key/MIME/declared length before calling R2, passes a stream into R2 with backpressure, rejects short/overrun streams, and returns a lowercase SHA-256 digest.
- `get(key)` returns a provider-neutral stream plus metadata or `null`; `createUploadTarget` and `createDownloadTarget` always return `null` for R2.
- `delete(key)` calls R2 deletion and performs fresh list/head/get absence checks, returning redacted, generation-bound evidence with `verificationMethod: 'r2-head-absent'`.

- [ ] **Step 1: Add the adapter package manifest and workspace dependency edge.** Export `./src/index.ts` as `@ccc/audio-r2` and depend only on `@ccc/contracts` and the existing Workers type surface.
- [ ] **Step 2: Implement key and metadata validation before storage.** Reject malformed keys, unsupported MIME values, zero/over-limit lengths, and non-finite/non-integer lengths without invoking `bucket.put`; never log or include the raw key in an error.
- [ ] **Step 3: Wrap the input stream in an incremental counting/hash transform.** Fail on early close or any byte beyond the declaration/max, propagate cancellation/errors, and pass the stream to R2 rather than an eagerly materialized body.
- [ ] **Step 4: Map R2 object metadata losslessly.** Preserve content type, declared content length, and upload authorization expiry using adapter metadata, and expose the R2 body stream directly so consumer backpressure and cancellation reach the provider stream.
- [ ] **Step 5: Implement idempotent deletion and fresh evidence.** Hash the UTF-8 key for `keyHash`, retain only opaque generation/etag data, independently calculate list/metadata/head/direct-read absence, and sanitize provider failures to a stable non-provider error shape.
- [ ] **Step 6: Return `null` from both on-demand target methods.** Do not mint signed URLs, embed storage keys in responses, or add Cloud/Supabase behavior to this reference adapter.

### Task 3: Compose the API with the port

**Files:**
- Modify: `apps/api/src/identity.ts`
- Modify: `apps/api/src/request-handler.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/support/local-worker.ts`
- Modify: `apps/api/test/audio.test.ts`

**Interfaces:**
- Consumes: `AudioStore` from `@ccc/contracts/runtime` and the R2 adapter from `@ccc/audio-r2` at the runtime factory boundary.
- Produces: request-handler composition that receives an `AudioStore`; raw `R2Bucket` is confined to the adapter/runtime wiring and is absent from API handler environment and function signatures.

- [ ] **Step 1: Replace direct R2 helper calls in upload and relay paths with `AudioStore.put`, `get`, and `delete`.** Preserve existing auth, consent, response redaction, and audit behavior while passing request streams through.
- [ ] **Step 2: Inject the store from the worker/runtime composition root and remove `AUDIO_BUCKET: R2Bucket` from handler-facing environment types.** Keep binding lookup in the adapter factory only.
- [ ] **Step 3: Update existing audio fixtures to construct the port-backed worker and assert stream responses, not provider object shapes.**
- [ ] **Step 4: Keep Community Cloud target/state-machine behavior out of this ticket; only the R2 reference null-target contract is wired here.**

### Task 4: Run focused contract verification and finish the cutover

**Files:**
- Modify: `apps/api/test/audio-store.contract.test.ts`
- Modify: `apps/api/test/audio.test.ts` (only assertions invalidated by port composition)

- [ ] **Step 1: Run the focused adapter and API tests.**

```bash
pnpm --filter @ccc/api exec vitest run test/audio-store.contract.test.ts test/audio.test.ts
```

Expected: all stream, validation, metadata, target, deletion-evidence, redaction, and handler-composition assertions pass.

- [ ] **Step 2: Run the API typecheck and inspect the import boundary.**

```bash
pnpm --filter @ccc/api run typecheck
```

Expected: `@ccc/contracts/runtime` and `@ccc/audio-r2` resolve, and no API handler source imports or types `R2Bucket`.

- [ ] **Step 3: Commit the complete E1-3 implementation.**

```bash
git add packages/contracts adapters/audio-r2 apps/api/src apps/api/test pnpm-lock.yaml
git commit -m "refactor(audio): extract AudioStore port and R2 adapter"
```

Expected: the commit contains only the runtime port, R2 adapter, composition cutover, and focused tests; lifecycle/migration/Supabase work remains for its owning tickets.

## Red-stage evidence from this ticket

The test-first commit intentionally contains the focused contract tests and workspace import edges before production `runtime.ts` or adapter source exists. The exact red command is:

```bash
pnpm --filter @ccc/api exec vitest run test/audio-store.contract.test.ts
```

Expected red result: Vitest fails during module resolution with missing `@ccc/contracts/runtime` and/or `@ccc/audio-r2` modules (or their missing exported APIs), rather than a syntax error, lockfile parse error, or assertion failure caused by malformed tests. No build, lint, formatter, or test command is run in the red-stage worktree; the parent session runs the red command after this commit and records the observed resolver output.
