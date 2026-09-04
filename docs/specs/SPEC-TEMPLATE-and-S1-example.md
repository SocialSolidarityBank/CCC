# 스펙 양식 (S1~S15 공통)

파일 이름: `docs/specs/S{번호}-{짧은-영문-이름}.md`. 한 스펙은 2쪽을 넘기지 않는다. 완료 조건이 없으면 스펙이 아니다. S1~S15의 정본은 대응 GitHub Issue와 각 스펙의 대응 `docs/specs/S{번호}-*.md` 파일이며, 이 템플릿은 양식과 S1 예시만 제공한다. Linear의 SG1~SG15는 계약 게이트를 미러링한다.

스펙은 ADR-0041 D76~D83의 공통 코어, 세 모드, 포트, 개인정보, 원음 생명주기, 이전·설치·릴리스 계약을 구체화한다. 스펙의 `확정`은 구현 완료를 뜻하지 않는다.

## 상태 생명주기

`초안 → 검토 → 확정 → 구현 검증 완료`

- **초안**: 작성자가 목적과 범위를 정리하는 단계다. 계약의 빈칸이 남아 있을 수 있다.
- **검토**: 인터페이스, 규칙, 세 모드 차이, fixture와 검증 방법을 검토 중이다.
- **확정**: 인터페이스·규칙표·세 모드 차이·fixture 정의·검증 명령과 기대 판정이 문서로 완결된 상태다. 실제 어댑터, 배포, 복원 결과 또는 실행된 테스트는 요구하지 않는다.
- **구현 검증 완료**: 관련 E 티켓이 확정 스펙을 구현하고, 문서에 적힌 검증 명령과 실제 런타임 증거를 남긴 상태다. 구현 결과가 없으면 이 상태로 올리지 않는다.

## ADR-0041 공통 불변 계약

모든 S1~S15 스펙은 아래 D76~D83을 깨지 않는 범위에서 세부 계약을 정한다.

| 결정 | 공통 계약 |
|---|---|
| D76 | Community Cloud, Local Single, Local Office 세 모드를 모두 정식 구현한다. |
| D77 | 저장 모드와 AI 모드는 독립이며, 설치 직후 STT는 세 모드 모두 `off`다. STT-G1~STT-G3과 Q 승인 전에는 `sttEngine`을 자동 선택하지 않는다. |
| D78 | 공통 코어와 런타임 포트는 일곱 개다: `Database`, `AudioStore`, `Identity`, `SecretStore`, `Scheduler`, `STTProvider`, `AIProvider`. |
| D79 | Database 포트는 좁게 유지하고 SQL 자동 번역기를 만들지 않는다. |
| D80 | 업무 클라이언트는 정적 클라이언트 + Bearer 토큰 API다. |
| D81 | Agent와 코어가 AI Packet을 이중 검증하며, 일곱 fail-closed code에서는 외부 AI 호출을 하지 않는다. Community Cloud 원음은 기관 소유 Supabase private Storage에만 둔다. |
| D82 | 동의·키·신원은 모드별 경계를 따르고 기존 동의를 자동 승격하지 않는다. |
| D83 | `.cccx`, 설치, 서명 manifest, 백업·복구, 업데이트·rollback 계약은 공통 Application Service로 정의한다. |

### D81 fail-closed 상태

다음 일곱 상태에서는 외부 AI 호출을 하지 않는다.

| code |
|---|
| `masking_snapshot_missing` |
| `local_ner_unavailable` |
| `registered_pii_detected` |
| `unmasked_identifier_detected` |
| `evidence_hash_mismatch` |
| `masking_pipeline_version_mismatch` |
| `consent_not_effective` |

### SG8 원음 시계

Community Cloud 원음은 기관 소유 Supabase private Storage에 임시 보관한다. 다음 영업일의 첫 Agent 처리 기회까지 보관하고 처리 뒤 즉시 삭제한다. 첫 처리 가능 시점부터 24시간 안에도 처리하지 못하면 삭제하고 관리자 장애 상태를 남긴다. 업로드 시점부터 기계적으로 24시간 뒤 삭제하는 계약이 아니다.

```markdown
# S{번호}: {이름}

- 상태: 초안 | 검토 | 확정 | 구현 검증 완료
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
- [ ] 인터페이스와 규칙표가 문서에 완결되어 있다.
- [ ] fixture 정의와 기대 결과가 문서에 완결되어 있다.
- [ ] 검증 명령과 실패 판정이 문서에 적혀 있다.

## 5. 검증 방법
실행 명령, 테스트 파일, 골든 플로우 단계. 명령 실행과 런타임 증거는 `구현 검증 완료` 판정 때 기록한다.

## 6. 이번에 안 하는 것
범위 밖과 그 이유. 후속 티켓 번호.
```

---

# 예시: S1 Database 포트와 SQL 부분집합

- 상태: 초안 (2026-09-02)
- 근거: ADR-0041 D79, 2026-08-31 계획 `docs/superpowers/plans/2026-08-31-supabase-platform-cutover.md` Task 2, 3
- 입력: `db/gateway.ts`, `db/schema.sql`, `migrations/sqlite/0001~0045`, `migrations/postgres/0001_baseline.sql`, `apps/api/test/*`
- 산출: S1 계약 문서의 대응 정본은 `docs/specs/S1-database-sql-subset.md`다. 구현 산출물은 관련 E 티켓이 소유하며 이 스펙의 산출에 포함하지 않는다.
- 관련 티켓: E1-2, E3-1a, E3-1b, E3-2, E3-3, E3-4. 구현 산출물은 이 관련 E 티켓이 소유한다.

## 1. 목적

gateway를 행동 변경 없이 D1, 암호화 SQLite, PostgreSQL 위에서 돌리기 위한 가장 좁은 경계를 정한다. SQL 자동 번역기는 만들지 않는다.

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
export interface DatabaseResult<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}
export type Bindable = string | number | null | Uint8Array; // boolean은 0/1 숫자로 앱이 변환
```

규칙표:

| 항목 | 허용 | 금지 | 대신 |
|---|---|---|---|
| 자리표시자 | `?` | `$1`, `:name` | PostgreSQL 어댑터가 parameter placeholder만 순서대로 `$1`부터 바꾼다 |
| 현재 시각 | 앱이 ISO 문자열 바인딩 | `datetime('now')`, `strftime(` | `nowIso()` 도우미 |
| 충돌 처리 | `INSERT ... ON CONFLICT(...) DO NOTHING/UPDATE` | `INSERT OR IGNORE`, `INSERT OR REPLACE` | 이식용 도우미 |
| RETURNING | 두 방언 공통 구문 | 방언 전용 반환 구문 | 현행 계약 유지 |
| 불리언 | 0/1 정수 | `TRUE/FALSE` 리터럴 | 앱이 변환 |
| JSON | 문자열 저장, 앱에서 파싱 | `json_extract`, `->>` | 공통 JSON 경계 |
| 트랜잭션 | `batch()` | `BEGIN` 직접 실행 | 각 어댑터가 원자적 batch로 구현 |

## 3. 세 모드에서 어떻게 다른가

| | Cloud | Single | Office |
|---|---|---|---|
| 어댑터 | `db-postgres`(postgres.js) | `db-sqlite`(better-sqlite3-multiple-ciphers) | `db-sqlite`, WAL |
| 마이그레이션 | `migrations/postgres/0001_baseline.sql` + 이후 논리 ID | `migrations/sqlite/0001~0045` 현행 | Single과 같음 |
| 동시성 | PostgreSQL 기본 | 단일 사용자 | 서비스가 쓰기 직렬화 |

## 4. 완료 조건

- [ ] Database interface와 허용·금지 SQL 규칙이 이 문서의 §2에 완결되어 있다.
- [ ] Cloud, Single, Office의 adapter·마이그레이션·동시성 차이가 이 문서의 §3에 완결되어 있다.
- [ ] D1, SQLite, PostgreSQL에 넣을 동일 fixture 10종의 입력, 기대 결과, 오류와 failed batch rollback 판정이 이 문서에 정의되어 있다.
- [ ] PostgreSQL baseline과 SQLite 논리 ID 대응 규칙이 이 문서에 정의되어 있다.
- [ ] 검증 명령과 각 명령의 실패 판정이 이 문서의 §5에 문서화되어 있다.

## 5. 검증 방법

구현 검증 시 저장소 루트에서 다음을 실행한다.

- `pnpm test:contracts --db=d1`
- `pnpm test:contracts --db=sqlite`
- `pnpm test:contracts --db=postgres`
- `pnpm guard:sql-dialect`
- `pnpm guard:migration-parity`

세 DB의 동일 fixture 결과, 오류와 failed batch rollback이 다르면 실패다. 기존 테스트 삭제·skip·완화한 assertion이 하나라도 있으면 실패다.

## 6. 이번에 안 하는 것

typed repository와 UnitOfWork는 E12-1a 이후로 미룬다. 과거 SQLite 마이그레이션을 PostgreSQL 방언으로 번역하지 않는다(D79). 어댑터 구현과 세 모드의 실제 설치·복원 결과는 각각 E3, E6~E8의 소유이며 이 스펙을 `확정`으로 올리는 조건이 아니다.
