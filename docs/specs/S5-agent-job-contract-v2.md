# S5: 처리 Agent 작업 계약 v2

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76~D82, ADR-0042 D84, ADR-0036, D8, D13, D57
- 입력: `CCC_OPEN_PILOT_PLAN.md` SG5·E5-1a, `docs/specs/SPEC-TEMPLATE-and-S1-example.md`, `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/api-contract-pipeline.md`, `apps/pipeline/ccc_pipeline/worker.py`, `migrations/0036_text_work_lease.sql`
- 산출: Agent가 Database·AudioStore를 직접 열지 않고 공통 API로 작업을 claim, 처리, 결과 제출하는 v2 계약. 구현 산출물은 E5-1a가 소유한다.
- 관련 티켓: E5-1a, E5-1b, E5-2, E5-3, E5-5, E5-6, E6-3, E6-4

## 1. 목적

처리 Agent가 오디오 큐와 텍스트 큐를 같은 규칙으로 처리하도록 claim, 임대, heartbeat, release, 결과 제출과 재시도 경계를 고정한다. 서비스 자격증명의 범위와 세 모드의 오디오 전달 방식을 분리해 원문과 업무 API의 경계를 지킨다. `확정`은 이 계약의 인터페이스와 fixture가 완결됐다는 뜻이며, 실제 Agent·어댑터 실행은 E5-1a 이후의 구현 검증이다.

## 2. 인터페이스와 규칙

### 2.1 타입과 JSON 스키마

```ts
export type JobKind = 'audio' | 'text';
export type JobState =
  | 'pending'       // 아직 claim하지 않음
  | 'leased'        // claim한 서비스 주체가 처리 중
  | 'blocked'       // NER health 차단, attempt를 소모하지 않음
  | 'succeeded'     // 결과를 한 번 수락함
  | 'cancelled'     // 동의 철회로 더 진행하지 않음
  | 'expired'       // AudioStore 원음 수명 만료 또는 삭제 완료
  | 'failed';       // 최대 시도 초과 또는 재시도 불가 오류
export type DeploymentMode = 'community-cloud' | 'local-single' | 'local-office';
export type ProcessingRoute = 'community-cloud-agent' | 'local-single-agent' | 'local-office-agent';
export type SttEngine = 'local' | 'azure' | null;
// ConsentScope의 literal과 의미는 SG7이 유일하게 정의한다. 이 문서에서 반복 정의하지 않는다.
export type ConsentScope = S7ConsentDomain;
export type ReleaseReason =
  | 'engine_unavailable'
  | 'local_ner_unavailable'
  | 'result_schema_invalid'
  | 'masking_failed'
  | 'consent_not_effective'
  | 'audio_object_missing'
  | 'audio_hash_mismatch'
  | 'route_mismatch'
  | 'permanent_failure';
export type PermanentReleaseReason = Exclude<ReleaseReason, 'engine_unavailable' | 'local_ner_unavailable'>;

export interface NerAttestation {
  id: string;
  modelId: string;
  modelRevision: string;
  labelSetHash: string;       // S6가 허용 형식과 의미를 소유
  corpusHash: string;         // S6가 허용 형식과 의미를 소유
  resultHash: string;         // S6가 허용 형식과 의미를 소유
  validatedAt: string;        // ISO-8601 UTC
  expiresAt: string;          // ISO-8601 UTC
  status: 'passed';
}

export interface NerReleaseQualificationReceipt {
  receiptId: string;
  modelId: string;
  modelRevision: string;
  labelSetHash: string;
  corpusHash: string;
  resultHash: string;
  validatedAt: string;            // ISO-8601 UTC
  expiresAt: string;              // ISO-8601 UTC
  status: 'passed';
}

export interface AzureEgressAuthorization {
  egressAuthorizationId: string;
  tuple: {
    orgId: string;
    jobId: string;
    claimTokenHash: string;
    attempt: number;
    rawAudioSha256: string;
    consentRevision: string;
    provider: 'azure';
  };
  status: 'authorized';
  expiresAt: string;
}

export interface OpenAiEgressAuthorization {
  egressAuthorizationId: string;
  tuple: {
    provider: 'openai';
    orgId: string;
    supportCaseId: string;
    sessionId: string;
    workItemId: string;
    actorId: string;
    operation: 'generate' | 'regenerate' | 'detect_discrepancies';
    materialHashes: string[];
    consentRevision: string;
  };
  status: 'authorized';
  expiresAt: string;
}

export type EgressAuthorization = AzureEgressAuthorization | OpenAiEgressAuthorization;
export type EgressRecordStatus = 'authorized' | 'in_flight' | 'completed' | 'revoked' | 'expired';

export interface EgressAuthorizationRequest {
  claimToken: string;             // authenticated channel, server hashes it
  attempt: number;
  rawAudioSha256: string;
  provider: 'azure';
}

export interface EgressInFlightRequest {
  egressAuthorizationId: string;
  claimToken: string;             // authenticated channel, server hashes and compares
  attempt: number;
}

export interface EgressInFlightResponse {
  egressAuthorizationId: string;
  provider: 'azure' | 'openai';
  state: 'in_flight';
  startedAt: string;
}

export interface MaskDictionaryEntry {
  field: string;
  sourceValue: string;            // raw audio/source에서 등록 PII를 찾는 일회성 값
  replacement: string;            // Packet에 남길 가명 replacement
}

export interface MaskDictionaryRequest {
  claimToken: string;
  attempt: number;
}

export interface MaskDictionaryResponse {
  dictionaryId: string;
  jobId: string;
  expiresAt: string;              // 발급 시각 + 5분 이하
  oneTime: true;
  entries: MaskDictionaryEntry[];
}

export interface ClaimRequest {
  limit?: number; // 생략 시 10, 허용 범위 2..50
  nerAttestation: NerAttestation; // claim 전 health gate
  releaseQualificationReceiptId: string; // 서버가 immutable receipt를 조회·검증
}

export interface AgentJob {
  jobId: string;
  sessionId: string;
  caseId: string;
  kind: JobKind;
  state: 'leased';
  attempt: number;       // 첫 claim = 1
  maxAttempts: 3;
  claimToken: string;    // 불투명, result/heartbeat/release/source/audio에 필수
  claimedAt: string;     // ISO-8601 UTC, 총 임대 상한 계산의 기준
  leaseExpiresAt: string; // ISO-8601 UTC, claimedAt + 2시간을 넘지 않음
  enqueuedAt: string;     // ISO-8601 UTC
  route: ProcessingRoute;
  sttEngine: SttEngine;   // text는 null
  requiredConsent: ConsentScope[];
  releaseQualificationReceiptId: string;
  terminalFailureCode: string | null; // 즉시 영구 실패의 exact JobError literal
  maskDictionaryEndpoint: string; // claim-bound, one-time, no-store
  audio: null | {
    generationId: string;                 // opaque AudioStore generation binding
    clientAssertedSha256: string | null; // 업로드 시 client 주장, 신뢰하지 않음
    agentComputedSha256: string | null;  // Agent streamed re-hash 뒤 코어가 저장
    rawAudioSha256: string | null;       // verify 성공 뒤에만 노출하는 trusted hash
    retentionHardCapAt: string;          // uploadedAt + 7*24h UTC, SG8 절대 상한
    processingDeadlineAt: string | null; // min(first opportunity +24h, retentionHardCapAt)
    egressAuthorizationId: string | null; // Azure authorize 전에는 null
    delivery: 'protected-get' | 'api-stream';
    endpoint: string;                // `/pipeline/jobs/:jobId/audio`
    expiresAt: string | null;        // protected-get은 mint 응답에, api-stream은 null
  };
}

export interface ClaimResponse {
  schemaVersion: 2;
  jobs: AgentJob[];
}

export interface HeartbeatRequest {
  claimToken: string;
  attempt: number;
}
export interface HeartbeatResponse {
  jobId: string;
  state: 'leased';
  attempt: number;
  leaseExpiresAt: string;
}

export type ReleaseRequest =
  | {
      claimToken: string;
      attempt: number;
      outcome: 'transient';
      reason: 'engine_unavailable';
    }
  | {
      claimToken: string;
      attempt: number;
      outcome: 'blocked';
      reason: 'local_ner_unavailable';
    }
  | {
      claimToken: string;
      attempt: number;
      outcome: 'permanent';
      reason: PermanentReleaseReason;
    };

export interface MaskedSource {
  maskedText: string;
  sha256: string;                 // maskedText UTF-8 SHA-256, lower-case hex 64자
  maskingPipelineVersion: string; // S6가 값 형식과 허용 버전을 소유
  maskingPipelineHash: string;    // S6가 canonical manifest 해시를 소유, lower-case hex 64자
  nerAvailable: true;             // 성공 Packet은 true literal만 허용
  nerAttestationId: string;
  nerAttestationResultHash: string; // S6가 계산법을 소유, lower-case hex 64자
  releaseQualificationReceiptId: string; // E5-4 통과 receipt, 만료 전이어야 함
  evidenceHash: string;             // SHA-256(JCS(evidence)), lower-case hex 64자
  evidence: Array<{
    id: string;
    sourceRef: string;
    sourceSha256: string;          // maskedText sha256과 같아야 함
    evidenceQuote: string;
    sourceStart: number;          // Unicode code-point offset, inclusive
    sourceEnd: number;             // Unicode code-point offset, exclusive
  }>;
}

export interface AudioResult extends MaskedSource {
  kind: 'audio';
  emotionScores: Record<string, unknown>; // 숫자 JSON만, 감정 서술문 금지
  transcriptReliable: boolean;             // 필수
  transcriptWarnings: Array<{              // 필수
    startSeconds: number;
    endSeconds: number;
    reason: string;                // 고정 형식 코드, 전사·PII 금지
  }>;
}
export interface TextResult extends MaskedSource {
  kind: 'text';
}
export interface ResultRequest {
  schemaVersion: 2;
  claimToken: string;
  attempt: number;
  resultId: string;                 // 논리 결과의 불투명 ID, hash 멱등성의 대체 키가 아님
  payloadSha256: string;            // JCS({schemaVersion, attempt, result}) UTF-8 SHA-256
  result: AudioResult | TextResult;
}

export interface SourceResponse {
  sessionId: string;
  text: string;                     // 1차 PII 치환이 끝난 공식 텍스트
}
export interface SignedGetResponse {
  delivery: 'signed-get';
  url: string;                       // 응답 밖에 기록하지 않는 bearer URL
  expiresAt: string;                 // 발급 시각 + 10분
}
export interface AudioVerifyRequest {
  claimToken: string;
  attempt: number;
  generationId: string;
  agentComputedSha256: string;
}

export interface AudioVerifyResponse {
  jobId: string;
  generationId: string;
  rawAudioSha256: string;
  verifiedAt: string;
}
```

`POST /pipeline/jobs/claim`은 `Authorization: Bearer <service token>`만 받는다. `limit`은 2 이상 50 이하의 정수이며 실제 남은 작업 수가 더 적으면 그 수만 반환한다. 서버는 토큰의 users 디렉터리 행에서 `service`, `orgId`, `userId`를 정하고 요청 본문의 기관·주체 값을 받지 않는다. source와 audio 요청은 `X-CCC-Job-Claim` 헤더의 claim token, `X-CCC-Job-Attempt` 헤더의 10진 attempt를 받으며 URL query와 로그에 token을 싣지 않는다. 모든 업무 응답은 `Cache-Control: no-store`다.

v2 endpoint는 다음과 같다.

| method | path | 인증·조건 | 응답 |
|---|---|---|---|
| `POST` | `/pipeline/jobs/claim` | service Bearer + server-loaded valid `NerAttestation` and `NerReleaseQualificationReceipt` | `ClaimResponse` |
| `POST` | `/pipeline/jobs/:jobId/heartbeat` | 같은 service, live claim | `HeartbeatResponse` |
| `POST` | `/pipeline/jobs/:jobId/release` | 같은 service, live claim | 본문 없는 `204` |
| `POST` | `/pipeline/jobs/:jobId/mask-dictionary` | 같은 service, live claim | `MaskDictionaryResponse` |
| `GET` | `/pipeline/jobs/:jobId/audio` | 같은 service, `claimToken`·`attempt` 헤더, live claim | Cloud는 `SignedGetResponse`, Local은 no-store byte stream |
| `POST` | `/pipeline/jobs/:jobId/audio/verify` | 같은 service, live audio claim, generation binding | `AudioVerifyResponse` |
| `POST` | `/pipeline/jobs/:jobId/egress/authorize` | 같은 service, live claim, Azure route | `EgressAuthorization` |
| `POST` | `/pipeline/jobs/:jobId/egress/in-flight` | `EgressAuthorization`와 같은 tuple | `EgressInFlightResponse` |
| `GET` | `/pipeline/jobs/:jobId/source` | text claim, 같은 service, live claim | `SourceResponse` |
| `POST` | `/pipeline/jobs/:jobId/result` | 같은 service, live claim | 결과 수락은 본문 없는 `204` |

`POST /pipeline/jobs/:jobId/mask-dictionary`는 org/job/claim token/attempt에 묶인 일회성 claim-bound 응답이다. 요청 body는 정확히 `{claimToken, attempt}`이고 TLS 인증 채널에서만 받는다. `MaskDictionaryResponse`의 수명은 발급 시각부터 최대 5분이며 `Cache-Control: no-store`를 설정한다. API는 dictionary ID와 job ID, 발급·만료 시각, 치환 field·sourceValue·가명 replacement만 반환하고 원래 PII·본문을 로그에 남기지 않는다. Agent는 sourceValue를 raw audio 또는 source text에서 매칭하는 동안 메모리에서만 사용하고 처리 뒤 즉시 zeroize한다. 첫 성공 POST는 `mask_dictionary_read` 감사와 consumed 시각을 기록하고 메모리 밖에 dictionary를 저장하지 않는다. 응답이 유실된 뒤 같은 service·job·claim·attempt가 만료 전 재전송하면 같은 logical dictionary ID와 동일 응답을 다시 반환한다. 다른 claim/attempt, 만료 뒤 재전송은 `stale_claim`, `lease_expired` 또는 `dictionary_already_consumed`로 거부한다.
`POST /pipeline/jobs/:jobId/audio/verify`는 동일 service·job·claim·attempt와 `generationId`에 묶인 `AudioVerifyRequest`를 받는다. 요청의 generation이 현재 claim generation과 다르면 AudioStore stream을 열기 전에 `stale_claim`으로 거부한다. Agent는 유효 generation의 claim-bound audio delivery stream을 끝까지 읽어 `agentComputedSha256`를 계산하고 verify를 제출한다. 코어는 동일 generation의 object와 hash를 CAS로 확인한 뒤 `agentComputedSha256`과 trusted `rawAudioSha256`를 원자적으로 저장하고 `AudioVerifyResponse`를 돌려준다. hash가 다르면 trusted hash를 만들지 않고 SG8 `hash_mismatch` deletion 조정과 수기 fallback을 시작하며 Azure/OpenAI 호출은 0건이다. verify 전 `clientAssertedSha256`는 신뢰하지 않는다.

`POST /pipeline/jobs/:jobId/egress/authorize`는 Azure STT를 시작하기 전에 `EgressAuthorizationRequest`를 받는다. 요청 body에는 raw claim token, attempt, Agent가 verify로 저장한 trusted `rawAudioSha256`, `provider: 'azure'`만 싣고, caller는 `orgId`, `jobId`, `claimTokenHash`, `consentRevision`, receipt fields를 보내지 않는다. 코어는 인증 주체와 job에서 org/job을, raw token에서 lower-case hex64 `claimTokenHash`를, 현재 동의에서 `consentRevision`을 도출하고 저장된 immutable `NerReleaseQualificationReceipt`의 모든 fixed/hash fields와 expiry/status를 조회한다. S6 Azure tuple을 현재 trusted raw hash·동의·route·receipt와 CAS 대조하고 통과할 때만 `AzureEgressAuthorization(status='authorized')`를 만든다. `POST /pipeline/jobs/:jobId/egress/in-flight`는 raw claim token을 인증 채널에서 받아 저장 tuple의 hash와 비교하고, Agent가 durable at-most-once marker를 먼저 기록한 뒤 그 ID를 정확히 한 번 CAS해 `EgressInFlightResponse(state='in_flight')`를 만든 뒤 Azure 호출을 시작한다. 같은 immutable authorization을 재시도하면 저장된 `startedAt`과 동일한 in-flight 응답을 돌려주고 Azure를 다시 시작하지 않는다. authorization record는 `authorized → in_flight → completed` 또는 `revoked|expired`이며 attempt ID와 record는 immutable이다. result/release/동의 철회/lease expiry가 해당 record를 각각 completed/revoked/expired로 원자 전이한다. tuple이 다르거나 동의·receipt가 바뀌면 Azure 호출 0건이다. authorize/in-flight 응답과 감사에는 URL, 원음, PII, Azure key를 싣지 않는다.

release는 Agent가 provider 호출을 마친 뒤 호출하는 종료 신호이며, provider 호출 전 NER health가 내려가면 결과 없이 호출하는 차단 신호이기도 하다. Audio job은 configured `STTProvider` (`local|azure`)를 attempt당 최대 1회 호출하고, text job은 Agent provider를 0회 호출한다. 각 live claim은 terminal operation을 정확히 하나만 수행한다: 성공은 `result`, 실패·차단은 `release`; result 성공 뒤 release를 보내지 않는다. NER blocked 경로는 provider 호출 0회이고 attempt를 소비하지 않는다. `outcome: 'transient'`는 `reason: 'engine_unavailable'`일 때만 허용하며, live lease인 경우 `attempt < 3`이면 `pending`으로 재큐잉하고 `attempt = 3`이면 `failed`와 `retry_exhausted`로 닫는다. transport timeout, `429`, `5xx`는 모두 `engine_unavailable`로 정규화한다. `outcome: 'blocked'`는 `reason: 'local_ner_unavailable'`일 때만 허용한다. 현재 S6 attestation과 서버가 조회한 immutable `NerReleaseQualificationReceipt`가 `status: 'passed'`, `expiresAt > now`로 유효해진 뒤에만 다시 claim할 수 있다. `outcome: 'permanent'` 또는 그 밖의 reason은 즉시 `failed`다. release도 token·attempt CAS를 사용하며, 만료된 임대에는 `lease_expired`, 다른 주체에 재임대된 임대에는 `stale_claim`을 반환한다.

result는 `ResultRequest`를 받는다. `result.kind`는 claim의 `kind`와 같아야 한다. `AudioResult`와 `TextResult`는 S6의 `maskingPipelineVersion`, lower-case hex64 `maskingPipelineHash`, `nerAvailable: true`, `nerAttestationId`, lower-case hex64 `nerAttestationResultHash`, lower-case hex64 `sha256`, `evidence`, lower-case hex64 `evidenceHash`, `releaseQualificationReceiptId`를 모두 운반한다. 각 evidence의 `sourceSha256`은 본문 `sha256`과 같아야 하며 `evidenceHash`는 evidence 배열의 JCS UTF-8 SHA-256과 같아야 한다. `transcriptReliable`과 `transcriptWarnings`는 AudioResult에서 생략할 수 없다. `nerAvailable=false`이면 성공 결과를 만들 수 없고 `local_ner_unavailable` blocked release만 허용한다. claim, mask dictionary, audio verify, Azure authorize/in-flight, result가 모두 S6 NER attestation과 서버가 조회한 immutable `NerReleaseQualificationReceipt`의 모든 fixed/hash fields, `status='passed'`, `expiresAt > now` 조건을 확인한다. 만료·누락·불일치이면 provider 호출 없이 blocked/reprocess 경로로 남긴다. S6가 소유한 literal·해시 계산·허용 버전과 attestation 의미는 이 문서에서 복제하지 않는다. 서버는 JCS로 `{schemaVersion, attempt, result}`를 직렬화해 계산한 payload hash가 `payloadSha256`과 같은지 검증한다.
source는 text claim에만 허용되는 claim-bound `GET /pipeline/jobs/:jobId/source`다. 1차 PII 치환을 마친 공식 텍스트를 `SourceResponse`로 돌려주며, `Cache-Control: no-store`와 동일 claim 검사를 적용한다. v1의 `GET /pipeline/text-jobs`, `GET /pipeline/text-jobs/:id/source`, `POST /pipeline/text-jobs/:id/complete`, `POST /sessions/:id/ai/source` service 경로는 v2 service allowlist에서 제거한다. TextResult 자체가 2차 마스킹 스냅샷을 제출하므로 별도 snapshot·complete 호출은 없다.

### 2.2 상태 전이와 원자성

| 현재 상태 | 행위 | 조건 | 다음 상태 | 실패 결과 |
|---|---|---|---|---|
| `pending` | claim | 현재 동의·route·engine·NER attestation·미만료 `NerReleaseQualificationReceipt`·원음 조건이 유효함 | `leased`, `attempt += 1` | 조건 불충족이면 상태를 바꾸지 않고 목록에 내보내지 않음 |
| `pending|leased|blocked` | consent withdrawal CAS | requiredConsent 중 하나라도 현재값 없음 | `cancelled` | `consent_not_effective`, claim credentials invalidated |
| `leased` audio | verify | live claim·generation에 묶인 stream을 읽고 Agent hash를 저장 | `leased` with `rawAudioSha256` | hash mismatch면 `failed`, `terminalFailureCode='audio_hash_mismatch'`, SG8 `hash_mismatch`/`upload_abandoned` 삭제 조정, Azure/OpenAI 호출 0건 |
| `leased` | result | token·attempt 일치, 임대 유효, 동의·S6 attestation·미만료 `NerReleaseQualificationReceipt` 재검증·payload 검증 통과 | `succeeded` | `stale_claim`, `consent_not_effective`, fail-closed code, `result_schema_invalid`, `result_conflict` |
| `blocked` | health 회복 claim | 현재 S6 attestation과 미만료 `NerReleaseQualificationReceipt`가 `status='passed'`, `expiresAt > now` | `leased`, `attempt` 불변 | 여전히 부적합하면 `local_ner_unavailable` |
| `leased` | heartbeat | token·attempt 일치, `now < leaseExpiresAt` | `leased` | 만료면 `lease_expired` |
| `leased` | release transient | token·attempt 일치, live lease, `reason=engine_unavailable` | `pending` 또는 `failed` | attempt 3이면 `retry_exhausted` |
| `leased` | release blocked | token·attempt 일치, provider 호출 전 NER health 실패 | `blocked`, `attempt` 불변 | `local_ner_unavailable` |
| `leased` | release permanent | token·attempt 일치, live lease | `failed`, `terminalFailureCode=reason` | 영구 실패 literal |
| `leased` | lease 만료 recovery | `now >= leaseExpiresAt`, `attempt < 3` | `pending` | 다음 claim에서 `attempt += 1` |
| `leased` | lease 만료 recovery | `now >= leaseExpiresAt`, `attempt = 3` | `failed`, `terminalFailureCode='retry_exhausted'` | `retry_exhausted` |
| audio terminal | 원음 삭제 완료 | SG8 삭제 증거 네 boolean 모두 true | terminal 유지 | 삭제 실패는 재시도 가능한 조정 작업으로 남김 |
| `leased` audio | SG8 deadline or retention hard cap preemption | `processingDeadlineAt` or `retentionHardCapAt` reached, claim invalidated | `expired` | `audio_deleted`, `retention_hard_cap` emits incident/manual fallback |
| `blocked` audio | SG8 processing deadline or retention hard cap preemption | `processingDeadlineAt` or `retentionHardCapAt` reached | `expired` | `audio_deleted`, hard cap reason `retention_hard_cap` with incident/manual fallback |
| terminal | 중복 result | 저장된 payload hash와 같음, `resultId`는 같거나 달라도 됨 | 유지 | `204`, 새 저장·호출 0건 |
| terminal | 다른 result | 저장된 payload hash와 다름 | 유지 | `409 result_conflict` |
active `leased`와 `blocked` audio 행은 아직 SG8 processing deadline 또는 retention hard cap에 도달하지 않은 동안 claim 후보에서 건너뛴다. lease 만료 행은 recovery CAS가 끝나 `pending`으로 되돌리기 전에는 claim하지 않는다. `blocked` 행은 현재 S6 NER attestation과 `NerReleaseQualificationReceipt`가 모두 `status: 'passed'`이고 `expiresAt > now`가 될 때까지 claim하지 않으며, 회복 시 `attempt`를 올리지 않고 다시 임대한다. claim, heartbeat, release, lease recovery, consent 철회, result와 SG8 preemption은 `jobId`, `orgId`, `claimToken`, `attempt`를 조건으로 한 원자적 compare-and-set이다. 조회 후 별도 UPDATE를 허용하지 않는다. release·lease recovery·consent 취소·SG8 선점이 성공하면 이전 `leaseOwner`, claim token, lease expiry를 같은 원자 경계에서 clear하여 이전 요청은 정확히 `stale_claim`이 된다. 자연 만료로 아직 recovery되지 않은 현재 token·attempt만 `lease_expired`이며, SG8 processing deadline 또는 retention hard cap에 도달한 active claim과 blocked audio claim은 선점해 삭제, 관리자 장애 상태, 수기 fallback으로 넘긴다. claim, mask dictionary, audio verify, Azure authorize/in-flight, result는 receipt의 `expiresAt > now`를 확인한다.


result 수락 트랜잭션은 현재 동의, S6 NER attestation, immutable `NerReleaseQualificationReceipt`의 모든 fixed/hash fields와 expiry, payload hash를 확인하고 마스킹 스냅샷 저장, job terminal 전환, 해당 Azure/OpenAI egress record의 `in_flight → completed` 전환을 하나의 원자 경계로 처리한다. 동의 철회 트랜잭션도 `pending|leased|blocked → cancelled` CAS와 audio deletion enqueue를 같은 원자 경계로 처리하며, result CAS와 같은 job row에서 경쟁한다. 동의 철회 commit이 먼저면 result 저장과 provider 호출은 0건이고 authorized egress는 `revoked`가 된다. result commit이 먼저면 당시 유효한 동의 아래 수락된 결과와 egress 완료로 남고 이후 철회는 별도 동의 생애주기로 기록한다.

결과가 `succeeded`가 되어도 AI 초안은 `approved_at` 전까지 공식 기록이 아니다. 승인 전에는 브리핑·통계에 쓰지 않는다. succeeded 행에 같은 payload hash를 재전송하면 `resultId`가 달라도 멱등 `204`만 반환하고 세션, 스냅샷, 후속 AI 호출을 변경하지 않는다. 다른 hash는 `result_conflict`다. stale·duplicate result가 새 official result를 만들 수 없다.
오디오 job이 `cancelled` 또는 `failed`가 되거나 성공 결과가 수락되면 코어가 다음 payload로 `AudioStore.delete`를 멱등 enqueue한다. SG8의 processing deadline 또는 `retentionHardCapAt`에 따른 `expired` 전이와 그 삭제 시도도 코어와 SG8의 경계에서 같은 stable key로 조정한다.

```ts
export interface AudioDeletionEnqueue {
  audioObjectId: string;
  generationId: string;
  deletionAttemptId: string;
  reason:
    | 'processed'
    | 'cancelled'
    | 'consent_withdrawal'
    | 'processing_failed'
    | 'hash_mismatch'
    | 'retry_exhausted'
    | 'unprocessed_expiry'
    | 'retention_hard_cap';
}
```

`succeeded` 결과 직후는 `reason='processed'`, 동의 철회로 `cancelled`가 되면 `reason='consent_withdrawal'`, audio verify mismatch는 SG8 `hash_mismatch`와 `reason='hash_mismatch'`로 `upload_abandoned` 조정을 시작하고 Azure/OpenAI 호출은 0건이다. permanent release로 `failed`가 되면 `reason='processing_failed'`, 세 번째 transient 뒤 `failed`가 되면 `reason='retry_exhausted'`, SG8 processing deadline 도달은 `reason='unprocessed_expiry'`, `retentionHardCapAt` 도달은 `reason='retention_hard_cap'`을 사용한다. `cancelled` state 자체를 별도 감사 reason으로 소비해야 하는 호출부는 `reason='cancelled'`를 사용하되, 동의 철회에는 `consent_withdrawal`을 우선한다. pending consent withdrawal의 source attempt는 `null`, leased 동의 철회와 processing_failed는 현재 attempt, retry_exhausted는 정확히 `attempt=3`, processed는 결과를 수락한 현재 attempt, retention_hard_cap은 현재 lease attempt 또는 pending이면 `null`이다. `retention_hard_cap`은 관리자 장애 상태와 수기 fallback enqueue를 함께 만든다. Agent는 삭제를 실행하지 않는다. 삭제 증거는 SG8의 네 fresh boolean으로 완료를 판정한다. 삭제와 result가 동시에 도착하면 job CAS의 직렬화 순서가 승자이며, 삭제 commit이 먼저면 result는 terminal 오류로 거부한다.
claim 시 `requiredConsent`와 현재 동의 revision을 확인하고, result 시점을 기준으로 다시 확인한다. claim 뒤 result 전에 requiredConsent가 철회되면 job을 `cancelled`로 CAS하고 result를 저장하지 않는다. audio job은 `reason='consent_withdrawal'`로 코어가 SG8 삭제를 enqueue한다. 텍스트 job은 source와 result를 저장하지 않는다. 모든 관련 provider 호출은 0건이어야 한다.

### 2.4 큐 공정성

claim은 오디오·텍스트 큐를 합친 단일 원자 연산이다. 두 큐에 eligible 작업이 있으면 각 큐의 `enqueuedAt`, `jobId` 순서에서 가장 오래된 작업을 골라 엄격히 audio, text 교대로 배치한다. 첫 큐는 두 head 중 더 오래된 큐이며, 한 큐가 비면 남은 큐를 순서대로 채운다. `limit`은 2 이상 50 이하이므로 두 큐가 eligible인 응답은 양쪽에서 시작 작업을 보장한다. 한 큐에만 eligible 작업이 있으면 그 큐만 반환한다. 동의·원음·파일럿 조건이 없는 행은 eligible이 아니므로 다른 큐의 대기 시간을 막지 않는다.

### 2.5 자격증명과 접근 경계

| 호출자 | 허용 | 금지 |
|---|---|---|
| 처리 Agent `service` | v2의 claim, heartbeat, release, claim-bound source, claim-bound mask dictionary, audio verify, claim-bound audio, Azure authorize/in-flight, configured Azure `STTProvider` after `in_flight`, result | v1 `/pipeline/text-jobs/**`, `/sessions/:id/ai/source`, 업무 목록·당사자·케이스·승인·관리자 API, 임의 provider·OpenAI SDK, Database·AudioStore 직접 접근 |
| 사람 `admin`·`counselor` | 녹음 업로드, 업무 API | 모든 `/pipeline/jobs/**` endpoint 호출 |
| 브라우저·공개 client | 사람 업무 API | job endpoint와 signed GET 발급 또는 전달 |

모든 API 접근은 Bearer 인증 후 users 디렉터리의 `service` 역할과 기관 일치를 검사한다. service actor가 업무 endpoint를 호출하면 `forbidden`이다. 사람 actor가 job endpoint를 호출해도 `forbidden`이다. Agent는 Database 포트와 AudioStore 포트를 import하지 않으며, 처리 원문은 API가 제공한 source 응답 또는 전달 주소로만 받는다.

오디오 전달은 모드별로 다음과 같다.

| 모드 | `audio.delivery` | 규칙 |
|---|---|---|
| Community Cloud | `protected-get` | claim은 `/pipeline/jobs/:jobId/audio` endpoint만 준다. Agent가 동일 service Bearer와 claim token·attempt로 GET하면 API가 live lease를 확인한 뒤 10분 Supabase private Storage signed GET을 발급·재발급한다. signed URL은 bearer URL이며 single-use나 claim-bound가 아니지만 TTL 동안만 유효하다. URL과 provider key는 로그·응답 외 기록·화면에 남기지 않는다. 발급마다 `download_audio` 감사가 남는다. |
| Local Single | `api-stream` | 동일 endpoint가 `AudioStore`에서 읽어 backpressure byte stream으로 전달한다. 동일 claim의 service actor만 호출할 수 있고 응답은 `Cache-Control: no-store`다. Agent는 암호화 파일과 키를 열지 않는다. |
| Local Office | `api-stream` | Local Single과 같으며 TLS 내부망 API를 사용한다. 서버 파일 경로·DB 연결 문자열은 Agent에 노출하지 않는다. |

Cloud protected GET의 signed URL 자체는 provider가 검증하는 bearer 자격이며 URL에 claim token을 넣지 않는다. API는 URL을 로그하지 않는다. 사람과 브라우저에는 protected GET 또는 signed URL을 발급하지 않는다. Cloud URL이 만료되면 live claim으로 protected GET을 다시 호출해 10분 URL을 재발급할 수 있지만 lease가 만료되었거나 terminal이면 `lease_expired`, `audio_deleted` 또는 `stale_claim`을 반환한다.

Text job의 `audio`는 `null`이고 claim-bound source endpoint에서 1차 치환을 마친 공식 텍스트를 받는다. Agent는 2차 마스킹 스냅샷을 TextResult로 제출하며, 사업자 호출은 코어가 유효한 스냅샷으로만 수행한다.

### 2.6 오류 스키마

모든 거부 응답은 다음 고정 형태이며 원문·PII·시크릿을 넣지 않는다.

```ts
export interface JobError {
  error:
    | 'authentication_required'
    | 'forbidden'
    | 'job_not_found'
    | 'lease_expired'
    | 'stale_claim'
    | 'consent_not_effective'
    | 'audio_object_missing'
    | 'audio_hash_mismatch'
    | 'audio_deleted'
    | 'route_mismatch'
    | 'engine_unavailable'
    | 'masking_snapshot_missing'
    | 'local_ner_unavailable'
    | 'registered_pii_detected'
    | 'unmasked_identifier_detected'
    | 'evidence_hash_mismatch'
    | 'masking_pipeline_version_mismatch'
    | 'dictionary_already_consumed'
    | 'result_schema_invalid'
    | 'result_conflict'
    | 'retry_exhausted';
  jobId: string | null;
  retryable: boolean;
}
```

토큰 또는 attempt가 현재 claim과 맞지 않으면 `409 stale_claim`, 맞는 token·attempt라도 live lease가 만료됐으면 `409 lease_expired`다. terminal `cancelled`는 `409 consent_not_effective`, terminal `expired` audio는 `409 audio_deleted`, terminal `failed`는 저장된 `terminalFailureCode`를 그대로 반환하며 세 번째 transient 또는 lease expiry 뒤에만 `retry_exhausted`다. `route_mismatch`, `audio_object_missing`, `audio_hash_mismatch`와 일곱 S6 masking code는 즉시 permanent failure의 `terminalFailureCode`로 저장하고 같은 오류를 반환한다. `local_ner_unavailable`은 Agent가 NER 부재를 결과 없이 fail-closed 보고하는 blocked release 및 오류 literal이다. `retryable: true`는 `engine_unavailable`에만 허용하며 같은 route·engine으로 재시도할 때만 사용한다. 나머지 모든 literal은 `retryable: false`다.

HTTP 매핑은 `401 authentication_required`, `403 forbidden`, `404 job_not_found|audio_object_missing`, `409 lease_expired|stale_claim|consent_not_effective|audio_deleted|route_mismatch|dictionary_already_consumed|result_conflict|retry_exhausted`, `422 audio_hash_mismatch|masking_snapshot_missing|local_ner_unavailable|registered_pii_detected|unmasked_identifier_detected|evidence_hash_mismatch|masking_pipeline_version_mismatch|result_schema_invalid|engine_unavailable`이다.

### 2.7 v1 payload fallback 제거

v2는 `schemaVersion: 2`와 구조화 `transcriptReliable`·`transcriptWarnings`를 계약으로 사용한다. 현재 `400` 발생 시 경고 문장을 전사 본문에 삽입해 다시 보내는 generic legacy-payload fallback, `inject_legacy_warnings`, 레거시 payload 재전송을 제거한다. v2 서버가 구조화 필드를 모르면 첫 요청의 `result_schema_invalid`에서 끝나며 다른 본문을 만들지 않는다. `400`을 provider fallback이나 payload 변환의 신호로 해석하지 않는다. `transcriptWarnings.reason`에도 자유 문장·전사·PII를 넣지 않는다.

## 3. 세 모드에서 어떻게 다른가

공통 API, 상태 전이, 3회 retry, 동의 재검증, service 권한, queue fairness는 세 모드에서 다르지 않다. 차이는 `route`, API 실행 위치, 오디오 전달 방식, secret 보관 위치뿐이다.

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| route | `community-cloud-agent` | `local-single-agent` | `local-office-agent` |
| 코어 API | 기관 소유 Supabase Edge/API | 같은 PC의 local-service | 사무실 서버 local-service |
| 오디오 | protected GET → 10분 signed GET | claim-bound API backpressure stream | claim-bound TLS API backpressure stream |
| Agent secret | Agent SecretStore, OpenAI/Azure 키는 호출 위치에만 | 해당 PC DPAPI `CurrentUser` | 서버/Agent PC의 DPAPI 경계 |
| STT | `sttEngine: local\|azure`를 관리자 설정으로 고정 | 동일 | 동일 |
| 기본값 | `sttMode: off`, `sttEngine: null` | 동일 | 동일 |

어떤 모드에서도 STT engine은 명시적 설정과 health check를 통과한 값만 claim에 실린다. `off`이면 audio job을 claim하지 않으며 `faster-whisper`를 자동 선택하지 않는다. LLM은 코어의 `AIProvider`가 `codex` 한 사업자만 사용하며 `store:false`와 활성 설정 hash를 검증한다. provider 오류는 같은 route와 engine의 `engine_unavailable`로만 재큐잉되며 다른 사업자로 전환하지 않는다.

## 4. 완료 조건

- [ ] `MaskedSource`·`ResultRequest`가 S6의 masking pipeline version/hash, `nerAvailable: true`, NER attestation id/result hash, lower-case hex64 `evidenceHash`, `releaseQualificationReceiptId`, evidence의 source hash를 필수로 운반하고 S6가 literal·계산법의 소유자임을 명시한다.
- [ ] `pending → leased → succeeded|blocked|cancelled|expired|failed` 전이, audio verify 뒤 trusted `rawAudioSha256`, lease recovery, 2시간 총 임대 상한, SG8의 `processingDeadlineAt`과 `retentionHardCapAt = uploadedAt + 7*24h UTC`, blocked·leased claim preemption, CAS 조건이 완결되어 있다.
- [ ] claim 뒤 동의 철회는 `pending|leased|blocked → cancelled`, result 0건, audio deletion enqueue를 원자적으로 수행하고, `processed`, `cancelled`, `consent_withdrawal`, `processing_failed`, `hash_mismatch`, `retry_exhausted`, `unprocessed_expiry`, `retention_hard_cap` reason과 pending/lease attempt semantics를 완결한다.
- [ ] Cloud protected GET의 live claim 검증·10분 signed URL 재발급·감사, claim-bound one-time mask dictionary와 typed Azure egress authorize/in-flight tuple 검증, Local API stream의 차이가 완결되어 있다.
- [ ] v1 text-jobs/session source/complete가 service allowlist에서 제거되고 v2 claim-bound source/result로 대체되어 있다.
- [ ] strict audio/text alternation, queue order, `limit 2..50` 규칙으로 어느 큐도 다른 큐를 굶기지 않는다고 검증할 수 있다.
- [ ] attempt별 provider 1회, 최대 3회, audio configured `STTProvider` (`local|azure`) at-most-once, text Agent provider 0회, exactly-one terminal `result|release`, `engine_unavailable`만 retryable, `local_ner_unavailable` blocked fail-closed, 같은 route·engine 유지, provider fallback 없음이 명시되어 있다.
- [ ] JCS payload hash 멱등성, resultId와 무관한 동일 hash 재전송, 다른 hash conflict, stale·duplicate result 비공식화가 명시되어 있다.
- [ ] 아래 fixture 8종의 입력과 기대 결과, 검증 명령과 실패 판정이 완결되어 있다.

## 5. 검증 방법

구현 검증 시 저장소 루트에서 다음을 실행한다.

```bash
pnpm --filter @ccc/api exec vitest run test/agent-job-contract.test.ts
pnpm --filter @ccc/api exec vitest run test/agent-job-contract.modes.test.ts
```

fixture는 모두 synthetic ID·텍스트·오디오를 사용하고, 각 fixture의 기대 판정은 다음과 같다.

| fixture | 입력 | 기대 판정 |
|---|---|---|
| F1 동시 claim | 같은 기관 audio 2건, text 2건, 두 service actor가 동시에 claim | 각 job은 한 actor만 `leased`, `attempt=1`; 중복 claim 0건 |
| F2 strict fairness | audio 50건(`audio-001`부터), text 1건(`text-001`), audio head가 더 오래됨, `limit=10` | 응답 순서는 `audio-001`, `text-001`, `audio-002`부터 `audio-009`; text가 첫 batch에서 반드시 처리되고 queue order 유지 |
| F3 heartbeat/release/expiry | lease 후 유효 heartbeat, transient release, 만료 뒤 heartbeat·release·구 actor result, SG8 processing deadline·7일 hard cap 도달 | heartbeat는 `min(claimedAt+2h, processingDeadlineAt, retentionHardCapAt)`까지 연장; hard cap 선점은 `expired`와 `retention_hard_cap` deletion enqueue·admin incident/manual fallback; 자연 만료의 현재 token·attempt는 정확히 `409 lease_expired`, clear·재할당 뒤 옛 token은 정확히 `409 stale_claim`, official result 0건 |
| F4 consent withdrawal | claim 또는 blocked 뒤 requiredConsent 철회 후 result, audio job | 철회 CAS가 `pending|leased|blocked`를 `cancelled`로 만들고 claim credential을 clear, result·provider call 0건, `consent_withdrawal` deletion enqueue와 SG8 증거 완료; result가 먼저 commit된 경우만 당시 결과 유지 |
| F5 duplicate/conflict | 같은 payload hash를 다른 `resultId`로 재전송하고 다른 hash도 전송 | 같은 hash는 `204`와 수락 결과 1건, 다른 hash는 `409 result_conflict`, 공식 결과 1건 |
| F6 bounded retry | audio attempt에서 configured `STTProvider` (`local|azure`), Azure route는 egress authorization/in-flight 후, text attempt에서 Agent provider 없음, timeout/429/5xx를 `engine_unavailable`로 주입 | audio STTProvider at-most-once/attempt, text Agent provider 0회, terminal `result` 또는 `release` 정확히 1회; 같은 route·engine으로 최대 3회, 세 번째 뒤 `failed`·`retry_exhausted`, core AIProvider counter는 별도이고 다른 provider 호출 0건 |
| F7 NER fail-closed | claim 전 또는 provider 호출 전 `nerAttestation` 또는 `NerReleaseQualificationReceipt`가 누락·실패·만료되거나 Agent health가 내려가 `nerAvailable`이 false | claim이면 상태·attempt 불변, lease 중이면 `blocked` release·attempt 불변, `local_ner_unavailable`, Azure/OpenAI 0건; attestation·receipt 회복 뒤에만 재claim |
| F8 delivery/access/v1 | 세 모드 claim, Cloud protected GET 재발급·만료, Local stream, mask dictionary lost-response same tuple/different claim, Azure egress tuple mismatch, 사람/service 교차 호출, 구조화 v2 result에 generic `400`, v1 payload 호출 | Cloud GET은 live claim 검증 후 10분 URL과 `download_audio` 감사, URL 로그 0건; dictionary 같은 tuple은 동일 응답 재생, 다른 claim은 거부; generic `400`은 첫 요청만 기록하고 legacy payload·warning injection·provider fallback 0건; Local은 API stream만; 사람 job 호출·service 업무 호출·v1 text-jobs/session source/complete 모두 403 |

판정 실패는 actor별 중복 claim, strict alternation 위반, active 또는 blocked lease의 부당 재노출, audio verify 전 Azure authorize, hash mismatch 뒤 trusted hash 저장·provider 호출, claimedAt+2시간·SG8 deadline·7일 hard cap 이후 heartbeat/result, 철회 뒤 result/provider 호출, `approved_at` 전 결과가 브리핑에 나타남, attempt당 Azure 2회, text provider 호출, terminal result와 release 중복, 4회 이상 retry, blocked NER를 attempt exhaustion으로 처리, 다른 provider 호출, 직접 DB·스토리지 접근, URL 로그, mask dictionary 재사용·PII sourceValue 로그, S6 metadata/evidence hash 누락, 또는 v1 payload 재전송이 한 건이라도 있는 경우다. 이 문서의 `확정` 판정에는 명령 실행 결과가 필요하지 않으며, 실행 결과와 runtime 증거는 E5-1a 구현 검증에서 기록한다.

## 6. 이번에 안 하는 것

- Agent가 Database·AudioStore를 직접 열거나 provider SDK를 직접 호출하는 구현: D78·D81 경계 위반이라 금지한다.
- 새로운 provider, 자동 provider 전환, STT 후보 확정: D77, STT-G1~STT-G3, E5-2·E5-3의 범위다.
- 동의 여섯 영역의 literal·사건 스키마: SG7이 소유하며 이 문서는 `S7ConsentDomain`의 현재 효력만 소비한다.
- 준식별자 일반화, masking pipeline literal·해시 계산·NER 판정의 상세 검증: SG6가 소유한다. 이 문서는 S6 metadata를 결과에 운반하고 `local_ner_unavailable` fail-closed release를 정의한다.
- 원음 보관 시계와 삭제 증거 필드: SG8이 소유한다. 이 문서는 terminal 전환 뒤 SG8 삭제 조정을 enqueue하는 경계만 정의한다.
- 실제 adapter, Windows DPAPI 구현, Supabase signed URL 발급, pairing token 발급과 운영 배포: E5-1a 이후 E5-1b, E6-3, E6-4가 구현·검증한다.
