# STT 다중 엔진과 동의 4영역 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whisper, CLOVA, RTZR, Qwen3-ASR을 설정 하나로 교체 가능한 상태로 만들고, 원본 음성 외부 처리에 필요한 동의 4영역과 운영 게이트를 함께 구현한다.

**Architecture:** `transcribe_audio`의 무음 청크, 반복 검사, 시간 보정은 그대로 두고 각 엔진은 `Engine = Callable[[str], list[Segment]]`만 구현한다. 로컬 엔진과 외부 엔진은 같은 registry를 쓰지만 외부 엔진은 기관별 BYOK, 승인된 provider, 동의 증거가 모두 있을 때만 실행한다. 동의는 현재값과 append-only 사건 이력을 분리하며, 구 2종 동의를 새 4영역 동의로 자동 승격하지 않는다.

**Tech Stack:** Python 3, Whisper, Qwen3-ASR, CLOVA Speech API, RTZR Batch STT API, pyannote.audio, Cloudflare Workers, D1과 PostgreSQL, TypeScript, Vitest, unittest

> **Superseded by ADR-0041 in part:** 이 2026-08-31 계획에서 사용한 D76~D79 초안 번호와 의미는 비정본이며 ADR-0041의 D76~D83 번호와 의미로 대체한다. 네 엔진 운영 목록, Whisper 기본값, CLOVA·RTZR 원음 외부 처리 전제와 동의 4영역도 ADR-0041 D77 및 ADR-0040 §9의 정본으로 대체한다. D53의 무음 경계 청크, 반복 검사와 엔진 추상화, 외부 provider의 자동 폴백 금지 등 안전장치는 보존한다. 이 계획은 조사와 역사 기록으로 남긴다.

## Global Constraints

- D78의 엔진 목록은 `whisper`, `clova`, `rtzr`, `qwen3-asr` 네 개다.
- 기본 엔진은 실제 비교와 법률 게이트가 끝날 때까지 `whisper`다.
- D53의 무음 경계 청크, 반복 검사, 반쪽 1회 재시도, 구조화 warning은 모든 엔진에 동일하게 적용한다.
- D64에 따라 감정 분석은 계속 보류한다.
- 2차 NER가 설정되지 않으면 파이프라인은 기동하지 않는다.
- CLOVA와 RTZR에는 2차 마스킹 전 원본 음성이 전달된다. 동의, DPA, 보관과 삭제 확인 전에는 가상 데이터와 preview에서만 사용한다.
- 기관마다 provider와 자격 증명을 따로 둔다. 중앙 키 풀과 중앙 원본 음성 gateway를 만들지 않는다.
- 엔진 실패 시 다른 엔진으로 자동 전환하지 않는다. 수기 메모 폴백을 사용한다.
- CLOVA 결과와 로그 7일 보관, RTZR 결과 3일 보관은 2026-08-30 공식 문서 확인값이다. RTZR 처리 위치와 AWS 오리건 고지는 계약 검토 전 해결되지 않은 것으로 취급한다.
- Azure Speech Korea Central은 공개 리전 보증이 가장 강한 후속 후보지만 D78 네 엔진 목록에는 넣지 않는다. 추가는 새 Q 결정으로만 한다.
- 구 2종 동의 기록은 역사 증거로 보존한다. 새 4영역의 현재 동의값과 실행 게이트로 재사용하지 않는다.
- 화면 수정은 `DESIGN-RULES.md`와 `design-lane`을 따른다.
- 시크릿 값, 원문 음성, 전사, PII는 로그와 오류 메시지에 넣지 않는다.

---

## File Map

### 새 파일

- `apps/pipeline/ccc_pipeline/stt_clova.py`: CLOVA 요청, 결과 poll, Segment 변환.
- `apps/pipeline/ccc_pipeline/stt_rtzr.py`: 인증 토큰, 제출, poll, Segment 변환.
- `apps/pipeline/ccc_pipeline/stt_qwen.py`: Qwen 모델 lazy load와 Segment 변환.
- `apps/pipeline/tests/test_stt_clova.py`: HTTP 응답 계약과 오류 분류.
- `apps/pipeline/tests/test_stt_rtzr.py`: 인증과 poll 계약.
- `apps/pipeline/tests/test_stt_qwen.py`: lazy load, model id, Segment 계약.
- `apps/pipeline/ccc_pipeline/stt_policy.py`: 기관 provider 설정과 동의 실행 게이트.
- `apps/pipeline/tests/test_stt_policy.py`: 외부 provider fail-closed 조건.
- `docs/aside/2026-08-30-cloud-stt-vendor-matrix.md`: 공식 출처, 가격, 리전, 보관, 미확인 항목의 추적 가능한 요약.
- `scripts/stt/benchmark.py`: G1부터 G3까지 동일 입력셋 실행기.
- `scripts/stt/report.py`: CER, 반복률, DER, RTF, 비용을 내용 없이 집계.
- `apps/api/test/participant-consent-four-domains.test.ts`: 현재값, 이력, 철회, 실행 게이트.
- `migrations/sqlite/0045_consent_four_domains.sql`: 4영역 현재값과 append-only 사건 표.
- `docs/consent/consent-four-domains-draft-v1.md`: 변호사 검토용 초안.

### 수정 파일

- `CLAUDE.md`: D78, D79와 모델 정보, 미결 항목 갱신.
- `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md`: STT와 동의 결정.
- `apps/pipeline/ccc_pipeline/transcribe.py`: 엔진 상수와 lazy builder 등록.
- `apps/pipeline/ccc_pipeline/config.py`: 엔진별 설정 이름과 검증.
- `apps/pipeline/ccc_pipeline/worker.py`: 기관 provider 정책과 동의 게이트 적용.
- `apps/pipeline/README.md`: 설치, 설정, 비교, 운영 게이트.
- `apps/pipeline/requirements-ml.txt`: Qwen 런타임에 실제 필요한 패키지만 추가.
- `apps/pipeline/tests/test_transcribe.py`: 네 엔진 registry와 공통 안전장치.
- `db/consent-notice.ts`: 4영역 문안 버전과 해시.
- `db/gateway.ts`: 현재 동의값, 사건 이력, provider와 목적 증거, 파이프라인 실행 허용 함수.
- `apps/api/src/request-handler.ts`: 4영역 등록, 수정, 철회 API.
- `apps/api/test/participant-consent.test.ts`: 구 2종 역사 기록 보존 테스트로 범위 변경.
- `apps/web/app/participants/new/register-form.tsx`: 4영역 동의 UI.
- `apps/web/app/participants/[beneficiaryId]/page.tsx`: 현재값과 철회 UI.
- `apps/web/app/participants/[beneficiaryId]/consent-editor.test.tsx`: 동의 편집 회귀 테스트.
- `apps/web/app/participants/new/consent-copy.test.ts`: 문안 SSOT와 화면 일치.
- `docs/consent/legal-review-open-items-v1.md`: 처리위탁, 국외 이전, 민감정보, 신용정보 쟁점.
- `docs/ops.md`: 기관별 BYOK, provider pin, G1부터 G3, 장애 폴백.

## Interfaces

```python
Engine = Callable[[str], list[Segment]]

@dataclass(frozen=True)
class SttProviderPolicy:
    engine: str
    org_id: str
    provider: str
    purpose: str
    external_audio: bool
    credentials_present: bool
    consent_evidence_id: str | None
    contract_approval_ref: str | None
```

```ts
export type ConsentDomain =
  | 'privacy'
  | 'sensitive_information'
  | 'recording_stt_outsourcing'
  | 'ai_processing';

export interface ConsentScopeEvent {
  id: string;
  orgId: string;
  beneficiaryId: string;
  supportCaseId: string;
  domain: ConsentDomain;
  decision: 'granted' | 'withdrawn';
  provider: string | null;
  purpose: string;
  noticeVersion: string;
  noticeSha256: string;
  evidenceRef: string;
  effectiveAt: string;
  recordedBy: string;
}
```

모든 녹음 경로는 `recording_stt_outsourcing`의 최신 사건이 granted여야 한다. 로컬 엔진은 `provider='local'`, 외부 엔진은 선택한 provider 이름이 증거와 같아야 하며 외부 엔진에는 계약 승인 참조도 필요하다. AI 요약은 `ai_processing` 동의를 별도로 확인한다. 개인정보와 민감정보 동의는 등록 및 해당 데이터 처리의 독립 게이트다.

---

### Task 1: D78, D79 정본과 벤더 연구 보존

> **부분 대체 표식 (ADR-0041):** 이 Task의 네 엔진과 동의 4영역을 정본으로 기록하는 단계는 현재 정책에 적용하지 않는다. 벤더 연구와 D53 안전장치의 역사적 근거는 보존한다.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md`
- Create: `docs/aside/2026-08-30-cloud-stt-vendor-matrix.md`

**Interfaces:**
- Produces: 네 엔진 목록, 운영 제한, 동의 대체 관계, 벤더 미확인 항목의 정본.

- [ ] **Step 1: 8월 30일 연구의 검증된 주장만 추출한다**

추적 원본은 `.omo/ulw-research/20260830-185405-cloud-stt/`다. tracked 문서에는 다음과 공식 URL만 옮긴다.

1. CLOVA 서비스 리전 한국, 결과와 로그 7일, 학습은 동의 시.
2. RTZR 결과 3일, 처리 위치 공개 미확인, AWS 오리건 관련 고지.
3. Azure Korea Central의 리전 내 처리 문구.
4. AWS 서울은 Organizations AI 서비스 opt-out 필요.
5. 독립된 한국어 상담체 상용 엔진 벤치마크 부재.

검색 결과와 추론을 섞지 않고 `확인`, `미확인`, `운영 판단` 세 열로 나눈다.

- [ ] **Step 2: ADR-0040과 CLAUDE.md에 D78, D79를 기록한다**

D78은 네 엔진과 자동 폴백 금지를, D79는 4영역과 구 2종 자동 승격 금지를 명시한다.

- [ ] **Step 3: 문서 가드를 실행한다**

```bash
pnpm guard:doc-numbers
pnpm guard:secrets
```

Expected: PASS.

- [ ] **Step 4: 커밋한다**

```bash
git add CLAUDE.md docs/adr/0040-seoul-region-supabase-auth-stt-consent.md docs/aside/2026-08-30-cloud-stt-vendor-matrix.md
git commit -m "docs(decisions): STT 다중 엔진과 동의 4영역 기록"
```

---

### Task 2: 네 엔진 registry와 설정 계약

**Files:**
- Modify: `apps/pipeline/ccc_pipeline/transcribe.py:30-70`
- Modify: `apps/pipeline/ccc_pipeline/config.py`
- Modify: `apps/pipeline/tests/test_transcribe.py:37-47`
- Create: `apps/pipeline/tests/test_stt_config.py`

**Interfaces:**
- Produces: `KNOWN_ENGINES = ('whisper', 'clova', 'rtzr', 'qwen3-asr')`.
- Produces: `build_engine(name: str, config: PipelineConfig) -> Engine`.

- [ ] **Step 1: `build_engine` 참조를 LSP로 확인한다**

`worker.py`와 테스트 호출부를 모두 목록화하고 기존 `model_name` 인자를 `PipelineConfig`로 바꾸는 영향을 고정한다.

- [ ] **Step 2: 실패하는 registry 테스트를 작성한다**

네 이름이 정확히 한 번씩 등록되고 알 수 없는 이름은 ValueError, 자격 증명이 없는 외부 엔진은 config 오류, Qwen model id가 없으면 config 오류가 나야 한다.

Run:

```bash
(cd apps/pipeline && python3 -m unittest tests.test_transcribe tests.test_stt_config)
```

Expected: FAIL because three engines are not registered.

- [ ] **Step 3: 설정 이름을 구현한다**

필수 이름:

- `CCC_STT_ENGINE`
- `CCC_WHISPER_MODEL`
- `CCC_QWEN_MODEL_ID`
- `CCC_CLOVA_ENDPOINT`, `CCC_CLOVA_API_KEY`, `CCC_CLOVA_TIMEOUT_SECONDS`, `CCC_CLOVA_COMPLETION`
- `CCC_RTZR_ENDPOINT`, `CCC_RTZR_CLIENT_ID`, `CCC_RTZR_CLIENT_SECRET`, `CCC_RTZR_TIMEOUT_SECONDS`, `CCC_RTZR_POLL_INTERVAL_SECONDS`, `CCC_RTZR_POLL_TIMEOUT_SECONDS`, `CCC_RTZR_MODEL`

선택된 엔진의 값만 필수다. 선택하지 않은 provider의 시크릿을 요구하지 않는다.

- [ ] **Step 4: lazy builder registry를 구현한다**

`transcribe.py`는 엔진 모듈을 import할 뿐 provider HTTP와 모델 로딩 구현을 포함하지 않는다. import는 선택된 엔진을 만들 때만 발생한다.

- [ ] **Step 5: 테스트를 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest tests.test_transcribe tests.test_stt_config)
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add apps/pipeline/ccc_pipeline/transcribe.py apps/pipeline/ccc_pipeline/config.py apps/pipeline/tests/test_transcribe.py apps/pipeline/tests/test_stt_config.py
git commit -m "feat(stt): 네 엔진 registry와 설정 계약 추가"
```

---

### Task 3: Qwen3-ASR 로컬 어댑터

**Files:**
- Create: `apps/pipeline/ccc_pipeline/stt_qwen.py`
- Create: `apps/pipeline/tests/test_stt_qwen.py`
- Modify: `apps/pipeline/requirements-ml.txt`
- Modify: `apps/pipeline/README.md`

**Interfaces:**
- Produces: `build_qwen_engine(model_id: str) -> Engine`.

- [ ] **Step 1: 모델 API를 실제 설치 버전의 공식 문서로 고정한다**

Qwen3-ASR-1.7B의 라이선스, 로딩 함수, timestamp 출력 형식을 공식 모델 카드와 소스에서 확인한다. 모델 카드에 없는 반환 형식은 추정하지 않는다.

- [ ] **Step 2: 가짜 모델 응답 계약 테스트를 작성한다**

lazy load 1회, 한국어 고정, start와 end 초 단위 변환, 빈 텍스트 제외, 잘못된 timestamp 거부를 검증한다. 실제 모델 가중치는 CI에서 받지 않는다.

- [ ] **Step 3: 좁은 어댑터를 구현한다**

청크 분할과 반복 검사를 중복 구현하지 않는다. 어댑터는 파일 하나를 받고 Segment 목록만 돌려준다.

- [ ] **Step 4: 테스트를 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest tests.test_stt_qwen tests.test_transcribe)
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/pipeline/ccc_pipeline/stt_qwen.py apps/pipeline/tests/test_stt_qwen.py apps/pipeline/requirements-ml.txt apps/pipeline/README.md
git commit -m "feat(stt): Qwen3-ASR 로컬 어댑터 추가"
```

---

### Task 4: CLOVA 어댑터

**Files:**
- Create: `apps/pipeline/ccc_pipeline/stt_clova.py`
- Create: `apps/pipeline/tests/test_stt_clova.py`
- Modify: `apps/pipeline/README.md`

**Interfaces:**
- Produces: `build_clova_engine(config: ClovaConfig, fetcher: HttpFetcher = default_fetcher) -> Engine`.

- [ ] **Step 1: 실패와 정상 응답 fixture를 작성한다**

공식 응답의 `segments[].start`, `segments[].end` 밀리초를 초로 바꾸고 `text`, speaker label을 보존한다. 인증 실패, 429, 5xx, timeout, malformed response에서 원문 body를 로그에 남기지 않는다.

- [ ] **Step 2: completion 정책을 sync로 고정한다**

3분 이하 청크를 쓰므로 첫 구현은 sync만 허용한다. async, callback, Object Storage 결과 저장은 추가하지 않는다. 응답 제한으로 sync가 불가능하다는 공식 증거가 생기면 별도 결정으로 바꾼다.

- [ ] **Step 3: 자동 재시도 없이 구현한다**

429와 5xx는 분류된 실패를 돌려준다. 파이프라인은 다른 엔진으로 넘어가지 않고 수기 메모 폴백을 유지한다.

- [ ] **Step 4: 테스트를 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest tests.test_stt_clova tests.test_transcribe)
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/pipeline/ccc_pipeline/stt_clova.py apps/pipeline/tests/test_stt_clova.py apps/pipeline/README.md
git commit -m "feat(stt): CLOVA Speech 어댑터 추가"
```

---

### Task 5: RTZR 어댑터

**Files:**
- Create: `apps/pipeline/ccc_pipeline/stt_rtzr.py`
- Create: `apps/pipeline/tests/test_stt_rtzr.py`
- Modify: `apps/pipeline/README.md`

**Interfaces:**
- Produces: `build_rtzr_engine(config: RtzrConfig, fetcher: HttpFetcher = default_fetcher) -> Engine`.

- [ ] **Step 1: 인증과 poll fixture를 작성한다**

`/v1/authenticate`, `POST /v1/transcribe`, `GET /v1/transcribe/{id}` 순서를 고정한다. `start_at`과 `duration` 밀리초, `msg`, `spk`를 Segment로 바꾼다.

- [ ] **Step 2: 토큰을 메모리에서만 캐시한다**

만료 전에 갱신하되 토큰과 작업 ID를 로그에 남기지 않는다. 프로세스 재시작 후 디스크 복구는 만들지 않는다.

- [ ] **Step 3: poll 상한과 실패를 구현한다**

고정 간격과 전체 timeout을 config로 받는다. timeout, 410 expired, malformed response, 인증 오류는 원문 없는 분류값으로 끝낸다.

- [ ] **Step 4: 테스트를 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest tests.test_stt_rtzr tests.test_transcribe)
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/pipeline/ccc_pipeline/stt_rtzr.py apps/pipeline/tests/test_stt_rtzr.py apps/pipeline/README.md
git commit -m "feat(stt): RTZR Batch 어댑터 추가"
```

---

### Task 6: 동의 4영역 저장과 실행 게이트

**Files:**
- Create: `migrations/sqlite/0045_consent_four_domains.sql`
- Modify: `db/consent-notice.ts`
- Modify: `db/gateway.ts`
- Create: `apps/api/test/participant-consent-four-domains.test.ts`
- Modify: `apps/api/test/participant-consent.test.ts`

**Interfaces:**
- Produces: `recordConsentScopeEvent(env, actor, input): Promise<ConsentScopeEvent>`.
- Produces: `getCurrentConsentScopes(env, actor, supportCaseId)`.
- Produces: `assertSttProcessingAllowed(env, actor, sessionId, provider)`.
- Produces: `assertAiProcessingAllowed(env, actor, sessionId, provider)`.

- [ ] **Step 1: migration 실패 테스트를 작성한다**

새 현재값은 `support_cases`의 `consent_privacy_at`, `consent_sensitive_at`, `consent_stt_outsourcing_at`, `consent_ai_processing_at`이다. 사건 표는 domain, decision, provider, purpose, 문안 버전과 해시, evidence ref, effective_at, recorded_by를 보존하고 UPDATE와 DELETE를 거부한다.

- [ ] **Step 2: 구 2종 자동 승격 금지 테스트를 작성한다**

기존 `consent_recording_at`과 `consent_text_ai_at`이 있어도 새 STT와 AI 동의는 null이어야 한다. 화면과 실행 게이트는 재동의 필요를 반환한다.

- [ ] **Step 3: migration과 gateway를 구현한다**

현재값 변경과 사건 INSERT는 한 batch 또는 PostgreSQL transaction으로 처리한다. 철회는 새 사건을 추가하고 현재값을 null로 바꾼다. 역사 사건은 수정하지 않는다.

- [ ] **Step 4: provider와 목적 일치 게이트를 구현한다**

CLOVA 동의로 RTZR을 실행할 수 없다. 로컬 `whisper`와 `qwen3-asr`도 같은 녹음 영역 동의를 확인하되 provider는 `local`이어야 한다. AI 요약은 별도의 `ai_processing` 동의를 확인한다.

- [ ] **Step 5: 테스트를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/participant-consent-four-domains.test.ts test/participant-consent.test.ts
pnpm guard:db
pnpm --filter @ccc/api run typecheck
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add migrations db/consent-notice.ts db/gateway.ts apps/api/test/participant-consent-four-domains.test.ts apps/api/test/participant-consent.test.ts
git commit -m "feat(consent): 동의 4영역과 provider 게이트 추가"
```

---

### Task 7: 동의 API와 화면

**Files:**
- Modify: `apps/api/src/request-handler.ts`
- Modify: `apps/web/app/participants/new/register-form.tsx`
- Modify: `apps/web/app/participants/[beneficiaryId]/page.tsx`
- Modify: `apps/web/app/participants/[beneficiaryId]/consent-editor.test.tsx`
- Modify: `apps/web/app/participants/new/consent-copy.test.ts`
- Modify: `apps/api/test/routes.test.ts`
- Create: `docs/consent/consent-four-domains-draft-v1.md`
- Modify: `docs/consent/legal-review-open-items-v1.md`

**Interfaces:**
- Consumes: Task 6 consent gateway 함수.
- Produces: 등록, 수정, 철회 API와 4영역 UI.

- [ ] **Step 1: API 계약 실패 테스트를 작성한다**

각 영역은 독립 입력이다. 민감정보 동의 거부가 개인정보 최소 등록을 자동 허용하지 않고, STT 거부가 수기 기록을 막지 않으며, AI 거부가 공식 수기 기록을 막지 않아야 한다.

- [ ] **Step 2: 문안 SSOT를 작성한다**

화면 문자열은 `db/consent-notice.ts`의 버전과 해시로 고정한다. 법률 초안은 개인정보, 민감정보, 녹음과 STT 처리위탁, AI 처리와 국외 이전을 각각 독립 구획으로 둔다.

- [ ] **Step 3: 등록과 설정 화면을 구현한다**

현재값, 제공자, 목적, 동의와 철회 시각을 표시한다. 이전 2종 동의만 있는 경우 `새 문안 동의 필요`를 표시한다. provider 이름은 승인된 목록에서만 선택한다.

- [ ] **Step 4: 화면 검증을 실행한다**

```bash
pnpm guard:consent-copy
pnpm --filter @ccc/api exec vitest run test/routes.test.ts
pnpm --filter @ccc/web exec vitest run app/participants/new/consent-copy.test.ts
```

브라우저에서 390px, 767px, 768px을 확인한다. 체크박스 label 전체가 클릭되고 철회 후 즉시 현재값이 바뀌어야 한다.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/api/src/request-handler.ts apps/api/test/routes.test.ts apps/web/app/participants/new 'apps/web/app/participants/[beneficiaryId]/page.tsx' 'apps/web/app/participants/[beneficiaryId]/consent-editor.test.tsx' docs/consent db/consent-notice.ts
git commit -m "feat(consent): 4영역 동의 화면과 철회 흐름 추가"
```

---

### Task 8: 기관별 provider 정책과 worker 연결

**Files:**
- Create: `apps/pipeline/ccc_pipeline/stt_policy.py`
- Create: `apps/pipeline/tests/test_stt_policy.py`
- Modify: `apps/pipeline/ccc_pipeline/worker.py`
- Modify: `apps/pipeline/ccc_pipeline/config.py`
- Modify: `apps/pipeline/README.md`
- Modify: `docs/api-contract-pipeline.md`

**Interfaces:**
- Consumes: Workers가 작업 응답에 포함한 provider, purpose, consentEvidenceId, contractApprovalRef.
- Produces: `assert_provider_policy(policy: SttProviderPolicy) -> None`.

- [ ] **Step 1: fail-closed 정책 테스트를 작성한다**

외부 엔진은 다음 중 하나라도 없으면 실행하지 않는다.

1. 기관별 provider 고정.
2. 선택된 provider 자격 증명.
3. STT 처리위탁 동의 증거.
4. provider와 동의 증거 일치.
5. 계약 승인 참조.

- [ ] **Step 2: API 계약에 내용 없는 정책 메타데이터를 추가한다**

원문이나 PII는 넣지 않는다. 처리 장비는 작업을 받기 전에 정책을 검증하고 불일치면 오디오를 다운로드하지 않는다.

- [ ] **Step 3: worker를 registry와 정책에 연결한다**

기존 처리 순서와 작업 디렉터리 삭제는 유지한다. 외부 엔진 실패는 해당 작업 실패로 끝나며 다른 엔진 자동 전환은 없다.

- [ ] **Step 4: 테스트를 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest tests.test_stt_policy tests.test_transcribe)
pnpm --filter @ccc/api exec vitest run test/recording-result.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/pipeline/ccc_pipeline/stt_policy.py apps/pipeline/ccc_pipeline/worker.py apps/pipeline/ccc_pipeline/config.py apps/pipeline/tests/test_stt_policy.py apps/pipeline/README.md docs/api-contract-pipeline.md
git commit -m "feat(stt): 기관별 provider와 동의 실행 게이트 연결"
```

---

### Task 9: G1부터 G3까지 비교 하네스

**Files:**
- Create: `scripts/stt/benchmark.py`
- Create: `scripts/stt/report.py`
- Create: `scripts/stt/test_benchmark.py`
- Modify: `apps/pipeline/README.md`
- Modify: `docs/ops.md`

**Interfaces:**
- Produces: 엔진별 CER, 반복률, DER, RTF, 비용, 안전성 결과 JSON과 Markdown 요약.

- [ ] **Step 1: 결정적 metric 테스트를 작성한다**

문자 편집 거리, 반복 경고 시간 비율, RTF, speaker label 정렬, 비용 계산을 작은 고정 fixture로 검증한다.

- [ ] **Step 2: 입력 manifest를 정의한다**

가상 한국어 대화 10개 이상, 조용한 2인, 겹침, 숫자와 날짜, 짧은 응답, 긴 무음을 포함한다. 실제 당사자 음성은 넣지 않는다.

- [ ] **Step 3: 네 엔진 실행기를 구현한다**

같은 WAV와 같은 청크 설정을 순차 실행한다. 설정값과 engine version hash만 기록하고 시크릿, 원문, 예측 전문은 일반 보고서에 넣지 않는다.

- [ ] **Step 4: 제안 합격선을 계산한다**

- CER 중앙값 15% 이하.
- 반복률 1% 이하.
- RTF 1.0 이하.
- 정답 화자 자료가 있으면 DER 20% 이하.
- 안전성 검사 실패 0건.

합격선은 자동 선택이 아니다. 모든 수치를 기록하고 운영 엔진 선택은 Q 결정으로 남긴다.

- [ ] **Step 5: 테스트와 synthetic smoke를 실행한다**

```bash
python3 -m unittest scripts.stt.test_benchmark
python3 scripts/stt/benchmark.py --manifest fixtures/stt/synthetic/manifest.json --engines whisper,qwen3-asr
```

외부 provider는 승인된 preview 자격 증명이 있을 때 별도 세션에서 실행한다.

- [ ] **Step 6: 커밋한다**

```bash
git add scripts/stt apps/pipeline/README.md docs/ops.md
git commit -m "test(stt): 네 엔진 비교 하네스 추가"
```

---

### Task 10: Preview 전체 흐름과 법률 검토 패킷

**Files:**
- Modify: `docs/consent/consent-four-domains-draft-v1.md`
- Modify: `docs/consent/legal-review-open-items-v1.md`
- Modify: `docs/ops.md`
- Modify: `scripts/deploy-gates.test.mjs`

**Interfaces:**
- Produces: 가상 녹음부터 승인까지 smoke 증거와 변호사 검토 패킷.

- [ ] **Step 1: 배포 게이트 테스트를 작성한다**

외부 STT provider를 운영으로 선택했는데 계약 승인 참조, 동의 문안 버전, provider 보관과 삭제 확인이 없으면 배포를 거부한다.

- [ ] **Step 2: preview에서 네 경로를 smoke한다**

1. 수기 전용, STT와 AI 동의 없음.
2. 로컬 Whisper, 녹음 동의 있음.
3. 로컬 Qwen, 녹음 동의 있음.
4. 외부 provider, STT 처리위탁 동의와 계약 승인 있음.

각 경로에서 공식 수기 기록은 유지되고 외부 실패가 서비스 전체를 멈추지 않아야 한다.

- [ ] **Step 3: 변호사 검토 패킷을 완성한다**

provider별 처리 위치, 보관, 삭제, 학습, 재위탁, 국외 이전, 기관 책임, 철회 이후 처리를 표로 제공한다. 미확인 항목은 빈칸이 아니라 `미확인, 운영 금지`로 적는다.

- [ ] **Step 4: 전체 검증을 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest discover tests)
pnpm guard:consent-copy
pnpm guard:db
pnpm guard:secrets
pnpm typecheck
pnpm test
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add docs/consent docs/ops.md scripts/deploy-gates.test.mjs
git commit -m "ops(stt): preview 검증과 법률 게이트 추가"
```

---

## Production Gate

외부 STT 운영은 다음이 모두 충족될 때만 가능하다.

1. 기관이 선택한 provider가 하나로 고정됨.
2. 해당 provider의 DPA와 처리 위치, 보관, 삭제, 재위탁이 문서로 확인됨.
3. 동의 4영역 문안이 변호사 검토를 통과함.
4. 해당 provider 이름과 목적이 STT 처리위탁 동의 증거에 기록됨.
5. G1부터 G3까지 같은 합성 입력셋으로 비교가 끝남.
6. provider 오류 시 수기 메모 폴백이 preview에서 검증됨.
7. 키는 기관별로 분리되고 Infisical로만 주입됨.
8. 원문, 전사, PII, 시크릿이 로그와 오류에 0건임.

조건이 하나라도 빠지면 기본 엔진은 `whisper`이고 외부 adapter는 코드에 있어도 운영에서 선택할 수 없다.
