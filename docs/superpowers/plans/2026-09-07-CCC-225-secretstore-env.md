# CCC-225 SecretStore env Implementation Plan

> **For agentic workers:** Use executing-plans inline. This worktree has one implementation owner; independent review runs in a Herdr pane. No commit or push without Q's next instruction.

**Goal:** E4-4a의 읽기 전용 SecretStore를 환경변수 어댑터와 현재 호출 경로에 연결한다.

**Architecture:** contracts/runtime에 정본 포트를 두고 adapters/secrets-env가 주입받은 환경 객체를 읽는다. CoreSecretStore는 같은 포트의 이름 범위만 좁힌 타입이며 별도 저장소가 아니다. Workers 조립부는 원시 키 필드를 제거한 런타임 환경을 전달한다. 현재 PII, OpenAI, 알림, capability 소비자는 비동기 get만 쓴다.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Node test runner, 기존 Miniflare D1 harness.

**Spec:** CCC_OPEN_PILOT_PLAN.md E4-4a 및 113~129행, docs/specs/S9-secrets-recovery-kit.md §2.1, §2.5.

## Global Constraints

- CoreSecretName = 'CODEX_API_KEY' | 'PII_ENC_KEY' | 'NOTIFY_WEBHOOK_URL'.
- PlatformSecretName = 'DB_MASTER_KEY' | 'FILE_ENC_KEY' | 'OFFICE_CA_KEY' | 'SUPABASE_SERVICE_ROLE_KEY' | 'SCHEDULER_SECRET'.
- SecretName = CoreSecretName | PlatformSecretName; SecretStore.get(name: SecretName): Promise<string | null>.
- Python 이름은 TypeScript 포트에서 제외한다. Core는 플랫폼 이름, PlatformSecretName, 전체 SecretName/SecretStore를 참조하지 않는다.
- env backend는 합성 개발과 provider injection 경계만 담당한다. 실제 Local 설치의 DPAPI, recovery, 키 생성/회전은 구현하지 않는다.
- 기존 테스트를 삭제하거나 건너뛰거나 약화하지 않는다. 합성값만 사용하고 외부 AI/STT 호출, 실데이터, 실제 시크릿 접근을 하지 않는다.
- root checkout, UI, E5-4, Windows, STT benchmark, tracker 상태, merge/deploy를 변경하지 않는다.

## 1. 포트와 env 어댑터

Files: packages/contracts/src/runtime.ts; adapters/secrets-env/package.json; adapters/secrets-env/src/index.ts; apps/api/test/secrets-env.contract.test.ts; workspace dependencies and lockfile.

- [x] 합성 환경 객체로 get 성공, 누락/빈 값 null, 알려지지 않은 이름 거부, getter 오류의 값 비노출을 검증한다. 첫 실행은 구현 모듈 부재로 실패했다.
- [x] 위 정본 타입과 `CoreSecretStore { get(name: CoreSecretName): Promise<string | null> }`를 추가한다.
- [x] `createEnvironmentSecretStore(environment: Partial<Record<SecretName, string | undefined>>): SecretStore`를 구현한다. 이름 allowlist를 검사하고 own property만 읽는다. undefined/공백뿐인 문자열은 null, 값이 있으면 원문을 그대로 반환한다. 잘못된 이름/타입은 secret_invalid, getter 오류는 secret_access_denied 고정 오류로 바꾼다. 환경 객체는 closure 안에만 두며 JSON 출력에 노출하지 않는다. 암묵적 process.env 접근은 없다.
- [x] `pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/secrets-env.contract.test.ts --maxWorkers=1` 통과를 확인한다.

## 2. 호출 경로 전환과 오류 처리

Files: packages/core/src/gateway.ts, notify.ts; packages/ai-runtime/src/ai-provider.ts; packages/http-api/src/capabilities.ts, request-handler.ts; apps/api/src/index.ts; apps/api/eval/run-flag-eval.ts; apps/api/test/support/d1.ts와 현재 원시 키 fixture가 있는 테스트; scripts/seed/harness.ts.

- [x] Env, NotifyEnv, AiProviderRuntimeEnv의 원시 키 필드를 `secretStore: CoreSecretStore`로 교체한다. 공개 심볼 변경 전 LSP references를 요청했다. 최초 조회 후 서버가 불가하여 호출 위치 검색과 tsc로 보완했다.
- [x] PII get null은 secret_missing, 잘못된 base64/길이는 secret_invalid로 실패하며 값과 provider 원문 오류를 노출하지 않는다. 유효 키의 기존 AES-GCM 동작은 유지한다.
- [x] resolveAiProviderAdapter를 async로 바꾸고 HTTP 6개 호출과 flag eval, 기존 resolver 테스트를 모두 await로 전환한다. 기존 외부 호출 off와 adapter 검증을 유지한다.
- [x] notifyAdmins는 get도 기존 try 경계 안에서 실행해 알림 장애가 cron을 중단하지 않도록 한다. capability에는 키 존재 여부만 반환한다.
- [x] Workers fetch/scheduled 조립부에서 env adapter를 만들고 원시 Core/Platform 필드를 제거한다. 기존 주입 포트를 이용하는 in-process 테스트는 포트를 유지한다. DB/audio 조립 패턴은 유지한다.
- [x] 합성 키로 PII 저장/열람과 키 누락/오류를 실제 gateway/HTTP 경로로 확인한다. 누락 OpenAI 키는 외부 요청 0건, webhook 값과 getter 예외는 로그/응답 비노출이어야 한다.

## 3. 경계 가드

Files: scripts/guard-core-imports.mjs; scripts/guard-core-imports.test.mjs; apps/api/test/secrets-env.contract.test.ts.

- [x] 기존 가드에 플랫폼 이름뿐 아니라 PlatformSecretName, 전체 SecretName/SecretStore, Python 이름을 사용하는 코어 fixture를 추가하고 실패를 확인한다.
- [x] 가드를 확장한다. 기존 import 방향/순환 검사와 기존 테스트는 그대로 유지한다. CoreSecretStore와 CoreSecretName은 허용한다.
- [x] 좁은 타입에서 플랫폼 이름 조회가 TypeScript 오류임을 @ts-expect-error로 고정한다. 실행용 키 값은 포함하지 않는다.
- [x] `node --test scripts/guard-core-imports.test.mjs`와 `pnpm guard:core-imports`를 실행한다.

## 4. 검증과 독립 검토

- [x] `pnpm --filter @ccc/api run typecheck`.
- [x] `pnpm test:scripts`, `pnpm guard:db`, `pnpm guard:secrets`. 스테이징이 비어 있어 마지막 검사는 0 bytes였다. 별도로 변경 파일과 신규 파일을 `gitleaks dir --config .gitleaks.toml --redact --no-banner`로 검사했다.
- [x] `pnpm exec vitest run --config apps/api/vitest.config.ts --maxWorkers=1`: 64개 파일, 765개 테스트 통과. 리뷰 수정 뒤에는 SecretStore, health, preview-gate, watchdog-purge의 5개 파일 47개 테스트와 API 타입검사, core/DB 가드를 다시 통과했다.
- [x] 합성 PII Worker 검증과 Herdr pane의 유한 Node smoke를 실행했다. loopback HTTP 알림 수신, 미설정 폴백, 값 없는 로그를 확인했고 임시 스크립트를 제거했다.
- [x] Herdr의 읽기 전용 reviewer 하나가 검토했다. 본 세션의 heavy 검증을 멈춘 상태로 진행했다. Workers 조립부가 getter를 먼저 읽는 P2 한 건을 보고했다.
- [x] 미사용 getter, 필수 PII getter, 상속 키의 세 회귀 테스트가 수정 전에 실패하는 것을 확인했다. 값 평가 없이 secret descriptor를 제외하고 원본 bindings를 어댑터에 전달하도록 수정했다. 주입 포트 우선 사용도 검증했다. reviewer가 재검토하여 P2 해결과 추가 결함 없음을 확인했다. 운영 문서를 반영했고 커밋/푸시는 하지 않았다.
- [x] 기존 `scripts/test-suite.mjs`에 `--secrets-env`를 등록했다. 등록 전 전체 스위트 선택 테스트 실패를 확인했고 등록 뒤 `pnpm test:scripts` 29개가 통과했다. SecretStore와 capability 계약 스위트도 실행했다.

부가검사: 수정한 eval CLI와 seed harness는 임시 tsconfig로 타입검사를 통과했다. seed 디렉터리 전체를 추가로 검사하면 수정하지 않은 `scripts/seed/scenario.ts:237,267,288`의 선택 속성과 `scripts/seed/vitest.config.ts:18`의 `minWorkers`에서 오류 4건이 난다. E4-4a 밖이므로 변경하지 않았다. `eval:flags -- --preview`는 네트워크 없이 실행됐고, 빈 플래그 fixture의 문서화된 예상 결과인 16건 누락으로 exit 1을 반환했다. 모델 품질 통과로 보고하지 않는다.
