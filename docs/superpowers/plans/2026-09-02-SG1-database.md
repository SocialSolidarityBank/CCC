# SG1 Database 포트와 SQL 부분집합 문서 계획

> **For agentic workers:** 이 티켓은 문서 한 번의 변경으로 완료한다. 부모 세션이 모든 병렬 브랜치를 합친 뒤 저장소 전체 검증을 수행한다.

**Goal:** ADR-0041 D79에 맞춰 S1 Database 포트, 공통 SQL 부분집합, 세 DB 계약 fixture와 parity 규칙을 `확정` 상태의 정본 문서로 닫는다.

**Architecture:** S1은 `db/gateway.ts`의 현재 사용 패턴과 `db/schema.sql`, 누적 SQLite migration을 관찰 가능한 공통 계약으로 압축한다. D1 회귀, 암호화 SQLite, PostgreSQL은 동일한 fixture를 실행하지만 저장 어댑터, migration baseline, 동시성 경계는 모드별로 분리한다. 실제 포트·어댑터·migration 구현과 실행 증거는 E 티켓이 소유한다.

**Tech Stack:** Markdown, TypeScript interface 계약, SQLite/PostgreSQL SQL dialect 규칙, D1 계약 harness.

**Spec:** `docs/specs/S1-database-sql-subset.md`, ADR-0041 D76·D78·D79, `CCC_OPEN_PILOT_PLAN.md` SG1 및 E1-2/E3-1a/b/E3-2/E3-3/E3-4 계약.

## Global Constraints

- S1의 상태는 `확정`이며 인터페이스, 규칙표, 세 모드 차이, fixture 입력과 기대 결과, parity 규칙, 검증 명령이 문서에 닫혀 있으면 구현 artifact 없이도 확정할 수 있다.
- `Database` 포트는 `prepare`, `bind`, `first`, `all`, `run`, 원자적 `batch`만 제공하며 `batch()`가 유일한 transaction이다.
- SQL 자동 번역기는 만들지 않는다. PostgreSQL 어댑터가 허용받는 변환은 SQL literal과 comment를 보존하면서 실제 bare `?`만 순서대로 `$1..$n`으로 바꾸는 lexical scanner뿐이며 `?N`은 실행 전에 거부한다.
- 현재 시각은 앱이 UTC ISO 문자열로 bind하고, 충돌은 `ON CONFLICT`와 이름 붙은 이식용 helper 의도로 표현한다. `ai_text_work_queue` partial unique predicate는 conflict target에 그대로 명시한다.
- `DatabaseError`는 `kind`, `constraintSubtype`(`unique|primary_key|foreign_key|check|trigger`), 선택적 `applicationCode`를 제공하고, vendor text는 내부에서만 매핑한다. SQLite `CONSTRAINT_TRIGGER`와 PostgreSQL `P0001`은 앱 정의 trigger code만 보존한다.
- mutation과 audit는 같은 `batch` 안에서 unique operation marker와 post-state `EXISTS` guard로 묶는다. versioned update는 `id + newVersion + actor + operationTimestamp`, invite consumption은 supplied `consumptionId`를 사용하며, marker가 없으면 E3-2가 paired migration에 추가한다. `changes()`와 두 번째 batch는 금지한다.
- 공통 runtime에서는 `instr`, `char`, `julianday`, per-row `datetime` modifier, `strftime(column)`, scalar `min/max`, `GROUP_CONCAT`을 사용하지 않는다. `SUM(expr)`과 `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`는 portable grammar로 admit하고 adapter가 safe JS number와 행별 순번으로 normalize한다. schema baseline은 `instr/char`를 `position/chr`로 대응하고, deadline은 materialize하거나 ISO 후보를 앱에서 계산하며 NULL semantics를 보존한다.
- `audit_log`뿐 아니라 live schema/migrations inventory의 모든 legacy `datetime('now')` 비교·정렬 timestamp column을 paired migration에서 한 번 ISO text로 정규화하고, 각 column의 data rewrite·default/trigger ISO 출력·same-day ordering proof를 요구한다.
- 타입은 `TEXT→text`, `INTEGER→bigint`(안전한 JS number), `REAL→double precision`, `BLOB→bytea`(`Uint8Array`)이며 timestamp는 ISO text, aggregate는 number다. `last_row_id`는 adapter-optional이고 parity에서 제외한다.
- Community Cloud, Local Single, Local Office는 모두 정식 모드다. Cloud는 PostgreSQL, 두 Local은 암호화 SQLite를 사용하며 평문 SQLite는 최종 제품에서 금지한다.
- 이 티켓은 `docs/specs/S1-database-sql-subset.md`와 이 계획 파일만 변경한다. `CCC_OPEN_PILOT_PLAN.md`, ADR-0041, 코드, migration, 어댑터, Linear와 GitHub 상태는 변경하지 않는다.
- 구현 artifact와 명령 실행은 관련 E 티켓과 부모 세션이 소유하며 이 브랜치에서는 formatter, linter, build, test와 project-wide validation을 실행하지 않는다.

---

### Task 1: 확정 S1 계약 문서 작성

**Files:**
- Create: `docs/specs/S1-database-sql-subset.md`

**Interfaces:**
- Consumes: `docs/specs/SPEC-TEMPLATE-and-S1-example.md`, `docs/adr/0041-one-core-three-deployment-modes.md`, `db/gateway.ts`, `db/schema.sql`, 현재 `migrations/*.sql`, `CCC_OPEN_PILOT_PLAN.md`의 SG1와 E1-2/E3-1a/b/E3-2/E3-3/E3-4 행.
- Produces: `Database`, `PreparedStatement`, `DatabaseResult`, `Bindable`의 verbatim 서명, `DatabaseError` 매핑과 Uint8Array copy ownership, `first(column)` NULL/missing-column semantics, 공통 runtime SQL 허용·금지표, lexical placeholder 규칙, current-time bind, partial-unique conflict helper 의도, mutation/audit marker, 세 모드 표, D1/SQLite/PostgreSQL 계약 profile, F01~F10 fixture 입력·기대값·실패와 rollback 판정, migration parity와 검증 명령.

- [x] ADR-0041 D79의 네 TypeScript 타입 서명을 코드 블록으로 그대로 고정하고 `batch()`만 원자 transaction이라는 규칙을 적었다.
- [x] `DatabaseError`의 kind, 다섯 constraint subtype, 선택적 applicationCode와 vendor error 내부 매핑 규칙을 적었다.
- [x] mutation과 audit의 같은 batch 실행, unique operation marker, versioned update의 네 guard 키, invite `consumptionId`의 exact `EXISTS`, `changes()`와 두 번째 batch 금지를 적었다.
- [x] 현재 gateway의 SQL 사용 범위를 공통 SELECT/INSERT/UPDATE/DELETE, JOIN/subquery, 조건·집계·정렬, RETURNING, `ON CONFLICT`로 정하고 `instr`를 제외한 방언별 금지 규칙을 표로 닫았다. partial unique queue predicate의 명시 target도 포함했다.
- [x] 문자열·식별자·line/block comment 안의 `?`를 보존하고 bare placeholder만 번호화하며 `?N`, unclosed quote/comment는 실행 전에 거부하고 bind arity 오류를 구조화하는 lexical scanner 계약을 적었다.
- [x] `nowIso()` bind, 0/1 boolean, JSON TEXT 경계, `insertIfAbsent`와 `upsertByKey` 의도, `BEGIN` 직접 실행 금지, SQL type mapping과 Uint8Array copy ownership, `first(column)`의 NULL/missing-column semantics, `last_row_id` parity 제외를 적었다.
- [x] mutation/audit same-batch marker와 post-state guard, versioned update 네 값, invite `consumptionId`, DatabaseError 다섯 subtype와 applicationCode 보존을 적었다.
- [x] 기존 22개 세지 않던 SQLite 형식인 `julianday`, per-row `datetime` modifier, leap-day divergence와 canonical replacement, `strftime(column)`, scalar `min/max`, `GLOB`/`NOT GLOB`, `GROUP_CONCAT`, `instr`/`char`를 별도 표에 넣고 baseline 대응과 NULL semantics를 구분했다. portable `SUM`과 `ROW_NUMBER`의 grammar와 adapter normalization도 적었다.
- [x] `audit_log`와 inventory의 모든 legacy `datetime('now')` column에 대한 paired one-time ISO 정규화, space/T same-day ordering, byte-exact rewrite, default/trigger 출력 proof를 적었다.
- [x] Cloud, Single, Office의 저장 어댑터, 접속·동시성, migration 경로를 비교하고 세 모드의 공통 화면·gateway·fixture 계약을 고정했다.
- [x] D1, 암호화 SQLite, PostgreSQL 세 contract profile과 F01~F10의 기본 타입·nonzero-offset Uint8Array 복사, first() no-row/null/non-null/missing-column, scanner의 실제 quoted identifier·doubled quote·backtick rejection·comment/escape/?N/unclosed/bind-arity 오류, nullable ordering, portable SUM/ROW_NUMBER, 시각, partial conflict transition, returning, NULL-safe `IS`, 다섯 제약 subtype과 exact applicationCode 보존, 추가 SQLite 형식, failed batch rollback 기대값을 정의했다.
- [x] 동일 logical schema와 고정 입력·시각, 결과 정규화, 오류 분류, 전체 rollback, SQLite logical ID와 PostgreSQL baseline/parity 매핑, `IS`/`IS NOT` 대응, 모든 legacy datetime inventory와 column별 rewrite/default/trigger/order proof, live catalog에서 생성하는 구조·partial predicate·trigger·view·constraint·semantic annotation hash 규칙을 정의했다. E3-2가 모든 공통 migration의 paired PostgreSQL migration을 먼저 만들고 E3-4가 baseline과 manifest를 검증하며, guard는 proof가 없는 inventory column 이름을 보고한다.
- [x] `pnpm test:contracts --db=d1|sqlite|postgres`, `pnpm test:db-parity`, `pnpm guard:sql-dialect`, `pnpm guard:migration-parity`의 실행 주체와 실패 판정을 기록했다.
- [x] `확정`에 구현 결과가 필요하지 않음을 명시하고 SQL 자동 번역기, UnitOfWork, typed repository, 실제 설치·복원과 두 번째 S1 파일을 범위 밖으로 적었다.

### Task 2: 계획 기록과 커밋

**Files:**
- Create: `docs/superpowers/plans/2026-09-02-SG1-database.md`

- [x] 이 계획과 S1 문서만 포함해 commit하고 부모 세션에 commit hash와 변경 경로를 보고한다.
- [ ] 부모 세션이 병렬 브랜치 통합 뒤 검증한다. 이 브랜치에서는 validation 명령을 실행하지 않는다.
