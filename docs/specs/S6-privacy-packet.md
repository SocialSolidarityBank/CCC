# S6: Privacy Packet

- 상태: 확정 (2026-09-03)
- 2026-09-06 Q 정정 승인: 실제 설치 검사는 N2로 분리하고, G10 해시와 기존 주소/지역 입력의 분류를 정정한다. 기존 N의 실패와 G1~G10 프로토콜 입력은 이력으로 보존하며 실제 NER 통과 증거로 사용하지 않는다.
- 2026-09-06 후속 실행 승인: 고정 모델과 N2/출시 정답 및 통과 기준은 유지하고 BIOES 구간 해석을 교정해 재측정한다. 이 승인은 모델 교체나 운영 활성화를 포함하지 않는다.
- 근거: ADR-0041 D81, D82, ADR-0036, `CLAUDE.md` §5 R3, S5 Agent 작업 계약 v2
- 입력: `docs/adr/0041-one-core-three-deployment-modes.md`, `docs/adr/0042-supabase-read-only-preflight.md`, `docs/specs/S5-agent-job-contract-v2.md`, `apps/pipeline/ccc_pipeline/masking.py`, `apps/pipeline/ccc_pipeline/results.py`, `packages/core/src/gateway.ts`, `docs/api-contract-pipeline.md`
- 산출: Agent가 제출하는 마스킹 증명, 코어의 재검증·동의 관문, 세 모드 privacy golden 계약. 대응 정본은 이 파일이며 구현 산출물은 E5-4, E5-5가 소유한다.
- 관련 티켓: E5-4, E5-5, E5-1a, E5-1b, E1-5

## 1. 목적

등록값과 독립 blocker가 탐지한 식별 정보가 외부 AI 사업자에 도달하지 않도록 Agent와 공통 코어가 서로 다른 관문에서 이중 검증한다. 이 스펙은 직접 식별자 마스킹, 준식별자 일반화, NER health와 release qualification, 마스킹 파이프라인의 버전·해시, 결과 시점 동의 재검증, 일곱 fail-closed 상태를 정한다. 탐지되지 않은 새로운 식별자의 잔여 위험은 0이 아니며 R3에 따라 동의 고지로 공개한다.

## 2. 인터페이스와 규칙

### 2.1 S5 Agent 결과와 마스킹 증명

S6는 S5의 `MaskedSource`, `AudioResult`, `TextResult`, `ResultRequest`, `ReleaseRequest`를 소비한다. S5의 필드와 이름을 바꾸거나 별도 v1 결과를 만들지 않는다. S5 `MaskedSource`의 마스킹 관련 필드는 다음과 같다.

```ts
interface MaskedSource {
  maskedText: string;
  sha256: string;                 // maskedText UTF-8 SHA-256, lower-case hex 64자
  maskingPipelineVersion: string;
  maskingPipelineHash: string;    // JCS(manifest), own hash field 제외
  nerAvailable: true;             // false이면 S5 blocked release
  nerAttestationId: string;
  nerAttestationResultHash: string;
  evidenceHash: string;           // JCS(evidence 배열) SHA-256
  evidence: Array<{
    id: string;
    sourceRef: string;
    sourceSha256: string;
    evidenceQuote: string;
    sourceStart: number;           // Unicode code-point offset, inclusive
    sourceEnd: number;             // exclusive
  }>;
}
```
S5의 audio `AgentJob.audio`는 `rawAudioSha256`과 `egressAuthorizationId`를 함께 제공해야 한다. `rawAudioSha256`은 Azure authorization과 동일한 원음의 SHA-256이고, `egressAuthorizationId`는 위 egress 행을 가리킨다. claim·audio endpoint와 이 두 필드의 발행은 E5-1a가, Azure authorization과 STT 실행은 E5-3이 소유한다.

`nerAvailable=false`이면 `ResultRequest`를 제출하지 않는다. Agent는 S5의 `ReleaseRequest { outcome: 'blocked', reason: 'local_ner_unavailable' }`로 보고하고, 코어는 해당 작업을 infrastructure blocked 상태로 두어 fresh passing health attestation 뒤 같은 작업을 다시 처리할 수 있게 한다. 이 상태는 attempt를 소진시키지 않으며 reprocessable이다. 나머지 결과 형식·claim·lease·terminal 전이는 S5를 따른다.

### 2.2 NER health attestation

정식 인명·주소 계층은 다음 model revision과 label set만 사용한다.

| 항목 | 고정값 |
|---|---|
| model | `FrameByFrame/korean-pii-e5-base` |
| revision | `a308c54b4407819624a5661e31e162a269f39818` |
| label set | `PRIVATE_PERSON`, `PRIVATE_ADDRESS` |
| labelSetHash | `b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc` |
| health corpus | `s6-ner-health-ko-conversation-v2` (N2) |
| pipeline version | `ner-mask-v3` (BIOES 디코더 교정) |
| pipeline manifest SHA-256 | N2 실측 통과 뒤 §2.3의 실제 구성으로 계산한다. 과거 프로토콜 fixture의 고정 hash는 §5.2에 보존한다. |
`labelSetHash`는 사전순으로 정렬한 정확한 label 문자열 배열 `["PRIVATE_ADDRESS","PRIVATE_PERSON"]`의 JCS UTF-8 bytes SHA-256이며, 그 preimage hash가 위 값이다.

`ner-mask-v3`는 transformers의 token classification을 `aggregation_strategy="none"`, `ignore_labels=[]`로 실행하고 공통 `bioes-v1` 디코더가 원문 code-point 구간을 묶는다. B는 새 구간, E/L은 끝, S/U는 단독 구간이며 O와 범주 변경은 구간을 끊는다. 시작 없는 I/E/L은 버리지 않고 새 구간으로 보존한다. 경계를 정답이나 점수 임계값으로 보정하지 않는다. Agent와 측정 도구가 같은 디코더를 쓰고, 실제 결과와 보고서 hash를 새 파일로 남긴다.

실제 설치 health corpus는 §5.1의 N2다. 알려진 인명 4개와 주소 4개, 어느 쪽도 없는 음성 2개를 고정한다. N2는 model load, label mapping, deterministic span/label behavior를 확인하는 최소 smoke이며 production release를 승인하지 않는다. corpus는 `id`, `text`, `person`, `address` 키를 가진 배열의 UTF-8 JCS로 고정한다. 과거 N의 표식 literal과 가상 passing 결과는 프로토콜 검증 전용이며 실제 설치 통과로 사용하지 않는다.

각 label의 span은 시작·끝 code-point와 label이 모두 같은 경우에만 TP다. `TP(label)`은 gold span과 예측 span이 시작·끝·label 모두 같은 개수, `FP(label)`은 gold와 정확히 대응하지 않는 예측 span 개수, `FN(label)`은 예측과 대응하지 않는 gold span 개수다. `precision = TP / (TP + FP)`, `recall = TP / (TP + FN)`으로 계산하고 분모가 0이면 통과시키지 않는다. `overgeneralizationRate = (FP(PRIVATE_PERSON) + FP(PRIVATE_ADDRESS)) / (TP(PRIVATE_PERSON) + TP(PRIVATE_ADDRESS) + FP(PRIVATE_PERSON) + FP(PRIVATE_ADDRESS))`로 계산한다. N2도 각 label TP=4, FP·FN=0이어야 한다. 모델 예측 이후 정답 span이나 입력을 변경하지 않는다.

health result object는 위 다섯 metric만 가진다. 모두 통과한 값의 JCS는 `{"addressPrecision":1,"addressRecall":1,"overgeneralizationRate":0,"personPrecision":1,"personRecall":1}`이고 SHA-256은 `fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72`다. `resultHash`는 실제 측정한 이 object의 JCS UTF-8 bytes SHA-256이며 임의 상수가 아니다. 실행 환경, corpus, 항목별 TP/FP/FN과 시각까지 포함한 보고서는 자기 `reportHash`만 제외한 전체 object를 별도로 hash한다. Agent claim에 전달·저장하는 attestation projection은 아래 필드만 갖는다.

```ts
interface NerHealthAttestation {
  id: string;
  modelId: 'FrameByFrame/korean-pii-e5-base';
  modelRevision: 'a308c54b4407819624a5661e31e162a269f39818';
  labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc';
  corpusHash: string;
  resultHash: string;
  validatedAt: string;
  expiresAt: string; // validatedAt + 24h 이내
  status: 'passed';
}
```

통과 조건은 인명·주소 precision·recall 각각 `>= 0.90`, `overgeneralizationRate <= 0.05`다. Agent claim은 만료되지 않은 `status='passed'` attestation, 고정 model revision·labelSetHash, corpus hash, result hash와 통과 결과를 모두 확인한 뒤에만 성공한다. 하나라도 없거나 stale·불일치이면 `local_ner_unavailable`이고 Azure STT보다 먼저 차단한다. `nerAvailable: true`라는 호출자 선언만으로는 attestation을 대신할 수 없다.
설치 health와 production release qualification은 분리한다. E5-4는 별도의 non-empty conversational synthetic corpus를 최소 500개로 만들고, 한국어 성씨·이름 길이·존칭·띄어쓰기·로마자 이름·기관명 모호성, 도로명·지번·건물·동·호·우편번호 주소 형태를 층화한다. hard negative는 최소 200개다. E5-4가 corpus hash와 실제 측정 result hash를 발행하며, 각 label의 Wilson 95% lower precision·recall이 `>= 0.90`, overgeneralization Wilson 95% upper bound가 `<= 0.05`여야 production release qualification이 된다.

```ts
interface NerReleaseQualificationReceipt {
  receiptId: string;
  modelId: 'FrameByFrame/korean-pii-e5-base';
  modelRevision: 'a308c54b4407819624a5661e31e162a269f39818';
  labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc';
  corpusHash: string; // E5-4가 발행한 최소 500-item corpus의 hash
  resultHash: string; // E5-4 측정 결과의 hash
  validatedAt: string;
  expiresAt: string;
  status: 'passed';
}
```

production claim과 모든 외부 egress authorization은 현재 `status='passed'`이고 만료되지 않은 release qualification receipt, 고정 model revision·labelSetHash, receipt의 corpusHash·resultHash가 일치할 때만 열린다. install smoke N2만으로 production authorization을 만들지 않으며, receipt가 없거나 stale이면 `local_ner_unavailable`로 차단한다. 이 quality gate와 R3는 보지 못한 이름을 완전히 증명하지 않는다. runtime blocker가 잡지 못한 잔여 위험은 0이 아니며 동의 고지에 남긴다.

### 2.3 masking pipeline hash와 저장 증명

`maskingPipelineHash`의 입력은 사전순 키를 사용하는 canonical JSON manifest이며, 자기 hash 필드는 포함하지 않는다.
`maskingPipelineHash`는 `maskingPipelineHash` 필드를 제외한 manifest 전체의 JCS UTF-8 bytes에 SHA-256을 적용해 계산한다. manifest에는 `schemaVersion: 1`, `maskingPipelineVersion`, 직접 식별자 규칙 버전, 준식별자 규칙 버전, 정규식 규칙 버전, 고정 NER model revision·labelSetHash, health corpus hash·result hash, 질환 사전 버전만 넣는다. 감지된 원문, 스팬, 근거 발췌, PII 값은 manifest와 해시에 넣지 않는다.

2026-09-06 직접 치환 정정은 `direct-v2`이며 주소/지역의 단일 필드 분류와 겹침의 비연쇄 치환을 포함한다. 후속 승인된 BIOES 교정은 `ner-mask-v3`로 구분한다. `quasi-v1`, `regex-v2`, `condition-dict-v1`과 고정 모델/라벨을 유지하며 실제 설치 attestation의 N2 corpus/result hash를 manifest에 넣는다. 다른 모델, 라벨, 디코더, 질환 NER 계층 또는 health 결과를 같은 manifest로 보고하지 않는다. 이전 `ner-mask-v2` 실측과 §5.2의 protocol fixture는 이력으로 보존한다. 새 manifest를 계산하더라도 E5-5의 허용 쌍이나 provider authorization을 자동으로 넓히지 않는다.
E5-5가 소유하는 snapshot 저장 스키마는 모든 행에 다음 값을 불변으로 보존한다. 기존 행이라도 하나라도 없으면 provider 재료로 사용할 수 없다.
| 저장 필드 | 의미와 검증 |
|---|---|
| `masking_pipeline_version` | Agent가 사용한 pipeline version |
| `masking_pipeline_hash` | 해당 manifest hash |
| `ner_attestation_id` | 사용한 health attestation ID |
| `ner_attestation_result_hash` | 해당 attestation의 `resultHash` |
| `ner_release_qualification_receipt_id` | E5-4 production release receipt ID, 현재 `status='passed'`만 provider 재료가 됨 |
| `evidence_hash` | evidence 배열 JCS hash |
| `material_hash` | 해당 마스킹 재료의 canonical UTF-8 bytes SHA-256 |
| `material_type` | `audio-transcript`, `text-context`, `derived-summary` 중 하나 |

`material_hash`는 S5 `sha256`과 같은 본문 hash를 가리키고, `evidence_hash`는 `evidence` 배열 전체를 가리킨다. 각 hash는 대상 canonical object에서 자기 hash 필드를 제외한 JCS UTF-8 bytes의 SHA-256으로 계산하며 임의 상수를 쓰지 않는다. `maskingPipelineVersion`과 `maskingPipelineHash`의 허용 쌍은 배포 설정으로 고정한다. 버전 또는 manifest hash가 쌍에 없으면 `masking_pipeline_version_mismatch`다.

### 2.4 Agent와 코어의 경계

서버는 claim-bound, no-store 응답으로 PII 금고의 등록값과 대체값을 담은 일회성 mask dictionary를 Agent에 전달한다. Agent는 이 dictionary를 메모리에서만 사용해 원음에서 만든 전사 또는 source text에 직접 식별자 치환을 먼저 적용하고, 그 뒤에 NER·정규식·준식별자 일반화를 적용한다. dictionary는 파일, 로그, 결과, provider 요청에 저장하지 않고 처리 뒤 즉시 지운다. TextResult의 source는 이미 같은 직접 치환을 거친 값이며, Agent는 다시 적용해도 결과가 변하지 않는 멱등 규칙을 사용한다.

mask dictionary endpoint는 `POST /pipeline/jobs/:jobId/mask-dictionary`다. TLS 인증 채널에서 S5 `MaskDictionaryRequest` 본문 `{ claimToken, attempt }`만 받고, query·추가 body field·브라우저 actor는 받지 않는다. users의 `service`, 기관, job·claim token·attempt가 모두 일치하고 job이 live일 때만 발급한다. 일회성의 단위는 claim이며, 응답 유실 뒤의 같은 claim 재전송은 [S5 §2.1](S5-agent-job-contract-v2.md#21-타입과-json-스키마)의 동일 응답 재생성 검증을 따른다.

```ts
interface MaskDictionaryResponse {
  dictionaryId: string;
  jobId: string;
  expiresAt: string; // 발급 시각 + 5분 이하
  oneTime: true;
  entries: Array<{
    field: string;
    sourceValue: string;
    replacement: string;
  }>;
}
```

응답은 `Cache-Control: no-store`다. 최초 만료 시각은 재전송으로 늘어나지 않으며, 다른 claim이나 만료 뒤에는 사용할 수 없다. 원문 표를 서버 cache나 DB에 보존하지 않고 검증된 동일 표만 재생성한다. 발급과 재전송의 감사 이름은 S5의 `mask_dictionary_read` 하나이며 원문 entries를 감사에 담지 않는다. endpoint와 메모리 폐기는 E5-1a와 E5-4가 공동 소유한다. S5의 `maskDictionaryEndpoint`가 claim 응답에서 가리키는 유일한 endpoint다.

서버와 Agent는 dictionary의 `sourceValue`·`replacement` 쌍과 직접 식별자 원문을 메모리에서만 처리하고 성공·실패 모두에서 즉시 zeroize한다. dictionary 자체를 파일, 로그, 결과, provider 요청에 저장하지 않는다. 제어 가능한 writable buffer는 덮어쓴 뒤 해제하고, 원문을 붙잡는 응답/JSON 오류/traceback과 작업 컨테이너 참조도 정리한다. Agent의 전용 원문 수신 버퍼는 OS 잠금을 확인한 뒤 읽으며, 잠금 실패 시 잠기지 않은 버퍼로 계속 처리하지 않는다.

전체 폐기 관문은 금고 복호화, 응답 직렬화/TLS, Agent 수신/JSON, 직접 치환/NER와 결과 경로를 함께 검증해야 닫는다. 특정 버퍼의 덮어쓰기나 참조 제거를 JavaScript/Python immutable 문자열, JSON parser와 모델 내부 복사본 전체의 물리적 폐기로 간주하지 않는다. 스왑, crash dump와 최대절전 저장의 유출 방지 조건도 별도로 확인하며, 암호화된 저장장치라는 사실만으로 원문 복사본 비저장을 증명하지 않는다. 일부 경로만 확인됐으면 전체 관문을 미통과 또는 미측정으로 남긴다.

직접 치환은 다음과 같다.

| 등록 필드 | Agent 대체값 | 대체 대상 값의 Packet 잔류 |
|---|---|---|
| 이름, 전화번호, 이메일, 계좌번호 | 해당 케이스의 가명 ID | dictionary가 매칭한 원래 값은 남지 않음 |
| 정확한 주소, 긴급연락처 | 해당 케이스의 가명 ID | dictionary가 매칭한 원래 값은 남지 않음 |
| 생년월일 | `[생년월]` | dictionary가 매칭한 원래 값은 남지 않음 |
| 거주지역 | 광역 단위 값. 광역 단위로 판정할 수 없으면 `[지역]` | dictionary가 매칭한 원래 값은 남지 않음 |
| 성별 | `[성별]` | dictionary가 매칭한 원래 값은 남지 않음 |
| 당사자·기관 내부 식별자 | 해당 케이스의 가명 ID | dictionary가 매칭한 원래 값은 남지 않음 |

위 11종은 의미 범주이지 필수 DB 컬럼 11개가 아니다. `participant_pii_vault.enc_region`은 PRD의 “주소 또는 거주지역” 한 입력이다. 비어 있지 않은 전체 값을 한 번 분류한다. 행정구역명으로만 구성된 값이면 `region`으로 발행하고 명시된 광역값만 남기며, 광역을 판정할 수 없으면 `[지역]`으로 바꾼다. 도로명, 번지, 건물, 동·호, 우편번호가 섞이거나 지역만인지 불확실하면 전체를 `address`로 발행해 가명 ID로 바꾼다. 같은 원문을 둘로 나누거나 `region`과 `address`로 중복 발행하지 않는다.

등록된 광역값이 대체값에도 그대로 남으면 `[지역]`으로 바꾼다. 예를 들어 등록값 `서울시 은평구`는 `서울시`, `서울시 은평구 샛길 123`은 가명 ID, `서울시`는 `[지역]`이다. 등록값 직접 치환이 일반 서술의 광역값 유지보다 우선하며, 코어의 원문 잔류 검사를 allowlist로 우회하지 않는다. 직접 치환은 원문 구간을 기준으로 하고 겹친 구간은 가장 긴 매칭의 대체값으로 한 번 덮는다. 동일 source의 상충 대체값이나 대체값이 다른 등록 원문을 포함하는 순환 사전은 거부한다. 출력값을 같은 pass에서 다시 원문으로 먹지 않는다.

가명 ID는 가입일, 사업 유형, 지역, 나이 같은 의미를 넣지 않는다. Agent가 대체한 뒤 코어는 Packet bytes를 다시 쓰지 않는다. 코어는 금고 값이 남아 있는지 detection-only로 검사하고, 남아 있으면 `registered_pii_detected`로 거부한다. 코어가 Packet을 다시 치환해 hash·offset을 바꾸는 동작은 금지한다.

Agent가 코어로 내보내는 것은 S5 결과 객체, 마스킹된 본문, 마스킹된 본문에서 뽑은 근거, 숫자형 감정 점수와 구조화된 품질 코드뿐이다. Agent는 원음, 미마스킹 전사, 감지된 원문·스팬, 복호화 PII, dictionary, 동의 원문·참조, provider 자격증명, `aiSummary`, `aiSchema`, `flagProposals`, `gasEvidence`를 제출하지 않는다. `evidenceQuote`는 마스킹된 본문에서만 가져온다.

### 2.5 준식별자 일반화 순서와 규칙

처리 순서는 직접 식별자 치환, NER span 치환, ISO·한국식 날짜 일반화, 명시 나이 일반화, 지역 일반화, 우편번호·주소 토큰화, 질환 사전·정규식 검사, hash 계산이다. 날짜 일반화가 generic account regex보다 먼저다.

| 입력 형태 | 결과 | 금지된 추론 |
|---|---|---|
| `YYYY-MM-DD`, `YYYY년 M월 D일` | 연·월만 남긴다. 예: `2026-09-03` → `2026-09` | 생일·사건의 의미나 날짜를 새로 부여하지 않음 |
| 명시된 `만 N세`, `N세`, `N살` | 5년 구간. 예: `37세` → `35-39세` | 생년월일에서 나이를 계산하거나 나이를 새로 만들지 않음 |
| 명시된 광역 지역과 하위 지역 | 광역 지역만 남긴다. 예: `서울시 은평구` → `서울시` | 지오코딩, 현재 위치 추정, 상세 지역 생성 금지 |
| 도로명·지번·건물·동·호·우편번호 | `[주소]` 또는 `[우편번호]` 전체 치환 | 건물명, 생활수준, 위치 추정 금지 |
| 상대 날짜와 이미 광역인 지역 | 원문 유지 | 절대 날짜나 상세 지역으로 확장하지 않음 |
| 성별, 직업, 소득, 질환, 가족관계의 명시값 | 이 스펙이 생성·변경하지 않음 | 다른 민감 사실을 추론하지 않음 |

등록된 생년월일·지역은 위 일반화보다 mask dictionary의 정확한 매칭을 먼저 적용한다. 날짜가 애매하거나 지역의 광역 단위를 판정할 수 없으면 전체 후보를 `[준식별자]` 또는 `[지역]`으로 치환한다. 모르는 값을 일반 범주로 꾸며내지 않는다.

### 2.6 코어의 전 재료 검증

코어는 provider 호출마다 requested material, counterpart material, historical material, derived-summary material을 모두 재조회한다. 하나라도 snapshot이 없거나, legacy 행이거나, 다음 필드 중 하나라도 없으면 전체 호출을 거부한다: pipeline version·hash, NER attestation ID·`ner_attestation_result_hash`, E5-4 release qualification receipt ID, evidence hash, material hash·type, 본문 hash, evidence 배열. trigger snapshot 하나만 통과했다고 나머지 재료를 신뢰하지 않는다.

각 재료마다 세션·기관·케이스 범위, opaque ID, 등록 PII detection-only 대조, 미가림 전화번호·주민번호·이메일·계좌·주소·인명 식별 패턴, 본문 hash, evidence hash·quote·code-point offset, 허용 pipeline 쌍, 만료되지 않은 install attestation과 E5-4 release qualification receipt를 검사한다. 하나라도 실패하면 전체 provider 요청을 만들지 않는다. `derived-summary`도 원문을 재조립하지 않고 저장된 마스킹 snapshot lineage만 참조한다.
코어의 독립 deterministic blocker는 NER와 별도로 전화번호·이메일·계좌형 숫자, 한국어 존칭이 붙은 인명 후보, 로마자 이름 후보, 도로명·지번·건물·동·호·우편번호 주소 syntax를 검사한다. 후보가 NER mask 또는 직접 치환으로 덮이지 않으면 내부 사유 `residual_identifier_candidate`로 분류하고 외부에는 `unmasked_identifier_detected`를 반환한다. 이 검사는 알려지지 않은 모든 이름을 증명하지 않으며, 잡히지 않은 잔여 위험은 R3에 따라 동의 고지에서 공개한다.

### 2.7 결과 시점 동의와 egress linearization

결과를 받은 시점에 코어는 현재 6영역 동의의 적용 행, `consentRevision`, `effectiveAt`, 철회 상태, 케이스·목적 연결을 다시 읽는다. claim 시점 grant나 오래된 evidence ID만으로 통과시키지 않는다.

provider 호출은 다음 DB 행으로 선형화한다. 이 행은 기관, job, claim, raw audio, 동의 revision, 호출할 모든 material hash, provider, 만료시각에 묶인다.

```ts
interface AzureEgressAuthorization {
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

interface OpenAiEgressAuthorization {
  egressAuthorizationId: string;
  tuple: {
    provider: 'openai';
    orgId: string;
    supportCaseId: string;
    sessionId: string;
    workItemId: string;
    actorId: string;
    operation: 'generate' | 'regenerate' | 'detect_discrepancies';
    materialHashes: string[]; // 정렬된 non-empty SHA-256 목록
    consentRevision: string;
  };
  status: 'authorized';
  expiresAt: string;
}

type EgressAuthorization = AzureEgressAuthorization | OpenAiEgressAuthorization;
```

`authorizeEgress`는 해당 tuple의 모든 값을 결과 시점에 확인하고 `status='authorized'`로 commit한다. `expiresAt`은 가능한 동의 `validUntil`, Azure job lease 만료시각, 5분 auth TTL 중 가장 이른 시각이다. Azure는 정확한 API `beginAzureEgress({ egressAuthorizationId, claimToken, attempt })`로, OpenAI는 정확한 API `beginOpenAiEgress({ egressAuthorizationId, actorId, operation })`로 `authorized → in_flight` CAS를 수행한다. 두 API 모두 저장된 work item에서 org·case·session·job·material hash·provider config와 현재 동의 revision·효력시각을 재검증한다. raw claim token은 인증 채널로 받아 서버가 hash해 tuple의 `claimTokenHash`와 비교하며, 성공 응답의 `state`는 반드시 `in_flight`다. 이 commit이 egress linearization point이고 성공 전에는 어떤 provider SDK·HTTP도 호출하지 않는다.

영속 record의 `status`는 `authorized | in_flight | completed | revoked | expired`다. 생성 응답은 `authorized`로 좁혀 반환하고, `beginAzureEgress`·`beginOpenAiEgress` 성공 응답만 `in_flight`다. 동의 철회 transaction은 같은 케이스 직렬화 경계에서 revision을 증가시키고 `authorized`를 `revoked`로 만든다. 철회 commit이 먼저면 CAS와 네트워크 시작이 모두 실패한다. `in_flight` commit이 먼저면 그 호출은 당시 이미 허가된 호출이므로 완료될 수 있지만, 철회 commit 뒤 새 `in_flight` 전이는 허용하지 않는다. 만료된 record는 `expired`로 바꾸며 다시 시작할 수 없다. 결과·counterpart·historical material 중 하나라도 바뀌면 새 authorization을 발급한다.

담당 실무자의 `regenerate`와 `detect_discrepancies`도 OpenAI tuple의 `operation`으로 구분한다. 두 작업 모두 provider 직전 현재 동의 revision과 전체 material hash를 다시 확인하므로, 상담사가 재생성하거나 불일치 검출을 시작하는 순간 동의 철회가 먼저 commit되면 OpenAI 호출은 0회다. 이미 `in_flight`가 된 호출만 완료할 수 있다.
## 3. 세 모드와 provider 호출 수
| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| mask dictionary·재검증 | 기관 소유 Supabase 코어와 금고, 기관 Agent | 암호화 SQLite 코어와 같은 PC Agent | 암호화 SQLite 코어와 사무실 Agent PC |
| NER health | Agent claim과 Azure STT 전에 확인 | Agent claim 전에 확인 | Agent claim 전에 확인 |
| OpenAI outbound | LLM enabled only, `generate`·`regenerate`·`detect_discrepancies` 모두 Packet과 JSON `store:false` | LLM enabled only, 같은 규칙 | LLM enabled only, 같은 규칙 |
| code·문구·hash·linearization | 동일 | 동일 | 동일 |

`AIProvider.generate`와 `AIProvider.detectDiscrepancies`는 일곱 code에서 항상 0회다. 유효한 G1~G3와 허가된 operation은 LLM이 켜진 경우에만 각 요청을 1회 보내며, 모든 OpenAI JSON에 `store:false`를 넣는다. LLM이 꺼진 Local Single·Local Office의 성공 fixture는 OpenAI 호출 0회다. STTProvider와 AIProvider를 구분한다. NER health, route, pipeline allowlist, 적용 동의가 Azure STT 전에 실패하면 Azure 0회이고 OpenAI 0회다. Azure가 이미 authorization되어 STT를 끝낸 뒤에만 알 수 있는 결과 검증 실패는 Azure 1회까지 허용하며, 그 경우에도 OpenAI는 0회이고 Azure 호출·목적·시각은 감사한다. Azure 호출이 이미 허가되어 끝난 뒤 동의 철회가 commit되어도 새 OpenAI 호출은 시작하지 않는다.

## 4. 일곱 fail-closed 계약

아래 code와 화면 문구는 ADR-0041 D81의 정본이며 문자 단위로 바꾸지 않는다. 실패 Packet은 provider 재료·초안으로 저장하지 않는다. `local_ner_unavailable`만 S5 release의 reprocessable infrastructure blocked 상태이며, 나머지 malformed 또는 revoked 결과는 S5의 해당 terminal·cancel 전이를 따른다.

| code | 발생 조건 | 화면 문구 | Azure STT | OpenAI |
|---|---|---|---:|---:|
| `masking_snapshot_missing` | 결과 시점에 유효 snapshot이 없거나 재료 중 하나가 누락 | 가림 처리 결과가 없어 AI 처리를 멈췄습니다. | 0 if pre-STT, 0 or 1 if post-STT | 0 |
| `local_ner_unavailable` | 고정 model·라벨 NER health attestation이 없거나 stale·불통과 | 이름과 주소 가림 기능을 사용할 수 없어 AI 처리를 멈췄습니다. | 0 | 0 |
| `registered_pii_detected` | mask dictionary의 등록값이 attested Packet bytes에 잔류 | 등록된 개인정보가 남아 있어 AI 처리를 멈췄습니다. | 0 if pre-STT, 0 or 1 if post-STT | 0 |
| `unmasked_identifier_detected` | 정규식·deterministic blocker 또는 식별자 검사에서 미가림 식별 정보나 `residual_identifier_candidate`가 발견 | 가려지지 않은 식별 정보가 감지되어 AI 처리를 멈췄습니다. | 0 if pre-STT, 0 or 1 if post-STT | 0 |
| `evidence_hash_mismatch` | 본문·material·근거·구간의 hash 검증 불일치 | 근거 확인값이 맞지 않아 AI 처리를 멈췄습니다. | 0 if pre-STT, 0 or 1 if post-STT | 0 |
| `masking_pipeline_version_mismatch` | version 또는 canonical manifest hash가 허용 쌍과 불일치 | 가림 처리 버전이 맞지 않아 AI 처리를 멈췄습니다. | 0 if pre-STT, 0 or 1 if post-STT | 0 |
| `consent_not_effective` | 결과 시점 동의가 없거나 철회·만료·목적·revision 불일치 | 현재 동의 상태로는 외부 AI 처리를 진행할 수 없습니다. | 0 if pre-STT, 0 or 1 if already authorized | 0 |

운영 로그는 정확히 `code`, `sessionIdHash`, `timestamp`만 구조화해 남긴다. 감지 문자열, 원문, `evidenceQuote`, PII 값, 위치, NER 출력, 동의 전문은 로그·예외 메시지·provider 요청에 넣지 않는다. 별도 append-only 감사 증거에는 snapshot ID, material type, pipeline version, attestation ID, 본문·material·evidence hash, provider·egress authorization ID와 호출 시각만 저장한다.

## 5. 완료 조건과 검증 방법

- [x] S5 `MaskedSource` 필드와 일치하는 Agent 결과, NER install attestation, E5-4 production release qualification receipt, 저장 증명과 모든 provider material 재검증 규칙이 완결되어 있다.
- [x] 직접 식별자 전 필드, 준식별자 일반화, 날짜·account regex precedence, 금지된 추론이 완결되어 있다.
- [x] 결과 시점 consent revision과 material hash에 묶인 egress linearization 및 withdrawal ordering이 완결되어 있다.
- [x] 일곱 code와 화면 문구가 ADR-0041과 문자 단위로 일치하고 OpenAI 호출 기대값이 모두 0이다.
- [x] NER model revision·labels, non-empty conversational corpus, corpus/result hash, precision·recall·overgeneralization threshold와 stale claim 규칙이 완결되어 있다.
- [x] G1부터 G10과 N health fixture가 literal source, vault row, output, offset, canonical hash, attestation, provider count를 갖는다.
- [x] 검증 명령과 실패 판정이 아래에 적혀 있다.

구현 검증 시 저장소 루트에서 다음을 실행한다.

```bash
(cd apps/pipeline && python3 -m unittest tests.test_masking tests.test_api_client_worker)
pnpm --filter @ccc/api exec vitest run test/privacy-packet.test.ts
pnpm --filter @ccc/api exec vitest run test/agent-privacy-linearization.test.ts
```

Expected: N corpus의 고정 model revision·라벨 실행 결과가 threshold를 통과하고, G1부터 G3은 정확한 output·offset·hash를 만든다. G4부터 G10은 표의 code를 반환하고 OpenAI 호출은 0회다. pre-STT fail은 Azure도 0회이고, post-STT fail은 Azure 1회 이하·감사 1건이며 OpenAI 0회다. withdrawal race는 DB winner에 따라 새 호출이 시작되지 않는다. 하나라도 다른 material이 검증되지 않거나, legacy field가 provider 요청에 들어가거나, 로그에 원문이 들어가면 실패다.

### 5.1 실제 설치 health corpus N2

정본 입력은 [`scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json`](../../scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json)이며 JCS UTF-8 SHA-256은 `35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59`다. 7항목, 인명 4개, 주소 4개, 두 범주가 없는 2항목으로 구성한다. 입력과 정답은 모델 추론 전 독립 검수하고 고정한다. 실행 보고서에는 decoder, aggregation, runtime, model revision과 측정값을 기록한다. 실패하면 같은 version의 입력이나 정답을 바꿔 재응시하지 않는다.

설치와 출시 corpus는 별도 CLI 실행 및 보고서로 남긴다. `scripts/privacy/qualify_ner.py --kind health --corpus scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json --expected-corpus-hash 35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59 --output <새-보고서-경로>`를 사용한다. 출력 경로는 기존 증거를 덮어쓰지 않는다. Mac에서는 모델 로드 직전 메모리를 점검하며 Windows STT 측정과 부하를 공유하지 않는다.

### 5.1.1 과거 N과 프로토콜 검증 literal

다음 N은 2026-09-06 실제 고정 모델에서 실패한 원래 입력이다. 원문과 hash 및 실패 보고서를 보존하며 N2의 실제 결과로 재표기하지 않는다.

N의 JCS UTF-8 원문은 다음과 같다. 이 문자열 자체의 SHA-256은 `10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5`다.

```json
[{"address":["테스트주소A"],"id":"p01","person":["테스트인명A"],"text":"테스트인명A가 테스트주소A에 왔다."},{"address":["테스트주소B"],"id":"p02","person":["테스트인명B"],"text":"테스트인명B님은 테스트주소B에서 상담했다."},{"address":["테스트주소C"],"id":"p03","person":["테스트인명C"],"text":"테스트인명C에게 테스트주소C로 안내했다."},{"address":[],"id":"p04","person":["테스트인명D"],"text":"테스트인명D가 다음 상담을 예약했다."},{"address":["테스트주소E"],"id":"p05","person":[],"text":"테스트주소E로 서류를 보냈다."},{"address":[],"id":"n01","person":[],"text":"오늘은 목표와 일정만 확인했다."},{"address":[],"id":"n02","person":[],"text":"다음 주에 다시 만나기로 했다."}]
```

정답 span은 `person`·`address` 배열의 문자열을 source에서 찾은 Unicode code-point 구간이다. 프로토콜의 가상 성공 metrics는 `{"addressPrecision":1,"addressRecall":1,"overgeneralizationRate":0,"personPrecision":1,"personRecall":1}`이며 hash는 `fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72`다. 이는 실제 모델이 그 span만 예측한다는 주장이 아니다. 실제 측정이 실패하면 이 literal로 attestation을 발행하거나 claim을 열지 않는다.

### 5.2 Literal golden fixtures G1부터 G10

이 절의 attestation과 manifest는 고정 프로토콜 fixture다. 모델을 stub으로 대체한 G2 통과나 가상 `status=passed`가 실제 NER 설치 또는 출시 자격 통과를 증명하지 않는다.

아래 모든 성공 Packet은 `nerAttestationId=ner-attest-s6-v1`, `nerAttestationResultHash=fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72`, `modelRevision=a308c54b4407819624a5661e31e162a269f39818`, `maskingPipelineVersion=ner-mask-v2`, `maskingPipelineHash=49d44dbc50067341ff4ec63c1d76bdbf49d6ee9d9a730dbb707c147259de77dd`를 사용한다. G1, G2, G3, G6, G7, G8, G9, G10의 `evidence`는 각각 아래에 적은 case ID, 본문 hash, 전체 본문 quote, `sourceStart=0`, 해당 표의 code-point 끝 offset을 갖는다. `materialHash`는 `maskedSha256`와 같다.
모든 fixture 실행 시각은 `now=2026-09-03T12:00:00Z`로 고정한다. 이 시각은 attestation `validatedAt=2026-09-03T00:00:00Z`, `expiresAt=2026-09-04T00:00:00Z` 사이에 있으므로 시간 경과로 G1~G3의 기대 결과가 달라지지 않는다.

health result의 canonical JCS JSON은 `{"addressPrecision":1,"addressRecall":1,"overgeneralizationRate":0,"personPrecision":1,"personRecall":1}`이고 SHA-256은 `fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72`다. `resultHash`는 자기 필드를 제외한 전체 health result object의 JCS UTF-8 bytes SHA-256이며 임의 상수가 아니다. Agent claim에 전달·저장하는 attestation projection은 아래 필드만 갖는다.

```json
{"id":"ner-attest-s6-v1","modelId":"FrameByFrame/korean-pii-e5-base","modelRevision":"a308c54b4407819624a5661e31e162a269f39818","labelSetHash":"b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc","corpusHash":"10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5","resultHash":"fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72","validatedAt":"2026-09-03T00:00:00Z","expiresAt":"2026-09-04T00:00:00Z","status":"passed"}
```

pipeline manifest의 canonical JCS JSON은 다음과 같고, `maskingPipelineHash`는 자기 hash 필드를 제외한 전체 manifest의 SHA-256인 `49d44dbc50067341ff4ec63c1d76bdbf49d6ee9d9a730dbb707c147259de77dd`다.

```json
{"conditionDictionaryVersion":"condition-dict-v1","directIdentifierRulesVersion":"direct-v1","labelSetHash":"b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc","maskingPipelineVersion":"ner-mask-v2","nerHealthCorpusHash":"10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5","nerHealthResultHash":"fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72","nerModelId":"FrameByFrame/korean-pii-e5-base","nerModelRevision":"a308c54b4407819624a5661e31e162a269f39818","quasiIdentifierRulesVersion":"quasi-v1","regexRulesVersion":"regex-v2","schemaVersion":1}
```

각 Packet의 실제 evidence 배열은 다음의 non-empty JSON objects다. G8부터 G10도 본문 hash와 quote는 아래처럼 고정하고, 표에 적은 제출값만 변조한다.

```json
{"id":"g1-ev-01","sourceRef":"g1","sourceSha256":"e82c1a66fdae5ed181fa1e84055518d800e76cde64fc84971e8f8dac96a31fec","evidenceQuote":"이름=swallow-003|전화=swallow-003|이메일=swallow-003|계좌=swallow-003|생일=[생년월]|지역=서울시|성별=[성별]|주소=swallow-003|긴급=swallow-003|당사자키=swallow-003|기관키=swallow-003","sourceStart":0,"sourceEnd":147}
{"id":"g2-ev-01","sourceRef":"g2","sourceSha256":"74e9f465f23b4d1a2c8eb284d54c8d180a4f860b39148635d8ab416d230d28ed","evidenceQuote":"오늘 [인명]가 [주소]에 왔다.","sourceStart":0,"sourceEnd":18}
{"id":"g3-ev-01","sourceRef":"g3","sourceSha256":"5b47d52082471b6328890e2d07d8d205a3d55894ca163c32380d07a442fde237","evidenceQuote":"2026-09에 35-39세인 당사자가 서울시에서 지난달 이사했다.","sourceStart":0,"sourceEnd":37}
{"id":"g6-ev-01","sourceRef":"g6","sourceSha256":"2f289c32580c2c6be4a1b6bd49cedc65e9ba6d94fb2f9920e4e320322fbb78b1","evidenceQuote":"이름=박하늘","sourceStart":0,"sourceEnd":6}
{"id":"g7-ev-01","sourceRef":"g7","sourceSha256":"1b99e002d25296a1fafbe1e3dc1c1cee3c70a5edeb34e0b86ac42d3288286bce","evidenceQuote":"연락처=010-5555-1212","sourceStart":0,"sourceEnd":17}
{"id":"g8-ev-01","sourceRef":"g8","sourceSha256":"16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3","evidenceQuote":"오늘 [인명]가 왔다.","sourceStart":0,"sourceEnd":12}
{"id":"g9-ev-01","sourceRef":"g9","sourceSha256":"16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3","evidenceQuote":"오늘 [인명]가 왔다.","sourceStart":0,"sourceEnd":12}
{"id":"g10-ev-01","sourceRef":"g10","sourceSha256":"16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3","evidenceQuote":"오늘 [인명]가 왔다.","sourceStart":0,"sourceEnd":12}
```

| case | vault row와 source | 정확한 `maskedText`, code-point offset | `maskedSha256` / `evidenceHash` | 기대 판정 |
|---|---|---|---|---|
| G1 | `{"name":"박하늘","phone":"010-5555-1212","email":"synthetic@example.test","account":"110-222-333333","birthDate":"1985-03-27","region":"서울특별시 은평구","gender":"여성","address":"서울특별시 은평구 통일로 1","emergencyContact":"010-5555-3434","beneficiaryId":"beneficiary-raw-7","organizationId":"org-raw-2"}`; source=`이름=박하늘|전화=010-5555-1212|이메일=synthetic@example.test|계좌=110-222-333333|생일=1985-03-27|지역=서울특별시 은평구|성별=여성|주소=서울특별시 은평구 통일로 1|긴급=010-5555-3434|당사자키=beneficiary-raw-7|기관키=org-raw-2` | `이름=swallow-003|전화=swallow-003|이메일=swallow-003|계좌=swallow-003|생일=[생년월]|지역=서울시|성별=[성별]|주소=swallow-003|긴급=swallow-003|당사자키=swallow-003|기관키=swallow-003`; whole quote offset `0..147` | `e82c1a66fdae5ed181fa1e84055518d800e76cde64fc84971e8f8dac96a31fec` / `23052267672721fa8b63bd29d3eb7544f89a4dd91bca9f9f8fc0e857847f9d2a` | provider 1회, 등록 필드 11종 원문 0건 |
| G2 | vault=`{"name":null,"phone":null,"email":null,"account":null,"birthDate":null,"region":null,"gender":null,"address":null,"emergencyContact":null,"beneficiaryId":null,"organizationId":null}`; source=`오늘 테스트인명A가 테스트주소A에 왔다.` | `오늘 [인명]가 [주소]에 왔다.`; whole quote `0..18` | `74e9f465f23b4d1a2c8eb284d54c8d180a4f860b39148635d8ab416d230d28ed` / `14f31cc51a226d169d93c0c5d23f56cffbf822e4926cb8fe3317d34decb53ba0` | provider 1회, NER 양성 원문 0건 |
| G3 | vault=G2와 동일; source=`2026-09-03에 37세인 당사자가 서울시 은평구에서 지난달 이사했다.` | `2026-09에 35-39세인 당사자가 서울시에서 지난달 이사했다.`; whole quote `0..37` | `5b47d52082471b6328890e2d07d8d205a3d55894ca163c32380d07a442fde237` / `a9b74b34cdbba5145d1290446074f4c3c07acdada8a1d5d87d2e1bdfbf89acec` | provider 1회, 날짜가 account token으로 바뀌지 않음 |
| G4 | vault=G2와 동일; source=`오늘 테스트인명A가 테스트주소A에 왔다.`; attestation=`{"nerAvailable":false,"nerAttestationId":null,"nerAttestationResultHash":null}` | Packet output 없음, offset·본문 hash·evidence hash 없음 | attestation은 pipeline manifest의 고정 hash를 사용할 수 없음 | `local_ner_unavailable`, release blocked·재처리 가능, Azure 0회, OpenAI 0회 |
| G5 | vault=G2와 동일; source=`null`; snapshot row 없음 | Packet output 없음, offset·hash 없음 | snapshot hash 없음 | `masking_snapshot_missing`, Azure 0회, OpenAI 0회 |
| G6 | vault=`{"name":"박하늘"}`; source=`이름=박하늘` | `이름=박하늘`; whole quote `0..6` | `2f289c32580c2c6be4a1b6bd49cedc65e9ba6d94fb2f9920e4e320322fbb78b1` / `9dee0ef4774c9302010670cab414c407ec8fb9f49349e5bf8fa7b2bba653f403` | `registered_pii_detected`, 코어는 bytes를 rewrite하지 않음, OpenAI 0회 |
| G7 | vault=G2와 동일; source=`연락처=010-5555-1212` | `연락처=010-5555-1212`; whole quote `0..17` | `1b99e002d25296a1fafbe1e3dc1c1cee3c70a5edeb34e0b86ac42d3288286bce` / `aec1ca15b89e8b5e69ee0e66296ac27bdb8da1df7d2f74ca8689cd4224ff6ccf` | `unmasked_identifier_detected`, OpenAI 0회 |
| G8 | vault=G2와 동일; source=`오늘 [인명]가 왔다.`; 제출 `evidenceHash=0000000000000000000000000000000000000000000000000000000000000000` | `오늘 [인명]가 왔다.`; whole quote `0..12` | `16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3` / 실제 `8bc73629b620af8090f2505018b781c57f1bdba258de5a4043cfd317bb5b3188`, 제출값은 0 hash | `evidence_hash_mismatch`, OpenAI 0회 |
| G9 | vault=G2와 동일; source=`오늘 [인명]가 왔다.`; 제출 `maskingPipelineVersion=ner-mask-v1`, `maskingPipelineHash=0000000000000000000000000000000000000000000000000000000000000000` | `오늘 [인명]가 왔다.`; whole quote `0..12` | `16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3` / `82377232754393e4502c1f9384b3cf0bd51be347537026b385d16ce0a362e0d0` | `masking_pipeline_version_mismatch`, OpenAI 0회 |
| G10 | vault=G2와 동일; source=`오늘 [인명]가 왔다.`; 본문과 material hash만 G8과 같으며 evidenceHash는 G10 자신의 evidence 배열에서 계산한다. current consent=`consentRevision=r2`, authorization input=`r1` | `오늘 [인명]가 왔다.`; whole quote `0..12` | `16af949c7b2aaf144a998e0ff09d6056b004ecd4f34f1e08d81df6ec42f0f4f3` / `dd8745358e84f15b5894ee01bf2f7ff67f89760b7589f8ceef76cdbe1a2ae61d` | `consent_not_effective`, authorization CAS 실패, OpenAI 0회 |
G10의 동일한 literal Packet으로 다음 OpenAI race를 각각 독립 실행한다. `generate`, `regenerate`, `detect_discrepancies` 모두 `beginOpenAiEgress` 직전에 withdrawal이 commit되면 `consent_not_effective`, OpenAI 0회다. `validUntil=2026-09-03T11:59:59Z`, fixture `now=2026-09-03T12:00:00Z`인 자연 만료 변형도 `consent_not_effective`, OpenAI 0회다. withdrawal 또는 자연 만료가 먼저 commit된 authorization은 `in_flight`로 바뀌지 않는다.
G1~G3의 OpenAI request JSON과 `generate`·`regenerate`·`detect_discrepancies` operation race의 허가된 요청은 모두 `store:false`를 포함한다. LLM이 꺼진 Local 성공 flow는 호출 없이 수기 경로를 사용한다.

G1의 11개 등록 필드는 이름, 전화번호, 이메일, 계좌번호, 생년월일, 거주지역, 성별, 정확한 주소, 긴급연락처, 당사자 내부 ID, 기관 내부 ID다. 구현 테스트는 이 행을 하나의 통합 case로만 세지 않고 각 필드를 하나씩 남긴 변형도 독립 실행해 `registered_pii_detected`와 OpenAI 0회를 확인한다. G6도 같은 방식으로 각 필드별 잔류를 독립 실행한다.
실제 gateway 발행은 `enc_region`에 지역을 넣은 경우와 상세 주소를 넣은 경우를 별도로 검사해 11개 의미 범주를 모두 다룬다. 단일 실제 행에서 주소와 지역을 독립적으로 동시에 저장한다고 가정하거나 entries 11개 발행을 성공 기준으로 만들지 않는다.

### 5.3 Dictionary 재전송과 메모리 폐기 검증

합성 등록값을 사용해 최초 발급과 별도 모듈 상태에서의 동일 응답 재생, 동시 발급 CAS, 등록값 변경, 키/ID/만료 변조와 서명 중 만료를 확인한다. 재전송의 성공·거부 조건은 S5 §2.1이 정본이다. Agent의 다른 job, 만료, `oneTime` 오류와 잠금 실패는 결과 제출 없이 닫혀야 한다. text 경로는 STT 0회이고, post-STT audio dictionary 실패는 이미 수행한 STT 1회 이하와 OpenAI 0회를 구분한다.

제어 가능한 메모리는 정상·예외 종료의 실제 bytes를 관찰하고, OS 잠금 실패에서는 원문을 읽지 않는지 확인한다. 소유 버퍼, parser 복사본, immutable 문자열, 모델/TLS 내부와 호스트 저장 정책을 나누어 기록한다. native 버퍼 단독 PASS나 mocked NER 회귀는 전체 메모리 폐기 또는 NER qualification PASS를 대신하지 않는다. N과 G1~G10의 정답, 모델 revision 및 hash는 이 검증 때문에 바꾸지 않는다.

## 6. 이번에 안 하는 것

NER 모델의 학습·정확도 개선과 STT 품질 비교는 E5-4의 health corpus 실행과 STT-G1~G3의 소유다. 동의 6영역의 법률 문안, 사건 schema와 notice hash는 SG7이 정하며 S6는 현재 revision·효력·목적 판정 결과만 소비한다. OpenAI prompt·출력 schema, 장문 청크 분할·병합은 ADR-0036과 S15가 소유한다. snapshot 저장 필드의 migration과 parity는 E5-5가 소유한다. 실제 Agent·Cloud·Local adapter, Azure 호출과 AudioStore 수명은 E5-1a, E5-1b, E5-3, E6~E8이 소유한다. 이 범위를 이유로 `확정`을 미루지 않는다.
