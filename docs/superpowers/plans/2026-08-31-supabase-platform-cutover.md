# Supabase 플랫폼 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리형 배포의 데이터베이스, 로그인, 음성 저장을 Supabase 서울 리전으로 전환하고 로컬 D1 실행 경로는 유지한다.

**Architecture:** `db/gateway.ts`의 권한과 감사 규칙은 유지하고, 그 아래에 D1과 PostgreSQL이 함께 구현하는 좁은 데이터베이스 포트를 둔다. 관리형 Workers는 Hyperdrive를 통해 Supabase PostgreSQL에 연결하고, 인증은 Supabase JWT, 음성은 비공개 Supabase Storage 버킷을 사용한다. 한 환경은 한 백엔드만 사용하며 런타임 이중 쓰기는 하지 않는다.

**Tech Stack:** Cloudflare Workers, Hyperdrive, Supabase PostgreSQL 서울, Supabase Auth, Supabase Storage, TypeScript, Vitest, PostgreSQL RLS

## Global Constraints

- D76과 D77이 D65의 PostgreSQL 연기 결정과 Cloudflare Access 인증 결정을 대체한다.
- R1 단일 관문은 불변이다. 업무 SQL은 계속 `db/gateway.ts`만 실행한다.
- D63의 로컬 실행 문은 유지한다. 로컬 모드는 D1과 로컬 저장소를 사용한다.
- Cloudflare Workers와 Pages는 서비스 입구로 유지한다.
- 실데이터는 법률 검토와 이전 리허설이 끝나기 전까지 새 백엔드에 넣지 않는다.
- 시크릿 값은 코드, 문서, 로그, 테스트 픽스처에 넣지 않는다. 이름만 기록하고 Infisical로 주입한다.
- PII와 원본 음성은 로그와 오류 메시지에 넣지 않는다.
- 실행 백엔드는 환경별 단일 선택이다. D1과 PostgreSQL에 동시에 쓰는 코드와 임시 동기화 데몬은 만들지 않는다.
- PostgreSQL 정본은 현재 SQLite 스키마의 단일 기준선과 이후 번호가 맞는 PostgreSQL 마이그레이션이다. 과거 44개 SQLite 마이그레이션을 그대로 재연하지 않는다.
- `apps/web`의 가입 화면을 바꾸는 작업은 `DESIGN-RULES.md`와 `design-lane`을 따른다.

---

## File Map

### 새 파일

- `db/database.ts`: gateway가 소비하는 `Database`, `PreparedStatement`, `DatabaseResult` 포트.
- `apps/api/src/database-runtime.ts`: D1 또는 Hyperdrive PostgreSQL 어댑터를 환경 설정으로 선택.
- `apps/api/src/postgres-database.ts`: `prepare`, `bind`, `first`, `all`, `run`, 원자적 `batch` 구현.
- `apps/api/src/supabase-jwt.ts`: Supabase JWKS, issuer, audience, `aal` 검증.
- `apps/api/src/supabase-audio-store.ts`: 비공개 버킷 put, get, delete 구현.
- `migrations/postgres/0001_baseline.sql`: 현재 SQLite 최종 스키마와 동등한 PostgreSQL 기준선.
- `migrations/postgres/README.md`: SQLite와 PostgreSQL 마이그레이션 번호 동기화 규칙.
- `scripts/migrate/d1-to-postgres.ts`: 합성 데이터 내보내기, 변환, 적재, 검증 실행기.
- `scripts/migrate/postgres-schema-check.ts`: 표, 컬럼, 인덱스, 트리거, 정책 계약 검사.
- `apps/api/test/postgres-database.test.ts`: 데이터베이스 포트 계약 테스트.
- `apps/api/test/supabase-identity.test.ts`: JWT, 사용자 매핑, 관리자 MFA 테스트.
- `apps/api/test/supabase-audio-store.test.ts`: HTTP 계약과 만료 삭제 테스트.

### 수정 파일

- `CLAUDE.md`: D76, D77 기록과 기술 스택, 미결 항목 갱신.
- `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md`: 전환 결정과 대체 관계.
- `db/gateway.ts`: `Env.DB` 타입을 데이터베이스 포트로 전환하고 공통 SQL 부분집합 사용.
- `db/schema.sql`: 이후 마이그레이션 작성자가 보는 논리 스키마를 현행화.
- `apps/api/src/identity.ts`: Access JWT 대신 Supabase JWT와 `users.auth_user_id`를 사용.
- `apps/api/src/request-handler.ts`: 가입 링크 발급, 초대 회수, 오디오 저장소 포트 사용.
- `apps/api/src/audio-store.ts`: `R2Bucket` 직접 의존을 `AudioStore` 구현으로 캡슐화.
- `apps/api/wrangler.toml`: Hyperdrive, Supabase URL과 버킷 이름의 비시크릿 설정 이름 추가.
- `migrations/0046_supabase_auth_identity.sql`: `users.auth_user_id`, 초대 만료와 Supabase 연결 상태 추가.
- `apps/web/app/join/worker/[token]/*`: Supabase 초대 세션과 비밀번호 설정 흐름.
- `apps/web/app/join/participant/[token]/*`: Supabase 초대 세션과 기존 당사자 초대 토큰 연결.
- `apps/web/app/participants/invite/*`: 이메일 발송 없이 복사 가능한 Supabase action link 발급.
- `apps/api/test/worker-invite-signup.test.ts`: 초대 만료, 재발급, 사용 완료, 퇴사 비활성화.
- `apps/api/test/audio.test.ts`: R2와 Supabase Storage가 같은 `AudioStore` 계약을 만족하는지 검증.
- `scripts/guard-db-gateway.mjs`: 데이터베이스 포트 구현만 raw DB 사용을 허용하고 다른 직접 접근은 계속 차단.
- `docs/ops.md`: 서울 리전 설정, 리허설, cutover, rollback 절차.

## Interfaces

```ts
export interface DatabaseResult<T> {
  results: T[];
  meta: { changes: number };
}

export interface PreparedStatement {
  bind(...values: Array<string | number | null | Uint8Array>): PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<DatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  batch<T = Record<string, unknown>>(statements: PreparedStatement[]): Promise<Array<DatabaseResult<T>>>;
}

export interface AudioObject {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
}

export interface AudioStore {
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<AudioObject | null>;
  delete(key: string): Promise<void>;
}
```

`Database.batch`는 PostgreSQL에서 한 트랜잭션으로 실행한다. 중간 문장이 실패하면 전체를 rollback한다. PostgreSQL 어댑터는 `?` 자리표시자만 `$1` 형식으로 바꾸고 SQL 문법 자체를 추측해 번역하지 않는다. gateway SQL은 두 데이터베이스가 모두 받는 공통 부분집합으로 먼저 정리한다.

---

### Task 1: D76, D77 정본 기록

**Files:**
- Create: `docs/adr/0040-seoul-region-supabase-auth-stt-consent.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: 전환 범위, 대체 관계, 실행 게이트의 정본.

- [ ] **Step 1: ADR 번호와 D번호 충돌을 검사한다**

Run:

```bash
git fetch origin main
git grep -n '^# ADR-0040\|^|D7[6-9]|' origin/main -- CLAUDE.md docs/adr
```

Expected: ADR-0040과 D76부터 D79까지 아직 없음.

- [ ] **Step 2: ADR-0040을 작성한다**

결정은 다음을 명시한다.

1. PostgreSQL, Auth, Storage는 Supabase 서울 리전을 사용한다.
2. Workers와 Pages는 입구로 유지한다.
3. 로컬 모드는 D1을 유지한다.
4. 관리형 환경은 한 시점에 한 데이터베이스만 사용한다.
5. 가입은 복사 가능한 action link, 사용자 비밀번호 설정, 관리자 MFA, 만료와 재발급, 퇴사 비활성화를 포함한다.
6. RLS는 gateway 검사와 별도의 이중 방어다.

- [ ] **Step 3: CLAUDE.md 기술 스택과 D76, D77을 갱신한다**

인증, DB, 파일 저장 행을 Supabase로 바꾸되 이전 완료 전 로컬과 preview D1 경로가 유지됨을 적는다.

- [ ] **Step 4: 문서 가드를 실행한다**

Run:

```bash
pnpm guard:doc-numbers
pnpm guard:secrets
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add CLAUDE.md docs/adr/0040-seoul-region-supabase-auth-stt-consent.md
git commit -m "docs(decisions): Supabase 서울 전환 기록"
```

---

### Task 2: 데이터베이스 포트와 D1 계약 고정

**Files:**
- Create: `db/database.ts`
- Modify: `db/gateway.ts:29-63`
- Modify: `scripts/seed/capture.ts`
- Create: `apps/api/test/database-contract.test.ts`
- Modify: `scripts/guard-db-gateway.mjs`

**Interfaces:**
- Produces: 위 `Database`와 `PreparedStatement` 계약.
- Consumers: 모든 gateway 함수, D1 테스트 환경, PostgreSQL 어댑터.

- [ ] **Step 1: `Env` 참조를 LSP로 확인한다**

`db/gateway.ts`의 `Env`를 대상으로 LSP references를 실행한다. 이름은 바꾸지 않고 `DB` 필드 타입만 바꾸므로 호출부 시그니처는 유지한다.

- [ ] **Step 2: 실패하는 포트 계약 테스트를 작성한다**

테스트는 D1 Miniflare DB가 `prepare`, `bind`, `first`, `all`, `run`, `batch` 계약을 만족하고 `batch` 실패 시 부분 쓰기가 남지 않는 것을 검증한다.

Run:

```bash
pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts
```

Expected: FAIL because `db/database.ts` does not exist.

- [ ] **Step 3: `db/database.ts`를 구현한다**

위 인터페이스만 둔다. `exec`, `dump`, `withSession`, raw SQL 실행 같은 gateway가 쓰지 않는 메서드는 넣지 않는다.

- [ ] **Step 4: `gateway.Env.DB`와 시드 캡처 프록시를 포트 타입으로 바꾼다**

D1 객체는 구조적으로 포트를 만족한다. 강제 형변환은 테스트 지원 코드의 경계 한 곳에만 둔다.

- [ ] **Step 5: raw DB 가드를 보강한다**

허용 경로는 `db/gateway.ts`, `apps/api/src/postgres-database.ts`, 테스트 지원 코드, 시드 캡처 프록시뿐이다.

- [ ] **Step 6: 테스트와 가드를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/database-contract.test.ts
pnpm guard:db
pnpm --filter @ccc/api run typecheck
```

Expected: PASS.

- [ ] **Step 7: 커밋한다**

```bash
git add db/database.ts db/gateway.ts scripts/seed/capture.ts scripts/guard-db-gateway.mjs apps/api/test/database-contract.test.ts
git commit -m "refactor(db): gateway 데이터베이스 포트 고정"
```

---

### Task 3: PostgreSQL 어댑터와 공통 SQL 부분집합

**Files:**
- Create: `apps/api/src/postgres-database.ts`
- Create: `apps/api/src/database-runtime.ts`
- Create: `apps/api/test/postgres-database.test.ts`
- Modify: `db/gateway.ts`
- Modify: `apps/api/src/identity.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 2 `Database` 포트.
- Produces: `createPostgresDatabase(connectionString: string): Database`, `databaseFromEnv(env): Database`.

- [ ] **Step 1: SQL 방언 목록을 기계적으로 뽑는다**

검색 대상과 치환 규칙을 표로 기록한다.

- `datetime('now')`: 애플리케이션의 ISO 시각 바인딩으로 교체.
- `INSERT OR IGNORE`: `ON CONFLICT DO NOTHING`으로 교체.
- `INSERT OR REPLACE`: 명시적인 conflict target과 `DO UPDATE`로 교체.
- `?1` 같은 번호형 자리표시자: 일반 `?`로 교체.
- SQLite 전용 JSON, PRAGMA, 트리거 문법: runtime gateway에서 제거하거나 PostgreSQL 기준선에서 별도로 구현.

- [ ] **Step 2: PostgreSQL 포트 계약 테스트를 작성한다**

테스트는 로컬 PostgreSQL 테스트 URL이 있을 때만 통합 테스트를 실행하고, 단위 테스트는 가짜 SQL client로 다음을 고정한다.

1. 인용문 안의 `?`는 자리표시자로 바꾸지 않는다.
2. `bind` 순서를 보존한다.
3. `first`는 0행이면 null이다.
4. `all`은 `results` 배열을 돌려준다.
5. `run`의 row count가 `meta.changes`가 된다.
6. `batch`는 한 트랜잭션이며 실패 시 rollback한다.

- [ ] **Step 3: Hyperdrive 연결 기반 어댑터를 구현한다**

관리형 Workers는 Hyperdrive connection string을 받는다. `supabase-js`의 PostgREST 경로는 임의 SQL과 원자적 batch를 보존하지 못하므로 gateway DB 어댑터로 사용하지 않는다.

- [ ] **Step 4: gateway SQL을 공통 부분집합으로 바꾼다**

한 번에 전 파일을 기계 치환하지 않는다. 변경 유형별로 작은 커밋을 만들고 각 커밋마다 API 테스트를 실행한다. runtime SQL 번역기는 자리표시자 변환 외에는 만들지 않는다.

- [ ] **Step 5: 테스트를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/postgres-database.test.ts test/database-contract.test.ts
pnpm --filter @ccc/api run test
pnpm guard:db
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add apps/api/src/postgres-database.ts apps/api/src/database-runtime.ts apps/api/test/postgres-database.test.ts apps/api/package.json pnpm-lock.yaml db/gateway.ts apps/api/src/identity.ts
git commit -m "feat(db): Supabase PostgreSQL 어댑터 추가"
```

---

### Task 4: PostgreSQL 기준선과 RLS

**Files:**
- Create: `migrations/postgres/0001_baseline.sql`
- Create: `migrations/postgres/README.md`
- Create: `scripts/migrate/postgres-schema-check.ts`
- Create: `apps/api/test/postgres-schema.test.ts`
- Modify: `db/schema.sql`

**Interfaces:**
- Produces: 새 Supabase 프로젝트에 적용 가능한 현재 스키마 기준선과 RLS 정책.

- [ ] **Step 1: SQLite 최종 스키마 계약을 고정하는 실패 테스트를 작성한다**

필수 표, FK, unique 제약, append-only 트리거, `org_id` 인덱스, 동의 표, AI 증거 표가 PostgreSQL 기준선에 존재해야 한다.

- [ ] **Step 2: 단일 PostgreSQL 기준선을 작성한다**

과거 변경 이력을 44개 파일로 재연하지 않는다. 현재 최종 상태를 한 기준선으로 만들고 `migrations/postgres/README.md`에 원본 SQLite migration 번호와 PostgreSQL 대응 구획을 표로 남긴다.

- [ ] **Step 3: RLS 정책을 추가한다**

업무 표는 `org_id`를 필수 경계로 둔다. Workers 서비스 연결은 별도 DB 역할을 사용하고, 사용자 브라우저가 업무 표를 직접 조회하지 않는다. RLS는 gateway 권한 검사를 대체하지 않는다.

- [ ] **Step 4: append-only 계약을 PostgreSQL 트리거로 재현한다**

`audit_log`, 동의 이력, 목표 문구 이력처럼 기존 UPDATE와 DELETE 차단 대상은 PostgreSQL에서도 같은 동작을 한다.

- [ ] **Step 5: 스키마 테스트를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/postgres-schema.test.ts
pnpm guard:db
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add migrations/postgres db/schema.sql scripts/migrate/postgres-schema-check.ts apps/api/test/postgres-schema.test.ts
git commit -m "feat(db): PostgreSQL 기준선과 RLS 추가"
```

---

### Task 5: Supabase Auth와 초대 가입

**Files:**
- Create: `apps/api/src/supabase-jwt.ts`
- Create: `apps/api/test/supabase-identity.test.ts`
- Modify: `apps/api/src/identity.ts`
- Modify: `db/gateway.ts`
- Create: `migrations/0046_supabase_auth_identity.sql`
- Modify: `apps/api/src/request-handler.ts`
- Modify: `apps/api/test/worker-invite-signup.test.ts`
- Modify: `apps/web/app/join/worker/[token]/*`
- Modify: `apps/web/app/join/participant/[token]/*`
- Modify: `apps/web/app/participants/invite/*`

**Interfaces:**
- Produces: `verifySupabaseJwt(token, options): Promise<SupabaseClaims>`.
- Claims required: `sub`, `email`, `iss`, `aud`, `exp`, `aal`.
- DB mapping: `users.auth_user_id` unique, `users.email`은 표시와 복구 보조값.

- [ ] **Step 1: `actorFromRequest`와 가입 라우트 참조를 LSP로 확인한다**

Cloudflare Access 전용 호출부와 테스트 주입점을 모두 목록화한다.

- [ ] **Step 2: JWT 실패 테스트를 작성한다**

잘못된 issuer, audience, 만료, 서명, 누락된 `sub`, 관리자 `aal1`을 각각 401로 거부한다. 실무자와 당사자 일반 로그인은 승인된 정책에 따라 `aal1`을 허용한다.

- [ ] **Step 3: 사용자 매핑 migration을 작성한다**

`users.auth_user_id TEXT UNIQUE`, `invite_tokens.expires_at`, `invite_tokens.auth_user_id`, `invite_tokens.claimed_at`을 추가한다. 만료와 회수된 토큰은 재사용할 수 없다.

- [ ] **Step 4: action link 복사 흐름을 구현한다**

기관 관리자가 초대를 발급하면 Workers가 Supabase Admin `generateLink`를 호출하고 이메일을 보내지 않는다. 화면은 복사 가능한 링크만 표시한다. 사용자는 링크에서 비밀번호를 설정하고 기존 `invite_tokens`를 한 번만 claim한다.

- [ ] **Step 5: 관리자 MFA와 퇴사 비활성화를 구현한다**

기관 관리자 권한을 가진 사용자는 `aal2`가 아니면 관리자 작업을 할 수 없다. 퇴사 처리는 기존 배정 종료와 invite 폐기에 더해 Supabase Auth 세션 회수와 계정 ban을 실행한다. 하나라도 실패하면 감사 로그에 내용 없는 실패 코드만 남기고 비활성화 상태를 재시도 가능하게 둔다.

- [ ] **Step 6: 인증과 가입 테스트를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/supabase-identity.test.ts test/worker-invite-signup.test.ts
pnpm --filter @ccc/web exec vitest run app/join app/participants/invite
pnpm --filter @ccc/api run typecheck
pnpm --filter @ccc/web run typecheck
```

Expected: PASS.

- [ ] **Step 7: UI를 실제 390px과 768px에서 검증한다**

`design-lane`을 사용해 가입 링크, 비밀번호 설정, 만료, 재발급 상태를 브라우저에서 확인한다.

- [ ] **Step 8: 커밋한다**

```bash
git add apps/api/src/supabase-jwt.ts apps/api/src/identity.ts apps/api/src/request-handler.ts apps/api/test/supabase-identity.test.ts apps/api/test/worker-invite-signup.test.ts db/gateway.ts migrations apps/web/app/join apps/web/app/participants/invite
git commit -m "feat(auth): Supabase 초대 가입과 관리자 MFA 추가"
```

---

### Task 6: Supabase Storage와 30일 삭제

**Files:**
- Modify: `apps/api/src/audio-store.ts`
- Create: `apps/api/src/supabase-audio-store.ts`
- Create: `apps/api/test/supabase-audio-store.test.ts`
- Modify: `apps/api/src/identity.ts`
- Modify: `apps/api/src/request-handler.ts`
- Modify: `apps/api/test/audio.test.ts`
- Create: `migrations/0047_audio_object_lifecycle.sql`
- Modify: `apps/api/wrangler.toml`

**Interfaces:**
- Consumes: `AudioStore` 계약.
- Produces: R2와 Supabase Storage의 동일한 put, get, delete 동작.

- [ ] **Step 1: 저장소 계약 테스트를 작성한다**

같은 테스트 묶음이 R2 테스트 구현과 Supabase HTTP 가짜 구현에 대해 실행된다. 허용 MIME, 200MB 상한, PII 없는 key, not found, 삭제, no-store 다운로드를 고정한다.

- [ ] **Step 2: 비공개 Supabase 버킷 어댑터를 구현한다**

서비스 role key는 Workers 시크릿으로만 주입한다. 공개 URL을 만들지 않고 Workers가 승인 뒤 byte stream을 중계한다.

- [ ] **Step 3: 30일 수명 registry와 cron을 구현한다**

Supabase Storage의 미확인 수명 기능에 의존하지 않는다. `audio_objects`에 `object_key`, `org_id`, `session_id`, `created_at`, `purge_due`, `purged_at`을 기록하고 매일 cron이 도래 객체를 삭제한다. DB 행은 삭제 증거로 남긴다.

- [ ] **Step 4: 기존 R2 경로를 포트 뒤로 이동한다**

`request-handler.ts`는 더 이상 `R2Bucket` 타입을 알지 않는다. 저장소 선택은 runtime factory 한 곳에서만 한다.

- [ ] **Step 5: 테스트를 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/audio.test.ts test/supabase-audio-store.test.ts
pnpm --filter @ccc/api run typecheck
```

Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add apps/api/src/audio-store.ts apps/api/src/supabase-audio-store.ts apps/api/src/request-handler.ts apps/api/src/identity.ts apps/api/test/audio.test.ts apps/api/test/supabase-audio-store.test.ts migrations apps/api/wrangler.toml
git commit -m "feat(storage): Supabase 음성 보관과 30일 삭제 추가"
```

---

### Task 7: 합성 데이터 이전 리허설

**Files:**
- Create: `scripts/migrate/d1-to-postgres.ts`
- Create: `scripts/migrate/d1-to-postgres.test.ts`
- Modify: `docs/ops.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: D1 export, PostgreSQL baseline, Supabase Storage adapter.
- Produces: 내용 없는 검증 보고서와 reversible cutover checklist.

- [ ] **Step 1: 결정적 합성 데이터로 실패 테스트를 작성한다**

표별 row count, FK, `org_id`, 암호문 byte equality, append-only 이력, 최신 상태, 감사 로그 수가 이전 전후 같아야 한다. 평문 PII는 보고서에 나오면 실패한다.

- [ ] **Step 2: export, transform, load 세 단계를 구현한다**

각 단계는 별도 파일 산출물을 갖고 sha256을 기록한다. PostgreSQL 적재는 한 표 단위 트랜잭션이며 실패한 표 이후는 실행하지 않는다.

- [ ] **Step 3: 읽기 전용 shadow 검증을 실행한다**

같은 합성 시나리오를 D1과 PostgreSQL gateway에 각각 실행하고 JSON 응답에서 시각과 비결정 ID를 정규화한 뒤 비교한다. 운영 요청을 두 DB에 동시에 보내지 않는다.

- [ ] **Step 4: 리허설을 두 번 실행한다**

첫 실행 뒤 PostgreSQL을 초기화하고 같은 입력으로 다시 실행한다. 두 보고서의 row count와 checksum이 같아야 한다.

- [ ] **Step 5: 테스트와 스모크를 실행한다**

```bash
pnpm exec vitest run scripts/migrate/d1-to-postgres.test.ts
pnpm migrate:d1-to-postgres -- --fixture synthetic --dry-run
pnpm migrate:d1-to-postgres -- --fixture synthetic --verify
```

Expected: PASS, PII text 0건, FK mismatch 0건, row count mismatch 0건.

- [ ] **Step 6: 커밋한다**

```bash
git add scripts/migrate docs/ops.md package.json
git commit -m "feat(migrate): D1에서 PostgreSQL 이전 리허설 추가"
```

---

### Task 8: 관리형 preview cutover와 rollback 증명

**Files:**
- Modify: `apps/api/wrangler.toml`
- Modify: `docs/ops.md`
- Modify: `scripts/deploy-production.mjs`
- Modify: `scripts/deploy-gates.test.mjs`

**Interfaces:**
- Produces: 환경별 `CCC_DATABASE_BACKEND=d1|postgres`, `CCC_AUDIO_STORE=r2|supabase` 단일 선택과 배포 게이트.

- [ ] **Step 1: 배포 게이트 실패 테스트를 작성한다**

다음은 배포를 거부한다.

1. postgres인데 Hyperdrive binding이 없음.
2. Supabase issuer와 audience가 없음.
3. supabase storage인데 URL, bucket, service key 이름이 없음.
4. migration 검증 보고서가 없음.
5. rollback bookmark와 PostgreSQL snapshot 증거가 없음.

- [ ] **Step 2: preview를 PostgreSQL, Supabase Auth, Storage로 전환한다**

가상 시드만 사용한다. 가입, 인테이크, 일정, 기록, 오디오 업로드, AI 검토, 감사 조회를 실제 표면에서 smoke한다.

- [ ] **Step 3: rollback을 실제로 수행한다**

preview를 D1과 R2 설정으로 되돌리고 같은 가상 사용자 흐름이 동작하는지 확인한다. rollback은 문서가 아니라 실행 증거가 있어야 한다.

- [ ] **Step 4: 전체 검증을 실행한다**

```bash
pnpm guard:db
pnpm guard:secrets
pnpm typecheck
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/api/wrangler.toml docs/ops.md scripts/deploy-production.mjs scripts/deploy-gates.test.mjs
git commit -m "ops: Supabase preview 전환과 rollback 게이트 추가"
```

---

## Production Gate

운영 전환은 다음이 모두 충족될 때만 가능하다.

1. 변호사 검토에서 개인정보, 민감정보, STT 처리위탁, AI 국외 이전 문안이 승인됨.
2. Supabase 프로젝트와 Storage 버킷의 물리 리전이 서울로 증빙됨.
3. RLS 정책과 gateway 권한 테스트가 모두 통과함.
4. 합성 데이터 이전 리허설 2회가 동일 결과를 냄.
5. preview cutover와 rollback이 각각 1회 성공함.
6. 기관 관리자 MFA와 퇴사 세션 회수가 실제 Supabase test tenant에서 동작함.
7. 음성 30일 삭제 cron이 도래 객체를 삭제하고 감사 증거를 남김.
8. 운영 시크릿은 Infisical 주입만 사용하고 값이 로그나 커밋에 없음.
