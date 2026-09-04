# E1-7 CapabilityManifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the S2 canonical types, a deterministic `CapabilityManifest` builder/decoder, the signed install manifest trust boundary, and an authenticated `GET /capabilities` whose three-mode fixtures share one schema and carry no secret, user, or institution identifier.

**Spec:** `docs/specs/S2-auth-capability-manifest.md` §2.1, §2.7, §2.8, §5; `CCC_OPEN_PILOT_PLAN.md` lines 134-160, 248.

## Global Constraints

- Types and pure logic live in `@ccc/contracts` (`runtime.ts`, `jcs.ts`, `capabilities.ts`, `install-manifest.ts`) because the static client (E2-3) must verify the manifest and decode capabilities without importing `@ccc/core`. Only global `crypto.subtle` (Ed25519) is used; no `node:` imports (`guard:core-imports`).
- `canonicalizeJcs` moves from `packages/core/src/gateway.ts` to `@ccc/contracts/jcs`; gateway imports it, no re-export.
- Server side reads one artifact: the signed install manifest JSON in `CCC_INSTALL_MANIFEST` verified against `CCC_INSTALL_SIGNING_KEYS` (`{ keyId: base64 raw Ed25519 public key }`). Mode, `installationId`, and the approved STT engine registry come from the verified manifest only. Missing or invalid manifest → 503 `service_unavailable` (fail closed). Requested axes: `CCC_STT_MODE`, `CCC_LLM_MODE` (default `off`).
- Disabled reasons follow S2 §2.8 line 219 with an explicit `sttGatePassed` input per STT mode: gate not passed → `unverified`; gate passed but no signed registry entry (or no Agent) → `unsupported`; entry present but azure key absent → `missing_key`. `openai`: key missing → `missing_key`; key present but pilot switch, external-call switch, or Agent not ready → `unsupported`.
- The server reads gate state from the signed registry (entry for a mode = gate passed) because S2 has no separate signed gate field yet; the builder input keeps the states distinct so a later signed flag only changes `packages/http-api/src/capabilities.ts`.
- `AZURE_SPEECH_KEY` stays in the Python Agent's SecretStore (plan line 129, S9). No TypeScript env field; `azureKeyPresent` is Agent-reported state and is `false` until E5-3/E9-2 report it.
- `agentStatus` maps current `PipelineHealth.status` (`ok → connected`, `stale → delayed`, `inactive → inactive`). `authentication_error` and `quota_exceeded` are decodable now and produced by E9-2.
- Agent (`role=service`) gets 403 on `GET /capabilities`. Response has `Cache-Control: no-store` and `X-CCC-Installation-Id`. No audit row: the payload is deployment configuration with no case or PII data (same rationale as `/organization/profile`).
- Installer generation of the signed manifest, DPAPI endpoint records, JWKS, CORS, and the client bootstrap fetch are E6/E7/E8/E2-3 territory. This ticket ships the verifier, the equality checks, and `apps/client/public/ccc-bootstrap.json.example` with empty values.

---

### Task 1: `@ccc/contracts` types + `jcs.ts`
- [x] Append S2 §2.1 and §2.8 types to `packages/contracts/src/runtime.ts`; add `PublicBootstrap`, `SignedInstallManifest`, `ApprovedSttEngineEntry`.
- [x] Create `packages/contracts/src/jcs.ts`; switch gateway and `gateway-domain.test.ts` imports.

### Task 2: `packages/contracts/src/capabilities.ts`
- [x] `buildCapabilityManifest(input)` and `decodeCapabilityManifest(value, registry)` with the invariants in S2 §2.8.

### Task 3: `packages/contracts/src/install-manifest.ts`
- [x] `signInstallManifest`, `verifySignedInstallManifest`, `parsePublicBootstrap`, `assertBootstrapMatchesManifest`, `resolveEffectiveApiBase`.

### Task 4: `GET /capabilities`
- [x] `getAgentStatusForCapabilities(env, actor)` in gateway (no admin check, no audit).
- [x] Route in `request-handler.ts`; env fields in `identity.ts`.

### Task 5: Tests and entries
- [x] `apps/api/test/capabilities.contract.test.ts`: 18 fixtures, decoder rejections, route (200 human, 403 service, 503 without manifest, header, no-store, no secret keys).
- [x] `apps/api/test/install-manifest.security.test.ts`: valid, tampered, expired, sequence replay, wrong install, key revoked, single dynamic port, Supabase equality, publishable key fixtures.
- [x] `scripts/test-suite.mjs` + `test:contracts` / `test:security` in `package.json`.

```bash
pnpm test:contracts --capabilities
pnpm test:security --bootstrap
pnpm guard:core-imports && pnpm typecheck
```
