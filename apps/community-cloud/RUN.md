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

This source-only handoff has **not been validated**. `plan` remains the default read-only operation. Hosted `--install-manifest` accepts either manifest JSON or an explicit local JSON file; `CCC_INSTALL_MANIFEST` is the fallback binding, and `CCC_INSTALL_SIGNING_KEYS` supplies the existing S2 verifier's public-key map. Build the manifest-verifier artifact with the Community Cloud build before Main's approved verification.

There is an unresolved contract boundary: S11 §2.1 requires signed `institutionId`, `projectRef`, and `expectedOwnerOrgId`, but S2 §2.7's exact public manifest and its verifier have no institution/owner fields and reject extensions. A valid S2 runtime manifest therefore produces `OWNER_MANIFEST_CONTRACT_UNRESOLVED`; missing or invalid evidence produces `OWNER_EVIDENCE_MISSING`. Both stop before Management API token consumption or provider observation. Do not infer the approved owner from a live response or add ownership fields to the public runtime manifest.

`apply`, `doctor`, and `rollback` remain explicitly blocked with `INSTALLER_CONTRACT_UNRESOLVED`. There is no new durable journal writer, resource-adoption path, or release-receipt writer in this handoff. The local migration inventory checks each actual PostgreSQL file against `migrations/parity.yaml`; it is not an applied-migration journal. Existing unowned tables or legacy/private installation metadata are not accepted as a resumable installation. Do not apply the SQL files manually to bypass S11.

Credential acquisition stays outside this code. After the private signed-owner contract is resolved, the installer continues to require an authorized Management API token via scoped `SUPABASE_ACCESS_TOKEN` environment injection. A working pooler connection does not replace owner/control-plane checks. Native keyring/browser access and token-injection bridging remain Main-owned; the old project token is not a fallback and no source entries are deleted.

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
