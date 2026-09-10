# Community Cloud container run contract

This image is for Azure Container Apps (ACA). Deployment configuration, runtime bindings, registry push, and deployment remain operator-owned; this repository procedure builds a local image only.

## Build

Run from the repository root:

```sh
pnpm --filter @ccc/community-cloud build
docker build --platform linux/amd64 -t ccc-community-cloud:beta-local apps/community-cloud
```

The runtime image uses the official Deno 2.9.6 image, pinned to multi-architecture digest `sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d`; provenance: [denoland/deno_docker](https://github.com/denoland/deno_docker). It copies only `dist/index.js` and runs as the non-root `deno` user (UID 1993).

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
