# 티켓 프롬프트 양식 (한 세션 = 한 티켓 = worktree 하나)

파일 이름: `docs/superpowers/plans/{날짜}-{티켓ID}-{짧은-이름}.md`. 레포의 기존 plan 형식을 따른다. 에이전트(Claude Code, Codex)에게는 이 파일 하나와 아래 "고정 블록"만 준다. 노션 전체를 주지 않는다.

## 고정 블록 (모든 티켓 프롬프트 맨 위에 그대로 복사)

```markdown
> **For agentic workers:** 이 파일의 Task를 위에서부터 순서대로 수행한다. 각 Task 끝의 검증 명령이 통과하기 전에 다음 Task로 가지 않는다. 모르는 것은 추측하지 말고 "열린 질문"에 적고 멈춘다.

**정본:** `docs/adr/0041-one-core-three-deployment-modes.md` (충돌하는 다른 문서는 무시), `CLAUDE.md`
**읽을 스펙:** `docs/specs/S{번호}-*.md`
**읽지 말 것:** 노션 9/01 통합본, D65, D67, 8/31 계획의 Hyperdrive와 Workers 중계 부분

**불변조건 (어기면 실패):**
- `packages/core`는 `@cloudflare`, `@supabase`, `electron`, `node:` 를 import하지 않는다. Web Crypto와 fetch만.
- 업무 SQL은 gateway만 실행한다(R1). SQL 자동 번역기를 만들지 않는다.
- 마스킹을 거치지 않은 글과 원음은 외부 사업자로 나가지 않는다. 검사 실패 시 보내지 않고 멈춘다.
- 실패 시 다른 사업자로 자동 전환하지 않는다(D8).
- 기존 테스트를 삭제, skip, 완화하지 않는다. 새 코드에는 새 테스트를 붙인다.
- 시크릿 값은 코드, 문서, 로그, fixture에 넣지 않는다. 이름만 적는다.
- PII와 원음은 로그와 오류 메시지에 넣지 않는다.
- 행동 변경 없는 이동(리팩터)과 행동 변경(기능)을 한 커밋에 섞지 않는다.
- 범위를 줄이지 않는다. 시간이 모자라면 남은 Task를 "미완" 표시로 남기고 멈춘다.
```

## 티켓 본문 양식

```markdown
# {티켓ID}: {제목}

**Goal:** 한 문장. 개정 2 핸드오프 2.3절의 완료 조건을 그대로 옮긴다.
**근거:** ADR-0041 D{번호} {조항 요약 한 줄}
**의존:** {선행 티켓}. 끝나지 않았으면 시작하지 않는다.
**목표일:** {날짜}

## File Map
### 새 파일
- `경로`: 무엇
### 수정 파일
- `경로`: 무엇을 어떻게

## Tasks
### Task 1: {이름}
- [ ] Step 1
- [ ] Step 2
**검증:** `명령`. 기대 결과.

### Task 2: ...

## 완료 조건 (검사 가능한 문장)
- [ ] ...

## 열린 질문
없으면 "없음". 있으면 적고 멈춘다.

## 결과 보고 양식 (세션 끝에 에이전트가 채움)
- 바뀐 파일:
- 실행한 검증과 결과:
- 미완 Task와 이유:
- 다음 티켓에 넘길 것:
```

---

# 예시: E1-2 Database 포트 + D1 어댑터

> **For agentic workers:** (고정 블록 생략 없이 복사)

# E1-2: Database 포트 + D1 어댑터

**Goal:** `db/gateway.ts`가 D1 타입을 직접 import하지 않고 `Database` 포트만 쓰게 한다. D1 어댑터로 기존 테스트 전부가 통과한다. 행동 변경 0.
**근거:** ADR-0041 D79 (좁은 포트, batch가 트랜잭션, 번역기 없음)
**의존:** 없음. E1-1(store:false)과 독립.
**목표일:** 2026-09-04

## File Map
### 새 파일
- `packages/contracts/database.ts`: `Database`, `PreparedStatement`, `DatabaseResult`, `Bindable` (S1 2장 그대로)
- `adapters/db-d1/index.ts`: `D1Database`를 `Database`로 감싸는 어댑터. `batch`는 `env.DB.batch` 그대로
- `apps/api/test/contract/database.contract.test.ts`: fixture 10종을 포트로 실행하는 계약 테스트(이번에는 D1만)

### 수정 파일
- `db/gateway.ts`: `env.DB` 타입을 `Database`로. `D1Database`, `D1PreparedStatement`, `D1Result` import 제거. SQL 문자열은 이번 티켓에서 건드리지 않는다(E3-2가 한다)
- `apps/api/src/index.ts`, `apps/api/src/request-handler.ts`: `Env`가 `Database`를 받도록 조립 지점 1곳 변경
- `apps/api/test/helpers/*`: 테스트용 D1을 어댑터로 감싸는 부분 1곳

## Tasks
### Task 1: 포트 정의
- [ ] `packages/contracts/database.ts` 작성 (S1 2장 그대로, 추가 메서드 금지)
- [ ] `pnpm -w typecheck` 통과
**검증:** `pnpm -w typecheck`

### Task 2: D1 어댑터
- [ ] `adapters/db-d1/index.ts` 작성. 메서드 5개만
- [ ] 어댑터 단위 테스트 5개(prepare, bind, first, all, batch 원자성)
**검증:** `pnpm --filter db-d1 test`

### Task 3: gateway 타입 교체
- [ ] `db/gateway.ts`에서 D1 타입 import 제거, `Env.DB: Database`
- [ ] SQL 문자열 변경 0줄 확인 (`git diff --stat db/gateway.ts`가 타입 줄만)
**검증:** `grep -c "D1Database\|D1PreparedStatement\|D1Result" db/gateway.ts` 결과 0

### Task 4: 회귀
- [ ] `apps/api` 테스트 전부 실행
- [ ] 삭제, skip, 완화 0건 확인 (`git diff apps/api/test`에 `.skip`, `xit`, `toBeTruthy` 완화 없음)
**검증:** `pnpm --filter api test`. 기존 케이스 수 이상 통과

## 완료 조건
- [ ] gateway의 D1 타입 import 0곳
- [ ] 기존 테스트 전부 통과, 삭제/skip/완화 0건
- [ ] 계약 테스트 파일이 생겼고 D1에서 10종 통과
- [ ] `packages/contracts`가 플랫폼 SDK를 import하지 않음 (`node scripts/lint-core-imports.mjs` 0건)

## 열린 질문
없음.

## 결과 보고 양식
- 바뀐 파일:
- 실행한 검증과 결과:
- 미완 Task와 이유:
- 다음 티켓에 넘길 것: E1-3(AudioStore), E3-1(SQLite 어댑터)이 이 포트를 쓴다
