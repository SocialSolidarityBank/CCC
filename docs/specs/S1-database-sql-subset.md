# S1: Database 포트와 SQL 부분집합

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76, D78, D79
- 입력: `docs/specs/SPEC-TEMPLATE-and-S1-example.md`, `CCC_OPEN_PILOT_PLAN.md`의 SG1 및 E1-2, E3-1a, E3-1b, E3-2, E3-3, E3-4 계약, `db/gateway.ts`, `db/schema.sql`, 현재 번호가 0001부터 0044까지인 `migrations/sqlite/*.sql`, `apps/api/test/*`
- 산출: 이 파일이 S1의 유일한 정본이다. Database 계약 구현, 어댑터, 마이그레이션, 계약 fixture 실행물은 관련 E 티켓이 소유한다.
- 관련 티켓: E1-2, E3-1a, E3-1b, E3-2, E3-3, E3-4

## 1. 목적

gateway가 D1 회귀 경로, 암호화 SQLite, PostgreSQL에서 같은 업무 동작을 내도록 가장 좁은 `Database` 경계를 정한다. SQL 자동 번역기는 만들지 않으며, PostgreSQL 어댑터가 허용받는 변환은 SQL의 실제 `?` 자리표시자만 순서대로 `$1`부터 바꾸는 lexical scanner로 한정한다. 이 문서의 `확정`은 계약 문서가 닫혔다는 뜻이며 어댑터나 실행 증거를 요구하지 않는다.

## 2. 인터페이스와 규칙

### 2.1 포트 서명

아래 서명은 `packages/contracts/src/database.ts`가 그대로 사용한다.

```ts
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]>; // 원자적. 트랜잭션은 이것뿐
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
export type Bindable = string | number | null | Uint8Array; // boolean은 0/1 숫자로 앱이 변환
```

`prepare`는 SQL을 실행하지 않고 문장을 만든다. `bind`는 같은 문장에 값을 붙여 새 prepared statement를 반환하며, 입력 `Uint8Array`의 내용을 즉시 복사해 원본 변경이 실행값에 영향을 주지 않게 한다. `first`는 첫 행이 없으면 `null`을 반환하고, `first(column)`은 행이 존재하지만 해당 열 값이 SQL NULL이면 `null`을 반환한다. 지정한 열이 결과에 없으면 NULL로 바꾸지 않고 구조화된 문법 오류를 낸다. `all`은 행이 없으면 빈 `results`를 반환하고, `run`은 행 결과 없이 변경 결과를 반환한다. 반환된 BLOB은 호출자가 소유하는 새 `Uint8Array` 복사본이어야 한다. `batch`만 원자 트랜잭션이며 순서대로 실행한 각 결과를 반환한다. 대화형 `UnitOfWork`, `begin`, `commit`, `rollback`은 이 포트에 없다.

데이터와 오류의 공통 매핑은 다음과 같다. SQL `TEXT`는 `text`, `INTEGER`는 `bigint`로 읽되 안전한 JavaScript `number` 범위 안에서만 decode하고, 범위를 벗어난 값은 구조화된 오류로 거부한다. `REAL`은 `double precision`, `BLOB`은 `bytea`로 저장하며 읽을 때 호출자가 소유하는 새 `Uint8Array` 복사본으로 반환한다. timestamp 열은 별도 date object로 바꾸지 않고 ISO text로 유지하며 `COUNT`, `SUM`, `MAX`, `MIN`, `ROW_NUMBER` 같은 aggregate·window 숫자는 안전한 JavaScript `number`로 반환한다.

```ts
export interface DatabaseError extends Error {
  kind: 'constraint' | 'syntax' | 'bind_arity' | 'unsupported';
  constraintSubtype?: 'unique' | 'primary_key' | 'foreign_key' | 'check' | 'trigger';
  applicationCode?: string;
}
```

제약 오류의 `constraintSubtype`는 `kind='constraint'`일 때만 채운다. adapter는 vendor error text를 내부에서 이 구조로 매핑하며 원문을 gateway와 로그에 내보내지 않는다. `applicationCode`는 source-verified 앱 trigger code인 `stale_draft_version`, `invite_token_already_used`, `participant_schema_violation`만 보존하고, 그 밖의 vendor·미등록 code는 버린다. SQLite의 `CONSTRAINT_TRIGGER`와 PostgreSQL의 `P0001`은 이 allowlist에 해당하는 앱 code로만 매핑한다.

### 2.2 공통 runtime SQL 부분집합

업무 gateway의 runtime SQL은 다음 형태만 사용한다.

- 하나의 `SELECT`, `INSERT`, `UPDATE`, `DELETE` 문장. `WITH`를 쓸 때도 최종 문장은 이 네 종류 중 하나여야 한다.
- `JOIN`, `LEFT JOIN`, 상관·비상관 subquery, `EXISTS`, `IN`, `IS NULL`, 비교, `AND`·`OR`·`NOT`, `CASE`, `COALESCE`, `CAST`, `NULLIF`, 문자열 결합 `||`, `length`, `trim`, `substr`, `COUNT`, `DISTINCT`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`처럼 현재 gateway가 사용하는 공통 표현. nullable 열을 정렬할 때는 `NULLS FIRST` 또는 `NULLS LAST`를 반드시 명시한다.
- `SUM(expr)`은 공통 numeric aggregate로 허용하고 안전한 JavaScript `number`로 decode한다. `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`는 `ORDER BY`가 있는 공통 window grammar로 허용하고 각 행의 순번을 안전한 JavaScript `number`로 반환한다. adapter가 결과를 행 단위로 정규화하며, 앱이 정렬되지 않은 전량을 읽어 대신 계산하지 않는다.
- 명시적 열 목록을 가진 `INSERT`, `UPDATE`, `DELETE`, 그리고 SQLite와 PostgreSQL이 함께 지원하는 `RETURNING`.
- 충돌 처리는 `ON CONFLICT(<unique-key>) DO NOTHING` 또는 `ON CONFLICT(<unique-key>) DO UPDATE SET ...`만 쓴다. partial unique index를 쓰는 큐처럼 predicate가 필요한 경우 `ON CONFLICT (org_id, session_id) WHERE status IN ('pending', 'processing') DO NOTHING`처럼 인덱스 predicate를 명시한다. `insertIfAbsent`와 `upsertByKey`는 이 의도를 이름으로 드러내는 helper이며 별도 방언 SQL을 생성하지 않는다. predicate를 생략한 불가능한 conflict target은 허용하지 않는다.
- 테이블·열 이름은 코드 상수나 검증된 목록에서 정하고, 사용자 입력으로 SQL 구조를 만들지 않는다. 사용자 값, 날짜, JSON, 바이너리는 모두 `bind`로 전달한다.

규칙표는 다음과 같다.

| 항목 | 허용 | 금지 | 적용 규칙 |
|---|---|---|---|
| 자리표시자 | bare `?` | `$1`, `:name`, `?N`(`?1` 포함), 문자열에 섞은 치환식 | PostgreSQL 어댑터가 코드와 주석·문자열을 보존하면서 실제 bare `?`만 등장 순서대로 `$1..$n`으로 변환한다. `?N`을 발견하면 실행 전에 `bind_arity`가 아닌 문법 오류로 거부한다. 현재 gateway의 `?1`, `?2` 표기는 E3-2에서 bare `?`로 정리한다. |
| lexical scanner | `'...'`, `"..."`, `--` 주석, `/* ... */` 안의 문자를 그대로 보존 | 정규식으로 SQL 전체를 치환하는 방식, backtick `` `...` `` | 작은따옴표의 `''`, 큰따옴표의 `""`, 주석 종료를 인식하고 그 밖의 bare `?`만 센다. `?` 다음에 숫자가 오면 `?N`으로 판정해 실행 전에 syntax 오류로 거부한다. backtick은 실행 전에 syntax 오류로 거부한다. 닫히지 않은 리터럴·주석도 실행 전에 syntax 오류로 거부한다. |
| 현재 시각 | 앱의 UTC ISO 문자열을 `bind` | `datetime('now')`, `strftime(..., 'now')`, `julianday('now')`를 gateway runtime에서 호출 | `nowIso()`가 만든 `YYYY-MM-DDTHH:mm:ss.sssZ`를 같은 batch의 각 문장에 전달한다. |
| 충돌 처리 | `ON CONFLICT ... DO NOTHING/UPDATE` 및 이름 붙은 `insertIfAbsent`, `upsertByKey` 의도 | `INSERT OR IGNORE`, `INSERT OR REPLACE`, `REPLACE` | helper는 공통 의도를 표현할 뿐 SQL 자동 번역기가 아니다. 대상 unique key와 갱신 열을 명시하고, 충돌을 흡수한 뒤에도 결과 row와 `changes`를 계약대로 반환한다. |
| 불리언 | `INTEGER`의 `0`·`1` | `TRUE`, `FALSE` 리터럴과 방언별 boolean column | 앱이 boolean을 저장 전에 `0` 또는 `1`로 변환하고 읽을 때 복원한다. |
| JSON | TEXT로 저장하고 앱 경계에서 parse/stringify | `json_extract`, `json_each`, `->`, `->>`를 공통 runtime에서 사용 | JSON 유효성 검사는 앱 계약과 각 schema의 명시적 제약으로 나눈다. |
| 트랜잭션·mutation/audit | 같은 `batch([...])` 안에서 mutation과 audit를 함께 실행하고 unique operation marker로 post-state를 확인 | `changes()` 의존, mutation 뒤 별도 batch에서 audit 실행, gateway SQL의 `BEGIN`, `COMMIT`, `ROLLBACK`, 대화형 UnitOfWork | versioned update는 `id + newVersion + actor + operationTimestamp`를 WHERE와 audit의 EXISTS guard에 함께 사용한다. 고유 marker가 없는 mutation은 E3-2가 paired migration에서 marker를 추가한다. |
| 결과 메타데이터 | `changes`와 adapter가 제공하는 `last_row_id` | `last_row_id`를 세 DB parity의 필수 값으로 가정 | `changes`는 변경 행 수로 비교한다. `last_row_id`는 adapter-optional이고 parity 비교에서 제외한다. |
| 실패 | bind arity, 문법, 제약 위반을 구조화해 반환 | 공급자 원문 오류를 업무 경계까지 누출 | 계약 테스트는 `constraint`, `syntax`, `bind_arity` 같은 오류 분류와 성공 여부를 비교하고 vendor message는 비교하지 않는다. |
### 2.3 mutation과 audit의 원자성

변경과 그 변경을 설명하는 `audit_log` 행은 반드시 하나의 `batch([...])`에 함께 넣는다. 앱은 호출마다 충돌하지 않는 opaque `operationMarker`를 만들고, mutation에 고유 제약으로 기록한다. mutation이 만든 post-state를 같은 batch의 audit 문장이 `EXISTS`와 그 marker로 확인한 뒤에만 감사 행을 쓴다. 확인은 `changes()`에 의존하지 않는다.

- versioned update는 `id`, `newVersion`, `actor`, `operationTimestamp` 네 값을 mutation과 audit guard에 함께 둔다. audit INSERT는 이 네 값과 고유 marker로 확인되는 post-state가 없으면 0행이어야 하며, 별도 batch로 감사 행을 보충하지 않는다.
- invite consumption은 호출자가 공급한 `consumptionId`를 소비 mutation에 기록한다. 계정 생성 statement와 모든 관련 audit statement는 같은 batch 안에서 `EXISTS`로 그 정확한 `consumptionId`를 확인한다. 다른 소비 ID, NULL, 이미 소비된 token이면 계정과 audit가 함께 생기지 않는다.
- mutation에 고유 marker가 없는 기존 표는 E3-2가 SQLite와 PostgreSQL paired migration에 marker를 추가한다. marker를 추가하지 않고 mutation과 audit를 두 번째 batch로 나누는 구현은 실패다.
`audit_log.created_at`은 한 번만 수행하는 paired migration에서 레거시 UTC 형식 `YYYY-MM-DD HH:MM:SS`를 `YYYY-MM-DDTHH:mm:ss.000Z`로 정규화한다. 이후 삽입은 앱이 ISO text를 bind한다. SQLite와 PostgreSQL 양쪽 migration이 같은 변환을 수행하고, 변환 전후의 `ORDER BY created_at, id` 순서를 fixture로 확인한다.

### 2.4 SQLite 전용 표현과 parity 처리

현재 `db/gateway.ts`, `db/schema.sql`, 번호가 0001부터 0044까지인 `migrations/sqlite/*.sql`을 조사할 때 확인되는 SQLite 전용 표현은 공통 runtime 문법과 섞지 않는다. 예전 22개 목록에 의존하지 않고 아래 추가 네 형식까지 명시적으로 계수한다.

| 확인된 형식 | 현재 의미 | 공통 계약에서의 처리 |
|---|---|---|
| `julianday(value)` | 보존·파기 시각의 비교와 정렬 | runtime에서는 bound ISO 비교를 우선한다. SQLite schema·migration에 남는 검사는 PostgreSQL baseline에서 동등한 timestamp 비교로 재현하고 parity fixture를 둔다. |
| `datetime(value, modifier, ...)` | `+5 years`, `-1 day`, `+N days` 같은 보존 기한 계산 | gateway는 앱에서 계산한 시각을 bind한다. SQLite migration의 modifier는 SQLite migration 전용으로 표시하고, PostgreSQL baseline은 동등한 interval 계산을 직접 작성한다. |
| `GLOB` 및 `NOT GLOB` | 가명 ID·hex·문자 집합 제약과 검색 | 공통 runtime에서는 사용하지 않는다. SQLite schema·migration의 제약은 PostgreSQL baseline의 정규식 또는 동등한 제약으로 손으로 대응한다. gateway에 남은 `GLOB` 조회는 E3-2에서 공통 조건과 앱 검증으로 바꾼다. |
| `instr(value, needle)`·`char(...)` | ID 문자열 위치와 문자 생성 | 공통 runtime에서는 사용하지 않는다. PostgreSQL baseline은 각각 `position(needle in value)`·`chr(...)`로 손으로 대응하며 NULL 입력의 결과를 보존한다. |
| `datetime(column, modifier)` | 행마다 다른 보존 기한을 계산하는 per-row modifier | deadline을 저장하거나 앱에서 ISO 후보를 계산해 bind한다. modifier 자체를 runtime으로 옮기지 않으며 NULL column은 NULL로 남긴다. |
| `strftime(format, column)` | 열의 월·일 등 날짜 부분을 읽는 검사 | 공통 runtime에서는 사용하지 않는다. 앱이 ISO text를 해석하거나 PostgreSQL baseline이 동등한 날짜 추출을 수행하고 NULL semantics를 보존한다. |
| `min(value1, value2)`·`max(value1, value2)` | aggregate가 아닌 scalar 비교 | 공통 runtime에서는 사용하지 않는다. 앱에서 후보를 계산해 bind하거나 PostgreSQL `LEAST`·`GREATEST`를 schema 전용으로 대응하며 NULL 규칙을 fixture로 고정한다. |
| `julianday(column)` | 열별 보존·파기 시각의 비교와 정렬 | 공통 runtime에서는 사용하지 않는다. bound ISO 비교 또는 materialized deadline을 사용하고, nullable column은 `IS NULL` 분기를 먼저 둔다. |
| `a IS b`·`a IS NOT b` | SQLite의 NULL-safe equality와 inequality. `NEW`·`OLD` 값과 scalar subquery에서도 사용된다. | PostgreSQL baseline은 각각 `a IS NOT DISTINCT FROM b`·`a IS DISTINCT FROM b`로 대응한다. 두 값이 모두 NULL, 같은 값, 다른 값의 결과를 모두 보존한다. |

이 형식들은 허용된 공통 SQL이라는 뜻이 아니다. SQLite schema·migration의 의미를 누락하지 않기 위한 명시 항목이며, `guard:sql-dialect`는 runtime 위반과 migration의 대응 누락을 각각 보고한다. per-row deadline, `strftime(column)`, scalar `min/max`, column `julianday`는 materialize하거나 앱에서 ISO 후보를 계산해 bind하며 NULL semantics를 유지한다. `audit_log`뿐 아니라 live SQLite schema와 migration의 모든 `datetime('now')` 기본값·trigger 기록 열을 inventory로 생성해 paired migration으로 ISO text에 정규화한다. 그 밖의 방언 전용 날짜 함수, `INSERT OR ...`, JSON 함수, pragma와 vendor extension도 같은 원칙으로 공통 runtime에서 금지한다.

## 3. 세 모드와 세 DB 계약 fixture

### 3.1 정식 배포 모드

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 저장 어댑터 | `db-postgres`와 기관 소유 Supabase PostgreSQL | 암호화 `db-sqlite` | 암호화 `db-sqlite`, WAL |
| 접속 경계 | 인터넷 HTTPS, API 전용 role | `127.0.0.1` 전용 | 내부망 HTTPS, 서버가 쓰기를 직렬화 |
| 마이그레이션 | `migrations/postgres/0001_baseline.sql`부터 logical ID별 후속 migration | `migrations/sqlite/0001~0044` 및 logical ID별 후속 migration | Single과 같은 SQLite migration |
| 동시성 | PostgreSQL transaction과 row lock | 단일 사용자 | 서비스가 write queue를 직렬화하고 read는 동시 허용 |
| 차이가 없는 계약 | 화면, gateway 권한 검사, SQL 부분집합, `DatabaseResult`, fixture 기대값은 세 모드에서 같다. |  |  |

Community Cloud는 D1을 운영 저장소로 취급하지 않는다. D1은 현재 gateway 동작과 기존 API 회귀를 보존하는 계약 fixture다. Local의 평문 SQLite는 최종 제품 어댑터나 배포 모드가 아니며, 합성 계약 harness가 암호화 어댑터를 대신할 때만 예외적으로 사용할 수 있다.

### 3.2 세 DB 계약 fixture

계약 harness는 같은 logical schema와 같은 입력을 아래 세 profile에 각각 넣는다.

| profile | 대상 | 준비 상태와 필수 증거 |
|---|---|---|
| `d1` | 기존 D1 test harness | 현재 0044 누적 schema와 gateway 호출을 사용하고, 기존 API 테스트의 결과·오류를 보존한다. |
| `sqlite` | `db-sqlite` 암호화 adapter | `migrations/sqlite/0001~0044`를 적용한 임시 DB에서 실행한다. 암호화 create/reopen은 E3-1b가 증명한다. |
| `postgres` | `db-postgres` adapter | `0001_baseline.sql`과 후속 logical migration을 적용한 폐기 가능한 PostgreSQL에서 실행한다. 운영 URL이나 host DB를 사용하지 않는다. |

세 profile은 같은 paired migration으로 `audit_log.created_at`을 한 번 정규화한다. 기존 `YYYY-MM-DD HH:MM:SS` 행은 UTC ISO text의 `.000Z`로 바꾸고, 이미 ISO인 새 행은 그대로 둔다. 정규화는 한 번만 실행되며 legacy와 new 행의 시각 순서와 `id` tie-break를 보존해야 한다.

`audit_log`만 따로 고치는 것은 충분하지 않다. live catalog introspection이 `datetime('now')`를 기본값·trigger에 사용하거나 그 값을 비교·정렬하는 모든 TEXT timestamp 열을 찾아 inventory를 만든다. paired migration은 각 열의 레거시 `YYYY-MM-DD HH:MM:SS`와 새 ISO 값을 같은 UTC ISO text로 바꾸고, 같은 날의 space 구분 값과 `T` 구분 값이 섞인 입력도 실제 시각 순서와 `id` tie-break 순서로 읽히게 한다. 이 inventory와 정규화 여부는 `migrations/parity.yaml`의 live catalog hash에 포함한다.

### 3.3 공통 fixture 10종과 기대 결과
| ID와 입력 | 기대 결과 |
|---|---|
| F01 바인드 scanner와 입력 오류 | fixture schema에 실제로 존재하는 `scanner_fixture."question?column"`과 `scanner_fixture."question?""column"`에 각각 `existing`, `existing-double`을 준비한다. `SELECT 'it''s ?' AS literal, "question?""column" AS doubled_identifier, "question?column" AS identifier, ? AS value FROM scanner_fixture -- ?`와 다음 줄 `/* ? */`을 실행하면 리터럴·두 quoted identifier의 `?`는 보존되고 bare placeholder 하나만 `$1`로 변환되며 identifier는 `existing-double`, `existing`이다. `SELECT ?1`, backtick ``SELECT \`value?\` FROM scanner_fixture``, 닫히지 않은 `'...`, 닫히지 않은 `/* ...`는 실행 전에 `DatabaseError.kind='syntax'`다. `SELECT ?`에 bind 0개 또는 2개를 주면 `DatabaseError.kind='bind_arity'`다. |
| F02 기본 타입 왕복 | string `alpha`, number `7`, `null`, bytes `00ff`를 한 행에 bind하면 `first()`가 같은 네 값을 반환한다. nonzero-offset view `new Uint8Array(buffer, 1, 2)`가 `00ff`를 가리켜도 bind가 두 바이트를 복사하므로 view와 원본 buffer를 변경한 뒤 실행 결과는 `00ff`이고, 반환된 `Uint8Array`를 변경한 뒤 다시 읽어도 저장값은 `00ff`다. boolean 입력은 사전에 `1` 또는 `0`으로 바뀐다. |
| F03 빈·NULL·열 누락 결과 | 존재하지 않는 key를 `first()`로 읽으면 `null`, `all()`로 읽으면 `success=true`와 `results=[]`다. 행이 존재하고 `nullable=NULL`이면 `first('nullable')`는 `null`이며, 행이 존재하고 `nullable='value'`이면 `first('nullable')`는 `'value'`다. `first('missing_column')`은 NULL로 위장하지 않고 `DatabaseError.kind='syntax'`다. |
| F04 nullable 정렬·집계·window 조회 | `ordinal=NULL,id=n,group_key=g2`, `ordinal=2,id=b,group_key=g1`, `ordinal=1,id=a,group_key=g1`, `ordinal=1,id=c,group_key=g2` 네 행을 넣고 `ORDER BY ordinal NULLS LAST, id`로 읽으면 `a,c,b,n` 순서다. `SUM(ordinal)`은 `3`, `COUNT(*)`와 `COUNT(DISTINCT group_key)` 값은 각각 `4`, `2`이며 `ROW_NUMBER() OVER (ORDER BY ordinal NULLS LAST, id)`는 `1,2,3,4`다. NULL 정렬 위치를 생략한 결과는 실패다. |
| F05 run/meta | 새 행 1개 insert, 한 행 update, 한 행 delete를 순서대로 실행하면 각 `run()`은 `success=true`, `results=[]`, `meta.changes=1`이다. 자동 증가 키를 제공하는 adapter만 `last_row_id`를 숫자로 내며, 이 필드는 parity에서 비교하지 않는다. |
| F06 현재 시각 bind와 전체 timestamp 정규화 | live catalog inventory가 반환한 모든 legacy `datetime('now')` timestamp column을 순회하며 각 column에 space-form existing 값 `2026-01-01 09:00:00`과 같은 날의 new ISO 값 `2026-01-01T09:00:00.500Z`을 seed한다. paired migration 후 기존 값은 byte-exact `2026-01-01T09:00:00.000Z`로 다시 쓰이고, 각 column의 default/trigger 신규 경로도 space 없는 ISO text를 낸다. 모든 column에서 `ORDER BY timestamp, id`는 SQLite와 PostgreSQL 모두 `legacy-0ms, new-500ms` 순서이며, `nowIso()` bind 결과도 byte-for-byte 같은 ISO 문자열이다. 어느 inventory column이라도 data rewrite·default/trigger proof·ordering proof가 없으면 실패다. |
| F07 충돌 무시 | `ai_text_work_queue`의 partial unique index `(org_id, session_id) WHERE status IN ('pending', 'processing')`에 active row를 먼저 넣는다. 같은 key의 두 번째 active `insertIfAbsent`는 명시된 predicate를 포함한 `ON CONFLICT ... DO NOTHING`으로 오류 없이 `success=true`, `changes=0`이며 행 수는 1개다. 첫 row를 `status='done'`으로 predicate 밖으로 전이한 뒤 같은 key의 active insert를 다시 하면 `success=true`, `changes=1`, 행 수는 2개다. predicate 없는 conflict target과 `INSERT OR IGNORE`는 실패다. |
| F08 충돌 갱신 | 같은 unique key에 `upsertByKey`를 실행하면 행은 1개이고 지정한 값만 갱신된다. 결과의 다른 열과 created_at은 바뀌지 않는다. |
| F09 returning·SQLite 추가 형식 | insert/update `RETURNING`은 영향을 받은 한 행을 반환한다. `closedAt=2024-02-29T00:00:00.000Z`에 SQLite 원형 `datetime(closed_at, '+5 years', '-1 day')`은 `2029-02-28T00:00:00.000Z`, naive PostgreSQL interval은 `2029-02-27T00:00:00.000Z`가 되는 divergence를 고정한다. canonical replacement는 앱이 계산·materialize한 `retentionCap=2029-02-28T00:00:00.000Z`이며, `graceDays=1`, `nullableClosedAt=NULL`, `values=2,3`, `hex=00ff/0gff`, rows=`a,b,c`, `a IS b` probe의 `(NULL,NULL)=true`, `(1,1)=true`, `(1,2)=false`를 사용한다. probe 결과는 `purgeDue=2024-03-01T00:00:00.000Z`, NULL deadline은 NULL, month-day는 `02-29`/NULL, scalar min/max는 `2`/`3`, NULL scalar 후보는 NULL, GLOB 판정은 `true`/`false`다. `IS NOT`는 각각 `false`,`false`,`true`이며 `NEW`·`OLD`와 scalar subquery에서도 같은 결과다. `GROUP_CONCAT`을 쓰지 않고 정렬된 행을 반환해 앱이 `a,b,c`로 합친다. PostgreSQL용 `string_agg` 같은 adapter SQL 변형은 실패다. |
| F10 failed batch rollback와 오류 보존 | 먼저 mutation과 conditional audit INSERT를 같은 batch에 넣는다. marker가 일치하면 post-state `EXISTS`가 audit 1행을 만들고, marker가 다르면 audit 0행이며 두 번째 batch 보충은 실패다. 이어 다섯 isolated batch를 각각 실행한다. duplicate unique는 `constraintSubtype='unique'`, duplicate primary key는 `'primary_key'`, missing foreign key는 `'foreign_key'`, invalid CHECK는 `'check'`, 앱 trigger 실패는 `'trigger'`를 내야 한다. trigger code가 `stale_draft_version`, `invite_token_already_used`, `participant_schema_violation`이면 각각 같은 `applicationCode`를 보존하고, unknown code는 버린다. 각 실패 batch에서 `operationMarker=op-1`인 첫 insert까지 함께 rollback되어 최종 행 수는 0이고 부분 성공 결과는 반환하지 않는다. |

F09의 dialect probe는 SQLite 문법을 공통 gateway에 허용하는 시험이 아니다. 각 engine이 schema 의미를 보존했는지 확인하는 migration parity probe이며, 날짜·NULL·문자 집합·행 결합 결과가 다르면 실패다.

### 3.4 parity 규칙

1. 세 profile은 동일한 fixture 입력, logical table/key, bind 순서, 고정 시각을 사용한다. DB 기본 현재 시각, UUID, 자동 정렬에 결과를 맡기지 않는다.
2. `results`는 SQL의 명시적 `ORDER BY` 순서로 비교하고 nullable 정렬에는 `NULLS FIRST` 또는 `NULLS LAST`가 있어야 한다. 각 행의 key 순서는 무시하되 값, NULL, 숫자, 문자열, bytes의 정규화 값은 같아야 한다. bytes는 lowercase hex로 비교한다.
3. `success`와 `meta.changes`는 같아야 한다. `last_row_id`는 adapter-optional이며 parity에서 비교하지 않는다.
4. 성공·빈 결과·제약 위반·문법 오류·bind arity 오류를 `DatabaseError`의 같은 분류로 비교한다. 제약 오류는 `unique`, `primary_key`, `foreign_key`, `check`, `trigger` subtype까지 비교하고, `applicationCode`는 앱 정의 trigger code만 비교한다. 공급자별 메시지와 오류 stack은 비교하지 않으며, PII·연결 문자열·공급자 원문 오류를 fixture 출력에 넣지 않는다.
5. `batch` 중간 실패는 모든 profile에서 전체 rollback이어야 한다. 한 profile만 부분 commit하거나 결과 배열을 돌려주면 실패다. mutation과 audit가 분리된 두 번째 batch로 성공하는 구현도 실패다.
6. SQLite logical migration ID와 PostgreSQL migration ID는 `migrations/parity.yaml`에서 1:1로 적는다. PostgreSQL `0001_baseline.sql`은 SQLite 0044 누적 상태를 한 번 재현하고, 이후에는 같은 logical ID에 SQLite와 PostgreSQL migration 두 벌을 함께 추가한다. 과거 SQLite 파일을 기계적으로 번역하지 않는다.
7. `migrations/parity.yaml`은 각 logical ID의 SQLite와 PostgreSQL live catalog introspection에서 생성한다. tables, columns와 types, indexes와 partial-index predicates, triggers, views, constraints, operation markers, timestamp normalization 같은 semantic annotation을 정규화한 canonical hash를 기록하며, 열 목록만 self-authored로 hash한 manifest는 parity를 충족하지 못한다.
8. E3-2는 E3-4가 `0001_baseline.sql`을 검증하기 전에 모든 공통 migration에 대응하는 PostgreSQL paired migration을 만든다. E3-4는 그 paired migration과 baseline, manifest hash를 함께 검증한다.

## 4. 완료 조건

- [x] `Database`, `PreparedStatement`, `DatabaseResult`, `Bindable` 서명과 `batch` 원자성 계약이 §2.1에 완결되어 있다.
- [x] 허용 SQL, placeholder lexical conversion, current-time bind, conflict helper, SQLite 전용 표현의 처리 규칙이 §2.2~§2.4에 완결되어 있다.
- [x] Community Cloud, Local Single, Local Office의 adapter, migration, concurrency 차이가 §3.1에 완결되어 있다.
- [x] D1, 암호화 SQLite, PostgreSQL 세 계약 profile과 F01~F10의 입력·기대 결과·syntax·bind-arity·다섯 제약 subtype·applicationCode·Uint8Array/first semantics·failed batch rollback 판정이 §3.2~§3.3에 완결되어 있다.
- [x] PostgreSQL baseline, 모든 공통 migration의 paired migration, 구조와 semantic annotation hash, SQLite logical migration ID, parity 비교 규칙이 §3.4에 완결되어 있다.
- [x] 구현 검증 명령과 각 명령의 실패 판정이 §5에 적혀 있다.
- [x] 이 문서를 `확정`으로 올리기 위해 구현 artifact, 어댑터 실행, 배포 결과를 요구하지 않는다.

## 5. 검증 방법

구현 artifact가 준비되면 저장소 루트에서 실행한다. 이 명령의 실행 결과는 관련 E 티켓이 기록하며, 이 S1의 `확정` 판정에는 필요하지 않다.

- `pnpm test:contracts --db=d1`
- `pnpm test:contracts --db=sqlite`
- `pnpm test:contracts --db=postgres`
- `pnpm test:db-parity`
- `pnpm guard:sql-dialect`
- `pnpm guard:migration-parity`
세 `test:contracts` 명령은 F01~F10의 행, 타입, 순서, `DatabaseResult`, 오류 분류와 F10 전체 rollback을 모두 검사한다. 하나라도 기대값과 다르거나 제약 실패 뒤 행이 남으면 실패다. `test:db-parity`는 세 profile의 정규화 결과가 다르면 실패다. `guard:sql-dialect`는 공통 runtime의 `changes()`, 금지 함수, `instr`, `?N`, `INSERT OR`, adapter별 `GROUP_CONCAT` 변형이 하나라도 남거나 SQLite 전용 migration에 대응 표시가 없으면 실패다. `SUM`과 `ROW_NUMBER`는 정해진 portable grammar와 safe-number/window 결과를 벗어나면 실패다. `guard:migration-parity`는 baseline이 0044 누적 상태와 다르거나 후속 logical ID의 양쪽 migration·`parity.yaml` 항목이 빠지거나, live inventory의 어느 column이라도 data rewrite·default/trigger ISO 출력·same-day chronological ordering proof가 없거나, operation marker와 audit timestamp 정규화가 한쪽에만 있으면 실패다. 기존 테스트를 삭제·skip하거나 assertion을 완화해 통과시키면 실패다.

## 6. 이번에 안 하는 것

- SQL 자동 번역기, ORM, 방언 추론기는 만들지 않는다. placeholder lexical scanner 외의 SQL 재작성은 허용하지 않는다.
- `UnitOfWork`, 대화형 transaction, gateway 밖의 raw driver 호출은 만들지 않는다. raw driver는 `adapters/db-*`, migration runner, 계약 harness에만 둔다.
- typed repository 승격은 E12-1a 이후의 별도 단계이며 이 문서의 산출이 아니다.
- 암호화 SQLite 구현과 create/reopen 증거는 E3-1b, migration 경로 이동은 E3-1a, 공통 SQL 정리와 모든 공통 migration의 PostgreSQL paired migration 생성은 E3-2, PostgreSQL adapter는 E3-3, baseline과 parity 및 manifest hash 검증은 E3-4가 소유한다. D1 포트와 adapter 계약 이동은 E1-2가 소유한다.
- 세 모드의 실제 설치, 복원, Windows 장비 결과와 운영 DB 이전은 이 문서의 `확정` 조건이 아니다.
- 두 번째 S1 파일, `db/gateway.ts`를 대신하는 새 정본, schema 구현물을 이 티켓에서 만들지 않는다.
