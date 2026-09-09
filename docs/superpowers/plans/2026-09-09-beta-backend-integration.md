# Beta backend integration implementation plan

**Current state:** The accepted pre-D89 checkpoint `004a97d` was integrated by FRONTEND as `9ca0b2c` (Main reports client/API checks, tests and build passing). The next owned contract wave adds persisted institution observations and shared onboarding/program DTOs below; mini API/Community Cloud typechecks, nine focused files (146 tests) and an independent loopback HTTP/D1 journey smoke passed. Its PostgreSQL replay is pending; the earlier 59/59 and restricted-PG loopback proof do not validate these new reads. No D89/runtime-address, first-admin provisioning, hosted Auth or deployment readiness is claimed.

**Goal:** Integrate backend-owned settings, authentication and program admission from `feat/settings-backend@71778f3` onto `4352d32`. This is the first backend wave, not beta completion.

**Architecture:** Three-way reconciliation against common base `feca8606`. Current main remains authoritative for six-domain consent, immutable audio objects, readiness, canonical AI drafts and egress. Program admission adds a separate authorization fence. No commit cherry-pick.

**Spec:** Q/Main's 2026-09-09 first-wave instructions, ADR-0044 and ADR-0045, current main consent/audio contracts.

## First-journey contract wave handoff

Work stays on `integrate/beta-0.9-backend` after `004a97d`; it does not merge the frontend branch. No migration, new column, root dependency change, provider call or first-admin provisioning/invite privilege path is introduced.

### Routing sequence and authorization

1. After the existing authentication/MFA flow, read `GET /me`. `roles` remains the canonical role set. A technical-only or role-waiting identity must not be offered institution-admin mutations merely because its legacy `role` says admin.
2. Read `institution.settingsState` and `installationState` before offering initial setup. A missing persisted installation/settings row is an operator prerequisite, not permission to create the first Auth user or fabricate defaults.
3. `onboardingCompleted` is exactly the current one-time setup gate, persisted `organization_settings.org_name IS NOT NULL`. It is not a combined readiness flag or proof of an operator ceremony: the existing profile-edit route also writes this name. `firstProgram` independently reports only the same-organization `initial_program_id` link, never a guessed first item or `lastProgramType`.
4. An institution admin posts initial names once, then uses the returned first program ID with `GET /programs` and `PATCH /programs/:id`. Confirmation must echo the current copy and installation tokens plus the program `expectedVersion`. There is no separate confirm endpoint.
5. Workers read active options from `GET /program-options`; admins use the management listing. A closed first program may still have `admissionState: ready`: its separate `status: closed` prevents registration and excludes it from options.
6. Registration uses the explicit program ID and existing participant consent/assignment requirements. These observations are not authorization grants; every write rechecks canonical roles, admission and consent. On 409, reread current state rather than automatically confirming or overwriting it.

### Exact HTTP DTO table

Public types are `@ccc/contracts/institution` and `@ccc/contracts/program-admission`. Program DTO definitions moved out of core; callers import the shared contract directly, without legacy re-exports.

| HTTP operation | Request | Success DTO |
| --- | --- | --- |
| `GET /me` | No query/body fields | 200 `MeResponse`: `{ id: string, orgId: string, email: string|null, role: 'admin'|'counselor'|'service', active: boolean, name: string|null, lastProgramType: string|null, roles: ActorRole[], institution: InstitutionReadiness }`. Legacy role vocabulary is retained; service actors cannot obtain a successful response. |
| `GET /organization/profile` | No query/body fields | 200 `OrganizationProfile`: `{ orgId: string, orgName: string|null, programDisplayName: string|null }`, unchanged. Unlike `/me`, this existing business route still requires a usable installed policy. |
| `POST /organization/onboarding` | `OrganizationOnboardingInput`: `{ orgName: string, programDisplayName: string }`; all other keys rejected. Trimmed lengths are 1..80 and 1..120 respectively. | 200 `OrganizationOnboardingResponse`: `{ orgId: string, orgName: string|null, programDisplayName: string|null, institution: InstitutionReadiness }`. Single-use, institution-admin-only, creates/renames the linked first program without confirming it. |
| `GET /programs` | No query/body fields; institution admin only | 200 `ProgramListResponse`: `{ programs: ProgramView[], staffOptions: { userId: string, name: string|null }[], admissionCopy: { version: string, hash: string, copy: typeof PROGRAM_ADMISSION_COPY }, installation: { deploymentMode: DeploymentMode, sttMode: 'off'|'local'|'azure', llmMode: 'off'|'openai', policyVersion: number, configHash: string } }`. Includes active and closed programs. |
| `GET /program-options` | No query/body fields; active human with a canonical role, subject to the existing identity projection | 200 `ProgramOptionsResponse`: `{ programs: ProgramOption[] }`. Only active same-institution programs, including locked ones with their admission state. |
| `POST /programs` | `CreateProgramInput`: `{ displayName: string, storageMode?: ProgramStorageMode|null, processingMode?: ProgramProcessingMode|null, confirmation?: ProgramConfirmationInput|null, staff?: ProgramStaffInput[] }` | 201 `ProgramMutationResponse`: `{ program: ProgramView }`. |
| `PATCH /programs/:id` | `UpdateProgramInput`: `{ expectedVersion: number, displayName?: string, storageMode?: ProgramStorageMode|null, processingMode?: ProgramProcessingMode|null, confirmation?: ProgramConfirmationInput|null, status?: 'active'|'closed', staff?: ProgramStaffInput[] }`; at least one optional field, all unknown keys rejected. | 200 `ProgramMutationResponse`: `{ program: ProgramView }`. Explicit confirmation uses this route; administrator ID/time are server-generated. |

| Nested DTO / alias | Exact shape and interpretation |
| --- | --- |
| `InstitutionReadiness` | `{ orgId: string, orgName: string|null, settingsState: 'present'|'missing', onboardingCompleted: boolean, firstProgram: (ProgramOption & { status: 'active'|'closed', version: number })|null, installationState: 'available'|'unavailable', retentionPolicyStatus: 'missing'|'configured'|'review_required', consentCopy: { version: string, status: 'available'|'provider_registry_unavailable', domains: { domain: ConsentDomain, disclosureAvailable: boolean }[] } }` |
| `ProgramOption` | `{ id: string, displayName: string|null, programType: 'financial_support_v1', admissionState: ProgramAdmissionState }` |
| `ProgramRecord` | `{ id: string, orgId: string, displayName: string|null, status: 'active'|'closed', programType: 'financial_support_v1', storageMode: ProgramStorageMode, processingMode: ProgramProcessingMode, version: number, confirmation: ProgramConfirmation|null }` |
| `ProgramView` | `ProgramRecord & { admissionState: ProgramAdmissionState, staff: ProgramStaff[] }` |
| `ProgramConfirmationInput` | `{ copyVersion: string, copyHash: string, installationPolicyVersion: number, installationConfigHash: string }` |
| `ProgramConfirmation` | `ProgramConfirmationInput & { by: string, at: string, storageMode: ProgramStorageMode, processingMode: ProgramProcessingMode }` |
| `ProgramStaffInput` / `ProgramStaff` | `{ userId: string, isResponsible: boolean }` / `ProgramStaffInput & { name: string|null, active: boolean }` |
| `ProgramStorageMode` | `'supabase_seoul'|'naver_public'|'local_encrypted'|'undecided'`. Cloud writes accept only `supabase_seoul`/`undecided`; Local requires omission and keeps `local_encrypted`. `naver_public` is not an available write option. |
| `ProgramProcessingMode` | `'external_allowed'|'internal_only'|'undecided'` |
| `ProgramAdmissionState` | `'ready'|'undecided'|'confirmation_required'|'selection_changed'|'notice_changed'|'settings_changed'|'storage_unavailable'|'processing_unavailable'|'installation_unavailable'` |
| `DeploymentMode` / `ActorRole` | `'community-cloud'|'local-single'|'local-office'` / `'institution-admin'|'technical-admin'|'supervisor'|'worker'|'service'` from the existing runtime contract. |
| `ConsentDomain` | The six existing values, in canonical order: `personal_data_collection_use`, `sensitive_information_processing`, `counseling_recording`, `external_stt_processing`, `external_llm_cross_border_processing`, `voice_original_retention_period`. |

`installationState: available` only means the deployment mode and persisted program policy can produce an admission context. It does not assert STT qualification, healthy Agent, signed-manifest availability to a client, provider connectivity or hosting readiness.

`retentionPolicyStatus` reports stored settings: absent row is `missing`, valid stored grace period through the current 1,826-day write ceiling is `configured`, and legacy stored values above that ceiling are `review_required`. It does not rewrite defaults, prove administrator review or replace the existing five-calendar-year retention enforcement.

`consentCopy.version` is the shipped canonical six-domain copy version, not an institution-specific approval version. A domain is available only when its provider has a same-org persisted registry snapshot with `approved_at <= now` and `valid_until IS NULL OR valid_until > now`, matching disclosure issuance. Future, expired and other-org rows do not qualify. All six must qualify for aggregate `available`. Reading this state neither creates disclosures nor grants consent; there is no invented institution-custom-copy acceptance flag.

### Denial codes for client handling

No vendor exception text, user identifiers or secrets are added. Existing coarse conflict/forbidden codes are retained rather than fabricating a more specific cause.

| HTTP | Exact JSON | Scope and client action |
| --- | --- | --- |
| 401 | `{ error: 'actor_authentication_required' }` | Missing/invalid identity: return to authentication. |
| 403 | `{ error: 'mfa_required' }` | Verified Cloud human below required aal2: complete existing MFA flow. No first-admin provisioning route is added. |
| 403 | `{ error: 'forbidden' }` | Inactive/non-human actor, insufficient canonical role, unavailable/foreign target or settings: do not auto-elevate or infer target existence. |
| 400 | `{ error: 'invalid_request' }` | Wrong/unknown fields, unsupported storage, invalid choices, blank names or invalid version: correct input; no retry by dropping security fields. |
| 409 | `{ error: 'conflict' }` | Repeated onboarding, stale program version/copy/policy or concurrent context change: reread `/me` and `/programs`, then require deliberate confirmation. |
| 409 | `{ error: 'program_admission_required', reason: ProgramAdmissionDenialReason }` | Additive typed `reason` now accompanies the existing code. Reason is any non-ready `ProgramAdmissionState` or `program_closed`. Show the relevant locked state; a reason is never permission to bypass the guard. |
| 503 | `{ error: 'service_unavailable' }` | Identity store or verified capability state unavailable: stop, do not construct fallback readiness. |
| 500 | `{ error: 'internal_error' }` | Unclassified failure, including unreadable persistence/audit failure: stop and report safely. |
| 422 | `{ error: 'privacy_consent_required' }` or `{ error: 'emergency_reason_required' }` | Existing participant registration gates remain independent of program readiness. Collect the required consent or valid emergency reason through the existing workflow. |

Missing program policy blocks business endpoints with `program_admission_required/installation_unavailable`; `/me` alone still reports the unavailable state without creating rows. Participant six-domain consent/disclosure APIs retain their separate canonical error codes and cannot be satisfied by this metadata.

### Verification boundary for this wave

New synthetic contract tests exercise persisted setup → explicit confirmation → registration, stale policy lock, privacy denial, closed programs, absent settings/policy without writes, retention review status, six-domain registry time/org boundaries, replay/unknown-field rejection and audited same-org reads. Identity resolution is injected; gateway, D1, HTTP handler and audit are real. Existing identity/MFA and consent tests run alongside them. No hosted Auth, first-admin provisioning, Docker or PostgreSQL execution is part of this wave; PostgreSQL replay remains pending.

Observed mini results for this wave:

- New contract tests first failed 5/5 against the old responses (absent `institution`, plus onboarding silently accepting unknown keys). After implementation, an invalid fixture UPDATE was correctly rejected by the immutable provider-registry trigger; the fixture now appends fresh synthetic snapshots. The production trigger was not changed.
- API and Community Cloud typechecks passed, followed by **9 files / 146 tests passing** in 128.75 seconds (combined command 134.53 seconds):

```sh
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/community-cloud run typecheck
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/institution-journey.contract.test.ts apps/api/test/program-admission.routes.test.ts apps/api/test/settings-routes.test.ts apps/api/test/gateway-domain.test.ts apps/api/test/identity-subject.test.ts apps/api/test/identity-supabase.test.ts apps/api/test/retention-policy-settings.test.ts apps/api/test/consent-privacy-gate.test.ts apps/api/test/worker-invite-signup.test.ts --maxWorkers=1
```

- A separate throwaway Bun program started real loopback HTTP over real Miniflare D1, applied every current SQLite migration, created synthetic institution/directory/policy rows and exercised the complete journey without Vitest. It exited 0 with `initialObservation`, `setup`, `unconfirmedDenial`, `confirmation`, `independentPrivacyDenial`, `registration` and `missingRegistryReported` all true; `hostedAuth:false`, `postgres:false`. The server stopped, its Miniflare instance disposed, and `apps/api/test/institution-journey.smoke.ts` was removed after proof.
- These are focused, overlapping checks, not another full API pass or PostgreSQL rerun. No first-admin Auth account was provisioned: only disposable synthetic database fixtures existed.
- After smoke removal, API/Community Cloud typechecks and the core-import, DB-gateway and SQL-dialect guards passed again (6.23 seconds). Frozen root dependency hashes and the accepted parity manifest hash remained unchanged. PostgreSQL must still replay the new readiness query/audit path before this wave inherits a PostgreSQL validation claim.

## Current accepted evidence and cleanup

This section supersedes the earlier pending/blocker/no-consumption status statements below. Those sections retain chronological commands, intermediate failures and WIP restrictions as historical evidence, not current instructions to rerun a removed smoke file.

- Validated source: `e717ad9aa29940ddc10914bc77bd21485308a44a`, unchanged during the accepted MacBook run except generated parity.
- Parity-only proof commit: `84401611d5996f7179fec2a1766759042b8dc641`, transferred by Main over private Git-over-SSH to local ref `validation/macbook-backend-proof`. GitHub origin was untouched.
- BACKEND verified its branch/head, the local proof ref, ancestry and sole changed path `migrations/parity.yaml`, then used `git merge --ff-only validation/macbook-backend-proof`. No force or reset.
- Verified manifest SHA-256: `66884cd3343f8f8623bbf9ad4dc0b74eea9b8e7a8512b0b039c2eba1d7af075d`.
- Main-read MacBook evidence: `migration-parity.test.ts`, `database-parity.test.ts`, `postgres-database.contract.test.ts`, `postgres-context.contract.test.ts` and `postgres-rls.security.test.ts` passed **59/59 across five files** using the existing pinned PostgreSQL harness.
- Main-read smoke output:

```json
{"unconfirmedDenial":true,"admittedCreation":true,"staleConfirmation":true,"crossOrgIdentityDenial":true,"crossOrgRlsDenial":true,"hostedAuth":false}
```

The smoke exercised a real loopback HTTP server and restricted PostgreSQL connection. Identity signature verification used synthetic signing keys and simulated issuer/JWKS responses, not hosted Supabase Auth. The accepted runtime remains pre-D89; no hosted/deployment readiness is claimed. Community Cloud binary audio ingress remains deliberately closed with null audio storage.

Counts are separate, overlapping observations, **not additive**:

| Stage | Result |
| --- | --- |
| Mini initial focused run | 11 files: 158 pass, 5 fail |
| Mini targeted correction replay | 5 pass, 51 excluded by name filter |
| Mini only complete API run | 83 files: 74 pass, 9 fail; 992 tests: 923 pass, 10 fail, 59 skipped due PostgreSQL setup failures |
| Mini corrected non-PostgreSQL full-file replay | 4 files, 148 pass |
| Mini final focused/boundary/security run | 22 files, 264 pass |
| MacBook initial PostgreSQL contract run | 5 files: 54 pass, 5 fail; HTTP smoke correctly stopped |
| MacBook accepted PostgreSQL replay | 5 files, 59 pass; subsequent smoke passed the five checks above |

There was **no second complete API suite run**. The targeted and full-file replays do not retroactively turn the earlier complete run into a clean full-suite result.

Following Main's cleanup authorization, only `apps/api/test/backend-runtime.smoke.ts` is removed; its executed source remains recoverable from `e717ad9` and `8440161`. The cleanup commit contains that deletion and this handoff only. Product code, migration SQL, generated parity, root dependencies and unrelated sources/artifacts remain unchanged. Root package/lock retain their reported frozen hashes; no D89 work, public push, main merge, deployment or subagent work is authorized.

Post-cleanup mini verification passed in 4.77 seconds: `pnpm --filter @ccc/api run typecheck`, `node scripts/guard-core-imports.mjs`, `node scripts/guard-db-gateway.mjs` and `node scripts/guard-sql-dialect.mjs` (30 SQLite migration files inventoried). No Docker/PostgreSQL command or test suite ran during cleanup.

## Boundaries

- Work confined to this BACKEND worktree. No subagents, other worktree operations, Git mutations, provider calls, secret operations or hosted changes.
- Client, web, design, privacy pipeline and `docs/ops.md` remain outside this wave. Untracked `supabase/` was not read or modified.
- Main subsequently authorized serialized validation and existing frozen-lockfile linking. Every Vitest command in this slot uses `--maxWorkers=1`; no heavyweight suites run concurrently. No external dependency versions or lifecycle approvals were added.
- Language-server discovery and reference requests found no configured server. References were traced with source searches.
- Whole-file reconciliation writes compared captured original bytes before replacement. Subsequent surgical fixes used current read snapshots.
- Applied SQLite 0051 through 0053 and PostgreSQL 0007 through 0009 were not edited.

## Source changes

- [x] Reconcile gateway, HTTP handler, capabilities, identity composition, memory runner and contract exports.
- [x] Bring real program creation/edit/options, versioned confirmation, staff membership, account role/deactivation transactions, bounded audit/export endpoints, profile CAS and retention-policy CAS.
- [x] Require explicit `programId` for registration, support-case creation and participant invites. Keep response `programType` as a distinct classification. Bind assignment acceptance to the route support-case ID.
- [x] Retain main consent receipts, readiness, audio-object lifecycle, egress and canonical AI-draft checks. Add admission checks to upload admission/authorization/completion, claim/source/result paths and AI/STT egress.
- [x] Bring verified Supabase subject/session identity, MFA errors, session revocation and restricted PostgreSQL context. JWT email and role claims do not substitute for the canonical directory.
- [x] Bring the Community Cloud runtime with null audio storage and explicit binary-ingress rejection. Its build writes `apps/community-cloud/dist/index.js`, not `supabase/`.
- [x] Root package and lock changes are confined to owned Community Cloud commands/importers and the internal identity workspace. `esbuild@0.28.1` already existed in main's lock. Candidate client dependencies were not copied.

## Forward migrations and parity

- [x] Append SQLite `0054_program_admission.sql` and `0055_account_settings.sql`.
- [x] Append PostgreSQL `0010_program_admission.sql` and `0011_account_settings.sql`. The first includes the candidate's verified-session RLS policy, preserving one checkpoint per SQLite/PostgreSQL pair.
- [x] Reconcile logical integer types, column constraints and ten program-link trigger names with SQLite. Preserve existing strict catalog comparison rather than adding exemptions.
- [x] Add checkpoints in `apps/api/test/support/migration-parity.ts`.
- [x] Add cross-engine witnesses for unconfirmed migration backfill, cross-institution initial-program rejection, incomplete confirmation rejection and transaction rollback on a failed admission guard.
- [ ] Generate `migrations/parity.yaml` through the live semantic-proof harness in the validation slot. No catalog hashes were invented or hand-edited.

## Backend tests

- [x] Reconcile 57 candidate backend test paths with main. Main canonical consent helpers and readiness/audio/draft assertions remain, rather than restoring legacy approval fixtures.
- [x] Seed synthetic program admission separately from participant consent. Explicit capability and recording-result mode fixtures reflect the new installed policy source.
- [x] Adapt onboarding to reject repeated initial setup without changing names or adding a successful update audit.
- [x] Restore the submission UUID omitted by the candidate's schema-trigger fixture, update newer main creation callers and recording helper arguments.
- [x] Add an independent-gates regression in `program-admission.routes.test.ts`: admitted program alone cannot authorize audio; canonical consent opens admission; a subsequent policy revision closes it again.
- [x] Execute the complete API suite once in the authorized slot, then repair and rerun failed non-PostgreSQL files. Exact outcomes are below; PostgreSQL setup failures are not passing evidence.

## Frontend and integration handoff

1. `apps/web/app/lib/api.ts` still declares creation `programType` inputs at `CreateCaseInput`, `CreateInitialParticipantProgramInput`, `CreateSupportCaseInput` and `createParticipantInvite`. Their owned frontend callers must send explicit `programId` selected from `GET /program-options`. Response `programType` stays and must not be renamed indiscriminately. No compatibility fallback selects a program silently.
2. Administrator program endpoints are `GET/POST /programs` and `PATCH /programs/:id`. Mutation input uses `expectedVersion`; confirmation must echo current copy version/hash and installation policy version/config hash from the listing. `program_admission_required` is a real backend refusal, not a display-only warning. A changed policy requires reconfirmation.
3. Account settings live under `/settings/accounts`. Preserve technical-only verified identities there and for `/capabilities`; that does not grant business access. Handle `mfa_required` separately from unauthenticated access.
4. `GET/PATCH /organization/profile` is separate from one-time initial onboarding. Do not reuse completed onboarding for later edits. Retention uses `GET/PUT /settings/retention-policy` with `expectedVersion` and `piiPurgeGraceDays`. Existing calendar-based five-year retention cap is unchanged.
5. Audit paging uses `/audit-log` with bounded `limit`, `cursor`, `actorId`, `from`, `to`, `supportCaseId`. Use `/exports/cases` for assigned export choices and `/settings/assignments/cases` for institution assignment choices, not broad unrestricted lists.
6. `scripts/seed/scenario.ts` still sends `programType` in initial registration. It belongs to the separate integration/seed owner. It needs an explicitly created synthetic confirmed program and its ID; production backfill must remain unconfirmed. Frontend and seed sources were not modified here.
7. The installed STT/LLM policy is now read from `program_admission_policies`. This wave adds no public mode-write endpoint. Installation/settings policy mutation and reconfirmation UX must be integrated by their owner before any activation claim. Off defaults, signed registry and readiness remain independent gates.
8. The candidate `adapters/audio-supabase` and its legacy adapter test were intentionally excluded. It lacks main's generation-aware AudioStore contract and real upload/download target support. A separate StorageSigner-compatible integration with current consent/readiness/deletion evidence is required; the Community Cloud runtime currently rejects the unavailable audio path. This is a beta blocker, not a working Cloud audio implementation.
9. No `supabase/` deployment artifact was produced. Community Cloud build output alone is not an installed function. Hosted installation and deployment remain outside this wave.
10. The privacy/NER work on `fix/ner-long-input@2a53f7b` remains a separate integration dependency and was not merged.

## Serialized validation slot

Main authorized this BACKEND-only slot. The first pnpm invocation reported the existing lockfile up to date, passed its 569-entry supply-chain policy check and reconciled local links (`Packages: -8`); no explicit install, new external version or lifecycle-script approval was issued. PostgreSQL suites use only `startPostgresHarness`, never hosted databases or credentials. After Main requested progress inspection, the running full suite was kept intact and allowed to finish; it was not restarted.

First resolve TypeScript and package composition errors:

```sh
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/community-cloud run typecheck
pnpm --filter @ccc/community-cloud run build
```

Run the focused backend contracts, then the complete API suite without dropping canonical main tests:

```sh
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/program-admission.routes.test.ts apps/api/test/account-settings.test.ts apps/api/test/identity-supabase.test.ts apps/api/test/identity-subject.test.ts apps/api/test/audit-log.routes.test.ts apps/api/test/retention-policy-settings.test.ts apps/api/test/capabilities.contract.test.ts apps/api/test/agent-job-contract.test.ts apps/api/test/agent-job-contract.modes.test.ts apps/api/test/audio.test.ts apps/api/test/recording-result.e2e.test.ts --maxWorkers=1
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts --maxWorkers=1
```

Generate parity only after fixing actual schema/semantic failures. Then replay the read-only guard:

```sh
CCC_UPDATE_MIGRATION_PARITY=1 pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts --maxWorkers=1
# The named suite scripts expand to Vitest files. Execute those files with
# --maxWorkers=1 rather than using wrappers that omit the authorized worker cap.
node scripts/guard-core-imports.mjs
node scripts/guard-db-gateway.mjs
node scripts/guard-sql-dialect.mjs
```

The parity manifest remains unchanged because the live proof never reached migration application. Neither its hashes nor any semantic assertion was weakened. New Supabase identity tests are explicitly included because the older named auth-suite list omits them. Checkpoint commit authorization is conditional on successful validation; PostgreSQL proof and actual restricted HTTP smoke are still missing.

## Validation evidence (2026-09-09, BarQ.local)

All commands ran in `/Users/barq/DEVELOPER/PROJECTS/CCC/.worktrees/BACKEND`.

| Check | Observed result |
| --- | --- |
| API typecheck, first run | 30 diagnostics in 12 files. Duplicate merge properties/imports, stale program inputs, synthetic policy property name, nullable AudioStore composition and nullable identity org scope. |
| API typecheck after fixes | Exit 0. |
| Community Cloud typecheck and build | Both exit 0. Output remains under `apps/community-cloud/dist/`. |
| Final typechecks and build after regression fixes | `pnpm --filter @ccc/api run typecheck && pnpm --filter @ccc/community-cloud run typecheck && pnpm --filter @ccc/community-cloud run build`: exit 0, 6.03 seconds. |
| Initial focused 11 files | 158 passed, 5 failed; 277.77 seconds. |
| Five focused regression cases, final targeted rerun | 5 passed, 51 unrelated tests excluded by name filter; 24.62 seconds. |
| Complete API suite, single uninterrupted run | 83 files: 74 passed, 9 failed. 992 tests: 923 passed, 10 failed, 59 skipped because five PostgreSQL suite setup hooks failed. 1209.07 seconds. |
| Four failed non-PostgreSQL files, full-file rerun | 4 files, 148 tests passed; 312.73 seconds. |
| `node scripts/guard-core-imports.mjs` | Exit 0. |
| `node scripts/guard-db-gateway.mjs` | Exit 0. |
| `node scripts/guard-sql-dialect.mjs` | Exit 0; inventoried 30 SQLite migration files. |
| Explicit `CCC_UPDATE_MIGRATION_PARITY=1` command above | Suite failed before semantic proof: disposable PostgreSQL startup unavailable; one test not executed. Manifest was not generated. |
| `bun run apps/api/test/backend-runtime.smoke.ts` | Failed in disposable PostgreSQL startup, before the HTTP listener existed. No HTTP success is claimed. |

Four-file rerun command:

```sh
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/routes.test.ts apps/api/test/consent-privacy-gate.test.ts apps/api/test/gateway-domain.test.ts apps/api/test/gateway-invite-tokens.test.ts --maxWorkers=1
```

Fixes retain the tested boundaries:

- Synthetic Azure scenarios now explicitly confirm an Azure program policy before their existing canonical consent/NER checks. The registry-empty scenario confirms its installation policy separately from signed engine qualification.
- Upload admission retains `engine_unavailable` for an unqualified runtime before comparing the selected non-null engine with the program policy.
- The Preview no-draft scenario explicitly retains main's LLM-off state instead of the candidate's unintended OpenAI activation.
- The consent-race test injects at the actual transactional batch boundary. It still requires `stale_claim` and a revoked egress record.
- Historical-memory race injection follows the canonical eligibility query instead of removed legacy consent columns. It still requires zero provider calls, HTTP 409 and no draft. Failure diagnostics no longer dump the response's synthetic identifiers.
- Draft-specific fixtures explicitly configure OpenAI program admission without fabricating participant consent. Existing canonical consent helpers remain independent.
- Administrator emergency registration supplies its required assignee. The malformed invite ID test retains its ValidationError assertion and uses an actually malformed ID rather than conflating it with a missing/inaccessible program.

## Infrastructure and smoke blocker

Read-only diagnostics:

- `docker context show`: `colima`.
- `docker image inspect postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 --format '{{.Id}}'`: Docker socket connection ends in EOF before image inspection.
- `colima status`: VM reports running using Virtualization.Framework, aarch64, Docker runtime. The reported existing socket is the same failing endpoint.

No Colima restart, Docker context switch, unrelated container action, permission change, credential access or image replacement was performed. The infrastructure owner must restore that existing Docker connection before PostgreSQL parity, database context/RLS contracts and smoke can run.

The throwaway `apps/api/test/backend-runtime.smoke.ts` is prepared and typechecks. It uses a real loopback HTTP server, `createCommunityCloudRuntime`, asymmetric synthetic JWT verification, local simulated JWKS responses and the migration-created restricted `ccc_api` role. Intended assertions cover unconfirmed denial, confirmed registration, stale confirmation, cross-org identity denial and cross-org RLS invisibility. It prints only status/category results, not JWTs, keys or identifiers. Auth is simulated; this does not test real hosted Supabase authentication. Retain it for the blocked retry, then remove it after successful smoke. No mock database or elevated business connection substitutes for the missing PostgreSQL proof.

## Final reachable validation result

The final combined focused/backend-contract/security-bootstrap run passed **22 files and 264 tests**, with zero failures or skips, in **316.27 seconds**:

```sh
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/program-admission.routes.test.ts apps/api/test/account-settings.test.ts apps/api/test/identity-supabase.test.ts apps/api/test/identity-subject.test.ts apps/api/test/audit-log.routes.test.ts apps/api/test/retention-policy-settings.test.ts apps/api/test/capabilities.contract.test.ts apps/api/test/agent-job-contract.test.ts apps/api/test/agent-job-contract.modes.test.ts apps/api/test/audio.test.ts apps/api/test/recording-result.e2e.test.ts apps/api/test/database-contract.test.ts apps/api/test/sqlite-database.contract.test.ts apps/api/test/sql-placeholder-scanner.test.ts apps/api/test/sql-operation-marker.test.ts apps/api/test/sql-portability-migration.test.ts apps/api/test/audio-store.contract.test.ts apps/api/test/access-jwt.test.ts apps/api/test/identity-access.contract.test.ts apps/api/test/secrets-env.contract.test.ts apps/api/test/secrets-env.integration.test.ts apps/api/test/install-manifest.security.test.ts --maxWorkers=1
```

These counts overlap the complete API run; do not sum them as distinct tests. No second complete API suite was started.

Remaining validation commands after the infrastructure owner restores the existing Docker connection, in order and without concurrent heavyweight runs:

```sh
CCC_UPDATE_MIGRATION_PARITY=1 pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts --maxWorkers=1
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts apps/api/test/database-parity.test.ts apps/api/test/postgres-database.contract.test.ts apps/api/test/postgres-context.contract.test.ts apps/api/test/postgres-rls.security.test.ts --maxWorkers=1
bun run apps/api/test/backend-runtime.smoke.ts
```

The first command may expose real migration issues because no PostgreSQL migration has yet run in this slot. Fix them without altering applied history or relaxing semantic/security assertions. The second is the read-only parity/database/RLS proof. The third must actually traverse HTTP and restricted identity/database before smoke is marked complete.

Local checkpoint commit remains blocked by the user's successful-validation condition. No commit, push, merge or deployment was performed. Once the missing checks pass, remove the throwaway smoke file and checkpoint only explicit owned source/test files, forward migrations, generated parity manifest and this plan. Do not stage unowned frontend/seed files, generated `dist/`, untracked `supabase/`, credentials or unrelated artifacts.

## D89 boundary and root dependency freeze

Main notified this lane of Q's D89 approval after the above validation. That decision keeps institution-owned Supabase DB/Auth/Storage but moves the business API to an independently controlled runtime without privileged Supabase/admin DB/Auth credentials. Main owns ADR-0048 and the S2/S9/S11 amendments. This checkpoint remains pre-D89: no runtime, address or hosting contract was changed, and its evidence must not be presented as validation of D89 hosting.

No further dependency changes are currently required for the remaining pre-D89 checks. The blocker is the existing Docker connection, not a package version or workspace dependency.

**ROOT_LOCK_FROZEN** for this BACKEND worktree:

```text
1afe21070a90efb75d5081e01c8bc5e93f1c7d8d142309f423ae167cc0a8530a  package.json
5e99e795be45a8e58ecbc54d47ce1dc9133d99d138e80565d895aeb8f9fd4005  pnpm-lock.yaml
```

Measured with `shasum -a 256 package.json pnpm-lock.yaml`. Do not edit either file, including through dependency installation/regeneration, until Main explicitly transfers the slot back. Frontend owns its separate branch's client importer; a combined lockfile must later be regenerated deliberately by one integration writer. No suite was restarted for this freeze.

## Q-approved validation-only WIP transfer exception

Q subsequently approved one local `wip(validation)` checkpoint on `integrate/beta-0.9-backend` so Git can transfer the current source to the MacBook VALIDATION worktree. This overrides the earlier no-commit condition only for preservation and testing. It is **not a validated integration commit**, not permission for FRONTEND or main to consume this backend, and not D89 implementation or hosting validation.

The explicit checkpoint inventory is 88 owned files: reconciled backend source/tests, four forward migrations, the frozen root dependency files, this plan and `apps/api/test/backend-runtime.smoke.ts`. The six applied SQLite/PostgreSQL migrations and `migrations/parity.yaml` were compared byte-for-byte with HEAD and remain unchanged. `supabase/`, generated `dist/`, other worktrees, frontend/client/seed sources, secrets and unrelated files are excluded.

Pending proof remains PostgreSQL migration semantics, generated parity, read-only database/context/RLS contracts and actual restricted HTTP smoke. The previous 22-file/264-test and four-file/148-test results do not replace those missing checks.

### MacBook VALIDATION commands

Run from the transferred VALIDATION worktree, serially. The existing harness owns creation and disposal of only its random-named loopback PostgreSQL container. Do not use a hosted database, shared application container or privileged connection for business requests.

```sh
docker image inspect postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 --format '{{.Id}}'
# If the pinned image is absent, obtain this exact existing fixture image:
docker pull postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73

pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/community-cloud run typecheck
pnpm --filter @ccc/community-cloud run build
CCC_UPDATE_MIGRATION_PARITY=1 pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts --maxWorkers=1
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts apps/api/test/database-parity.test.ts apps/api/test/postgres-database.contract.test.ts apps/api/test/postgres-context.contract.test.ts apps/api/test/postgres-rls.security.test.ts --maxWorkers=1
bun run apps/api/test/backend-runtime.smoke.ts
node scripts/guard-core-imports.mjs
node scripts/guard-db-gateway.mjs
node scripts/guard-sql-dialect.mjs
```

Harness source is `apps/api/test/support/postgres.ts`, entrypoint `startPostgresHarness()`. It uses a pinned PostgreSQL image, generated disposable credentials, `127.0.0.1` ephemeral port binding and migration-created restricted `ccc_api` connections. The smoke's Auth issuer/JWKS is simulated with synthetic signing keys; its HTTP server and restricted PostgreSQL queries are real. No hosted Auth proof is implied.

If workspace links are missing, only frozen-lockfile linking of already locked versions is authorized; do not approve unknown lifecycle scripts or modify either frozen root file. Report environmental or permission prerequisites instead of substituting dependencies or weakening tests.

After this WIP checkpoint, **all BACKEND source is frozen until validation reports and Main coordinates the next write slot**. Root dependency files retain their stricter explicit slot-transfer requirement. No D89 runtime/address changes, push, merge, deployment or shared Docker repair are authorized by this exception.

## Scoped fixture-only child WIP for MacBook replay

Main reports that MacBook VALIDATION generated the real pinned-PostgreSQL parity manifest, then obtained 54 passes and 5 failures across the five PostgreSQL contract files. HTTP smoke correctly stopped. This follow-up changes only two test files and this handoff; all product, migration, manifest, runtime and root dependency bytes remain those of `bf63b224087773af6b396d46d03cc1098f08d0e6`.

- `postgres-rls.security.test.ts`: the two pre-0006 setup loops now select `.sql` files with names less than `0006`, not every file except 0006. Their former setup included 0010, whose policies need roles created by 0006, producing SQLSTATE 42704 before the intended rejection. Three membership cases and one ownership/atomicity case retain every assertion. The positive installation test still applies every latest migration.
- `database-parity.test.ts`: the users primary-key witness keeps the duplicate ID but uses `parity-pk-other-org`, with an already distinct email. Both schemas have `idx_users_id_org(id,org_id)`; the old input collided with both that UNIQUE index and the logical primary key. Current `users.org_id` has no foreign key, and user-role seeding runs after insertion, so no extra organization seed or production exemption is needed.
- Independent in-memory SQLite 3.53.4 probe applied all actual SQLite migration files. Old input returned `SQLITE_CONSTRAINT_UNIQUE`; isolated input returned `SQLITE_CONSTRAINT_PRIMARYKEY`; both left rows unchanged. This establishes the fixture collision, **not the missing exact subtype from MacBook's truncated report**, and does not prove D1/SQLCipher/PostgreSQL adapter parity. The expected `primary_key` subtype and every rejection/rollback assertion are unchanged.
- Mini verification: API TypeScript check and core-import, DB-gateway, SQL-dialect guards passed (combined 4.92 seconds). No PostgreSQL suite, Docker operation, install or D89 runtime change was attempted. The SQLite probe was an inline command and created no persistent artifact.

Replay the corrected contracts on MacBook VALIDATION before resuming the existing five-file suite and HTTP smoke:

```sh
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/postgres-rls.security.test.ts apps/api/test/database-parity.test.ts --maxWorkers=1
```

This child remains **validation-only WIP, not FRONTEND/main-consumable integration**. If the normalized rejection still differs, report the actual engine and structured subtype instead of changing expectations or production classification. BACKEND source returns to frozen state after the child checkpoint; root package/lock remain at the previously reported frozen hashes throughout.
