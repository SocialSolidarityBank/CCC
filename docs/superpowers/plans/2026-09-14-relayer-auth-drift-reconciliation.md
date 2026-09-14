# relayer Auth Drift Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 설치된 hosted Community Cloud에서 승인된 `disable_signup=true`와 정확한 수동 여섯 자리 초대 템플릿만 증명한 뒤, 공급자 설정은 바꾸지 않고 기존 설치 journal의 승인 이력과 상태 지문을 원자적으로 채택한다.

**Architecture:** `scripts/supabase/auth-config.mjs`가 초대 템플릿 literal, bounded Auth key 순서, 현재 및 과거 Auth fingerprint 계산을 한 곳에서 소유한다. hosted inspector와 전용 plan proof가 현재 상태와 `disable_signup=false`였던 이전 설치 상태를 재현하고, 기존 advisory lock 뒤 같은 proof를 다시 확인한 다음 `install-journal.mjs`가 기존 세 표만 한 transaction으로 전진시킨다. `bootstrap.mjs`와 `scripts/onboarding/cloud.mjs`는 이 좁은 동작만 연결하며 normal doctor와 apply의 fail-closed 규칙은 그대로 둔다.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, Node `crypto`, 기존 Supabase Management API read-only inspector, `postgres.js`, 기존 signed manifest/approval 검증과 설치 journal.

**Spec:** [relayer Auth 드리프트 정합화 설계](../specs/2026-09-14-relayer-auth-drift-reconciliation-design.md)

## Global Constraints

- 구현 전 `scripts/supabase/**`의 현재 S11 설치 작성자와 단일 작성 슬롯을 확정한다. onboarding 레인은 `scripts/onboarding/**`만 독립적으로 수정한다.
- 공개 명령은 `node scripts/onboarding/cloud.mjs reconcile-auth-config` 하나다. `target='hosted'`인 이미 설치된 Community Cloud만 허용한다.
- normal `doctor`, `plan`, `apply`와 기존 `renew-authorization`의 drift fail-closed 동작을 완화하거나 우회하지 않는다.
- 공급자 접근은 기존 Management Auth GET과 `database/query/read-only`의 `SELECT`만 허용한다. Auth PATCH, 초대, 사용자 생성, 템플릿 수정, migration, release, deployment와 다른 provider write는 0건이어야 한다.
- 첫 정합화는 현재 시각에 유효한 fresh higher-sequence signed manifest/approval pair를 요구한다. 같은 sequence는 정확한 durable 완료 증거를 읽는 idempotent repeat에서만 허용한다.
- `private.ccc_install_authorizations`와 `private.ccc_release_history`의 기존 행, 기존 completed step, receipt, resource와 migration 행은 수정하거나 삭제하지 않는다.
- journal UPDATE는 `runtime_manifest_sha256`, `approval_sha256`, `runtime_sequence`, `expires_at`, `state_fingerprint`, `updated_at`만 허용한다.
- schema migration, 새 table, 새 column, 새 dependency, 새 provider adapter, generalized drift framework, UI, API, core/contracts, release artifact와 lockfile 변경을 만들지 않는다.
- 운영 secret의 SecretStore 정본 이름은 `RELAYER_*`다. 기존 코드 입력인 `CCC_*`와 `SUPABASE_*`는 유지하고 외부 process injection 경계에서만 매핑한다. 이 구현은 alias 계층, secret 조회, 저장 또는 전역 식별자 개명을 추가하지 않는다.
- 템플릿 body, provider body, project ref, 기관/owner ID, URL, manifest, approval, signature, token, 연결 문자열과 provider 원문 오류는 출력, journal, log와 exception message에 넣지 않는다.
- 테스트는 synthetic provider와 기존 loopback disposable PostgreSQL harness만 사용한다. live Supabase, Infisical, 실제 journal, 이메일과 배포 환경을 사용하지 않는다.
- 각 작업은 새 테스트를 먼저 작성하고, 지정한 이유로 실패하는 출력을 직접 확인한 뒤에만 production code를 수정한다. 같은 테스트가 통과한 뒤 다음 작업으로 간다.

---

## File Responsibilities

| File | Responsibility |
|---|---|
| `scripts/supabase/auth-config.mjs` | exact 408-byte invite template, bounded Auth key order, missing-to-`null` normalization, current/prior Auth fingerprint와 exact template evidence의 단일 정본 |
| `scripts/supabase/auth-config.test.mjs` | exact byte/hash, key order, missing normalization, prior fingerprint와 mismatch matrix의 pure unit tests |
| `scripts/onboarding/first-admin.mjs` | 로컬 template literal을 제거하고 shared Auth evidence로 기존 readiness code를 유지 |
| `scripts/onboarding/first-admin.test.mjs` | shared literal/evidence를 소비하며 기존 invite readiness와 zero-send 회귀를 유지 |
| `scripts/supabase/hosted-inspector.mjs` | 기존 Auth GET에서 shared fingerprint와 body가 없는 redacted reconciliation evidence를 생성 |
| `scripts/supabase/plan.mjs` | 기존 doctor를 그대로 실행한 뒤 exact drift set, prior/current state fingerprint와 pre-lock proof digest를 계산 |
| `scripts/supabase/plan.test.mjs` | only-`disable_signup` proof, unrelated drift, blocker precedence와 same-pair readback candidate 검사 |
| `scripts/supabase/install-journal.mjs` | 기존 세 table을 사용하는 atomic authorization/step/pointer transaction과 exact readback |
| `scripts/supabase/install-journal.test.mjs` | disposable PostgreSQL에서 원자성, append-only 보존, idempotency, partial evidence와 response-loss 회귀 |
| `scripts/supabase/bootstrap.mjs` | signed pair, inspector, proof, advisory lock, transaction, post-commit doctor와 exact redacted result를 한 operation으로 연결 |
| `scripts/supabase/bootstrap.test.mjs` | hosted-only orchestration, lock 뒤 재관찰, postcheck, allowed read requests와 모든 provider/email write 0 검사 |
| `scripts/onboarding/cloud.mjs` | N02 입력 검증과 생성 대상 binding을 유지하며 공개 `reconcile-auth-config` 명령을 bootstrap에 연결 |
| `scripts/onboarding/cloud.test.mjs` | 공개 CLI의 exact stdout/stderr, 입력 거부, redaction과 no-write 회귀 |

변경 금지 범위는 `apps/**`, `packages/**`, `migrations/**`, `docs/specs/**`, `docs/adr/**`, release artifacts, root `package.json`, `pnpm-lock.yaml`, UI/CSS/DESIGN 파일이다.

## Shared Interfaces

Task 1에서 아래 이름과 shape를 확정하고 이후 작업은 그대로 사용한다.

```js
export const BOUNDED_AUTH_CONFIG_KEYS;
export const RELAYER_INVITE_TEMPLATE_HTML;

export function boundedAuthConfig(authConfig);
// plain object -> key order가 BOUNDED_AUTH_CONFIG_KEYS와 같은 object
// missing key -> null, non-object -> null

export function authConfigFingerprint(authConfig);
// valid object -> lowercase SHA-256, non-object -> null

export function inspectAuthConfig(authConfig);
// {
//   readable: boolean,
//   disableSignup: boolean,
//   inviteTemplateExact: boolean,
//   inviteTemplateSha256: string,
//   currentAuthFingerprint: string | null,
//   priorAuthFingerprint: string | null,
// }
```

Task 2가 다음 내부 proof를 생산한다. raw Auth config와 template body는 포함하지 않는다.

```js
export async function buildAuthConfigReconciliationProof({
  target,
  inspector,
  authorization,
  providerBaseline,
  release,
  now = Date.now,
});

// {
//   mode: 'pending' | 'already-reconciled',
//   authorization: {
//     installationId: string,
//     institutionIdHash: string,
//     projectRefHash: string,
//     expectedOwnerOrgIdHash: string,
//     runtimeManifestSha256: string,
//     approvalSha256: string,
//     runtimeConfigurationSha256: string,
//     contractVersion: string,
//     runtimeSequence: number,
//     expiresAt: string,
//   },
//   installState: object,
//   runtimeSequence: number,
//   priorStateFingerprint: string,
//   currentStateFingerprint: string,
//   inviteTemplateSha256: string,
//   proofFingerprint: string,
// }
```

Task 3은 다음 transaction API 하나를 추가한다.

```js
export async function reconcileAuthConfigJournal(
  session,
  authorization,
  {
    priorStateFingerprint,
    currentStateFingerprint,
    inviteTemplateSha256,
  },
  { authorize } = {},
);

// 최초 성공: { code: 'AUTH_CONFIG_RECONCILED', changed: true }
// exact repeat: { code: 'AUTH_CONFIG_ALREADY_RECONCILED', changed: false }
```

Task 4의 공개 성공 결과는 아래 exact key만 가진다.

```js
{
  schemaVersion: 1,
  operation: 'reconcile-auth-config',
  target: 'hosted',
  status: 'reconciled' | 'already-reconciled',
  code: 'AUTH_CONFIG_RECONCILED' | 'AUTH_CONFIG_ALREADY_RECONCILED',
  changed: boolean,
  installationIdSha256: string,
  runtimeSequence: number,
  priorStateFingerprint: string,
  stateFingerprint: string,
  inviteTemplateSha256: string,
}
```

오류 stdout은 비우고 stderr에는 `{"error":{"code":"FIXED_CODE"}}`와 newline만 쓴다.

---

### Task 1: Centralize the Exact Auth Configuration

**Files:**
- Create: `scripts/supabase/auth-config.mjs`
- Create: `scripts/supabase/auth-config.test.mjs`
- Modify: `scripts/onboarding/first-admin.mjs` at `FIRST_ADMIN_INVITE_TEMPLATE` and `createSupabaseAuthAdmin().inviteTtlSeconds()`
- Modify: `scripts/onboarding/first-admin.test.mjs` at `inviteTemplate` and the readiness variants

**Interfaces:**
- Produces: `BOUNDED_AUTH_CONFIG_KEYS`, `RELAYER_INVITE_TEMPLATE_HTML`, `boundedAuthConfig(authConfig)`, `authConfigFingerprint(authConfig)`, `inspectAuthConfig(authConfig)` from Shared Interfaces.
- Preserves: `createSupabaseAuthAdmin(options)` and `inviteTtlSeconds(): Promise<number>` signatures and existing `FIRST_ADMIN_OPEN_SIGNUP_ENABLED`, `FIRST_ADMIN_INVITE_TEMPLATE_UNREADY`, `PROVIDER_UNREADABLE` failures.

- [ ] **Step 1: Write the shared-module tests before the module exists**

Create these exact tests in `scripts/supabase/auth-config.test.mjs`:

```js
test('exact invite template is 408 UTF-8 bytes with the approved SHA-256', () => {});
test('bounded Auth config preserves the approved key order and normalizes missing values to null', () => {});
test('prior Auth fingerprint changes only disable_signup to false', () => {});
test('invite template evidence rejects every non-byte-equal body', async t => {});
```

The mismatch subtests are `missing`, `one-byte`, `ConfirmationURL`, `TokenHash`, `query`, `fragment`, and `trailing-newline`. Import `RELAYER_INVITE_TEMPLATE_HTML` for transformations. Do not paste the HTML into the test.

Update `scripts/onboarding/first-admin.test.mjs` to import `RELAYER_INVITE_TEMPLATE_HTML`, remove the local `inviteTemplate` literal, use the shared export for the ready provider response, and retain the existing test name `정확하지 않은 초대 템플릿이면 Auth 초대를 보내지 않는다` with at least one byte-different response and `sends === 0`.

- [ ] **Step 2: Run the tests and watch the intended red failure**

Run:

```bash
node --test scripts/supabase/auth-config.test.mjs scripts/onboarding/first-admin.test.mjs
```

Expected: FAIL before any production edit because `scripts/supabase/auth-config.mjs` or its named exports do not exist. A parse error, fixture error, network request or unrelated first-admin failure is not the intended red state and must be fixed in the tests before proceeding.

- [ ] **Step 3: Implement the single literal and pure helpers**

Use Node `createHash` only. Define the exact key array in this order and do not sort it:

```js
export const BOUNDED_AUTH_CONFIG_KEYS = Object.freeze([
  'disable_signup',
  'external_anonymous_users_enabled',
  'external_email_enabled',
  'mailer_autoconfirm',
  'mfa_max_enrolled_factors',
  'mfa_totp_enroll_enabled',
  'mfa_totp_verify_enabled',
  'refresh_token_rotation_enabled',
  'security_captcha_enabled',
  'jwt_exp',
  'site_url',
  'sessions_single_per_user',
]);
```

Move the existing first-admin literal into the shared module with this exact content and no terminal newline:

```js
export const RELAYER_INVITE_TEMPLATE_HTML = [
  '<h2>Relayer 관리자 초대</h2>',
  '<p>아래 링크를 열고 이 이메일 주소와 여섯 자리 인증 코드를 입력해 관리자 계정을 설정하세요.</p>',
  '<p><a href="{{ .RedirectTo }}">관리자 계정 설정</a></p>',
  '<p>인증 코드: <strong>{{ .Token }}</strong></p>',
  '<p>이 코드는 한 번만 사용할 수 있으며 만료되면 설치 담당자에게 새 초대를 요청해 주세요.</p>',
].join('\n');
```

`inspectAuthConfig()` must compute `inviteTemplateSha256` from that runtime string, not from a second hash literal. It must compare `mailer_templates_invite_content` to the string with `===` before reporting the hash.

For a plain object, `boundedAuthConfig()` must use `Object.fromEntries(BOUNDED_AUTH_CONFIG_KEYS.map(key => [key, authConfig[key] ?? null]))`. `authConfigFingerprint()` must hash the UTF-8 bytes of `JSON.stringify(boundedAuthConfig(authConfig))`. `inspectAuthConfig()` must copy the bounded object, replace only `disable_signup` with `false`, and fingerprint that copy for `priorAuthFingerprint`; all other key values and insertion order must remain unchanged.

- [ ] **Step 4: Move first-admin readiness to the shared evidence**

Delete `FIRST_ADMIN_INVITE_TEMPLATE` from `scripts/onboarding/first-admin.mjs`. In `inviteTtlSeconds()` call `inspectAuthConfig(value)` once, then apply this order:

```js
if (!evidence.readable) fail('PROVIDER_UNREADABLE');
if (!evidence.disableSignup) fail('FIRST_ADMIN_OPEN_SIGNUP_ENABLED');
if (!evidence.inviteTemplateExact) fail('FIRST_ADMIN_INVITE_TEMPLATE_UNREADY');
```

Keep the existing `mailer_otp_exp` validation and return value. Do not export a second readiness wrapper or retain any copy of the template.

- [ ] **Step 5: Run the focused tests and watch them turn green**

Run the same command from Step 2.

Expected: PASS. The pure test must assert byte length `408`, no trailing newline, and `inviteTemplateSha256 === '6b5639d037932528297ebba1becf112e8b10c49e85caef0b10c9e25447c72c55'`. The first-admin mismatch regression must still prove zero invite POSTs.

- [ ] **Step 6: Commit this independently reviewable extraction**

```bash
git add scripts/supabase/auth-config.mjs scripts/supabase/auth-config.test.mjs scripts/onboarding/first-admin.mjs scripts/onboarding/first-admin.test.mjs
git commit -m "refactor(supabase): centralize exact Auth configuration"
```

---

### Task 2: Prove the Only Allowed Hosted Auth Drift

**Files:**
- Modify: `scripts/supabase/hosted-inspector.mjs` at hosted Auth normalization inside `createHostedInspector().inspect()`
- Modify: `scripts/supabase/plan.mjs` at `safeFailures`, reconciliation proof helper, and existing doctor composition
- Modify: `scripts/supabase/plan.test.mjs` with an installed Auth reconciliation fixture
- Modify: `scripts/supabase/bootstrap.test.mjs` only for hosted inspector request/evidence coverage in this task

**Interfaces:**
- Consumes: `inspectAuthConfig(authConfig)` and `authConfigFingerprint(authConfig)` from Task 1.
- Produces: `buildAuthConfigReconciliationProof(options)` from Shared Interfaces.
- Preserves: `createHostedInspector(options)`, `buildSupabasePlan(options)`, `buildSupabaseDoctor(options)`, `installationStateFingerprint(snapshot, providerBaseline)` and all existing normal doctor/apply behavior.

- [ ] **Step 1: Add the reconciliation proof tests first**

Add these exact tests:

```js
test('hosted Auth observation exposes only reconciliation hashes and booleans', async () => {});
test('Auth reconciliation proof accepts only disable_signup drift with the exact template', async () => {});
test('Auth reconciliation proof rejects unrelated state drift before any writable result', async t => {});
test('Auth reconciliation proof preserves the first existing non-drift doctor blocker', async t => {});
test('Auth reconciliation proof accepts a clean same-pair state only as an idempotent candidate', async () => {});
```
Place `hosted Auth observation exposes only reconciliation hashes and booleans` in `scripts/supabase/bootstrap.test.mjs`. Place the other four proof tests and `authReconciliationFixture()` in `scripts/supabase/plan.test.mjs`.

Use an `authReconciliationFixture()` helper in `plan.test.mjs`. Start from the existing installed receipt/provider fixture, set the journal Auth fingerprint from `disable_signup=false`, set the current synthetic provider config to `disable_signup=true` plus `RELAYER_INVITE_TEMPLATE_HTML`, and issue a fresh pair whose `runtimeSequence` is strictly larger while all stable bindings remain equal.

The unrelated-drift subtests must mutate one item at a time: another bounded Auth key, database fingerprint, policy fingerprint, bucket fingerprint, cron count, provider object inventory, and provider grant inventory. The existing-blocker subtests must cover `PROVIDER_BASELINE_MISMATCH`, `RESOURCE_OWNERSHIP_MISMATCH`, `MIGRATION_CHECKSUM_MISMATCH`, receipt failure and release failure. Each assertion expects the existing fixed code, not a generic reconciliation code.

- [ ] **Step 2: Run the focused tests and confirm the missing-proof failure**

Run:

```bash
node --test --test-name-pattern='hosted Auth observation|Auth reconciliation proof' scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs
```

Expected: FAIL because `buildAuthConfigReconciliationProof` and hosted reconciliation evidence do not exist. Existing doctor tests must not be changed to accept drift.

- [ ] **Step 3: Make hosted Auth fingerprinting consume the shared module**

In `createHostedInspector().inspect()`, replace the local bounded Auth key construction with one call to `inspectAuthConfig(authConfig)`. If `readable` is false or `currentAuthFingerprint` is null, keep the normal inspector failure as `PROVIDER_UNREADABLE`.

Set `state.authFingerprint` to `currentAuthFingerprint` and add only this internal safe property to the returned observation:

```js
authConfigEvidence: {
  disableSignup,
  inviteTemplateExact,
  inviteTemplateSha256,
  currentAuthFingerprint,
  priorAuthFingerprint,
}
```

Do not return the bounded object, raw `site_url`, raw provider config or template body. Keep the generic `fingerprint()` export because local inspector and public-data fingerprinting already consume it.

- [ ] **Step 4: Implement the narrow proof builder without changing doctor**

Add these three reconciliation failures to `safeFailures`: `AUTH_RECONCILE_TEMPLATE_MISMATCH`, `AUTH_RECONCILE_AUTH_STATE_MISMATCH`, and `AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH`. The existing `INSTALL_AUTHORIZATION_MISMATCH`, `INSTALL_STEP_MISMATCH`, and `INSTALL_JOURNAL_INVALID` mappings remain unchanged. Do not replace an existing doctor code with a reconciliation code.

`buildAuthConfigReconciliationProof()` must:

1. Reject any target other than `hosted` with `TARGET_UNSUPPORTED` before calling `inspector.inspect()`.
2. Run `buildSupabaseDoctor({ ...options, renewAuthorization: true })` through a capturing inspector and keep every synthetic read-only observation used by that doctor call.
3. Require an installed journal and exact signed stable binding. Map `authConfigEvidence.readable !== true`, `disableSignup !== true`, or null current/prior Auth fingerprints to `AUTH_RECONCILE_AUTH_STATE_MISMATCH`. Map `inviteTemplateExact !== true` to `AUTH_RECONCILE_TEMPLATE_MISMATCH`. Require `currentAuthFingerprint === observation.state.authFingerprint` for every captured observation; disagreement between those two shared calculations is `PLAN_STATE_CHANGED`.
4. Clone each observation, replace only `state.authFingerprint` with `priorAuthFingerprint`, and call the existing `installationStateFingerprint()` for both prior and current values.
5. Require every captured prior/current fingerprint and every captured `installState` digest to be stable. Any change between reads is `PLAN_STATE_CHANGED`.
6. Require `priorStateFingerprint === journal.stateFingerprint` for a pending reconciliation, otherwise throw `AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH`. Also require `currentStateFingerprint !== priorStateFingerprint`; equality is `AUTH_RECONCILE_AUTH_STATE_MISMATCH`.
7. For a fresh higher sequence, require the doctor blocker set to be exactly `DRIFT_BLOCKED` and `DRIFT_DETECTED`, ignoring order. If any other blocker exists, throw the first such code in the existing doctor order.
8. For the same manifest, approval and sequence, require a clean normal doctor and mark only `mode: 'already-reconciled'`; Task 3 must still verify durable authorization and step evidence. Lower sequence, same sequence with another pair, or changed stable binding is `INSTALL_AUTHORIZATION_MISMATCH`.
9. Compute `proofFingerprint` with existing `hashCanonical()` over this exact object, then return only the safe Shared Interfaces shape:

```js
{
  mode,
  authorization: {
    installationId: authorization.installationId,
    institutionIdHash: authorization.institutionIdHash,
    projectRefHash: authorization.projectRefHash,
    expectedOwnerOrgIdHash: authorization.expectedOwnerOrgIdHash,
    runtimeManifestSha256: authorization.runtimeManifestSha256,
    approvalSha256: authorization.approvalSha256,
    runtimeConfigurationSha256: authorization.runtimeConfigurationSha256,
    contractVersion: authorization.contractVersion,
    runtimeSequence: authorization.runtimeSequence,
    expiresAt: authorization.expiresAt,
  },
  installState,
  priorStateFingerprint,
  currentStateFingerprint,
  inviteTemplateSha256,
}
```

Do not add template content to `installationStateFingerprint()`. The existing durable Auth fingerprint calculation must remain reproducible for installations created before this change.

- [ ] **Step 5: Run the focused proof tests and existing drift tests**

Run:

```bash
node --test --test-name-pattern='hosted Auth observation|Auth reconciliation proof|Auth drift|doctor' scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs
```

Expected: PASS. The captured request list must contain only Management GETs and POSTs to `/database/query/read-only`, and every query body must begin with `SELECT`. JSON serialization of observation/plan/proof must not contain template body, `site_url`, project ref, owner/institution IDs or synthetic secret fixtures.

- [ ] **Step 6: Commit the proof layer**

```bash
git add scripts/supabase/hosted-inspector.mjs scripts/supabase/plan.mjs scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs
git commit -m "feat(supabase): prove exact Auth drift reconciliation"
```

---

### Task 3: Reconcile the Existing Install Journal Atomically

**Files:**
- Modify: `scripts/supabase/install-journal.mjs` at `buildInstallStateQuery()` and add `reconcileAuthConfigJournal()` beside authorization renewal
- Modify: `scripts/supabase/install-journal.test.mjs` using the existing `withDatabase`, `authorization`, `desired` and loopback-only fixture guard

**Interfaces:**
- Consumes: fresh or same signed authorization plus the three SHA-256 values from Task 2.
- Produces: `reconcileAuthConfigJournal(session, authorization, evidence, { authorize })` from Shared Interfaces.
- Preserves: existing metadata schema, append-only guards, `ensureAuthorization()`, provider step primitives and every existing table.

- [ ] **Step 1: Write disposable PostgreSQL failures and success cases first**

Add an `installedAuthReconciliationFixture(session, overrides = {})` helper that uses the existing bootstrap helpers, moves the journal to `phase='installed'`, records representative completed step/resource/migration/receipt/release rows, and snapshots every table before the operation. Do not create a new fixture file or database schema.

Add these exact tests:

```js
databaseTest('Auth reconciliation appends one authorization and completed step atomically', async () => {});
databaseTest('Auth reconciliation preserves every existing append-only installation row', async () => {});
databaseTest('Auth reconciliation rolls back all three mutations when authorization changes before commit', async () => {});
databaseTest('Auth reconciliation exact repeat reads durable evidence without writes', async () => {});
databaseTest('Auth reconciliation recovers a lost response from durable evidence without duplicate writes', async () => {});
databaseTest('Auth reconciliation rejects partial or conflicting readback without repair', async t => {});
databaseTest('Auth reconciliation rejects stale and mismatched signed pairs without writes', async t => {});
```

The partial/conflicting subtests must cover missing authorization history, missing step, wrong idempotency key, wrong digest order, wrong state fingerprint, null or unequal timestamps, and a same-sequence different manifest/approval. For every failure, compare all table row counts and the journal row before/after.

- [ ] **Step 2: Run the journal tests and confirm the named export is red**

Precondition: `CCC_INSTALL_JOURNAL_TEST_DATABASE_URL` already points to the existing empty loopback database whose name includes `test`, `fixture` or `disposable`.

Run:

```bash
node --test --test-name-pattern='Auth reconciliation' scripts/supabase/install-journal.test.mjs
```

Expected: FAIL before production edits because `reconcileAuthConfigJournal` is not exported. Any non-loopback fixture admission, existing object or connection failure is not the intended red state.

- [ ] **Step 3: Extend readback with the timestamp evidence already stored**

In `buildInstallStateQuery()`, add `startedAt` from `step.started_at` beside `completedAt`. This is a read-only shape extension from an existing column, not a schema change. Keep ordering by completed time and step.

- [ ] **Step 4: Implement the exact transaction and readback**

Validate that evidence has exactly `priorStateFingerprint`, `currentStateFingerprint`, and `inviteTemplateSha256`, all lowercase SHA-256. Compute:

```js
const idempotencyKey = await hashCanonical({
  operation: 'reconcile-auth-config',
  installationId: authorization.installationId,
  priorStateFingerprint,
  currentStateFingerprint,
  inviteTemplateSha256,
});
```

Use the existing `installTransaction()` pattern. Inside one transaction:

1. `SELECT ... FOR UPDATE` the journal and require `phase='installed'`.
2. Verify stable installation, institution, project, owner, runtime configuration, contract, resources, migrations and plan fingerprint bindings.
3. Call `authorize()` before writes and again immediately before commit. Both fresh results must be the same signed pair and still valid.
4. If the incoming sequence is higher, require `priorStateFingerprint === journal.state_fingerprint`, insert the authorization-history row, read one `clock_timestamp()` value, insert one completed `auth_config` step with empty ownership/resource ID arrays and exact digest order `[priorStateFingerprint, currentStateFingerprint, inviteTemplateSha256]`, then update only the allowed journal pointer columns and `state_fingerprint`.
5. If the incoming sequence equals the journal sequence and pair, perform no INSERT or UPDATE. Read the exact authorization row and exact completed step by the calculated idempotency key, require both timestamps to be valid and equal, and require current journal pointer/state fingerprint to match.
6. Map authorization INSERT conflicts to `INSTALL_AUTHORIZATION_MISMATCH`, step conflicts/content mismatches to `INSTALL_STEP_MISMATCH`, and malformed/missing journal structure to `INSTALL_JOURNAL_INVALID`. Do not catch and rewrite existing owner or authorization failures.

The completed step INSERT must set these exact values:

```js
{
  step: 'auth_config',
  idempotencyKey,
  status: 'completed',
  ownershipTags: [],
  providerResourceIdHashes: [],
  providerResourceDigests: [priorStateFingerprint, currentStateFingerprint, inviteTemplateSha256],
  stateFingerprint: currentStateFingerprint,
  startedAt: transactionTimestamp,
  completedAt: transactionTimestamp,
}
```

Do not call `startInstallStep()` or `completeInstallStep()`: their normal provider-step contract rejects a second `auth_config` idempotency key and updates phase/current step. This approved reconciliation inserts a second historical completed `auth_config` row directly while leaving phase/current step unchanged.

- [ ] **Step 5: Prove green, rollback and idempotent response-loss recovery**

Run the command from Step 2.

Expected: PASS. First success adds exactly one authorization row and one completed step, changes only allowed journal columns, and leaves all existing rows byte-equivalent. Repeat and simulated post-commit response loss return `AUTH_CONFIG_ALREADY_RECONCILED` with no row/value changes. Every injected failure leaves all three intended mutations rolled back.

- [ ] **Step 6: Commit the journal transaction**

```bash
git add scripts/supabase/install-journal.mjs scripts/supabase/install-journal.test.mjs
git commit -m "feat(supabase): reconcile Auth journal atomically"
```

---

### Task 4: Route Bootstrap and the Public Onboarding Command

**Files:**
- Modify: `scripts/supabase/bootstrap.mjs` at `exitCodes`, `parseArgs()`, `runSupabaseBootstrap()`, exact result serialization and `main()` exit handling
- Modify: `scripts/supabase/bootstrap.test.mjs` with synthetic Management API and disposable journal integration cases
- Modify: `scripts/onboarding/cloud.mjs` at `runCreatedInstallation()`, help/operation allowlists and `main()` routing
- Modify: `scripts/onboarding/cloud.test.mjs` at the child-process CLI harness and no-write assertions

**Interfaces:**
- Consumes: `buildAuthConfigReconciliationProof()` from Task 2 and `reconcileAuthConfigJournal()` from Task 3.
- Preserves: `runSupabaseBootstrap(options, guards)`, `runCreatedInstallation(options)`, N02 request/journal/installation parsing and every existing operation.
- Produces: public `node scripts/onboarding/cloud.mjs reconcile-auth-config` behavior and the exact success/error shapes from Shared Interfaces.

- [ ] **Step 1: Add bootstrap and CLI tests before routing exists**

Add these exact tests:

```js
test('reconcile-auth-config rejects non-hosted targets before observation or writes', async () => {});
test('reconcile-auth-config rechecks the complete proof after the advisory lock', async t => {});
test('reconcile-auth-config reports first success and exact repeat with fixed redacted keys', async () => {});
test('reconcile-auth-config keeps provider and email write endpoints at zero', async () => {});
test('reconcile-auth-config reports the first unrelated doctor blocker without journal writes', async t => {});
test('Cloud CLI routes reconcile-auth-config with the existing N02 inputs only', async () => {});
test('Cloud CLI emits one exact redacted reconciliation result', async () => {});
test('Cloud CLI emits only the fixed error code and empty stdout on reconciliation failure', async t => {});
```

Reuse `withManagementApi()`, `signedCliInputs()`, `bootstrap-fetch-shim.test.mjs`, the N02 synthetic request/creation journal fixture and the same loopback disposable PostgreSQL fixture. Extend the fake Auth response with `RELAYER_INVITE_TEMPLATE_HTML`. Record requests as `{ method, path, body }` and fail immediately if any request is not a Management GET or `/database/query/read-only` POST whose parsed SQL starts with `SELECT`.

The post-lock subtests mutate Auth, journal, and signed pair independently between the first proof and locked proof. Expect `PLAN_STATE_CHANGED` for Auth/journal movement and the existing authorization code for pair invalidation. Assert that no reconciliation transaction begins.

- [ ] **Step 2: Run the new integration tests and watch unsupported routing fail**

Run:

```bash
node --test --test-name-pattern='reconcile-auth-config|Auth reconciliation' scripts/supabase/bootstrap.test.mjs scripts/onboarding/cloud.test.mjs
```

Expected: FAIL with `OPERATION_UNSUPPORTED` or `CLOUD_REQUEST_INVALID` because the operation is not routed. Tests must already assert zero provider writes and empty live side-effect counters.

- [ ] **Step 3: Add the narrow bootstrap operation**

Add `reconcile-auth-config` to the bootstrap operation allowlist, require `target='hosted'`, require JSON output, reject unrelated flags, and add every approved reconciliation failure code to the existing fixed exit-code/message maps. Do not add a generic `--drift`, template, hash, payload or patch argument.

Inside `runSupabaseBootstrap()` reuse the existing sequence:

1. `requireSignedOwnerPreflight()` for the fresh pair.
2. `requireProviderBaseline()` and `assertProviderBaselineCurrent()`.
3. `createHostedInspector()`.
4. `loadReleaseIndexForDoctor()`.
5. `buildAuthConfigReconciliationProof()` before any installer connection.
6. `withInstallerConnection()` and `withInstallLock(projectRefHash)`.
7. Re-run `authorize()` and `buildAuthConfigReconciliationProof()` after lock; require the same `proofFingerprint` and all returned proof fields.
8. Call `reconcileAuthConfigJournal()` with the locked session and existing `authorize` callback.
9. After commit or exact zero-write readback, run normal `buildSupabaseDoctor()` once with the current pair. If it has a blocker, return the first existing fixed code and do not erase journal evidence or touch the provider.
10. Build the exact Shared Interfaces result. Compute `installationIdSha256` in memory with Node `createHash`; never print the raw ID.

The `main()` success exit must use the reconciliation success code/status because the exact result intentionally has no extra `ready` key. Keep all other operations on their current `ready` handling.

- [ ] **Step 4: Add the onboarding command without a second implementation**

Add `reconcile-auth-config` to `cloud.mjs` help and operation allowlists. It must parse the existing `CCC_ONBOARDING_REQUEST`, `CCC_ONBOARDING_JOURNAL`, `CCC_ONBOARDING_INSTALLATION` and current S11 inputs, call `verifyCreatedInstallation()`, bind `expectedAuthorizationSha256`, then call:

```js
runSupabaseBootstrap({
  operation: 'reconcile-auth-config',
  target: 'hosted',
  projectRef: installation.projectRef,
  installManifest: installation.installManifest,
  installApproval: installation.installApproval,
}, { expectedAuthorizationSha256 });
```

Print that result directly as the only stdout JSON object. Do not wrap it in `{ view, result }`, ask for an interactive phrase, modify the filesystem creation journal, add a template argument or call an Auth write route. Keep the current cloud error catch so stderr remains `{"error":{"code":"FIXED_CODE"}}` with no message.

Do not read `RELAYER_*` variables in these modules. The approved external secret runner maps SecretStore canonical names to the existing `CCC_*` and `SUPABASE_*` process inputs before this command starts.

- [ ] **Step 5: Run the integration tests and confirm fixed output and zero side effects**

Run the command from Step 2.

Expected: PASS. The first result has `status='reconciled'`, `code='AUTH_CONFIG_RECONCILED'`, `changed=true`; repeat has only the approved three field-value changes. Every error has empty stdout and exact code-only stderr. Request counters for Auth PATCH, `/auth/v1/invite`, admin user creation, template update, migration, release and deployment are all zero.

- [ ] **Step 6: Commit the routed command**

```bash
git add scripts/supabase/bootstrap.mjs scripts/supabase/bootstrap.test.mjs scripts/onboarding/cloud.mjs scripts/onboarding/cloud.test.mjs
git commit -m "feat(onboarding): route exact Auth reconciliation"
```

---

### Task 5: Run Targeted Verification and Record No-Live-Write Proof

**Files:**
- Verify only: all files listed in File Responsibilities
- Do not create: evidence document, migration, fixture data outside temporary test directories, ticket or release artifact

**Interfaces:**
- Consumes: the complete implementation from Tasks 1 through 4.
- Produces: terminal evidence and the final implementation report only. It does not change source or external state.

- [ ] **Step 1: Run the pure and onboarding readiness suite**

```bash
node --test scripts/supabase/auth-config.test.mjs scripts/onboarding/first-admin.test.mjs
```

Expected: PASS. The exact template is 408 UTF-8 bytes, its SHA-256 is approved, no duplicate literal exists in first-admin, and mismatch cases send zero invites.

- [ ] **Step 2: Run plan, inspector, bootstrap and public command tests**

```bash
node --test scripts/supabase/plan.test.mjs scripts/supabase/bootstrap.test.mjs scripts/onboarding/cloud.test.mjs
```

Expected: PASS. Normal doctor/apply drift tests remain fail-closed. Reconciliation allows only the two exact drift blockers on first adoption and preserves every unrelated fixed blocker.

- [ ] **Step 3: Run the disposable PostgreSQL journal suite**

Precondition: `CCC_INSTALL_JOURNAL_TEST_DATABASE_URL` remains bound to the existing empty loopback disposable PostgreSQL database accepted by `disposableDatabaseUrl()`.

```bash
node --test scripts/supabase/install-journal.test.mjs
```

Expected: PASS. The success path writes only the disposable fixture journal. All zero-write and rollback cases leave table counts and journal values unchanged. No live journal is addressed.

- [ ] **Step 4: Run repository document and patch checks**

```bash
node scripts/guard-doc-numbers.mjs
git diff --check
```

Then inspect added lines for the prohibited Unicode long dash and require count `0`. Do not rewrite historical lines outside this change.

- [ ] **Step 5: Prove the scope allowlist**

Run:

```bash
git diff --name-only HEAD~4..HEAD
```

Expected paths are only the thirteen files in File Responsibilities. Require no matches under `apps/`, `packages/`, `migrations/`, `docs/specs/`, `docs/adr/`, release artifacts, `package.json` or `pnpm-lock.yaml`.

Search added production lines for `process.env.RELAYER_`, `env.RELAYER_`, or quoted secret-name literals beginning with `RELAYER_` and require zero. The required JavaScript identifier `RELAYER_INVITE_TEMPLATE_HTML` is not a secret name and is allowed. Existing `CCC_*` and `SUPABASE_*` runtime inputs remain unchanged because canonical-to-runtime mapping belongs only to the external process injection boundary.

- [ ] **Step 6: Record no-live-write evidence in the final report**

Report the exact commands run and these observed facts:

- All HTTP tests used the loopback shim or in-memory fake. Captured provider requests were only Management GET and read-only database query requests.
- Captured counts were `authPatch=0`, `invite=0`, `adminUserCreate=0`, `templateUpdate=0`, `migration=0`, `release=0`, `deployment=0`.
- PostgreSQL writes occurred only inside the guarded loopback disposable test database. Live journal writes were `0`.
- No `opsvc`, Infisical, email, provider apply, push, merge or deploy command ran.
- No live Supabase project, secret store, filesystem onboarding journal or provider configuration changed.

If any command contacted a non-loopback test endpoint, any forbidden counter is nonzero, or the disposable DB guard cannot prove its target, stop and report the fixed failing code. Do not rerun against live infrastructure.

## Final Self-Review Before Execution Handoff

- [ ] Every requirement in the approved spec maps to one of Tasks 1 through 5.
- [ ] Every production edit follows a named failing test and an observed red command before the green edit.
- [ ] `RELAYER_INVITE_TEMPLATE_HTML` is the only execution literal and no test pastes its body.
- [ ] `BOUNDED_AUTH_CONFIG_KEYS` has exactly twelve keys in the approved order; the invite template is not part of the durable Auth fingerprint.
- [ ] `buildAuthConfigReconciliationProof()` and `reconcileAuthConfigJournal()` use the exact signatures and field names in Shared Interfaces.
- [ ] First adoption requires a higher sequence; same sequence is accepted only by exact durable readback.
- [ ] The transaction inserts one authorization row, inserts one completed `auth_config` row, and updates only the approved journal pointer columns.
- [ ] Normal doctor/apply remain fail-closed and unrelated blocker priority is unchanged.
- [ ] Success and error serialization contain only the approved keys and no raw identifiers, template, provider body or secret fixture.
- [ ] No task adds a migration, dependency, framework, UI, API, generalized drift abstraction, secret alias layer or live operation.
- [ ] No placeholder, unresolved type, undefined function, duplicate responsibility or out-of-scope file remains in this plan.
