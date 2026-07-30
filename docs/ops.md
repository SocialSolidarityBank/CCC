# 운영 스케줄·환경 변수

이 문서는 1단계-b(스캐폴드) 범위에서 Workers `scheduled` 핸들러가 도는 두 주기 작업 — 폴링 워치독(D8)과 PII 자동 파기(D10) — 의 동작과 관련 환경 변수를 정리한다. 실제 스케줄은 Cloudflare 계정 개설·배포 후 활성화된다(D16). 로컬(miniflare)에서는 cron이 자동 실행되지 않으므로, 테스트는 `runWatchdog(env)`·`runPurge(env)`를 직접 호출한다.

## 스케줄 (wrangler.toml `[triggers].crons`)

`src/index.ts`의 `scheduled` 핸들러가 `controller.cron`으로 분기한다.

| cron | 작업 | 내용 |
| --- | --- | --- |
| `*/30 * * * *` | 폴링 워치독 (D8) | 전 조직 폴링 건강도 계산 → `stale`인 조직마다 관리자 알림 |
| `0 3 * * *` (매일 03:00 UTC) | PII 자동 파기 (D10) | `purge_due` 경과 케이스의 PII 값 파기 |

파기를 매 틱이 아니라 하루 1회로 둔 이유: 파기는 되돌릴 수 없는 쓰기이고 케이스별 감사 행을 남기므로, 조회는 인덱스(`idx_cases_purge`)로 가볍지만 실행 빈도는 낮게 유지한다. 워치독은 읽기 중심이라 30분 간격으로 자주 돈다.

## 폴링 워치독 (D8)

- 데이터 원천: `audit_log`의 최신 `poll_pipeline` 시각(Mac Mini가 `GET /pipeline/jobs`를 부를 때마다 남는다).
- 판정: 마지막 폴링이 임계값(`PIPELINE_STALE_HOURS`, 기본 6시간)을 넘으면 `stale`. 대기 작업이 있는데 폴링 이력 자체가 없어도 `stale`. 폴링 이력·대기 작업이 모두 없으면 `inactive`(알림 안 함).
- 조회 경로: `GET /pipeline/health`(관리자 전용). 계약은 `docs/api-contract-pipeline.md` 참고.
- 알림: `console.error("[WATCHDOG ALERT] …")`는 항상 남고(`wrangler tail`로 확인), `NOTIFY_WEBHOOK_URL` 시크릿이 설정되면 그 주소로 `{"text": ...}` JSON을 POST한다(Slack/Discord incoming webhook 호환). 발송 실패는 로그만 남기고 삼킨다 — 채널 장애가 cron을 죽이지 않는다. 채널 추가는 `apps/api/src/notify.ts`의 `notifyAdmins` 한 곳에만 붙인다.
- 감사: 조직별 점검마다 `watchdog_check`(`actor_id=system:watchdog`, `actor_role=service`).

시간 비교 주의: `audit_log.created_at`은 SQLite `datetime('now')` 형식(`'YYYY-MM-DD HH:MM:SS'`, UTC, 타임존 접미사 없음)이다. JS `Date`는 공백 구분 문자열을 로컬 시간으로 해석하므로, gateway는 `'T'`+`'Z'`를 붙여 UTC로 강제 파싱한 뒤 `Date.now()`와 비교한다.

## PII 자동 파기 (D10)

- 대상: 종결됐고(`closed_at`), `purge_due`가 현재 시각 이하이며, 아직 파기되지 않은(`pii_vault.purged_at IS NULL`) 케이스.
- 처리: `pii_vault`의 `enc_name`·`enc_phone`·`enc_account`를 `NULL`로 비우고 `purged_at`을 기록한다. **행을 삭제하지 않는다** — 스키마 규약(D10)대로 `pii_vault` 행과 가명 기록(`cases` 이하)은 통계용으로 보존한다.
- 멱등성: `purged_at IS NULL` 조건이 이미 파기된 케이스를 자동으로 제외한다. 같은 케이스를 두 번 돌려도 두 번째는 아무것도 하지 않는다.
- 감사: 케이스별 `purge_pii`. cron 실행이면 `actor_id=system:purge`, 관리자 수동 실행이면 요청 관리자.
- 수동 경로(관리자 전용):
  - `GET /pii-purge/due` — 파기 예정(경과) 케이스 미리보기(파기하지 않음).
  - `POST /pii-purge` — 자기 조직 경과분 즉시 파기.

> 참고: 개별 케이스 단위의 관리자 파기는 기존 `purgePii(env, actor, caseId)`(관리자, 단건)로도 가능하다. 위 자동/일괄 경로는 그 배치·조직 단위 형제 함수다 — 둘 다 값만 비우고 행은 보존하는 동일 규약을 따른다.

## 환경 변수

| 이름 | 위치 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `PIPELINE_STALE_HOURS` | `wrangler.toml [vars]` 또는 Workers 환경 변수(문자열) | 6 | D8 무폴링 판정 임계값(시간). 부적합 값이면 기본값으로 되돌린다. |
| `NOTIFY_WEBHOOK_URL` | Workers 시크릿 | (없음) | D8 관리자 알림 웹훅. 미설정 시 console.error 폴백만. URL은 시크릿 취급(로그 출력 금지). |
| `LOCAL_ACTOR_HEADER_MODE` | `wrangler.toml [vars]` | (로컬 `"true"`) | 로컬 개발용 헤더 인증 모드. 프로덕션 미설정 시 fail closed(D16). |
| `PII_ENC_KEY` | Workers 시크릿 | (없음) | PII AES-GCM 키(D3). 코드·로그 출력 금지(R3). |

PII 파기 유예기간은 `organization_settings.pii_purge_grace_days`에 조직별로 저장한다. 값이 없거나 유효하지 않으면 종결·파기 예약을 fail closed하며, 코드에서 기본 기간을 추정하지 않는다. 내부 규정 확정 후 각 조직 설정을 명시적으로 등록한다(8장 미결).

## 마이그레이션 파일 번호

`migrations/0009_participant_pii_email.sql`과 `migrations/0009_schedule_session_plan.sql`은 번호가 중복되지만, wrangler는 마이그레이션 파일명 전체를 identity로 쓰고 두 파일 모두 이미 적용 완료라 rename하지 않는다.

## 로컬 프리뷰 (dev 이중 잠금)

브라우저에서 로컬 실행을 눌러 보는 경로. 신원은 API의 `local-actor.ts` 리졸버가 공급한다
— `LOCAL_ACTOR_HEADER_MODE='true'` **이고** Access env(ACCESS_TEAM_DOMAIN·ACCESS_AUD)가
전부 비어 있을 때만 활성(운영은 두 잠금이 모두 걸려 열리지 않는다). 웹 쪽은
`CCC_LOCAL_PREVIEW='true'` + dev 실행일 때만 Access 쿠키 없이 API를 호출한다.

**실행 위치가 단계마다 다르다.** 아래 주석의 `#` 뒤 경로를 그대로 지킬 것 — 특히 시드 생성은
**레포 루트**에서만 돌아간다(2026-07-26 확인, 아래 함정 참조).

```bash
# 1-a) 마이그레이션 (apps/api 에서)
pnpm exec wrangler d1 migrations apply ccc-local --local

# 1-b) .dev.vars 먼저 만든다 (apps/api, gitignore) — 시드 생성이 같은 키를 읽는다
#      PII_ENC_KEY=<base64 32B 테스트 키> / PII_KEY_VERSION=2 / LOCAL_DEV_ACTOR_EMAIL=account@bss.or.kr
#      키는 값이 stdout 에 닿지 않게 파일로 바로 만든다:
#      { printf 'PII_ENC_KEY='; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"; } >> .dev.vars

# 1-c) 시드 생성 (★ 레포 루트에서 — apps/api 에서 돌리면 실패한다)
set -a; . ./apps/api/.dev.vars; set +a
pnpm exec vitest run --config scripts/seed/vitest.config.ts

# 1-d) 프리로드 + 시드 적재 (apps/api 에서)
pnpm exec wrangler d1 execute ccc-local --local --file ../../scripts/seed/out/local-preload.sql
pnpm exec wrangler d1 execute ccc-local --local --file ../../scripts/seed/out/seed.sql

# 2) API: apps/api 에서  pnpm exec wrangler dev            (http://127.0.0.1:8787)
# 3) 웹:  apps/web 에서  CCC_API_ORIGIN=http://127.0.0.1:8787 CCC_LOCAL_PREVIEW=true pnpm dev   (http://localhost:3000)
```

`LOCAL_DEV_ACTOR_EMAIL`을 상담사 계정(예: ai00@ggbss.or.kr)으로 바꾸면 상담사 시점으로 볼 수 있다.
시드 재생성은 `scripts/seed/out/seed.sql`을 덮어쓰므로, 운영 적용본 아카이브는 `out/prod-<날짜>/`에 백업해 둔다.

#### 절차 함정 3건 (2026-07-26 실측)

**① 시드 생성은 레포 루트에서 돌려야 한다.** `scripts/seed/vitest.config.ts` 의 `include` 가
`scripts/seed/generate.ts` 로 **루트 상대 경로**라, `apps/api` 에서 `--config ../../...` 로 돌리면
vitest 가 루트를 `apps/api` 로 잡아 `No test files found, exiting with code 1` 로 끝난다.
빈 `out/` 만 남으므로 다음 단계가 파일 없음으로 실패한다.

**② `local-preload.sql` 은 시드 생성이 만들어 주지 않는다.** 없으면 `scripts/seed/preload-data.ts`
의 `preloadStatements()` 등가 SQL 로 직접 만들어 넣는다 — `organization_settings` 1행 +
`users` 8행 + `beneficiaries` 스텁 2행(`A001`·`swallow-001`, `initialization_state='pending'`),
타임스탬프는 전부 `PRELOAD_AT`(`2026-01-01 00:00:00`) 고정이다. 건너뛰면 다음 단계 `seed.sql` 이
`participant_schema_violation` 트리거로 실패한다. 작성 예시는
`artifacts/ccc-12-local-autosave/README.md` 에 있다.

**③ 세션이 2개 이상이면 포트를 갈라야 한다.** 다른 세션이 이미 8787·3000 을 쓰고 있으면 wrangler·
next 가 조용히 다음 포트(8788·3001)로 올라간다. 그때 웹의 `CCC_API_ORIGIN` 이 **남의 API** 를
가리키게 되므로, 로그의 실제 포트를 확인하고 `--port` 와 `CCC_API_ORIGIN` 을 맞춰 다시 띄운다.

### 미리보기 수동 배포 (Actions 가 멈췄을 때)

`Deploy Preview` 워크플로가 못 도는 상황(결제 한도·장애)에서 **로컬에서 같은 명령으로 배포**할 수 있다. 2026-07-26 실제로 이 경로로 배포했다.

```bash
# 사전: git 작업본이 origin/main 과 같은 내용인지 확인한다(배포는 작업본을 올린다)
git fetch origin && git diff --stat HEAD origin/main   # 출력이 비어야 한다

# 검증 게이트를 로컬에서 직접 통과시킨다 — CI 가 없으므로 이게 유일한 근거다
pnpm build && pnpm test

pnpm --filter @ccc/api exec wrangler deploy --env preview
pnpm --filter @ccc/web exec opennextjs-cloudflare build
pnpm --filter @ccc/web exec opennextjs-cloudflare deploy --env preview
```

- **Infisical 주입이 필요 없다.** 이 맥의 `wrangler`가 이미 OAuth 로그인돼 있어(`account@bss.or.kr`, write 권한) 워크플로가 쓰는 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 없이 그대로 배포된다. 확인은 `pnpm --filter @ccc/api exec wrangler whoami`.
- **마이그레이션은 자동으로 안 간다**(워크플로도 마찬가지다). 스키마 변경이 있으면 배포 뒤 `pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc-preview --env preview --remote`를 따로 돌린다.
- **배포 후 확인**: 브라우저로 https://ccc-preview.account-855.workers.dev/preview 를 열어 눈으로 본다. 서브 CSS에 토큰이 실렸는지는 `curl`로도 볼 수 있지만 그것만으로는 레이아웃 깨짐을 못 잡는다.
- CI 검증 단계를 건너뛰는 경로이므로 **로컬 게이트 출력이 유일한 근거**다. 통과 못 한 상태로 배포하지 않는다.

## 미리보기 환경 (CCC-6)

팀원이 링크 + 지정 코드만으로 개발 중 서비스를 보는 **미리보기 전용 환경**. Cloudflare Access를 거치지 않는다. 운영과 완전 분리한다.

### 구조

- 전용 워커: `ccc-api-preview`(API) + `ccc-preview`(웹). 각 `wrangler.toml`/`wrangler.jsonc`의 `[env.preview]`로 정의한다.
- 전용 D1 `ccc-preview`: **가상 시드 데이터만** 담는다. 운영 D1(`ccc`)과 바인딩·데이터가 분리된다.
- 웹 미리보기 워커는 서비스 바인딩(`CCC_API`)과 self 참조를 모두 미리보기 워커로 재지정한다 — 안 하면 미리보기 웹이 운영 API를 친다.
- R2(음성 버킷)는 미리보기에서 제외한다(가상 시드에 오디오 없음). 크론 트리거도 비활성(`[env.preview.triggers]` 없음).

### 코드 게이트 동작 (Access보다 약한 잠금)

- API가 `PREVIEW_MODE='true'` **이고** Access env(`ACCESS_TEAM_DOMAIN`·`ACCESS_AUD`)가 전부 비어 있을 때만 코드 게이트가 열린다(이중 잠금, `preview-gate.ts`). 운영은 Access가 설정돼 있어 `PREVIEW_MODE`가 새어 들어가도 절대 열리지 않는다(fail-closed).
- `POST /preview/unlock`에 코드를 제출하면 지정 코드(`PREVIEW_ACCESS_CODE`)와 **상수시간 비교** 후 서명 토큰(HMAC-SHA256, 만료 7일)을 발급한다. 토큰은 HttpOnly·Secure·SameSite=Strict 쿠키(`ccc_preview`) + 응답 본문 양쪽으로 나간다. 잘못된 코드는 401이며 어떤 데이터도 반환하지 않는다.
- 웹은 진입 화면(`/preview`)에서 코드를 받아 서버 액션(`unlockPreviewAction`)이 API로 검증하고, 받은 토큰을 웹 도메인의 HttpOnly 쿠키로 심는다(웹·API 도메인이 달라 쿠키를 웹 쪽에서 다시 심어야 한다). 이후 요청은 `middleware.ts`가 쿠키 없으면 진입 화면으로 유도하고, `api.ts`가 그 쿠키를 API로 포워딩한다. 웹은 `CCC_PREVIEW='true'` 런타임 변수로만 이 경로가 켜진다.
- 검증 통과 시 고정 데모 상담사(`PREVIEW_ACTOR_EMAIL`, 시드 users 디렉터리에 존재해야 함) 신원으로 동작한다 — 권한 모델(R1 게이트웨이)은 미리보기에서도 그대로다.

#### 관리자 시점 (2026-07-30 Q 요청)

**코드가 둘이고, 어느 코드로 들어왔는지가 곧 신원이다.**

| 코드 | 신원 | 누가 쓰나 |
| --- | --- | --- |
| `PREVIEW_ACCESS_CODE` | 실무자(`PREVIEW_ACTOR_EMAIL`) | 팀원 피드백 — 지금까지와 같다 |
| `PREVIEW_ADMIN_ACCESS_CODE` | 기관 관리자(`PREVIEW_ADMIN_ACTOR_EMAIL`) | 관리자 화면 확인 |

- **토큰 형식은 그대로다.** 세션 토큰은 발급에 쓰인 코드를 HMAC 키로 서명하므로, 리졸버가 코드별로 갈라 검증하면 신원이 갈린다 — 토큰에 역할을 적어 넣지 않는다(적으면 위조 표면이 는다).
- **코드와 이메일이 둘 다 있어야 관리자 경로가 열린다.** 하나만 설정된 상태에서 열어 주면 실무자 이메일로 관리자 코드가 통해 의도하지 않은 경로가 생긴다. 시크릿을 안 넣는 것이 곧 "관리자 시점 없음"이다.
- **응답은 한 가지다.** 두 코드를 항상 둘 다 비교하고(일찍 빠져나오지 않는다) 실패는 401 하나로만 답한다 — 응답 시간이나 메시지로 "관리자 코드가 있다"가 새지 않게 한다.
- 관리자 시점도 **같은 가상 시드**를 본다. 운영 PII 와 연결되지 않는 것은 그대로다.

### 보안 경계

- 미리보기 D1에는 **가상 시드만** 있고 운영 PII와 연결되지 않는다.
- 코드 게이트는 Access보다 약한 잠금이다 — 지정 코드를 아는 사람은 모두 데모 상담사 시점으로 본다. 실제 참여자 정보가 아니므로 감수한다.
- 지정 코드 값은 코드·로그·문서에 넣지 않는다. 이름만 커밋한다(`PREVIEW_ACCESS_CODE`).

### 환경 변수 / 시크릿

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `PREVIEW_MODE` | api `wrangler.toml [env.preview.vars]` | 코드 게이트 스위치(`'true'`). |
| `PREVIEW_ACTOR_EMAIL` | api `wrangler.toml [env.preview.vars]` | 미리보기 세션의 고정 데모 상담사 이메일. |
| `PREVIEW_ACCESS_CODE` | api Workers 시크릿 | 팀원용 지정 코드. 값 커밋·로그 금지(이름만). |
| `PREVIEW_ADMIN_ACCESS_CODE` | api Workers 시크릿 | **관리자 시점** 지정 코드. 없으면 그 경로 자체가 없다. 값 커밋·로그 금지. |
| `PREVIEW_ADMIN_ACTOR_EMAIL` | api `wrangler.toml [env.preview.vars]` | 관리자 코드로 들어왔을 때 쓸 기관 관리자 이메일. |
| `PII_ENC_KEY` | api Workers 시크릿 | 시드 PII 복호화용(D3). 값 커밋·로그 금지. |
| `CCC_PREVIEW` | web `wrangler.jsonc [env.preview].vars` | 웹 미리보기 경로 스위치(`'true'`). |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | 자동 배포용. 값 등록은 프로비저닝 단계. |

### 프로비저닝 체크리스트 (오케스트레이터 + Q)

1. **D1 생성**: `wrangler d1 create ccc-preview` → 출력 `database_id`를 `apps/api/wrangler.toml`의 `[[env.preview.d1_databases]]` 자리표시(`00000000-...`)에 채운다.
2. **마이그레이션**: `pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc-preview --env preview --remote`.
3. **시드 주입(수동)**: 기존 시드 산출물(`scripts/seed/out/seed.sql`, RUNBOOK 참고)을 미리보기 D1에 적용한다 — `wrangler d1 execute ccc-preview --env preview --remote --file scripts/seed/out/seed.sql`. 배포 잡에는 넣지 않는다(가상 데이터 전용, 되돌리기 어려움).
4. **시크릿 등록(값 stdout 금지)**: `wrangler secret put PREVIEW_ACCESS_CODE --env preview`, `wrangler secret put PII_ENC_KEY --env preview` (apps/api에서).
5. **웹 preview URL 확정**: 첫 배포 후 확정되는 `ccc-api-preview` URL로 `apps/web/wrangler.jsonc [env.preview].vars.CCC_API_ORIGIN` 자리표시를 교체한다.
6. **GitHub secret 등록**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
7. **첫 배포**: `pnpm --filter @ccc/api exec wrangler deploy --env preview` → `pnpm --filter @ccc/web exec opennextjs-cloudflare build && opennextjs-cloudflare deploy --env preview`.
8. **자동 배포 검증**: main에 커밋 1건 머지 → `.github/workflows/deploy-preview.yml`이 검증 후 재배포하는지 확인. 링크 + 지정 코드로 접속해 진입 화면 → 홈 흐름을 확인한다.
