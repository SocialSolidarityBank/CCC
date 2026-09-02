# S15: 장문 AI Packet

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D81, D8, ADR-0036, `CCC_OPEN_PILOT_PLAN.md` SG15 및 E5-9
- 입력: S6 `MaskedSourceSnapshot`과 fail-closed 재검증 계약, S5 `AIProvider` 작업 계약, 공식 transcript/manual-note/goal 재료와 구간 선택
- 산출: 재료별 24,000자 청크 계획, 호출·재시도·부분 실패·병합 계약, 근거 보존과 누락 표시 계약
- 관련 티켓: E5-4, E5-5, E5-9, E2-7, SG6

`확정`은 이 문서의 인터페이스, 규칙표, fixture, 검증 명령이 닫혔다는 뜻이며 구현·배포·실행 결과를 뜻하지 않는다.

## 1. 목적

재료 하나가 24,000자를 넘을 때도 전체 내용을 조용히 자르지 않고 시간과 문자 구간으로 나누어 AI Packet을 만든다. transcript, manual-note, goal을 같은 개인정보 게이트로 처리하고 성공·실패한 청크의 범위를 끝까지 추적한다. 최종 사실 문장과 제안은 반드시 원래 재료의 문자 범위와, transcript인 경우 시간 범위까지 역추적할 수 있어야 한다.

## 2. 인터페이스와 규칙

### 2.1 정규화된 재료와 구간

S6의 `MaskedSourceSnapshot`은 재료의 유일한 본문이다. 원문, 마스킹 전 transcript, 금고 값, privacy 제외 텍스트는 provider 요청에 들어가지 않는다. S6 snapshot의 text는 masking 이후 그대로 보존하며 NFC normalize, whitespace 정리는 dedupe identity를 만들 때만 적용한다.

```ts
type LongAiOriginKind = 'transcript' | 'manual_note' | 'goal';
type LongAiPurpose = 'goal' | 'risk' | 'promise';
type IntervalReason = 'requested' | 'excluded_by_user' | 'privacy' | 'unsupported';
type CodepointRange = { charStart: number; charEnd: number };
type TimeRange = { startMs: number; endMs: number };

interface LongAiSourceBase {
  sourceRef: string;                 // S6의 불투명 snapshot 참조
  snapshot: MaskedSourceSnapshot;   // S6 정의를 참조, 재정의하지 않음
  maskedText: string;                // snapshot 본문과 동일해야 함
  purposes: readonly LongAiPurpose[];
  includedIntervals: readonly LongAiInterval[];
  excludedIntervals: readonly LongAiInterval[];
}
interface LongAiTranscriptSource extends LongAiSourceBase {
  originKind: 'transcript';
  kind: 'transcript';
  transcriptSegments: readonly {
    segmentId: string;
    startMs: number;
    endMs: number;
    charStart: number;
    charEnd: number;
  }[];
}
interface LongAiManualNoteSource extends LongAiSourceBase {
  originKind: 'manual_note';
  kind: 'text_context';
}
interface LongAiGoalSource extends LongAiSourceBase {
  originKind: 'goal';
  kind: 'text_context';
}
type LongAiSource = LongAiTranscriptSource | LongAiManualNoteSource | LongAiGoalSource;

interface LongAiInterval extends CodepointRange {
  startMs: number | null;
  endMs: number | null;
  reason: IntervalReason;
}
```

- 모든 문자 수와 offset은 UTF-16 단위나 byte가 아니라 `Array.from(text).length`와 code point slice 기준이다. 마스킹 뒤 text를 다시 normalize하거나 trim하지 않는다. `charStart < charEnd`, 음수·범위 밖·같은 source에서 같은 종류의 겹친 interval은 거부한다.
- transcript의 시간 interval은 segment 경계에만 맞는다. 시간 경계가 segment 중간이면 해당 구간을 `unsupported`로 기록하고 Core outcome은 `failed`로 만들어 provider에 보내지 않는다. 제외 interval과 겹치는 segment는 전부 제외해 제외된 segment 일부가 provider에 들어가지 않게 한다. manual_note와 goal은 시간 정보가 없으므로 `startMs/endMs`가 항상 `null`이고 문자 interval만 허용한다.
- 구조적으로 지원하지 않는 material 또는 요청이 있으면 유효 included chunk를 만들지 않고 `not_applicable`로 남긴다. 반면 특정 interval의 경계·좌표가 지원되지 않는 `unsupported`는 실패 descriptor와 `failed` outcome으로 남긴다.
- 전체 목표·세부 목표·세션 목표의 공식 문구는 `goal`, 수기 상담 기록은 `manual_note`다. `purposes`는 planner가 정하며 provider가 추가·삭제하지 않는다. goal evidence는 goal 또는 직접 논의한 transcript, promise evidence는 manual_note 또는 transcript, risk evidence는 transcript만 허용한다.
- 기본 포함 범위는 S6 snapshot 전체다. `includedIntervals`는 요청 범위의 교집합이고 `excludedIntervals`는 원래 좌표, reason을 모두 보존한다. planner는 duplicate `sourceRef` 또는 같은 `originKind`의 두 source를 거부한다. `excluded_by_user`만 정상적인 중립 제외이며, `unsupported`는 실패, `privacy`는 차단이다. 제외가 포함보다 우선한다. 유효 포함 범위가 없으면 provider 호출 없이 `not_applicable`이 된다.

### 2.2 청크 계획

| 항목 | 계약값 |
|---|---|
| 청크 최대 길이 | 24,000 code points, 초과 금지 |
| overlap | 직전 청크 끝에서 500 code points, 같은 included interval 안에서만 |
| 좌표 | 원래 snapshot의 전역 `charStart/charEnd`, `[start,end)` |
| 재료 순서 | `transcript` → `manual_note` → `goal` |
| 재료 안 순서 | transcript는 `startMs`, 동률이면 `charStart`, 나머지는 `charStart` |

각 연속 included interval을 왼쪽부터 `[start,end)`로 쪼갠다. 첫 청크는 `start`에서 `min(start + 24000, end)`까지이고 다음 청크는 `previousEnd - min(500, previousLength)`에서 시작한다. `end === intervalEnd`이면 종료한다. excluded interval을 건너뛰어 overlap하지 않으며, excluded interval마다 새 열이 시작된다. 24,000자를 넘는 단일 transcript segment는 문자 경계에서 분할하되 원 segment의 `startMs/endMs`를 유지하고 시간을 임의 보간하지 않는다.

```ts
interface LongAiChunkDescriptor {
  chunkId: string;
  sourceRef: string;
  originKind: LongAiOriginKind;
  ordinal: number;
  charStart: number;
  charEnd: number;
  startMs: number | null;
  endMs: number | null;
  purposes: readonly LongAiPurpose[];
  privacySnapshotHash: string;
  pipelineVersion: string;
}
interface LongAiChunk extends LongAiChunkDescriptor {
  text: string; // snapshot의 정확한 전역 charStart..charEnd slice
}
```

`chunkId`는 UUID나 난수가 아니다. `sourceRef`, `privacySnapshotHash`, `pipelineVersion`, `originKind`, `ordinal`, 전역 문자·시간 좌표, 정렬한 `purposes`를 canonical JSON tuple로 고정하고 UTF-8 SHA-256 hex 전체값을 사용한다. 같은 계획의 retry·재생성은 같은 ID다. `text`가 snapshot slice와 다르거나 24,000 code points를 넘으면 계획 실패이며 호출하지 않는다. 모든 included 문자는 하나 이상의 descriptor가 소유하고 overlap 문자는 인접 descriptor에서 반복될 수 있다. tail을 묵살하지 않는다.

### 2.3 정확한 provider request와 결과

장문 모드는 S5/S6 `AIProvider.generate`에 additive `longPacket` envelope를 사용한다. `originKind`가 discriminator이므로 `manual_note`와 `goal`이 모두 `kind: text_context`여도 구분된다. 한 요청에는 각 originKind와 sourceRef가 최대 하나씩만 존재한다. 기존 short-packet의 material cardinality를 장문 요청에 암묵적으로 재사용하지 않는다.

```ts
interface LongAiProviderRequest {
  mode: 'long_packet';
  schemaVersion: 1;
  planHash: string;
  requestHash: string;             // actual ordered chunk/material bytes/policy hash
  callId: string;                  // binds this exact requestHash
  callOrdinal: number;
  providerIdentity: {
    providerId: string;
    model: string;
    adapterVersion: string;
    promptVersion: string;
    schemaVersion: string;
    configVersion: string;
  };
  materials: readonly LongAiProviderMaterial[]; // 1~3개, origin/sourceRef 중복 없음
  contrastAxes: AiContrastAxisStates; // S5/S6 정의 참조
}
type LongAiProviderMaterial =
  | (LongAiChunk & { originKind: 'transcript'; kind: 'transcript'; localCharLength: number })
  | (LongAiChunk & { originKind: 'manual_note'; kind: 'text_context'; localCharLength: number })
  | (LongAiChunk & { originKind: 'goal'; kind: 'text_context'; localCharLength: number });

interface LongAiProviderEvidence {
  chunkId: string; // localCharStart/localCharEnd 좌표의 기준 chunk
  contributingChunkIds: readonly [string, ...string[]];
  sourceRef: string;
  localCharStart: number;
  localCharEnd: number;
  quote: string;
  startMs: number | null;
  endMs: number | null;
}
type NonEmptyEvidence<E> = readonly [E, ...E[]];
interface GroundedText<E> { text: string; evidence: NonEmptyEvidence<E>; }
interface GroundedClaim<E> {
  claimKey: string;
  section: AiClaimSection;
  text: string;
  goalRef: string | null;
  evidence: NonEmptyEvidence<E>;
}
interface GroundedQuestion<E> { title: string; reason: string; evidence: NonEmptyEvidence<E>; }
interface GroundedContrast<E> { axis: AiContrastAxis; description: string; evidence: NonEmptyEvidence<E>; }
interface GroundedRisk<E> { type: AiFlagType; text: string; evidence: NonEmptyEvidence<E>; }
interface GroundedPromise<E> { promiseKey: string; text: string; evidence: NonEmptyEvidence<E>; }
interface GroundedGoalOutput<E> {
  goalRef: string; // immutable goal row/reference
  text: string;
  evidence: NonEmptyEvidence<E>; // goal-material evidence plus transcript evidence
}
interface GroundedDiscrepancyPair<E> {
  kind: 'cross_session' | 'within_session';
  leftEvidence: NonEmptyEvidence<E>;
  rightEvidence: NonEmptyEvidence<E>;
}
interface LongAiProviderContent {
  claims: readonly GroundedClaim<LongAiProviderEvidence>[]; // factual claims: transcript evidence only
  goalOutputs: readonly GroundedGoalOutput<LongAiProviderEvidence>[];
  oneLiner: GroundedText<LongAiProviderEvidence> | null;
  questions: readonly GroundedQuestion<LongAiProviderEvidence>[];
  contrasts: readonly GroundedContrast<LongAiProviderEvidence>[];
  risks: readonly GroundedRisk<LongAiProviderEvidence>[]; // transcript evidence only
  promises: readonly GroundedPromise<LongAiProviderEvidence>[];
}
type LongAiDiscrepancyState = 'supported' | 'unsupported' | 'failed';
interface LongAiDiscrepancyResult<E> {
  state: LongAiDiscrepancyState;
  findings: readonly GroundedDiscrepancyPair<E>[];
  failureCode?: string;
}
interface LongAiProviderResult {
  mode: 'long_packet';
  schemaVersion: 1;
  planHash: string;
  requestHash: string;
  callId: string;
  content: LongAiProviderContent; // one call-level payload; arrays may all be empty
}
interface LongDiscrepancyRequest {
  mode: 'long_discrepancy';
  schemaVersion: 1;
  planHash: string;
  requestHash: string;
  callId: string;
  providerIdentity: LongAiProviderRequest['providerIdentity'];
  currentApproved: readonly LongAiProviderMaterial[];
  priorApproved: readonly LongAiProviderMaterial[];
}
interface LongDiscrepancyProviderResult<E> {
  planHash: string;
  requestHash: string;
  callId: string;
  state: LongAiDiscrepancyState;
  findings: readonly GroundedDiscrepancyPair<E>[];
}
```

장문 호출의 대조 축은 source origin을 고정한다: `missing_from_memo`는 transcript evidence만, `missing_from_transcript`는 manual_note evidence만, `undiscussed_session_goal`은 goal evidence만 허용한다. 축별 source origin이 맞지 않는 finding은 전체 generate response를 실패로 만든다.
성공한 call의 content 배열은 모두 비어 있을 수 있다. 그러나 반환된 비어 있지 않은 claim, goal output, oneLiner, question, contrast, risk, promise는 generic `NonEmptyEvidence`를 가져야 한다. evidence에는 contributing `chunkId`가 하나 이상 있어야 하며 Core가 그 call의 성공한 included chunk에만 적용한다. generate response에 discrepancy를 포함하지 않는다. response의 schema·evidence·출처 검증이 하나라도 실패하면 response 전체를 mixed-invalid로 폐기하고 해당 call의 모든 chunk를 `failed`로 기록한다. 유효한 항목만 걸러 성공처럼 저장하지 않는다.

### 2.4 hash, privacy gate, 호출과 retry

`planHash`는 다음 값을 이 순서로 canonical JSON 직렬화한 SHA-256이다: ordered source descriptors(`originKind`, `kind`, `sourceRef`, 전역 interval, 정렬한 purposes), 모든 chunk descriptor, 각 snapshot hash와 pipeline version, consent evidence ID·hash·effective-at, `providerIdentity`의 provider/model/adapter/prompt/schema/config identity. consent 본문과 감지 문자열은 hash 입력·로그에 넣지 않는다. 결과 재사용은 `planHash`와 `requestHash`가 모두 같을 때만 허용하며 어느 identity 또는 consent evidence가 바뀌면 새 계획이다.

`requestHash`는 실제 한 call에 포함된 ordered `chunkId` 목록, 각 material의 masked text UTF-8 bytes, material kind/origin, included/excluded policy를 JCS로 직렬화한 SHA-256이다. `callId`는 `planHash`와 `requestHash`의 tuple을 해시해 만든다. idempotency key는 `ccc-long-ai/<callId>/<requestHash>`로 exact request에 묶인다.
discrepancy는 generate content와 별도다. Core는 `LongDiscrepancyRequest`의 currentApproved/priorApproved masked comparison chunks로 S5 `AIProvider.detectDiscrepancies`만 호출한다. 이 요청도 호출 전·응답 후·저장 직전 S6 gate, exact requestHash, 새 callId와 idempotency key를 사용하며 결과는 `GroundedDiscrepancyPair`로 병합한다. 미지원은 `unsupported`, provider/검증 실패는 `failed`이고 둘 다 result와 UI에 남긴다.

각 grouped call마다 다음 순서로 실행한다.

1. provider 호출 직전 S6의 pipeline version, snapshot hash, vault 대조, 잔여 identifier scan, 유효 동의와 consent evidence를 모든 included chunk에 대해 검증한다. 실패하면 provider 호출 없이 해당 chunk를 제외하고 `blocked` outcome으로 만든다. `excluded_by_user`는 중립 제외로, `unsupported`는 `failed`로 기록한다.
2. `LongAiProviderRequest`에는 남은 included chunk만 넣고, 위 idempotency key를 보낸다. excluded interval, 다른 snapshot, unmasked text를 요청·로그·오류에 넣지 않는다.
3. 응답을 받으면 S6 검증을 다시 수행한다. grouped call의 어느 chunk에서든 pipeline/hash/vault/identifier/consent 검증이 실패하면 response 전체를 폐기하고 해당 call의 모든 included chunk를 원자적으로 `blocked`로 기록한다. 개인정보 검증을 통과한 뒤 local offset·quote·source hash·chunk ID·origin·시간 범위를 확인하며 schema/evidence 검증 실패는 response 전체와 모든 included chunk를 원자적으로 `failed`로 기록한다.
4. 저장 직전에 S6 검증을 세 번째 수행한다. grouped call의 어느 chunk라도 snapshot hash, pipeline version, consent evidence가 처음 계획과 다르면 response 전체를 폐기하고 저장하지 않으며 해당 call의 모든 included chunk를 원자적으로 `blocked`로 기록한다. stale response는 재시도 대상이 아니다.

retry는 같은 grouped call에 최대 2회, 총 3회 시도한다. timeout, network, HTTP 429, HTTP 500~599만 retry하고 입력·privacy·schema·그 밖의 4xx는 즉시 `failed`다. backoff 상한은 1초, 4초이며 provider fallback은 없다. attempt는 immutable append-only receipt로 남기고 먼저 성공한 결과만 채택하며 늦은 duplicate success는 저장·병합하지 않는다. 과금은 accepted merge가 아니라 실제 provider submission을 기준으로 한다. `submitted=false`면 billing 0, `submitted=true`면 관찰된 provider receipt에 따라 1 또는 `unknown`이며 stale response도 이미 제출됐다면 과금될 수 있다. aggregate는 attempt submission 결과로만 계산한다.

```ts
interface LongAiAttemptReceipt {
  attemptId: string;
  attemptNo: number;
  callId: string;
  orderedChunkIds: readonly string[];
  requestHash: string;
  idempotencyKey: string;
  submitted: boolean;
  providerBillingUnits: number | null; // submitted=false면 0, 관찰 receipt 없으면 null
  state: 'succeeded' | 'failed' | 'blocked';
  providerStatus?: number;
  failureCode?: string;
  startedAt: string;
  finishedAt: string;
}
interface LongAiCallReceipt {
  callId: string;
  callOrdinal: number;
  orderedChunkIds: readonly string[];
  requestHash: string;
  submittedAttempts: 0 | 1 | 2 | 3;
  providerBillingUnits: number | null; // attempt submission/billable receipt 집계, accepted merge와 무관
  attempts: readonly LongAiAttemptReceipt[];
  outcomes: Readonly<Record<string, { outcome: LongAiOutcome; attemptId: string | null }>>;
  supersedesCallId?: string;
}
interface LongDiscrepancyAttemptReceipt extends LongAiAttemptReceipt {
  mode: 'long_discrepancy';
}
```
`submittedAttempts`는 attempts에서 `submitted=true`인 수와 같고, `providerBillingUnits`는 관찰된 per-attempt billable receipt 합계이며 관찰 불가가 하나라도 있으면 `null`이다. accepted merge 여부로 이 값을 낮추지 않는다.

### 2.5 전역 근거, 병합, 상태와 CAS 재생성
provider가 반환하는 `localCharStart/localCharEnd`는 provider-local chunk text의 code point 좌표다. Core가 한 번만 `global = chunk.charStart + local`로 변환해 persisted evidence의 전역 좌표를 만들고 이후 재변환하지 않는다. provider-local evidence와 content는 저장하거나 UI에 직접 노출하지 않는다. Provider는 `evidenceId`를 생성하지 않는다. Core는 chunk membership와 global span/time 검증을 끝낸 뒤 `SHA-256(JCS(callId, chunkId, sourceRef, validatedGlobalSpansAndTimes, quoteHash))`로 persisted `evidenceId`를 파생한다. quote는 local slice와 전역 snapshot slice 모두에 정확히 일치해야 하며 transcript evidence는 `startMs/endMs`, manual_note/goal은 `null`이다.

```ts
interface LongAiPersistedEvidence extends Omit<LongAiProviderEvidence, 'localCharStart' | 'localCharEnd'> {
  evidenceId: string; // Core가 validated membership/span 뒤 JCS SHA-256으로 파생
  originKind: LongAiOriginKind;
  sourceCharStart: number;
  sourceCharEnd: number;
}
type PersistedGroundedText = GroundedText<LongAiPersistedEvidence>;
type PersistedGroundedClaim = GroundedClaim<LongAiPersistedEvidence>;
type PersistedGroundedQuestion = GroundedQuestion<LongAiPersistedEvidence>;
type PersistedGroundedContrast = GroundedContrast<LongAiPersistedEvidence>;
type PersistedGroundedRisk = GroundedRisk<LongAiPersistedEvidence>;
type PersistedGroundedPromise = GroundedPromise<LongAiPersistedEvidence>;
type PersistedGroundedGoalOutput = GroundedGoalOutput<LongAiPersistedEvidence>;
type PersistedDiscrepancyResult = LongAiDiscrepancyResult<LongAiPersistedEvidence>;
type LongAiOutcome = 'succeeded' | 'failed' | 'blocked' | 'not_applicable';
interface LongAiPersistedPlan {
  planHash: string;
  draftVersion: number;
  chunks: readonly LongAiChunkDescriptor[]; // non-user-excluded 전체, unsupported/privacy 포함
  outcomes: Readonly<Record<string, LongAiOutcome>>;
}
interface LongAiDraft {
  draftVersion: number;
  lifecycle: 'pending' | 'succeeded' | 'approved';
  plan: LongAiPersistedPlan;
  state: 'complete' | 'partial' | 'blocked';
  claims: readonly PersistedGroundedClaim[];
  goalOutputs: readonly PersistedGroundedGoalOutput[];
  oneLiner: PersistedGroundedText | null;
  questions: readonly PersistedGroundedQuestion[];
  contrasts: readonly PersistedGroundedContrast[];
  risks: readonly PersistedGroundedRisk[];
  promises: readonly PersistedGroundedPromise[];
  discrepancy: PersistedDiscrepancyResult;
  missingSections: readonly ('goal' | 'risk' | 'promise' | 'summary')[];
  excludedIntervals: readonly LongAiInterval[];
}

- persisted `outcomes`의 key 집합은 plan에 저장한 모든 non-user-excluded descriptor의 `chunkId` 집합과 정확히 같고, `succeeded`, `failed`, `blocked`, `not_applicable` 네 집합은 서로 겹치지 않으며 합집합은 전체다. `unsupported`와 `privacy` descriptor도 각각 failed/blocked outcome으로 남긴다. provider request에는 eligible included chunk만 넣는다. `excluded_by_user` descriptor는 plan/outcome에 넣지 않고 `excludedIntervals`에만 보존한다. `LongAiDraft.state`는 outcomes와 content completeness에서만 파생한다. 모든 eligible chunk가 succeeded이고 `missingSections`가 비어 있으며 discrepancy가 `supported`일 때만 `complete`, 성공과 비성공이 혼합되거나 missingSections가 non-empty이거나 discrepancy가 `unsupported`/`failed`이면 `partial`, 성공이 없거나 eligible chunk가 없으면 `blocked`다.
- dedupe identity는 output family, 모든 semantics(`claim section`, `contrast axis`, `risk type`, `goalRef`, `promise key`, discrepancy `kind`), canonical text(NFC 정규화, Unicode whitespace run을 ASCII 공백 하나로 접고 양끝을 자름), 정렬한 전체 provenance tuple 집합 `(originKind, sourceRef, sourceCharStart, sourceCharEnd, startMs, endMs)`의 결합이다. 같은 identity만 하나로 만들고 모든 입력 evidence를 union한다. provenance span 하나라도 다르면 strict evidence subset이더라도 별도 output이다. claimKey만으로 합치지 않는다. 최종 sort의 마지막 tie-breaker는 chunkId다.
- persisted claim, oneLiner, question, risk, promise와 discrepancy pair는 모두 generic `Grounded*<LongAiPersistedEvidence>`다. provider-local evidence와 content는 저장하거나 UI에 직접 노출하지 않는다. factual claim과 risk의 evidence는 transcript-only이며 validator가 sourceRef/origin과 quote의 정확한 관계를 확인한다. `goalOutputs`는 immutable `goalRef`를 가지고 goal-material evidence와, 논의된 경우 transcript evidence를 함께 보존한다. promise는 manual_note 또는 transcript evidence를 허용한다. risk는 고정 유형 제안이며 진단·확정·GAS 점수가 아니다. evidence가 없거나 범위·quote·goal relation이 틀리면 전체 call response가 실패한다.
- `regenerateMissing(expectedDraftVersion, expectedPlanHash, callId, chunkIds)`는 compare-and-set으로 동작한다. 현재 draftVersion·planHash·callId가 모두 일치하고 lifecycle이 `pending`일 때만 시작한다. 불일치, lifecycle이 `succeeded` 또는 `approved`, 다른 plan의 chunk는 거부한다. 선택한 subset을 재계획해 새 requestHash, 새 callId, 새 idempotency key를 만들고 기존 call을 `supersedesCallId`로 연결한다. 기존 성공 output과 attempt는 수정·삭제하지 않는다.
- `regenerateMissingSections(expectedDraftVersion, expectedPlanHash, callId, sectionNames)`는 lifecycle이 `succeeded`지만 call-level content가 비어 missingSections가 남은 경우에만 허용한다. CAS 검증 뒤 유효 subset을 새 request identity로 호출하며 성공한 chunk를 중복 호출하지 않는다. `retryDiscrepancy`는 discrepancy call에만 같은 CAS와 새 requestHash/callId/key를 적용한다. `approved` draft와 evidence는 immutable이며 모든 recovery 요청을 거부한다.

### 2.6 누락 UI

`partial` UI는 고정 문구 `장문 AI 초안이 일부 구간만 생성되었습니다. 누락 구간을 확인하고 재생성하세요.`와 origin별 missing section을 표시한다. transcript 누락은 `mm:ss.mmm~mm:ss.mmm`, manual_note·goal 누락은 `문자 n~m`으로 표시한다. `excluded_by_user`는 `제외됨`으로 별도 표시하고 missing으로 위장하지 않는다. `failed`·`blocked`가 하나라도 있으면 승인 버튼을 숨기거나 비활성화하며 `complete`·`approved`처럼 보이는 배지를 표시하지 않는다. `blocked` 결과는 draft 본문을 표시하지 않는다.

`discrepancy.state`가 `unsupported` 또는 `failed`이면 UI에 해당 상태와 양쪽 evidence pair 확인 또는 수기 확인 안내를 표시하고 draft state는 `partial`로 파생한다. discrepancy 미지원·실패가 claim 결과를 성공으로 위장하지 않는다. 성공 call의 content가 비어 있어도 coverage와 해당 section의 `missingSections`를 표시한다. `missingSections`가 하나라도 있으면 `partial`이며 승인을 막는다. `regenerateMissing`은 failed/blocked chunk만, `regenerateMissingSections`은 succeeded-empty section만, `retryDiscrepancy`는 discrepancy call만 대상으로 한다. 승인된 draft와 provider-local content/evidence는 화면에 재사용하지 않는다.

## 3. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| S6 재검증 실행 위치 | 기관 소유 Agent PC, Edge는 orchestration만 | 해당 PC의 Agent | 서버와 페어링된 Agent PC |
| provider 호출 | `AIProvider`를 통한 OpenAI BYOK, `store:false`, packet만 외부 전송 | 동일 packet 계약, 키가 없으면 `blocked` | 동일 packet 계약, 서버가 Agent에 원문 재전송하지 않음 |
| source snapshot / 결과 저장 | 기관 Supabase DB | 암호화 SQLite | 서버 암호화 SQLite |
| 청크·ID·근거·누락 UI | 동일 | 동일 | 동일 |
| 자동 provider 전환 | 금지 | 금지 | 금지 |

원음 저장·삭제와 signed URL은 SG8, 개인정보 일반화와 일곱 fail-closed code는 SG6, queue claim/heartbeat와 Agent credential은 SG5가 소유한다. S15는 해당 인터페이스를 참조하며 복제하지 않는다.

## 4. 완료 조건

- [ ] 세 origin의 discriminated material/request/result schema, sourceRef uniqueness, 빈 성공 output, discrepancy 상태가 문서에 완결되어 있다.
- [ ] `Array.from(text).length` 기준 24,000 상한, 500 overlap, included/excluded interval, 결정론적 chunkId/order가 완결되어 있다.
- [ ] 매 chunk의 호출 전·응답 후·저장 직전 SG6 검증, stale discard, provider idempotency key, bounded retry, immutable attempts와 first-success-only 규칙이 완결되어 있다.
- [ ] planHash의 ordered descriptor/purpose, pipeline·consent evidence, provider/model/prompt/schema/config identity와 exact-hash 재사용 조건이 완결되어 있다.
- [ ] local/global offset 번역, evidence 필수 출력, source provenance identity, evidence union, total sort와 chunkId tie-breaker가 완결되어 있다.
- [ ] grouped call별 chunk outcome, disjoint/exhaustive persisted outcome set, 상태 파생, CAS regeneration, partial/blocked UI가 완결되어 있다.
- [ ] risk/goal/promise 출처 제한, 실패 response 전체 폐기, 제외 구간과 unmasked text의 provider 비전송이 완결되어 있다.
- [ ] 아래 fixture와 검증 명령의 기대 판정이 문서에 있다.

## 5. 검증 방법

구현 검증 시 저장소 루트에서 다음을 실행한다.

```sh
pnpm --filter @ccc/api exec vitest run test/long-ai-packet.test.ts test/long-ai-packet-provider.test.ts
```

필수 fixture와 기대 결과:

| fixture | 기대 판정 |
|---|---|
| astral code point 48,500자 timed transcript, 3개 segment | `Array.from` 기준 `[0,24000)`, `[23500,47500)`, `[47000,48500)`과 같은 ID·순서가 반복 실행에서 나온다. 각 transcript evidence는 전역 문자·시간 범위를 가진다. |
| 24,001자 manual_note, 50,001자 goal | tail을 잃지 않고 각각 2개, 3개 청크이며 request의 origin discriminator가 다르고 sourceRef 중복이 없다. |
| goal-derived output and factual claim | `goalOutputs` has immutable `goalRef`, goal-material evidence and discussed transcript evidence. Factual claim/risk evidence is transcript-only and invalid source relation fails the full response. |
| origin-aware contrast mismatch | `missing_from_memo` with non-transcript, `missing_from_transcript` with non-manual_note, or `undiscussed_session_goal` with non-goal evidence is a full response failure. |
| transcript 시간 10,000~12,000ms 제외 | 해당 segment와 overlap이 payload·evidence에 0건, `excluded_by_user` interval이 원래 시간으로 남는다. |
| 1회 429, 2회 timeout, 3회 성공 | 같은 call-level idempotency key와 requestHash로 정확히 3회, 첫 valid success만 채택한다. `submittedAttempts=3`; `providerBillingUnits`는 observed submission receipt 집계이며 unknown billing은 null로 남긴다. |
| provider response 중 claim 하나의 quote 범위 오류 | response 전체와 grouped-call의 모든 chunk outcome을 mixed-invalid/failed로 폐기한다. 유효한 다른 항목을 성공으로 저장하지 않는다. |
| 호출 직전, 응답 직후, 저장 직전 동의 철회·hash 변경 | 각 단계에서 provider 호출 0건 또는 response discard, stale 저장 0건, SG6 code와 blocked가 기록된다. |
| 세 gate 중 하나만 stale인 grouped call | pre-call, post-response, pre-persist를 각각 독립적으로 무효화한 fixture에서 해당 call의 모든 included chunk가 원자적으로 blocked 되고 content가 저장되지 않는다. |
| provider evidenceId 조작 | provider가 evidenceId를 반환하거나 membership/span 검증 전 persisted ID를 만들면 reject한다. Core가 검증 뒤 정해진 JCS tuple로만 ID를 파생한다. |
| overlap duplicated claim과 NFC/whitespace 차이 | 같은 provenance tuple 전체가 있는 identity만 evidence union하고, sort 마지막 tie-breaker가 chunkId다. 다른 span은 별도 claim이다. |
| 성공 1개 + 실패 1개 뒤 CAS missing regeneration | 일치하는 draftVersion+planHash+callId에서 새 requestHash/callId/key로 실패 chunk만 재호출하고 supersession link를 남긴다. `regenerateMissingSections`는 succeeded-empty section만, `retryDiscrepancy`는 discrepancy call만 대상으로 한다. mismatch, succeeded-with-content, approved 요청은 거부하며 성공 attempt는 불변이다. |
| discrepancy adapter unsupported/failed | `AIProvider.detectDiscrepancies` 별도 call의 result와 UI가 각각 `unsupported`/`failed`를 표시하고 `GroundedDiscrepancyPair`의 양쪽 evidence를 보존한다. 조용한 skip이나 complete-looking 상태가 없다. |

다음 중 하나라도 발생하면 실패다: 24,000 초과 payload, astral 문자 오프셋 오류, tail 묵살, excluded/unmasked text 전송, 호출 전·응답 후·저장 직전 privacy 검증 누락, stale result 저장, retry 3회 초과, fallback provider 호출, response 일부만 필터링해 성공 처리, evidence 없는 사실 문장, 전역·local 좌표 불일치, outcome 집합 중복·누락, 실패 chunk가 있는 `complete` 또는 승인 가능 UI.

## 6. 이번에 안 하는 것

원음 저장·삭제와 signed URL은 SG8, 개인정보 일반화와 일곱 fail-closed code는 SG6, queue claim/heartbeat와 Agent 인증은 SG5, provider 모델·prompt 자체와 목표 모델 검수는 E2-8이 소유한다. S15는 새로운 provider, 자동 전환, 진단·지원 지속 판단, GAS 점수, 리스크 확정, transcript 시간 보간을 추가하지 않는다.
