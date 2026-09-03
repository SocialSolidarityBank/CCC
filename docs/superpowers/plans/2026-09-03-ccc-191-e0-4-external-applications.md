# CCC-191 E0-4 External Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a checkable owner, submission or access evidence, and response date for every external prerequisite that gates the CCC Open Pilot.

**Architecture:** Keep non-secret status in one repository handoff and screenshots in `artifacts/external-applications/`. External accounts remain the source of truth. Never copy credentials, verification codes, identity documents, billing data, or private agreement text into the repository.

**Tech Stack:** Microsoft Azure and Artifact Signing, Hugging Face Hub, OpenAI DPA workflow, Linear, repository Markdown and PNG evidence.

**Spec:** `CCC_OPEN_PILOT_PLAN.md` E0-4 and `docs/adr/0041-one-core-three-deployment-modes.md`

## Global Constraints

- Run the matching `~/developer/tools/portwright/bin/portwright preflight <service-id>` before changing an external service.
- Reuse existing authenticated accounts and approved secret stores. Do not request or expose secrets in chat or repository files.
- A pending provider response does not block closing E0-4 when the request, owner, evidence, and expected response date are recorded.
- Do not treat Microsoft nonprofit sponsorship as a paid Azure subscription eligible for Artifact Signing.
- Keep future legal analysis in SG14 and E11-1a. E0-4 assigns ownership and dates only.
- Use `approved`, `granted`, `pending`, `blocked`, `declined`, or `not submitted` for status. Every non-final state needs one dated next check.

---
### Task 1: Code-signing and Microsoft prerequisites

**Files:**
- Create: `artifacts/external-applications/README.md`
- Evidence: `artifacts/external-applications/`

- Consumes: the approved Microsoft nonprofit account, ADR-0041's OV/EV-first decision, the Artifact Signing requirements in `~/developer/tools/portwright/services/codesign.md`, and the selected CA's published organization-validation requirements.
- Produces: separate non-secret OV/EV, Azure, and Artifact Signing status consumed by SG14, E6-1b, and E10-3.

- [x] **Step 1: Verify Microsoft nonprofit and Azure status**

Read the current Microsoft approval email and portal state. Record the source timestamp, account owner, granted benefit, and any stated deadline without copying account identifiers or credentials.
- [x] **Step 2: Verify both code-signing paths**

For the primary OV/EV path, confirm whether a CA, purchase authority, and authorized organization representative exist. For Artifact Signing, confirm whether an eligible paid subscription and authorized organization representative exist. Record each path separately as `blocked` or `not submitted` when its prerequisites are absent. Submit only when all human approvals for that path exist, and retain only the non-secret request ID, state, and timestamp.

- [x] **Step 3: Record response dates**
Use the provider's explicit date when given. Before submission, record the next internal owner check. After an Artifact Signing submission, record Microsoft's official 1 to 20 business-day validation window.

### Task 2: Model access and licenses

**Files:**
- Modify: `artifacts/external-applications/README.md`
- Evidence: `artifacts/external-applications/pyannote-speaker-diarization-3.1-access.png`
- Modify: `supply-chain/model-license-manifest.json`
- Modify: `scripts/release/verify.mjs`
- Evidence: `artifacts/external-applications/pyannote-segmentation-3.0-access.png`

**Interfaces:**
- Consumes: public Hugging Face model metadata and the authenticated browser access state.
- Produces: pinned model revisions, licenses, and gated-access state consumed by SG5, E5-2, and E10-2.

- [x] **Step 1: Verify both pyannote gates**

Confirm `pyannote/speaker-diarization-3.1` and `pyannote/segmentation-3.0` show granted access for the logged-in owner. Do not record cookies or tokens.

- [x] **Step 2: Verify immutable model metadata**

Record repository URL, revision SHA, and license from the public Hugging Face API for both pyannote repositories and the three non-gated project models. Add the gated `pyannote/segmentation-3.0` dependency to the model manifest and release verifier.

- [x] **Step 3: Record runtime follow-up**

Assign authenticated download verification at the pinned revisions to E5-2. E0-4 proves access and licensing only.

### Task 3: OpenAI DPA

**Files:**
- Modify: `artifacts/external-applications/README.md`
- Evidence: `artifacts/external-applications/openai-dpa-request-confirmation.png`
- Evidence: `artifacts/external-applications/openai-dpa-delivery-redacted.png`
- Evidence: `artifacts/external-applications/openai-dpa-decline-mail-redacted.png`

**Interfaces:**
- Consumes: the OpenAI DPA request confirmation and delivery or signing email.
- Produces: request state, owner, and next check date consumed by SG14 and E11-1a.

- [x] **Step 1: Verify request submission**

Record the confirmation timestamp and the destination account without copying private form values.

- [x] **Step 2: Check delivery and signature state**

Inspect the destination inbox for the generated agreement. Record `requested`, `delivered`, `signed`, `declined`, or `action required`, plus the provider message timestamp.

- [x] **Step 3: Record the next check**

For an undelivered or terminal request, record the next business-day owner check and the condition for creating a replacement request. Do not claim OpenAI ZDR or MAM approval from a DPA request.

### Task 4: Legal ownership and handoff

**Files:**
- Modify: `artifacts/external-applications/README.md`

**Interfaces:**
- Consumes: Linear ownership for CCC-191, SG14, and E11-1a.
- Produces: an accountable coordinator and dated follow-up route for 개인정보 처리방침, 동의 여섯 영역 문안, Supabase 위탁 문서, OpenAI 국외 이전 고지, OpenAI DPA 민감정보 확인 또는 비식별 수준 법률 검토, 기관별 보존 근거표, 권리요청 10일 절차, 침해사고 72시간 절차, 2026-09-11 시행 법 개정 대조.

- [x] **Step 1: Record legal coordinator**

Record the current Linear assignee as the coordination owner. Separate this role from external counsel or authorized representative roles that remain unassigned.

- [x] **Step 2: Record downstream dates**

Record SG14's target date and E11-1a's target date from Linear. Do not close either downstream ticket from E0-4.

- [x] **Step 3: Validate the handoff**

Run `pnpm guard:doc-numbers && pnpm guard:secrets`. Confirm every E0-4 row has status, owner, evidence, response window or next check, and an exact next action.

- [x] **Step 4: Commit and publish**

On branch `e0-4-external-applications`, commit the plan, handoff, redacted evidence, `supply-chain/model-license-manifest.json`, and `scripts/release/verify.mjs`. Open a PR to `main` for CCC-191, obtain an independent review, and merge only after CI passes. Then add a plain-language completion comment and set Linear CCC-191 to Done.
