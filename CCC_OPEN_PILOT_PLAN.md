# CCC Open Pilot v0.3 실행 계획

> **For agentic workers:** 이 문서의 스펙 게이트와 티켓 의존성을 위에서부터 따른다. 구현 티켓마다 별도 worktree와 `docs/superpowers/plans/YYYY-MM-DD-{티켓ID}-{slug}.md`를 만들고, 해당 티켓의 검증이 끝나기 전에는 차단된 후속 티켓을 시작하지 않는다. 날짜 관문은 진행 점검일이며 완료 조건을 낮추는 마감이 아니다.

**Goal:** 현재 Cloudflare 중심 CCC를 공통 코어 하나와 Community Cloud, Local Single, Local Office 세 배포 모드로 clean cutover하고, 합성 데이터 골든 플로우, 복원, 개인정보 관문을 모두 검증한다.

**Architecture:** `packages/contracts`가 TypeScript 런타임 포트 6개와 공용 DTO를, Processing Agent가 Python `STTProvider`를 고정한다. `packages/core`, `packages/http-api`, `packages/ai-runtime`는 플랫폼 중립 업무 코드를 소유한다. `adapters/*`와 `apps/*`만 Supabase, Cloudflare, Node, Electron, Windows API를 알며, 정적 `apps/client`가 같은 Bearer API를 호출한다.

**Tech Stack:** TypeScript 5.9, React 19.2.7, Vite 8.2.2, React Router 8.3.1, vite-plugin-pwa 1.3.0, Playwright 1.62.1, `@noble/hashes` 2.4.0, PostgreSQL via `postgres` 3.4.9, encrypted SQLite candidate `better-sqlite3-multiple-ciphers` 13.0.3, Supabase CLI 2.116.0, Supabase JS 2.112.4, Electron 44.1.1, electron-builder 26.15.3, Python 3.12 Processing Agent. 네이티브 Windows 패키지와 모델 라이선스는 검증 전까지 후보이며 실패하면 해당 모드를 `미통과`로 둔다.

**Primary spec after approval:** `docs/adr/0041-one-core-three-deployment-modes.md`, `PRD/CCC-open-pilot-v0.2.md`, `docs/specs/S1-*.md` through `S15-*.md`. E0 완료 전에는 저장소 밖 `inbox` 원본과 회수한 Notion ADR-0040을 정본 후보로만 사용한다.

## Context

`/Users/seongqkim/developer/PROJECTS/CCC-new/inbox`의 정본 후보 4개와 현재 구현을 바탕으로, Community Cloud, Local Single, Local Office를 같은 제품 코어로 구현하는 실행 순서를 정한다. 첫 계획은 구현 티켓 82개였으나, Fable 5.1과 GPT-5.6 SOL의 독립 검토에서 승인 게이트, 교차 추적기 의존성, 복원 계약, 누락 산출물, 과대 티켓, 일정 임계경로 문제가 확인됐다. 이 버전은 실행 가능한 leaf 티켓 106개와 Linear 스펙 게이트 15개로 고친다.

검증한 입력과 외부 상태:

- `inbox/0041-one-core-three-deployment-modes.md`의 열린 결정 5건은 2026-09-02 Q가 E0-5a에서 승인했다. E0-1은 E0-5b의 PR 번호 정리가 끝난 뒤 이 승인 기록을 반영해 ADR-0041을 발행한다.
- Notion의 `2026-09-01 ADR-0040: CCC Open Pilot v0.1 기관 소유형 웹·Privacy Gateway·BYOK` 원문은 내부 통합으로 회수 가능하고 상태는 `Accepted`다. §9의 동의 6영역은 개인정보 수집·이용, 민감정보 처리, 상담 녹음, 외부 STT 처리, 외부 LLM·국외 처리, 음성 원본 보유기간이다.
- 열린 PR #210은 다른 `ADR-0040`과 `D76`을 사용하고 Supabase preflight 코드를 담는다. E0-5b가 ADR 번호와 결정 번호를 재배정하고, 보존할 preflight 구현과 ADR-0041이 대체하는 정책을 구분하기 전에는 병합하지 않는다.
- 열린 PR #215는 `db/gateway.ts`, `request-handler.ts`, `apps/web/app/lib/api.ts`를 수정한다. E0-5b가 이 PR을 먼저 병합하거나 닫은 뒤 E1 코어 추출 worktree를 만든다.
- 후보 PRD의 “원문은 기관 밖으로 나가지 않는다”는 Azure STT와 충돌한다. E0-2에서 OpenAI에는 AI Packet만 보내고, Azure STT를 명시적으로 선택하고 해당 동의가 유효할 때만 원음이 Azure 서울 endpoint로 나간다고 고친다.
- `SPEC-TEMPLATE-and-S1-example.md`의 완료 조건은 구현 결과를 요구하면서 E1-2가 `S1 확정`을 기다려 순환한다. E0-1에서 스펙의 계약 확정과 구현 검증을 분리한다.
- 초기 검토에 사용된 `handoff-implementation-plan-review-2026-09-02.md` 원본과 Downloads 검토 폴더는 현재 로컬에서 소실됐다. handoff 줄 번호 인용은 두 외부 리뷰의 기록으로만 보존하고, 이 계획의 미결 결정과 완료 조건은 남아 있는 PLAN, inbox, 코드, GitHub, Notion 원문으로 다시 확인한 내용만 쓴다.

## Approach

### 1. 승인, 정본, 스펙 게이트를 먼저 고정한다

- E0-5a의 Q 결정은 2026-09-02에 닫혔다. ① Community Cloud, Local Single, Local Office를 모두 정식 구현한다 ② 설치 직후 STT는 `off`다 ③ Community Cloud는 Supabase private Storage의 원음 임시 보관을 허용한다 ④ 목표 모델 검수는 E2-8로 앞당긴다 ⑤ 원음은 다음 영업일의 첫 Agent 처리 기회까지 보관하고 처리 뒤 즉시 삭제하며, 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 삭제하고 관리자 장애 상태를 남긴다.
- E0-5b가 열린 PR 통합을 소유한다. PR #210은 `ADR-0042`와 D84 이후의 빈 번호로 재배정하고, 결정 1과 3의 구 Cloudflare 중계와 30일 원음 정책은 ADR-0041이 대체한다고 표시한다. read-only Supabase preflight 구현은 E6-1a에서 재사용한다. PR #215는 E1 worktree 생성 전에 병합하거나 닫는다.
- E0-1은 E0-5a의 승인 기록과 E0-5b의 번호 정리를 소비해 inbox ADR을 `docs/adr/0041-one-core-three-deployment-modes.md`로 발행한다. D77의 설치 기본값, D81의 fail-closed 7종, D8과 SG8의 원음 시계, 열린 항목과 D76~D83을 승인 기록대로 고치고 `CLAUDE.md`, 템플릿 경로를 갱신한다.
- E0-1은 스펙 상태를 `초안 → 검토 → 확정 → 구현 검증 완료`로 바꾼다. `확정`은 인터페이스, 규칙표, fixture 정의, 검증 명령이 문서로 닫힌 상태다. 실제 어댑터, 배포, 복원 결과는 관련 E 티켓이 소유하며 스펙 확정을 기다리게 하지 않는다.
- S1~S15의 정본은 GitHub Issue와 `docs/specs/` 파일이다. Linear에는 SG1~SG15 미러 게이트를 만든다. SG 티켓은 대응 GitHub Issue와 파일이 `확정`일 때만 Done으로 바꾸고, 구현 티켓은 SG 티켓을 `blocked by`로 연결한다. GitHub Issue를 Linear `blocks` 대상으로 직접 사용하지 않는다.
- E0-2가 `PRD/CCC-open-pilot-v0.2.md`를 추가한다. 모드별 capability matrix, 13종 산출물, STT 초기 `off`, Cloud 원음 임시 보관과 처리 기회 보장 시계, Azure 원음 이전 조건, AI 사용 시 Agent PC 필수 계약을 ADR과 맞춘다. 수기 기록은 즉시 공식 기록이며 승인 대상이 아니라는 D5 문구도 고친다.
- E0-3은 회수한 Notion ADR-0040을 `docs/adr/0040-community-cloud-policy.md`로 보존하고 §9의 6개 literal과 검증된 사건 필드 8개를 그대로 옮긴다. §8.2와 §14의 ADR-0041 부분 대체를 머리말에 적고, PR #210의 재배정 ADR, ADR-0035 일부, 8월 31일 계획 3개, 9월 1일 통합본과 HANDOFF에 정확한 부분 또는 전체 대체 표식을 단다.
- E0-4는 코드서명, Azure 자격, pyannote와 모델 라이선스, OpenAI DPA, 법무 담당 확정을 병렬 착수한다. 각 서비스 작업 전에 `~/developer/tools/portwright/bin/portwright preflight <service-id>`를 실행한다. 기존 연결과 금고를 먼저 쓰고, 채팅이나 로그로 시크릿을 받지 않는다.

스펙 15개는 아래 계약을 확정한다. SG 번호는 같은 번호의 GitHub Issue와 파일을 가리키는 Linear 게이트다.

| 게이트 | 파일 | 후속 티켓이 소비할 계약 |
|---|---|---|
| SG1 | `docs/specs/S1-database-sql-subset.md` | `Database`, 허용 SQL, PostgreSQL baseline, repository 승격 순서. 구현 결과가 아닌 계약과 fixture 정의로 확정 |
| SG2 | `docs/specs/S2-auth-capability-manifest.md` | mode별 Bearer에서 `Actor`로 가는 규칙, Single 안정 사용자 ID, Agent service Actor, bootstrap 신뢰 경계, JWT issuer/audience/JWKS 회전, Electron origin, 초대 token Referrer 방지와 `CapabilityManifest` |
| SG3 | `docs/specs/S3-screen-api-map.md` | 운영 화면 29개, `/kit` 1개, 공개 화면, 서버 액션, API, DTO 대응표 |
| SG4 | `docs/specs/S4-local-service-profiles.md` | Single과 Office의 bind, 인증, TLS, scheduler, backup, update 차이와 E8-8 부하 상한 |
| SG5 | `docs/specs/S5-agent-job-contract-v2.md` | claim, heartbeat, result, route, provider no-fallback, queue 공정성, v1 payload fallback 제거와 claim 뒤 동의 철회 처리 |
| SG6 | `docs/specs/S6-privacy-packet.md` | 준식별자 일반화, pipeline version, 동의 재검증, fail-closed 상태 7종 |
| SG7 | `docs/specs/S7-consent-six-domains.md` | 회수한 ADR-0040 §9의 6개 literal, 사건 스키마, 문안 버전과 해시 |
| SG8 | `docs/specs/S8-audio-lifecycle-store.md` | `AudioStore`, 다음 영업일 첫 Agent 처리 기회 보장, 처리 후 즉시 삭제, 첫 처리 가능 시점부터 24시간 상한, 관리자 장애 상태, 어댑터별 부재 증명 |
| SG9 | `docs/specs/S9-secrets-recovery-kit.md` | 키 위치, DPAPI scope, `PII_ENC_KEY`와 버전, 안정 사용자 ID, Recovery Kit 재래핑과 새 PC 복원 |
| SG10 | `docs/specs/S10-cccx-format.md` | manifest, JSONL, 첨부, SHA-256, Argon2id와 AES-GCM, 금고 재암호화, staging journal과 재시작 복구 |
| SG11 | `docs/specs/S11-supabase-edge-template.md` | 서울 리전, Auth, RLS 기본 거부, private Storage, Edge 제한 |
| SG12 | `docs/specs/S12-install-release.md` | 설치 산출물, 서명, SBOM, version 단조 증가, manifest 만료와 서명키 회전, update와 rollback |
| SG13 | `docs/specs/S13-pilot-metrics.md` | 정답표와 음성 fixture 제작 주체, 정밀도, 재현율, 작성 시간, 준비 시간, 수정량 |
| SG14 | `docs/specs/S14-legal-gates.md` | 법무 게이트 `LG1~LG3` 담당자, 마감, 증빙 위치와 실데이터 차단. STT 게이트는 `STT-G1~STT-G3`로 구분 |
| SG15 | `docs/specs/S15-long-ai-packet.md` | 시간 청크, 포함/제외 구간, 부분 호출 실패, 재시도와 병합, 근거 보존, 누락 표시 |

### 2. 공통 계약을 고정하고 그 뒤에만 세 모드를 갈라놓는다

- `pnpm-workspace.yaml`에 `packages/*`와 `adapters/*`를 추가한다. 의존 방향은 `apps -> adapters -> packages`이고, `packages/core`는 `@cloudflare`, `@supabase`, `electron`, `node:`를 import하지 않는다. `scripts/guard-core-imports.mjs`가 이 규칙과 순환 의존을 CI에서 차단한다.
- R1은 유지한다. `scripts/guard-db-gateway.mjs`는 업무 SQL을 `packages/core`의 gateway facade와 E12-1a~E12-1e의 내부 repository에만 허용하고, raw driver 호출은 `adapters/db-*`, migration runner, contract test harness에만 허용한다. `apps/*`와 `packages/http-api`에서 SQL/driver 호출을 발견하면 실패한다.
- `packages/contracts/src/database.ts`는 SG1이 확정한 `Database`, `PreparedStatement`, `DatabaseResult`, `Bindable` 서명을 그대로 쓴다. `batch()`만 원자적 트랜잭션이며 대화형 `UnitOfWork`는 E12-1a 전에는 없다. 어댑터가 허용받은 SQL 변환은 SQL string/comment 안의 `?`를 건드리지 않는 lexical scanner가 parameter placeholder만 `$1..$n`으로 바꾸는 것뿐이다.

```ts
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]>;
}
export interface PreparedStatement {
  bind(...values: Bindable[]): PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<DatabaseResult<T>>;
  run(): Promise<DatabaseResult<unknown>>;
}
export interface DatabaseResult<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}
export type Bindable = string | number | null | Uint8Array;
```
- TypeScript 쪽 포트 6개 중 `Database`를 뺀 `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `AIProvider`와 Agent 결과 DTO는 `packages/contracts/src/runtime.ts`에 둔다. `AudioStore` key는 `audio/<sessionId>/<uuid>`만 허용하며 200MB 본문을 Edge에 올리거나 전량 복사하지 않는다.

```ts
export interface AudioStore {
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    metadata: { contentLength: number; contentType: string; expiresAt: string },
  ): Promise<{ sha256: string }>;
  get(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    contentLength: number;
    contentType: string;
    expiresAt: string;
    sha256: string | null;
  } | null>;
  delete(key: string): Promise<{ deleteSucceeded: boolean; absentFromList: boolean; absentFromMetadata: boolean; directReadAbsent: boolean; verificationMethod: 'authenticated-get-404' | 'filesystem-stat-enoent' | 'r2-head-absent'; providerStatus?: number; verifiedAt: string }>;
  createUploadTarget(
    key: string,
    metadata: { contentLength: number; contentType: string; expiresAt: string },
  ): Promise<{ url: string; expiresAt: string } | null>;
  createDownloadTarget(key: string, expiresInSeconds: 600): Promise<{ url: string; expiresAt: string } | null>;
}
export type RevocationReason = 'logout' | 'password-reset' | 'mfa-reset' | 'admin-disable' | 'pairing-revoked' | 'security-event';
export interface Identity {
  resolve(request: Request): Promise<Actor>;
  revokeAll(userId: string, reason: RevocationReason): Promise<void>;
  revokeSession(sessionId: string, reason: RevocationReason): Promise<void>;
}
export type CoreSecretName = 'CODEX_API_KEY' | 'PII_ENC_KEY' | 'NOTIFY_WEBHOOK_URL';
export type PlatformSecretName = 'DB_MASTER_KEY' | 'FILE_ENC_KEY' | 'OFFICE_CA_KEY' | 'SUPABASE_SERVICE_ROLE_KEY' | 'SCHEDULER_SECRET';
export type SecretName = CoreSecretName | PlatformSecretName;
export interface SecretStore {
  get(name: SecretName): Promise<string | null>;
}
export type ScheduledJobKind = 'pipeline_watchdog' | 'pii_retention' | 'audio_expiry';
export interface Scheduler {
  schedule(kind: ScheduledJobKind, cron: string): Promise<void>;
}
export interface AIProvider {
  generate(input: AiProviderInput, signal?: AbortSignal): Promise<AiProviderOutput>;
  detectDiscrepancies(input: DiscrepancyInput, signal?: AbortSignal): Promise<DiscrepancyOutput>;
}
```

- `packages/core`는 `CoreSecretName`만 읽는다. `PlatformSecretName`은 `apps/local-service`, `apps/cloud-api` 조립 루트와 platform adapter만 읽으며 `guard:core-imports`가 core의 PlatformSecretName 참조를 실패시킨다. Agent의 `AZURE_SPEECH_KEY`, `AGENT_REFRESH_TOKEN`, `HF_TOKEN`은 Python SecretStore에만 둔다.

- `packages/core/src/scheduled-job-runner.ts`는 `run(kind: ScheduledJobKind, nowIso: string): Promise<JobReport>`를 export한다. Workers cron, Supabase pg_cron에서 호출하는 Edge HTTP, Node timer가 같은 runner를 부르고, audio 삭제 도래 판단은 `audio_objects.purge_due`를 gateway로 조회한다.
- 일곱 번째 포트 `STTProvider`는 Agent의 `apps/pipeline/ccc_pipeline/stt/provider.py`에 둔다. `transcribe(self, audio_path: Path, config: PipelineConfig) -> list[Segment]` Python Protocol을 faster-whisper와 Azure adapter가 구현한다. TypeScript contracts에는 `TranscriptResult` DTO와 `sttEngine`, `route` literal만 두며 Azure key와 Agent refresh token은 TypeScript `SecretStore`에 넣지 않는다.

- SG2는 배포/install 단계가 쓰는 `apps/client/public/ccc-bootstrap.json`을 정확히 `{ "apiBase": string, "mode": DeploymentMode }` 두 키로 고정하고, 저장소에는 값 없는 `.example`만 둔다. Community Cloud의 `projectRef`, `supabaseAuthOrigin`, `supabasePublishableKey`는 bootstrap에 복사하지 않고 서명된 install manifest에만 둔다. Auth origin은 HTTPS origin만 허용하고 `apiBase`와 같은 Supabase project ref여야 한다. Local 두 모드는 세 값을 모두 `null`로 강제한다. publishable key는 `sb_publishable_` 또는 role이 정확히 `anon`인 legacy JWT만 허용하며 `sb_secret_`, `service_role`, 빈 값과 미지 형식은 manifest 생성 전에 거부한다. publishable key는 공개 설정이지만 capability에는 넣지 않는다. 설치기는 서명된 manifest를 먼저 검증한 뒤 그 manifest의 `installationId`, `mode`, 허용 origin과 `apiBase`를 bootstrap, renderer의 유효 origin, `GET /capabilities` 응답과 전부 정확히 대조한다. 어느 하나라도 다르면 첫 renderer load와 Bearer 전송 전에 실패한다. PWA의 Supabase Auth 초기화와 CSP `connect-src`는 bootstrap이 아니라 검증된 signed manifest의 Auth 값만 사용한다. Single의 OS 할당 포트는 discovery 뒤 그 정확한 origin을 CSP에 주입하고 나서만 renderer를 연다. Electron은 `file://`와 `Origin: null`을 쓰지 않고 custom protocol 또는 local-service same-origin으로 정적 client를 제공한다. mode별 로그인을 끝낸 뒤 Bearer로 `GET /capabilities`를 호출한다. public join route도 검증된 signed manifest와 일치하는 bootstrap 주소만 쓰며 token은 URL Referrer로 나가지 않는다. 현행 Access header와 Preview `ccc_preview` cookie는 E2-7까지의 명시적 전환 예외이고, production의 최종 업무 인증은 Bearer만 허용한다.
- `ApprovedSttEngineId`는 signed engine registry 검증을 통과한 값만 생성하는 branded type이다. 현재 Q 승인 registry는 비어 있으므로 `STT-G1~STT-G3` 결정 전에는 `local`과 `azure` 선택지가 모두 disabled이고 `sttEngine`은 `null`이다. faster-whisper와 Azure Speech는 후보이며 이 정본에서 제품 기본값으로 확정하지 않는다.

```ts
export type DeploymentMode = 'community-cloud' | 'local-single' | 'local-office';
export type SttMode = 'off' | 'local' | 'azure';
export type ApprovedSttEngineId = string & { readonly __approvedSttEngineId: unique symbol };
export type LlmMode = 'off' | 'openai';
export type AgentStatus = 'connected' | 'delayed' | 'authentication_error' | 'quota_exceeded' | 'inactive';
export type CapabilityDisabledReason = 'unverified' | 'missing_key' | 'unsupported' | null;
export interface CapabilityManifest {
  schemaVersion: 1;
  mode: DeploymentMode;
  sttMode: SttMode;
  sttEngine: ApprovedSttEngineId | null;
  sttOptions: Array<{ mode: SttMode; enabled: boolean; disabledReason: CapabilityDisabledReason }>;
  llmMode: LlmMode;
  llmOptions: Array<{ mode: LlmMode; enabled: boolean; disabledReason: CapabilityDisabledReason }>;
  features: Record<'recording' | 'multi_user' | 'offline' | 'public_signup' | 'cloud_audio_temp' | 'ai_draft', boolean>;
  agentStatus: AgentStatus;
}
```
- 업무 응답은 `Cache-Control: no-store`, 인증 CORS는 배포 때 생성한 정확한 client origin만 허용하며 `*`와 credential cookie를 쓰지 않는다. 정적 client CSP는 `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`를 기본으로 하고 `connect-src`에 서명된 bootstrap의 `apiBase`와 승인된 Supabase Auth origin만 더한다. third-party script와 inline script는 0건이다.

- SG6의 fail-closed 계약은 아래 일곱 code와 화면 문구로 고정한다. 로그에는 code, session ID hash, timestamp만 남기고 감지 문자열은 남기지 않는다.

| code | 화면 문구 |
|---|---|
| `masking_snapshot_missing` | 가림 처리 결과가 없어 AI 처리를 멈췄습니다. |
| `local_ner_unavailable` | 이름과 주소 가림 기능을 사용할 수 없어 AI 처리를 멈췄습니다. |
| `registered_pii_detected` | 등록된 개인정보가 남아 있어 AI 처리를 멈췄습니다. |
| `unmasked_identifier_detected` | 가려지지 않은 식별 정보가 감지되어 AI 처리를 멈췄습니다. |
| `evidence_hash_mismatch` | 근거 확인값이 맞지 않아 AI 처리를 멈췄습니다. |
| `masking_pipeline_version_mismatch` | 가림 처리 버전이 맞지 않아 AI 처리를 멈췄습니다. |
| `consent_not_effective` | 현재 동의 상태로는 외부 AI 처리를 진행할 수 없습니다. |

- SG8의 삭제 증거는 `{ keyHash, objectSha256, deletedAt, deleteSucceeded, absentFromList, absentFromMetadata, directReadAbsent, verificationMethod, providerStatus?, verifiedAt }`로 고정한다. 완료 행은 네 boolean이 모두 true일 때만 만든다. Supabase는 인증 GET 404, 로컬 파일은 `stat`의 `ENOENT`, R2는 binding `head` 부재로 직접 읽기 부재를 증명한다. 실제 upload가 없었던 pending key만 `objectSha256: null`을 허용한다.
- Community Cloud의 signed upload URL은 Supabase 고정 2시간, `upsert: false`로 발급한다. client는 `@noble/hashes` 2.4.0으로 File stream SHA-256를 계산해 upload completion에 제출하고 Agent가 처리 전 다시 검증한다. 사람과 browser에는 signed GET을 발급하지 않는다. 페어링된 Agent는 claim 응답의 10분 만료 claim-scoped signed GET으로 내려받고 발급 시각, 주체, 만료를 `audio_objects`에 기록한다. 원음은 다음 영업일의 첫 Agent 처리 기회까지 보관하고 처리 뒤 즉시 삭제한다. 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 삭제하고 관리자 장애 상태를 남긴다. 수기 기록 경로는 계속 제공하며 상담을 다시 녹음하라고 안내하지 않는다. R2와 encrypted filesystem adapter는 두 target method가 null을 반환하고 Local API가 backpressure stream을 제공한다.
- SG9 Recovery Kit v1은 magic bytes `43 43 43 52 01`과 SG10과 같은 Argon2id/AES-GCM envelope를 쓴다. admin이 입력한 16자 이상 passphrase는 저장하지 않는다. payload에는 DB/file master key, `PII_ENC_KEY`, `PII_KEY_VERSION`, 설치 시 생성한 안정 사용자 ID, nullable `officeCaKey` slot, schema/mode metadata를 둔다. 새 PC에서 다른 Windows SID로 복원해도 같은 사용자와 담당 배정이 유지돼야 한다. 키 회전은 새 Kit 쓰기, 검증, 원자적 교체 순서로 재래핑한다.
- SG10의 `.cccx` v1은 magic bytes `43 43 43 58 01` 뒤에 canonical JSON header와 ciphertext를 둔다. header는 `formatVersion: 1`, Argon2id salt 16 bytes와 `memoryKiB: 65536`, `iterations: 3`, `parallelism: 1`, AES-256-GCM nonce 12 bytes, plaintext payload SHA-256를 담는다. Argon2id 출력 32 bytes를 key로 쓰고 canonical header bytes를 AAD로 묶는다. 암호화 전 payload는 deterministic ZIP이며 `manifest.json`, `data/<table>.jsonl`, `attachments/<sha256>`만 허용한다. importer는 header, GCM tag, payload hash, manifest와 각 file hash, schema compatibility를 검증하고 금고 행을 대상 설치 키로 재암호화한다. 첨부는 staging directory에 풀고 import journal을 쓴 뒤 DB transaction과 최종 rename을 연결한다. 어느 단계에서 재시작해도 원본 유지 또는 완전 적용 한 상태로 복구한다.
- SG12의 update manifest v1은 `{ version, sequence, channel, artifactUrl, artifactSha256, artifactBytes, minSchemaVersion, maxSchemaVersion, publishedAt, expiresAt, signingKeyId, ed25519Signature }`다. updater는 embedded Ed25519 public key로 manifest를, Authenticode로 Windows artifact를 각각 검증한다. version과 sequence는 단조 증가해야 하고, 만료 manifest와 알 수 없거나 폐기된 signing key, 다운그레이드는 거부한다. 적용 전에 backup을 만들고 health 실패 시 rollback한다.

- `sttMode`의 설치 기본값은 세 모드 모두 `off`다. 관리자가 provider를 명시적으로 고르고 health check를 통과해야 `local` 또는 `azure`가 된다. E5-8 결과를 Q가 다시 승인해 ADR과 설정을 바꾸기 전에는 `faster-whisper`를 기본으로 자동 선택하지 않는다.
- 앱 서비스인 backup/restore, `.cccx` import/export, update/rollback, doctor/report는 7개 저수준 포트에 넣지 않는다. 이 서비스들은 `packages/core/src/services/`에 인터페이스를 두고 런타임 어댑터를 주입한다. Community Cloud backup/restore는 E6-7, Office 서버 설치기는 E8-9, 최종 RC 조립과 제출은 E10-6이 소유한다.
- E2와 E9의 모든 화면 티켓은 `design-lane`을 따른다. 각 route의 값 한 줄마다 DESIGN-RULES §1 위계 단과 재사용할 `WireCardSection`, `WireItem`, 기존 wire component를 매핑한 표를 티켓 계획에 넣고 구현한다. 각 티켓은 `pnpm guard:tokens && pnpm guard:align && pnpm guard:hierarchy`, `pnpm design:hierarchy`, `pnpm design:align`을 통과한 뒤 격리된 read-only `design-reviewer` 검수와 지적 반영을 끝내야 완료된다. 별도 `packages/ui`, 화면별 새 디자인 체계, 승인되지 않은 baseline 추가는 만들지 않는다.

### 3. 실행 웨이브와 날짜 관문

1. Wave A: E0-5a로 Q 결정을 기록하고 E0-5b로 열린 PR을 정리한다. E0-4, E1-1, SG1~SG15 작성은 병렬로 시작한다. E0-1이 승인된 ADR을 발행해야 SG1~SG12와 SG15를 닫을 수 있다.
2. Wave B: E1 코어 계약을 직렬 완료한다. SG가 닫힌 E2-1, E5-1a, E5-4는 병렬로 시작한다.
3. Wave C: D1 회귀 뒤 E4-1과 E4-4a/b를 먼저 끝내고 E3 SQLite, E7 Local Single, E2 정적 client를 연결한다. PostgreSQL과 Supabase preflight는 별도 worktree에서 병렬로 진행한다.
4. Wave D: 공통 계약과 저장 어댑터가 고정되면 E4-2/E4-3/E4-5, E5 Agent, E6 Cloud, E8 Office를 병렬 실행한다. 같은 migration snapshot을 고치는 E5-6과 E3-8은 충돌 방지를 위해 직렬 병합한다.
5. Wave E: E9 Setup Assistant, E10 릴리스, E11 파일럿을 세 모드의 합성 골든 플로우 위에서 실행한다. 실데이터는 E9-3과 E11-1b가 모두 통과하고 Q가 승인한 모드에만 넣는다.
6. Wave F: 9월 18일 뒤에도 미완 티켓을 닫지 않고 원래 ID, 의존성, 완료 조건으로 계속한다. E12는 별도 후속 기능만 소유하며 미완 승계용 가짜 티켓을 만들지 않는다.

날짜 관문은 고정 완료일이 아니라 증거를 확인하고 사람과 순서를 다시 배치하는 점검일이다. Linear의 각 실행 및 SG leaf 이슈에는 owner, estimate, 외부 대기, target date를 넣고 직렬 경로의 날짜 역전을 허용하지 않는다.

| 관문 날짜 | 반드시 관찰할 결과 | 실패 시 조치 |
|---|---|---|
| 9월 4일 | E0-5a/b 결정 상태, 승인된 E0-1 또는 명시적 승인 대기, SG1/SG2/SG3/SG8 계약, E1-1, 가능한 E1-2 범위 | 승인과 core 계약을 우선한다. E1 전체 완료를 거짓으로 선언하지 않고 독립 스펙과 외부 신청은 계속한다. |
| 9월 7일 | E1 D1 회귀, SQLite native 후보 상태, client 공용 계약, Local Single 조립의 실제 진행 상태 | 평문 fallback 없이 Local을 `미통과`로 표시하고 PostgreSQL, client, Agent 독립 트랙을 계속한다. |
| 9월 10일 | PostgreSQL parity 진행 상태, Supabase read-only preflight, SG14 법무 상태, E2-8 목표 모델 정리 | Cloud 실데이터 전환만 막고 합성 설치와 다른 모드를 계속한다. |
| 9월 13일 | 세 모드별 합성 골든 플로우의 PASS/FAIL/미측정 표와 Windows Agent CPU 후보 경로 | 미통과 모드와 기능을 그대로 남기고 통과 표면만 후속 측정한다. 완료 조건과 assertion은 낮추지 않는다. |
| 9월 15일 | `STT-G1~STT-G3`, 감지 정확도, 실무자 시간 측정, Local 현장 시험의 실제 증거 | 수치와 실패 원인을 그대로 보고하고 미측정 항목의 owner와 다음 날짜를 기록한다. |
| 9월 17일 | 서명된 RC 후보, SBOM, secret scan, 세 모드 backup/restore, rollback | unsigned 또는 복원 실패 artifact는 개발판으로만 남기고 정식 RC로 세지 않는다. |
| 9월 18일 | E10-6 제출 패키지와 합성 시연, 전체 PASS/FAIL/미측정 목록 | 제출 뒤에도 미완 원 티켓을 열린 상태로 계속한다. 범위를 줄인 승계 티켓으로 바꾸지 않는다. |

### 4. Linear 스펙 게이트 15개

SG1~SG15는 위 스펙 표와 1:1인 Linear 이슈다. 각 이슈 본문에 GitHub Issue URL, repo 파일 경로, 확정 commit을 기록한다. GitHub 스펙이 `확정`이면 SG를 Done으로 바꾸고, 구현 검증은 관련 E 티켓이 소유한다. `A`가 `B`의 의존이면 Linear에는 `A blocks B` 한 방향만 만든다.
 
| 게이트 | blocked by | owner lane | target |
|---|---|---|---|
| SG1 | E0-1 | Database contract | 9월 4일 |
| SG2 | E0-1 | Identity contract | 9월 4일 |
| SG3 | E0-1 | Client contract | 9월 4일 |
| SG4 | E0-1 | Local runtime | 9월 5일 |
| SG5 | E0-1 | Processing Agent | 9월 5일 |
| SG6 | E0-1 | Privacy | 9월 5일 |
| SG7 | E0-1, E0-3 | Consent | 9월 5일 |
| SG8 | E0-1 | Audio lifecycle | 9월 4일 |
| SG9 | E0-1 | Recovery | 9월 6일 |
| SG10 | E0-1 | Portability | 9월 6일 |
| SG11 | E0-1 | Community Cloud | 9월 6일 |
| SG12 | E0-1 | Release | 9월 6일 |
| SG13 | 없음 | Pilot metrics | 9월 4일 |
| SG14 | E0-4 | Legal | 9월 5일 |
| SG15 | E0-1 | AI runtime | 9월 5일 |

### 5. 실행 leaf 티켓 106개

아래 번호가 실행 마스터 ID다. Linear 발행 시 실제 `CCC-###`를 본문에 역매핑한다. 같은 ID의 parent roll-up을 별도 이슈로 만들지 않는다.

#### E0 승인과 정본, 6개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E0-5a Q 결정 기록 | 없음 | 2026-09-02 Q 승인 완료. 세 모드 정식 구현, STT 설치 기본 `off`, Cloud 원음 임시 보관, 목표 모델 검수 선행, 다음 영업일 첫 Agent 처리 기회와 이후 24시간 상한을 결정 기록으로 보존한다. |
| E0-5b 열린 PR 정합 | 없음 | PR #210을 ADR-0042와 D84 이후 빈 번호로 재배정하고 preflight 구현을 보존하며 대체 정책을 표시한다. PR #215를 E1 worktree 전에 병합하거나 닫는다. |
| E0-1 ADR-0041 발행 | E0-5a, E0-5b | 승인 기록대로 D77, D81, D8와 SG8의 원음 시계, 열린 항목, D76~D83을 고치고 ADR, `CLAUDE.md`, 템플릿 상태 계약을 발행한다. `guard:doc-numbers`가 열린 PR을 합친 상태에서도 통과한다. |
| E0-2 PRD v0.2 | E0-1 | 세 모드, STT 초기 `off`, E0-5a가 정한 원음 시계와 Cloud 보관, Azure 원음 이전 조건, AI 사용 시 Agent PC, D5 수기 기록 계약과 13종 산출물이 ADR과 일치한다. |
| E0-3 ADR-0040 회수와 대체 표식 | E0-5b | Notion 원문, §9의 6개 literal과 사건 필드 8개를 repo에 보존하고 §8.2, §14와 관련 문서의 부분 또는 전체 대체 범위를 표시한다. |
| E0-4 외부 신청 | 없음 | 코드서명, Azure, pyannote와 모델 라이선스, OpenAI DPA, 법무 담당 항목마다 접수 증거, 담당자, 예상 회신일을 기록한다. |

#### E1 코어 추출, 7개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E1-1 OpenAI 저장 차단 | 없음 | `apps/api/src/ai-provider.ts`의 Responses JSON에 `store: false`를 넣고 fake fetcher가 검증한다. timeout, schema, error mapping은 바꾸지 않는다. |
| E1-2 Database 포트와 D1 어댑터 | E0-5b, SG1 | `packages/contracts/src/database.ts`, `adapters/db-d1`을 만들고 gateway의 D1 타입을 포트로 바꾼다. SQL은 건드리지 않고 D1 계약과 기존 API 테스트를 통과시킨다. |
| E1-3 AudioStore 포트와 R2 어댑터 | E1-2, SG8 | MIME, 200MB, key 규칙을 contracts와 `adapters/audio-r2`로 옮긴다. backpressure stream과 R2 부재 증명을 구현하고 request handler의 R2 직접 타입을 없앤다. |
| E1-4 Scheduler 포트 | E1-2 | watchdog과 retention cron을 `ScheduledJobRunner.run(kind, nowIso)`로 분리하고 Workers와 Node fixture가 같은 runner를 호출하게 한다. |
| E1-5 네 공통 패키지 원자적 이동 | E0-5b, E1-1, E1-2, E1-3, E1-4 | LSP로 gateway, request handler, AI provider를 각 package로 이동하고 모든 caller와 test import를 한 번에 바꾼다. guard를 새 경계로 바꾸고 구 경로, alias, re-export를 남기지 않는다. 원자적 clean cutover라 분할하지 않는다. |
| E1-6 런타임 중립 CI | E1-5 | `guard:core-imports`, `test:runtime --mode`, `test:golden --mode`를 만들고 미구현 mode는 `UNAVAILABLE`와 non-zero exit를 반환하게 한다. |
| E1-7 CapabilityManifest | E1-5, SG2 | 서명된 bootstrap 신뢰 경계와 authenticated `GET /capabilities`를 구현한다. 세 모드 fixture의 schema가 같고 응답에 시크릿과 사용자, 기관 식별값이 없다. |

#### E2 정적 클라이언트, 12개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E2-1 화면과 API 대응표 | SG3 | 운영 화면, `/kit`, 공개 화면, 서버 액션과 API/DTO를 실제 probe로 대조해 누락 0건을 만든다. |
| E2-2 Vite PWA 골격 | E2-1, SG2 | React, Vite, data router, 기존 token과 wire component를 옮긴다. service worker는 정적 asset과 app shell만 cache하고 design guard가 web과 client를 함께 검사한다. |
| E2-3 브라우저 API와 인증 | E2-2, E1-7 | 오류코드 21종, DTO, decoder와 Browser transport를 옮긴다. token과 PII 저장 경계, bootstrap allowlist, Electron same-origin 계약을 검증한다. |
| E2-4a 당사자 목록과 등록 | E2-3 | 당사자 목록, 등록, 현행 2종 동의를 행동 변경 없이 옮기고 `guard:consent-copy`가 client를 검사한다. |
| E2-4b 15초 페이지와 일정 | E2-3 | 15초 페이지와 일정 화면을 행동 변경 없이 옮기고 세 viewport와 light/dark 디자인 검증을 통과한다. |
| E2-4c 기록과 AI 승인 골든 통합 | E2-4a, E2-4b | 기록 작성, AI 검토와 승인을 옮기고 6화면 골든 플로우를 연결한다. `submissionId`, expectedVersion, 409, 저장 실패 recovery가 현행과 같다. |
| E2-5a 관리자와 설정 화면 | E2-4c | 관리자, 온보딩, 설정, 초대 화면을 옮기고 role guard를 유지한다. |
| E2-5b 인테이크와 케이스 화면 | E2-4c, E2-8 | 인테이크, 목표, 개인정보, 종결 화면을 옮긴다. E2-8의 목표 결정과 UI 회귀를 이 화면에서 검증하고 route와 권한 누락을 없앤다. |
| E2-5c 공개 가입 화면 | E2-3 | participant와 worker public join을 업무 shell과 분리하고 token을 credential로 쓰며 Referrer 유출을 막는다. |
| E2-6 공개 site 분리 | E0-2 | `apps/site`에는 landing, 가상데이터 demo, docs만 두고 배포된 route와 network capture에서 상담 경로와 payload가 0건임을 증명한다. |
| E2-7 client clean cutover | E2-5a, E2-5b, E2-5c, E2-6 | 모든 caller를 client로 바꾸고 구 Next 업무 pages, server actions, `server-only` API client와 `apps/web`을 삭제한다. route, design, deploy, rollback 참조를 정리하고 Cloudflare 상담 데이터 요청 0건을 확인한다. |
| E2-8 목표 모델 검수 정리 | E0-5a, E1-5 | E0-5a가 선행을 승인한 경우 ADR-0032, D62와 구현을 대조하고 네 결정을 API 회귀와 code/doc 수정으로 검증한다. client UI 회귀는 E2-5b가 소유한다. Q가 연기를 선택하면 이 이슈만 E12 후속으로 재배정하고 E2-5b의 E2-8 차단 관계를 제거한다. |

#### E3 저장, 9개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E3-1a migration 경로 이동 | E1-5 | SQLite migration을 `migrations/sqlite/`로 옮기고 Wrangler 3곳, test loader, guard와 known duplicate 계약을 갱신한다. preview 미적용 0건과 기존 이력을 확인한다. |
| E3-1b 암호화 SQLite 어댑터 | E1-2, E3-1a | `adapters/db-sqlite`가 같은 migration과 Database fixture, Electron 44 Windows x64 encrypted create/reopen을 통과한다. 평문은 합성 fixture에만 허용한다. |
| E3-2 공통 SQL 부분집합 | E1-5, SG1 | SQLite 전용 표현을 재계수하고 current time bind, conflict helper, placeholder lexical scanner로 바꾼다. `guard:sql-dialect`가 금지 표현 0건을 보고한다. |
| E3-3 PostgreSQL 어댑터 | E3-2 | `postgres` adapter가 `batch()`를 원자 실행하고 중간 실패 fixture에서 전체 rollback을 증명한다. |
| E3-4 PostgreSQL baseline과 parity | E3-1a, E3-3 | 0044 누적 상태를 PostgreSQL baseline으로 재현하고 이후 양쪽 migration과 parity ID를 강제한다. |
| E3-5 RLS 기본 거부 | E3-4 | 모든 업무 table의 anon 기본 거부와 API 전용 role을 검증하고 gateway 권한 검사를 유지한다. |
| E3-6 D1에서 PostgreSQL로 이전 | E3-4 | 합성 dry-run의 table별 건수, 결정론적 row hash, 첨부 hash와 rollback bookmark를 기록한다. |
| E3-7 `.cccx` 1차 이전 | E3-1b, E3-3, E3-4, SG10 | envelope, deterministic ZIP, 금고 재암호화, staging journal과 crash recovery를 구현하고 Single에서 Office와 Cloud import의 row/file hash를 검증한다. |
| E3-8 동의 6영역 migration | E3-4, SG7 | consent를 `migrations/sqlite/0045_consent_six_domains.sql`, `migrations/postgres/0002_consent_six_domains.sql`로 먼저 병합한다. 6개 literal과 append-only event, parity, RLS, API role, schema snapshot을 갱신하고 기존 2종을 자동 승격하지 않는다. |

#### E4 신원, 시크릿, 동의, 7개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E4-1 Identity 포트와 Access 어댑터 | E1-5, E3-1a, SG2 | 현행 Access JWT에서 `Actor`로 가는 동작을 adapter에 보존하고 기존 테스트를 통과한다. `users.auth_subject`, nullable local `users.email`, `auth_revocations`, `agent_installations`의 SQLite paired migration을 만들고 append-only 회수 저장을 배선한다. |
| E4-2 Supabase Auth | E4-1, E3-5 | JWT issuer/audience/JWKS 회전, 초대 가입, MFA와 세션 회수를 증명한다. browser에는 publishable key만 둔다. E4-1과 같은 논리 구조의 PostgreSQL paired migration을 만들고 parity ID를 연결한다. |
| E4-3 Office 로컬 계정 | E4-1 | Argon2id, 잠금, 세션 만료, 관리자 MFA를 구현한다. Single은 이 로그인 경로를 쓰지 않는다. |
| E4-4a SecretStore 포트와 env | E1-5, E1-6 | runtime read port와 `adapters/secrets-env`를 만들고 core와 platform secret 경계를 guard로 고정한다. |
| E4-4b Windows DPAPI | E4-4a, SG9 | `CurrentUser` scope DPAPI를 구현하고 `LocalMachine` 금지, 다른 계정 복호화 실패를 실제 Windows에서 검증한다. 키가 DB, log, error, UI에 0건이다. |
| E4-5 Recovery Kit | E3-1b, E4-4b, SG9 | DB/file/PII key와 버전, 안정 사용자 ID, nullable CA slot을 암호화한다. Kit 쓰기, 검증, 재래핑과 원자 교체, 다른 SID의 실제 Windows에서 cross-SID decrypt를 검증한다. 앱 수준 금고 열람과 기록 저장은 E7-3과 E8-5가 소유한다. |
| E4-6 동의 6영역 전체 배선 | E3-8, E4-1, E2-7, E5-1a | API, client, Agent gate를 6영역으로 원자적 cutover한다. 사건 8개 필드를 append하고 기존 2종은 미확정으로 표시한다. 미동의 축만 꺼지고 수기 기록은 계속된다. |

#### E5 Processing Agent와 Privacy, 11개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E5-1a Agent 작업 계약 v2 | SG5 | claim, lease, heartbeat, result, engine, route, 공정한 audio/text queue 선택, provider no-fallback, v1 payload fallback 제거를 문서와 schema에 고정한다. 세 모드의 사람과 service credential 범위를 계약 테스트한다. |
| E5-1b Agent Windows SecretStore | E5-1a, E4-4b | Python DPAPI `CurrentUser`와 개발용 env backend를 구현하고 실제 Windows 계정 경계를 검증한다. |
| E5-2 Local STT 후보 경로 | E5-1a | chunking, repetition, timestamp 보정을 유지하고 faster-whisper int8 CPU adapter를 명시적 후보 설정에만 추가한다. |
| E5-3 Azure Speech | E5-1b, E5-2, E4-6 | Azure key와 유효 동의를 읽고 서울 endpoint로 직접 보낸다. logging off, provider pin, 무전환을 검증한다. |
| E5-4 준식별자 일반화 | SG6 | SG6 규칙만 적용하고 마스킹, pipeline version, 원문 근거 hash를 보존해 골든셋을 통과한다. |
| E5-5 코어 재검증 | E5-1a, E5-4, E1-5, E3-8 | 정규식, 금고 값, hash, pipeline version, result 시점 동의를 검사한다. 일곱 code와 화면 문구가 1:1이고 실패 packet은 AIProvider 호출 0회다. consent 검사에는 6영역 schema와 literal만 필요하며 client cutover를 기다리지 않는다. |
| E5-6 원음 생명주기와 삭제 | E0-5a, E1-3, E3-8, SG8 | E0-5a가 고른 시계와 우선순위로 `migrations/sqlite/0046_audio_objects.sql`, `migrations/postgres/0003_audio_objects.sql`과 parity를 추가하고 처리 완료, 만료, 기동 경합, 삭제 증거 쓰기 실패를 멱등 조정한다. provider URL 세부 구현은 E6-3이 소유한다. |
| E5-7 Windows Agent 설치기 | E5-1b, E5-2, E5-4 | embedded Python, ffmpeg, SecretStore, checksum model downloader를 설치한다. 새 Windows PC에서 install, health, Local 합성 처리, uninstall을 통과한다. |
| E5-8a STT benchmark fixture | SG13 | 합성 대화 음성, 정답 전사, 두 화자 truth와 silence/overlap range, SHA-256, license manifest를 `scripts/stt/fixtures/manifest.json`, `scripts/stt/fixtures/reference/`, `scripts/stt/fixtures/licenses.json`에 고정하고 GitHub Release `s13-fixture-v1` 음성을 `artifacts/pilot/fixtures/s13-v1/audio/`에 fetch한다. `scripts/stt/verify_fixture.py`가 `artifacts/pilot/fixtures/s13-v1-verification.json`에 manifest hash와 count, duration, speaker, range, license 검사를 남긴다. WAV는 저장소에 커밋하지 않는다. |
| E5-8 `STT-G1~STT-G3` 엔진 판정 | E5-2, E5-8a | `scripts/stt/benchmark.py`가 같은 fixture를 측정해 per-session과 pooled CER, repetition rate, RTF, DER, safety를 `artifacts/pilot/results/{runId}/`에 원문 없이 보고한다. RTF는 Windows CPU target에서 판정하고 Q 승인 전 제품 설정은 바꾸지 않는다. |
| E5-9 장문 AI Packet | E5-4, E5-5, E2-7, SG15 | 시간 청크, 분할 호출, 부분 실패 재시도, 병합과 근거 보존을 구현한다. `detectDiscrepancies` 미지원은 조용히 건너뛰지 않고 명시적 상태로 표시한다. |

#### E6 Community Cloud, 11개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E6-1a Supabase read-only preflight | E0-5b | PR #210을 ADR-0042와 E6-1a 범위로 정리하고 v0.1 정책 전제를 제거한다. read-only plan과 관련 검증을 통과한 PR #210이 병합되면 브랜치의 `ccc-140` 연동이 이 티켓을 Done으로 바꾸는 것이 정확하다. |
| E6-1b Supabase apply와 baseline | E6-1a, E3-4, E3-5, SG11 | 서울 리전 PostgreSQL, Auth, private Storage, cron과 전용 API role을 idempotent install로 적용한다. |
| E6-2 Edge Function wrapper | E1-5, E3-3, E4-2 | Deno `serve`가 공통 handler에 runtime adapter를 주입한다. CORS를 정확한 client origin으로 제한하고 audio 본문은 Edge를 지나지 않는다. |
| E6-3 Supabase AudioStore | E1-3, E5-6, E6-1a | 2시간 upload, E0-5a와 SG8이 정한 object lifetime, claim-scoped 10분 GET, 독립 head와 인증 GET 404를 호스팅 합성 프로젝트에서 검증한다. |
| E6-4 Agent 페어링 | E5-1a, E6-2 | 10분 1회 pairing code와 회전 refresh token을 구현하고 service principal을 job endpoint에만 제한한다. |
| E6-5a install/doctor/update 명령 | E6-1b, E6-2, E6-3, E6-4, SG12 | install, doctor, update, rollback, redacted report 명령을 구현하고 서명과 rollback 계약을 검증한다. |
| E6-5b 깨끗한 기관 Cloud drill | E6-5a, E3-7, E6-7 | 합성 기관에서 설치, 진단, `.cccx` import, update, rollback, backup/restore를 종단 실행한다. |
| E6-6a preview 이전과 dry-run | E2-7, E3-6, E6-5b | preview와 production을 분리하고 두 번의 합성 dry-run에서 건수, hash, rollback을 검증한다. |
| E6-6b production 전환 | E6-6a, E4-6, E5-5, E5-9, E9-3, E11-1b | 법무와 Q 승인이 닫힌 뒤에만 production을 전환하고 6영역 골든 플로우를 다시 실행한다. 미통과면 합성 데이터만 유지한다. |
| E6-6c Cloudflare 상담 runtime 은퇴 | E6-6b | rollback window 종료와 pending audio/job 0건 뒤 Workers shell과 상담 D1/R2 배포 설정을 삭제한다. D1 adapter와 ETL은 계약 도구로만 남긴다. |
| E6-7 Community Cloud backup/restore | E6-1b, E6-3, SG9 | DB, private Storage와 설치 metadata를 백업하고 깨끗한 기관 프로젝트로 복원한다. 복원 뒤 로그인, 금고 열람, 기록 저장과 object hash를 검증한다. |

#### E7 Local Single, 8개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E7-1a Single runtime adapters | E1-5, E3-1b, E4-1, E4-4a, SG4, SG8 | encrypted file AudioStore, Node Scheduler, stable local identity와 두 bearer를 구현한다. |
| E7-1b local-service Single profile | E7-1a, E4-4b | loopback 임의 port와 DPAPI endpoint discovery를 조립한다. raw SID와 bearer를 저장하지 않고 외부 NIC listen 0건을 증명한다. |
| E7-2 Electron shell과 앱 잠금 | E7-1b, E2-4c | custom protocol 또는 same-origin client, preload memory bearer, sandbox, navigation allowlist, 앱 잠금과 crash cleanup을 검증한다. |
| E7-3 backup/restore | E4-5, E7-1b | 자동과 수동 backup, update 전 backup, delete, 다른 SID 새 PC restore를 구현하고 금고 열람과 기록 저장을 증명한다. |
| E7-4 NSIS 설치기 | E7-2, SG12 | x64 설치와 제거, Agent 후설치, AI Off doctor를 깨끗한 Windows PC에서 검증한다. |
| E7-5 장애와 AI Off | E7-4, E3-7 | offline, provider Off, 키 없음과 소진에서도 수기 기록과 15초 페이지, export가 계속되고 자동 전환이 없음을 증명한다. |
| E7-6a update와 rollback core | E7-3, E7-4, SG12 | Ed25519 manifest, 단조 version, update 전 backup, 적용과 health 실패 rollback을 개발 서명으로 검증한다. |
| E7-6b Authenticode update | E7-6a, E10-3 | 실제 서명된 Single과 Office package만 적용되고 unsigned와 downgrade는 거부됨을 검증한다. |

#### E8 Local Office, 9개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E8-1 Office service profile | E7-1b, SG4 | 전용 Windows Service 계정, DPAPI, LAN bind, health, watchdog, SQLite WAL, Scheduler와 service principal을 조립한다. |
| E8-2 내부망 TLS | E8-1 | name-constrained CA와 server certificate를 만들고 CA key를 service 계정 DPAPI에 둔다. 평문 HTTP를 거부한다. |
| E8-3 client installer | E8-2, E2-4c | CurrentUser trust store에 CA를 설치하고 server URL과 shortcut을 설정한다. 서버 1대와 client 2대에서 같은 client가 열린다. |
| E8-4 다중 사용자와 충돌 | E4-3, E8-1, E2-5a, E2-5b | 역할 4종, 담당과 감독 범위, 감사, expectedVersion 409를 구현하고 조용한 덮어쓰기 0건을 증명한다. |
| E8-5 중앙 backup과 서버 교체 | E7-3, E8-2, E4-5 | DB, files, CA key를 복원해 기존 client 재설치 없이 HTTPS, 금고 열람, 기록 저장을 복구한다. |
| E8-6 방화벽과 외장 디스크 | E8-1 | 필요한 내부망 port만 열고 public profile과 외부 NIC를 막는다. 외장 디스크는 backup destination으로만 쓴다. |
| E8-7 관리자 MFA | E4-3, E8-1 | Office 관리자 MFA, recovery와 lockout을 감사하고 일반 실무자와 Single에는 적용하지 않는다. |
| E8-8 교체 자동화와 부하 | E8-3, E8-4, E8-5, E8-6 | SG4가 정한 상한으로 100 cases, 10 concurrent sessions, client 2대의 latency, 오류율, 메모리, 409, restart, restore를 판정한다. |
| E8-9 Office 서버 설치기 | E8-1, E8-2, E8-6, SG12 | Windows Service 계정과 profile, 방화벽, TLS, health, uninstall을 조립한 서버 설치기를 만들고 깨끗한 서버 PC에서 검증한다. |

#### E9 Setup Assistant, 4개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E9-1 모드와 AI 축 선택 | E2-5a, E2-5b, E2-5c, E1-7 | 18개 조합을 manifest로 검사하고 미선택 provider의 키를 요구하지 않는다. Q 승인 전 Local STT는 `검증 중` 비활성이다. |
| E9-2 연결 검사와 상태 5종 | E5-1a, E5-3, E5-5, E9-1 | 세 모드의 실제 service와 합성 요청으로 다섯 상태를 구분한다. 원문과 시크릿은 진단과 log에 없다. |
| E9-3 실데이터 Green Gate | SG14, E1-5, E4-6 | E11-1b의 모드별 LG 상태를 읽고 한 항목이라도 미통과면 실데이터 생성, import, upload를 API에서 거부한다. 화면 숨김만으로 구현하지 않는다. |
| E9-4 설치 가이드 | E5-7, E6-5b, E7-4, E8-3, E8-9, SG12 | 비개발자 1명이 새 환경에서 install, doctor, 합성 골든 플로우, backup, restore를 문서만 보고 수행한다. |

#### E10 릴리스와 공개, 6개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E10-1 CI 모드 matrix | E1-6, E2-7, E4-6, E5-9, E6-5b, E7-5, E8-4 | Linux/Deno contracts, Windows x64 packages, 세 DB parity와 세 모드 합성 구현을 연결한다. Done은 matrix가 모든 결과를 진실하게 보고하는 상태이고, mode별 PASS 전에는 해당 칸을 초록으로 표시하지 않는다. |
| E10-2 공급망과 시크릿 검사 | 없음 | SBOM, NOTICE, 라이선스 allowlist, gitleaks와 fixture/manifest scan을 만든다. 미표기 모델과 실제 key, PII fixture가 0건이다. |
| E10-3 코드서명 | E0-4, E5-7, E7-4, E8-3, E8-9, SG12 | 실제 OV/EV 또는 Artifact Signing으로 Single, Office server/client, Agent 설치기를 서명한다. checksum만 있는 artifact는 개발판이다. |
| E10-4 매뉴얼과 Policy Kit | E4-6, E6-5b, E7-4, E8-3, E8-9, SG12 | 설치, 온보딩, 운영, 복원, 이전 문서와 Policy Kit를 실제 명령과 맞춘다. |
| E10-5 rollback 훈련 | E6-5b, E7-6a, E8-5 | 개발 서명으로 세 모드를 한 버전 올렸다가 health 실패로 되돌리고 데이터와 금고 열람을 검증한다. 실제 Authenticode 재실행은 E7-6b가 소유한다. |
| E10-6 제출 패키지와 시연 | E0-2, E10-2, E11-5 | 제출 시점의 서명 artifact 또는 명시된 unsigned 개발판, SBOM, 매뉴얼, 보고서, 합성 시연을 조립한다. 관련 티켓 상태를 PASS/FAIL/미측정으로 그대로 옮기고 미완 티켓은 열린 채 유지한다. Done은 제출 완료이지 정식 RC 승인이 아니다. |

#### E11 파일럿과 임팩트, 7개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E11-1a 법무 상태표 | E0-4 | ADR이 요구하는 9개 법무 항목마다 담당자, 마감, 증빙 위치를 기록한다. 외부 회신을 기다리지 않고 상태표 자체를 닫는다. |
| E11-1b 법무 게이트 `LG1~LG3` 통과 | E11-1a, SG14 | 모든 증빙과 모드별 Q real-data green 기록이 연결될 때만 Done이다. 미통과면 9월 18일 뒤에도 열린 상태를 유지한다. |
| E11-2a 감지 정답표 제작 | E5-8a | E5-8a fixture의 30개 synthetic cases와 case당 5 sessions에서 TP/FP/FN 정답표를 독립적으로 고정하고 사후 threshold 조정을 막는다. |
| E11-2 감지 정확도 | E2-4c, E11-2a | precision, recall, 95% bootstrap interval과 모든 오답 example ID를 산출한다. |
| E11-3 합성 실무자 사용 시험 | E6-5b, E7-5, E8-4, E9-1 | 실무자 3명이 세 모드 합성 flow를 수행하고 작성 시간, 준비 시간, AI 수정량을 비교한다. 실데이터 시험은 E12-5가 소유한다. |
| E11-4 Local 현장 시험 | E5-7, E7-5, E8-5, E8-6, E8-9 | Single 새 PC와 Office server 1대/client 2대에서 install, Agent, offline, AI Off, conflict, backup과 server replacement를 검증한다. |
| E11-5 시험과 임팩트 보고서 | E5-5, E5-8a, E6-7, E7-3, E8-5, E10-2, E11-2a, E11-2 | 제출 시점에 E5-5 privacy/masking, E6-7/E7-3/E8-5 backup, E10-2 security/supply-chain, STT, 감지 정확도와 시간 변화의 원 증거를 각각 연결한다. 미완 결과는 미측정, 실패 결과는 FAIL로 남기며 관련 실행 티켓을 닫지 않는다. |

#### E12 9월 18일 이후 후속, 9개

| 티켓 | 의존 | 변경과 완료 조건 |
|---|---|---|
| E12-1a UnitOfWork 기반 | E1-5, E3-4 | gateway 내부 transaction 경계를 만들고 public facade와 세 DB 회귀를 유지한다. |
| E12-1b 동의 repository | E12-1a, E4-6 | 동의 도메인만 repository로 옮기고 다른 package의 직접 import를 막는다. |
| E12-1c 감사 repository | E12-1b | 감사 도메인을 옮기고 append-only와 세 DB 계약을 검증한다. |
| E12-1d AI 초안 repository | E12-1c, E5-9 | AI 초안 도메인을 옮기고 승인 전 공식 기록 배제를 검증한다. |
| E12-1e 케이스 repository | E12-1d | 케이스 도메인을 옮기고 권한, 담당, 409와 세 DB 계약을 검증한다. |
| E12-2 `.cccx` 남은 방향 | E3-7, E6-5b | Cloud에서 Office/Single, Office에서 Cloud를 추가해 전 방향 row/file hash가 같게 한다. |
| E12-3 원격지원 임시 권한 | E6-6a | 목적, 범위, 만료, 승인자, 감사와 즉시 철회를 구현하고 플랫폼 운영자는 마스킹 자료만 보게 한다. |
| E12-4 30일 자립 운영 지표 | E6-6b, E10-5, E11-1b, E11-4 | 모드별 첫 실제 운영일부터 각각 30일간 내용 없는 설치, doctor, 지원, restore, rollback 지표를 모은다. 합성 기간은 집계하지 않는다. |
| E12-5 실데이터 파일럿 계속 | E9-3, E11-1b, E11-3 | 모드별 Q real-data green 승인 뒤 10~20건을 계속 측정하고 합성 결과와 분리한다. |

등록부 합계는 E0 6 + E1 7 + E2 12 + E3 9 + E4 7 + E5 11 + E6 11 + E7 8 + E8 9 + E9 4 + E10 6 + E11 7 + E12 9 = 106이다. Linear에는 이 실행 티켓 106개와 SG1~SG15 15개, 총 121개 이슈를 만든다.

### 6. 기존 Linear 이슈 cutover와 실행 모델

- 새 프로젝트 이름은 `CCC Open Pilot v0.3`이다. 팀은 CCC, 목표일은 9월 18일, 실제 assignee는 팀의 활성 사용자 `Seongqkim`으로 둔다. 실행 모델과 추론 강도는 각 이슈 본문에 별도로 기록한다.
- 기존 이슈 네 개는 history와 열린 PR 연결을 보존하며 새 master ID로 갱신한다: `CCC-140 → E6-1a`, `CCC-141 → E6-1b`, `CCC-142 → E4-2`, `CCC-147 → E6-3`.
- `CCC-140`은 PR #210의 `feat/ccc-140-supabase-preflight` 브랜치가 병합될 때 자동으로 Done이 된다. E6-1a의 완료 조건을 PR #210 정리와 병합으로 맞췄으므로 별도 상태 되돌리기를 하지 않는다. 병합 전에는 Backlog로 둔다.
- 다음 15개는 대체 이슈가 생성된 뒤 취소 상태로 바꾸고, 본문 또는 코멘트에 대체 master ID와 Linear URL을 남긴다: `CCC-134`, `CCC-135`, `CCC-138`, `CCC-143`~`CCC-146`, `CCC-148`~`CCC-155`.
- `CCC-99`, `CCC-133`, `CCC-136`, `CCC-137`, `CCC-139`는 이번 cutover와 직접 겹치지 않으므로 그대로 둔다.
- 새로 만드는 이슈는 117개다. 재사용 4개를 합쳐 master graph는 실행 106개와 SG 15개, 총 121개다. 기존 이슈를 취소하기 전 새 이슈 생성과 blocks 관계 검증을 끝낸다.
- 기본 실행 모델은 `GPT-5.6 SOL`이다. 인증, 데이터, privacy, migration, backup/restore, cutover, release처럼 실패 반경이 큰 티켓은 `xhigh`, 나머지 코드와 UI 티켓은 `high` 추론을 쓴다.
- 스펙, 정책, 법무 상태표, 매뉴얼, 근거 종합은 `Fable 5.1`과 `high` 추론을 쓴다. E0-5a의 최종 결정은 모델이 대신하지 않고 Q 응답을 기록한다.
- 이슈가 여러 범주에 걸리면 더 높은 추론 강도를 쓴다. 모델을 바꾸더라도 완료 조건, 테스트, 의존성은 바꾸지 않는다.

#### Linear master ledger

| Master | Linear |
|---|---|
| `SG1` | [CCC-163](https://linear.app/bss-ccc/issue/CCC-163/sg1-database-포트와-sql-부분집합-확정-게이트) |
| `SG2` | [CCC-169](https://linear.app/bss-ccc/issue/CCC-169/sg2-인증과-capabilitymanifest-확정-게이트) |
| `SG3` | [CCC-164](https://linear.app/bss-ccc/issue/CCC-164/sg3-화면과-api-대응표-확정-게이트) |
| `SG4` | [CCC-159](https://linear.app/bss-ccc/issue/CCC-159/sg4-local-service-profile-확정-게이트) |
| `SG5` | [CCC-162](https://linear.app/bss-ccc/issue/CCC-162/sg5-processing-agent-작업-계약-v2-확정-게이트) |
| `SG6` | [CCC-167](https://linear.app/bss-ccc/issue/CCC-167/sg6-privacy-packet-확정-게이트) |
| `SG7` | [CCC-166](https://linear.app/bss-ccc/issue/CCC-166/sg7-동의-6영역-확정-게이트) |
| `SG8` | [CCC-165](https://linear.app/bss-ccc/issue/CCC-165/sg8-원음-생명주기와-audiostore-확정-게이트) |
| `SG9` | [CCC-168](https://linear.app/bss-ccc/issue/CCC-168/sg9-시크릿과-recovery-kit-확정-게이트) |
| `SG10` | [CCC-172](https://linear.app/bss-ccc/issue/CCC-172/sg10-cccx-이전-포맷-확정-게이트) |
| `SG11` | [CCC-161](https://linear.app/bss-ccc/issue/CCC-161/sg11-supabase-edge-template-확정-게이트) |
| `SG12` | [CCC-160](https://linear.app/bss-ccc/issue/CCC-160/sg12-설치와-릴리스-확정-게이트) |
| `SG13` | [CCC-176](https://linear.app/bss-ccc/issue/CCC-176/sg13-파일럿-측정-확정-게이트) |
| `SG14` | [CCC-157](https://linear.app/bss-ccc/issue/CCC-157/sg14-법무와-실데이터-게이트-확정-게이트) |
| `SG15` | [CCC-158](https://linear.app/bss-ccc/issue/CCC-158/sg15-장문-ai-packet-확정-게이트) |
| `E0-5a` | [CCC-156](https://linear.app/bss-ccc/issue/CCC-156/e0-5a-q-결정-기록) |
| `E0-5b` | [CCC-173](https://linear.app/bss-ccc/issue/CCC-173/e0-5b-열린-pr-정합) |
| `E0-1` | [CCC-170](https://linear.app/bss-ccc/issue/CCC-170/e0-1-adr-0041-발행) |
| `E0-2` | [CCC-190](https://linear.app/bss-ccc/issue/CCC-190/e0-2-prd-v02) |
| `E0-3` | [CCC-182](https://linear.app/bss-ccc/issue/CCC-182/e0-3-adr-0040-회수와-대체-표식) |
| `E0-4` | [CCC-191](https://linear.app/bss-ccc/issue/CCC-191/e0-4-외부-신청) |
| `E1-1` | [CCC-171](https://linear.app/bss-ccc/issue/CCC-171/e1-1-openai-저장-차단) |
| `E1-2` | [CCC-175](https://linear.app/bss-ccc/issue/CCC-175/e1-2-database-포트와-d1-어댑터) |
| `E1-3` | [CCC-177](https://linear.app/bss-ccc/issue/CCC-177/e1-3-audiostore-포트와-r2-어댑터) |
| `E1-4` | [CCC-174](https://linear.app/bss-ccc/issue/CCC-174/e1-4-scheduler-포트) |
| `E1-5` | [CCC-178](https://linear.app/bss-ccc/issue/CCC-178/e1-5-네-공통-패키지-원자적-이동) |
| `E1-6` | [CCC-183](https://linear.app/bss-ccc/issue/CCC-183/e1-6-런타임-중립-ci) |
| `E1-7` | [CCC-180](https://linear.app/bss-ccc/issue/CCC-180/e1-7-capabilitymanifest) |
| `E2-1` | [CCC-201](https://linear.app/bss-ccc/issue/CCC-201/e2-1-화면과-api-대응표) |
| `E2-2` | [CCC-204](https://linear.app/bss-ccc/issue/CCC-204/e2-2-vite-pwa-골격) |
| `E2-3` | [CCC-212](https://linear.app/bss-ccc/issue/CCC-212/e2-3-브라우저-api와-인증) |
| `E2-4a` | [CCC-205](https://linear.app/bss-ccc/issue/CCC-205/e2-4a-당사자-목록과-등록) |
| `E2-4b` | [CCC-210](https://linear.app/bss-ccc/issue/CCC-210/e2-4b-15초-페이지와-일정) |
| `E2-4c` | [CCC-211](https://linear.app/bss-ccc/issue/CCC-211/e2-4c-기록과-ai-승인-골든-통합) |
| `E2-5a` | [CCC-209](https://linear.app/bss-ccc/issue/CCC-209/e2-5a-관리자와-설정-화면) |
| `E2-5b` | [CCC-206](https://linear.app/bss-ccc/issue/CCC-206/e2-5b-인테이크와-케이스-화면) |
| `E2-5c` | [CCC-215](https://linear.app/bss-ccc/issue/CCC-215/e2-5c-공개-가입-화면) |
| `E2-6` | [CCC-219](https://linear.app/bss-ccc/issue/CCC-219/e2-6-공개-site-분리) |
| `E2-7` | [CCC-217](https://linear.app/bss-ccc/issue/CCC-217/e2-7-client-clean-cutover) |
| `E2-8` | [CCC-233](https://linear.app/bss-ccc/issue/CCC-233/e2-8-목표-모델-검수-정리) |
| `E3-1a` | [CCC-214](https://linear.app/bss-ccc/issue/CCC-214/e3-1a-migration-경로-이동) |
| `E3-1b` | [CCC-220](https://linear.app/bss-ccc/issue/CCC-220/e3-1b-암호화-sqlite-어댑터) |
| `E3-2` | [CCC-218](https://linear.app/bss-ccc/issue/CCC-218/e3-2-공통-sql-부분집합) |
| `E3-3` | [CCC-222](https://linear.app/bss-ccc/issue/CCC-222/e3-3-postgresql-어댑터) |
| `E3-4` | [CCC-216](https://linear.app/bss-ccc/issue/CCC-216/e3-4-postgresql-baseline과-parity) |
| `E3-5` | [CCC-221](https://linear.app/bss-ccc/issue/CCC-221/e3-5-rls-기본-거부) |
| `E3-6` | [CCC-235](https://linear.app/bss-ccc/issue/CCC-235/e3-6-d1에서-postgresql로-이전) |
| `E3-7` | [CCC-224](https://linear.app/bss-ccc/issue/CCC-224/e3-7-cccx-1차-이전) |
| `E3-8` | [CCC-223](https://linear.app/bss-ccc/issue/CCC-223/e3-8-동의-6영역-migration) |
| `E4-1` | [CCC-227](https://linear.app/bss-ccc/issue/CCC-227/e4-1-identity-포트와-access-어댑터) |
| `E4-2` | [CCC-142](https://linear.app/bss-ccc/issue/CCC-142/e4-2-supabase-auth) |
| `E4-3` | [CCC-226](https://linear.app/bss-ccc/issue/CCC-226/e4-3-office-로컬-계정) |
| `E4-4a` | [CCC-225](https://linear.app/bss-ccc/issue/CCC-225/e4-4a-secretstore-포트와-env) |
| `E4-4b` | [CCC-230](https://linear.app/bss-ccc/issue/CCC-230/e4-4b-windows-dpapi) |
| `E4-5` | [CCC-232](https://linear.app/bss-ccc/issue/CCC-232/e4-5-recovery-kit) |
| `E4-6` | [CCC-234](https://linear.app/bss-ccc/issue/CCC-234/e4-6-동의-6영역-전체-배선) |
| `E5-1a` | [CCC-228](https://linear.app/bss-ccc/issue/CCC-228/e5-1a-agent-작업-계약-v2) |
| `E5-1b` | [CCC-229](https://linear.app/bss-ccc/issue/CCC-229/e5-1b-agent-windows-secretstore) |
| `E5-2` | [CCC-231](https://linear.app/bss-ccc/issue/CCC-231/e5-2-local-stt-후보-경로) |
| `E5-3` | [CCC-236](https://linear.app/bss-ccc/issue/CCC-236/e5-3-azure-speech) |
| `E5-4` | [CCC-237](https://linear.app/bss-ccc/issue/CCC-237/e5-4-준식별자-일반화) |
| `E5-5` | [CCC-238](https://linear.app/bss-ccc/issue/CCC-238/e5-5-코어-재검증) |
| `E5-6` | [CCC-261](https://linear.app/bss-ccc/issue/CCC-261/e5-6-원음-생명주기와-삭제) |
| `E5-7` | [CCC-245](https://linear.app/bss-ccc/issue/CCC-245/e5-7-windows-agent-설치기) |
| `E5-8a` | [CCC-243](https://linear.app/bss-ccc/issue/CCC-243/e5-8a-stt-benchmark-fixture) |
| `E5-8` | [CCC-250](https://linear.app/bss-ccc/issue/CCC-250/e5-8-stt-g1stt-g3-엔진-판정) |
| `E5-9` | [CCC-239](https://linear.app/bss-ccc/issue/CCC-239/e5-9-장문-ai-packet) |
| `E6-1a` | [CCC-140](https://linear.app/bss-ccc/issue/CCC-140/e6-1a-supabase-read-only-preflight) |
| `E6-1b` | [CCC-141](https://linear.app/bss-ccc/issue/CCC-141/e6-1b-supabase-apply와-baseline) |
| `E6-2` | [CCC-248](https://linear.app/bss-ccc/issue/CCC-248/e6-2-edge-function-wrapper) |
| `E6-3` | [CCC-147](https://linear.app/bss-ccc/issue/CCC-147/e6-3-supabase-audiostore) |
| `E6-4` | [CCC-241](https://linear.app/bss-ccc/issue/CCC-241/e6-4-agent-페어링) |
| `E6-5a` | [CCC-240](https://linear.app/bss-ccc/issue/CCC-240/e6-5a-installdoctorupdate-명령) |
| `E6-5b` | [CCC-256](https://linear.app/bss-ccc/issue/CCC-256/e6-5b-깨끗한-기관-cloud-drill) |
| `E6-6a` | [CCC-242](https://linear.app/bss-ccc/issue/CCC-242/e6-6a-preview-이전과-dry-run) |
| `E6-6b` | [CCC-244](https://linear.app/bss-ccc/issue/CCC-244/e6-6b-production-전환) |
| `E6-6c` | [CCC-254](https://linear.app/bss-ccc/issue/CCC-254/e6-6c-cloudflare-상담-runtime-은퇴) |
| `E6-7` | [CCC-246](https://linear.app/bss-ccc/issue/CCC-246/e6-7-community-cloud-backuprestore) |
| `E7-1a` | [CCC-253](https://linear.app/bss-ccc/issue/CCC-253/e7-1a-single-runtime-adapters) |
| `E7-1b` | [CCC-266](https://linear.app/bss-ccc/issue/CCC-266/e7-1b-local-service-single-profile) |
| `E7-2` | [CCC-247](https://linear.app/bss-ccc/issue/CCC-247/e7-2-electron-shell과-앱-잠금) |
| `E7-3` | [CCC-249](https://linear.app/bss-ccc/issue/CCC-249/e7-3-backuprestore) |
| `E7-4` | [CCC-267](https://linear.app/bss-ccc/issue/CCC-267/e7-4-nsis-설치기) |
| `E7-5` | [CCC-252](https://linear.app/bss-ccc/issue/CCC-252/e7-5-장애와-ai-off) |
| `E7-6a` | [CCC-251](https://linear.app/bss-ccc/issue/CCC-251/e7-6a-update와-rollback-core) |
| `E7-6b` | [CCC-255](https://linear.app/bss-ccc/issue/CCC-255/e7-6b-authenticode-update) |
| `E8-1` | [CCC-257](https://linear.app/bss-ccc/issue/CCC-257/e8-1-office-service-profile) |
| `E8-2` | [CCC-269](https://linear.app/bss-ccc/issue/CCC-269/e8-2-내부망-tls) |
| `E8-3` | [CCC-259](https://linear.app/bss-ccc/issue/CCC-259/e8-3-client-installer) |
| `E8-4` | [CCC-258](https://linear.app/bss-ccc/issue/CCC-258/e8-4-다중-사용자와-충돌) |
| `E8-5` | [CCC-268](https://linear.app/bss-ccc/issue/CCC-268/e8-5-중앙-backup과-서버-교체) |
| `E8-6` | [CCC-260](https://linear.app/bss-ccc/issue/CCC-260/e8-6-방화벽과-외장-디스크) |
| `E8-7` | [CCC-265](https://linear.app/bss-ccc/issue/CCC-265/e8-7-관리자-mfa) |
| `E8-8` | [CCC-262](https://linear.app/bss-ccc/issue/CCC-262/e8-8-교체-자동화와-부하) |
| `E8-9` | [CCC-263](https://linear.app/bss-ccc/issue/CCC-263/e8-9-office-서버-설치기) |
| `E9-1` | [CCC-264](https://linear.app/bss-ccc/issue/CCC-264/e9-1-모드와-ai-축-선택) |
| `E9-2` | [CCC-271](https://linear.app/bss-ccc/issue/CCC-271/e9-2-연결-검사와-상태-5종) |
| `E9-3` | [CCC-270](https://linear.app/bss-ccc/issue/CCC-270/e9-3-실데이터-green-gate) |
| `E9-4` | [CCC-272](https://linear.app/bss-ccc/issue/CCC-272/e9-4-설치-가이드) |
| `E10-1` | [CCC-179](https://linear.app/bss-ccc/issue/CCC-179/e10-1-ci-모드-matrix) |
| `E10-2` | [CCC-181](https://linear.app/bss-ccc/issue/CCC-181/e10-2-공급망과-시크릿-검사) |
| `E10-3` | [CCC-187](https://linear.app/bss-ccc/issue/CCC-187/e10-3-코드서명) |
| `E10-4` | [CCC-184](https://linear.app/bss-ccc/issue/CCC-184/e10-4-매뉴얼과-policy-kit) |
| `E10-5` | [CCC-186](https://linear.app/bss-ccc/issue/CCC-186/e10-5-rollback-훈련) |
| `E10-6` | [CCC-192](https://linear.app/bss-ccc/issue/CCC-192/e10-6-제출-패키지와-시연) |
| `E11-1a` | [CCC-189](https://linear.app/bss-ccc/issue/CCC-189/e11-1a-법무-상태표) |
| `E11-1b` | [CCC-185](https://linear.app/bss-ccc/issue/CCC-185/e11-1b-법무-게이트-lg1lg3-통과) |
| `E11-2a` | [CCC-188](https://linear.app/bss-ccc/issue/CCC-188/e11-2a-감지-정답표-제작) |
| `E11-2` | [CCC-195](https://linear.app/bss-ccc/issue/CCC-195/e11-2-감지-정확도) |
| `E11-3` | [CCC-196](https://linear.app/bss-ccc/issue/CCC-196/e11-3-합성-실무자-사용-시험) |
| `E11-4` | [CCC-193](https://linear.app/bss-ccc/issue/CCC-193/e11-4-local-현장-시험) |
| `E11-5` | [CCC-194](https://linear.app/bss-ccc/issue/CCC-194/e11-5-시험과-임팩트-보고서) |
| `E12-1a` | [CCC-197](https://linear.app/bss-ccc/issue/CCC-197/e12-1a-unitofwork-기반) |
| `E12-1b` | [CCC-198](https://linear.app/bss-ccc/issue/CCC-198/e12-1b-동의-repository) |
| `E12-1c` | [CCC-203](https://linear.app/bss-ccc/issue/CCC-203/e12-1c-감사-repository) |
| `E12-1d` | [CCC-202](https://linear.app/bss-ccc/issue/CCC-202/e12-1d-ai-초안-repository) |
| `E12-1e` | [CCC-200](https://linear.app/bss-ccc/issue/CCC-200/e12-1e-케이스-repository) |
| `E12-2` | [CCC-199](https://linear.app/bss-ccc/issue/CCC-199/e12-2-cccx-남은-방향) |
| `E12-3` | [CCC-207](https://linear.app/bss-ccc/issue/CCC-207/e12-3-원격지원-임시-권한) |
| `E12-4` | [CCC-208](https://linear.app/bss-ccc/issue/CCC-208/e12-4-30일-자립-운영-지표) |
| `E12-5` | [CCC-213](https://linear.app/bss-ccc/issue/CCC-213/e12-5-실데이터-파일럿-계속) |

## Critical files & anchors

- `docs/adr/0041-one-core-three-deployment-modes.md`, D76~D83: E0-5a의 Q 승인 뒤 세 모드, 7개 포트, 개인정보, 원음, 이전, 릴리스 계약의 최종 정본.
- `db/gateway.ts`, `Env`, `Actor`, `env.DB.batch()`와 exported gateway functions: 행동을 보존한 채 `packages/core`로 옮길 권한, 감사, 저장 로직.
- `apps/api/src/request-handler.ts`, `handleRequest(request, env, resolveActor)`: route, validation, error mapping을 유지하는 표준 fetch 경계.
- `apps/web/app/lib/api.ts`, `ApiErrorCode`, decoders, `requestJson`: 공용 contracts와 브라우저 transport로 분리할 현행 API 계약.
- `apps/pipeline/ccc_pipeline/worker.py`, `process_job`, `process_text_job`, `run_once`, `run_forever`: STT, 화자, 마스킹, 결과 전송, 임시 파일 삭제와 queue 공정성을 Agent v2로 확장할 경계.

## Verification

### 전제

- 모든 명령은 저장소 루트에서 Node 24, pnpm 11.5.3, Python 3.12로 실행한다. Deno는 E1-6이 CI와 로컬 버전을 같은 lock에 고정한다.
- `test:contracts --db=postgres`와 `test:db-parity`는 pinned Supabase CLI 2.116.0 local stack의 disposable PostgreSQL container를 시작하고 종료한다. 운영 DB URL과 host PostgreSQL은 쓰지 않으며 Docker Engine이 없으면 PASS로 표시하지 않는다.
- client E2E는 synthetic API fixture, `apps/client` preview server, Chromium을 기동한다. 실제 key와 실데이터는 fixture에 넣지 않는다.
- Local 완료 판정은 Windows x64 새 PC 1대와 Office server 1대/client 2대에서 수행한다. macOS/Linux unit test와 mock DPAPI만으로 Local PASS를 선언하지 않는다.
- Community Cloud 완료 판정은 E9-3과 E11-1b가 통과하기 전까지 깨끗한 synthetic Supabase 기관 프로젝트에서만 수행한다. 실제 계정과 시크릿 작업은 Portwright preflight와 런타임 주입을 사용한다.
- SG 티켓은 계약 확정 증거이고 구현 PASS가 아니다. E 티켓은 대응 SG의 검증 명령과 실제 runtime 증거를 모두 만족해야 Done이다.

### 단계별 기계 검증

- E0 완료: `pnpm guard:doc-numbers && pnpm guard:secrets`. PR #210 재배정 뒤 ADR과 D76~D83 중복 0건, 회수한 ADR-0040 §9와 SG7 literal diff 0건, ADR과 PRD의 모드, STT, Azure 원음, Cloud 보관 문구 diff 0건.
- E1 완료: `pnpm --filter @ccc/api test`, `pnpm test:contracts --db=d1`, `deno test packages/core/test`, `pnpm guard:core-imports`, `pnpm guard:db`. 기존 테스트 삭제, skip, 완화 0건.
- E3/E4 완료: `pnpm test:contracts --db=sqlite`, `pnpm test:contracts --db=postgres`, `pnpm test:db-parity`, `pnpm guard:sql-dialect`, `pnpm guard:migration-parity`, `pnpm guard:rls`. 같은 fixture의 row, result, error와 failed batch rollback이 세 DB에서 같고 PostgreSQL 업무 table의 기본 거부 누락이 0건이다.
- E5 완료: pipeline unittest 뒤 E5-8a manifest로 faster-whisper와 Qwen 후보를 측정한다. CER, 반복률, RTF, DER, safety 결과는 원문 없이 출력하고 Windows DPAPI와 임시 파일 삭제 실패 복구는 실제 Windows에서 검증한다.
- E2 완료: client typecheck, test, build와 Playwright 골든 플로우를 실행한다. 1280px, 767px, 390px light/dark에서 hierarchy와 align guard가 통과하고 배포된 site의 상담 route와 network payload가 0건이다.
- E6~E10 완료: `pnpm test:runtime --mode=community-cloud`, `--mode=local-single`, `--mode=local-office`, 각 `test:golden`, `pnpm release:verify`를 실행한다. Cloud 삭제와 backup은 호스팅 합성 프로젝트, Local 설치와 DPAPI는 실제 Windows에서 검증한다.
- 최종 회귀: `pnpm typecheck && pnpm test && pnpm build && pnpm guard:db && pnpm guard:doc-numbers && pnpm guard:tokens && pnpm guard:secrets && pnpm guard:deploy-gates && pnpm guard:core-imports && pnpm guard:sql-dialect && pnpm guard:migration-parity && pnpm guard:rls`.

### 새 동작의 종단 증거

1. Community Cloud: 깨끗한 synthetic 기관에서 install, 관리자 MFA, 실무자 초대, 당사자 등록과 6영역 동의, 일정, 기록, Agent packet, AI 승인, 15초 페이지, backup/restore를 수행한다. 다른 기관 JWT, anon key, Cloudflare 상담 경로와 Edge log의 원문/PII가 0건이어야 한다.
2. Local Single: 새 Windows x64 PC에서 signed NSIS, `doctor`, AI Off 수기 골든 플로우, Local STT 후보, backup, 삭제, 다른 SID 새 PC restore, `.cccx`, signed update rollback을 수행한다. 외부 NIC listen, browser storage의 PII와 log의 key가 0건이어야 한다.
3. Local Office: server installer와 client installer를 깨끗한 장비에 적용하고 TLS login, 역할 4종, 409, Agent, 중앙 backup과 server 교체를 수행한다. HTTP cleartext와 public port가 0건이고 기존 client가 CA 재설치 없이 금고 열람과 기록 저장까지 복구해야 한다.
4. Privacy: 스냅샷 누락, NER 부재, 금고 값 잔존, 식별자 잔존, hash mismatch, pipeline version mismatch, result 전 동의 철회를 각각 넣는다. 모두 지정 code와 OpenAI/Azure 호출 0회를 만들어야 한다. 24,001자 재료는 청크와 부분 실패, 누락 구간을 표시한다.
5. 원음: 세 AudioStore에 synthetic audio를 넣고 처리 완료, 24시간 만료, 기동 직후 claim 경합, 삭제 증거 쓰기 실패를 실행한다. 네 boolean과 adapter별 직접 읽기 부재, timestamp와 hash, 장기 signed URL 0건을 확인한다.
6. `.cccx`: 각 모드의 같은 fixture를 export하고 지원 방향으로 import한다. 잘못된 비밀번호, 변조 파일, DB commit 전후 crash를 주입해 원본 유지 또는 완전 적용만 남고 금고가 대상 설치 키로 열려야 한다.
7. 파일럿: E5-8a와 E11-2a가 고정한 정답표로 precision과 recall, 내부 실무자 3명의 작성과 준비 시간, AI 수정량을 산출한다. synthetic와 real-data 결과를 분리하고 Green Gate 미통과 모드의 real data는 0건이어야 한다.

## Assumptions & contingencies

- 2026-09-02 Q는 세 모드 정식 구현, Local STT 기본 `off`, Cloud 원음 임시 보관, 목표 모델 검수 선행, 다음 영업일 첫 Agent 처리 기회 보장과 이후 24시간 상한을 승인했다. E0-1은 이 기록을 ADR-0041과 PRD에 반영한다.
- `faster-whisper int8 CPU`와 benchmark-only Qwen3-ASR은 후보일 뿐이다. `STT-G1~STT-G3` 뒤에도 Q가 결과를 승인하기 전에는 `sttEngine`은 null이고 Local 선택지는 비활성이다.
- Notion ADR-0040은 내부 통합으로 회수 가능하다. E0-3은 정확한 원문과 6개 literal을 repo에 보존하고 이후 실행이 Notion 접근에 의존하지 않게 한다.
- Community Cloud 원음은 Supabase private Storage에만 둔다. 다음 영업일의 첫 Agent 처리 기회까지 보관하고 처리 뒤 즉시 삭제한다. 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 삭제하고 관리자 장애 상태와 수기 기록 경로를 남긴다. 7일/30일 보관은 이번 Cloud 기본형에 없다.
- `better-sqlite3-multiple-ciphers` 또는 `@primno/dpapi`의 Windows prebuilt, license, tamper audit가 실패하면 Local 릴리스를 `미통과`로 남긴다. 평문 SQLite, 파일 키 hardcode, 검증 없는 대체 package로 폴백하지 않는다.
- 코드서명, Azure 자격, pyannote 승인, OpenAI DPA, 법무 검토가 늦어지면 해당 artifact와 기능을 `미통과`로 표시한다. unsigned artifact는 개발판이고 실데이터는 E9-3, E11-1b와 Q 승인이 모두 닫힌 모드에만 허용한다.
- 9월 18일은 제출일이다. 미완 티켓은 같은 ID와 완료 조건으로 계속 실행한다. E12는 후속 기능만 소유하고 미완 작업을 숨기는 승계 티켓은 만들지 않는다.
