# E1-1 OpenAI 저장 차단 Implementation Plan

**Goal:** Ensure every OpenAI Responses API request emitted by the provider explicitly disables server-side storage.

**Scope:** Modify `apps/api/src/ai-provider.ts` request construction and the focused fake-fetcher assertion in `apps/api/test/routes.test.ts`. Preserve timeout, schema, transport, and error behavior.

## Tasks

- [x] Add `store: false` to the provider's Responses API JSON payload.
- [x] Assert the parsed outgoing request body contains exactly `store: false`.
- [x] Commit the implementation on the E1-1 branch.

## Verification

The parent worktree will run focused validation after parallel pilot tickets land. This ticket intentionally does not run validation commands while sibling worktrees are active.
