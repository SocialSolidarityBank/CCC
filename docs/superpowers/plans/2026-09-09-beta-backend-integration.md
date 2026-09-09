# Beta backend integration implementation plan

**Current state:** Main accepted creator-readiness checkpoint `8d4b1098927500c59fce50f3e19013101c66e548`. Main subsequently independently verified D89 checkpoint `b3dcf35df6e0ef17e29e5a7a6a201a6b221da0d8` on MacBook: seven files / 85 tests, including all five PostgreSQL files. Main also built and launched the actual Deno artifact, observed missing installation return `503 service_unavailable`, then stopped it. That is negative startup proof only. The P3 source wave below adds approved participant and assignment contracts; its local D1 and synthetic-identity HTTP evidence does not replace Main's PostgreSQL replay. Neither checkpoint proves deployment isolation, hosted Auth, installer completion or runtime manifest-revocation integration. Historical pending/WIP notes below describe their original checkpoints and are superseded only by explicitly attributed results.

**Goal:** Integrate backend-owned settings, authentication and program admission from `feat/settings-backend@71778f3` onto `4352d32`. This is the first backend wave, not beta completion.

**Architecture:** Three-way reconciliation against common base `feca8606`. Current main remains authoritative for six-domain consent, immutable audio objects, readiness, canonical AI drafts and egress. Program admission adds a separate authorization fence. No commit cherry-pick.

**Spec:** Q/Main's 2026-09-09 first-wave instructions, ADR-0044 and ADR-0045, current main consent/audio contracts.

## First-journey contract wave handoff

Work stays on `integrate/beta-0.9-backend` after `004a97d`; it does not merge the frontend branch. No migration, new column, root dependency change, provider call or first-admin provisioning/invite privilege path is introduced.

### Routing sequence and authorization

1. After the existing authentication/MFA flow, read `GET /me`. `roles` remains the canonical role set. A technical-only or role-waiting identity must not be offered institution-admin mutations merely because its legacy `role` says admin.
2. Read `institution.settingsState` and `installationState` before offering initial setup. A missing persisted installation/settings row is an operator prerequisite, not permission to create the first Auth user or fabricate defaults.
3. Read the three independent axes: `creatorLinkState`, `initialSetupState`, and `firstProgramAdmissionState`. Cloud `unlinked` requires the install-side linking handoff, not an API privilege escalation. `not_set_up` requires both a persisted institution name and a named same-org `initial_program_id` link; a profile name alone is not completion. `firstProgram` never guesses the first listing result or uses `lastProgramType`. These fields replace `onboardingCompleted`.
4. An institution admin posts initial names once, then uses the returned first program ID with `GET /programs` and `PATCH /programs/:id`. Confirmation must echo the current copy and installation tokens plus the program `expectedVersion`. There is no separate confirm endpoint.
5. Workers read active options from `GET /program-options`; admins use the management listing. A closed first program may retain `firstProgram.admissionState: ready`, but `firstProgramAdmissionState` is `not_admitted`: the separate `status: closed` prevents registration and excludes it from options. Policy/copy changes also return this axis to `not_admitted`.
6. Registration uses the explicit program ID and existing participant consent/assignment requirements. These observations are not authorization grants; every write rechecks canonical roles, admission and consent. On 409, reread current state rather than automatically confirming or overwriting it.

### First Community Cloud administrator: install-side handoff only

Q/Main's decision is available locally at `refs/heads/handoff/beta-orchestrator-decisions`, commit `23fa1daa531682ecd2489002e924cd9a30512d46`. ADR-0048 and the S2/S9/S11 amendments were read directly from that ref without merging their files. The dated first-admin follow-up governs over older unapproved-method wording. No invite sender, credential generator, linking mutation, public pre-auth readiness endpoint or hosted call is implemented in this wave.

| Boundary | Install-side contract and persisted/read result |
| --- | --- |
| Input | One human-supplied email address for the first administrator. Trim surrounding whitespace, preserve the exact address sent, and reject multiple recipients. The install tool uses Supabase Auth's one-time invitation flow; it never invents a password. |
| Human action | The invited human accepts the invitation and sets their password and MFA through Supabase Auth. Merely sending an invitation is not creator linkage or readiness success. |
| Secret ownership | Supabase administrative credentials remain in the install tool's protected runtime, never the business API. Do not print or persist passwords, invitation/recovery links, access/refresh tokens or raw provider errors. Email appears only as a SHA-256 hash in receipts; do not put it in actor/target IDs. |
| Invitation receipt | Install-only status must distinguish pending/accepted/linking failure from completion. Hash the UTF-8 bytes of the trimmed email actually sent. This receipt is not the database linking receipt below and cannot make readiness `linked`. Actual invitation receipt generation and hosted calls remain owned by the install lane. |
| Expected identity linkage | After verified acceptance and MFA, the protected install/linking step binds the returned opaque Auth user ID to the designated same-institution application `users.auth_subject`. The application user ID is opaque and email-independent. The existing unique subject key and active canonical `institution_admin` assignment must agree. Never derive authority by matching a JWT email/role claim, choose an arbitrary existing administrator, or perform an API-side auto-link. |
| Durable creator designation | There is no creator-ID column. The install/linking step must atomically persist the subject link and exactly one append-only `audit_log` linking receipt: `org_id = installation org`, `actor_id = "install:first-admin:" + orgId`, `actor_role = "service"`, `action = "first_admin_linked"`, `target_table = "users"`, `target_id = designated opaque application user ID`. The reserved actor namespace uses the existing actor index and is not a login identity. Retries reuse the completed result; they must not append another linking receipt. The business API implements only this receipt's reader, not its writer. |
| Exact linking detail | JSON with exactly `{ schemaVersion: 1, emailSha256: lowercase SHA-256 of sent email, authSubjectSha256: lowercase SHA-256 of the opaque Auth user ID }`. No email, subject, credential or invitation link is echoed. Existing audit time records the link observation. Unknown versions, extra/missing fields, invalid hashes or multiple receipts fail closed as `unlinked`. |
| Cloud creator observation | `creatorLinkState: linked` requires that single receipt, a same-org active non-service directory user, a non-revoked canonical institution-admin assignment, and the exact current subject hash. Absent/mismatched evidence returns `unlinked`, even if another admin has a subject or initial names/program are already populated. This is an observation, not proof of a live Supabase session or fresh MFA; existing authentication and revocation checks still apply. |
| Unlinked Auth principal | A verified Auth subject without the existing directory link still fails existing identity resolution. It does not receive a fabricated `/me` success or public organization data. `creatorLinkState` is available only to an already authenticated, authorized directory reader; the install tool must surface its own pending/unlinked state before that boundary. |
| Local modes | `creatorLinkState: not_applicable` means only that this Supabase first-admin linkage contract does not apply. It is not proof of Local authentication or runtime readiness. An unknown installation mode remains `unlinked` plus the existing unavailable installation observation. |
| Initial setup observation | `initialSetupState: complete` requires a nonblank persisted institution name and a named same-org first-program link. Otherwise return `not_set_up`. It does not prove review of consent copy or retention policy; their independent fields remain. A legacy name-only row is not success; the existing one-time onboarding conflict remains an operator repair prerequisite, not permission to overwrite it. |
| First-program observation | `firstProgramAdmissionState: admitted` requires the linked first program to be active and currently `ready` under persisted installation/admission policy. Missing, closed or locked programs return `not_admitted`; inspect `firstProgram` for the precise reason. No combined success flag grants participant consent, STT access or record creation. |

The client must replace its former `onboardingCompleted` handling with these three axes. Existing authorization stays unchanged: receipt presence is neither a new role nor a business-write grant, and a 200 metadata response is not completed installation.

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
| `InstitutionReadiness` | `{ orgId: string, orgName: string|null, settingsState: 'present'|'missing', creatorLinkState: 'unlinked'|'linked'|'not_applicable', initialSetupState: 'not_set_up'|'complete', firstProgramAdmissionState: 'not_admitted'|'admitted', firstProgram: (ProgramOption & { status: 'active'|'closed', version: number })|null, installationState: 'available'|'unavailable', retentionPolicyStatus: 'missing'|'configured'|'review_required', consentCopy: { version: string, status: 'available'|'provider_registry_unavailable', domains: { domain: ConsentDomain, disclosureAvailable: boolean }[] } }` |
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

#### Q creator-link follow-up on `0f1638c`

- Red phase: seven of nine journey checks failed against the former response because the three explicit state axes were absent. The corrected implementation passed the journey and adjacent contracts; the final run below passed **5 files / 70 tests** in 32.97 seconds, with typechecks and guards completing in 40.07 seconds total.
- Creator checks cover a subject without designation, receipt-bound linkage, changed subject, duplicate receipts, foreign-institution and non-admin targets, and Local-mode non-applicability. A name-only settings row stays `not_set_up`; closed programs and changed policy stay `not_admitted`. These are synthetic fixtures, not actual Supabase invitation or MFA evidence.
- A separate Bun process served real loopback HTTP over disposable Miniflare D1 after applying the current SQLite migrations. It exercised the actual gateway subject lookup with synthetic verified-identity metadata. Final exit was 0; `unlinkedSubjectDenied`, `receiptRequired`, `creatorLinked`, `nameOnlyNotSetUp`, `setup`, `admitted`, `independentConsent`, `policyRelocked`, `duplicateReceiptDenied` and `actorIndex` were all true. `syntheticIdentity:true`, `hostedAuth:false`, `postgres:false`.
- Smoke harness corrections did not change production behavior: an `ActorResolver` must throw rather than return null, and the production Supabase adapter classifies an authenticated but unlinked subject as **403 `forbidden`**, not 401. The administrator registration probe also needed its required valid practitioner assignment before reaching the independent privacy-consent gate. Both harness errors were corrected; no gate was weakened.
- The smoke server exited and Miniflare disposed. `apps/api/test/creator-readiness.smoke.ts` was deleted after proof; the duplicate-receipt boundary remains in the permanent journey regression. Final checks below ran after removal.
- Frozen `package.json`, `pnpm-lock.yaml` and accepted `migrations/parity.yaml` hashes are unchanged. No new migration/column, hosted request, Docker/PG run, frontend edit, root dependency edit or invite/linking writer was introduced. The pre-existing untracked `supabase/` directory was left untouched.

```sh
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/community-cloud run typecheck
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/institution-journey.contract.test.ts apps/api/test/identity-subject.test.ts apps/api/test/identity-supabase.test.ts apps/api/test/settings-routes.test.ts apps/api/test/program-admission.routes.test.ts --maxWorkers=1
node scripts/guard-core-imports.mjs
node scripts/guard-db-gateway.mjs
node scripts/guard-sql-dialect.mjs
```

#### Prior first-journey checkpoint `0f1638c` (historical proof)

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

## D89 independent runtime source handoff

This source-only wave follows Q/Main's explicit seven-file ownership grant. No gateway, migration, root dependency, frontend/design, installer writer, secret access, hosted call or PostgreSQL run occurred on mini.

### Exact frontend and ingress contract

| Boundary | Contract |
| --- | --- |
| Signed `apiBase` | Independent HTTPS origin plus an explicit path, including `/` when the base is the origin root. The signed string must equal both URL serialization and `origin + pathname`. Userinfo, query, fragment, absent explicit root slash, implicit default-port removal and other silent URL normalization are rejected. Nondefault HTTPS ports are allowed. There is no Supabase API-host/project-ref requirement. |
| Signed Auth | `supabaseAuthOrigin` remains an exact HTTPS origin whose hostname project ref matches `supabaseProjectRef`. Issuer and JWKS remain beneath this Auth origin, never the independent API origin. Publishable-key rules are unchanged. API/Auth values remain covered by one Ed25519 signature. |
| Bootstrap | The unsigned `{ mode, apiBase }` must exactly equal the verified manifest. Do not trim, rewrite or infer a replacement API base, or derive the Auth origin from it. `/api`, `/api/` and `/` are distinct signed bases. |
| Route composition | For signed `https://api.example.invalid/api`, `/api/health` reaches `/health`; `/apix/health`, `/health` and `/functions/v1/api/health` do not. For a signed base ending in `/`, append `health` directly; otherwise append `/health`. `/tenant/api/` does not admit `/tenant/api`. An exact base request maps to `/`. No legacy Edge ingress fallback exists. |
| Request origin | `request.url` must have the signed API origin. Mismatch returns 403 `{ error: 'forbidden' }`, even with an allowed browser Origin or forged forwarding headers. Path mismatch returns 404 `{ error: 'not_found' }`. Deployment must preserve the externally signed URL to the Deno handler; arbitrary forwarded headers are not a trust source. Raw HTTP spellings already normalized by the request implementation cannot be recovered here. |
| CORS | Exact signed `allowedOrigins` only. Preflight requires an allowed Origin, existing method and allowed request headers. Responses remain `Cache-Control: no-store`, `Vary: Origin`, with `X-CCC-Installation-Id` exposed only to an allowed Origin. CORS is not authentication. |
| Identity and capability | Existing Bearer, issuer/signature, MFA, directory, institution and restricted database checks remain. No new capability fields, role grants or business DTO changes are introduced. Existing denial codes in the earlier table still apply. |
| Unavailable/media | Startup failure or a manifest reaching expiry returns 503 `{ error: 'service_unavailable' }`. Raw audio/multipart/octet-stream bodies and the existing audio PUT path still return 415 `{ error: 'AUDIO_BODY_FORBIDDEN' }`. `audioStore` remains null; StorageSigner is not implemented by this source wave. |

### Privilege and trust limits

- The existing Deno entry is reused without new dependencies. It requires the existing `CCC_DATABASE_URL` restricted connection; no owner-connection fallback is added. Only the three existing core secret names are exposed by its environment SecretStore.
- Presence of `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL` or `SUPABASE_ACCESS_TOKEN` prevents startup before database construction. The runtime factory also retains its existing typed service-role rejection. These are known-name defenses, not evidence that renamed credentials, runtime identity capabilities or blanket secret-fetch permissions are absent.
- Actual deployment identity, credential supply policy, region/TLS/provider choice and approval remain external prerequisites. Environment filtering is not final isolation proof. This Mac is not a production server.
- The verifier retains optional `revokedKeyIds`, `minSequence` and `expectedInstallationId` enforcement. Its current production caller, `verifiedInstallManifest`, supplies only public keys and time. Runtime revocation-list integration, trusted sequence floor and expected-installation-record binding are **not complete**. This wave deliberately invents no trust inputs or public manifest fields to hide that gap.
- LSP status and reference requests returned no configured server. Fallback reference inventory found the production verifier caller in `packages/http-api/src/capabilities.ts`, and the runtime factory caller in its Deno entry. Signatures remain unchanged. The shared signed-manifest fixture now uses the independent API base; capabilities and three-mode Agent contracts consume it without a parallel fixture convention.

### Proof and cleanup

- Before production edits, the two manifest/runtime files failed 16 of 26 checks because independent bases were rejected and URL-normalization rules were absent. After implementation they passed 26/26.
- Final focused run passed **4 files / 63 tests** in 38.42 seconds. API and Community Cloud typechecks exited 0. One test-only generic mock typing error was corrected without changing production code.
- New runtime tests exercise the real request handler with an attestation-only database double and synthetic Auth signing/JWKS. They cover exact path/root/trailing-slash handling, wrong origin, prefix siblings, legacy ingress rejection, CORS, Bearer/MFA, Auth-origin binding, expiry and privileged startup refusal. They do not execute PostgreSQL or contact Supabase.
- Removed the affected manifest test's incidental fixture-default assertion rather than re-pinning it. No throwaway files or services remain from this wave.
- Main's accepted `8d4b1098927500c59fce50f3e19013101c66e548` evidence is separate: five PostgreSQL files 59/59 and real restricted `ccc_api` readiness smoke with creator receipt, changed-subject denial and cross-org invisibility true; hosted Auth false. Main owns any replay of this new source checkpoint. No previous proof is relabeled as D89 deployment validation.

```sh
pnpm --workspace-root exec vitest run --config apps/api/vitest.config.ts apps/api/test/install-manifest.security.test.ts apps/api/test/community-cloud-runtime.test.ts apps/api/test/capabilities.contract.test.ts apps/api/test/agent-job-contract.modes.test.ts --maxWorkers=1
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/community-cloud run typecheck
```

## Installer implementation plan after the source checkpoint

This is an implementation plan, not permission to mutate external systems or a claim that an installer exists.

1. **Close private trust inputs with Main.** Establish the existing installation's private `institutionId`/`expectedOwnerOrgId` ownership contract, source of manifest revocation/sequence/expected-installation trust, and how the installer verifies invitation acceptance and MFA before linking. Do not add those ownership fields to the public manifest or infer them from JWT email/role claims. First-admin invitation is approved; later employee-invite administrative authority remains separate and unresolved.
2. **Align the existing read-only entry.** Reuse `scripts/supabase/bootstrap.mjs` and `scripts/supabase/plan.mjs`. Today only `plan` is parsed; unsupported operations fail before credentials or network. Keep `hosted-inspector.mjs` read-only. Its planned-resource list still names `ccc_worker`, baseline v1 and a 30-day audio purge, so align the versioned resource/checksum contract with restricted `ccc_api`, actual migration state and D85 before introducing apply. Preserve D84 ownership/region/RLS/Auth/Storage inspection and unchanged before/after fingerprints.
3. **Implement protected apply separately after approval.** Define journal, resource ownership, checksums and resumable/idempotent steps before writing. Apply approved migrations and restricted credential supply through the installer-owned authority; never make the business API or StorageSigner a generic admin proxy. Runtime distribution needs its separately approved provider/region/TLS and identity policy. Installation journal, resource receipt and release-history writers are not present in this lane's inspected implementation.
4. **Implement the approved one-email invitation and linking transaction.** A protected installer sends one human-supplied email through Supabase Auth's one-time invite. Record only its trimmed-address SHA-256 and safe pending/accepted/failure state; do not output links, passwords, tokens or provider errors. After verified acceptance/MFA, bind the designated opaque application user to the returned subject and atomically write exactly the single append-only receipt specified above. A retry reuses that result; contradictory existing evidence fails closed. No new creator column or API auto-link.
5. **Prove recovery and doctor behavior before release.** Test interruption/retry, duplicate/conflicting designation, wrong institution, stale manifest trust, restricted-role refusal, incomplete invitation and rollback boundaries with disposable fixtures. Doctor must report creator linkage, initial setup and first-program admission independently; metadata success is not readiness. Main replays PostgreSQL. Real hosted invitation, human MFA and deployment isolation require separately approved evidence; retain `off`/manual behavior until the existing activation gates are satisfied.

Next installer ownership should explicitly include the existing bootstrap/plan tests and approved private writer boundaries. No new CLI flag, environment variable, backend role, public trust field or live installation is created merely by this plan.

## P3 participant and assignment contract checkpoint

Scope is ADR-0047 D88 listing/hub serialization and ADR-0044 D86 worker-origin assignment requests. No frontend, design, root dependency, migration, parity or installer writer change.

### Participant reads

- `GET /participants` keeps the existing authorization, archive and bulk PII-decryption path. Each result additionally has `email: string | null` and `programNames: string[]`. Names cover the listed person's same-organization participation, are distinct and sorted, and are loaded in bounded batches rather than per-row hub calls. Existing `programCount` semantics are unchanged.
- The list already decrypted email. It now exposes that value and adds `email` to the existing PII read receipt's `fields`, without adding an audit row. Email-only contacts also produce the required receipt.
- `GET /participants/:beneficiaryId/hub` adds `restricted`. A full hub additionally exposes `participantBirthDate: string | null`, `status: 'active' | 'closed'`, `closedAt: string | null`, `sessionCount` and `lastSessionAt: string | null`. Birth date is decrypted only for a full hub and included in the same PII receipt's `fields` as `birth_date`.
- Record progress counts only authorized cases' official manual or approved AI records. Draft-only and unauthorized-case records do not contribute. Participant status is active while any same-organization participation remains active; otherwise `closedAt` is the latest case closure.
- An active, same-organization, wholly unassigned practitioner receives the D86 restricted hub: `beneficiaryId`, `restricted: true`, `participantName`, `participantPhone`, `participantEmail`, and `programs`. Each restricted program contains only `id`, `beneficiaryId`, `programId`, `programName`, `programType`, `status`, `authorized: false` and `assigneeNames`. No birth date, progress, consent, intake or schedule payload is emitted.
- The same restricted program projection applies to unauthorized programs inside a partially authorized full hub. Generic participant/support-case responses do not acquire email or birth date and retain their existing unassigned refusal. Local Single does not acquire the unassigned hub exception. Administrator counseling-content access remains read-only unless the actor also has an active practitioner role and case assignment.

### Worker-origin assignment requests

- `POST /support-cases/:supportCaseId/assignment-requests` accepts exactly `{ reason: string }`. Reason is trimmed, one line, 1 to 500 characters. The requester is derived from the authenticated actor, never supplied as `userId` or role. It creates an existing `support_case_assignees` row with `status: 'requested'`, returns the existing assignment response with `201`, and writes the canonical assignment audit. It does not grant content access.
- `POST /support-cases/:supportCaseId/assignment-requests/:assignmentId/review` is institution-administrator-only. Accept exactly `{ decision: 'coassign' | 'transfer' }` or `{ decision: 'reject', reason: string }`; rejection reason uses the same one-line bounds. Return the reviewed assignment response with `200`.
- Requested rows have immutable roles and request reasons. Approval atomically ends the requested row and inserts the chosen active assignment, secondary for coassignment or primary for transfer. Transfer ends the existing active assignees within that transaction. The response ID is the newly active assignment ID, not the consumed request ID.
- Rejection ends the original requested row without granting access. Its original request reason remains `transferReason`; the rejection reason belongs to the append-only review audit. Approval receipts identify the new active assignment.
- Worker-origin requests cannot use the existing recipient `/assignees/:assignmentId/accept` route to approve themselves. Existing administrator-origin invitations retain their acceptance behavior. Approval rechecks current practitioner eligibility and active case state.
- Duplicate pending/active requests and repeated or competing reviews return `409`; malformed input returns `400`; forbidden actors and cross-organization access return `403`. Existing installation readiness refusal can precede these checks. A conditional operation-marker claim ensures only the winning review mutates assignments and emits its review audit. No new idempotency-key protocol or table is introduced.

### Existing directory contract, intentionally reused

No new practitioner directory endpoint was necessary. `GET /settings/accounts?cursor=<last-id>` already returns same-organization accounts with `id`, `email`, `name`, `active`, canonical `roles`, `supervisedTeamIds`, `assignmentCount`, plus `permissions` and `nextCursor`. It excludes service accounts and pages at 100.

For administrator registration, consume all pages and select accounts where `active && roles.includes('worker')`. Send that account's UUID `id` as `initialAssigneeUserId` to `POST /participants`, not its email or a legacy role value. The registration gateway independently rechecks organization and current active practitioner status. Ordinary practitioners cannot read this administration directory. Do not substitute the broader program staff-options list.

### Local evidence and handoff boundary

- Focused API run: `participant-p3.contract.test.ts`, `assignment-lifecycle.test.ts`, `admin-area.test.ts`, `new-signup-badge.test.ts`, `participant-register-email.test.ts`, `participant-search.test.ts`, and `support-case-access-deny-audit.test.ts`: **7 files / 56 tests passed**, including nine new P3 cases and the existing 100-person batching regression.
- Compatibility selection in `routes.test.ts` and `gateway-domain.test.ts`: **2 passed, 121 skipped**, targeting hub email isolation and actor-scoped multi-program receipts. This is not a whole-file or whole-suite claim.
- The disposable real loopback HTTP smoke used Miniflare D1, actual API dispatch and synthetic identities. It passed directory-to-registration, list email/names, full hub birth date/progress, restricted hub, foreign-organization refusal, self-acceptance refusal, administrator coassignment, and repeated-review `409`. The server exited successfully; the throwaway source was removed.
- API and Community Cloud API typechecks passed. Core-import, DB-gateway and SQL-dialect guards passed. Root `package.json`, `pnpm-lock.yaml` and `migrations/parity.yaml` retain their pre-wave hashes.
- Local language-server references were unavailable because no server is configured. Caller inventory used repository searches; the existing directory API was retained instead of creating a competing contract.

Main owns PostgreSQL replay and the frontend handoff decision. This checkpoint is not hosted Auth, real deployment, frontend integration, product STT activation or installer completion. Installer writer work remains pending Main's resolution of its concrete trust/ownership blocker and separate authorization.

## E7-1a independent file and timer adapters

Main approved independently authenticated fixed-size chunks and a narrow extraction of existing R2 audio validation into `@ccc/contracts/audio`. P3 gateway/HTTP paths remain frozen. This slice does not implement the E7-1a identity/bearer remainder or E7-1b runtime assembly. Root dependency/lock files remain frozen.

### Internal audio-file format version 1

This is a new internal format with no existing persisted users. `createFileAudioStore(root, { bytes, version })` takes exactly 32 mutable key bytes and a positive uint32 key version supplied by composition from `FILE_ENC_KEY`. It copies them into a Node `KeyObject`, does not retain the caller's byte array and never fetches or stores secrets. DPAPI, rotation, key selection and Recovery Kit rewrap remain S9 assembly responsibilities. The configured root must be private; missing parents are not created.

All integers below are unsigned big-endian. AES is AES-256-GCM with 16-byte tags.

1. Prefix: magic `43 43 43 41 01` followed by uint32 header length, bounded to 1..4096 bytes.
2. Header: exact UTF-8 `JSON.stringify` bytes with ordered keys `formatVersion`, `keyVersion`, `chunkBytes`, `keyHash`, `generationId`, `noncePrefix`, `contentLength`, `contentType`, `expiresAt`. Values include version 1, chunk size 65,536, SHA-256 of the validated object key, random canonical UUID generation, random 8-byte prefix encoded as 16 lowercase hex characters, and the original validated metadata. Re-encoding must match byte-for-byte; extra/reordered/noncanonical fields fail. Stored metadata may outlive upload authorization, as with R2.
3. Per-object key: HKDF-SHA-256, input key `FILE_ENC_KEY`, salt `UUID bytes || nonce-prefix bytes`, info `UTF8("CCC-AUDIO-FILE\0v1\0object-key")`, output 32 bytes. Derived temporary key bytes are zeroed after constructing the object `KeyObject`. This avoids relying on uniqueness of an 8-byte nonce prefix across all objects encrypted by one master key.
4. Every record nonce is `noncePrefix[8] || uint32(recordIndex)`. Every record AAD is `UTF8("CCC-AUDIO-FILE\0v1") || completePrefixAndHeader || uint8(recordKind) || uint32(recordIndex) || uint32(plaintextLength)`.
5. Header authentication is an empty-plaintext record, kind 0, index 0, length 0. Its 16-byte tag immediately follows the header.
6. Data records are kind 1, indices 1 through `ceil(contentLength / 65536)`. Each stores ciphertext followed by its tag. All plaintext records are exactly 65,536 bytes except the final remainder; lengths and record boundaries follow the authenticated header, not unauthenticated per-record lengths.
7. Mandatory completion record: kind 2, index `chunkCount + 1`, plaintext length 40. Plaintext is `uint32(totalLength) || uint32(chunkCount) || SHA256(completePlaintext)[32]`. Its ciphertext and tag occupy exactly 56 bytes, followed by EOF. Exact file length is `9 + headerLength + 16 + contentLength + 16*chunkCount + 56`.

`get` opens one nofollow file descriptor, authenticates the header and completion record and checks exact file geometry before returning a stream. Each data chunk is authenticated before any of its plaintext is enqueued. The last chunk is withheld until the completion record is authenticated again on the same descriptor, the incremental plaintext hash matches, and an actual EOF read plus file-size check succeeds. There is no whole-file verify/reread pass, plaintext temporary file or whole-audio allocation. A truncation/modification after `get` can produce a stream error, never successful completion with an incomplete object. Consumers must treat clean EOF as success; previously emitted chunks are authenticated prefixes, not proof of whole-object completion.

`put` uses the existing key, canonical MIME, length, expiry and checked-stream rules. SHA-256 is incremental via Node crypto. It packs arbitrary source chunks into bounded 64 KiB records and writes encrypted-only stages inside an exclusively created key-hash directory. After completion and file fsync, exclusive hard-link promotion publishes `object` without replacement, removes the stage link and fsyncs its parent. Partial/overrun/expired/error streams do not publish. An upload key is immutable and cannot be reused after durable deletion. Both target methods return `null`.

### Durable filesystem deletion

The root contains key-hash directories, not raw session keys. Files are created exclusively with nofollow and mode 0600; directories use 0700. Deletion uses small authenticated metadata records per key:

- `<keyHash>.delete` is the durable, permanent deletion intent and publication fence.
- `<keyHash>.accepted` records durable cleanup acceptance and the committed object's authenticated generation, if one existed.
- `<keyHash>.unverified` uses the same record schema and preserves an unreadable object's unknown generation across retries. It is not a terminal-success receipt.

Each record is UTF-8 JSON followed by LF and lowercase HMAC-SHA-256 hex. MAC input is `UTF8("CCC-AUDIO-DELETE\0v1") || JSON bytes` under the master file key. The ordered body fields are `formatVersion`, `keyVersion`, `keyHash`, `deletionAttemptId`, `deletionRequestedAt`, `generationId`, `deletedAt`. Intent has null generation/deleted time. Acceptance has its observed generation or null for never-committed stages and a durable-cleanup acceptance timestamp. These records contain neither audio, raw keys, secret material nor Agent-verified object hashes.

Each record is written to an exclusive temporary file, fsynced, published by a no-overwrite hard link and followed by directory fsync. Existing records are authenticated and reused, not overwritten. The intent is durable before the whole object/staging directory is atomically renamed to `<keyHash>.deleted-<attemptId>` on the same filesystem and the root is fsynced. An in-flight writer's original stage path then cannot be promoted. Publication checks the intent both before and after creating its directory, closing the missing-key race.

Acceptance is persisted before tombstone cleanup. The encrypted tombstone contents are removed and the root fsynced before success is reported. Retry/restart uses the same attempt and accepted generation/time; it resumes an existing tombstone, rather than inferring historical unlink success from absence. A crash after rename but before an acceptance receipt is recorded is recovered as a newly durable cleanup acceptance, not a fabricated original unlink timestamp.

Every delete call freshly computes directory-list absence, metadata `lstat` absence and actual `stat` `ENOENT`, with `verificationMethod: 'filesystem-stat-enoent'`. `objectSha256` stays null because this adapter does not own Agent verification. Corrupt journals, generation reappearance, permission/fsync/rename/cleanup errors or failed observations cannot produce terminal four-true evidence. Per-key journal reconciliation is adapter-owned; scanning DB intents and choosing lifecycle transitions remain the existing core runner's responsibility.

Main's source review found that a corrupt header previously prevented tombstone removal. The corrected path persists `.unverified` before best-effort durable cleanup, removes the ciphertext tombstone, fsyncs the root and freshly measures absence. With unknown generation, `generationId=null`, `objectSha256=null` and `deleteSucceeded=false` remain conservative on this and subsequent attempts, even when all three observed absence booleans are true. `deletedAt` records durable cleanup acceptance, not authenticated generation recovery. This preserves S8's no-false-terminal rule without retaining unreadable audio indefinitely. Genuine journal/filesystem failures still fail closed and require operational repair; absence cannot invent the missing generation.

### Node scheduler boundary

`createNodeScheduler(runner, onError)` consumes the existing `ScheduledJobRunner` and implements `Scheduler`, adding `close()` for service shutdown. It supports the repository's UTC numeric/wildcard/step minute/hour expressions with wildcard day/month/weekday fields, including existing 2m, 5m, 30m and daily schedules. Unsupported syntax fails closed instead of being approximated.

Registration is keyed by job kind. Replacement cancels the old timer without overlapping an in-flight invocation. Following Main's review, delayed ticks run once with the actual `Date.now()` sampled immediately before invoking the runner, not their stale planned instant. Planned time is used only for wake scheduling; busy/suspended intervals do not generate a backlog queue. Completion schedules the next future tick. `close()` stops timers and drains work. Runner failures are reported as only kind, invocation time and `scheduled_job_failed`; a broken error callback stops scheduling and makes close fail safely. No watchdog, retention, expiry, retry, consent or cron business body is duplicated. Runtime assembly still owns startup reconciliation and schedule registration.

### Required platform evidence

Local source/fixture verification does not establish Windows support. E7/E8 still need actual Windows Node and NTFS evidence for exclusive hard links, nofollow checks, private ACL provisioning, directory fsync, rename/unlink with open handles, crash/power-loss recovery and service-account permissions. Unsupported durability operations must fail, not silently fall back to plaintext or weaker evidence. S4's E8-8 reference gate is specifically Windows 11 Pro 24H2 x64 with Node 24.13.3 and its fixed hardware/workload; macOS Node 24.18.0 results cannot close it. DPAPI CurrentUser, alternate-SID restore/key-version handling, service-owned scheduler/watchdog and full profile wiring remain unexercised.

### Source and local verification evidence

- Following Main's review, the existing AudioStore registration passes **33 tests**: the original **20 R2 cases** and **13 filesystem cases**. The added regression corrupts a committed object, proves the encrypted tombstone is physically removed, and proves adapter restart/retry never fabricates a generation or terminal success. Prior boundary, tamper, race and durability coverage remains.
- Node scheduler tests: **4 passed**, including a six-hour late wake that passes actual invocation time and emits only one job without replaying the missed backlog.
- A standalone bundled Node program streamed **209,715,200 bytes** through put/get after reopening the adapter, compared SHA-256, then used an actual minute-boundary Node timer and a synthetic `ScheduledJobRunner` to delete the file. It verified actual `stat` `ENOENT`, generation-bound evidence and deletion replay after reopening. Node **v24.18.0**, **darwin arm64**, maximum emitted chunk **65,536 bytes**, observed process maximum RSS **109,888 KiB**. It exited 0; its source/bundle were removed. This is a real adapter/timer exercise, not execution of the core lifecycle job body or Windows qualification.
- Scoped adapter/fixture TypeScript and existing API TypeScript checks passed, as did core-import and DB-gateway guards. No PostgreSQL or project-wide test suite ran.
- `pnpm exec` originally attempted automatic installation after the workspace manifests appeared and was rejected by frozen-lock validation. Main subsequently transferred a slot limited to the two importers. Ordinary `pnpm install --lockfile-only` produced exactly 12 added importer lines and no external resolution change, committed as `ce76f45`. Lock SHA-256 is `5778503cb6802a05aa1c14591ff7a2a015b100e0c722aa069f3de98e2fdbfcb8`; root `package.json` remains `1afe21070a90efb75d5081e01c8bc5e93f1c7d8d142309f423ae167cc0a8530a`.
- P3 gateway and HTTP source were not edited. Root package and parity hashes remain unchanged. No hosted account, secret, DPAPI, Windows, frontend, design, runtime assembly or installer writer mutation occurred in these adapter slices.

## S9 dependency-independent byte contract checkpoint

S9 §2.2 now has its prescribed `RecoverySecretStore.getBytesWithVersion` in the existing contracts runtime export. Its four literal names exclude provider/Python credentials; it is separate from `SecretStore.get`. `SecretBytes` is exactly mutable `Uint8Array`, and `VersionedSecretBytes` names the existing `{ bytes, version }` shape used by `createFileAudioStore`. Only that consumer's type annotation changes. Caller ownership and `finally` zeroization are explicit. TypeScript's structural `Uint8Array` type cannot itself exclude Node Buffer subclasses; concrete implementations must return plain arrays and wipe native copies.

No speculative payload, journal, authorization, restore service or new secret backend was added. Core/string consumers, encrypted file format and key-version validation are unchanged. There is no new dependency, package export or lockfile change.

Verification: a throwaway typed smoke failed first on the missing exports, then compiled with negative provider/Python/string-port checks. It exercised synthetic byte material through the real encrypted-file adapter, wiped caller material immediately after construction, reopened/decrypted the audio, and wiped material on a failing construction path. Existing AudioStore and environment-secret contracts passed **40 tests**; API TypeScript and core import guard passed. The smoke source and bundle were removed. This proves the independent type/consumer slice, not DPAPI, Windows, native heap erasure or a Recovery Kit implementation.

### Main-owned native dependency fork

The candidate named by the pilot plan is [`@primno/dpapi@2.0.1`](https://registry.npmjs.org/@primno%2Fdpapi/2.0.1), MIT ([license](https://github.com/primno/dpapi/blob/98ab69eb35dcdd1dcf873c528906c534e566136b/LICENSE)), pinned source commit `98ab69eb35dcdd1dcf873c528906c534e566136b`. Published integrity is `sha512-uX756jYkiyHHJU1981oRJMg3FtCGlBGpGcztTs7SFxeh0L/c0aLQcooF61HQ9V3MdaCDPIi8yreN7MlISr4mJg==`; metadata lists Node >=14, runtime dependency `node-gyp-build ^4.8.4` and x64/arm64 prebuild commands. This is source/metadata inspection, not verified binary provenance or Windows compatibility.

Its [API](https://github.com/primno/dpapi/blob/98ab69eb35dcdd1dcf873c528906c534e566136b/lib/index.ts) accepts bytes and exposes CurrentUser. Its [native implementation](https://github.com/primno/dpapi/blob/98ab69eb35dcdd1dcf873c528906c534e566136b/src/dpapi_win.cpp) copies `CryptUnprotectData` plaintext into a Node Buffer and calls `LocalFree` without zeroing the native allocation; allocation/copy failure also lacks RAII cleanup. JS can wipe the returned Buffer after copying to a plain Uint8Array, but cannot repair the already-freed native allocation. Therefore the published binary is not accepted as S9-compliant.

Recommendation to Main: approve this exact package only with audited exception-safe `SecureZeroMemory`/`LocalFree` cleanup, headless flags, and rebuilt verified Windows binaries. A source patch with unchanged published `.node` binaries is insufficient. Alternative: approve an owned minimal N-API CurrentUser-only binding, accepting CCC's native build/provenance maintenance. Waiting for an upstream corrected release avoids a local native patch but leaves implementation blocked. Node crypto has no DPAPI binding; existing SQLite consumes key bytes and env returns strings, neither implements account-bound Windows protection. PowerShell/.NET adds an IPC secret transport/lifetime boundary rather than providing the missing Node primitive.

Main decides this dependency/native ownership fork. No package installation, native build, host secret, account, ACL or credential operation occurred. Actual Windows same-account success, wrong-account/reset refusal, crash-dump policy and cross-SID Kit restore remain unverified. DPAPI persisted record encoding/storage will be reviewed with the chosen native route before any irreversible writer is added; S9's allowed fields do not by themselves fix that encoding.

## S9 approved patched-DPAPI source implementation

Main relayed Q approval for the pinned MIT `@primno/dpapi@2.0.1` package with a native hardening patch and rebuilt binaries, never the unchanged published binary. This resolves the package ownership fork above. The existing backend worktree remains the only writer; no subagents or Windows/account/permission operations are used.

Implementation ownership:
- `patches/@primno__dpapi@2.0.1.patch` patches upstream `src/dpapi_win.cpp` and `src/main.cpp`, not the nonexistent `dpapi.cc`.
- `adapters/secrets-dpapi/src/native.mjs` loads only the adapter-local verified rebuild. `src/store.ts` owns byte lifetimes; public `src/index.ts` does not accept an injected native binding.
- `adapters/secrets-dpapi/scripts/build-native.mjs` verifies source and tool pins, copies only source/license/build inputs, and builds on Windows. `native-provenance.json` pins the source identity and hashes. `native-build/` is ignored and never supplied as a checked-in binary.
- Workspace policy disables dependency lifecycle builds and registers the patch. The root package manifest remains unchanged. New direct pins are DPAPI 2.0.1, node-gyp 11.0.0 (upstream build-tool baseline, MIT) and the already-resolved node-addon-api 8.9.2 (MIT). The lock diff adds 492 lines with no removed/changed prior resolutions.

### Native safety and loading

The patch uses a noncopyable RAII owner with zero-initialized `DATA_BLOB`. Its destructor calls `SecureZeroMemory` before `LocalFree` on every allocated output, including unwinding from Node Buffer allocation/copy failure. This wipes decrypted native allocation as well as encrypted output. Only exact `CurrentUser` is accepted; `CRYPTPROTECT_UI_FORBIDDEN` applies to protect and unprotect. Native Win32 failure details are replaced with `secret_access_denied`. Uint8Array access respects byte subviews. A `cccHardeningVersion=1` native export distinguishes the patched ABI.

The adapter never imports the package's default prebuild selector. `loadNative` requires win32 plus a receipt matching source-provenance hash, platform, architecture, exact Node version and actual rebuilt binary hash, then checks the native hardening marker. An ordinary installation cannot select the package's untouched prebuilds. This is a controlled-build provenance check, not protection against an attacker who can rewrite the application, receipts and binaries together.

### Byte-only record boundary and remaining composition

`createDpapiSecretStore(mode, records)` implements S9's separate recovery byte read port and exposes `protect` and `close`. Only DB/file/PII/Office CA names are accepted. The in-memory protected record has exactly schemaVersion, name, version and blob; no SID, account identifier, path, key text or extra metadata. Positive safe key versions are required; DB/file/PII material is exactly 32 bytes. Single rejects Office CA records. Public material must be plain fixed-buffer Uint8Array, not Buffer/shared/resizable material.

Protect copies caller plaintext, invokes CurrentUser synchronously, returns a plain Uint8Array ciphertext copy and wipes owned input/native output/entropy in finally. Unprotect copies native output into caller-owned plain bytes, validates it and wipes both copies on failure, or only the native copy on success. Caller ownership requires finally-wiping successful output. Caller protected records are copied; close wipes owned copies and rejects later operations. Missing records return null; unprotect failure never generates replacement keys.

Optional DPAPI entropy binds `UTF8("CCC-DPAPI\\0v1\\0" + name + "\\0" + decimalVersion)` to prevent metadata substitution. This is an explicit in-memory protected-record convention awaiting Main's persistence review before records are deployed; no disk encoding, record writer or active-generation pointer is introduced here. Recovery authorization/audit must happen upstream before calls, per S9. The adapter does not authenticate a caller from booleans or pretend a protected record activates a restored generation.

The frozen legacy gateway consumes base64 PII material through `SecretStore.get`; this implementation does not convert the recovery port back into a string port. Legacy string-runtime composition, persistent record encoding and generation activation remain separate Main-owned integration decisions. E4-4b/E4-5 are not declared complete by this source checkpoint.

### Rebuild recipe and exact provenance

On the safely handed-off Windows reference host, use the locked workspace and `pnpm install --frozen-lockfile`, then `pnpm --filter @ccc/secrets-dpapi build:native`. The script requires Windows x64/arm64, verifies all patched source/license hashes, the patch hash and exact node-gyp/node-addon-api versions, then invokes node-gyp with the current Node executable. MSVC C++ Build Tools and compatible Python must already be provisioned by the approved machine handoff; the script does not install tools or modify accounts/ACLs.

The generated receipt records source-provenance digest, OS/architecture, exact Node version, build-tool versions, configured binding.gyp digest and binary SHA-256. It then runs synthetic byte-subview round-trip and LocalMachine rejection. Any failure removes the receipt and emits only `secret_access_denied`, with no vendor output. This is a reproducible pinned-source build procedure, not a claim of bit-identical binaries across unpinned MSVC/Python versions.

- Upstream source commit: `98ab69eb35dcdd1dcf873c528906c534e566136b`.
- Tarball SHA-512 matches `native-provenance.json` and the registry integrity exactly; archive was downloaded as data, not executed.
- Patch SHA-256: `9abd9c6f40fdba17aae8f8bbbc477cd3480256d2782a49e26456fe76539d61b8`.
- Patched dpapi_win.cpp SHA-256: `78d13f387bc58f9e1aabed34815860fd8e0126f43fe546a4d0c8815a5aaa93c5`.
- Patched main.cpp SHA-256: `1c5445869d68ab47518c320997ce982e94f63d3fb2bdefe184aa2c960d804cec`.
- Lock SHA-256: `7e65df790be2394e4a0f896d160500903ad31b958d7cd9ebffe9b77859d694ba`.
- Unchanged root package SHA-256: `1afe21070a90efb75d5081e01c8bc5e93f1c7d8d142309f423ae167cc0a8530a`.

### Exercised evidence and platform blockers

On darwin arm64 Node 24.18.0: 8 synthetic byte/lifetime/loader tests passed, API TypeScript and core-import/DB-gateway guards passed. The loader test simulates module loading to reject missing receipt, changed binary and unpatched marker; it is not Windows evidence. An actual invocation of build-native on this unsupported host returned exit 1, empty stdout and only `secret_access_denied`. Ordinary frozen pnpm install completed without native lifecycle execution.

Still unverified: compiling the patched C++ with Windows headers/MSVC, native allocation-failure cleanup under fault injection, actual CurrentUser same-account round-trip, wrong-account/reset refusal, NTFS/ACL/durability, crash-dump policy, signed release provenance and cross-SID Kit restore. No real key, account, permission or credential changes were performed. Native hardening source is delivered; real Windows qualification must remain pending Main's safe machine handoff.

## D88 schedule display source checkpoint

ADR-0047 §2 is implemented in the gateway and HTTP boundary without frontend or design edits. `allDay` is an explicit boolean and does not derive from the timestamp. `displayColor` is nullable and accepts only `mint`, `lavender`, `coral`, `cyan`, or `light-magenta`.

- Paired forward migrations are `sqlite/0056_schedule_display.sql` (SHA-256 `090e96934e6c44d6ba0a40212406f3eb778c1a24c399d3d14dfd35c1838bf5d1`) and `postgres/0012_schedule_display.sql` (SHA-256 `5475c889867ca8dfdd3acbacdcd664c5dbaa601ee991d11232840d59eca25cb4`). Both store `all_day` as checked 0/1 with default 0; historical midnight appointments remain timed appointments.
- Creation supports both regular and intake schedules. Rescheduling preserves omitted display fields and permits explicit `false`/`null`; terminal transitions preserve the values. Existing permission, status, expected-version and conditional audit checks remain in place.
- Read contracts include individual/next schedules, today/upcoming/month boards, session plans, participant program entries, goal-tree session goals, briefing upcoming schedules, completed-record schedules and self-check schedules. Display fields are also present in mutation audits.
- Final focused create/intake/month/upcoming/session-plan/display run: 6 files, 38 tests passed. Participant goal-tree, self-check and one-page record suites passed. The larger gateway-domain run passed 41 cases and exposed its old exact completed-schedule expectation; that case was updated to exercise non-default display values across completion and passed in a targeted rerun (1 passed, 41 skipped).
- API TypeScript, SQL-dialect, DB-gateway and core-import guards passed. The new SQLite migration was executed against a historical row and its constraints were exercised. No PostgreSQL command was run.
- Main owns PostgreSQL application and parity regeneration on the MacBook. `migrations/parity.yaml` is intentionally unchanged (SHA-256 `66884cd3343f8f8623bbf9ad4dc0b74eea9b8e7a8512b0b039c2eba1d7af075d`); do not treat this source checkpoint as regenerated parity evidence.

S9 remains a separate workstream. Its preceding checkpoint includes native hardening source, a receipt-verified loader, a source rebuild command and the byte-owned in-memory adapter, but not persistent key-record activation or a Recovery Kit writer. Main reports the Windows prerequisite ready: official VS2022 BuildTools 17.14.40 with C++ workload, Windows 11 Pro 64-bit and Node 24.19.0. Compiler/runtime qualification will use a new isolated ASCII directory and leave the STT benchmark directory/task untouched.

## S9 isolated Windows source handoff

The approved implementation remains commit `b743a17383d1cd60e1bc8e1e107a5c26e930f470`; D88 is checkpointed separately as `d60cc89`. No native/source changes or additional dependency decisions were needed to produce this bundle.

- Artifact: `artifacts/s9-dpapi-source-b743a17.tar.gz`, 48,829 bytes, SHA-256 `5cde4e88c9ffda6eed0ca12dc1b195f32c1ebbc90a9e903952276e8f7434d60f`. This is an untracked handoff artifact, not a release binary.
- The archive contains 34 files: the pinned adapter and contracts sources, native patch/provenance, a three-importer lock retaining the exact 87-package dependency closure, per-file hash manifest, and bundle-only Windows proof scripts. It contains no `.node`, `node_modules`, build output, credentials or key records.
- Fresh extraction on darwin arm64 Node 24.18.0 passed frozen offline installation without lifecycle scripts, all 8 synthetic adapter/loader tests, and the public loader's unbuilt refusal check. Archive file hashes were verified before installation. These are not Windows compiler/runtime results.

Main should extract into a new isolated ASCII directory, with Node 24.19.0 and pnpm 11.5.3 available, then run `powershell.exe -NoProfile -File .\run-windows-proof.ps1`. The script stops at the first failing command and does not change accounts, ACLs, execution policy or the STT directory/task:

1. `pnpm install --frozen-lockfile --ignore-scripts`
2. `node adapters/secrets-dpapi/scripts/windows-smoke.mjs --expect-unbuilt`
3. `pnpm --filter @ccc/secrets-dpapi build:native`
4. `pnpm --filter @ccc/secrets-dpapi test`
5. `node adapters/secrets-dpapi/scripts/windows-smoke.mjs`

Step 2 must reject the unbuilt adapter even though the upstream package has been installed. Step 3 copies only hash-verified patched source and explicitly compiles it; the loader accepts only the resulting receipt-bound binary with the hardening marker. Its receipt binds source provenance, actual Node version, OS, architecture and binary hash. Step 5 exercises the public adapter with three synthetic 32-byte values, independent caller-owned reads, metadata substitution refusal and closed-store refusal. It writes no key records and emits no material.

Implemented: patched CurrentUser-only native operations with fixed errors and wiped native output; byte-owned protect/read primitive; pinned-source rebuild recipe; verified rebuilt-only loader. Not implemented: persisted record encoding/storage, generation writer/active pointer, authorization/audit composition, Recovery Kit writer/restore, or legacy string-runtime composition. The approved integration boundary still requires Main's persistence review before an irreversible writer; an independently replaced per-key file would violate S9 §2.8's single-generation activation contract. Native compilation/runtime, wrong-account/reset, allocation-failure, NTFS/ACL and cross-SID recovery proofs remain Main-owned and unverified here.

## D88 authoritative parity checkpoint registration correction

Main's PostgreSQL run stopped before SQL because `checkpointSources()` still ended at `0011`. Added the `schedule-display` checkpoint pairing SQLite `0056_schedule_display.sql` with PostgreSQL `0012_schedule_display.sql`; both exact migration-list equality checks remain unchanged. No manifest hashes were written or regenerated here.

The live parity loop now seeds a legal historical midnight schedule before that checkpoint and runs the same semantic proof on both engines after migration. It proves preserved timestamp/defaults, non-midnight all-day data, all five allowed colors, rejected integer/null/color domains, rejection atomicity and explicit reset to timed/null. The local regression replays the complete registered SQLite chain into encrypted SQLite and executes that shared proof. All five D88 display tests, API TypeScript and DB-gateway/core-import guards passed. PostgreSQL execution and manifest generation remain Main's next action.

## S9 persistent-source continuation plan

Main reported real Windows qualification of the approved source bundle: Windows 11 Pro x64, Node 24.19.0, VS 17.14.40, rebuilt binary SHA-256 `b6e5d78bacbb365857c41a4a93753ad02d0cbbbc4997f163ccd84dc3e6597f25`. The final Node contracts had 7 passes, no failures and one platform-specific skip; the public adapter smoke verified three synthetic keys, version binding, owned bytes and closed-store refusal. The first PowerShell capture wrapper reported RemoteException after binary/receipt creation; Main did not reinstall/rebuild and the direct final tests passed. This is reported Windows evidence, not an additional run in BACKEND; persistence and Recovery Kit were explicitly false.

Implementation order follows S9 in full, without new external dependencies:

1. Canonical PII consumer: change the Core/runtime secret contract to require `getBytesWithVersion('PII_ENC_KEY')`, prohibit PII through string `get`, and import caller-owned 32-byte material directly into non-extractable WebCrypto keys with `finally` wiping. Retain `PII_KEY_VERSION` as nonsecret generation metadata and reject mismatches. Decode provider-injected base64 only in `adapters/secrets-env`; Local protected material never becomes a string. Migrate all consumers and synthetic fixtures.
2. `adapters/secrets-dpapi` persistence: deterministic binary protected records contain only schema/name/version/blob. Generation directories hold immutable staged records; there is no independent per-key active pointer. Reuse filesystem no-follow/private-path/flush/reopen patterns and reject ambiguous state. Tests use synthetic native bindings and actual temporary files.
3. Recovery Kit: implement the strict canonical CBOR payload and standalone CCCR envelope from S9, using existing canonical JSON and Node's built-in Argon2id/AES-GCM. Bound parsing, exact schemas, fresh CSPRNG salt/nonce, byte-only passphrase handling and all-path wiping are required. No JSON/base64 secret payload or published crypto package is introduced.
4. Generation application service: authorization/audit must precede reads, fence acquire/drain precedes snapshots, all component evidence precedes a single pointer flip, and rollback/restart must preserve the old generation. Source must not promote supplied boolean reports into authorization or full-content evidence. The inspected code has no recovery capability issuer, online signed clean-target floor/TPM redemption client, or existing Local generation runtime. Those concrete authority and component integrations must be identified rather than fabricated before operational restore can be claimed.

The E4-6 legacy-consent cutover is queued after the next S9 safe source checkpoint. Its first action is a seam/contract report, not adding a boolean consent gate or creating new schema without Main's resolution.

### Canonical PII byte-consumer checkpoint

The immutable PII path is removed from both `SecretStore.get` and `CoreSecretStore.get`. Core now requires `getBytesWithVersion('PII_ENC_KEY')`, validates 32-byte plain owned material and the configured generation, imports a non-extractable WebCrypto key without a JS key copy, and wipes supplied material in `finally`, including import/validation failure. `PII_KEY_VERSION` remains nonsecret metadata; mismatch fails closed.

Only the environment/provider adapter decodes its existing injected base64 string, directly into mutable bytes rather than an `atob` binary string. Seed and Community Cloud composition now pass the same key-version metadata to adapter and core. The protected Local path needs no conversion into an immutable string.

A real gateway regression first failed at the forbidden string read, then passed byte-only encrypt/decrypt, caller-buffer wiping and mismatched-version refusal without replacing saved PII. Final verification: 30 tests across environment contracts, PII/Worker integration and Community Cloud runtime; API TypeScript, DB-gateway and core-import guards passed. This completes the canonical consumer seam, not persistent storage, generation activation or Recovery Kit restore.
