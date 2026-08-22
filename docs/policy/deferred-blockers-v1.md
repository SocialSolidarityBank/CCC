# 미루는 차단 항목 후속 명세 v2

작성일 2026-08-16, 갱신일 2026-08-22. 이 문서는 ADR-0035에서 미룬 차단 항목 둘의 근거와 착수 지점을 남겼고, 그중 기관 관리자 접근 범위는 D74와 ADR-0038로 해소했다. 보존·파기 절차는 여전히 **실제 상담 데이터를 받기 전에 반드시 해소해야 한다.**

## 1. 보존·파기 절차 누락

### 1.1 현재 동작

레포에는 서로 독립된 **파기 경로 둘**이 실재한다. 둘 다 D32(ADR-0010)·D46 이 요구하는 절차 없이 값을 지운다.

**경로 A. 매일 cron 자동 파기 (사람 개입 없음)**

1. `support_cases` 의 마지막 활성 케이스가 종결되면 `support_cases_schedule_pii_purge_due` 트리거(`migrations/0006_participant_support_case_cutover.sql:1773-1792`)가 기관 설정(`organization_settings.pii_purge_grace_days`)만큼 뒤로 `participant_pii_vault.purge_due` 를 채운다. 같은 당사자가 새 케이스로 재등록되면 `support_cases_cancel_pii_purge_due` 트리거(`migrations/0006_participant_support_case_cutover.sql:1794` 이하)가 `purge_due` 를 `NULL` 로 되돌린다(취소 경로).
2. 매일 03:00 UTC cron 이 `PURGE_CRON` 표현식으로 발동하면 `scheduled()` 핸들러가 `ctx.waitUntil(runPurge(env))` 를 호출한다(`apps/api/src/index.ts:83-84`). `runPurge` 는 `purgeExpiredParticipantPii(env)` 를 그대로 반환하는 얇은 진입점이다(`apps/api/src/index.ts:60-61`).
3. `purgeExpiredParticipantPii`(`db/gateway.ts:9984-10017`)가 `purge_due` 도래분·미파기분·활성 케이스 없는 당사자를 최대 100건 조회한 뒤, 건마다 `purgeParticipantPiiForActor`(`db/gateway.ts:9921-9955`)를 불러 `participant_pii_vault` 의 `enc_*` 컬럼을 그 자리에서 바로 `UPDATE ... SET enc_name = NULL, ...` 로 지운다. 검토 큐도, 사람 확인도 없다.
4. 이 경로가 실제로 지운다는 것은 테스트가 증명한다: `apps/api/test/watchdog-purge.test.ts:271-292`, 특히 282행 `await expect(runPurge(t.env)).resolves.toEqual({ attempted: 1, purged: 1, noops: 0 })` 가 파기 1건을 단언한다.

**경로 B. 기관 관리자 수동 파기 (HTTP 엔드포인트, 사람이 누르지만 절차는 없음)**

- `apps/api/src/request-handler.ts:2444` 가 `purgeExpiredPiiAsAdmin` 을 호출하는 엔드포인트를 연다.
- `purgeExpiredPiiAsAdmin` → `purgeDuePii` → `selectDuePii` 로 이어지며, 이 구간이 `db/gateway.ts:4769-4821` 이다. `selectDuePii`(4773행)가 도래분을 조회하고, `purgeDuePii`(4806행)가 건마다 같은 모양의 `UPDATE ... SET enc_name = NULL, ...`(4814-4825행)을 직접 실행한다. 경로 A 와 마찬가지로 검토 큐나 확인 단계가 없다. 다른 점은 버튼을 누르는 사람이 있다는 것뿐이다.
- 참고로 `db/gateway.ts:4850-4852` 의 `purgeExpiredPii` 함수는 주석에 "scheduled(cron) 핸들러 전용 내부 진입점"이라고 적혀 있으나, `apps/api/src/index.ts` 는 이 함수를 임포트하지 않는다(실제 cron 은 위 경로 A, `purgeExpiredParticipantPii` 를 부른다). 이 주석은 코드 실제 배선과 어긋난 낡은 설명이며, 이번 문서는 이 어긋남을 **기록만 하고 고치지 않는다.**

### 1.2 D32·D46 6단계 대조표

D32(ADR-0010)와 D46 이 요구하는 절차는 여섯 단계를 거쳐 파기에 이른다. 위 경로 A·B 모두 같은 결과다: 1단계만 있고 2~6단계는 없다.

| # | 단계 | D32·D46 이 요구하는 것 | 코드에 있는가 |
| --- | --- | --- | --- |
| 1 | 보관 시계 | 케이스 종결 시 `purge_due` 를 설정해 유예기간을 잰다 | **있음**. `migrations/0006:1773-1792` 트리거가 설정한다 |
| 2 | 아카이브 전환 | 유예기간 경과 시 **파기가 아니라** 자동 아카이브로 전환하고 열람 권한을 좁힌다(D32 가 "실행 방식"으로 D10 을 대체한 지점) | **없음**. `purge_due` 도래는 곧바로 파기로 이어진다. 아카이브 상태 자체가 스키마에 없다 |
| 3 | 접근 제한 | 아카이브 상태의 열람 권한을 축소한다 | **없음**. 2단계가 없으므로 제한할 상태도 없다 |
| 4 | 검토 큐 | 파기 전 검토 큐에 올린다 | **없음**. 경로 A·B 모두 조회한 즉시 지운다. 큐 테이블이 없다 |
| 5 | 법적·업무상 보존 확인 | 연장동의, 진행 중 업무, 법적 보존 사유를 확인한다(D46, `internal-operations-policy.md` 3.5) | **없음**. `selectDuePii`·`purgeExpiredParticipantPii` 의 조회 조건은 `purge_due <= now` 와 활성 케이스 부재뿐이다 |
| 6 | 기관 관리자 확인 | 파기 검토 큐 → 기관 관리자가 확인한 뒤 파기한다(D46) | **없음(경로 A)** / **부분(경로 B)**. 경로 A 는 cron 단독 실행이라 사람이 전혀 없다. 경로 B 는 기관 관리자가 버튼을 누르지만, 이는 "확인 후 승인"이 아니라 확인 없이 곧바로 실행이다 |
| → | 파기 | 위 절차를 거친 뒤에만 값을 지운다 | **있음(절차 없이)**. `db/gateway.ts:9921-9955`(경로 A), `db/gateway.ts:4814-4825`(경로 B)가 직접 `UPDATE ... SET enc_* = NULL` 을 실행한다 |

요약: 지금 코드는 "1단계 → 파기"만 있고 2~6단계가 통째로 비어 있다. `AGENTS.md`/`CLAUDE.md` 148행의 정정(별도 todo)이 등급을 `red` 로 올리는 근거가 바로 이 표다.

### 1.3 재개 조건과 착수 지점

- **재개 조건**: 실데이터 투입 전. 지금은 전 데이터가 더미이므로 자동 파기가 실행돼도 실손실이 없다. 파일럿 4주 범위 안에서는 차단하지 않는다.
- **착수 시 손댈 곳**:
  - `migrations/` 새 파일: 아카이브 상태 컬럼(또는 상태 테이블)과 파기 검토 큐 테이블 신설
  - `db/gateway.ts` 의 `purgeExpiredParticipantPii`(9984행), `purgeParticipantPiiForActor`(9921행), 그리고 경로 B 의 `purgeDuePii`/`selectDuePii`(4769-4821행): 즉시 파기를 아카이브 전환으로 바꾸고, 검토 큐 등재·법적 보존 확인·기관 관리자 확인을 끼워 넣는다. 두 경로를 하나로 합칠지도 이때 정한다
  - `apps/api/src/index.ts` 의 cron 배선(60-61, 83-84행): 필요하면 파기 cron 을 아카이브 전환 cron 으로 교체하고, 파기 자체는 검토·확인 뒤 별도 진입점으로 분리한다
  - `apps/api/test/watchdog-purge.test.ts`: 지금은 즉시 파기를 전제로 단언한다(274-290행). 절차가 늘어나면 이 테스트의 기대값도 다시 쓴다

## 2. 기관 관리자 접근 범위

### 2.1 해소된 차이

`green` **기관 관리자의 평상시 초과 열람은 D74와 ADR-0038 구현으로 해소했다(2026-08-22).**

`assertSupportCaseAccess`와 레거시 상담 내용 관문은 더 이상 `admin` 역할만으로 통과시키지 않는다. 상담 내용 읽기는 활성 담당 배정 또는 기관 관리자가 수동 부여한 팀 감독 관계에서만 열리고, 상담 내용 쓰기는 활성 담당 배정에서만 열린다. 기관 관리자의 PII와 운영 기능은 별도 관문으로 분리해 유지했다.

복수 역할 원장과 팀, 팀 소속, 감독 권한 스키마는 `migrations/0040_roles_team_scope.sql`에 있다. 기존 `admin`은 기관 관리자와 기관 기술 관리자로, 기존 `counselor`는 실무자로 백필한다.

### 2.2 검증 증거

- `apps/api/test/support-case-access-deny-audit.test.ts`: 담당이 아닌 기관 관리자 거부, 활성 팀 감독 열람, 감독 종료 뒤 거부, 감독자의 쓰기 거부
- `apps/api/test/role-access-schema.test.ts`: 복수 역할 백필, 기관 경계 위반 거부, 마지막 필수 관리자 보호
- `apps/api/test/audio.test.ts`, `discrepancies.test.ts`, `routes.test.ts`, `gateway-domain.test.ts`: 담당이 아닌 기관 관리자의 녹음, AI 검토, 불일치 처리, 브리핑 열람 거부

### 2.3 남은 긴급 접근

긴급 접근 엔드포인트는 아직 없다. 따라서 기관 관리자는 담당 배정이 없는 상담 내용을 긴급 상황에도 열 수 없으며, 불완전하게 열어 두는 대신 닫힌 상태로 실패한다.

긴급 접근이 필요해지는 운영 단계에서 `apps/api/src/request-handler.ts`에 사유, 시간 제한, 케이스 범위, 전건 감사, 담당 실무자 통지를 모두 갖춘 별도 경로를 추가한다. 이 경로는 평상시 접근 관문에 `admin` 우회를 되살리는 방식으로 구현하지 않는다.

## 3. 미루지 않은 것

이 문서가 전체 그림을 담도록, 같은 배치에서 실제로 처리한 항목을 적는다.

- `records/` 를 `.gitignore` 에 추가해 공개 레포로의 상담 녹음 유입을 차단했다.
- 감정 분석 계산을 `worker.py` 의 `EMOTION_DEFERRED` 상수로 멈췄다(D64). 스키마, 데이터, `emotion.py` 모듈, 테스트는 전부 그대로 두고 계산만 정지했다.
- 기관 관리자 평상시 초과 열람을 차단하고 복수 역할, 팀 감독 권한 골격을 추가했다(D74, ADR-0038). 긴급 접근은 별도 fail-closed 후속으로 남겼다.
