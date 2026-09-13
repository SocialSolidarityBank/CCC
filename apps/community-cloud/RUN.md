# Community Cloud container run contract

This image is for Azure Container Apps (ACA). Deployment configuration, runtime bindings, registry push, and deployment remain operator-owned; this repository procedure builds a local image only.

## Build

Run from the repository root:

```sh
pnpm --filter @ccc/community-cloud build
docker build --platform linux/amd64 -t ccc-community-cloud:beta-local apps/community-cloud
```

The runtime image uses the official Deno 2.9.6 image, pinned to multi-architecture digest `sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d`; provenance: [denoland/deno_docker](https://github.com/denoland/deno_docker). It copies the runtime bundle, `with-ca.sh`, and the two public-CA validation modules, then runs under `tini` as the non-root `deno` user (UID 1993). No CA values or installation configuration are copied into the image.

Do not pass secrets as Docker build arguments, bake them into layers, or copy `.env` files into the build context or image. Bind runtime values through ACA. Do not push this local tag or deploy it as part of these commands.

## Required runtime bindings

All four values must be present and non-blank:

| Name | Contract |
| --- | --- |
| `CCC_DATABASE_URL` | PostgreSQL connection for the restricted request role `ccc_api`, never an owner or migration credential. The runtime enforces TLS `verify-full`, verifies the database identity before listening, and expects all tables to have been migrated already. |
| `CCC_ORGANIZATION_ID` | Organization scope assigned to every database actor and checked against authenticated identities. |
| `CCC_INSTALL_MANIFEST` | Signed Community Cloud installation manifest JSON supplied by the trusted installer outside the image. It defines the canonical API origin and prefix, allowed browser origins, identity origin, approved capabilities, installation identity, and expiry. |
| `CCC_INSTALL_SIGNING_KEYS` | Installer-supplied JSON map of manifest verification public keys. It is required even though it contains public keys rather than a secret. |

The trusted installer, running outside this image, owns manifest creation, signing-key selection, database migration, and deployment bindings. The container neither installs nor migrates a database.

`CCC_DATABASE_URL` must authenticate as `ccc_api`. Grant only the request-role privileges expected by the pre-migrated schema; do not substitute a Supabase owner, service, migration, or management credential. The server always connects with certificate and hostname verification (`verify-full`).

## Optional public database CA

Set `CCC_DATABASE_CA_FILE` only when the database certificate chain needs an additional public CA. Mount that PEM bundle as a read-only regular file and bind the variable to its exact in-container path. The file is public trust material, not a credential; do not put connection strings, access tokens, service-role keys, or private keys in it. The application accepts only a non-empty PEM-only bundle of CA certificates up to 256 KiB.

All Node and Deno database commands must start through the application wrapper when this binding is set:

```sh
sh apps/community-cloud/with-ca.sh node scripts/supabase/bootstrap.mjs plan --target hosted
sh apps/community-cloud/with-ca.sh node apps/community-cloud/dist/install-consent-registry.js --input ./consent-registry.json
```

The wrapper checks and parses the configured public CA bundle in a subprocess before loading extra roots, then binds both `NODE_EXTRA_CA_CERTS` and `DENO_CERT` to that exact path before application startup. The application validates the bounded CA bundle and exact process bindings again before database use. Missing, mismatched, unreadable, malformed, non-CA, or mixed-content input fails closed without exposing the path or file contents. When `CCC_DATABASE_CA_FILE` is absent, the wrapper adds no CA setting.

For the container, provide the same file through an ACA read-only volume mount and set `CCC_DATABASE_CA_FILE` to its mounted path. Do not install it into machine or image trust stores. This adds trust only to the launched application process; TLS remains `verify-full`, and certificate hostname verification and the signed exact API host checks are unchanged.

Main supplied the official dashboard CA download metadata: `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`, SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Main owns obtaining and checking this public file. Startup never downloads it, changes the machine trust store, or disables certificate/hostname verification.

### S11 installation preflight status

This source-only handoff has **not been validated**. The installer-only approval contract is frozen in `beabc12`, S11 §2.1 and ADR-0048's 2026-09-10 follow-up. S2 public fields are unchanged.

`plan` is the default, and `doctor` is read-only. Both require the signed public manifest (`--install-manifest` or `CCC_INSTALL_MANIFEST`) and private approval (`--install-approval` or `CCC_INSTALL_APPROVAL`), each as JSON or an explicit local file. `CCC_ORGANIZATION_ID` is the externally configured target institution. `CCC_INSTALL_SIGNING_KEYS` is the externally configured key-ID to raw-Ed25519-Base64 public-key map trusted for that institution; `CCC_INSTALL_REVOKED_KEY_IDS` is its JSON array of revoked IDs (default `[]`). Neither signed document can supply keys or register an institution. Main owns signing material and scoped token injection.

Both signatures, expiry/revocation, institution/project/installation bindings and the SHA-256 of UTF-8 JCS of the **entire signed** public manifest are checked before provider access. The observed owner must then match the signed private approval. The hosted inspector uses only Management API read endpoints and hashes metadata, not institution row contents. Unowned data, unknown private installation tables, changed fingerprints and mismatched migration checksums are rejected.

The protected journal implements advisory locking, atomic bootstrap metadata, per-migration SQL+receipt+catalog-fingerprint transactions, immutable authorization history, hash-only resource ownership and restart without replay. Ordinary resume requires the same two signed artifact hashes. `plan --renew-authorization` previews a new signed pair; `renew-authorization` updates authorization history only under a project lock. Renewal preserves stable institution/project/owner/installation, contract, runtime configuration and desired resource/migration digests; metadata sequence must advance. Retrying the same already-recorded renewal is a no-op. Expired/revoked inputs never authorize a write.

Journal bootstrap and renewal also require a fresh verifier callback immediately before mutation and before commit. Migration SQL is parameter-bound through a session-local PostgreSQL function so transaction-control statements cannot end the journal transaction. Catalog fingerprints cover `public` and `private` definitions and user types without depending on the observing SQL role. These source changes remain unverified.

The resumed planner currently reconciles recorded `storage_bucket` resources against hashed observed IDs and nonsecret configuration digests. Unknown custom schemas, standalone user types and other resource categories fail closed until the signed platform artifact contract supplies their ownership checks. This is not full installed-resource verification.

**Current live approval is signed read-only plan only, not database writes.** The renewal writer and journal scenarios are source for later separately approved execution. No account, credential, schema, provider or deployment operations were executed for this handoff.

**Apply now stops at named prerequisites instead of one blanket refusal; rollback is still blocked.** `apply` proceeds only when all of the following hold, and each failure is a fixed code with no live installation attempted: the pinned release origin, trust floor and both signatures verify; the verified Edge component set is exactly the planned migrations plus one `functions/ccc-storage-signer/index.js` function (`EDGE_COMPONENT_SET_MISMATCH` otherwise); the S12 §6 first-install exemption applies, because this repository still has no E6-7 verified backup/restore catalog and executor, so a resume, a second installation or any update stops with `BACKUP_FAILED`; and `SCHEDULER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CCC_INSTALL_MANIFEST`, `CCC_INSTALL_SIGNING_KEYS` and `CCC_API_DATABASE_PASSWORD` are injected (`RELEASE_PREREQUISITES_MISSING` otherwise). Only the presence of those five values is checked; no value is read, logged, hashed into an identifier or written to the journal, receipt or report. `rollback` still reports `ROLLBACK_PREREQUISITES_MISSING`, because no S12 rollback bundle or verified restore executor exists. The journal module's migration primitives are not permission to bypass those gates.

**A first install completes in two stages (2026-09-12).** The business runtime logs in as the restricted `ccc_api` role, and that role is created without a password by the installer's own migrations, so `/readyz` cannot answer during the same `apply`. `apply` therefore runs a final `api_credential` provider step that sets the `ccc_api` password from the injected `CCC_API_DATABASE_PASSWORD` through a bind parameter only; the value never appears in SQL text, the journal, the receipt, a report or any output, and a rerun observes the role instead of setting it again. Stage one ends with an `installed` receipt whose `productionReady` and `runtimeReady` are both `false`, because that apply required only installation health: the deployed signer refusing an unauthenticated call for this installation, Seoul edge region and a nonprivileged `ccc_api`. In stage two the operator deploys the ACA container with `CCC_DATABASE_URL` pointing at `ccc_api` with that same password; `doctor` then reports `runtimeReady: true` and `productionReady: true` once no blocker remains. Until the runtime is deployed, `doctor` keeps `ready` unchanged and only adds the non-blocking `RUNTIME_NOT_READY` notice, while a failure of installation health stays the blocking `HEALTH_FAILED`.

Credentials continue to enter only through scoped environment injection. A working pooler connection does not replace Management API owner/control-plane checks. `CCC_INSTALL_DATABASE_URL` is used only by separately approved installer writes, never as a fallback for the ordinary runtime's `CCC_DATABASE_URL`. `CCC_API_DATABASE_PASSWORD` is installer-only in the same way: the installer binds it for the `api_credential` step, and the runtime container receives it only inside its own `CCC_DATABASE_URL`, never as a separate binding. It must bind the already-approved project through its direct endpoint or Seoul session-pooler username and port 5432; TLS remains `verify-full`. No native keyring, browser, token file, owner discovery or authentication mechanism is added.

### Beta provider baseline generation

This installer-only command issues development `beta` trust. It is not S12 formal release trust and does not authorize database writes, apply, deployment, AI, or STT. Run it only after the S11 owner documents and pinned Supabase source review have been approved. The generator performs two read-only observations and stops unless both inventory hashes are identical and all business table, row, Auth user, bucket, and Storage object counters are zero.

The source-evidence document must use the exact `ProviderSourceEvidenceV1` shape in `docs/superpowers/specs/2026-09-11-beta-provider-baseline-design.md`. Every record carries its own immutable 40-character lowercase hexadecimal `sourceRevision`, normalized relative `sourcePath`, and already-checked file SHA-256. `sourceUrl` is exactly one of `https://github.com/supabase/supabase`, `https://github.com/supabase/postgres`, `https://github.com/supabase/auth`, `https://github.com/supabase/storage`, `https://github.com/supabase/realtime`, or `https://github.com/postgres/postgres`. There is no document-level source revision because one evidence document may pin different commits from all six repositories. The signed baseline commits to the complete evidence document through `sourceEvidenceSha256`. The generator does not download source. Each `supabase_managed` object or grant has exactly one evidence record whose `identitySha256` is the SHA-256 of UTF-8 JCS of that normalized inventory record after removing only `provenance`. Extension objects and initial-privilege grants need no manual evidence row.

Supply the existing S11 installer bindings plus `SUPABASE_ACCESS_TOKEN`, `CCC_BETA_ROOT_SIGNING_PRIVATE_KEY`, `CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY`, `CCC_BETA_TRUST_ROOT_KEYS`, and `CCC_BETA_REVOKED_ROOT_KEY_IDS`. Both private keys are canonical standard-Base64 PKCS#8 Ed25519 keys. The public root map remains the external trust root; the generator requires exactly one entry to match the root private key and rejects revoked roots. Keep these values in the installer process only and never bind them to the Community Cloud runtime.

The CLI accepts only these flags:

```sh
node scripts/supabase/provider-baseline-generate.mjs \
  --source-evidence artifacts/beta-0.9/2026-09-11-provider-source-review.json \
  --release-trust-output /tmp/relayer-beta-release-trust-20260911.json \
  --baseline-output /tmp/relayer-provider-baseline-20260911.json
```

Both output parents must already exist. The generator resolves them to canonical directories and checks ancestry and type before writing. Each destination is created exclusively and atomically per path from an fsynced mode `0600` no-follow temporary file, and an existing document is never overwritten. Node does not expose `openat` or `unlinkat`, so cleanup verifies each created file's device and inode and is best effort. If cleanup cannot be verified, generation fails with a fixed redacted code and never returns success. The operator must choose output directories that it controls and that no other principal can write or rename during generation. Successful stdout contains only `baselineVersion`, object and grant counts, and the three document hashes. Failure emits no document detail, URL, project ref, object or grant name, key, signature, token, connection string, or path.

### Read-only diagnostic reports

Use the same scoped S11 authorization and provider-baseline inputs as `doctor`:

```sh
sh apps/community-cloud/with-ca.sh node scripts/supabase/bootstrap.mjs report --output ./diagnostic.json --json
```

The output directory must already exist and be operator-owned, without group or world write access. Reports are published as new mode `0600` files; an existing destination is never overwritten. This writer currently fails closed on Windows because its DACL protection has not been established. A failed diagnostic can still produce a valid report: exit `6` means checks are incomplete or failed, not that installation succeeded. Missing authorization or invalid arguments produce no report.

The report projects fixed codes and validated release metadata before serialization. Raw provider errors, URLs, signatures, credentials and institution identifiers are not collected into it. An absent or inconsistent installation has no invented version or artifact metadata. The current S11 receipt lacks complete signed release-artifact evidence, so the report does not manufacture those fields.

### Installation recovery boundary

An interrupted installation cannot reuse the empty-project backup exemption. Until verified backup and recovery exist, retry/resume fails with `BACKUP_FAILED` without updating its journal.

The apply order inside the install lock is fixed: journal preparation, the per-migration promotion, the provider steps (`storage_bucket`, `cron_job`, `edge_secret_binding` including the StorageSigner deployment from staged bytes), then health, and only then the receipt. Health is read-only and bounded: one `SELECT rolsuper, rolbypassrls` for `ccc_api` on the installer session, one `GET /readyz` on the signed `apiBase` host, and one `POST` with no body to `<supabaseAuthOrigin>/functions/v1/ccc-storage-signer`. Each request refuses redirects and gives up after five seconds, and no address, token, header or provider body reaches stdout, the journal, the receipt or the report. Readiness must answer `200` with `{"status":"ready"}`, the signer must answer `401` with `{"code":"UNAUTHORIZED"}` and this installation's `x-ccc-installation-id`, and its `x-sb-edge-region` must be `ap-northeast-2`. Any missing dimension is read as absent rather than assumed: apply closes with `HEALTH_FAILED`, writes no `installed` receipt, and leaves an explicit incomplete journal. `doctor` reports the same evidence read-only and adds a `HEALTH_FAILED` blocker. Local PostgreSQL tests prove migration transaction and receipt behavior, not hosted deployment, Auth/MFA, or recovery of a live institution.

The provider steps never enable a database extension. `cron.schedule`, `net.http_post`, `vault.create_secret` and `storage.buckets` must already exist in the project, and a missing one stops apply with `PROVIDER_UNREADABLE` before any write, so enabling pg_cron, pg_net and Vault in the Supabase dashboard is an operator prerequisite. `SUPABASE_SERVICE_ROLE_KEY` is required to be injected into the installer but is never sent to the Management API: its `CreateSecretBody` name pattern refuses `SUPABASE_`-prefixed names and Supabase injects that credential into Edge Functions itself, so `edge_secret_binding` binds only `CCC_INSTALL_MANIFEST` and `CCC_INSTALL_SIGNING_KEYS`.

### Institution

ADR-0044 D86 fixes the order: install creates the institution, and the first login only performs its initial setup (institution name, first program). The setup screen itself calls `GET /capabilities` first, and that call answers `409 admission_required` while `program_admission_policies` has no row for the institution. The only business writer of that row is `createOrganizationSettings`, which has no HTTP route, so this command is the only path from a completed installation to an institution a first login can set up.

The full order is `apply` -> `create-institution` -> `link-first-admin` -> first login with TOTP enrollment -> the onboarding screen. The two post-install commands are independent: `link-first-admin` does not require `create-institution` and `create-institution` does not require a linked administrator, so an installation that already linked an administrator can still run this command afterwards. Only the first login needs both, because it authenticates as the linked administrator and its first call reads the admission policy.

```sh
sh apps/community-cloud/with-ca.sh node scripts/supabase/bootstrap.mjs create-institution \
  --target hosted \
  --time-zone Asia/Seoul \
  --pii-purge-grace-days 365
```

Both flags are optional and default to exactly those values: D32's one-year PII purge grace period and the institution time zone Seoul. The time zone is validated with `Intl.DateTimeFormat` like `createOrganizationSettings` and must be `UTC` or an IANA region/city name; the grace period must be an integer between 1 and 3660 days. A value above `RETENTION_POLICY_MAX_DAYS` (1826) stays storable but makes the institution's readiness report `retentionPolicyStatus: review_required`, so a longer period is a deliberate decision, not a default. The inputs are the same as `doctor`: signed manifest, signed approval, institution identifier, signing keys, development beta trust, provider baseline and `SUPABASE_ACCESS_TOKEN`; the write additionally needs `CCC_INSTALL_DATABASE_URL`. Owner verification and the read-only plan run first, and a project whose installation state is not `installed` stops with `INSTITUTION_NOT_INSTALLED`.

The write is one transaction inside the install lock. It records one `organization_settings` row (`version 1`, time zone, grace period), one `program_admission_policies` row (`version 1`, `stt_mode 'off'`, `llm_mode 'off'` as D77's install defaults) and one `audit_log` receipt (`actor_id = "install:institution:" + orgId`, `actor_role 'service'`, `action 'create'`, `target_table 'organization_settings'`, `target_id = orgId`). Enabling STT or LLM later is a business decision, not part of installation. Re-running when both rows exist reads the stored values, returns them and writes nothing. If only one of the two rows exists, the half state is never overwritten: the command stops with `INSTITUTION_STATE_INCONSISTENT` and writes nothing, and that institution has to be repaired deliberately.

The output is a single JSON report carrying only `operation`, `ready`, `orgIdSha256`, `timeZone`, `piiPurgeGraceDays`, `sttMode` and `llmMode`. The institution identifier itself is never printed.

The PostgreSQL scenarios for this command are `scripts/supabase/institution.test.mjs`. They require an explicitly injected `CCC_INSTITUTION_TEST_DATABASE_URL` pointing at an empty loopback **disposable** database with a test/fixture/disposable name; missing configuration fails rather than skipping. Never supply an installation or production URL.

```sh
docker run --rm -d --name s12-institution-pg -e POSTGRES_PASSWORD=synthetic-test-only \
  -e POSTGRES_DB=ccc_institution_test -p 127.0.0.1:55436:5432 postgres:17
CCC_INSTITUTION_TEST_DATABASE_URL='postgres://postgres:synthetic-test-only@127.0.0.1:55436/ccc_institution_test' \
  node --test scripts/supabase/institution.test.mjs
docker rm -f s12-institution-pg
```

### First administrator

ADR-0044 D86 fixes the order: install creates the institution, and the first login is the institution's initial setup. No browser form creates the first administrator, so this command is the only path from a completed installation to a usable institution administrator.

The prerequisite is a Supabase Auth user. Create that account first in the Supabase dashboard or through the Auth Admin API and complete its email confirmation. This command never creates an Auth account and never handles a password, whether the operator used an invitation mail or a temporary password. Once the account exists, read its opaque Auth user uuid and link it to the directory with the command below. After linking, that person signs in and enrolls TOTP themselves; sign-in only holds at aal2, so no business screen opens before the enrollment.

```sh
sh apps/community-cloud/with-ca.sh node scripts/supabase/bootstrap.mjs link-first-admin \
  --target hosted \
  --auth-subject 00000000-0000-0000-0000-000000000000 \
  --email admin@example.org \
  --name 'Institution administrator'
```

`--auth-subject` must be the lowercase uuid. An uppercase or otherwise rewritten spelling is refused, because the receipt hash has to match the subject string the runtime sees. `--name` is optional. The inputs are the same as `doctor`: signed manifest, signed approval, institution identifier, signing keys, development beta trust, provider baseline and `SUPABASE_ACCESS_TOKEN`; the write additionally needs `CCC_INSTALL_DATABASE_URL`. Owner verification and the read-only plan run first, and a project whose installation state is not `installed` stops with `FIRST_ADMIN_NOT_INSTALLED`.

The write is one transaction inside the install lock. It records one `users` row (legacy role `admin`, `active=1`, `auth_subject`), that row's canonical role assignments and exactly one `first_admin_linked` receipt. The canonical assignments come from the same `users` insert trigger the business path uses, so the installer does not write them itself. An existing institution administrator or receipt is refused with `FIRST_ADMIN_EXISTS`, an already linked Auth user with `FIRST_ADMIN_SUBJECT_TAKEN` and an existing email with `FIRST_ADMIN_EMAIL_TAKEN`; none of them writes anything. Re-running with the same `--auth-subject` and `--email` reads the receipt, returns the same hashes and writes nothing.

The output is a single JSON report carrying only `operation`, `ready`, `userIdSha256`, `emailSha256` and `authSubjectSha256`. The email, the Auth user uuid and the application user identifier are never printed.

The PostgreSQL scenarios for this command are `scripts/supabase/first-admin.test.mjs`. They require an explicitly injected `CCC_FIRST_ADMIN_TEST_DATABASE_URL` pointing at an empty loopback **disposable** database with a test/fixture/disposable name; missing configuration fails rather than skipping. Never supply an installation or production URL.

```sh
docker run --rm -d --name s12-first-admin-pg -e POSTGRES_PASSWORD=synthetic-test-only \
  -e POSTGRES_DB=ccc_first_admin_test -p 127.0.0.1:55435:5432 postgres:17
CCC_FIRST_ADMIN_TEST_DATABASE_URL='postgres://postgres:synthetic-test-only@127.0.0.1:55435/ccc_first_admin_test' \
  node --test scripts/supabase/first-admin.test.mjs
docker rm -f s12-first-admin-pg
```

### Pending executable verification

The installer unit suites for the apply, health and prerequisite changes were run in this checkpoint and pass:

```sh
node --test scripts/supabase/apply.test.mjs scripts/supabase/bootstrap.test.mjs scripts/supabase/plan.test.mjs scripts/supabase/install-authorization.test.mjs
```

They exercise fake provider and deployment seams only: a loopback readiness route and StorageSigner stand-in, a fake Management API, and recorded SQL. They are not evidence of a hosted installation. Main may run the remaining commands only after merging the frozen migration/checkpoint changes and approving verification; they were **not run** here:

```sh
pnpm --filter @ccc/community-cloud build
node --test scripts/supabase/installer-connection.test.mjs scripts/supabase/provider-steps.test.mjs
node --test apps/community-cloud/test/installer-private-key.test.mjs
```

The PostgreSQL journal scenarios are `scripts/supabase/install-journal.test.mjs`. They require explicitly injected `CCC_INSTALL_JOURNAL_TEST_DATABASE_URL` pointing to an empty loopback **disposable** database with a test/fixture/disposable name; missing configuration fails rather than skipping. Never supply an installation or production URL. Scenarios cover transaction rollback, receipt/checksum atomicity, crash-safe catalog fingerprints, ordinary resume, renewal history/no replay, expired/revoked inputs, lock release and foreign ownership. Compute final plan resource/migration digests only after Main merges PG0017/0018, SQLite0061/0062 and their parity wiring.

## Settings

Unset values take the fail-closed defaults below. Boolean switches enable only when their value is exactly `1`.

| Name | Accepted value and default | Use |
| --- | --- | --- |
| `CCC_STT_MODE` | `off`, `local`, or `azure`; unset fallback is `off`. | Forwarded compatibility setting. Business dispatch replaces it with the stored installation policy; changing this binding does not activate STT. Signed engine approval, program admission, consent and Agent readiness still apply. |
| `CCC_LLM_MODE` | `off` or `openai`; unset fallback is `off`. | Forwarded compatibility setting. Business dispatch replaces it with the stored installation policy; changing this binding does not activate AI. |
| `TEXT_AI_PILOT_ENABLED` | `1` enables; otherwise disabled. | Opens the text-AI pilot gate. It does not replace program admission or user consent checks. |
| `EXTERNAL_AI_CALLS_ENABLED` | `1` enables; otherwise disabled. | Opens the external-provider call gate. A permitted LLM mode and provider key are also required. |
| `PUBLIC_SIGNUP_ENABLED` | `1` enables; otherwise disabled. | Exposes the gated public participant signup surface; when disabled it remains indistinguishable from an unknown route. |
| `PII_PURGE_ENABLED` | `1` enables; otherwise disabled. | Allows PII purge operations; disabled operations fail closed. |
| `PII_KEY_VERSION` | Positive base-10 safe-integer text matching `[1-9][0-9]*`; default `1`. | Labels the active `PII_ENC_KEY` version used for PII encryption and decryption. |

## Business secrets

These values are runtime-only bindings. They are read lazily, so absence does not by itself prevent startup:

| Name | Contract |
| --- | --- |
| `CODEX_API_KEY` | Required only when an allowed OpenAI operation is attempted. Missing or blank means the provider is unavailable. |
| `PII_ENC_KEY` | Required for PII encryption or decryption. Supply exactly 32 raw key bytes encoded as canonical standard Base64: 44 characters matching `[A-Za-z0-9+/]{43}=`. |
| `NOTIFY_WEBHOOK_URL` | Optional watchdog notification destination. If present, it must use HTTPS; delivery failure does not stop the watchdog. |

The shared environment secret adapter also recognizes `DB_MASTER_KEY`, `FILE_ENC_KEY`, `OFFICE_CA_KEY`, and `SCHEDULER_SECRET`, but this Community Cloud entrypoint does not expose them as process bindings. Do not add them merely because the shared adapter knows their names.

## Forbidden bindings

Never bind any of the following names to this container:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CCC_INSTALL_SIGNING_PRIVATE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SECRET_KEYS`
- `SUPABASE_DB_URL`
- `SUPABASE_ACCESS_TOKEN`

Presence is forbidden even when the value is empty. The process fails before listening if any forbidden name exists.

## Port, ingress, and probes

`PORT` is optional and defaults to `8080`. When set, it must contain only decimal digits and resolve to an integer from 1 through 65535. The process listens on `0.0.0.0`. Set ACA's ingress target port and HTTP probe port to this same value; Docker's `EXPOSE 8080` declaration does not override `PORT`.

Configure ACA with external HTTPS ingress and insecure ingress disabled. ACA terminates TLS before the container. The runtime permits that internal HTTP hop only when the request host exactly matches the host in the signed manifest's `apiBase`; it never trusts `Forwarded` or `X-Forwarded-*` headers. The signed canonical API origin and prefix, CORS allowlist, Bearer authentication, and MFA requirements remain authoritative.

Use `GET /readyz` or `HEAD /readyz` for startup and readiness probing. This reserved route is outside the signed business API prefix and performs no authentication, configuration lookup, or database call. After successful startup, `GET` returns `200` with `{"status":"ready"}` while the verified manifest is unexpired; after expiry it returns `503` with `{"status":"unavailable"}`. `HEAD` uses the same status with no response body, and other methods return `405`.

Readiness means only that startup completed, the signed installation manifest passed verification, the `ccc_api` database identity boundary passed once, identity configuration was created, and the manifest is still current. It is not a continuing database health guarantee. A readiness response must never include user data or report whether business records exist.

Startup completes before the listener opens. Any invalid port, missing required binding, manifest failure, forbidden binding, database identity failure, or other initialization failure writes only `installation_unavailable` and exits with status 1; raw errors are not exposed.

## StorageSigner

The StorageSigner is a separate deployment unit, not part of this container. Build it with the same `pnpm --filter @ccc/community-cloud build` command; the bundle is `dist/storage-signer.js`, produced from `src/storage-signer-main.ts`. Deploy it as the Supabase Edge Function `ccc-storage-signer` with `verify_jwt = false`, because the caller's Bearer token is verified by the business API through the online authorization callback, not by the platform gateway.

Required bindings for that function, all non-blank:

| Name | Contract |
| --- | --- |
| `CCC_INSTALL_MANIFEST` | The same signed installation manifest JSON the business runtime receives. It must verify with mode `community-cloud` and carry `supabaseAuthOrigin`; the signer reads the API origin, installation identity, and storage origin only from this verified document. |
| `CCC_INSTALL_SIGNING_KEYS` | The same installer-supplied JSON map of manifest verification public keys. |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage service-role credential. This credential lives only here; the business runtime refuses to start if it can read it. |
| `PORT` | Optional. Absent on Supabase Edge Functions, where `Deno.serve(handler)` is used without a port. When set for a self-hosted Deno process it must contain only decimal digits resolving to an integer from 1 through 65535, and the signer listens on `0.0.0.0`. |

Never bind any of these to the signer: `CCC_DATABASE_URL`, `CODEX_API_KEY`, `PII_ENC_KEY`, `NOTIFY_WEBHOOK_URL`, `SCHEDULER_SECRET`, `CCC_INSTALL_DATABASE_URL`, `CCC_INSTALL_SIGNING_PRIVATE_KEY`, `CCC_BETA_ROOT_SIGNING_PRIVATE_KEY`, `CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY`, `CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY`, `CCC_RELEASE_SIGNING_PRIVATE_KEY`, `CCC_INSTALL_APPROVAL`, `SUPABASE_ACCESS_TOKEN`. Supabase injects `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEYS` and the legacy `SUPABASE_SERVICE_ROLE_KEY` into every Edge Function by itself; the signer never imports a database client, which is what the bundle grep in `pnpm --filter @ccc/community-cloud build` proves. Presence is forbidden even when the value is empty. The signer bundle contains no database, gateway, or business handler code, and any invalid port, missing required binding, manifest failure, or forbidden binding writes only `storage_signer_unavailable` and exits with status 1. No binding value, request field, or provider message is logged.

The business runtime never receives a signer address as a binding. It builds the address as the verified manifest's `supabaseAuthOrigin` followed by `/functions/v1/ccc-storage-signer`, so an unsigned environment value cannot redirect signing. Each business request builds its signer client with that request's own `Authorization` header; a request without one fails at the first signer call.

Every signer call re-checks authorization online: the signer posts the canonical request back to the business API's `/internal/storage/authorize` with the caller's Bearer token and acts only on a live allow decision. It signs, deletes, and proves absence; it never returns audio bytes to the business runtime.

Live deployment has not been performed. The installer's `edge_secret_binding` step now binds exactly `CCC_INSTALL_MANIFEST`, `CCC_INSTALL_SIGNING_KEYS` and `SUPABASE_SERVICE_ROLE_KEY` and deploys `ccc-storage-signer` with `verify_jwt = false` from the verified staged bytes of the release bundle, and apply's health then proves the deployed function refuses an unauthenticated call for this installation. No installation has been run against a live project in this checkpoint, so no Edge Function has actually been created, bound or published here.
