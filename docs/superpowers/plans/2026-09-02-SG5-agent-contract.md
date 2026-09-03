# SG5 처리 Agent 작업 계약 v2 Implementation Plan

> **For agentic workers:** This documentation ticket is complete in one pass. The parent session owns repository-wide validation after this branch is committed.

**Goal:** Publish the `확정` S5 contract for Agent claim, generation-bound audio verification, lease/heartbeat/release, result acceptance, privacy egress, queue fairness, retries, consent withdrawal, and access boundaries.

**Architecture:** `docs/specs/S5-agent-job-contract-v2.md` is the canonical contract for E5-1a. One atomic claim operation arbitrates audio and text work. A claim carries immutable lease and attestation references, audio is verified against its generation before Azure admission, and result/release uses compare-and-set with current consent and immutable qualification records.

**Tech Stack:** Markdown, TypeScript interface notation, JSON examples, API contract tables, synthetic contract fixtures.

**Spec:** `docs/specs/S5-agent-job-contract-v2.md`, grounded in ADR-0041 D76~D82, ADR-0042 D84, ADR-0036, D8, D13, D57, SG6, and SG8.

## Global Constraints

- The document status is `확정 (2026-09-03)` and means contract completeness only, not implementation evidence.
- The three formal modes are `community-cloud`, `local-single`, and `local-office`; all use the same API, transitions, consent checks, fairness, retry bound, and service access rules.
- Agent access is Bearer service authentication mapped to an active users-directory `service` actor and organization; human actors cannot use job endpoints and service actors cannot use business endpoints.
- Agents never open `Database`, `AudioStore`, provider SDKs, local files, bucket credentials, or database credentials directly.
- Cloud audio claim returns a protected API GET endpoint; a live claim GET mints or reissues a 10-minute Supabase private Storage signed URL. The URL is a bearer URL, not single-use or claim-bound, and is never logged. Both Local modes return an API backpressure stream.
- Lease duration is 15 minutes per heartbeat and at most `claimedAt + 2 hours`; when a real opportunity exists, SG8 applies `processing_deadline_at = min(first_agent_available_at + 24h, retention_hard_cap_at)`. `retention_hard_cap_at = uploaded_at + 7*24h UTC` always preempts and deletes, including administrator incident and manual-note fallback. Heartbeat is allowed only before expiry with the same claim token and attempt, and each job has exactly three consumed attempts.
- `POST /pipeline/jobs/:id/release` reports `transient|blocked|permanent`; each unblocked audio attempt calls its configured `STTProvider` (`local|azure`) at most once, text Agent provider calls are zero, and blocked NER health consumes no attempt. Only `engine_unavailable` is retryable.
- Consent withdrawal atomically CASes `pending|leased|blocked` to `cancelled`, clears claim credentials, and enqueues generation-bound deletion with reason `consent_withdrawal`. Result CAS contends on the same job row.
- `MaskedSource` and `ResultRequest` carry S6-owned masking/evidence fields plus `releaseQualificationReceiptId`; claim/start/result/egress load and validate the full immutable `NerReleaseQualificationReceipt`.
- v2 removes the generic 400 legacy-payload fallback, warning injection, v1 text-jobs/session source/complete service routes, and any automatic provider fallback.
- This branch changes only the canonical S5 spec and this ticket-local plan. No implementation files, sibling specs, `CCC_OPEN_PILOT_PLAN.md`, PR state, Linear state, or external policy files are changed.

---

### Task 1: Define v2 Agent interfaces and privacy references

**Files:**
- Create: `docs/specs/S5-agent-job-contract-v2.md`

**Interfaces:**
- Consumes: existing `PipelineJob`, `TextWorkItem`, `RecordingResultInput`, `ai_text_work_queue` lease fields, S6 masking metadata and receipt contract, and the v0.3 mode and secret boundaries.
- Produces: `ClaimRequest`, `AgentJob`, `ClaimResponse`, `HeartbeatRequest`, `HeartbeatResponse`, `ReleaseRequest`, `AudioVerifyRequest`, `AudioVerifyResponse`, `MaskedSource`, `AudioResult`, `TextResult`, `ResultRequest`, source/delivery types, discriminated Azure/OpenAI egress types, deletion enqueue type, and `JobError`.

- [ ] State `schemaVersion: 2`, `limit` range `2..50`, ISO-8601 timestamps, opaque IDs, untrusted `clientAssertedSha256`, post-verify `agentComputedSha256` and `rawAudioSha256`, generation binding, `terminalFailureCode`, and all fields of `NerReleaseQualificationReceipt` with server lookup and expiry/status.
- [ ] Make mask dictionary request `{claimToken,attempt}` and response `{dictionaryId,jobId,expiresAt,oneTime:true,entries:{field,sourceValue,replacement}[]}`; make it claim-bound, max five minutes, TLS/no-store, memory-only and audited.
- [ ] Preserve S6 fields in every success packet: `maskingPipelineVersion`, lower-case hex64 `maskingPipelineHash`, `nerAvailable: true`, `nerAttestationId`, lower-case hex64 `nerAttestationResultHash`, lower-case hex64 `evidenceHash`, evidence `sourceSha256`, and `releaseQualificationReceiptId`.
- [ ] Include all seven S6 fail-closed codes plus `audio_hash_mismatch`, `route_mismatch`, `engine_unavailable`, `lease_expired`, `stale_claim`, `audio_deleted`, `dictionary_already_consumed`, `result_conflict`, and `retry_exhausted` with exact HTTP mappings.

### Task 2: Specify lifecycle, CAS races, consent, release, retry, and fairness

**Files:**
- Modify: `docs/specs/S5-agent-job-contract-v2.md`

**Interfaces:**
- Consumes: Task 1 interfaces and SG8’s generation-bound deletion evidence boundary.
- Produces: atomic state-transition table and implementable queue arbitration rules for E5-1a.

- [ ] Define `pending → leased → succeeded|blocked|cancelled|expired|failed`, pending/blocked consent cancellation, audio verify/hash-mismatch transition, lease recovery, attempt increment, 15-minute heartbeat, 2-hour total lease ceiling, SG8 processing deadline and seven-day hard-cap preemption, and terminal-state immutability.
- [ ] Require compare-and-set on job, organization, claim token, attempt, generation, and receipt for claim, verify, heartbeat, release, recovery, consent withdrawal, egress, and result. Clear old lease owner/token/expiry on release, recovery, cancellation and preemption; split exact `lease_expired` from `stale_claim`.
- [ ] Make consent withdrawal deletion enqueue atomic with the state transition and require result CAS to contend on the same row, including blocked jobs.
- [ ] Require exactly one terminal operation (`result` or `release`) per live claim, Azure/local STT at-most-once for audio, zero Agent provider for text, core AIProvider counter outside this count, transient requeue through attempt 3, blocked NER release without attempt consumption, immediate `terminalFailureCode`, and no provider fallback.
- [ ] Reserve strict audio/text alternation by each queue’s `enqueuedAt, jobId` order, then fill remaining slots from the nonempty queue, so either queue cannot starve.

### Task 3: Specify generation verification, egress and access boundaries

**Files:**
- Modify: `docs/specs/S5-agent-job-contract-v2.md`

**Interfaces:**
- Consumes: ADR-0041 D76~D82, SG6’s NER and egress contract, SG8’s audio generation/retention contract, E5-1b, E6-3, and E6-4 ownership boundaries.
- Produces: caller matrix, v2 endpoint table, claim/generation-bound audio verify operation, discriminated Azure/OpenAI authorization lifecycle, protected Cloud GET, Local stream, and one-time mask dictionary rules.

- [ ] Allow only an authenticated service actor to claim, heartbeat, release, verify, receive source/audio or dictionary, authorize egress, call the configured `STTProvider` after `in_flight`, or submit results; people remain on business endpoints.
- [ ] Retire v1 `/pipeline/text-jobs/**` and `/sessions/:id/ai/source` from the service allowlist; use claim-bound no-store `GET /pipeline/jobs/:id/source` and unified result instead.
- [ ] Define audio verify as streamed re-hash bound to `generationId`, reject wrong generation before stream, atomically persist trusted `rawAudioSha256`, and route mismatch to SG8 `hash_mismatch`/`upload_abandoned` with no provider call.
- [ ] Define Azure/OpenAI egress tuple, server-derived consent revision, raw-token hashing, immutable `authorized|in_flight|completed|revoked|expired` states, replay-safe same-start response, and configured Azure adapter access only after `in_flight`.

### Task 4: Retire v1 fallback and record proof fixtures

**Files:**
- Modify: `docs/specs/S5-agent-job-contract-v2.md`
- Modify: `docs/superpowers/plans/2026-09-02-SG5-agent-contract.md`

- [ ] Explicitly retire generic 400 interpretation, `inject_legacy_warnings`, warning-text insertion, legacy payload resubmission, and independent v1 text queue calls.
- [ ] Define JCS payload SHA-256 idempotency, same-hash replay regardless of `resultId`, different-hash conflict, stale claim rejection, terminal failure code persistence, egress completion, and `approved_at` protection.
- [ ] Add eight synthetic fixtures covering concurrent claim, strict fairness sequence, verify/generation mismatch, heartbeat/release/expiry races, blocked consent withdrawal, idempotency/conflict, bounded retries by job kind, NER/receipt health recovery, delivery/access, and v1 structured-400 rejection.
- [ ] Give each fixture an observable expected result and list focused future verification commands without claiming they were run.
- [ ] Confirm all acceptance criteria are covered by the document-only checklist, then amend the existing commit with both owned files.

### Task 5: Amend commit

```bash
git add docs/specs/S5-agent-job-contract-v2.md docs/superpowers/plans/2026-09-02-SG5-agent-contract.md
git commit --amend --no-edit
```

The parent session runs validation after all parallel tickets land. This worker does not run formatters, linters, builds, tests, or project-wide validation.
