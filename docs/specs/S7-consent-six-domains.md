# S7: Consent Six Domains

- 상태: 확정 (2026-09-03)
- 근거: ADR-0040 §9, ADR-0041 D82, ADR-0041 D79
- 입력: `docs/adr/0040-community-cloud-policy.md` §9, `docs/adr/0041-one-core-three-deployment-modes.md` §D81-82, `migrations/sqlite/0008_participant_consent_records.sql`, `migrations/sqlite/0014_session_intake_record.sql`, `migrations/sqlite/0020_support_case_consent_privacy.sql`, `migrations/sqlite/0043_privacy_consent_notice_evidence.sql`, `db/gateway.ts`, `apps/web/app/lib/api.ts`, `docs/specs/SPEC-TEMPLATE-and-S1-example.md`
- 산출: 여섯 영역의 식별자·문안·사건·게이트·이전·DTO/API 계약. 구현 산출물은 E3-8과 E4-6이 소유한다.
- 관련 티켓: GitHub #223, Linear CCC-166, E3-8, E4-6, SG5, SG6, SG8

## 1. 목적

기존 녹음·텍스트 AI 두 컬럼과 개인정보 이력을 여섯 개의 독립 목적 영역으로 확장한다. 동의 현재 상태는 불변 사건을 접어 계산하고, 목적별 철회와 외부 처리 게이트가 서로의 동의를 재사용하지 않도록 한다. 이 문서는 구현 완료나 실행 증거가 아니라, 구현자가 그대로 소비할 수 있는 확정 계약이다.

## 2. 식별자와 문안

식별자는 아래 여섯 개만 허용한다. 별칭, 대문자 표기, 하이픈 표기, 기존 `privacy`, `recordingAi`, `textAi` 등의 매핑 이름을 새 사건의 domain으로 사용하지 않는다.

| English identifier literal | 한국어 문안 label | 화면·고지용 canonical copy |
|---|---|---|
| `personal_data_collection_use` | 개인정보 수집·이용 | 개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다. |
| `sensitive_information_processing` | 민감정보 처리 | 건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다. |
| `counseling_recording` | 상담 녹음 | 상담 내용을 녹음하여 상담 기록 작성에 이용합니다. |
| `external_stt_processing` | 외부 STT 처리 | 녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다. |
| `external_llm_cross_border_processing` | 외부 LLM·국외 처리 | 가림 처리한 상담 자료를 외부 LLM에 보내 요약·정리하며 국외에서 처리될 수 있습니다. |
| `voice_original_retention_period` | 음성 원본 보유기간 | 상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다. |

`copyVersion`의 첫 값은 `consent-six-domains-v1`이다. 위 label과 copy는 이 버전에 속하는 여섯 개의 정본 문안이며, 문안 변경은 새 `copyVersion`을 발행하고 기존 사건을 수정하지 않는다. 문안의 법률 검토 상태와 기관별 보유기간은 별도 승인 자료지만, 승인된 문안의 값은 이 계약의 literal을 변경하지 않고 버전으로 추가한다.

### 2.1 copyHash canonicalization

`copyHash`는 다음 canonical preimage의 SHA-256 lowercase hexadecimal 64자다. 이 preimage는 domain, label, full copy뿐 아니라 당시 provider의 법적 수령자·국가, purpose, retentionDuration을 함께 묶는다.

```text
domain=<English identifier literal>\nlabel=<한국어 문안 label>\ncopy=<canonical copy>\nprovider=<provider id or <null>>\nproviderLegalRecipient=<legal recipient or <null>>\nproviderCountry=<ISO-3166-1 alpha-2 or <null>>\npurpose=<purpose literal or <null>>\nretentionDuration=<duration literal or <null>>\n
```

canonicalization은 순서대로 수행한다.

1. 입력은 UTF-8이며 BOM은 허용하지 않는다.
2. Unicode NFC로 정규화한다.
3. CRLF와 CR을 LF로 바꾼다.
4. 각 줄의 ASCII space와 tab 후행 문자를 제거한다.
5. `<null>`은 비적용 값의 유일한 표현으로 사용한다.
6. 마지막 LF 하나를 보장한다. 빈 줄은 문안에 포함된 경우 보존한다.
7. 위 직렬화 레코드를 UTF-8 bytes로 해시한다.

provider legal recipient와 country는 기관의 승인된 provider registry snapshot에서 복사한다. `azure`는 Azure Speech의 승인된 한국 endpoint 수령자 snapshot을, `openai`는 OpenAI의 법적 수령자와 `US` country snapshot을 사용한다. 사건에 들어간 snapshot과 registry가 다르면 저장과 실행을 거부한다. hash를 다시 계산해 입력값을 조용히 대체하지 않는다.

## 3. ConsentEvent 불변 스키마
다음 TypeScript는 논리 DTO의 정본이다. `recordedAt`, `revision`, `eventSequence`, `id`는 서버 transaction이 정하고, 나머지 필드는 요청 검증을 거친다.

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
  id: string;                    // immutable event id
  orgId: string;
  beneficiaryId: string;
  supportCaseId: string;
  domain: ConsentDomain;         // required fact 1: item/domain
  decision: ConsentDecision;     // required fact 2
  provider: ProviderId | null;  // required fact 3, applicability matrix below
  providerLegalRecipient: string | null;
  providerCountry: string | null;
  purpose: PurposeLiteral | null; // required fact 4, applicability matrix below
  retentionDuration: RetentionDuration | null;
  copyVersion: string;           // required fact 5
  copyHash: string;              // required fact 6, lowercase SHA-256
  disclosureSnapshotId: string; // server-issued disclosure proof
  effectiveAt: string;           // required fact 7, ISO-8601 UTC
  recordedBy: string;            // required fact 8, actor id or `self` only at token consume
  recordedAt: string;            // immutable server append time
  idempotencyKey: string;        // immutable retry key
  revision: number;              // monotonic per scope and domain, uint
  eventSequence: number;         // monotonic per scope
  correctionOfEventId: string | null;
}
```

`id`, scope IDs, `domain`, `decision`, `copyVersion`, `copyHash`, `disclosureSnapshotId`, `effectiveAt`, `recordedBy`, `recordedAt`, `idempotencyKey`, `revision`, `eventSequence`는 NULL 또는 빈 문자열이 아니며 `revision`과 `eventSequence`는 양의 정수다. `copyHash`는 정확히 64자의 `[0-9a-f]`다. provider가 non-NULL이면 `providerLegalRecipient`와 `providerCountry`도 non-NULL이어야 하고, provider가 NULL이면 둘 다 NULL이어야 한다. providerCountry는 ISO-3166-1 alpha-2다. retentionDuration도 purpose와 domain matrix에 맞지 않으면 거부한다.
`recordedBy=self`는 token consume의 원자 transaction에서만 허용한다. 그 밖의 append와 이후 철회·정정은 같은 기관의 활성 기관 관리자 또는 담당 실무자 actor만 허용한다.

`decision=correct`는 authorization fact를 단 한 가지도 바꾸지 않는 정정 감사 사건이다. `correctionOfEventId`는 필수이고 target과 같은 scope·domain·provider·providerLegalRecipient·providerCountry·purpose·retentionDuration·copyVersion·copyHash·effectiveAt를 그대로 복사해야 한다. correct 사건은 현재 상태 fold에 참여하지 않는다. 잘못된 grant·withdraw·decline을 권한 상태에서 고치려면 target을 수정하거나 correct로 대체하지 않고, 올바른 `grant` 또는 `withdraw`를 새 event로 append한다.

### 3.1 provider와 purpose 적용성

provider와 purpose는 한 사건이 허용하는 수신자와 처리 목적을 정확히 고정한다. 둘 중 하나만 비어 있으면 거부한다.

| domain | provider가 필요한 경우와 허용 형식 | purpose literal |
|---|---|---|
| `personal_data_collection_use` | 해당 수집·이용 사건에 적용될 때 `institution` | `case_management` |
| `sensitive_information_processing` | 해당 민감정보 처리 사건에 적용될 때 `institution` | `sensitive_case_management` |
| `counseling_recording` | 해당 녹음 사건에 적용될 때 `institution_recording` | `counseling_recording` |
| `external_stt_processing` | 외부 STT를 선택한 사건에서만 정확히 `azure` | `speech_to_text` |
| `external_llm_cross_border_processing` | 외부 LLM을 선택한 사건에서만 정확히 `openai` | `ai_briefing` |

| `voice_original_retention_period` | D85 기본 정책을 고지하는 사건에서만 `institution_private_storage` | `voice_original_retention` |

providerLegalRecipient, providerCountry, purpose, retentionDuration까지 포함한 closed matrix는 다음과 같다. `grant`에서 provider와 purpose가 모두 NULL인 조합은 금지한다. `voice_original_retention_period`의 retentionDuration은 grant와 decline 모두 `default_temporary_d85`로 고정되며 보유기간을 연장하지 않는다. 현재 제품에는 non-temporary 또는 7일 선택 profile이 없다. 향후 profile은 새 literal·copyVersion·reconsent로만 추가한다.

| decision | 적용 사건 | 비적용 사건 |
|---|---|---|
| `grant` | provider, providerLegalRecipient, providerCountry, purpose가 모두 non-NULL이고 domain 표와 일치. retention domain은 `retentionDuration=default_temporary_d85` | 금지. 사건을 만들지 않는다. |
| `withdraw` | 기존 grant target의 provider, 법적 수령자, 국가, purpose, retentionDuration을 그대로 복사 | grant target 없이 임의 철회 금지 |
| `decline` | 제안된 provider/purpose가 있으면 그 scope를 복사. retention domain은 `default_temporary_d85`를 유지 | provider, providerLegalRecipient, providerCountry, purpose, retentionDuration 모두 NULL |
| `correct` | target의 authorization facts를 전부 그대로 복사하고 `correctionOfEventId`만 추가 | target 없이 정정 금지 |

- 로컬 STT 또는 수기 기록만 선택되어 외부 STT가 호출되지 않으면 `external_stt_processing` 사건을 만들지 않거나, 선택 거부를 기록할 때 두 필드를 모두 NULL로 한다.
- LLM이 `off`이면 `external_llm_cross_border_processing` 사건을 만들지 않거나, 선택 거부를 기록할 때 두 필드를 모두 NULL로 한다.
- 원음을 기본 임시 처리 후 삭제하는 경로에는 `voice_original_retention_period`의 grant가 필요 없다. 장기 보유를 선택할 때만 표의 provider와 purpose를 채운다.
- 비적용 `decline`은 NULL provider와 NULL purpose를 사용한다. 이미 특정 provider·purpose를 제안받은 뒤 거부하는 사건이면 해당 값을 그대로 기록한다.
- `withdraw`와 `correct`는 철회·정정 대상의 적용 범위를 잃지 않도록 target과 같은 provider·purpose를 사용한다. 적용되지 않은 scope는 NULL이다.

한 domain의 grant를 다른 domain, 다른 provider, 다른 purpose의 근거로 사용할 수 없다. provider 설정, 지역, 계약 승인, 민감정보 상태가 현재 사건과 일치하지 않으면 `consent_not_effective`로 fail closed 한다.

### 3.2 시간, 순서, 동시성

- `effectiveAt`은 동의가 효력을 갖는 사업 시각이고 `recordedAt`은 서버가 append를 확정한 시각이다. interactive event의 `effectiveAt`은 최초 event라도 `serverNow - 5분 <= effectiveAt <= serverNow`여야 한다. 미래 시각은 `future_effective_at`으로 거부하고, 5분보다 오래된 시각은 `backdated_consent_event`로 거부한다. import는 ConsentEvent가 아닌 observation으로만 들어온다.
- 서버 transaction이 scope별 `eventSequence`와 scope·domain별 `revision`을 원자적으로 1씩 할당한다. 동시 grant와 withdraw는 반드시 서로 다른 idempotency key를 사용하며, 두 사건 모두 immutable history에 남고 할당된 sequence의 마지막 event가 현재 상태를 결정한다. fold는 timestamp나 event ID가 아니라 `eventSequence` 오름차순을 사용한다.
- idempotency key가 같고 payload가 같으면 기존 결과를 반환한다. 같은 key와 다른 payload는 `idempotency_conflict`로 거부한다. `recordedAt`은 애플리케이션이 제공하지 않는다.
- correct 사건은 sequence를 받지만 fold에서 제외된다. correction target이 없거나 다른 scope·domain이면 거부한다. sequence allocator 또는 서버 시계 오류로 순서를 신뢰할 수 없으면 새 외부 처리를 시작하지 않고 관리자 장애 상태를 남긴다.
`ConsentGateReceipt`는 gate가 실제로 확인한 domain 집합의 불변 영수증이다. 각 entry의 `revision`은 uint이고 `eventSequence`, `eventId`, `copyHash`, `decision`, `provider`, `purpose`, `effectiveAt`를 함께 담는다. required-domain entry를 domain literal 사전순으로 정렬한 JSON Canonicalization Scheme(JCS) 문자열의 SHA-256 lowercase hex가 aggregate `consentRevision`이다.

```ts
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
  consentRevision: string; // SHA-256(JCS(sorted required entries))
}
```

`assertGate(scope, gate)`는 `Promise<ConsentGateReceipt>`를 반환한다. required domain 중 하나라도 현재 effective state가 아니거나 entry가 바뀌면 receipt를 만들지 않고 `consent_not_effective`로 fail closed 한다. SG5·SG6·SG8은 provider call/result commit 때 receipt의 aggregate와 각 entry revision/sequence를 다시 대조한다.
`ConsentDisclosureSnapshot`은 결정을 활성화하기 전에 서버가 반환하는 scope/token-bound 고지 snapshot이다. 아래 모든 필드를 서버가 채우며 UI가 일부를 숨기거나 자체 문안으로 대체할 수 없다.
SG8의 resolved AudioStore 계약은 commit `9125dc8`을 기준으로 한다. SG7은 이 계약을 소비하며 local recording-only와 Azure recording-plus-external-STT 구분을 다시 정의하지 않는다.

```ts
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
```

`GET /support-cases/:supportCaseId/consent/disclosures` 또는 공개 invite pre-signup disclosure endpoint가 domain별 snapshot을 반환한다. UI와 공개 invite는 snapshot의 fullKoreanCopy, provider legal recipient, country, purpose, D85 profile/duration, version/hash와 유효 시각을 모두 렌더한 뒤에만 grant를 enable한다. submit은 `snapshotId`와 `copyHash`를 포함하고, 서버는 token과 scope를 재조회해 snapshot binding, hash, `expiresAt`를 확인한다. 누락·숨김·변조·만료·scope mismatch면 event를 저장하지 않고 `consent_disclosure_mismatch`로 거부한다.
현재 상태는 `consent_events`를 scope(`orgId`, `beneficiaryId`, `supportCaseId`)와 domain으로 제한한 뒤 `eventSequence` 오름차순으로 접어 계산한다. `correct` 사건은 fold에서 제외한다. 최초 상태와 유효한 grant가 없거나 현재 `copyVersion`·`copyHash`를 검증할 수 없는 상태는 `unconfirmed`다. 현재 문안과 유효한 provider·purpose·actor·적용 정책을 모두 만족하는 `grant`만 `granted`가 되고, 유효한 `withdraw`와 `decline`은 `not_granted`다. target과 correction 행을 모두 보존하며 현재 상태를 mutable column에 저장해 사건과 별도로 갱신하는 것을 정본으로 삼지 않는다.

| 기능 | 필요한 상태 | 미충족 시 허용되는 경로 |
|---|---|---|
| intake | `personal_data_collection_use=granted`, 민감정보를 받으면 `sensitive_information_processing=granted` | 기관 정책의 개인정보 예외가 있는 긴급 등록만 허용. 이후 보완 기한을 기록한다. |
| manual record | 제출 시점에 입력하려는 개인정보·민감정보 domain의 `granted` 또는 기관 정책상 문서화된 emergency/non-consent legal basis | 승인된 수기 기록은 즉시 공식 기록이며 AI draft가 아니다. basis가 없으면 submission을 저장했다고 주장하지 않고 해당 sensitive field를 비활성화하며, 녹음·외부 STT·LLM 동의만으로 우회하지 않는다. |
| upload / recording | `counseling_recording=granted` | 녹음 없이 수기 기록. 원음은 D85 `default_temporary_d85` 시계로만 임시 처리하고 hard cap 7일을 넘기지 않는다. |
| local STT | 녹음된 원음이면 `counseling_recording=granted`만 필요하다 | 외부 STT consent를 재사용하지 않고, 미충족이면 외부 호출 없이 수기 기록으로 전환한다. |
| external STT | `counseling_recording=granted` + `external_stt_processing=granted` + 정확히 `azure` provider/purpose 일치 | provider 호출 0건, 로컬 STT 또는 수기 기록. 자동 provider 전환 금지. |
| LLM egress | `external_llm_cross_border_processing=granted` + `personal_data_collection_use=granted`; 민감정보가 packet에 있으면 sensitive domain도 `granted` | Privacy Gateway가 packet을 만들지 않거나 외부 호출 없이 수기 기록. `external_stt_processing`은 근거가 아니다. |
| raw-audio retention | D85의 `default_temporary_d85` 정책만 적용하며 retention domain의 grant/decline과 무관하게 7일 hard cap을 넘지 않는다 | 현재 제품에는 non-temporary 또는 7일 선택 profile이 없다. 향후 profile은 새 literal·copy·reconsent로만 추가한다. |

withdraw 또는 현재 상태 재검증은 모든 외부 작업의 큐 삽입 전, claim 직후, provider 호출 직전에 수행한다. gate가 소비하는 `ConsentGateReceipt`에는 필요한 domain별 `revision`, `eventSequence`, effective state와 aggregate `consentRevision`을 함께 묶는다.

- queued: withdrawal transaction이 작업을 취소하고 외부 호출을 만들지 않는다.
- claimed: lease를 회수하고 provider 호출 전 재검증에서 중단한다.
- in-flight: 이미 전송된 요청을 회수할 수 있다고 가정하지 않는다. 취소 시도, 결과 저장 금지, 결과 폐기와 관리자 감사 이벤트를 남긴다.
- withdrawal과 claim이 경합하면 consent event append와 claim 검사가 같은 scope lock/transaction 순서를 따르며, 먼저 할당된 `eventSequence`가 승리한다. 호출 직전에는 저장된 domain별 revision/sequence와 job에 묶인 `ConsentGateReceipt`가 모두 같아야 한다.
- copyVersion이 바뀌면 이전 grant는 자동으로 새 문안에 대한 grant가 아니다. 새 문안의 reconsent 사건을 받을 때까지 `unconfirmed`로 취급하고 외부 처리를 잠근다.

## 5. 이전, paired schema, RLS와 감사

### 5.1 기존 두 종류의 이전

`support_cases.consent_recording_at`, `support_cases.consent_text_ai_at`, `participant_consent_records`의 같은 이름 컬럼과 `pilot_text_ai_consent_evidence`는 역사 자료로 보존한다. 다음 매핑은 새 grant 사건을 만들지 않고 각 domain의 초기 상태를 `unconfirmed`로 만든다.

| 과거 자료 | 보이는 새 domain | migration 결과 |
|---|---|---|
| `consent_privacy_at` 또는 `privacy` | `personal_data_collection_use` | timestamp를 legacy observed metadata로 보존하고 `unconfirmed` |
| `consent_recording_at` 또는 `recording` | `counseling_recording` | timestamp를 legacy observed metadata로 보존하고 `unconfirmed` |
| `consent_text_ai_at`, `recordingAi`, 또는 파일럿 text-AI evidence | `external_llm_cross_border_processing` | 목적·provider가 새 계약과 다르므로 `unconfirmed` |
| 위 자료에 없는 네 domain | 해당 domain | `unconfirmed` |

과거 시각, `privacy_notice_version`, `privacy_notice_sha256`가 있더라도 새 six-domain grant로 자동 승격하지 않는다. migration은 `legacy_consent_observations`에 `(org_id, source_table, source_row_id, source_field)` 키와 `observed_at`, `notice_hash`, 고정 `state='unconfirmed'`를 기록한다. 이 observation table은 current-state fold와 모든 실행 gate에서 제외한다. 역사 hash가 없거나 현재 canonicalization과 일치하는지 확인할 수 없으면 fail closed하며 hash를 추정·백필하지 않는다. 이후 사람이 새 문안으로 재동의한 사건만 `granted`가 될 수 있다.
### 5.1.1 E4-6 clean cutover inventory

- `consentPrivacy`, `consentRecordingAi`, `consentRecording`, `consentTextAi`, `privacy`, `recordingAi`, `textAi`를 six-domain API의 입력으로 받지 않는다. unknown legacy key는 400으로 거부하고, legacy server action·route·writer는 삭제한다.
- `support_cases.consent_recording_at`, `support_cases.consent_text_ai_at`, `support_cases.consent_privacy_at`, `participant_consent_records`의 구 column은 historical read-only compatibility view에서만 읽는다. 새 API·gateway·Agent·AudioStore가 이 column을 쓰거나 authorization gate로 조회하지 않는다.
- 모든 녹음, text-AI, external STT, LLM gate는 `consent_events` fold와 bound `ConsentGateReceipt`만 소비한다. old column/evidence의 non-NULL은 authorization 사실이 아니다.
- legacy route가 남아 있거나 구 input이 전달된 fixture는 `unconfirmed`와 provider call count 0을 함께 반환해야 한다. 이를 통과시키기 위해 legacy input을 six-domain event로 변환하거나 alias하지 않는다.

### 5.2 SQLite/PostgreSQL paired schema

논리 migration 순서는 PostgreSQL baseline `0001_baseline.sql`, SQL portability `0002_sql_portability.sql`, timestamp normalization `0003_timestamp_normalization.sql`, Supabase platform `0004_supabase_platform.sql`(여기서 `ccc_api` role 생성), SG7 consent `0005_consent_six_domains.sql`, SG8 audio objects `0006_audio_objects.sql`이다. SQLite는 SQL portability `0046_sql_portability.sql`, timestamp normalization `0047_timestamp_normalization.sql`, E5-1a Agent jobs `0048_agent_jobs.sql`, SG7 consent와 legacy observations를 함께 담는 `0049_consent_six_domains.sql`, SG8 audio objects `0050_audio_objects.sql`을 사용한다. PostgreSQL의 SG7 `0005`도 consent_events와 legacy observations를 함께 만든다. `migrations/parity.yaml`은 logical pair를 1:1로 기록하고 파일명 존재, live catalog hash, table·column·constraint·index·trigger·policy semantic annotation을 검증한다. E3-4가 baseline과 manifest hash를 소유하고 E3-2가 두 portability pair를 소유한다.

SQLite `migrations/sqlite/0049_consent_six_domains.sql`:

```sql
CREATE TABLE consent_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  beneficiary_id TEXT NOT NULL,
  support_case_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN (
    'personal_data_collection_use',
    'sensitive_information_processing',
    'counseling_recording',
    'external_stt_processing',
    'external_llm_cross_border_processing',
    'voice_original_retention_period'
  )),
  decision TEXT NOT NULL CHECK (decision IN ('grant', 'withdraw', 'decline', 'correct')),
  provider TEXT,
  provider_legal_recipient TEXT,
  provider_country TEXT,
  purpose TEXT,
  retention_duration TEXT,
  copy_version TEXT NOT NULL,
  copy_hash TEXT NOT NULL CHECK (length(copy_hash) = 64 AND copy_hash NOT GLOB '*[^0-9a-f]*'),
  disclosure_snapshot_id TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
  correction_of_event_id TEXT,
  CHECK ((provider IS NULL) = (provider_legal_recipient IS NULL)
      AND (provider IS NULL) = (provider_country IS NULL)
      AND (provider IS NULL) = (purpose IS NULL)),
  CHECK ((decision = 'correct') = (correction_of_event_id IS NOT NULL)),
  UNIQUE (org_id, support_case_id, domain, idempotency_key),
  UNIQUE (org_id, beneficiary_id, support_case_id, domain, revision),
  UNIQUE (org_id, beneficiary_id, support_case_id, event_sequence),
  FOREIGN KEY (correction_of_event_id) REFERENCES consent_events(id)
);
CREATE INDEX consent_events_scope_sequence
  ON consent_events (org_id, beneficiary_id, support_case_id, domain, event_sequence);

CREATE TABLE legacy_consent_observations (
  org_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_row_id TEXT NOT NULL,
  source_field TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  notice_hash TEXT,
  state TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (state = 'unconfirmed'),
  PRIMARY KEY (org_id, source_table, source_row_id, source_field)
);
CREATE INDEX legacy_consent_observations_scope
  ON legacy_consent_observations (org_id, source_table, source_row_id);
```

PostgreSQL `migrations/postgres/0005_consent_six_domains.sql`:

```sql
CREATE TABLE consent_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  beneficiary_id text NOT NULL,
  support_case_id text NOT NULL,
  domain text NOT NULL CHECK (domain IN (
    'personal_data_collection_use',
    'sensitive_information_processing',
    'counseling_recording',
    'external_stt_processing',
    'external_llm_cross_border_processing',
    'voice_original_retention_period'
  )),
  decision text NOT NULL CHECK (decision IN ('grant', 'withdraw', 'decline', 'correct')),
  provider text,
  provider_legal_recipient text,
  provider_country text,
  purpose text,
  retention_duration text,
  copy_version text NOT NULL,
  copy_hash text NOT NULL CHECK (copy_hash ~ '^[0-9a-f]{64}$'),
  disclosure_snapshot_id text NOT NULL,
  effective_at text NOT NULL,
  recorded_by text NOT NULL,
  recorded_at text NOT NULL,
  idempotency_key text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  event_sequence bigint NOT NULL CHECK (event_sequence > 0),
  correction_of_event_id text REFERENCES consent_events(id),
  CHECK ((provider IS NULL) = (provider_legal_recipient IS NULL)
      AND (provider IS NULL) = (provider_country IS NULL)
      AND (provider IS NULL) = (purpose IS NULL)),
  CHECK ((decision = 'correct') = (correction_of_event_id IS NOT NULL)),
  UNIQUE (org_id, support_case_id, domain, idempotency_key),
  UNIQUE (org_id, beneficiary_id, support_case_id, domain, revision),
  UNIQUE (org_id, beneficiary_id, support_case_id, event_sequence)
);
CREATE INDEX consent_events_scope_sequence
  ON consent_events (org_id, beneficiary_id, support_case_id, domain, event_sequence);

CREATE TABLE legacy_consent_observations (
  org_id text NOT NULL,
  source_table text NOT NULL,
  source_row_id text NOT NULL,
  source_field text NOT NULL,
  observed_at text NOT NULL,
  notice_hash text,
  state text NOT NULL DEFAULT 'unconfirmed' CHECK (state = 'unconfirmed'),
  PRIMARY KEY (org_id, source_table, source_row_id, source_field)
);
CREATE INDEX legacy_consent_observations_scope
  ON legacy_consent_observations (org_id, source_table, source_row_id);
ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_consent_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON consent_events, legacy_consent_observations FROM anon, authenticated;
CREATE POLICY consent_events_select ON consent_events
  FOR SELECT TO ccc_api
  USING (org_id = current_setting('app.org_id', true));
CREATE POLICY consent_events_insert ON consent_events
  FOR INSERT TO ccc_api
  WITH CHECK (org_id = current_setting('app.org_id', true)
              AND recorded_by = current_setting('app.actor_id', true));
CREATE POLICY legacy_observations_select ON legacy_consent_observations
  FOR SELECT TO ccc_api
  USING (org_id = current_setting('app.org_id', true));
CREATE POLICY legacy_observations_insert ON legacy_consent_observations
  FOR INSERT TO ccc_api
  WITH CHECK (org_id = current_setting('app.org_id', true));
```

PostgreSQL의 API transaction은 SG11 규칙대로 `SET LOCAL app.org_id = <actor org>`와 `SET LOCAL app.actor_id = <actor id>`를 먼저 실행하고 `ccc_api` role로만 SELECT/INSERT한다. RLS policy는 이 transaction-local 값만 사용한다. `ccc_gateway` role이나 `ccc_actor_org_id()`·`ccc_actor_id()` 같은 helper는 만들거나 사용하지 않는다. case 담당 범위와 기관 관리자 권한은 gateway가 검사하되, RLS의 org/actor 조건과 함께 통과해야 한다. `ccc_api` 외 role에는 SELECT/INSERT grant를 주지 않으며 UPDATE·DELETE policy를 만들지 않는다. SQLite와 Local Office는 RLS가 없으므로 같은 scope 검사와 actor 검사를 gateway transaction에서 강제하고 DB credential을 브라우저에 주지 않는다.

두 adapter 모두 UPDATE와 DELETE를 거부하는 trigger 또는 동등한 port guard, scope 불일치 거부, correction target 무결성 검사, idempotency 충돌 검사를 제공한다. append 시도, 거부 이유 code, correction target, withdrawal race, provider mismatch는 audit log에 남기되 원문·음성·식별자를 남기지 않는다. audit log도 org scope와 append-only 정책을 따른다.
감사 사건의 logical record는 `auditEventId`, `orgId`, `actorId`, `action`, `consentEventId`(nullable), `outcomeCode`, `recordedAt`이며, `action`은 `consent_append`, `consent_reject`, `consent_correction`, `consent_withdraw_race`, `consent_gate_block` 중 하나다. 이 record도 SQLite와 PostgreSQL에서 동일한 열·scope index·append-only 제약을 사용하고, 원문·음성·식별자·secret을 저장하지 않는다. rejected append도 actor와 고정 오류 code를 남기며 hash와 사건 id 외 문안 본문은 남기지 않는다.
공개 초대 token은 pre-signup에서 기관·사업·발급자(issuer) scope만 서명해 가진다. token에는 beneficiaryId, supportCaseId, provider, 사건 이력이 들어가지 않는다. token consume transaction이 새 participant와 support case를 생성하면서 token의 org/program/issuer scope와 초기 여섯 consent event를 원자적으로 결합한다. one-time token consume 뒤에는 당사자 self가 사건을 계속 수정할 수 없으며, 이후 철회는 staff 경로 또는 미래에 발급하는 별도 scope-limited request link로만 허용한다.
부모 트랙에 필요한 후속 문서 편집은 이 스펙에서 수행하지 않는다. S11은 PostgreSQL migration order와 `ccc_api` 생성 위치를 `0001_baseline` → `0002_sql_portability` → `0003_timestamp_normalization` → `0004_supabase_platform` → `0005_consent_six_domains` → `0006_audio_objects`로 맞추고, master plan은 E3-8 parity 경로를 SQLite `0049/0050` 및 PostgreSQL `0005`로 갱신해야 한다. SG8은 resolved commit `9125dc8`과 PostgreSQL `0006_audio_objects` 의존성을 연결해야 한다. 이 항목들은 부모가 별도 구현 커밋에서 수행한다.
## 6. DTO, API, 관리자 문안, 공개 초대 범위

- `GET /support-cases/:supportCaseId/consent`는 여섯 domain을 모두 반환하며 각 항목의 `state`는 `unconfirmed | granted | not_granted`, `provider`, `providerLegalRecipient`, `providerCountry`, `purpose`, `retentionDuration`, `effectiveAt`, `eventId`, per-domain `revision`, `eventSequence`를 포함한다. gate용 aggregate `consentRevision`은 이 응답의 current state에 포함하지 않고 `ConsentGateReceipt`에서만 만든다. 사건 전체 이력은 이 응답에 섞지 않는다.
- `GET /support-cases/:supportCaseId/consent/events`는 같은 기관의 권한 있는 관리자와 담당 실무자에게만 immutable metadata를 반환한다. `POST /support-cases/:supportCaseId/consent-events`는 위 `ConsentEvent`에서 서버 필드(`id`, `recordedAt`, `revision`, `eventSequence`)를 제외한 요청을 받고, unknown legacy field와 client server fields를 거부한다.
- 관리자 UI의 여섯 label은 §2의 문자를 그대로 사용한다. 상태 label은 `동의함`, `철회함`, `거부함`, `확인 필요`로 고정한다. fail-closed 안내는 `이 항목의 동의 상태가 확인되지 않아 해당 처리를 진행할 수 없습니다.`로 고정하고, 수기 fallback은 `수기 기록은 계속 사용할 수 있습니다.`로 표시한다. 새 화면을 설계하지 않으며 기존 등록·당사자 정보 동의 편집 surface에 이 계약을 배선한다.

## 7. Adversarial fixtures
구현 계약 테스트는 동일 fixture를 SQLite와 PostgreSQL에 넣고 다음 기대를 모두 확인한다.

| fixture | 기대 결과 |
|---|---|
| old `consent_recording_at` timestamp만 존재 | `counseling_recording=unconfirmed`, grant 0건 |
| old `consent_text_ai_at`와 pilot evidence 존재 | `external_llm_cross_border_processing=unconfirmed`, 외부 호출 0건 |
| canonical copy와 다른 forged `copyHash` | append 거부, 상태 변화 0, 외부 호출 0 |
| `external_stt_processing`에 provider `openai` 또는 purpose `ai_briefing` | provider/purpose mismatch 거부 |
| 서로 다른 idempotency key의 concurrent grant/withdraw | transaction이 서로 다른 `eventSequence`/per-domain `revision`을 원자 할당하고 두 행을 보존; fold는 sequence 마지막 상태 |
| 같은 idempotency key·같은 payload replay | 기존 event를 반환하고 새 row/provider call 0 |
| 같은 idempotency key·다른 payload | `idempotency_conflict`, row/state 변화 0 |
| `effectiveAt`이 serverNow보다 미래이거나 최초 event가 5분보다 오래됨 | 각각 `future_effective_at`/`backdated_consent_event`, state 0 |
| 구 consent API input/writer로 recording/text gate 호출 | `unconfirmed`, provider call 0, legacy writer reject |
| disclosure snapshot missing | grant disabled; `consent_disclosure_mismatch`, event/provider call 0 |
| disclosure field hidden in UI | client submission rejected because all snapshot fields were not rendered; no event |
| disclosure full copy or hash modified | server refetch mismatch rejected; no event/provider call |
| disclosure snapshot expired or scope/token mismatch | `consent_disclosure_mismatch`; no event/provider call |
| correction이 decision/provider/purpose/copy/effectiveAt을 바꾸려 함 | correction 거부; authorization은 새 grant/withdraw 사건으로만 변경 |
| 최신 effectiveAt보다 이른 withdraw | `backdated_consent_event` 거부 |
| org A actor가 org B event 조회·삽입·correction | RLS/gateway 거부, B 결과 노출 0 |
| 여섯 중 한 domain만 withdraw | recording/STT/LLM/retention withdrawal은 accepted manual record와 prior official records를 건드리지 않음. personal/sensitive withdrawal은 affected new fields만 차단하고 documented alternate basis가 있으면 허용 |
| external STT in-flight 중 withdrawal | 새 call 0, 결과 commit 0 또는 폐기 audit 1, 수기 기록 허용 |
| append-only row UPDATE/DELETE | DB/port 거부, 원래 row hash와 count 불변 |
| correction target이 다른 org/domain이거나 missing | correction 거부, target 불변 |
| `copyVersion` 변경 뒤 이전 grant 재사용 | `unconfirmed`/reconsent required, 외부 호출 0 |
| provider가 NULL이고 purpose만 채워짐 | schema/API 거부 |
| retention-domain grant/decline with non-temporary or 7-day choice | choice rejected; D85 `default_temporary_d85` hard cap 7일 유지; future profile requires new literal/copy/reconsent |

## 8. 완료 조건

- [ ] 여섯 English identifier literal과 여섯 Korean copy가 §2와 DTO/API에서 동일하게 사용된다.
- [ ] ConsentEvent의 여덟 required facts, immutable idempotency/correction fields, decision과 fold 규칙이 완결되어 있다.
- [ ] provider/purpose applicability, NULL 규칙, canonical copyHash, effectiveAt/recordedAt, 동시성, backdated rejection이 완결되어 있다.
- [ ] intake, manual record, upload, local STT, external STT, LLM egress, raw-audio retention의 gate와 no cross-purpose reuse가 완결되어 있다.
- [ ] 기존 두 동의의 `unconfirmed` migration, historical hash fail-closed, SQLite/PostgreSQL paired schema, parity, RLS와 audit 규칙이 구현 티켓 소유 경계와 함께 완결되어 있다.
- [ ] SG5·SG6·SG8의 queued/claimed/in-flight withdrawal, notice reconsent, 수기 fallback 계약이 완결되어 있다.
- [ ] DTO/API/admin UI copy/public invite 범위와 adversarial fixture의 입력·기대 결과가 완결되어 있다.
- [ ] 구현 검증 시 사용할 parent 명령과 실패 판정이 §9에 적혀 있으며, 이 문서는 `확정` 상태이지 `구현 검증 완료` 상태가 아니다.
- [ ] per-domain `revision`과 `eventSequence`가 transaction에서 원자 증가하고 `ConsentGateReceipt`의 aggregate와 함께 SG5·SG6·SG8 gate token에 묶이며, fold는 sequence만 사용한다.
- [ ] clean cutover inventory가 legacy API input/writer를 거부하고 old columns를 historical read-only로 제한하며, 구 route는 `unconfirmed`와 provider call 0을 낸다.
- [ ] `legacy_consent_observations`의 composite key와 observed timestamp/notice hash가 paired schema에 있고 fold에서 제외된다.
- [ ] manual record는 normal consent 또는 문서화된 emergency/non-consent basis가 있을 때만 accepted 되고, accepted record는 즉시 official이며 AI draft가 아니고 basis 없는 sensitive field는 저장되지 않는다.
- [ ] `ConsentGateReceipt`가 required-domain entries를 JCS aggregate `consentRevision`으로 묶고 per-domain revision/eventSequence를 제공하며 SG5·SG6·SG8이 이를 검증한다.
- [ ] D85 `default_temporary_d85`와 7일 hard cap만 허용하고 non-temporary/7-day retention profile 선택은 없으며, 향후 추가는 새 literal·copy·reconsent로 제한한다.
- [ ] `ConsentDisclosureSnapshot`의 모든 server fields가 결정 전 반환되고, UI/public invite가 전부 렌더한 뒤 snapshotId+hash를 제출하며, server refetch mismatch/stale를 거부한다.

## 9. 검증 방법

아래는 부모 실행 트랙이 E3-8과 E4-6 구현을 통합한 뒤 실행할 명령이다. 이 SG7 문서 작성에서는 실행하지 않으며, 실행 결과를 이 문서의 증거로 주장하지 않는다.

```bash
pnpm test:contracts --db=sqlite
pnpm test:contracts --db=postgres
pnpm test:db-parity
pnpm guard:sql-dialect
pnpm guard:migration-parity
pnpm guard:rls
pnpm --filter @ccc/api test -- consent
```

모든 명령은 adversarial fixture의 동일 row/result/error와 failed batch rollback을 비교해야 한다. 한 DB라도 old column/observation을 grant로 승격하거나 sequence가 비단조적이거나 fold가 timestamp/ID를 사용하면 실패다. provider mismatch·future/backdating·cross-org access·append mutation, legacy route의 provider call, 법적 basis 없는 manual acceptance, accepted manual record의 AI draft 전환을 허용해도 실패다. 기존 assertion 삭제·skip·완화, 외부 call이 발생한 fail-closed fixture, 기관 간 row 노출이 하나라도 있으면 실패다. 부모는 이 결과와 실제 런타임 증거를 별도 E 티켓에 남긴 뒤에만 `구현 검증 완료`로 상태를 올린다.

## 10. 이번에 안 하는 것

실제 migration 파일, typed repository, API route 구현, Agent/AudioStore 동작, 새 화면 디자인, 법률 승인, provider 계약 승인, 배포·복구 실행은 이 문서에서 하지 않는다. 해당 구현은 E3-8과 E4-6이 SG5·SG6·SG8의 포트를 소비해 소유한다. ADR과 master plan은 수정하지 않는다.
