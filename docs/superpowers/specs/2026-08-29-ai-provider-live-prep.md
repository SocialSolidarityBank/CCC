# AI API 실호출 가동 준비 스펙

- 상태: 준비 스펙 (2026-08-29 작성, 구현 착수 전. 결정 포인트는 Q 확인 후 확정)
- 관계: D57(ADR-0027), D66, D68, D69(ADR-0036), D70·D72(ADR-0037)

## 배경

호출 경로는 이미 구현되어 있다. `apps/api/src/ai-provider.ts:1295-1380`의 `CodexProviderAdapter`가 SDK 없이 `https://api.openai.com/v1/responses`를 직접 `fetch`한다. `AbortController` 타임아웃은 20,000ms이며, 네트워크 오류, HTTP 상태 오류, 잘못된 응답을 `network`, `http_status`, `malformed_response`로 분류한다(`apps/api/src/ai-provider.ts:51-52,1331-1378`). 응답은 JSON 파싱 뒤 호출부의 출력 검증으로 넘긴다.

호출 ①은 `generate`에서 `ccc_grounded_draft_v4` 스키마를 요청한다(`apps/api/src/ai-provider.ts:1306-1312`). v4 계약은 claims 3구획, questions, oneLiner, 대조 3종, 전사 인용만 허용하는 리스크 플래그 제안을 포함한다(`apps/api/src/ai-provider.ts:22-28,1233-1258`). 호출 ②는 `detectDiscrepancies`에서 `ccc_discrepancy_list_v1` 스키마로 불일치 쌍을 요청한다(`apps/api/src/ai-provider.ts:1315-1322,1260-1293`). 두 결과 모두 요청부의 검증과 저장 경로에 연결되어 있으며, 호출 ②는 호출 ①과 별개의 best-effort 경로다.

실제 런타임 게이트는 `resolveAiProviderAdapter`가 담당한다. 설정을 먼저 읽어 `config_missing` 또는 `config_invalid`를 판정하고, 그 다음 `CODEX_API_KEY` 부재를 `api_key_missing`으로 판정하며, 마지막으로 `EXTERNAL_AI_CALLS_ENABLED`가 정확히 `1`인지 확인한다(`apps/api/src/ai-provider.ts:531-535,1406-1412`). 따라서 운영 순서는 설정, 키, 외부 호출 스위치를 모두 갖춘 뒤에도 fail-closed 조건을 단계별로 확인해야 한다.

런타임 설정 계약은 `AI_PROVIDER_CONFIG` JSON의 `registryVersion`, `providerId`, `adapterVersion`, `configVersion`, `model`이다(`apps/api/src/ai-provider.ts:280-288,490-519`). 프롬프트·스키마 버전은 현재 `phase1.grounded.v4`, `phase1.grounded-draft.v4`, `phase1.discrepancy.v1`, `phase1.discrepancy-list.v1`이다(`apps/api/src/ai-provider.ts:25-28`). `canonicalAiProviderConfigHash`는 어댑터, 설정, 모델, 프롬프트, 스키마, 프로바이더, 레지스트리 버전을 고정 순서로 직렬화해 SHA-256 해시를 만든다(`apps/api/src/ai-provider.ts:538-566`).

`apps/api/wrangler.toml:104-114`의 preview 설정에는 `AI_PROVIDER_CONFIG`가 있고 현재 모델은 `gpt-5.6-luna`로 적혀 있지만, `EXTERNAL_AI_CALLS_ENABLED`는 `0`이다. 운영 문서도 `AI_PROVIDER_CONFIG`, `CODEX_API_KEY`, `EXTERNAL_AI_CALLS_ENABLED=1` 세 값이 함께 있어야 호출이 열린다고 설명하며, 키를 stdout에 닿지 않는 경로로 등록하도록 요구한다(`docs/ops.md:46-55`). 그러므로 현재 어느 환경에서도 실제 사업자 호출이 일어난 상태로 간주하지 않는다. `docs/ai-provider-setup-q-actions.md:24-35,105-111`도 아직 OpenAI 호출을 하지 않으며 미리보기는 가상 시드 전용이라고 기록한다.

DB는 `ai_provider_configs`와 `ai_provider_activations`에 어댑터 식별자, 설정 해시, 승인 참조, 활성화 이력만 저장한다(`db/schema.sql:383-426`). 두 표 모두 변경 이력을 보존하며, API 키 자체는 저장하지 않는다. 활성화 API는 환경의 설정과 키를 먼저 검증한 뒤 현재 설정의 해시를 계산하고, `approvalRef`를 등록·활성화 요청에 연결한다(`apps/api/src/request-handler.ts:2757-2797`). 관리자 화면 `/admin/ai-provider`에는 승인 참조 입력과 `배포 런타임 활성화` 버튼만 있고 키 입력 UI는 없다(`apps/web/app/admin/ai-provider/ai-provider-control.tsx:33-77`). 화면은 활성 설정과 런타임의 어댑터·버전·해시 일치 여부를 표시한다.

호출 시도는 `audit_log`의 `ai_call` 한 건으로 관측한다. 허용된 outcome, 실패 분류, HTTP 상태, 재료 수, 저장 건수, 처리 시간, 모델, 프롬프트 버전만 기록하고 보낸 텍스트와 받은 텍스트는 기록하지 않는다(`db/gateway.ts:8062-8132,8142-8184`). 이 content-free 관측 계약은 D57, D68의 가상 데이터 범위와 함께 실호출 가동의 전제다.

## 가동 전제와 불변 경계

1. 사업자는 D57에 따라 OpenAI 단일 수령자 구조를 유지한다. 프로바이더 슬러그 `codex`는 설정 해시 튜플의 일부이므로 임의로 바꾸지 않는다(`docs/adr/0027-openai-provider-and-masked-text-queue.md:15-27`).
2. 외부로 나가는 재료는 처리 장비의 2차 마스킹 스냅샷뿐이다. 음성 또는 원문 텍스트를 스모크 픽스처나 운영 요청에 직접 넣지 않는다(D57, ADR-0027).
3. D68에 따라 실서비스 데이터가 아닌 synthetic 마스킹 픽스처로 preview를 먼저 검증한다. 실제 당사자 데이터, 실명, 연락처, 계좌, 원본 전사, 키 값은 명령, 로그, 문서, 요청 본문에 넣지 않는다.
4. 호출 ①의 승인 대상 출력은 사람이 검토하는 제안일 뿐 자동 결정이 아니다. 호출 ②는 승인 대상이 아닌 불일치 원문 쌍이며, 양쪽 중 어느 것이 맞는지 판단하지 않는다.
5. AI 호출이 실패해도 수기 기록과 기존 폴백을 막지 않는다. 실패 원인은 닫힌 분류와 상태 코드로만 관측한다.

## 가동 runbook

아래 순서를 preview와 production에 동일하게 적용한다. 앞 단계가 관찰 가능한 성공 상태가 아니면 다음 단계로 진행하지 않는다.

### 1. Infisical에서 Workers 시크릿 주입

1. 기관이 승인한 Infisical 프로젝트와 환경을 선택한다. 원본 시크릿 이름은 `CODEX_API_KEY`로 고정한다.
2. Infisical의 비대화형 주입 경로에서 키 이름만 확인하고, 값을 화면, 셸 기록, CI 로그, stdout, 명령 인자에 노출하지 않은 채 해당 Workers 환경의 시크릿 저장소로 전달한다. `--plain`처럼 값을 출력하는 추출 경로, 클립보드 복사, 문서·티켓 붙여넣기는 사용하지 않는다.
3. preview를 먼저 주입하고 Workers 시크릿 이름의 존재만 확인한다. production은 preview smoke 승인 뒤 같은 방식으로 별도 주입한다. 환경 간 키를 복사하거나 문서에 보관하지 않는다.
4. 이 단계의 체크리스트는 `docs/ai-provider-setup-q-actions.md:39-55`를 따른다. 키 발급, 결제 수단, 사용 한도, 모델 접근 여부 확인을 끝낸 뒤 체크리스트의 상태와 담당자 기록을 갱신한다. 실제 값은 체크리스트에 적지 않는다.

### 2. `AI_PROVIDER_CONFIG` 구성과 배포

1. Q가 승인한 모델명을 확인한 뒤 다음 다섯 필드만 포함하는 JSON을 구성한다. `registryVersion`은 `phase1.v1`, `providerId`는 `codex`, `adapterVersion`은 `v1`, `configVersion`은 승인한 설정 버전, `model`은 승인한 모델명이다.
2. 앞 네 필드는 코드 계약과 일치해야 하며, 모델명은 계정에서 실제 사용 가능한 값이어야 한다. JSON을 로그에 출력해 확인하지 말고 배포 설정의 이름과 해시 계산 결과로 검증한다.
3. 선택한 모델과 버전 튜플로 Worker를 배포한다. 배포 후 `GET /ai/provider/status`의 런타임 설정이 `configured`인지 확인하되 키나 요청·응답 본문은 읽거나 저장하지 않는다.
4. 현재 preview 파일의 모델 표기는 `gpt-5.6-luna`지만 실제 사용 가능 여부는 계정 확인이 필요하다. `docs/ai-provider-setup-q-actions.md:41-45`의 계정별 모델 확인 절차를 선행한다.

### 3. 외부 호출 스위치 전환

1. preview 승인 환경에서만 `EXTERNAL_AI_CALLS_ENABLED`를 정확히 `1`로 전환한다. 배포 환경의 변수 이름만 기록하고 값은 문서나 로그에 남기지 않는다.
2. 스위치 전환 뒤 설정, 키, 스위치가 모두 존재하는지 이름과 fail-closed 상태 변화로 확인한다. 설정 또는 키가 없으면 호출하지 않고 원인을 `config_missing`, `config_invalid`, `api_key_missing` 중 하나로 남긴다.
3. preview synthetic smoke가 통과하기 전에는 production 스위치를 전환하지 않는다. production 기본값은 계속 OFF로 두고, 운영 전환 승인 시에만 같은 순서를 적용한다.

### 4. 런타임 활성화 API 호출

1. 기관 관리자가 Cloudflare Access를 통과한 세션에서 `POST /ai/provider/activate-runtime`을 호출한다. 본문에는 승인 참조 필드 `approvalRef`만 넣는다(`apps/api/src/request-handler.ts:2768-2774`).
2. `approvalRef`에는 D66의 키 등급 확인, 공식 기업용 API 여부, 약관 확인, 확인일, 확인 주체를 가리키는 내부 참조를 적는다. 키 값이나 원문 약관, 개인 연락처는 넣지 않는다.
3. API가 현재 환경의 설정과 키를 검증하고 계산한 해시로 `ai_provider_configs`를 append-only 등록한 뒤 `ai_provider_activations`를 활성화하는지 확인한다(`apps/api/src/request-handler.ts:2773-2797`). 직접 DB를 수정해 활성화하지 않는다.

### 5. 관리자 화면에서 일치 확인

1. `/admin/ai-provider`에서 활성 상태, 프로바이더·어댑터 버전, 잘린 설정 해시를 확인한다.
2. 같은 화면의 배포 런타임이 `configured`이고 활성 설정과 `matches=true`인지 확인한다. 화면의 `불일치` 또는 `설정 안 됨`은 가동 성공이 아니며, 원인을 고친 뒤 2단계부터 다시 진행한다(`apps/web/app/admin/ai-provider/ai-provider-control.tsx:27-56`).
3. API의 `GET /ai/provider/status`에서도 활성 설정 해시와 런타임 해시의 일치를 확인한다. 해시 전문은 필요한 운영자만 볼 수 있게 하고 문서에는 식별용 축약값만 남긴다.
4. 이 단계가 끝난 뒤에만 smoke에서 각 호출을 한 번씩 실행한다. 활성화하지 않은 환경에서 실제 호출이 발생할 것으로 가정하지 않는다.

## 모델 정책

### 제안 정책

- 기본 모델 제안: `gpt-5-mini`. 상담 기록 정리와 인용 대조는 짧은 구조화 출력이 중심이므로 비용과 지연을 우선한다. 단, 계정에서 실제 사용 가능한지 확인하기 전에는 확정하지 않는다.
- allowlist 제안: `gpt-5-mini`, `gpt-5.4-mini`, `gpt-5.6-luna`. 이 목록은 현재 문서와 preview 설정에 등장한 후보를 정리한 제안일 뿐, OpenAI 계정에서 제공되는 모델 목록을 뜻하지 않는다.
- 모델 값은 `modelPattern`을 통과해야 하며, `AI_PROVIDER_CONFIG`의 설정 해시와 함께 활성화된다(`apps/api/src/ai-provider.ts:59-64,490-519`). allowlist 밖의 모델은 설정 단계에서 거부한다.

### 401과 404 대응

- 401: 키 부재와 구분해 `http_status` 및 상태 코드 401로 기록한다. 먼저 해당 Workers 환경에서 `CODEX_API_KEY`가 존재하는지 이름만 확인하고, Infisical 원본과 공식 기업용 API 등급·약관을 D66 기준으로 다시 확인한다. 키를 로그나 채팅에 복사하지 않고 필요하면 키를 회전한다. 키 확인 뒤에도 모델 설정을 임의로 바꾸지 않는다.
- 404: 현재 `AI_PROVIDER_CONFIG.model`과 계정에서 확인한 모델명을 대조한다. 모델명, 레지스트리 튜플, 배포 환경을 바로잡고 Worker를 재배포한다. 모델을 바꿀 때는 2단계부터 다시 실행하고 새 설정 해시를 활성화한다.
- 두 오류 모두 응답 본문을 기록하거나 재전송하지 않는다. 현재 어댑터는 상태 코드 외 본문을 보존하지 않는다(`apps/api/src/ai-provider.ts:1361-1375`).

### 프롬프트·스키마 버전 상승

`providerMetadata`와 `canonicalAiProviderConfigHash`가 프롬프트·스키마 버전을 해시에 포함하므로, 버전 상승 뒤 기존 활성 설정과 새 Worker의 해시가 달라지는 것은 D69의 의도된 fail-closed 동작이다(`apps/api/src/ai-provider.ts:538-566`, `docs/adr/0036-ai-call-1-material-contract.md:83-85`). 재활성화 절차는 다음과 같다.

1. 새 프롬프트와 스키마를 코드에 배포하되 외부 호출 스위치는 OFF로 유지한다.
2. 미적용 마이그레이션이 있다면 preview DB에 먼저 적용한다. 실데이터를 사용하지 않는다.
3. 배포된 코드가 계산한 새 튜플과 해시를 확인한다. 해시를 사람이 조립하거나 이전 값을 복사하지 않는다.
4. 같은 `providerId`, `adapterVersion`, `configVersion`, `model`에 새 버전의 해시와 새 `approvalRef`를 연결해 등록하고 활성화한다. 기존 설정 행을 수정하지 않는다.
5. 관리자 화면과 `GET /ai/provider/status`에서 `matches=true`를 확인한다.
6. synthetic smoke 통과 뒤에만 스위치를 다시 ON으로 전환한다. 운영은 preview 결과와 Q 승인을 확인한 뒤 같은 절차를 반복한다.

## 호출 정책과 비용 관측

- 현재 `CodexProviderAdapter`는 20초 단발 타임아웃이고 자동 재시도가 없다(`apps/api/src/ai-provider.ts:51-52,1331-1378`). 이 스펙에서 호출 ①은 사용자가 재생성을 요청하는 경로를 유지하며 자동 재시도를 도입하지 않는다.
- 호출 ②는 best-effort로 유지한다. 호출 ① 실패가 호출 ②를 막지 않으며, 호출 ② 실패가 수기 기록과 승인 흐름을 막지 않는다.
- 429와 5xx에 한해 백오프 1회를 추가할지는 다음 결정 포인트로 둔다. 도입하더라도 전체 요청 예산, 최대 대기 시간, 동일 호출의 감사 중복 기록 방식을 먼저 정해야 한다.
- 비용 상한 제안은 기관별 일일 상한과 월간 상한을 모두 두고, 초기 preview는 낮은 상한으로 시작하는 것이다. 정확한 금액, 초과 시 차단 주체, 알림 수신자는 Q가 계정 요금제와 파일럿 규모를 확인한 뒤 정한다.
- content-free 관측은 현재 `audit_log`의 `ai_call`을 기준으로 한다. `kind`, `outcome`, `reason`, 상태 코드, `sourceCount`, `storedCount`, `durationMs`, `model`, `promptVersion`만 집계하고 텍스트·프롬프트·응답·키는 집계 대상에서 제외한다(`db/gateway.ts:8115-8132,8150-8184`).
- 운영자는 `ai_call`의 성공·실패 건수, 호출 종류별 지연, 상태 코드, 모델별 횟수를 확인한다. 사업자 비용은 사업자 관리 콘솔의 기간별 usage와 비용 합계로 대조하되 콘텐츠를 내려받지 않는다. 응답의 usage 수치를 애플리케이션 감사 로그에 추가할지는 Q가 관측 설계에서 결정한다.
- 상한 도달 또는 예산 알림 발생 시 `EXTERNAL_AI_CALLS_ENABLED`를 OFF로 되돌리고, 대기 중인 호출은 재시도하지 않는다. 원인과 조치 시각만 운영 기록에 남긴다.

## Synthetic smoke 검증 계획

D68에 따라 모든 입력은 가상·마스킹 픽스처다. 픽스처에는 실명, 주소, 전화번호, 이메일, 계좌, 실제 상담 원문, 실제 당사자 식별자가 없어야 하며, 마스킹 이후에도 원문 복원이 가능하지 않게 만든다. D68의 preview 시드 전용 원칙과 D57의 스냅샷 게이트를 위반하면 smoke를 중단한다.

### 공통 준비

1. preview에서 위 runbook 1단계부터 5단계까지 완료하고 Q의 외부 호출 승인 참조를 확보한다.
2. 가상 회기 하나와 가상 마스킹 스냅샷을 만들고, 전사와 text context를 각각 opaque source reference로 준비한다. 실데이터를 섞지 않는다.
3. 호출 시도 전 `ai_call` 감사 로그가 비어 있거나 기준 시각 이후 구간을 명확히 확인한다. 키, 프롬프트, 입력과 응답 본문은 조회하지 않는다.

### 호출 ① 1회

1. 가상 회기의 마스킹 스냅샷을 재료로 AI 초안 생성 또는 사용자 재생성 경로를 한 번 실행한다.
2. HTTP 성공 여부와 함께 strict JSON 형식이 `claims`, `questions`, `oneLiner`, `contrast`, `flagSuggestions`를 갖는지 확인한다. claims의 3구획, 질문 2~3개, 대조 3축, 전사 인용만 허용되는 플래그 제안 규칙을 검증한다.
3. evidence reference가 픽스처의 opaque source와 정확히 일치하는지, 금지된 진단·결정·개인정보가 없는지 확인한다.
4. 저장된 초안과 승인 대기 상태가 가상 회기에 연결되는지 확인한다. 저장 실패는 smoke 실패이며 재시도로 숨기지 않는다.
5. 기준 시각 이후 `ai_call` 한 건이 `kind=draft_generation`으로 남고, outcome이 `stored` 또는 정상 빈 결과의 `empty`인지 확인한다. `sourceCount`, `storedCount`, `durationMs`, `model`, `promptVersion`만 확인한다.

### 호출 ② 1회

1. 호출 ①과 독립적으로, 같은 가상 회기의 충돌하는 문장을 포함한 가상 마스킹 source 두 개로 불일치 검출을 한 번 실행한다.
2. strict JSON의 최상위 `discrepancies` 배열과 각 항목의 `kind`, 양쪽 source reference, 양쪽 원문 인용을 확인한다. 어느 쪽이 맞는지 판단, 요약, 진단, 권고가 없어야 한다.
3. 저장된 불일치 결과가 가상 회기의 브리핑 데이터에 연결되는지 확인한다. 결과가 없을 때도 빈 배열이 정상 저장되는지 확인한다.
4. 기준 시각 이후 `ai_call` 한 건이 `kind=discrepancy_detection`으로 남고, outcome과 source·stored count가 호출 결과와 일치하는지 확인한다.
5. 호출 ①을 실패시킨 별도 검증을 smoke의 성공 조건으로 삼지 않는다. 호출 ②가 호출 ①과 독립적으로 실행되는지만 확인하고, 호출 ②의 자동 재시도는 하지 않는다.

### smoke 실패 처리

네트워크 또는 타임아웃은 `provider_error`의 `network`, 상태 오류는 `provider_error`의 `http_status`와 상태 코드, JSON 또는 스키마 문제는 `malformed_response` 또는 `output_rejected`로 분류한다. 감사 로그에 입력·출력·키가 들어갔으면 즉시 실패로 판정하고 스위치를 OFF로 되돌린다. 실패 원인을 수정한 뒤 새 기준 시각으로 전체 smoke를 다시 수행한다.

## 키 회전 runbook

1. D66에 따라 기관 관리자가 새 키의 공식 기업용 등급과 약관을 확인하고, 확인일과 확인 주체를 새 `approvalRef`로 남긴다. 키 값은 기록하지 않는다.
2. Infisical의 `CODEX_API_KEY` 원본을 교체하고 같은 이름으로 Workers 시크릿을 주입한다. 이전 키와 새 키를 동시에 로그, 문서, 명령 인자에 노출하지 않는다.
3. Worker 런타임이 새 시크릿을 읽도록 해당 환경을 재배포하거나 승인된 시크릿 갱신 절차를 완료한다. 설정 JSON의 모델과 버전은 키 회전만으로 바꾸지 않는다.
4. `POST /ai/provider/activate-runtime`을 새 `approvalRef`로 다시 실행한다. 응답과 관리자 화면에서 런타임 설정, 활성 상태, 해시 일치를 확인한다. 순서는 시크릿 교체 후 활성화 재실행으로 고정한다.
5. 키는 설정 해시에 포함되지 않으므로 같은 설정이 이미 활성화된 경우 API가 `replayed=true`를 반환할 수 있다(`apps/api/src/request-handler.ts:2775-2783`). 이 경우 새 키의 D66 승인 참조가 실제 append-only 이력에 남았는지 확인할 수 있어야 운영 완료로 판정한다. 현재 경로가 replay 시 새 승인 참조를 저장하지 않는다면, Q 결정과 구현 없이는 production 키 회전을 완료한 것으로 기록하지 않는다.
6. 회전 직후 synthetic 호출 ①과 ②를 각각 한 번 실행할지 여부는 운영 변경창의 smoke 정책에 따르되, 실행한다면 이 문서의 D68 데이터 경계를 그대로 적용한다. 이전 키로의 재시도는 하지 않는다.

## 결정 포인트 (Q 확인 대상)

1. 기본 모델을 `gpt-5-mini`로 정하고 allowlist를 `gpt-5-mini`, `gpt-5.4-mini`, `gpt-5.6-luna`로 둘지, 계정에서 확인한 공식 모델 목록으로 다시 좁힐지 결정한다. `gpt-5.6-luna`의 계정 제공 여부는 미확인이다.
2. 429와 5xx에 한해 백오프 1회를 허용할지 결정한다. 허용한다면 최대 대기 시간, 비용 상한 계산, 감사 로그를 한 시도로 볼지 두 시도로 볼지를 함께 정한다.
3. 기관별 일일·월간 비용 상한 금액, 초과 시 자동 OFF 여부, 알림 담당자를 결정한다.
4. 사업자 usage의 토큰·비용 수치를 애플리케이션에 숫자만 저장할지, 사업자 콘솔 집계만 사용할지 결정한다. 어느 선택에서도 콘텐츠 저장은 금지한다.
5. 키 회전처럼 모델과 설정 해시가 같은 경우 새 `approvalRef`를 append-only 이력에 남길 방법을 결정한다. 기존 `activate-runtime`의 `replayed=true` 경로를 그대로 허용할지, 별도 승인 기록을 추가할지 정한다.
6. 실제 당사자 데이터로 전환할 시점과 OpenAI의 최신 보관·삭제 조건을 법률 검토 트랙에서 재개할지 결정한다. D68 파일럿이 가상 데이터 전용이라는 사실은 이 결정을 대체하지 않는다.
7. preview smoke 통과 뒤 production으로 전환하는 승인자와 승인 참조 형식을 결정한다. 승인되지 않은 production 스위치 전환은 허용하지 않는다.

## 구현 단계 분할

### (a) Runbook 문서화와 Q 승인

- 범위: Infisical 주입, 모델·allowlist, switch 순서, activation, 해시 확인, smoke, 키 회전 절차를 운영 문서와 체크리스트에 반영한다.
- 완료 기준: Q가 모델 후보, 429·5xx 재시도 여부, 비용 상한, usage 관측, 키 회전 승인 이력 방식을 결정 포인트별로 확인한다. `docs/ai-provider-setup-q-actions.md`의 해당 체크리스트에 값이 아닌 상태와 담당자 참조가 갱신된다.
- 관찰 증거: 승인 참조가 있고, 시크릿 값과 콘텐츠가 문서·로그·티켓에 없으며, preview와 production의 가동 순서가 동일하다.

### (b) Preview 스위치 전환과 synthetic smoke

- 범위: 가상 마스킹 픽스처만으로 preview의 호출 ①과 호출 ②를 각각 한 번 실행한다.
- 완료 기준: 각 호출이 strict JSON 검증을 통과하고, 기대하는 저장 결과가 생기며, `ai_call` 감사 기록이 호출 종류와 outcome, 상태 코드, 건수, 시간, 모델·프롬프트 버전만 남긴다. 입력·출력·키가 남지 않아야 한다.
- 관찰 증거: 관리자 화면과 `GET /ai/provider/status`에서 런타임과 DB 활성 설정의 해시가 일치하고, 호출 ①과 호출 ②의 결과와 감사 건수가 각각 확인된다.

### (c) Production 가동

- 범위: preview smoke와 Q 승인 뒤 production에 동일한 설정, 키 주입, 스위치, activation 순서를 적용한다. 실서비스 전환 전까지는 실제 당사자 데이터 호출을 하지 않는다.
- 완료 기준: D66의 공식 기업용 API와 약관·등급 확인이 `approvalRef`로 남고, production 관리자 화면과 API가 `matches=true`를 보이며, 비용 상한과 content-free 관측 경로가 확인된다.
- 관찰 증거: production의 첫 호출은 승인된 전환 창 안에서만 발생하고, `ai_call` 집계에 허용된 필드만 있으며, 실패 시 OFF로 되돌릴 운영자가 지정되어 있다. 법률 검토와 실제 당사자 운영 개시 조건이 해소되지 않았다면 production 실호출을 완료로 판정하지 않는다.
