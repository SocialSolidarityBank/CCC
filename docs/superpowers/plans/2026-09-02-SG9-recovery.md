# SG9 Secrets and Recovery Kit Contract Plan

> **For agentic workers:** This documentation ticket is complete when the contract and ticket-local plan are committed. The parent session owns focused and project-wide validation after parallel pilot tickets land; this branch runs no formatter, linter, build, or test suite.

**Goal:** Close SG9 as a contract-only gate for secret ownership, Windows DPAPI account scope, Recovery Kit v1, atomic rewrap, and different-SID restore continuity.

**Architecture:** ADR-0041 D76/D82/D83 is the policy source. S9 owns the secret boundary, standalone CCCR v1 wrapper header, Recovery Kit payload, generation journal, and restore invariants. S2 owns the stable-user-ID generation and Actor mapping; S4 owns Local service profiles; S10 owns the `.cccx` import format and the Argon2id/AES-GCM parameter baseline that S9 matches without reusing S10 framing; ADR-0038 owns role and assignment semantics. Interfaces between these contracts are referenced, not redefined.

**Scope:** Modify only `docs/specs/S9-secrets-recovery-kit.md` and this plan. Do not edit `CCC_OPEN_PILOT_PLAN.md`, ADRs, application code, sibling specs, tickets, PR state, or external credentials.

## Global constraints

- The three formal modes remain Community Cloud, Local Single, and Local Office; this ticket does not remove or weaken a mode.
- Core reads only `CoreSecretName`; Platform reads only `PlatformSecretName`; Python Agent secrets (`AZURE_SPEECH_KEY`, `AGENT_REFRESH_TOKEN`, `HF_TOKEN`) remain in the Python SecretStore and never enter the TypeScript Core port.
- Community Cloud uses institution-owned provider secret storage. Local Single uses the interactive user’s DPAPI `CurrentUser`; Local Office uses the dedicated Windows Service account’s DPAPI `CurrentUser`; Agent uses its own account’s DPAPI `CurrentUser`.
- `LocalMachine`, DB/file/log/UI/URL/browser-storage/CLI/crash-dump plaintext, raw SID identifiers, and passphrase persistence are forbidden. Secret and provider errors are redacted to fixed codes and generic screen copy. Local and Agent crash dumps are disabled; secret/error buffers are zeroized in `finally`.
- Runtime recovery APIs use byte-only `RecoverySecretStore.getBytesWithVersion()` and mutable `SecretBytes = Uint8Array`; RFC 8949 §4.2 deterministic canonical CBOR payloads carry key material as byte strings and no JSON/base64 key strings. `PII_ENC_KEY` is versioned by `PII_KEY_VERSION`; DB and file master keys have explicit positive versions. The Recovery Kit payload has a mandatory nullable `officeCaKey` slot plus exact CA/certificate metadata.
- Recovery Kit magic is `43 43 43 52 01`; S9 defines a closed CCCR header/framing and domain-separated AAD authenticating magic, length, and header. It matches S10’s Argon2id/AES-GCM parameters but does not ambiguously reuse S10 `.cccx` framing. Every export uses fresh CSPRNG salt 16B and nonce 12B; salt/nonce fields are unpadded RFC4648 base64url (decoded 16/12 bytes), `payloadSha256` is lowercase 64-hex, and reuse for the same derived key fails.
- Passphrases are at least 16 Unicode scalar characters, are accepted only through a secure input path, and are never saved in payload, DPAPI records, logs, fixtures, or reports. Argon2, decrypted payload, CA, and error buffers are zeroized in `finally`; Local/Agent crash dumps are disabled.
- Cloud/Office restore and rewrap require technical-admin + current MFA + scoped capability + audit before any key read/write. Single requires unlocked app-lock + local interactive recovery capability; clean-machine/server bootstrap requires an online organization-owned signed latest-generation floor and a target TPM/device-bound centrally single-use one-time physical capability.
- A `data_restored` result is impossible unless Kit integrity, target-key rewrap, schema/mode/install/org equality, every existing DB row/file ciphertext/plaintext content hash, every vault envelope decrypt/re-encrypt, authorized record save, role/assignment continuity, actor credential verifier mapping, and generation activation all pass. `operational_restored` additionally requires actual actor login/MFA re-enrollment or explicit audited disable+reinvite; Local Office additionally requires CA pair/chain/client-trust and HTTPS identity continuity. Failures preserve the previous active generation.
- Recovery payload binds `kitId`, S10 `payloadSha256`, source installation/org, `createdAt`, monotonic generation, and `previousKitHash`. Existing targets use local high-water; clean targets use the signed online floor. Replay/downgrade is rejected by default; only an audited step-up disaster override may proceed, with full current-state verification still required.
- Restore/rotation stages DPAPI/Edge keys, DB, files, PII, CA, and Kit in shadow generations under a maintenance write fence that drains and pins the source generation, then flips one atomic active pointer. A crash leaves old active or fully verified new active; it never leaves a mixed or ambiguous state.
- `확정` requires complete document definitions only. It does not claim that DPAPI, an adapter, a Windows PC, or a server replacement has already run.

## Task 1: Define ownership and DPAPI boundaries

**File:** `docs/specs/S9-secrets-recovery-kit.md`

- Record the exact Core, Platform, and Python secret names and which runtime may read each one.
- Map Cloud Edge/provider secret storage and the three Local/Agent `CurrentUser` account scopes without duplicating a key in plaintext storage.
- Define versioned key material for `DB_MASTER_KEY`, `FILE_ENC_KEY`, `PII_ENC_KEY`/`PII_KEY_VERSION`, and Office CA private key material.
- Reference S2 §2.2 for `stableUserId` generation and Actor mapping rather than inventing a SID-derived identifier.
- Explicitly forbid LocalMachine DPAPI and direct SID use; document the expected same-account success and different-account failure behavior.

## Task 2: Define Recovery Kit v1 and errors

**File:** `docs/specs/S9-secrets-recovery-kit.md`

- Fix the `CCCR` v1 magic bytes and standalone fixed layout/header; match S10’s cryptographic parameters while defining domain-separated AAD over magic, length, and canonical header without reusing `.cccx` framing. Define fresh CSPRNG salt/nonce per export and reject reuse.
- Define deterministic canonical CBOR payload byte-string fields and exact metadata: payload/schema version, schema digest, source mode, `kitId`, S10 `payloadSha256`, source installation/org, `createdAt`, generation, previous Kit hash, stable user ID, exhaustive Cloud/Office actor/credential/MFA mapping, DB/file/PII versioned slots, and mandatory nullable `officeCaKey`.
- Define byte-only `RecoverySecretStore.getBytesWithVersion`, mutable `SecretBytes` runtime boundaries, 16-character passphrase, zeroization/finally rules, and disabled crash dumps; prove no secret/passphrase storage across payload, filesystem, logs, UI, and reports.

## Task 3: Define restore, continuity, and atomic rewrap

**File:** `docs/specs/S9-secrets-recovery-kit.md`

- Define operation authorization before any key read/write: Cloud/Office technical-admin + MFA + scoped capability + audit; Single unlocked app-lock + local recovery capability; clean-machine online signed latest-generation floor plus target TPM/device-bound centrally single-use physical bootstrap.
- Define a maintenance write fence that drains acknowledged writes, pins source generation, and stays held through shadow verification and active-pointer flip.
- Define restore checks and distinct `data_restored` / `operational_restored` statuses so schema/mode/install/org mismatch, full existing DB/file ciphertext/plaintext hashes, every vault envelope, vault decrypt, or authorized record save failure cannot be reported as restored.
- Keep source DPAPI blobs tied to the source SID; for a clean different-SID PC, open the passphrase envelope and rewrap into the target account’s `CurrentUser` DPAPI instead of attempting source-blob decrypt.
- On same-SID password/service-account reset unprotect failure, require Kit and never generate a replacement key or empty vault automatically.
- Require stable-user-ID preservation and logical users/roles/case assignments from the backup data; Cloud/Office carry exhaustive actor/credential/MFA continuity mapping and actual login/MFA re-enrollment or audited disable+reinvite, and no Actor derives from SID, email, or a new install UUID.
- Define Local Office CA behavior: nullable slot does not invent a fingerprint; exact key/cert/chain DER metadata and client trust are checked; a later CA-only Kit import can recover the existing CA into the target service account without touching DB/assignments.
- Define generation-staged DPAPI/Edge, DB, file, PII, CA and Kit shadow writes, one active pointer, high-water/replay checks, disaster override, restart/rollback matrix, and crash-safe Kit temp/write/flush/verify/replace/reopen sequence.
- Distinguish passphrase-only rewrap from data-key version rotation and keep old/new generations until verification completes; zeroize all sensitive buffers in `finally`.
- Reference S10 for data export/import and payload hash semantics, S2 for identity, S4 for service profiles, ADR-0038 for role/assignment semantics, and E6-7/E7-3/E8-5 for runtime ownership.

## Task 4: Close fixtures, verification, and scope

**File:** `docs/specs/S9-secrets-recovery-kit.md`

- Fix F01–F12 inputs and expected verdicts for deterministic CBOR payload/header/AAD, fresh salt/nonce, passphrase boundary, same-account and reset DPAPI, cross-account rejection, authorization-before-read, clean-target floor/TPM capability, different-SID restore, full-content fail-closed, generation atomicity/write fence, key rotation, nullable/later CA recovery, redacted errors, and replay/high-water.
- Include expected no-leak, zeroization/crash-dump, full content/vault, actor login/MFA, and old-state preservation assertions in all failure fixtures.
- List focused contract/security/atomicity/golden commands with exact failure conditions. These commands are implementation evidence for E tickets, not prerequisites for the S9 `확정` state.
- State out-of-scope implementation and duplication boundaries, with no TODO/TBD or weakened gate.

## Acceptance checklist

- [ ] Core/Platform/Python ownership and every secret’s allowed storage/account scope are complete.
- [ ] DPAPI `CurrentUser` per Single user, Office service account, and Agent account is explicit; LocalMachine, same-SID reset replacement, and other plaintext locations are forbidden.
- [ ] Mutable `SecretBytes`/byte-only recovery port, zeroization/finally, crash-dump disablement, RFC 8949 §4.2 deterministic canonical CBOR byte-string payload, Recovery Kit magic, standalone CCCR header/AAD, fresh salt/nonce and unpadded base64url/lowercase hash encodings, S10 parameter compatibility, exact versioned payload, nullable CA slot, stable user ID, exhaustive actor continuity, and non-stored 16+ passphrase are complete.
- [ ] Cloud/Office/Single operation authorization occurs before any key read/write; clean targets require an online signed latest-generation floor and centrally single-use target TPM/device-bound physical bootstrap.
- [ ] Different-SID restore rewraps to the target SID, preserves full roles/assignments and ciphertext/plaintext content hashes, and does not use source DPAPI blobs directly.
- [ ] `data_restored` requires every DB/file/vault verification, vault decrypt, authorized record save, continuity, actor credential verifier mapping, schema/mode/install/org equality, and activation; `operational_restored` additionally requires actor login/MFA or audited disable+reinvite and mode-specific CA/client-trust checks; any failure preserves prior state.
- [ ] Generation-staged atomic write/verify/replace, maintenance fence/drain, high-water/replay guard and audited disaster override, passphrase/data-key rewrap, old/new crash atomicity, restart rollback, and later CA recovery are complete.
- [ ] F01–F12 fixture inputs and expected success/failure/redaction/rollback/replay/randomness verdicts are complete.
- [ ] Only the two owned documentation files change; no implementation, ticket, or external secret state changes.

## Verification

The parent worktree runs the documented commands after all SG tickets land. This branch intentionally runs no validation commands, formatter, linter, build, or test suite while sibling contract work is in progress.

## Commit

Commit the canonical S9 spec and this ticket-local plan together on branch `sg9-recovery`. Do not push or merge from this worktree.
