# 스펙 양식 (S1~S15 공통)

파일 이름: `docs/specs/S{번호}-{짧은-영문-이름}.md`. 한 스펙은 2쪽을 넘기지 않는다. 완료 조건이 없으면 스펙이 아니다.

```markdown
# S{번호}: {이름}

- 상태: 초안 | 검토 | 확정
- 근거: ADR-0041 D{번호}, (있으면) 다른 ADR
- 입력: 읽어야 할 파일과 문서 (경로)
- 산출: 이 스펙이 끝나면 생기는 것 (파일, 인터페이스, 규칙표)
- 관련 티켓: E{번호}

## 1. 목적 (3문장 이내)
왜 필요한지, 무엇을 정하는지.

## 2. 인터페이스와 규칙
타입 정의, 함수 서명, 규칙표. 코드가 있으면 코드로.

## 3. 세 모드에서 어떻게 다른가
Cloud / Single / Office 차이표. 차이가 없으면 "없음"이라고 쓴다.

## 4. 완료 조건 (검사 가능한 문장만)
- [ ] ...

## 5. 검증 방법
실행 명령, 테스트 파일, 골든 플로우 단계.

## 6. 이번에 안 하는 것
범위 밖과 그 이유. 후속 티켓 번호.
```

---

# 예시: S1 Database 포트와 SQL 부분집합

- 상태: 초안 (2026-09-02)
- 근거: ADR-0041 D79, 8/31 계획 `docs/superpowers/plans/2026-08-31-supabase-platform-cutover.md` Task 2, 3
- 입력: `db/gateway.ts`, `db/schema.sql`, `migrations/0001~0044`, `apps/api/test/*`
- 산출: `packages/contracts/database.ts`(포트), `adapters/db-d1`, `adapters/db-sqlite`, `adapters/db-postgres`, `docs/specs/S1-sql-subset.md`(허용 SQL 표), `scripts/lint-sql-dialect.mjs`
- 관련 티켓: E1-2, E3-1, E3-2, E3-3, E3-4

## 1. 목적

gateway 17,357줄을 행동 변경 없이 D1, 암호화 SQLite, PostgreSQL 위에서 돌리기 위한 가장 좁은 경계를 정한다. SQL 자동 번역기는 만들지 않는다.

## 2. 인터페이스와 규칙

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
export interface DatabaseResult<T> { results: T[]; success: boolean; meta: { changes?: number; last_row_id?: number } }
export type Bindable = string | number | null | Uint8Array; // boolean은 0/1 숫자로 앱이 변환
```

규칙표:

| 항목 | 허용 | 금지 | 대신 |
|---|---|---|---|
| 자리표시자 | `?` | `$1`, `:name` | PostgreSQL 어댑터가 `?`를 순서대로 `$n`으로 바꾼다. 어댑터가 하는 유일한 변환 |
| 현재 시각 | 앱이 ISO 문자열 바인딩 | `datetime('now')`, `strftime(` | `nowIso()` 도우미. gateway 15곳 수정 |
| 충돌 처리 | `INSERT ... ON CONFLICT(...) DO NOTHING/UPDATE` | `INSERT OR IGNORE`, `INSERT OR REPLACE` | 이식용 도우미 `upsertSql(table, keys, cols)`. gateway 5곳 수정 |
| RETURNING | 허용(두 방언 공통) | | 현행 2곳 유지 |
| 불리언 | 0/1 정수 | `TRUE/FALSE` 리터럴 | 앱이 변환 |
| JSON | 문자열 저장, 앱에서 파싱 | `json_extract`, `->>` | 현행 0곳, 그대로 |
| 트랜잭션 | `batch()` | `BEGIN` 직접 실행 | SQLite 어댑터는 better-sqlite3 transaction, PostgreSQL은 BEGIN/COMMIT으로 batch 구현 |

## 3. 세 모드에서 어떻게 다른가

| | Cloud | Single | Office |
|---|---|---|---|
| 어댑터 | db-postgres(postgres.js) | db-sqlite(better-sqlite3-multiple-ciphers) | db-sqlite, WAL |
| 마이그레이션 | `migrations/postgres/0001_baseline.sql` + 이후 논리 ID | `migrations/sqlite/0001~0044` 현행 | 같음 |
| 동시성 | PostgreSQL 기본 | 단일 사용자 | 서비스가 쓰기 직렬화 |

## 4. 완료 조건

- [ ] `db/gateway.ts`에 D1 타입 import가 0곳이다.
- [ ] D1 어댑터로 기존 테스트 전부가 통과한다(삭제, skip, 완화 0건).
- [ ] SQLite 전용 표현 22곳이 규칙표대로 바뀌었고 린트가 0건을 보고한다.
- [ ] 같은 fixture 10종을 D1, SQLite, PostgreSQL에 넣은 결과가 동일하다(계약 테스트).
- [ ] `parity.yaml`에 논리 ID마다 두 파일이 적혀 있다.

## 5. 검증 방법

`pnpm test`(apps/api), `pnpm test:contract --db=d1|sqlite|postgres`, `node scripts/lint-sql-dialect.mjs db/gateway.ts`.

## 6. 이번에 안 하는 것

typed repository와 UnitOfWork(E12-1). 과거 44개 마이그레이션의 PostgreSQL 번역(하지 않기로 결정, D79).
