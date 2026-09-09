# CCC-237 Privacy Generalization Implementation Plan

> **2026-09-06 승인 실행 기록.** N2, G10, P4 정정과 일반화 구현 뒤, Q의 “진행”으로 고정 모델의 BIOES 디코더 교정 및 동일 자료 재측정도 수행했다. 정답과 통과 기준은 유지했다. 병합, 배포, AI/STT 활성화와 모델 교체는 승인 범위가 아니다.

**Goal:** 기존 처리 Agent에 S6 준식별자 일반화를 연결하고, 실제 고정 모델 측정과 근거 해시로 E5-4의 완료 여부를 판정한다.

**Architecture:** `masking.py`의 기존 계층과 `worker.py`의 dictionary 소비 경로를 재사용한다. 결과는 `results.py`의 S5 본문, evidence, payload 해시를 그대로 사용한다. 서버 변경은 claim-bound dictionary 발행에 필요한 기존 gateway 범위만 다루고, snapshot migration과 provider authorization은 E5-5에 남긴다.

**Tech Stack:** Python 표준 라이브러리, 기존 transformers 4.53.3, 고정 Hugging Face model revision, TypeScript gateway와 기존 unittest/Vitest.

**Spec:** [S6 Privacy Packet](../../specs/S6-privacy-packet.md), [S5 Agent 작업 계약 v2](../../specs/S5-agent-job-contract-v2.md), [master plan E5-4](../../../CCC_OPEN_PILOT_PLAN.md).

## 상태와 작업 경계

- 이해한 요청: Windows STT 측정을 보존하면서 독립된 Mac 작업 공간에서 E5-4 전체 범위를 구현하고 실제 실패를 숨기지 않는다. 프로세스 수명 변경은 범위나 승인 변경이 아니다.
- 작업 위치는 `.worktrees/e5-4-privacy-generalization`, 브랜치는 `e5-4-privacy-generalization`이다. 2026-09-06 검증 시 HEAD는 `99d7b41cd71713aa6cb7bfcc684d033582409781`이며 이번 코드, 테스트, S5/S6 문서와 증거는 **미커밋 변경**이다. 시작 당시의 clean/behind-ahead `0/0`을 현재 상태로 읽지 않는다. 커밋, 병합, 배포는 하지 않았다.
- [CCC-237](https://linear.app/bss-ccc/issue/CCC-237)의 유일한 blocker [CCC-167](https://linear.app/bss-ccc/issue/CCC-167)은 Done이다. CCC-237은 In Progress이며 완료 처리하지 않았다.
- 이전 N의 원문과 실패 증거, 고정 모델은 보존한다. N2, G10과 주소 분류는 후속 승인으로 적용했으며, N2와 출시 실측 실패도 그대로 남긴다.
- 같은 claim 재전송과 동일 표 재생성 검증, 제어 가능한 메모리 보호를 구현했다. 이후 N2, G10, 주소 분류 및 전체 일반화를 승인받아 실행했다. 물리적 폐기 요구를 논리적 참조 제거로 낮추지는 않았다.

| 항목 | 승인 상태 | 현재 결과 |
|---|---|---|
| 같은 claim 재전송과 동일 표 검증 | 승인 | 구현 및 회귀 통과 |
| 제어 가능한 원문 버퍼의 잠금과 덮어쓰기 | 승인 | Mac의 실제 잠금 및 실패 차단 확인 |
| 고정 NER 모델 유지 | 유지 확정 | N2와 출시 corpus 실측 모두 FAIL |
| N2 설치 health corpus, G10 hash, 주소 분류 정정 | 후속 승인 | 적용 및 검증 완료 |
| whole-process zeroization | 완료 보장 아님 | 미통과, Windows/Cloud 호스트 미측정 |
| 출시 qualification corpus | 후속 승인 | 601항목, genuine negative 201항목을 추론 전 고정하고 실측 FAIL |
| BIOES 디코더 교정과 동일 자료 재측정 | 후속 진행 승인 | `ner-mask-v3`, 인명 검출 개선, N2/출시 판정은 FAIL |

**현재 판정:** 승인된 디코더 교정과 동일 자료 재측정까지 수행했다. N2의 인명 4개는 정확히 잡지만 주소는 미통과이며, 출시 기준도 넘지 못했다. 전체 원문 물리적 폐기 관문도 미통과이므로 CCC-237은 In Progress다. 추가 모델/정답/판정 규칙 변경은 이번 승인에 포함되지 않는다.

### 2026-09-06 추가 승인 실행 기록

P1의 N2 literal, P3의 G10 정정, P4의 보수적 분류는 후속 승인으로 적용했다. 기존 N의 실패 보고서를 보존하고 N2와 출시 corpus를 추론 전에 독립 검수했다. 모델과 정답을 바꾸지 않고 실제 실패를 남겼으며, 전체 원문 폐기는 기존 미통과 관문으로 유지한다.

작업은 시작 기준 `99d7b41`, 지정 worktree에서 진행했으며 시작 때 upstream 차이는 `0/0`이었다. 현재 결과는 미커밋 변경이다. 이전 재전송/메모리 변경을 보존하고, 일반화, gateway, 측정 도구/corpus를 파일별로 나눠 구현했다. 검증과 통합은 부모 세션이 수행했다.

### 승인된 재전송과 메모리 강화 실행 범위

- 서버 구현: `packages/core/src/gateway.ts`의 기존 opaque `dictionaryId`에 `md1.<HMAC-SHA-256>`을 보존한다. 키는 기존 `PII_ENC_KEY`에서 HKDF-SHA-256으로 용도를 분리한다. JCS entries와 org/service/job/claim hash/attempt/만료를 인증하고 WebCrypto verify로 대조한다. 원문 cache/table, 새 secret과 DB 컬럼은 추가하지 않았다.
- 재전송은 모듈 상태가 없어도 같은 표와 응답을 반환한다. 등록값/키/metadata가 달라지거나 서명 도중 만료되면 거부한다. 동시 발급은 DB CAS 승자의 응답으로 수렴하며 반환 전 live claim을 재검사한다. 직접 소유한 crypto writable bytes는 `finally`에서 덮어쓴다.
- Agent 구현: `api_client.py`, `worker.py`, `secure_memory.py`. 사전과 source 응답은 잠긴 anonymous mmap으로 읽고, mmap과 parser용 bytearray를 덮어쓴다. 잠금 실패는 원문을 읽기 전에 거부한다. POSIX는 `mlock`, Windows 코드는 `VirtualLock`을 사용하되 이번 실측은 Mac뿐이다. JSON 오류/HTTPError의 원문 보유와 작업 소유 참조도 정리한다.
- 실제 회귀에서 등록값 변경 후 잘못된 재전송, HTTP 오류의 원문 노출/응답 보유, 서명 중 만료된 응답 반환, 잠금 실패 뒤 계속 읽기를 먼저 실패로 확인했다. 수정 뒤 관련 회귀와 로컬 HTTP/native smoke가 통과했다. 수치와 재현 경계는 마지막 실행 증거에 기록한다.
- 금고 복호화 → 응답 직렬화/TLS → Agent 수신/JSON → 직접 치환/NER → 결과를 조사했다. parser bytearray는 덮어쓰지만 page-locked가 아니며 JS/Python 문자열과 모델/TLS 내부 복사본의 물리적 폐기는 증명하지 못했다. Mac의 FileVault/암호화 스왑은 켜져 있고 최대절전 저장도 켜져 있다. 전체 메모리 폐기 관문은 **미통과**다.
- 최초 재전송/메모리 작업은 S5/S6의 해당 경계만 갱신했다. 이후 승인된 N2, G10, 주소 분류와 실측 결과는 아래 실행 기록을 따른다. 모델/호스트 정책/Windows/배포는 변경하지 않았고, 잠금 실패 주입은 임시 프로세스의 soft limit만 낮췄다가 복원했다.

## Global Constraints

- S6 §2.5 순서는 직접 식별자 치환 → NER → ISO/한국식 날짜 → 명시 나이 → 지역 → 주소/우편번호 → 기존 질환 사전/정규식 → hash다.
- 모델은 `FrameByFrame/korean-pii-e5-base`, revision은 `a308c54b4407819624a5661e31e162a269f39818`이다. `PRIVATE_PERSON`, `PRIVATE_ADDRESS`만 해당 NER 검증의 정답 label이다. 자동 모델 교체와 학습은 하지 않는다.
- 실제 manifest는 S6 §2.3의 `direct-v2` 구성과 실제 N2 hash를 사용한다. §5.2의 `49d44dbc50067341ff4ec63c1d76bdbf49d6ee9d9a730dbb707c147259de77dd`는 과거 protocol fixture다. 실제 N2가 실패했으므로 passing manifest나 증명을 발행하지 않는다.
- 설치 health와 출시 qualification은 독립 판정이다. 출시 corpus는 최소 500개, hard negative는 최소 200개다. label별 Wilson 95% lower precision/recall `>= 0.90`, overgeneralization Wilson 95% upper `<= 0.05`를 모두 요구한다.
- 정답은 모델 예측을 보기 전에 고정한다. 모델 출력으로 정답을 만들거나 사후 수정하지 않는다. 실패 데이터와 hash를 보존한다.
- dictionary는 메모리에서만 사용하며, 원문과 자격증명을 파일, 로그, 결과에 남기지 않는다. Python immutable 문자열의 참조 해제와 물리적 메모리 zeroization은 같은 보장이 아니므로 구분한다.
- UI, CSS, 디자인 문서/토큰/guard와 preview는 `design-adjustments` 소유다. 이 작업에서 수정하지 않는다.
- `work-a`, Windows/WSL, STT 측정 작업과 모델 선택을 변경하지 않는다. Mac에서도 모델 로드 전 메모리를 확인한다.
- merge, 배포, STT/AI 활성화, 실당사자 데이터 접근, E5-5 snapshot migration 및 provider authorization 변경을 하지 않는다.
- 기존 테스트를 삭제하거나 skip하거나 assertion을 약화하지 않는다. 계약 변경 때문에 기대값 수정이 필요하면 먼저 계약 결정을 기록한다.

## 착수 전 기준과 이후 구현 지점

| 경로 | 착수 전 상태 | 이후 수행한 변경/검증 |
|---|---|---|
| `apps/pipeline/ccc_pipeline/masking.py:mask_text_with_report` | NER 다음 질환/정규식만 실행한다. G3 날짜가 계좌 토큰으로 바뀌는 현상을 실행으로 확인했다. | 같은 함수에 S6 순서대로 준식별자 처리를 삽입한다. |
| `masking.py:build_person_and_address_ner`, `_span_fn` | registry revision을 고정하고 transformers `simple` aggregation 결과에서 label prefix를 고른다. | 모델 선택을 유지하고 실제 span/label 출력을 검증한다. health 실패를 성공으로 보정하지 않는다. |
| `worker.py:_mask_with_dictionary` | `entries`를 순서대로 `str.replace`한다. expiry와 job binding을 확인하지 않고 명시적으로 정리하지 않는다. | 긴 겹침 값 우선, 재치환 방지, dictionary 유효성, 실패 시 정리를 구현한다. |
| `worker.py:masking_pipeline_version`, `masking_pipeline_hash` | v1 구성 문자열과 임시 manifest를 사용한다. | S6의 canonical manifest를 검증된 구성에서만 사용한다. |
| `worker.py:process_text_job`, `process_audio_job` | 두 경로가 같은 `_mask_with_dictionary`와 `build_result`를 거친다. | 두 경로를 함께 검증하고 NER 실패 시 result 대신 blocked release를 유지한다. |
| `results.py:build_result`, `build_result_request` | 마스킹 본문 전체에서 code-point offset과 해시 3종을 만든다. | 재구현하지 않는다. 일반화 뒤 본문만 전달되는지 검증한다. |
| `packages/core/src/gateway.ts:issueAgentJobMaskDictionary` | 등록값 4종(name/phone/account/email)만 발행한다. 같은 claim은 TTL 동안 재발행한다. | 계약 결정 뒤 등록 필드와 발행/감사 규칙을 보완한다. |
| `gateway.ts:readIntakeExtendedPii` | birthDate/region/emergencyContact/gender의 기존 암호문을 읽는다. | 별도 복호화 경로를 만들지 않고 이 경계를 재사용한다. |

LSP 상태 조회 결과 이 작업 공간에는 서버가 설정되어 있지 않다. 이에 따라 `apps`, `packages`, `scripts`에서 함수 이름으로 호출부를 대조했다. dictionary의 HTTP 호출부는 `packages/http-api/src/request-handler.ts`, 기존 회귀는 `apps/api/test/agent-job-contract.test.ts`다. Python의 변경 대상 호출부는 두 worker 경로와 기존 masking/worker/results 테스트다.

## 계약 문제와 해소 결과

### B1. 보존: 이전 설치 health N의 실제 실패

S6 §5.1 원문에서 corpus를 그대로 읽고 corpus hash를 대조한 뒤, 고정 revision을 CPU에서 실행했다. truth는 S6가 이미 고정한 문자열의 code-point 구간이다. 예측을 보기 전에 존재한 정답이며 모델에 정답 label을 입력하지 않았다.

| label | TP | FP | FN | precision | recall |
|---|---:|---:|---:|---:|---:|
| PRIVATE_PERSON | 0 | 2 | 4 | 0 | 0 |
| PRIVATE_ADDRESS | 0 | 0 | 4 | 정의되지 않음 | 0 |

Overgeneralization rate는 1이다. 분모가 0인 주소 precision은 1로 채우지 않고 null로 기록했다. S6 기대값은 각 label TP=4, FP=FN=0이므로 FAIL이다. 현재 경로에서 인명으로 잡힌 두 예측도 gold 전체 span과 일치하지 않는다. 이 결과만으로 다른 inference decoding의 성능이나 모든 환경의 모델 성능을 단정하지 않는다.

- corpus hash: `10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5`
- 실제 metrics result hash: `b594076074c464097985232ffc9c62836ade984edc040979289158c9705460c3`
- S6가 요구하는 passing metrics hash: `fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72`
- 증거: [실행 가능한 probe](../../../artifacts/ccc237-privacy/health-probe.py), [실제 측정 결과](../../../artifacts/ccc237-privacy/install-health.json).
- Q 결정: 고정 모델을 유지한 S6 정정안을 검토한다. 예측을 보고 정답을 바꾸거나 passing hash를 하드코딩하는 방식은 선택지가 아니다.

### B2. 해소: 사전 재전송과 감사 이름을 S5로 통일

- 변경 전 S6는 첫 성공 fetch 뒤 재사용 금지와 `deliver_mask_dictionary` 감사를 요구해 S5와 충돌했다.
- Q는 **S5의 같은 claim 재전송을 정본으로 승인**했다. S5/S6는 같은 claim/attempt의 응답 유실 재전송과 `mask_dictionary_read`로 통일했다.
- 변경 전 gateway는 매번 vault를 다시 읽어 등록값 변경 시 동일 표를 보장하지 못했다. 현재는 최초 발행한 opaque ID의 keyed verifier와 재생성한 표를 대조하며 값이 달라지면 거부한다. 서버 raw cache나 raw DB 표는 추가하지 않았다.
- 재시작 후 동일 응답, 값 및 인증 메타데이터 변조, 만료, 동시 최초 발행을 회귀로 확인했다. 전체 메모리 폐기 보장을 뜻하지 않는다.

### B3. 해소: G10 evidence hash literal 정정

변경 전 S6 §5.2 G10 표의 evidence hash는 65자리였다. 별도 evidence JSON 배열을 canonical 직렬화한 실제 SHA-256은 64자리 `dd8745358e84f15b5894ee01bf2f7ff67f89760b7589f8ceef76cdbe1a2ae61d`다. Q 승인으로 이 값과 G8 비교 문구를 정정했다.

Python 계산과 별도로 JavaScript canonical JSON 및 code-point 계산으로 재검증했다. 측정 보고서, metrics, 실행 script의 hash도 모두 일치했다. 원문을 넣지 않은 결과는 [계약 무결성 증거](../../../artifacts/ccc237-privacy/contract-integrity.json)에 보존한다.

G10은 E5-5의 consent 검증 fixture다. 정본 literal만 정정했으며 E5-5의 구현, snapshot 또는 provider 권한을 변경하지 않았다.

### B4. 해소: 기존 주소/지역 입력으로 11종 의미 범주 처리

기존 네 필드에 extended PII의 생년월일/지역/긴급연락처/성별과 claim scope의 당사자/기관 ID를 연결했다. [PRD §1-1](../../../PRD/intake-questionnaire-v1.md)의 **주소 또는 거주지역**은 기존 `region`/`enc_region`을 한 번 분류한다. 지역만이면 명시된 광역값 또는 `[지역]`, 상세 주소나 불확실한 값이면 전체 가명 처리한다. 새 UI, 컬럼, migration은 없다.

## Q가 승인한 S6 정정안

모델 유지, N2 literal, G10 hash와 P4 분류를 승인받아 적용했다. P2는 동일 표 재생성 검증으로 구현했으며, 물리적 폐기 보장은 낮추지 않았다.

### P1. 실제 NER 입력과 프로토콜 fixture를 구분한다

현 N의 positive 정답은 `테스트인명A`와 `테스트주소A` 같은 표식이다. 실제 모델이 표식을 정확히 인식한다는 passing literal이 현재 측정과 맞지 않는다. 실패 원인 전체를 표식 탓으로 확정하지 않으며, 자연어 형태의 새 입력도 통과한다고 예단하지 않는다.

**S6 §2.2, §5.1, §5.2에 적용한 정정**

1. 기존 N 원문, hash와 실제 실패 보고서는 수정하지 않고 이전 측정 증거로 보존한다. 기존 G1~G10의 synthetic Packet 검증은 유지하지만, 그 안의 가상 passing attestation을 실제 모델 통과 증거로 사용하지 않는다.
2. 실제 설치 health 입력은 새 버전 `s6-ner-health-ko-conversation-v2`인 아래 N2다. 전부 독립적으로 구성한 합성 이름과 주소이며, 실당사자 자료나 모델 출력에서 가져오지 않았다. 실제 주소 존재 여부를 조회하거나 특정인과 연결하지 않았다.
3. 모델, revision, label set, exact span 채점, 분모 0 실패와 수치 기준은 바꾸지 않는다. 실행 시 decoder/aggregation/runtime 버전을 보고서에 기록한다. gold에 맞춰 span을 늘이거나 사전 치환한 결과를 NER 예측으로 세지 않는다.
4. 아래 literal을 모델에 넣기 전에 독립 검수하고 hash를 고정했다. N2도 실패했으며 같은 버전의 정답을 고쳐 재응시하지 않았다.
5. 설치 health와 출시 corpus는 별도다. 실제 측정 결과와 정본을 기록하되, E5-5의 소비 경계는 이 작업에서 바꾸지 않는다. 기존 allowlist를 넓히거나 passing attestation/receipt를 발행하지 않았다.

**N2: 7항목, 인명 4개, 주소 4개, 인명/주소가 없는 항목 2개. 실측 결과는 FAIL이다.**

```json
[
  {"id":"p01","text":"김도윤 씨는 서울특별시 은평구 늘봄로 123에 거주한다고 말했다.","person":["김도윤"],"address":["서울특별시 은평구 늘봄로 123"]},
  {"id":"p02","text":"박서연 님에게 부산광역시 해운대구 푸른길 45로 서류를 보내도 되는지 물었다.","person":["박서연"],"address":["부산광역시 해운대구 푸른길 45"]},
  {"id":"p03","text":"이하준 씨가 대전광역시 서구 솔빛로 67에서 출발했다고 말했다.","person":["이하준"],"address":["대전광역시 서구 솔빛로 67"]},
  {"id":"p04","text":"최지우 씨는 다음 상담 일정을 확인했다.","person":["최지우"],"address":[]},
  {"id":"p05","text":"서류를 경기도 수원시 팔달구 새봄길 89로 보내기로 했다.","person":[],"address":["경기도 수원시 팔달구 새봄길 89"]},
  {"id":"n01","text":"오늘은 목표와 일정만 확인했다.","person":[],"address":[]},
  {"id":"n02","text":"다음 주에 다시 만나기로 했다.","person":[],"address":[]}
]
```

JCS UTF-8 corpus hash는 `35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59`다. 이 값은 **입력 hash**이지 측정 result hash가 아니다. 모든 정답은 해당 문장에 정확히 한 번 존재하며 code-point 구간을 계산할 수 있다.

Python과 JavaScript로 독립 계산한 hash, 정답 개수와 구간은 [후보 무결성 증거](../../../artifacts/ccc237-privacy/correction-proposal-integrity.json)에 보존했다. 이는 구조 검증이며 NER 통과 판정이 아니다.

### P2. 일회성은 claim 단위이며 전송 횟수가 아니다

**S6 §2.4 정정 문안 제안**

> 일회성 mask dictionary는 S5 §2.1과 F8의 하나의 service/org/job/claim/attempt에 귀속된다. 같은 tuple의 응답 유실 재전송은 live claim과 최대 5분 TTL 안에서만 허용하며, 성공 응답의 logical dictionary ID, expiry, entries와 직렬화 본문은 처음과 같아야 한다. 재전송으로 TTL을 연장하거나 금고를 다시 읽어 새 값을 같은 ID로 발행하지 않는다. 다른 service/org/job/claim/attempt, 만료, 취소 또는 terminal 상태에서는 재생하지 않는다. 모든 응답은 `Cache-Control: no-store`이며 값과 credential을 로그, 파일, 결과 또는 provider 요청에 기록하지 않는다.

감사 이름은 기존 S5의 `mask_dictionary_read` 하나로 통일한다. 최초 전달과 재전송 모두 D14에 따라 감사하며, detail에는 원문 없이 기존 범위의 ID/건수/재전송 여부만 남긴다. `deliver_mask_dictionary`를 병렬 이름이나 alias로 남기지 않는다.

**승인된 실행 경계**

- 서버 메모리에 원문 표를 유지하는 대신, 최초 응답의 확인값을 서버 비밀키로 인증한다. 동일 claim과 만료 시각을 사용해 재생성한 내용이 일치하면 서버 재시작과 무관하게 같은 응답을 반환한다. 확인할 수 없는 기존 ID, 등록값 변경 또는 키 불일치는 `dictionary_already_consumed`로 거부하며 같은 ID 아래 새 표를 내보내지 않는다.
- 같은 ID/만료를 얻는 동시 최초 요청은 DB의 기존 CAS 경계로 직렬화하고, 실패한 경쟁 요청은 이긴 발행값을 재조회·검증한다. 임의 재시도 루프나 process-local cache는 추가하지 않는다.
- 거부를 NER 또는 STT 장애로 바꾸지 않는다. 아직 live인 작업은 `outcome='permanent', reason='masking_failed'`로 한 번 종료한다. text의 STT는 0회이며 post-STT audio 실패에서는 이미 실행된 STT 최대 1회, OpenAI/result 제출은 0회다. 재생성 실패 때문에 STT를 재시도하지 않는다.
- 폐기 보장 자체를 낮추지 않는다. 직접 관리하는 원문 버퍼의 덮어쓰기, 원문을 보유한 오류/작업 참조의 정리와 디스크 유출 방지 조건을 구현·검증한다. 런타임/모델/운영체제 전체 복사본의 물리적 폐기는 별도 미통과 또는 미측정 관문으로 남긴다.

### P3. G10의 hash와 잘못된 비교 문구를 정정한다

S6 §5.2 G10 표의 65자리 evidence hash를 `dd8745358e84f15b5894ee01bf2f7ff67f89760b7589f8ceef76cdbe1a2ae61d`로 바꾼다. 같은 행의 “유효 Packet hash는 G8과 같다”도 “본문과 material hash만 G8과 같으며, evidenceHash는 G10 자신의 evidence 배열에서 계산한 위 값이다”로 정정한다. G8은 의도한 제출값 0 hash를 유지하고 실제 evidence hash `8bc73629b620af8090f2505018b781c57f1bdba258de5a4043cfd317bb5b3188`도 바꾸지 않는다.

G10의 evidence 객체, 본문, offset, consent revision race, expected `consent_not_effective`와 OpenAI 0회는 바꾸지 않는다. G8의 잘못된 제출값이나 다른 evidence 배열의 hash를 G10에 복사해 evidence 검증에서 먼저 실패하는 일을 막는 정정이며, assertion 삭제나 consent 검증 완화가 아니다.

### P4. 저장 필드 하나에서 주소와 거주지역을 구분한다

S6 §2.4와 G1/G6의 11종은 **의미 범주**이지 필수 DB 컬럼 11개가 아니다. 기존 `enc_region`의 비어 있지 않은 전체 값을 가져와 한 번만 분류한다. 등록값을 둘로 분해하거나 두 field에 같은 sourceValue와 다른 replacement를 중복 발행하지 않는다.

- 행정구역명으로만 구성된 값은 `region`이다. 명시된 광역값만 남기며 판정할 수 없으면 `[지역]`으로 치환한다. 도로명, 번지, 건물, 동·호, 우편번호가 섞였거나 지역만인지 확신할 수 없는 값은 전체를 `address`로 보고 가명 ID로 치환한다. 지오코딩이나 주소 완성은 하지 않는다.
- 등록된 값이 이미 광역값이어서 replacement와 같다면 `[지역]`으로 치환한다. S6 §2.4의 원래 등록값 잔류 금지와 §2.5의 광역값 유지가 충돌하지 않도록 **등록값 직접 치환을 우선**하는 정정이다. 등록되지 않은 일반 서술의 광역 지역은 기존 §2.5대로 유지한다. 코어의 원문 잔류 검사를 전역 allowlist로 우회하지 않는다.
- 예: 등록값 `서울시 은평구`는 `region`/`서울시`, 등록값 `서울시 은평구 샛길 123`은 `address`/가명 ID다. 등록값 `서울시`는 `region`/`[지역]`이다. 이 분류는 일반 NER의 학습이나 예측 보정이 아니다.
- G1의 11종 합성 dictionary 소비와 G6의 필드별 잔류 거부 검증은 그대로 유지한다. 실제 서버 발행은 **지역 입력과 상세 주소 입력을 별도 사례로** 검증해 11개 의미 범주 전체를 다룬다. 실제 한 행이 주소와 지역을 독립적으로 모두 저장한다고 가정하거나 11개 entries 발행을 성공 기준으로 만들지 않는다.

### 승인 범위의 종료 경계

N2와 release 모두 실제 측정을 완료했지만 FAIL이다. 모델, revision, labels, decoder와 정답은 바꾸지 않았다. E5-5 snapshot/egress는 소유 범위 밖이며, 전체 물리적 폐기도 통과로 바꾸지 않는다.

## 구현 단계

### Task 1: 직접 치환과 준식별자 일반화

**Files:** `apps/pipeline/ccc_pipeline/masking.py`, `worker.py`, `apps/pipeline/tests/test_masking.py`, `test_api_client_worker.py`.

**Consumes:** S6 §2.4 dictionary entries와 §2.5 순서, 기존 `NerFn`과 `MaskingReport`.
**Produces:** 기존 `mask_text_with_report(...) -> tuple[str, MaskingReport]`와 `_mask_with_dictionary(...)` 경로의 최종 마스킹 본문. 새로운 병렬 masking API는 만들지 않는다.

- [X] G1의 11종 dictionary, 겹치는 지역/주소, 잘못된 source와 상충 replacement를 회귀로 고정했다.
- [X] 직접 치환은 원문 구간을 한 번만 덮으며 긴 매칭을 우선한다. 대체값 재검색과 등록값 재잔류는 거부한다.
- [X] G3 본문, code-point 끝 37, 본문/evidence hash를 검증했다.
- [X] 한국식/ISO 날짜의 유효성을 검사하고 연월로 일반화한다. 상대 날짜는 보존하고 모호한 후보는 가린다.
- [X] 명시 나이만 5년 구간으로 바꾸며 이미 만들어진 구간은 유지한다.
- [X] 명시된 광역과 하위 지역, 조사와 지역 미확정 경계를 검증했다.
- [X] 도로명/지번/건물/동/호/우편번호와 부분 NER 이후 주소 조각 잔류를 검증했다.
- [X] 중첩, 날짜/account 우선순위, 멱등성, 비BMP offset과 반복 광역 입력의 실행 시간 회귀를 통과했다.

### Task 2: dictionary 수명과 결과 증명

**Files:** `apps/pipeline/ccc_pipeline/worker.py`, 필요 시 `api_client.py`, `packages/core/src/gateway.ts`, 기존 worker/results/agent-job-contract 테스트.

**Consumes:** B2에서 결정한 재전송 의미, B4의 필드 경계, S5 결과 envelope.
**Produces:** 동일 claim에만 허용되는 dictionary와 S6 manifest를 가진 기존 S5 결과.

- [X] Agent의 job/opaque ID/oneTime/UTC expiry/최대 5분 검사를 구현했다. 다른 job 또는 만료된 표에서는 결과를 제출하지 않는다.
- [X] dictionary/작업 참조와 제어 가능한 응답 버퍼를 정상·예외 종료 모두에서 정리했다. JSON 문자열과 모델 내부 복사본 전체의 물리적 폐기는 미통과이며 이 체크의 대상이 아니다.
- [X] 기존 PII 조회와 claim scope를 재사용해 승인 필드를 발행한다. DB 및 감사 경계를 유지했다.
- [X] 실제 모델/라벨/계층과 N2 hash에 맞는 S6 manifest를 사용하고 다른 구성은 거부한다.
- [X] `build_result`에 최종 일반화 본문만 전달하며 code-point offset과 기존 canonical hash를 재사용한다.
- [X] text/audio의 dictionary 실패와 mocked NER 실패에서 result 0회를 확인했다. dictionary 거부는 한 번의 permanent/masking_failed release로 끝나며 provider authorization/core snapshot migration은 변경하지 않았다.

### Task 3: 독립 정답 corpus와 실제 NER 측정

**Files:** `scripts/privacy/qualify_ner.py`, `scripts/privacy/fixtures/s6-release-ko-v1.json`, 기존 model registry와 masking inference 경계.

**Consumes:** 승인된 고정 모델, 별도로 고정한 정답 구간, S6 설치 health와 qualification 기준.
**Produces:** corpus hash, label별 TP/FP/FN, point estimates, Wilson bounds, 결과 hash와 PASS/FAIL 측정 artifact. 실패 시 attestation/receipt는 생성하지 않는다.

- [X] 601개 고유 합성 항목과 201개 genuine negative를 구성했다. 요구된 이름/주소 형태와 기관명 모호성을 층화했다.
- [X] 독립 검수자는 N2 7개와 최초 출시 610개, 합계 617개를 전부 읽었다. 출시 항목의 정답 오류 10개는 수를 유지한 채 고쳤고, 모호한 출시 9개를 제외해 601개로 고정했다. N2 7개는 별도 그대로다. [고정 증거](../../../artifacts/ccc237-privacy/release-corpus-freeze.json).
- [X] 고정 revision으로 N2 7개와 출시 601개를 실제 실행했다. deterministic 가림 결과를 NER 예측으로 세지 않았다.
- [X] 분모 0 거부와 Wilson 경계를 검사하고 JavaScript의 독립 이차방정식 산식 및 hash로 재검증했다.
- [X] 설치와 출시를 별도 파일에 보존했다. 추론 뒤 corpus나 정답을 변경하지 않았다.
- [X] 모두 FAIL이므로 attestation/receipt 후보, 발행, 운영 등록과 AI 활성화는 0건이다.

### Task 4: 실행 증거, 검수와 완료 판단

**Files:** 기존 `apps/pipeline/tests/`, `apps/api/test/agent-job-contract.test.ts`, `artifacts/ccc237-privacy/`, 이 계획, 필요 시 기존 `apps/pipeline/README.md`.

- [X] 디코더 교정 전 일반화 단계의 pipeline Python 회귀 172개와 평가기 11개가 통과했다. 당시 코드 검증과 실제 NER 실패는 별도 결과다. 구현 subagent는 모델이나 검증 명령을 실행하지 않았다.
- [X] synthetic dictionary의 claim/expiry/audit와 세 모드 API 계약 회귀를 실행했다. 실제 Windows/Cloud 배포 검증이나 DB adapter 전체 parity를 뜻하지 않는다.
- [X] localhost HTTP에서 실제 worker를 실행해 G1/G3의 본문, hash와 실패 제출 차단을 확인했다. NER와 attestation은 합성 protocol fixture이며 실제 모델 검증은 별도 실측 결과를 따른다.
- [X] 승인된 재전송/메모리 범위를 독립 검수했다. 감사 기록 중 만료와 HTTP 오류 본문의 잠금 실패 분류 문제를 수정하고 회귀를 확인했다. 실제 NER나 전체 폐기 통과로 보고하지 않는다.
- [X] 승인된 부분의 사용법, 실행 증거와 미통과 범위를 S5/S6 및 이 계획에 반영했다. 재현용 증거는 보존하고 E5-4 전체 완료 댓글이나 Done 처리는 하지 않았다.
- [X] CCC-237은 In Progress로 유지한다. N2, release qualification과 전체 폐기 미통과를 완료로 보고하지 않는다.

디코더 교정 전 일반화 단계의 회귀는 pipeline Python 172개, 평가기 11개, dictionary/API 계약 29개와 세 모드 API/금고/인테이크 59개로 총 271개다. 당시 API typecheck, DB/core import 경계와 문서 번호 가드도 통과했다. 명령 및 파일 hash는 [approved-verification.json](../../../artifacts/ccc237-privacy/approved-verification.json)에 보존한다. 당시 [worker smoke](../../../artifacts/ccc237-privacy/generalization-closure.json)는 실제 HTTP와 worker를 사용하지만 NER와 자격증명은 합성 protocol fixture다.

독립 검수에서 확인한 반복 광역명 정규식 지연, 지역 치환 좌표, 일반명사 과잉 가림, 부분 NER 주소 잔여, 건물명 분류, 상속 property 조회와 canonical 숫자 발행 문제를 수정했다. 마지막 검수의 장소 조사 과잉 가림도 먼저 실패를 재현한 뒤 원래 재현을 통과시켰다. 독립된 읍/면/동/리 꼬리와 조사만으로 지역이라고 단정하지 않고, 광역 또는 시/군/구가 제시된 계층 안에서 처리한다. 이 변경은 고정 NER의 raw prediction, 정답 또는 qualification 실패를 보정하지 않는다. 과거 승인 문구와 착수 전 표의 시점을 분리하고 N2 7개 + 출시 610개에서 출시 9개를 제외한 corpus 이력도 명시했다.

## 실행 증거와 재현 경계

### 승인된 재전송과 메모리 강화

- 관련 회귀 **175개**가 통과했다: API 계약 23개, 세 모드 API/금고 기초/인테이크 59개, Agent client/worker 44개, native memory 4개, masking 38개와 results 7개. API typecheck, DB gateway/core import guard와 문서 번호 가드도 통과했다. 정확한 명령, 종료 코드, 로그와 hash는 [verification.json](../../../artifacts/ccc237-privacy/verification.json)에 기록한다.
- [transport-memory-smoke.json](../../../artifacts/ccc237-privacy/transport-memory-smoke.json): 실제 localhost HTTP로 source/dictionary를 읽고 오류 원문을 차단했다. Mac의 실제 OS 잠금 성공, 독립 native 메모리 읽기의 zero bytes, 실제 잠금 한도 0 주입 시 read 이전 거부, HTTP 오류에서도 masking 실패 분류 유지, 원래 한도 복원을 확인했다. 프로세스는 exit 0으로 종료했다.
- [host-memory-boundary.json](../../../artifacts/ccc237-privacy/host-memory-boundary.json): FileVault와 암호화 스왑이 켜져 있지만 최대절전 저장과 kernel core dump 설정도 켜져 있다. observer process의 core soft limit 0은 운영 Agent 정책을 대신하지 않는다.
- parser bytearray는 덮어쓰지만 page-locked가 아니다. JS/Python 문자열, urllib/TLS와 모델 내부 복사본, Windows/Cloud 호스트는 전체 폐기 증거가 없다. **whole-process zeroization은 미통과이며, 현재 N2와 release 실측도 FAIL**이다. 기존 보고서를 새 통과 증거로 확대하지 않는다.
- [spec-boundary-proof.json](../../../artifacts/ccc237-privacy/spec-boundary-proof.json)은 **이전 재전송/메모리 작업 시점**의 byte 비교 증거다. 이후 승인된 N2, G10, P4 정정이 적용된 현재 S6 전체가 기준과 같다는 뜻은 아니다.

Mac용 smoke 재현은 기존 증거를 덮어쓰지 않는 새 경로를 사용한다.

```bash
PYTHONPATH=apps/pipeline python3 artifacts/ccc237-privacy/transport-memory-smoke.py /tmp/ccc237-transport-memory-smoke-rerun.json
```

기대 결과는 exit 0과 `nativeLockSucceeded`, `nativeLockFailureClosedBeforeRead`, `errorBodyLockFailurePreservesMaskingPhase`의 true다. `wholeProcessZeroizationQualified`는 **false**여야 한다. `verification.json`의 hash는 보존한 현행 증거를 식별하며 다른 호스트의 실행 결과가 같은 hash여야 한다는 기준은 아니다.

### 이전 NER health 실패 기록

**다음 명령은 과거 실행의 기록이며 현행 checkout에서 그대로 재실행하지 않는다.** 수정 전 masking 38개, results 7개와 worker 32개 통과는 당시 상태다. 이전 Health 측정은 `99d7b41`의 S6 원본에서 실행했고, 현재 S6는 달라져 probe의 전체 파일 fingerprint 검사에서 거부된다. 현재 검사는 N2와 `qualify_ner.py`를 사용한다.

```bash
# 모델 로드 직전에 실행한다.
memory_pressure
# 이 probe는 위 S6 파일 fingerprint가 달라지면 실행을 거부한다.
# 예상: status=failed, exit=2, attestationIssued=false, releaseReceiptIssued=false.
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_IMPLICIT_TOKEN=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
uv run --no-project --python 3.12 --with torch==2.8.0 --with transformers==4.53.3 \
python artifacts/ccc237-privacy/health-probe.py . artifacts/ccc237-privacy/install-health-rerun.json
```

이전 ML 실행은 Mac CPU 2 threads, Python 3.12.13, torch 2.8.0, transformers 4.53.3에서 했으며 캐시된 고정 revision만 offline으로 읽었다. Windows에는 접속하지 않았다.

### BIOES 교정 전 N2와 출시 qualification 실측

| 검사 | 항목 | 인명 TP/FP/FN | 주소 TP/FP/FN | 판정 |
|---|---:|---|---|---|
| N2 설치 | 7 | 0/8/4 | 0/20/4 | FAIL |
| 출시 v1 | 601 | 0/463/240 | 0/1687/250 | FAIL |

두 검사 모두 point precision/recall은 0, overgeneralization은 1이다. 출시의 Wilson lower precision/recall은 모두 0, overgeneralization upper는 1이다. 항목 누락이나 추론 오류는 없으며 실패 exit code는 2다. [N2 결과](../../../artifacts/ccc237-privacy/install-health-v2.json), [출시 결과](../../../artifacts/ccc237-privacy/release-qualification-v1.json), [독립 산식/hash 검증](../../../artifacts/ccc237-privacy/measurement-integrity.json)을 보존한다.

출시 full-array hash는 `8fe927f79ad4e84d6ed1440b069e099e15c50618226c6727781e73f00ee321f4`다. 모든 item의 `strata`도 hash에 포함한다. 합성 템플릿 간 상관이 있으므로 이 수치를 실제 상담 전체 모집단의 오류율로 확대하지 않는다.

당시 구조 검사에서 transformers 4.53.3의 `simple` 경로가 `E-private_person`과 `B-/I-private_person`을 같은 entity tag로 취급하지 않는 것을 확인했다. [라벨 검사](../../../artifacts/ccc237-privacy/approved-decoder-contract.log)는 모델을 로드하지 않은 증거다. 이후 별도 승인으로 아래 교정과 재측정을 수행했으며, 이전 실패가 디코더 하나 때문이었다고 단정하지 않는다.

아래 명령은 현재 체크아웃의 디코더로 새 측정을 실행한다. 이전 `simple` 보고서를 재현하는 명령으로 읽지 않는다. 모델 로드 직전 `memory_pressure`를 확인하고 기존 파일이 없는 출력 경로를 쓴다.

```bash
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_IMPLICIT_TOKEN=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
uv run --offline --no-project --python 3.12 --with torch==2.8.0 --with transformers==4.53.3 \
python scripts/privacy/qualify_ner.py --kind release \
  --corpus scripts/privacy/fixtures/s6-release-ko-v1.json \
  --expected-corpus-hash 8fe927f79ad4e84d6ed1440b069e099e15c50618226c6727781e73f00ee321f4 \
  --output /tmp/ccc237-release-new.json
```

N2는 `--kind health`, `scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json`, hash `35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59`를 사용한다. `--validate-only`는 ML을 로드하지 않는다. 둘 다 실패한 현 상태에서는 증명과 운영 권한을 발행하지 않는다. 기존 core의 health/release hash 동일성 가정은 E5-5 소비 경계에서 별도로 다뤄야 하며 이 작업에서 우회하지 않았다.

### BIOES 교정과 동일 자료 재측정

Q의 후속 “진행”으로 `masking.py`의 공통 `bioes-v1` 디코더를 적용했다. transformers 4.53.3, 모델/revision/라벨, N2 및 출시 corpus, 정답과 통과 기준은 그대로다. 기존 `simple` 대신 `aggregation_strategy="none"`, `ignore_labels=[]`로 원래 토큰을 받고 B/I/E/S 및 B/I/L/O/U 경계를 처리한다. O와 범주 변경은 구간을 끊고, 시작 표식 없는 I/E/L도 버리지 않는다. 정답을 참고한 구간 확장, 점수 임계값 조정과 결과 보정은 없다.

변경된 결과를 이전 구현과 같은 manifest로 주장하지 않도록 파이프라인은 `ner-mask-v3`로 구분했다. [S6 §2.2~2.3](../../specs/S6-privacy-packet.md#22-ner-health-attestation)만 갱신하고, 과거 v2의 fixture/hash와 E5-5의 허용 쌍은 바꾸지 않았다. [재측정 조건 고정](../../../artifacts/ccc237-privacy/decoder-remeasurement-freeze.json)과 이전 실패 보고서를 보존한다.

| 검사 | 항목 | 인명 TP/FP/FN | 주소 TP/FP/FN | 판정 |
|---|---:|---|---|---|
| N2, bioes-v1 | 7 | 4/0/0 | 0/11/4 | FAIL |
| 출시 v1, bioes-v1 | 601 | 172/74/68 | 1/873/249 | FAIL |

출시 point precision/recall은 인명 69.92%/71.67%, 주소 0.114%/0.4%다. 과잉 가림 비율은 84.55%이며 Wilson 출시 관문도 미통과다. 모든 항목의 추론은 완료했고 누락/오류 행은 없다. 실패 종료 코드는 각각 2이며 attestation/receipt 후보나 운영 권한을 발행하지 않았다. N2 인명 결과의 개선은 확인했지만 주소의 남은 실패 원인은 이 결과만으로 확정하지 않는다.

- [N2 새 결과](../../../artifacts/ccc237-privacy/install-health-v2-bioes-v1.json)
- [출시 새 결과](../../../artifacts/ccc237-privacy/release-qualification-v1-bioes-v1.json)
- [독립 산식 및 hash 검증](../../../artifacts/ccc237-privacy/decoder-measurement-integrity.json)
- [실제 runtime NER factory 검사](../../../artifacts/ccc237-privacy/decoder-runtime-smoke.json): Mac의 기본 MPS 장치에서 N2 집계가 CPU 평가기와 같았다. 전체 구간의 장치 간 동등성이나 worker 기동을 증명하지 않는다.
- [worker HTTP 검사](../../../artifacts/ccc237-privacy/decoder-worker-smoke.json): 실제 worker와 HTTP에 합성 NER/attestation을 연결한 결과 제출 검사이며 실제 모델 자격과 구분한다.

두 정식 재측정은 Mac CPU 2 threads에서 실행했고 각 모델 로드 직전에 메모리를 확인했다. BIOES 경계 회귀는 교정 전 실패한 뒤 통과했으며 pipeline 176개와 평가기 11개, 합계 187개가 통과했다. Windows/Cloud 전체 실행과 원문 물리적 폐기는 여전히 미통과 또는 미측정이다. 커밋, 병합, 배포, 실제 AI/STT 활성화는 하지 않았다.

### 남은 주소 실패의 원인 분리

후속 “다음 진행하자”에서는 제품 코드를 바꾸지 않고, 고정 모델의 같은 토큰 예측에 네 가지 후처리를 적용해 비교했다. [진단 조건](../../../artifacts/ccc237-privacy/residual-diagnosis-freeze.json)을 추론 전에 고정했고, 기존 N2 7개와 출시 601개의 정답 및 통과 기준은 그대로 유지했다. 이는 자격 재평가나 새 디코더의 채택이 아니다.

[고정 버전 모델 카드](https://huggingface.co/FrameByFrame/korean-pii-e5-base/raw/a308c54b4407819624a5661e31e162a269f39818/README.md)의 구간 묶기와 조사 제거를 각각 비교했다. 공개 벤치마크 전체를 재현한 실험은 아니다. 같은 pipeline 토큰을 재사용했으며 특수 토큰 처리 경계가 공식 logits 예시와 다르다. 최대 입력은 N2 29토큰, 출시 37토큰으로, 공식 예시의 256토큰 상한을 넘은 문장은 없었다.

| 출시 자료의 진단 방식 | 인명 TP/FP/FN | 주소 TP/FP/FN |
|---|---|---|
| 현행 bioes-v1 | 172/74/68 | 1/873/249 |
| 공식 구간 묶기만 적용 | 173/71/67 | 1/871/249 |
| 공식 조사 제거만 적용 | 167/79/73 | 1/873/249 |
| 공식 구간 묶기와 조사 제거 | 168/76/72 | 1/871/249 |

N2는 네 방식 모두 인명 4/0/0, 주소 0/11/4로 같았다. 공식 조사 제거는 출시 자료에서 인명 정답 5개를 잃게 했고, 이름에 속하는 글자 5개를 가림 범위에서 빼냈다. 정답을 새로 얻은 이름은 없었다. 따라서 이 후처리를 그대로 제품에 적용하지 않는다.

현행 주소 정답 250개는 정확히 일치한 1개, 공백 외 글자를 모두 잡았지만 여러 조각으로 나뉜 198개, 일부만 잡은 43개, 주소로 잡지 못한 8개로 나뉜다. 마지막 8개 중 1개는 인명으로만 겹쳤다. 식별자가 없는 문장의 오탐도 주소 32건, 인명 48건 남았다. 이 수치는 문장 수가 아니라 잘못 예측한 구간 수다. [전체 진단](../../../artifacts/ccc237-privacy/residual-ner-diagnosis.json)에 분류와 집계를 보존한다.

N2의 별도 절단 지점 검사에서는 주소 조각 사이의 공백 5곳과, 비식별자 O 토큰이 낀 공백 외 구간 2곳을 확인했다. 주소 정답에서 놓친 공백 외 글자는 한글 11자였다. [N2 절단 지점 진단](../../../artifacts/ccc237-privacy/n2-address-cut-diagnosis.json)은 원문, 토큰 배열과 좌표를 남기지 않는다. 조각 분리뿐 아니라 실제 미탐도 있는 결과다.

포착되지 않은 글자를 새로 포함하지 않고, 완전히 포착된 조각만 완벽히 묶는 가정에서도 인명 173/240, 주소 199/250이다. 인명은 일부 포착된 사례까지 전부 구제한다고 가정해도, 같은 라벨의 겹침이 전혀 없는 49개 때문에 최대 191/240, 약 79.58%다. 이는 Wilson 95% 신뢰구간 하한 90%라는 현행 출시 기준에 미치지 못한다. 이 계산은 합치기 규칙의 승인이나 주소의 모든 가능한 후처리에 대한 불가능성 증명이 아니다.

두 독립 검수는 오류 분류, 원문 비보관, 공식 예시와의 비교 범위 및 결과 해석에서 수정할 결함을 찾지 못했다. 모델 로드 전마다 Mac 메모리를 확인했고 Windows에는 접속하지 않았다. 진단 스크립트의 분류 자체 검사와 두 보고서의 canonical hash 검사가 통과했다. 진단 전후 제품 파일, 평가기와 corpus의 hash도 같았다.

**현재 상태는 계속 In Progress다.** N2, 출시 qualification과 전체 프로세스 물리적 폐기는 통과하지 못했다. 다음 권고는 후처리를 더 붙이는 것이 아니라, 고정 모델 조건의 예외를 승인받아 대체 NER 후보를 비교하는 것이다. 기존 정답을 고치거나 기준을 낮추지 않으며, 진단에 노출된 출시 자료만으로 후보를 선택한 뒤 같은 자료를 독립 출시 증거라고 주장해서는 안 된다. 후보 비교와 운영 모델 교체는 별도 결정이고, 이번에는 둘 다 실행하지 않았다.

### 승인된 대체 NER 후보 비교

위 진단 뒤 Q가 “대체 후보 비교”를 선택했다. 모델 고정 조건의 예외는 **합성 자료를 이용한 비교 실험에만** 적용한다. 운영 모델 교체, AI/STT 활성화, 자격 증명 발행, E5-5 변경, 커밋과 배포는 승인 범위가 아니다. 제품의 `bioes-v1`과 `ner-mask-v3`, 기존 N2 및 출시 정답과 기준은 유지한다.

이 작업은 제품 기능 추가가 아닌 비교 실험이다. [비교 설계](../../../artifacts/ccc237-privacy/ner-comparison/comparison-design.json)를 먼저 기록했다. 별도 작성자가 선정용 자료와 검증용 자료를 만들고, 추론 전에 독립 검수 및 hash 고정을 거친다. Main은 선정 결과를 고정하기 전 검증 자료의 원문과 생성 틀을 열지 않는다. 기존 601개는 후보 선정이나 새 독립 검증에 재사용하지 않는다.

같은 exact-span 채점과 Wilson 수치 기준을 적용한다. 대체 후보는 우선 기존 수치 관문 통과 여부, 네 precision/recall 하한 중 최솟값, 과잉 가림 상한, 모델 ID 순으로 정렬한다. 모두 실패하더라도 가장 나은 후보 한 개만 별도 검증하되 운영 채택을 권하지 않는다. 선정 모델, revision, 라벨 대응과 결과 hash를 고정한 뒤 그 후보와 현행 대조 모델만 검증 자료에 실행하며, 검증 결과를 보고 다시 고르거나 조정하지 않는다.

자료는 독립 작성과 블라인드를 적용하더라도 합성 문장 틀의 상관과 작성자 편향을 가진다. 수치 관문을 통과해도 이를 실제 상담 모집단이나 인간 검수된 출시 자격의 증명으로 확대하지 않는다. 공개 라이선스, 고정 revision과 라벨 의미를 먼저 확인하고, 원격 코드나 pickle 가중치를 실행하지 않는다. 모델은 Mac CPU 2 threads에서 한 번에 하나씩 실행하고 매 로드 전 메모리를 확인한다.

#### 비교 결과

검토한 대체 후보 5개 중 두 라벨을 직접 제공하는 `vmaca123/korean-pii-ner-v3` revision `ebee0847b166f16041bffc9e1521d895d360d02e`만 현행 모델과 실측했다. `NAME`과 `ADDRESS`의 이름만 대응시켰고 구간 합치기, 조사 제거와 임계값 조정은 하지 않았다. 주소 라벨이 없는 모델, 구성요소별 라벨만 제공하는 모델, 라이선스 미표기 또는 안전한 가중치 형식이 없는 후보는 [모델 목록](../../../artifacts/ccc237-privacy/ner-comparison/models.json)에 제외 근거를 남겼다. 전체 NER 모델의 순위표가 아니라, 적격 대체 후보 한 개와 현행 모델의 제한된 비교다.

선정용과 별도 검증용 자료는 각각 600개이며, 인명 200개, 주소 200개와 두 대상이 없는 문장 200개로 구성했다. 두 독립 검수자가 각각 전체 600개와 생성 규칙을 읽었다. 문법 결함은 추론 전에 고쳤고, 정답 엔티티와 클래스는 바꾸지 않았다. 두 자료 사이에 같은 원문이나 정답 문자열은 없었다. Main은 후보 고정 전에 검증 자료의 원문이나 생성 틀을 열지 않았다.

| 자료 | 모델 | 인명 TP/FP/FN | 주소 TP/FP/FN | 기존 수치 관문 |
|---|---|---|---|---|
| 선정용 600개 | 현행 | 197/31/3 | 0/832/200 | FAIL |
| 선정용 600개 | 대체 후보 | 194/6/6 | 26/388/174 | FAIL |
| 별도 검증 600개 | 현행 | 175/15/25 | 0/907/200 | FAIL |
| 별도 검증 600개 | 대체 후보 | 187/13/13 | 19/390/181 | FAIL |

후보의 별도 검증 인명 정밀도와 재현율은 모두 93.5%지만 Wilson 하한은 89.20%로 기준 90%에 못 미친다. 주소 정밀도는 4.65%, 재현율은 9.5%다. 과잉 가림 비율의 Wilson 상한도 69.82%로 기준 5%를 넘는다. **이 후보로 운영 모델을 교체하는 것은 권하지 않는다.** 이는 이 실행 조건에서의 결과이며, 다른 모델이나 별도 주소 검출 방식 전체가 불가능하다는 뜻은 아니다.

선정 결과는 검증용 추론 전에 [selection.json](../../../artifacts/ccc237-privacy/ner-comparison/selection.json)에 고정했다. 첫 직렬화 시도는 JSON이 아닌 tuple을 거부했고, list로 바로잡은 뒤 처음으로 기록했다. 모델, 자료와 선정 규칙은 바뀌지 않았으며 검증 결과를 본 뒤 재선정하지 않았다. 선정 파일이 없으면 모델을 로드하기 전에 검증 실행이 차단되는 실제 CLI 검사도 통과했다.

가중치는 공개된 고정 revision의 safetensors만 캐시에 내려받았고 저장소에는 복사하지 않았다. 후보의 게시된 라이선스는 CC-BY-SA-4.0이며, 향후 배포를 결정한다면 별도 검토가 필요하다. 카드가 밝힌 동·호수 미지원도 한계로 남긴다. 이번 주소 실패 전체를 그 한 가지 원인으로 단정하지는 않는다.

네 실행은 Mac CPU 2 threads에서 한 모델씩 수행했고 600개를 모두 측정했다. 기본 가중치 dtype은 현행 bfloat16, 후보 float32였다. 기록한 시간과 최대 RSS는 한 번의 CPU 실행 값이므로 플랫폼별 속도 우열로 확대하지 않는다. 합성 문장 틀의 상관, 학습 자료와의 중복 미검사, 인간 정답 판정 부재도 제한으로 남는다.

- [추론 전 고정 자료](../../../artifacts/ccc237-privacy/ner-comparison/freeze.json)
- [가중치 파일 hash](../../../artifacts/ccc237-privacy/ner-comparison/weight-provenance.json)
- [비교 결과와 실행 조건](../../../artifacts/ccc237-privacy/ner-comparison/comparison-summary.json)

제품 코드와 운영 모델, 기존 N2 및 출시 정답과 기준은 유지했다. 새 모델의 운영 채택, 통과 증명 발행, AI/STT 활성화, E5-5 변경, 커밋, 병합과 배포는 하지 않았다. CCC-237은 계속 In Progress이고, 기존 N2, 출시 qualification과 전체 프로세스 원문 메모리 폐기도 미통과 상태다.

### 현행 전체 가림 실측과 최종 제안

추가 리서치 검토 뒤 Q가 현행 NER과 기존 주소 규칙을 합친 실제 가림 결과의 측정을 승인하고 최종 제안을 요청했다. 아래 제안은 수정 구현이나 평가 계약 변경의 승인이 아니다. 제품 코드, 모델, 기존 정답과 기준은 바꾸지 않았다. 기존 네 자료는 이미 결과 분석에 노출된 합성 참조 자료이므로 새 출시 자격 근거가 아니다.

[측정 설계](../../../artifacts/ccc237-privacy/full-masking/measurement-design.json)를 먼저 고정했다. 실제 모델 예측은 행마다 한 번만 만들고 정답을 읽기 전에 동결했다. 같은 예측을 `mask_text_with_report`에 전달해 제품의 결정론 주소 규칙, NER 구간 합치기, 준식별자 일반화와 정형 식별자 치환을 그대로 실행했다. 계측된 결과는 같은 함수의 계측 없는 두 번째 실행과 매 행 비교했다. 보고서에는 원문, 최종 문자열, 토큰, 예측 구간과 좌표를 남기지 않았다.

| 참조 자료 | 이름에서 원문 글자가 남은 구간 | 주소에서 원문 글자가 남은 구간 | 이름 원문 글자 가림 | 주소 원문 글자 가림 | 결합 1단계에서 이름·주소 예측 구간이 하나 이상 생성된 target-negative 행 |
|---|---:|---:|---:|---:|---:|
| 기존 출시 601개 | 67/240 | 47/250 | 657/940 (69.89%) | 4,114/4,216 (97.58%) | 85/201 |
| 후보 선정용 600개 | 3/200 | 195/200 | 626/640 (97.81%) | 5,832/6,650 (87.70%) | 16/200 |
| 별도 검증용 600개 | 19/200 | 188/200 | 612/674 (90.80%) | 6,841/7,030 (97.31%) | 0/200 |

여기서 원문 글자가 남은 구간은 하나라도 literal code-point가 남은 정답 구간이다. 전체 주소 문자열이 출력에 그대로 남은 것과 같지 않으며, 정확한 구간 점수를 대신하지 않는다. 기존 출시 자료에서 주소 exact TP는 NER 단독 1/250에서 결합 138/250으로 늘었지만 결합 주소 정밀도와 재현율은 34.24%와 55.20%에 그쳤다. 이름의 exact-span TP/FP/FN은 결합 뒤에도 172/74/68로 같았다. 별도 검증용 자료의 결합 주소 exact TP는 0/200이었고, 188개 주소에 일부 원문 글자가 남았다. 기존 주소 규칙은 주소를 실제로 더 가리지만 이름 누락과 주소 잔류, 경계 오류 및 과잉 가림을 모두 해결하지 못했다.

target-negative는 이름과 주소 정답이 없다는 뜻이며 다른 민감 정보가 없다는 뜻은 아니다. 마지막 단계의 정답 밖 가림에는 전화번호와 질환 등 의도한 치환도 포함되므로 전부 불필요한 삭제라고 해석하지 않는다. 반대로 주소 전체 문자열이 다시 나타나지 않았다는 사실도 일부 식별 글자의 잔류를 없던 일로 만들지 않는다.

긴 입력 진단은 N2 양성 5개를 앞과 뒤에 둔 쌍 10개 및 target-negative 1개를 추론 전에 고정했다. 11개 모두 512토큰 한계를 넘었지만 실제 전처리는 각 입력을 창 하나로만 처리했다. 앞에 둔 이름 4개는 모두 검출했고, 뒤에 둔 이름 4개는 12글자 모두 원문으로 남았다. 뒤쪽 정답 글자 66개는 모델 입력에 들어가지 않았다. 주소 4개는 뒤에 있어도 기존 결정론 규칙이 가렸지만 NER은 놓쳤다. 이는 현실 상담 분포의 성능 측정이 아니라, 지원 범위를 넘는 입력을 조용히 자르는 경로가 실제로 존재한다는 위치 진단이다.

두 독립 검수에서 계측, 집계, Wilson 계산, 고정 파일 hash와 결과 해석에 수정 사항은 없었다. N2 7개, 표의 세 참조 자료 1,801개와 긴 입력 11개를 합한 1,819개 행의 다섯 집계를 다시 계산했고, 20개 고정 파일과 기존 NER 대조 결과 네 개가 일치했다. [측정 결과](../../../artifacts/ccc237-privacy/full-masking/measurement.json), [독립 계산](../../../artifacts/ccc237-privacy/full-masking/verification.json), [검토된 요약](../../../artifacts/ccc237-privacy/full-masking/summary.json)에 근거를 보존한다.

**최종 제안은 두 모델 중 하나를 확정하는 것이 아니다.** 다음 구현 결정을 내리기 전에 지원할 최대 입력 길이, 특수 토큰을 포함한 창 크기와 겹침, 원문 code-point 좌표 복원, 중복·겹침·라벨 충돌 처리, Windows 지연시간과 최대 메모리를 계약으로 고정한다. 그 계약을 별도 승인한 뒤 현행 모델과 규칙을 대조군으로 유지한 채 NER 입력을 겹치는 창으로 나눈다. 지원 입력의 전 구간을 처리했다고 확인할 수 없으면 일부만 가린 문자열을 성공 결과로 반환하지 않고 `local_ner_unavailable`로 보고하며 외부 AI 호출은 0회여야 한다. 변경된 처리는 새 파이프라인 식별자에 묶고 기존 영수증을 재사용하지 않는다. 앞뒤 쌍의 이름 결과가 같고, 뒤쪽 이름의 원문 글자가 남지 않으며, 고정한 창 경계·Unicode·target-negative 기대값과 Windows 자원 기준이 통과해야 이 수정이 끝난다. 짧은 참조 결과의 예외 변경이 필요하면 구현 뒤에 설명하는 대신 추론 전에 승인한 고정 목록에만 허용한다.

그 다음 목표 구조는 인명 검출과 주소 검출을 분리한 로컬 결합 검출기다. 인명은 창 분할을 적용한 별도 후보를 다시 평가하고, 주소는 기존 결정론 규칙을 기준선으로 남겨 잔류와 오탐 원인을 나눈 뒤 필요할 때만 고정한 Juso 사전을 증분 비교한다. Juso를 먼저 넣는 것은 이번 결과로 정당화되지 않는다. 실제 파일 버전, 스키마, hash와 배포 권리도 아직 고정하지 않았다.

결합 검출기를 정식 출시 판정 대상으로 삼으려면 S6의 고정 모델·라벨 전제를 별도 결정으로 바꿔야 한다. 모델 단독 지표와 최종 원문 잔류 및 정보 손실 지표는 계속 분리하고, 기존 수치 기준은 낮추지 않는다. 후보와 규칙을 고정한 뒤 새 봉인 자료와 예측을 보지 않은 사람의 정답 검수, Windows 자원 실측을 거쳐야 한다. 이번 측정에서는 제품 변경, 통과 증명, 활성화, E5-5 변경, 커밋, 병합과 배포를 하지 않았다.

### 긴 입력 누락 수정과 Windows 실측

2026-09-08 Q가 개인정보 가림 개선부터 진행하고 Windows 실측을 포함하도록 선택했다. 앞 절의 제안 중 긴 입력 누락 수정만 수행했다. 기존 E5-4 작업 사본을 기반으로 `.worktrees/counseling-memory`의 `fix/ner-long-input`에서 작업했으며 원본 E5-4 작업 공간과 루트 checkout은 수정하지 않았다.

고정 모델과 revision, BIOES 디코더, 정답 및 점수 기준은 유지했다. 입력 계약은 최대 24,000 Unicode code-point, 특수 토큰 포함 창당 512토큰, 내용 토큰 128개 겹침, 최대 64창, batch 1이다. 겹친 토큰은 창 경계에서 더 먼 예측을 고르고 동률이면 앞 창을 쓴다. 전체 창과 원문 좌표를 먼저 검증하며 불완전한 처리, 한도 초과 및 중간 추론 실패는 부분 결과 없이 `local_ner_unavailable`로 닫는다.

새 식별자는 `ner-mask-v4`다. 창 계약과 디코더, batch 1 및 허용 런타임 torch 2.8.0 / transformers 4.53.3을 manifest에 묶었다. CPU wheel의 빌드 접미사는 허용하지만 다른 기본 버전은 거부한다. 기존 v3 영수증을 재사용하지 않는다. 서버 승인 registry와 S6의 승인 기준은 바꾸지 않았다.

#### 결과와 해석

| 검증 | 결과 | 범위 |
|---|---|---|
| Python 회귀 | 184 + 11 + 3 = 198개 통과 | 파이프라인, 기존 NER 평가기, 창 계측의 무결성 |
| Windows 회귀 | 창 처리 7개, 계측 3개 통과 | Python 3.12.13의 실제 Windows 실행 |
| 짧은 입력 대조 | 장비별 1,808개 모두 기존과 같음 | 두 장비 1차 전체 측정, 최종 Mac 전체 재측정 |
| 긴 입력 위치 진단 | 앞 이름 4/4, 뒤 이름 4/4 검출 | 고정 11개, 두 장비 최종 실제 forward 처리 확인 |
| 최종 제품 가림 | 이름 24/24글자, 주소 108/108글자 가림; 원문 잔류 0 | Mac의 고정 11개; 계측 없는 실제 제품 결과와 일치 |
| 최종 N2 | 두 장비 모두 이름 TP 4 / FP 0 / FN 0, 주소 TP 0 / FP 11 / FN 4 | 실제 qualifier 종료 코드 2, 통과 증빙 없음 |

최종 Mac은 전체 1,819개와 최대 길이 부하를 측정했다. Windows도 1차에 전체 1,819개를 측정했으며, 예외와 계측 보강 뒤 최종 재측정은 `--long-only`의 11개와 부하다. 최종 Windows 결과를 전체 자료 재측정으로 해석하지 않는다. 고정 native bf16 모델은 두 OS의 일부 정확한 구간 수치가 달랐다. 변경 전후의 동일성은 같은 장비 안의 대조이며 OS 간 정확도 일치를 뜻하지 않는다.

| 최종 CPU 2 threads 측정 | Mac | Windows |
|---|---:|---:|
| 24,000자 실제 추론 횟수 | 29 | 29 |
| 미처리 비공백 글자 | 0 | 0 |
| 24,000자 처리 시간 | 57.89초 | 204.14초 |
| 측정 전체의 최대 메모리 | RSS 820.39 MiB | peak working set 718.15 MiB |
| 24,000자 초과 | 추론 전 거부 | 추론 전 거부 |

메모리는 측정 방식과 전체 실행 범위가 다른 값이다. 장비 최소 사양이나 처리 SLA의 합격 기준을 새로 정한 것이 아니며, 24,000자 반복문 부하는 정확도 근거가 아니다. Windows는 별도 `CCC-237-ner-v4-win` 폴더의 Python과 공개 모델 캐시를 썼고 기존 E5-8 벤치마크를 건드리지 않았다. 자료와 소스는 tar로 바이트를 보존해 옮겼다.

#### 독립 검수와 재현

Herdr의 런타임 검수와 계측 검수를 분리했다. 검수에서 발견한 예외의 원문 참조, 런타임 미고정, manifest의 batch 누락, 전처리만으로 처리 완료를 세던 계측, 실행 중 소스 변경, validate-only의 불필요한 모델 의존 및 디코더 메타데이터를 수정했다. 예외 정리는 이 함수가 소유한 참조의 범위이며 프로세스 전체 메모리 폐기를 주장하지 않는다. 두 검수 모두 최종적으로 남은 수정 사항이 없다고 판정했다.

65창 회귀가 일찍 실패한다는 지적은 실제로 65개 전처리 창과 추론 0회를 관찰해 반증했고 검수자가 철회했다. 완전한 v4 canonical vector와 런타임 또는 batch 누락 시 hash 변경은 일회성 smoke로 검증했다. 같은 필드를 그대로 복사하는 영구 테스트를 추가하라는 권고는 테스트 정책에 따라 철회했다. 기존 영수증의 식별자를 재사용하지 않는 회귀는 유지했다.

재현 명령:

```bash
PYTHONPATH=apps/pipeline:scripts/privacy python3 -m unittest discover -s apps/pipeline/tests
python3 -m unittest discover -s scripts/privacy -p 'test_*ner.py'
python3 -m unittest discover -s scripts/privacy -p test_windowing_probe.py
uv run --no-project --python 3.12 --with torch==2.8.0 --with transformers==4.53.3 python scripts/privacy/run_windowing_probe.py --root . --output /tmp/ccc-ner-new-report.json
uv run --no-project --python 3.12 --with torch==2.8.0 --with transformers==4.53.3 python artifacts/ccc237-privacy/windowing-v4/verify_long_mask.py . /tmp/ccc-ner-new-mask-report.json
```

실모델 실행은 고정 revision을 미리 캐시한 offline 경로다. Windows는 전용 Python/cache 환경과 PyTorch CPU index를 사용하며 마지막 명령 대신 창 진단 명령에 `--long-only`를 붙여 최종 처리 경계를 재현할 수 있다. 새 보고서 경로를 사용한다.

근거는 [검증 집계](../../../artifacts/ccc237-privacy/windowing-v4/verification.json), [Mac 최종](../../../artifacts/ccc237-privacy/windowing-v4/mac-final.json), [Windows 1차 전체](../../../artifacts/ccc237-privacy/windowing-v4/windows-initial.json), [Windows 최종](../../../artifacts/ccc237-privacy/windowing-v4/windows-final.json), [실제 가림 최종](../../../artifacts/ccc237-privacy/windowing-v4/long-mask-final.json), [Mac N2](../../../artifacts/ccc237-privacy/windowing-v4/health-final.json), [Windows N2](../../../artifacts/ccc237-privacy/windowing-v4/windows-health-final.json)다. 최종 두 장비의 구현 hash는 서로 같고 현재 소스 바이트와도 일치한다.

**긴 입력의 조용한 누락만 해결했다.** 주소 정확도와 기존 일반화 한계는 남아 있어 CCC-237은 In Progress이며 passing attestation과 release receipt를 발급하지 않았다. Juso, 다른 모델, 실제 AI/STT 활성화, 프리뷰 연결, 기억 생성, 커밋, 병합과 배포는 하지 않았다.

### 주소 규칙 보강과 프리뷰 검증 승인

2026-09-08 Q가 가상 데이터 전용 프리뷰에서 주소 가림을 보강하고 실측 결과에 따라 수정하는 흐름을 승인했다. 기존 숫자 주소 뒤의 괄호형 법정동과 선택 공동주택명을 함께 가린다. 인용된 도로명은 같은 문장 앞부분에 주소나 방문지 같은 명시적 위치 문맥이 있고 문서나 비유 같은 제외 단서가 없을 때만 가린다. 짧은 일반 표현 오탐을 줄이기 위해 이 도로명 후보는 세 글자 이상이고 `으로`로 끝나지 않아야 한다.

숫자 주소 뒤의 `상동`, `중동`, `신동`처럼 짧은 실제 법정동은 남기지 않는다. 이 때문에 같은 모양의 일반 단어가 괄호에 오면 과하게 가릴 수 있다. 주소 조각을 남기는 것보다 과한 가림을 택한다는 기존 개인정보 우선순위를 적용한 결과다.

새 동작은 테스트를 먼저 실패시킨 뒤 구현했다. 독립 검수에서 발견한 `동쪽으로`, `바로`, `활동`, `정리` 경계를 재검토했으며 최종 Critical 또는 Important 지적은 없었다. 제품 출력은 사후 독립 합성 자료 200행에서 선정한 최소 후보와 동일했다. 이 승인은 가상 데이터 프리뷰 배포와 확인에만 적용하며 passing attestation, release receipt, 운영 AI나 STT 활성화는 허용하지 않는다.
