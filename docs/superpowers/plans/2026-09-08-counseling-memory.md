# 상담 기억 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development with the repository's Herdr split-pane orchestration. Main owns integration and validation. Workers do not start additional agents.

**Goal:** 승인 없는 케이스별 자동 기억을 기존 기록에서 만들고 갱신하며, 상담 준비·회차 AI 정리·읽기 중심 상세·기관 설정까지 연결한다.

**Architecture:** `gateway.ts`가 권한·SQL·원본 변경과 영속 작업의 원자성을 소유한다. SQL 없는 코어 규칙과 공통 DTO, AI 런타임의 구조화 출력, HTTP 실행기의 cron 연결, 기존 Python 마스킹 Agent와 Next 화면을 결합한다. 외부 기억 서버와 MCP 연결은 만들지 않는다.

**Tech Stack:** TypeScript, 기존 Database 포트와 SQLite/대응 PostgreSQL SQL, Python Agent, OpenAI Responses `store:false`, Next/React Wire 부품.

**Spec:** `docs/superpowers/specs/2026-09-08-counseling-memory-design.md` 및 `docs/adr/0046-background-counseling-memory.md`. 2026-09-08 사용자 전체 승인.

## Global Constraints

- 같은 기관이어도 기억은 `supportCaseId` 하나에 한정한다. 실무자 개인 선호와 형제 사업 기억은 제외한다.
- 기억과 요약은 자동 보조 표현이다. 미승인 AI 초안은 재료가 아니며 원본 상담 승인 절차는 그대로다.
- 사실과 여러 회차 관찰을 구분한다. 원본 근거 없는 출력, 성격·심리 진단, 지원 판단은 거부한다.
- 현재 회차 출력 근거와 과거 기억 근거는 별도 집합이다.
- 모든 외부 입력은 Agent 마스킹과 코어 재검증을 거친다. 증명 없는 legacy 자료는 재마스킹하며 안전 조건을 생략하지 않는다.
- 사용자 정정을 같은 옛 근거로 되돌리지 않는다. 무관한 케이스 세대 증가도 정정 보호를 풀지 않는다.
- 원본 수정·철회·파기·설정 중단과 작업 완료의 경합을 처리한다. 이전 세대가 최신 내용을 덮어쓰거나 새 대기를 지우면 실패다.
- 현행 실행 표면은 Next·Workers·Python Agent다. 최종 세 배포 모드의 런타임·PostgreSQL 기반 이전까지 완료했다고 주장하지 않는다.
- 원문, 기억 내용, PII, 검색어와 공급자 오류 원문을 로그·브라우저 영속 저장소·URL에 넣지 않는다.
- 새 탭 없이 현재 Herdr 탭 안에서 Split을 사용한다. root checkout과 다른 작업 브랜치는 수정하지 않는다.
- 병행 worker는 formatter/linter/build/test/guard/commit을 실행하지 않는다. Main이 통합 후 한 번 실행한다. 기본 회귀 실패 확인도 Main이 담당한다.
- 새 회귀 테스트는 정정 경합, 권한, 출처 혼동과 철회처럼 실제 실패를 방어하는 것만 추가한다. 화면은 실제 브라우저로 검증한다.

## 공통 인터페이스

정본 타입은 Main이 `packages/contracts/src/counseling-memory.ts`에 먼저 작성한다. 세 구현자는 그 파일을 소비한다. 타입 변경이 필요하면 Main에게 정확한 차이를 전달하고, 다른 파일에 사본을 만들지 않는다.

```ts
export type MemoryKind = 'fact' | 'observation';
export type MemoryItemState = 'current' | 'historical' | 'conflicting';
export type MemorySourceKind = 'session' | 'goal' | 'action' | 'correction' | 'derived_summary';
export interface MemoryCitation {
  materialId: string;
  quote: string;
}
export interface MemoryMaterial {
  id: string;
  sourceKind: MemorySourceKind;
  sourceId: string;
  sourceRevision: string;
  sessionId: string | null;
  occurredAt: string;
  snapshotId: string;
  sha256: string;
  maskedText: string;
}
export interface MemorySource extends MemoryCitation {
  sourceKind: MemorySourceKind;
  sourceId: string;
  sourceRevision: string;
  sessionId: string | null;
  occurredAt: string;
}
export interface MemoryReference { kind: 'goal' | 'action'; id: string }
export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  state: MemoryItemState;
  revision: number;
  updatedAt: string;
  correctedAt: string | null;
  sources: MemorySource[];
  references: MemoryReference[];
}
export interface MemorySummaryLine { text: string; itemIds: string[] }
export type MemoryStatus = 'empty' | 'backfill' | 'updating' | 'ready' | 'off' | 'blocked' | 'failed' | 'closed' | 'unavailable';
export interface CaseMemoryView {
  supportCaseId: string;
  revision: number;
  status: MemoryStatus;
  reason: string | null;
  updatedAt: string | null;
  summary: MemorySummaryLine[];
  items: MemoryItem[];
  history: MemoryItem[];
  canCorrect: boolean;
}
export interface MemoryCorrectionInput { itemId: string; expectedRevision: number; body: string }
export interface MemorySettingsInput { enabled: boolean; expectedVersion: number }
export interface MemorySettingsView {
  enabled: boolean;
  version: number;
  pendingCases: number;
  blockedCases: number;
  failedCases: number;
  lastSuccessAt: string | null;
}
export interface MemoryGenerationRequest {
  supportCaseId: string;
  generation: number;
  materials: MemoryMaterial[];
  existingItems: MemoryItem[];
}
export interface MemoryItemUpdate {
  key: string;
  itemId: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  state: MemoryItemState;
  citations: MemoryCitation[];
  references: MemoryReference[];
}
export interface MemoryGenerationOutput {
  updates: MemoryItemUpdate[];
  summary: Array<{ text: string; itemKeys: string[] }>;
}
export interface MemoryWork {
  id: string;
  orgId: string;
  supportCaseId: string;
  serviceActorId: string;
  generation: number;
  correctionRevision: number;
  settingsVersion: number;
  leaseToken: string;
}
export interface MemoryHistoricalContext {
  supportCaseId: string;
  revision: number;
  materials: MemoryMaterial[];
}
```

- `MemoryGenerationOutput.updates`는 patch다. 응답에 없는 기존 항목을 삭제하지 않는다.
- 새 항목의 `key`는 응답 안에서 유일하다. 기존 항목의 `itemId`는 요청한 항목에 있어야 한다. summary의 `itemKeys`는 업데이트 key 또는 요청의 기존 item ID만 참조한다. 코어가 영속 ID로 변환한다.
- 관찰은 서로 다른 원본 회차 두 개 이상의 근거를 요구한다. `correction`과 `derived_summary`는 독립 회차로 세지 않는다.
- 타입의 `reason`은 코어가 정한 안전한 code다. 화면은 알려진 code의 문구만 표시한다.
- `CaseMemoryView.history`는 과거 상태와 정정 전 버전을 포함한다. 필요하면 별도 페이지 계약으로 확장하되 누락을 숨기지 않는다.
- 한 번의 요청은 최대 32개 재료, 재료별 24,000 code point, 재료 합계 96,000 UTF-16 code unit이다. 기존 항목 64개, 업데이트 32개, 항목별 출처 32개와 연결 16개를 넘기지 않는다. 배치 밖 원본은 영속 cursor에 남기며 초과분을 잘라 버리지 않는다.
- 기존 항목을 다시 외부 입력으로 쓸 때는 항목 ID를 `sourceId`, 항목 revision 문자열을 `sourceRevision`으로 가진 `correction` 또는 `derived_summary` snapshot이 필요하다. 제목·본문과 함께 보내는 출처 인용도 검증된 원본 snapshot 또는 이 파생 snapshot에 있어야 한다.
- 제목 80자, 본문 2,000자, 인용 500자, 요약 문장 240자가 연산 계약의 상한이다. summary는 최대 3문장이며 과거 기억이 현재 회차 발언으로 인용되는 것을 허용하지 않는다.
- 현재 회차 초안의 과거 맥락 증적은 `memoryContext: { supportCaseId, revision, materialSnapshotIds }`로 따로 저장한다. 현재 회차의 claim evidence 집합에는 추가하지 않는다.

## Task 1: 코어 저장과 일반 텍스트 마스킹의 영속 연결

**Owner:** Herdr 오른쪽 위 core 구현자.

**Files:** `packages/core/src/gateway.ts`, 새 `packages/core/src/counseling-memory.ts`, `packages/contracts/src/agent-jobs.ts`, `migrations/sqlite/`, `migrations/postgres/`, `apps/pipeline/ccc_pipeline/`의 필요한 계약·worker 코드와 관련 기존 테스트. 공통 counseling-memory DTO는 Main 소유. HTTP와 UI 파일은 수정하지 않는다.

**Produces:** 다음 gateway 함수들. `Env`와 `Actor`는 기존 gateway 타입이다.

```ts
getCounselingMemory(env: Env, actor: Actor, supportCaseId: string): Promise<CaseMemoryView>
correctCounselingMemory(env: Env, actor: Actor, supportCaseId: string, input: MemoryCorrectionInput): Promise<CaseMemoryView>
getCounselingMemorySettings(env: Env, actor: Actor): Promise<MemorySettingsView>
setCounselingMemorySettings(env: Env, actor: Actor, input: MemorySettingsInput): Promise<MemorySettingsView>
prepareCounselingMemoryWork(env: Env, limit?: number): Promise<MemoryWork[]>
beginCounselingMemoryEgress(env: Env, work: MemoryWork, configHash: string): Promise<MemoryGenerationRequest>
commitCounselingMemoryWork(env: Env, work: MemoryWork, output: MemoryGenerationOutput): Promise<void>
failCounselingMemoryWork(env: Env, work: MemoryWork, code: string): Promise<void>
loadCounselingMemoryContext(env: Env, actor: Actor, sessionId: string): Promise<MemoryHistoricalContext | null>
```

`prepareCounselingMemoryWork`는 HTTP에 공개하지 않는 내부 scheduled 동작이다. 활성 기관의 서비스 identity와 적격 케이스를 선택하며 대기 재료를 만들고 준비된 generation 작업만 lease한다. `begin...`은 DB에서 모든 입력을 다시 읽고 현재 동의·설정·원본·정정·lease와 활성 provider config hash를 검증한 뒤 egress CAS를 거쳐 요청을 반환한다. `commit...`은 독립 재검증과 최신 상태 비교 후 항목·요약·감사를 한 원자 경계에 저장한다.

- [ ] 원본 변경 중 재마스킹, 사람의 정정 중 LLM 완료, 동의 철회 후 완료를 막는 회귀 사례를 먼저 작성한다. Main이 실행한다.
- [ ] `counseling_memory_*` 저장 구조에 기관 설정, 케이스 세대·lease, 원본 버전/변경 목록, 마스킹 재료, 항목·근거·이력, 요약과 egress 상태를 둔다. 문서 본문과 정정 내용의 보호 경계를 유지한다.
- [ ] 현재 공식 기록 전체(인테이크·구조화 수기 포함), 목표·액션 변경을 원자적으로 예약한다. 이미 승인된 세션도 소급 처리한다. 원본 수정/삭제는 의존 자동 항목과 해당 요약을 즉시 제외하되 사람의 정정은 보호한다. 동의 철회와 파기는 정정 항목에도 적용한다.
- [ ] 원본 keyset cursor를 보존하여 bounded backfill과 증분 갱신을 만든다. 긴 원본은 code-point 기준 구간과 원본 위치를 유지해 24,000자 이하 마스킹 자료로 나눈다.
- [ ] 기존 Python text 마스킹 경로를 재사용하되 정확한 source kind/id/revision/purpose를 갖도록 서버 claim/source/result를 확장한다. 회차 없는 원본에 가짜 session ID를 넣지 않는다. 일반 draft의 최신 text_context 조회에 기억 재료가 섞이지 않게 한다.
- [ ] S6 필드 전체를 memory material에 보존하고 실제 등록된 attestation/receipt와 hash·현재 효력을 확인한다. 사용자 정정과 AI 파생 기억도 다시 외부 입력으로 쓸 때 Agent snapshot을 요구한다.
- [ ] 읽기·정정·기관 설정 권한과 모든 수명 전이를 구현한다. 파기 시 기억/이력/검색 파생물/일감 본문을 제거하고 내용 없는 감사만 남긴다.
- [ ] 코드 위치와 공유 인터페이스의 변경이 있으면 Main에게 알린다. worker는 실행/검증/커밋하지 않는다.

## Task 2: AI 기억 연산과 현재 회차 근거 분리

**Owner:** Herdr 왼쪽 아래 provider 구현자.

**Files:** `packages/ai-runtime/src/ai-provider.ts`, 필요하면 같은 패키지의 새 memory 검증 모듈, `packages/ai-runtime/package.json`, 관련 `apps/api/test/` provider 회귀 파일. core/HTTP/UI/common DTO는 수정하지 않는다.

**Consumes:** 위 공통 `MemoryGenerationRequest`, `MemoryGenerationOutput`, `MemoryHistoricalContext`.

**Produces:** `AiProviderAdapter`의 선택 메서드 `updateMemory?(request: MemoryGenerationRequest): Promise<unknown>`와 실제 Codex 구현, `validateMemoryGenerationRequest(value: unknown): MemoryGenerationRequest`, `validateMemoryGenerationOutput(value: unknown, request: MemoryGenerationRequest): MemoryGenerationOutput`. 기존 `AiProviderRequest`에 `historicalContext?: MemoryHistoricalContext`를 추가한다.

- [ ] 없는 근거·복제 회차 관찰·과거 근거의 현재 회차 인용을 거부하는 회귀 사례를 작성한다.
- [ ] 실제 Responses API의 엄격 JSON schema 호출을 구현한다. 기존 `callStructured`, `store:false`, timeout과 공급자 오류 정제 경로를 재사용한다. 미지원 adapter는 실행기에서 명시 실패하고 성공처럼 스킵하지 않는다.
- [ ] 최대 3개 summary 문장과 유효 item 참조, source substring 검증, 허용 kind/state/reference, 정정된 항목의 새 근거 조건을 검사한다. 새 진단과 지원 판단을 금지한다.
- [ ] 과거 자료는 별도 historicalContext 입력이며 현재 `materials` 및 출력 evidence validation 집합에 합치지 않는다. 실제 HTTP payload에도 전달한다.
- [ ] memory prompt/schema를 config identity에 포함하고 활성 설정 재확인이 필요하게 한다. 관련 기존 테스트는 새 계약을 실제로 소비하도록 고친다.
- [ ] worker는 실행/검증/커밋하지 않는다.

## Task 3: 읽기 중심 화면과 기관 설정

**Owner:** Herdr 오른쪽 아래 screen-builder.

**Files:** 설계안의 `apps/web/.../memory/`, briefing 두 파일, settings, `app/lib/api.ts`, 해당 화면의 server action, 공용 `wire-action-menu.tsx`와 필요한 공용 스타일. core/HTTP/provider/contracts는 수정하지 않는다.

**Consumes:** 공통 DTO와 다음 HTTP 계약.

```text
GET  /support-cases/:supportCaseId/memory -> CaseMemoryView
POST /support-cases/:supportCaseId/memory/corrections + MemoryCorrectionInput -> CaseMemoryView
GET  /settings/counseling-memory -> MemorySettingsView
PUT  /settings/counseling-memory + MemorySettingsInput -> MemorySettingsView
```

기존 인증과 에러 envelope를 그대로 사용한다. 수정은 낙관 버전, 입력 오류 400, 비담당 403, 버전 경합 409다. settings API는 기관 관리자만 사용한다.

- [ ] 설계안 배치표를 그대로 조립한다. 요약은 사실 입력칸이 아니고, 항목별 수정·승인 버튼은 없다.
- [ ] 같은 케이스 전용 상세와 다회차 근거, 현재/과거 상태를 만든다. 현재 source quote는 원본 회차를 펼치는 기존 링크 계약을 사용한다.
- [ ] 공용 행동 메뉴에서만 정정 폼을 열고, 실패/409 때 입력을 보존한다. 권한 없는 사용자는 정정 entry를 받지 않는다.
- [ ] 기관 선택값과 실행 상태를 분리하고 Off·처리 대기·실패·자료 없음·동의 중단을 각각 표시한다.
- [ ] 기존 화면·API 패턴을 재사용하고 새로운 client 셸을 만들지 않는다. UI 표현은 DTO/callback/URL을 받아 서버 import와 분리한다.
- [ ] 실제 검수용 full synthetic fixture 구성 지점을 Main에게 전달한다. worker는 테스트/브라우저/포매터/린터/커밋하지 않는다.

## Task 4: HTTP, scheduled 실행기와 종단 검증

**Owner:** Main. 위 세 worker와 파일이 겹치지 않는다.

**Files:** `packages/http-api/src/request-handler.ts`, 새 `counseling-memory-runner.ts`, `apps/api/src/index.ts`, `cron-schedule.ts`, `wrangler.toml`, Main 소유 종단 테스트/검증 스크립트와 설계 문서.

- [ ] 위 네 API를 기존 인증·본문 검증·에러 경계 안에 연결한다.
- [ ] 실행기는 `prepare -> resolve adapter/config -> begin egress -> validate request -> updateMemory -> validate output -> commit` 순서로 동작한다. 실패는 정제된 code만 core에 전달한다.
- [ ] 기존 cron에 실제 memory drain을 연결하고 `not_before`와 DB lease를 존중한다. 처리 장비가 준비되지 않은 상태를 성공으로 바꾸지 않는다.
- [ ] 회차 초안 생성에는 `loadCounselingMemoryContext`로 검증한 과거 맥락만 전달하고 사용한 revision을 원본 draft 증적에 보존한다. 이 저장 접점은 core owner와 확정하고 Main은 core를 동시에 수정하지 않는다.
- [ ] 기존 Agent·동의·현재 자료 회귀, 새 기억 경합·권한·출처 검증을 실행한다. 형식/타입/가드는 worker 작업이 끝난 뒤 한 번 실행한다.
- [ ] 실제 로컬 앱과 Agent 경로를 synthetic 자료로 실행해 backfill, 갱신, 읽기, 정정, 설정 상태를 확인한다. 유료 외부 호출이나 live secrets를 몰래 활성화하지 않는다. 실제 provider 호출 증거가 없으면 명시한다.
- [ ] 같은 Herdr 탭 Split에 screen-builder와 별도 rule-reviewer를 두고 390/768/1280 실물 검수 및 필요한 수정 후 다시 확인한다.
- [ ] 한 번의 독립 최종 코드 리뷰를 수행하고 load-bearing 지적을 해결한다. 변경 파일만 커밋하며 merge/push는 별도 사용자 지시 없이 하지 않는다.

## 사전 인터페이스 점검

| 경계 | 생산자와 소비자 | 판정 |
| --- | --- | --- |
| 공통 DTO | Main 생성, Tasks 1~3 소비 | 같은 계약 파일 하나를 import |
| gateway | Task 1 생산, Main 소비 | 함수 이름·인자·반환 타입 위에 고정 |
| provider | Task 2 생산, Main 소비 | updateMemory와 validator 이름 고정, 선택 미지원은 명시 오류 |
| HTTP | Main 생산, Task 3 소비 | 네 경로와 payload 고정 |
| 현재 draft 과거 증적 | Task 1 저장, Main 호출 | core 파일 변경은 Task 1 한 명만 소유 |
| 배포·S6 미구현 기반 | Main 통합, Task 1 안전 계약 | 없는 증명을 성공값으로 만들지 않음, 최종 세 모드 완료와 분리 |
| 검증 | 모든 worker 코드, Main 실행 | 중간 빌드·테스트 경합 없음 |

진행 상태 파일을 별도로 만들지 않는다. 실행 상태는 세션 todo, 변경 이력은 커밋, 작업 요구사항은 이 계획과 설계안에 둔다.
