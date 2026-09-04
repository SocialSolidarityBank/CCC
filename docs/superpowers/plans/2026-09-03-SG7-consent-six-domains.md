# SG7 Consent Six Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADR-0040 §9의 여섯 동의 영역을 immutable ConsentEvent, 목적별 현재 상태 fold, 세 모드 paired schema, 실행 게이트와 API/UI 계약으로 구현한다.

**Architecture:** 여섯 domain은 고정된 English literal과 한국어 문안을 가진다. 사건은 append-only로 저장하고 현재 상태는 `eventSequence` 오름차순으로만 fold한다. SQLite와 PostgreSQL은 동일한 논리 migration과 fixture를 사용하며, API gateway와 PostgreSQL RLS가 기관·역할 경계를 이중으로 검사한다.

**Tech Stack:** TypeScript 5.9, 공통 `Database` port, D1 호환 SQLite, 암호화 SQLite, PostgreSQL/Supabase, Bearer API, React 정적 client, Vitest/contract fixtures

**Spec:** `docs/specs/S7-consent-six-domains.md`

- 상태: 확정 (2026-09-03)
- 근거: ADR-0040 §9, ADR-0041 D79·D81·D82
- 관련 티켓: GitHub #223, Linear CCC-166, E3-8, E4-6, SG5, SG6, SG8
- 구현 증거 상태: 이 계획과 연결된 구현 결과·실행 테스트 결과를 주장하지 않는다. 구현 검증은 부모 실행 트랙에서 수행한다.

## Global Constraints

- 여섯 domain literal은 `personal_data_collection_use`, `sensitive_information_processing`, `counseling_recording`, `external_stt_processing`, `external_llm_cross_border_processing`, `voice_original_retention_period`만 허용한다.
- 여섯 한국어 문안 label은 각각 `개인정보 수집·이용`, `민감정보 처리`, `상담 녹음`, `외부 STT 처리`, `외부 LLM·국외 처리`, `음성 원본 보유기간`으로 고정한다.
- `ConsentEvent`는 domain, decision, provider, purpose, copyVersion, copyHash, effectiveAt, recordedBy 여덟 사실과 immutable id, recordedAt, idempotencyKey, per-domain `revision`, `eventSequence`, correctionOfEventId를 가진다.
- per-domain `revision`과 `eventSequence`는 uint다. `ConsentGateReceipt.consentRevision`은 required-domain entries `{domain,eventSequence,revision,eventId,copyHash,decision,provider,purpose,effectiveAt}`를 domain 사전순으로 JCS 직렬화한 SHA-256 lowercase hex다. `assertGate`는 receipt를 반환한다.
- decision은 `grant`, `withdraw`, `decline`, `correct`만 허용한다. correct는 authorization facts를 바꾸지 않고 target을 연결하는 감사 사건이며, 잘못된 authorization은 새 grant 또는 withdraw로만 변경한다.
- provider와 purpose의 한쪽만 NULL인 요청, forged copyHash, 다른 기관의 scope, 미래 effectiveAt, 5분보다 오래된 최초 effectiveAt은 fail closed 한다.
- 현재 상태는 append-only 사건을 `eventSequence` 오름차순으로 fold하고 correct 사건과 legacy observation을 제외한다. mutable current value를 사건 이력 대신 사용하지 않는다.
- 기존 두 동의와 파일럿 text-AI evidence는 새 grant로 자동 승격하지 않고 `legacy_consent_observations`의 `unconfirmed`로 시작한다. 역사 hash가 없거나 검증되지 않으면 fail closed 한다.
- 동의는 목적별로만 적용한다. 한 domain, provider 또는 purpose의 grant를 다른 처리에 재사용하지 않는다.
- intake, manual record, upload, local STT, external STT, LLM egress, raw-audio retention gate와 queued/claimed/in-flight withdrawal은 S7 spec과 SG5·SG6·SG8 계약을 따른다.
- Community Cloud는 Supabase private Storage, Local Single과 Local Office는 각자의 암호화 SQLite 포트를 사용한다. 평문 SQLite 폴백과 외부 provider 자동 전환은 금지한다.
- 문안 변경은 새 `copyVersion`과 canonical UTF-8 NFC/LF/SHA-256 preimage hash를 발행한다. preimage는 provider legal recipient/country, purpose, retentionDuration까지 포함하며 이전 grant를 새 문안 grant로 보지 않는다.
- 외부 provider ID는 STT `azure`, LLM `openai`로 고정한다. provider registry의 법적 수령자·국가 snapshot과 사건 hash preimage가 일치해야 한다.
- 시크릿, 음성 원본, 전사, PII는 로그·오류·fixture 출력에 넣지 않는다.
- 구현자는 이 계획을 실행하면서 ADR, `CCC_OPEN_PILOT_PLAN.md`, master plan을 수정하지 않는다.

---

## File Map

### Create

- `docs/specs/S7-consent-six-domains.md`: 여섯 domain, 문안, ConsentEvent, fold, gates, migration, fixtures의 확정 계약.
- `docs/superpowers/plans/2026-09-03-SG7-consent-six-domains.md`: 이 구현 계획.
- `migrations/sqlite/0048_consent_six_domains.sql`: E3-8 소유 SQLite consent events와 legacy observations paired schema, append-only guards, fixed `unconfirmed`.
- `migrations/sqlite/0049_audio_objects.sql`: SG8 소유 audio objects migration이며 SG7은 수정하지 않는다.
- `migrations/postgres/0005_consent_six_domains.sql`: E3-8 소유 PostgreSQL paired schema, RLS, append-only policy. `0001_baseline`, `0002_sql_portability`, `0003_timestamp_normalization`, `0004_supabase_platform`, `0006_audio_objects` 순서를 보존한다.
- `packages/contracts/src/consent.ts`: E4-6 소유 domain, event, state, DTO 타입과 literal.
- `packages/core/src/consent/consent-events.ts`: E4-6 소유 append, correction, idempotency, fold, gate 규칙.
- `packages/core/test/consent-events.test.ts`: E4-6 소유 순수 fold·시간·동시성·hash 계약 fixture.
- `packages/core/test/consent-gates.test.ts`: E4-6 소유 기능별 gate와 withdrawal race fixture.

### Modify

- `migrations/parity.yaml`: SQLite `0048`와 PostgreSQL `0005`의 consent 대응, SQLite `0049`와 PostgreSQL `0006`의 audio 대응.
- `packages/contracts/src/index.ts`: consent DTO export.
- `packages/core/src/index.ts`: consent service export.
- `apps/api/src/request-handler.ts`: legacy consent input rejection, six-domain event parsing, route cutover.
- `db/gateway.ts`: append/fold/gate writer cutover; legacy columns historical read-only.
- `apps/web/app/lib/api.ts`: six-domain DTO/API client; legacy consent DTO 제거.
- `apps/web/app/actions.ts`: six-domain consent action과 legacy writer 제거.
- `apps/web/app/participants/[beneficiaryId]/page.tsx`: 기존 consent editor의 six-domain wiring.
- `apps/web/app/participants/new/register-form.tsx`: 기존 등록 surface의 six-domain copy wiring.
- `apps/api/src/consent-routes.ts`: current/events API, validation, idempotency.
- `apps/api/test/participant-consent.test.ts`: legacy route/writer `unconfirmed`와 provider call 0 회귀.
- `apps/api/test/consent-privacy-gate.test.ts`: recording/text gate가 fold와 receipt만 소비하는지 검증.
- `apps/client/src/features/consent/consent-copy.ts`: 여섯 문안과 `consent-six-domains-v1` SSOT.
- `apps/client/src/features/consent/ConsentEditor.tsx`: 기존 등록·당사자 정보 동의 surface에 여섯 항목과 상태 문안 배선. 새 화면은 만들지 않는다.
- `apps/client/src/features/consent/consent-copy.test.ts`: label/copy/version/hash canonicalization 회귀.
- `apps/client/src/features/invite/participant-invite.tsx`: 공개 초대 범위에서 본인 사건만 전송하도록 배선.
- `apps/pipeline`의 SG5/SG6/SG8 gate adapter: 큐 삽입, claim, provider 직전 withdrawal·notice 재검증.

## Interfaces

```ts
export type ConsentDomain =
  | 'personal_data_collection_use'
  | 'sensitive_information_processing'
  | 'counseling_recording'
  | 'external_stt_processing'
  | 'external_llm_cross_border_processing'
  | 'voice_original_retention_period';

export type ConsentDecision = 'grant' | 'withdraw' | 'decline' | 'correct';
export type ProviderId =
  | 'institution'
  | 'institution_recording'
  | 'institution_private_storage'
  | 'azure'
  | 'openai';
export type PurposeLiteral =
  | 'case_management'
  | 'sensitive_case_management'
  | 'counseling_recording'
  | 'speech_to_text'
  | 'ai_briefing'
  | 'voice_original_retention';
export type RetentionDuration = 'default_temporary_d85';

export interface ConsentEvent {
  id: string;
  orgId: string;
  beneficiaryId: string;
  supportCaseId: string;
  domain: ConsentDomain;
  decision: ConsentDecision;
  provider: ProviderId | null;
  providerLegalRecipient: string | null;
  providerCountry: string | null;
  purpose: PurposeLiteral | null;
  retentionDuration: RetentionDuration | null;
  copyVersion: string;
  copyHash: string;
  disclosureSnapshotId: string;
  effectiveAt: string;
  recordedBy: string;
  recordedAt: string;
  idempotencyKey: string;
  revision: number;
  eventSequence: number;
  correctionOfEventId: string | null;
}

export interface ConsentState {
  domain: ConsentDomain;
  state: 'unconfirmed' | 'granted' | 'not_granted';
  provider: ProviderId | null;
  providerLegalRecipient: string | null;
  providerCountry: string | null;
  purpose: PurposeLiteral | null;
  retentionDuration: RetentionDuration | null;
  effectiveAt: string | null;
  eventId: string | null;
  revision: number | null;
  eventSequence: number | null;
}

export interface ConsentGateReceipt {
  required: Array<{
    domain: ConsentDomain;
    eventSequence: number;
    revision: number;
    eventId: string;
    copyHash: string;
    decision: 'grant';
    provider: ProviderId;
    purpose: PurposeLiteral;
    effectiveAt: string;
  }>;
  consentRevision: string;
}
export interface ConsentDisclosureSnapshot {
  snapshotId: string;
  scopeBinding: { orgId: string; programId: string; issuerId: string; supportCaseId: string | null };
  domain: ConsentDomain;
  fullKoreanCopy: string;
  provider: ProviderId | null;
  providerLegalRecipient: string | null;
  country: string | null;
  purpose: PurposeLiteral | null;
  retentionProfile: 'default_temporary_d85';
  retentionDuration: 'default_temporary_d85';
  copyVersion: string;
  copyHash: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ConsentService {
  appendEvent(input: Omit<ConsentEvent, 'id' | 'recordedAt' | 'revision' | 'eventSequence'>): Promise<ConsentEvent>;
  listEvents(scope: ConsentScope): Promise<ConsentEvent[]>;
  fold(scope: ConsentScope): Promise<ConsentState[]>;
  assertGate(scope: ConsentScope, gate: ConsentGate): Promise<ConsentGateReceipt>;
}
```

`POST /support-cases/:supportCaseId/consent-events`는 client `id`, `recordedAt`, `revision`, `eventSequence`를 받지 않는다. `GET /support-cases/:supportCaseId/consent`는 여섯 상태와 per-domain revision/sequence만, `/consent/events`는 권한 있는 immutable metadata 이력만 반환한다. `assertGate`는 required-domain entries와 SHA-256(JCS(sorted entries)) aggregate `consentRevision`을 반환하며 SG5·SG6·SG8이 이를 bind한다. 공개 초대 token은 pre-signup에서 기관·사업·issuer만 서명하고, consume transaction에서 새 case/participant와 초기 여섯 event를 원자 결합한다. consume 뒤 self mutation은 금지한다.

### Exact copy table

`copyVersion=consent-six-domains-v1`의 label과 full copy는 다음 literal을 그대로 사용한다. copyHash preimage에는 domain, label, full copy, provider legal recipient/country, purpose, retentionDuration가 포함된다.

| domain | label | full copy |
|---|---|---|
| `personal_data_collection_use` | 개인정보 수집·이용 | 개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다. |
| `sensitive_information_processing` | 민감정보 처리 | 건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다. |
| `counseling_recording` | 상담 녹음 | 상담 내용을 녹음하여 상담 기록 작성에 이용합니다. |
| `external_stt_processing` | 외부 STT 처리 | 녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다. |
| `external_llm_cross_border_processing` | 외부 LLM·국외 처리 | 가림 처리한 상담 자료를 외부 LLM에 보내 요약·정리하며 국외에서 처리될 수 있습니다. |
| `voice_original_retention_period` | 음성 원본 보유기간 | 상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다. |

`effectiveAt`은 interactive event 최초부터 `serverNow - 5분 <= effectiveAt <= serverNow`여야 한다. per-domain `revision`과 `eventSequence`는 transaction에서 원자 증가한다. `ConsentGateReceipt.consentRevision`은 required entries를 sorted JCS로 직렬화한 SHA-256이며 fold는 sequence로만 한다. correct는 target authorization facts와 동일하고 fold에서 제외된다.

---

### Task 1: Literal, copy, canonical hash SSOT

**Owner:** E4-6

**Files:**
- Create: `packages/contracts/src/consent.ts`
- Create: `apps/client/src/features/consent/consent-copy.ts`
- Create: `apps/client/src/features/consent/consent-copy.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Produces:** 여섯 literal, 여섯 label/copy, `consent-six-domains-v1`, canonical serialization과 lowercase SHA-256 helper.

- [ ] `ConsentDomain`과 copy map에 §2의 여섯 값을 정확히 한 번씩 넣는다.
- [ ] NFC, BOM reject, CRLF/CR to LF, line trailing space/tab 제거, `<null>` marker, terminal LF 하나를 canonical preimage helper로 고정한다.
- [ ] preimage가 domain, label, full copy, provider legal recipient/country, purpose, retentionDuration을 묶도록 한다.
- [ ] copyHash가 forged 값이면 오류를 내고 입력을 대체하지 않도록 한다.
- [ ] provider registry snapshot이 `azure`와 `openai`를 exact ID로 제공하도록 한다.
- [ ] copy version 변경은 새 map entry를 요구하고 기존 버전의 hash를 변경하지 않도록 테스트한다.
- [ ] label·copy의 punctuation이 spec과 한 글자라도 다르면 실패하는 fixture를 둔다.

### Task 2: Paired SQLite/PostgreSQL schema와 legacy migration

**Owner:** E3-8

**Files:**
- Create: `migrations/sqlite/0048_consent_six_domains.sql`
- Create: `migrations/postgres/0005_consent_six_domains.sql`
- Do not modify: SQLite `0049_audio_objects.sql`, PostgreSQL `0006_audio_objects.sql` (SG8)
- Modify: `migrations/parity.yaml`
- Create or modify: schema snapshot fixture owned by E3-8

**Produces:** `consent_events` table, six-domain CHECK, unique idempotency key, correction FK/check, scope index, append-only guard, legacy `unconfirmed` marker, PostgreSQL RLS.

- [ ] `UNIQUE (org_id, support_case_id, domain, idempotency_key)`와 scope `event_sequence` index를 양쪽에 둔다. per-domain `revision`은 scope·domain별 unique, `event_sequence`는 scope별 unique로 원자 할당한다.
- [ ] `legacy_consent_observations`를 source table/row/field composite key, observed timestamp, notice hash, 고정 `unconfirmed` state로 양쪽에 만들고 fold에서 제외한다.
- [ ] UPDATE/DELETE를 trigger 또는 동등한 DB guard로 거부하고 append 시도 audit code를 고정한다.
- [ ] 기존 `consent_privacy_at`, `consent_recording_at`, `consent_text_ai_at`, `consent_text_ai` evidence를 observation으로 연결하되 ConsentEvent grant를 insert하지 않는다.
- [ ] missing/unverifiable historical hash는 observation과 fail-closed marker로 남기고 hash를 추정하지 않는다.
- [ ] PostgreSQL SG11 `ccc_api` transaction-local `app.org_id`/`app.actor_id` RLS를 사용한다. `ccc_gateway`와 actor helper를 만들지 않는다. UPDATE/DELETE policy는 만들지 않는다.
- [ ] SQLite에는 RLS가 없다는 사실을 숨기지 않고 gateway scope guard를 필수로 둔다.
**Scoped proof:** E3-8 구현자는 paired schema contract fixture와 migration parity fixture를 단일 테스트로 실행한다. 부모 검증 명령은 §Parent verification에 있다.

### Task 3: Append, correction, idempotency, fold

**Owner:** E4-6

**Files:**
- Create: `packages/core/src/consent/consent-events.ts`
- Create: `packages/core/test/consent-events.test.ts`
- Modify: `packages/core/src/index.ts`

**Produces:** 서버 시간·scope·provider/purpose·copyHash 검증, concurrent serialization, correction target validation, current-state fold.

- [ ] decision별 correction 규칙을 구현한다. `correct`는 target의 domain, provider, legal recipient/country, purpose, retentionDuration, copyVersion, copyHash, effectiveAt를 그대로 복사하고 fold에서 제외한다. authorization 변경은 새 grant/withdraw event로만 허용한다.
- [ ] provider/purpose pair와 closed domain×decision matrix를 검증하고 비적용 scope는 provider 관련 필드를 모두 NULL로 한다. grant의 provider/purpose NULL/NULL은 금지한다.
- [ ] 서버 transaction이 scope별 `eventSequence`, scope·domain별 uint `revision`을 원자 할당한다. fold는 timestamp나 ID가 아닌 eventSequence를 사용한다.
- [ ] `ConsentGateReceipt`는 required-domain entries를 domain 사전순 JCS로 hash한 aggregate `consentRevision`과 per-domain revision/sequence를 반환하고, SG5/6/8 job token에 이를 묶는다.
- [ ] current state는 `unconfirmed`, valid grant의 `granted`, valid withdraw/decline의 `not_granted`를 계산하며 correct와 legacy observation을 제외한다.

**Scoped proof:** `consent-events.test.ts` 단일 파일에서 fold, correction, backdating, idempotency, concurrency fixture를 실행한다.

### Task 4: Functional gates and withdrawal races

**Owner:** E4-6, SG5/SG6/SG8 adapter owners

**Files:**
- Create: `packages/core/test/consent-gates.test.ts`
- Modify: `packages/core/src/consent/consent-events.ts`
- Modify: SG5 job gate adapter
- Modify: SG6 Privacy Gateway adapter
- Modify: SG8 AudioStore adapter

**Produces:** intake/manual/upload/local STT/external STT/LLM egress/raw retention gate와 queued/claimed/in-flight race handling.
SG8 adapter behavior is consumed from resolved commit `9125dc8`; this plan only binds its receipt and does not redefine the local-versus-Azure adapter contract.

- [ ] S7 spec §4 표의 각 gate를 named `ConsentGate`로 구현하고 no cross-purpose reuse를 assertion으로 고정한다.
- [ ] manual record는 normal consent 또는 문서화된 emergency/non-consent legal basis가 있을 때만 법적으로 accepted 된다. accepted 기록은 즉시 official record이고 AI draft가 아니며, basis가 없으면 제출을 저장했다고 주장하지 않고 sensitive fields를 disable한다.
- [ ] 개인정보 미동의의 기관 정책 예외를 제외한 intake gate를 닫는다. accepted manual record는 녹음·외부 STT·LLM 동의로 우회하지 않는다.
- [ ] local STT는 `counseling_recording` grant만 요구하고 external STT grant를 재사용하지 않는다. external STT는 정확한 provider `azure`와 `counseling_recording` + `external_stt_processing` grant/purpose 일치를 요구한다.
- [ ] LLM packet은 external LLM cross-border grant와 필요한 personal/sensitive grant를 별도로 확인한다.
- [ ] D85 `default_temporary_d85`만 사용한다. retention-domain grant/decline과 무관하게 원음 보유 hard cap은 7일이며, 현재 non-temporary/7-day 선택 profile은 없다. 향후 profile은 새 literal·copy·reconsent로만 추가한다.
- [ ] queue insert, claim, provider call 직전 세 번 재검증한다. withdrawal 후 queued 취소, claimed lease 회수, in-flight 결과 commit 금지와 audit를 구현한다.
- [ ] gate authorization token에 aggregate `consentRevision`과 required entries의 per-domain revision/sequence를 묶어 SG5/SG6/SG8 adapter가 stale token을 거부한다.
- [ ] `consent-six-domains-v1`에서 notice가 바뀌면 old grant를 `unconfirmed`로 보고 reconsent를 요구한다.

**Scoped proof:** gate/race 단일 테스트 파일에서 provider call count 0, manual fallback, discarded result audit를 확인한다.

### Task 5: API, DTO, 기존 UI surface, 공개 초대

**Owner:** E4-6

**Files:**
- Create: `packages/http-api/src/consent-routes.ts`
- Create: `packages/http-api/test/consent-routes.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/client/src/features/consent/ConsentEditor.tsx`
- Modify: `apps/client/src/features/invite/participant-invite.tsx`
**Produces:** current/events API, validation error mapping, 기존 UI의 여섯 문안, 공개 초대 scope와 one-time consume atomic binding.


- [ ] POST에서 unknown key, legacy consent key, client id, recordedAt, revision/sequence, wrong hash, wrong disclosure snapshot, wrong scope를 거부한다. submit은 `snapshotId`와 `copyHash`를 포함한다.
- [ ] disclosure endpoint는 `ConsentDisclosureSnapshot`의 domain, fullKoreanCopy, provider legal recipient/country, purpose, D85 profile/duration, copyVersion/hash, snapshotId/issuedAt/expiresAt를 모두 반환한다. UI와 공개 invite는 모든 필드를 렌더하고 나서만 grant를 enable한다.
- [ ] 서버는 submit 때 token/scope와 snapshot을 재조회해 hash, scope, expiry를 확인한다. missing/hidden/modified/stale/mismatched disclosure는 `consent_disclosure_mismatch`이고 event/provider call 0이다.
- [ ] GET current와 events를 분리해 current response에 이력 전체를 섞지 않고 per-domain revision/sequence를 포함한다.
- [ ] 관리자·담당 실무자만 같은 기관 사건 metadata를 보고, 당사자는 token consume 시 초기 event만 원자 기록한다. one-time consume 뒤 self mutation은 거부한다.
- [ ] 공개 초대 pre-signup token에는 org/program/issuer만 서명하고 beneficiary/case/provider/history를 넣지 않는다. 이후 withdrawal은 staff 또는 future scope-limited request link로만 허용한다.
- [ ] 기존 등록·당사자 정보 편집 surface에 six labels와 `동의함`/`철회함`/`거부함`/`확인 필요`를 배치한다. 새 화면은 추가하지 않는다.
- [ ] fail-closed 문구 `이 항목의 동의 상태가 확인되지 않아 해당 처리를 진행할 수 없습니다.`와 fallback 문구 `수기 기록은 계속 사용할 수 있습니다.`를 그대로 사용한다.
- [ ] cross-org read/write, partial-domain withdrawal, public invite leakage, legacy route unconfirmed/provider-call-zero fixture를 API test에 둔다.


**Scoped proof:** `consent-routes.test.ts` 단일 파일과 기존 consent component test를 실행한다.

### Task 6: Parent integration and documentation handoff

**Owner:** E3-8/E4-6 parent integration

**Files:**
- Modify: `docs/specs/S7-consent-six-domains.md` only if implementation-independent contract errata is discovered
- Modify: E3/E4 schema snapshot and contract manifests
- Do not modify: ADRs, `CCC_OPEN_PILOT_PLAN.md`, master plan

**Produces:** SG7 contract linked to migration, API, gate, parity, RLS, and audit artifacts without claiming implementation completion in this plan.

- [ ] E3-8 and E4-6 implementation references this spec and retains the exact six literals.
- [ ] Parent records fixture IDs, migration logical IDs, and error codes without storing PII or audio.
- [ ] Parent runs every command in §Parent verification and records results in implementation tickets, not by changing this spec to `구현 검증 완료` early.
- [ ] Parent confirms all adversarial fixtures pass their expected fail-closed verdicts and no old consent auto-upgrades.
- [ ] Parent commits implementation separately from this documentation commit.
- [ ] Parent updates S11 migration order to PostgreSQL `0001_baseline` → `0002_sql_portability` → `0003_timestamp_normalization` → `0004_supabase_platform` → `0005_consent_six_domains` → `0006_audio_objects`, master E3-8 parity to SQLite `0048/0049` and PostgreSQL `0005`, and SG8 dependency to resolved `9125dc8`; these parent files are not edited by SG7.

## Adversarial Fixture Matrix

The fixture names and expected results are part of the implementation contract.

| Fixture | Expected result |
|---|---|
| `legacy_recording_timestamp_never_grants` | legacy recording timestamp becomes `legacy_consent_observations.state=unconfirmed`; no grant |
| `legacy_text_ai_evidence_never_grants` | old text-AI evidence becomes observation; no external call |
| `forged_copy_hash` | append rejected; state and provider calls unchanged |
| `provider_purpose_mismatch` | append and gate rejected |
| `concurrent_grant_withdraw_distinct_keys` | transaction atomically allocates distinct `eventSequence`/per-domain `revision`; both rows retained; `ConsentGateReceipt.consentRevision` changes by SHA-256(JCS(sorted entries)); fold uses sequence last |
| `idempotency_same_payload_replay` | same key and payload returns existing event; new row/provider call 0 |
| `idempotency_payload_conflict` | same key and different payload returns `idempotency_conflict`; row/state unchanged |
| `effective_at_future_or_first_event_old` | `future_effective_at` or `backdated_consent_event`; no state change |
| `legacy_route_recording_text_gate` | old input/writer rejected; `unconfirmed`; provider call 0 |
| `disclosure_snapshot_missing` | grant disabled; `consent_disclosure_mismatch`; event/provider call 0 |
| `disclosure_field_hidden` | client submission rejected because every snapshot field was not rendered; no event |
| `disclosure_copy_or_hash_modified` | server refetch mismatch rejected; no event/provider call |
| `disclosure_expired_or_scope_mismatch` | `consent_disclosure_mismatch`; no event/provider call |
| `cross_org_access` | RLS/gateway deny; zero foreign rows |
| `partial_domain_withdrawal` | recording/STT/LLM/retention withdrawal leaves accepted manual record behavior unchanged; personal/sensitive withdrawal blocks affected new fields unless documented alternate basis; prior official records remain immutable |
| `withdrawal_in_flight` | no new call; result commit denied or discarded with audit |
| `append_only_mutation` | UPDATE/DELETE denied; row count/hash unchanged |
| `invalid_correction_target_or_auth_change` | correction denied; target unchanged; new grant/withdraw required |
| `notice_version_reconsent` | old grant not reused; state unconfirmed until reconsent |
| `null_provider_nonnull_purpose_or_grant_null_null` | schema/API validation failure |
| `retention_default_temporary_d85` | retention-domain grant/decline both retain D85 default; no non-temporary/7-day choice; hard cap 7 days; future extension requires new literal/copy/reconsent |
| `manual_record_without_basis` | submission not accepted/stored; sensitive fields disabled; no AI draft |
| `public_invite_post_consume_self_mutation` | one-time token binds initial events atomically; later self mutation denied |

## Parent verification

These are parent-run commands after E3-8 and E4-6 land. They are recorded here as verification instructions, not as evidence that this plan or spec has been implemented.

```bash
pnpm test:contracts --db=sqlite
pnpm test:contracts --db=postgres
pnpm test:db-parity
pnpm guard:sql-dialect
pnpm guard:migration-parity
pnpm guard:rls
pnpm --filter @ccc/api test -- consent
```

Failure means any one of the following: SQLite/PostgreSQL row, result, error, or failed-batch rollback differs; old columns or observations become grant; sequence allocation is non-monotonic or fold uses timestamp/ID; forged hash, mismatched provider/purpose, future/backdating, cross-org access, or append mutation succeeds; a legacy route/writer reaches a provider; a fail-closed gate makes an external call; a withdrawal race commits an invalid result; a manual record without legal basis is accepted or an accepted record becomes an AI draft; an assertion is deleted, skipped, or weakened. The parent must attach actual runtime evidence to E3-8/E4-6 before changing status from `확정` to `구현 검증 완료`.

## Completion Criteria

- [ ] E4-6 clean cutover inventory removes/rejects legacy API inputs and writers; old columns are historical read-only; all recording/text gates consume six-domain fold; old routes produce `unconfirmed` and provider call 0.
- [ ] Manual record acceptance requires normal consent or documented emergency/non-consent legal basis; accepted records are immediately official, never AI drafts, and blocked sensitive fields are not stored.
- [ ] `docs/specs/S7-consent-six-domains.md` and this plan both remain marked `확정`.
- [ ] Ownership boundary is explicit: E3-8 owns paired storage migration and E4-6 owns full API/client/Agent wiring; SG5/SG6/SG8 retain their runtime queue/privacy/audio contracts.
- [ ] No implementation result or runtime evidence is asserted by either document.
- [ ] Parent verification commands and failure criteria are present and no ADR or master plan is edited.
- [ ] `ConsentGateReceipt` aggregate `consentRevision` is SHA-256(JCS(sorted required entries)) and per-domain revision/eventSequence are bound by SG5/SG6/SG8.
- [ ] D85 `default_temporary_d85` is the only retention behavior with a 7-day hard cap; non-temporary/7-day profile choice is absent and future extensions require new literal/copy/reconsent.
- [ ] Partial withdrawal preserves accepted manual records and their immutability; personal/sensitive withdrawal blocks affected new fields unless an alternate legal basis is documented.
- [ ] `ConsentDisclosureSnapshot`의 모든 server fields가 결정 전 반환되고 UI/public invite가 모두 렌더한 뒤 snapshotId+hash를 제출하며 server refetch mismatch/stale를 거부한다.

## Out of Scope

Actual migration execution, repository implementation, provider or legal approval, new screen design, deployment, backup/restore, and production evidence belong to E3-8, E4-6, SG5, SG6, SG8, and their parent verification. This plan does not create aliases for legacy consent names and does not weaken fail-closed behavior.
