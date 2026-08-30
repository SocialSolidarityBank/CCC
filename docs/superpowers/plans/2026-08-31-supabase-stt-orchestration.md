# Supabase와 STT 전환 Orchestration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 흩어진 8월 29일과 30일 계획을 하나의 실행 순서로 묶고, 디자인 작업 checkout을 건드리지 않는 격리 워크트리에서 Supabase 전환과 STT·동의 개편을 완주한다.

**Architecture:** 이 문서는 순서, 공유 파일 소유권, migration 번호, 병렬 가능 구간, 통합 게이트만 관리한다. 세부 구현은 `2026-08-31-supabase-platform-cutover.md`와 `2026-08-31-stt-consent-cutover.md`가 정본이다. 두 트랙은 독립 워크트리에서 진행하고 `db/gateway.ts`, `request-handler.ts`, migration 번호가 만나는 구간만 통합 워크트리에서 직렬화한다.

**Tech Stack:** Git worktrees, Cloudflare Workers, Supabase, Python STT pipeline, TypeScript, Vitest, unittest

## Global Constraints

- 루트 checkout `feat/consent-sidebar-polish`는 디자인 작업 전용이며 어떤 파일도 수정, stash, checkout, reset하지 않는다.
- 현재 계획 checkout은 `.worktrees/supabase-stt-cutover`, 브랜치는 `plan/supabase-stt-cutover`다.
- 기존 prep 브랜치 5개는 조사 근거로 읽기만 한다. 새 구현은 prep 브랜치에 쌓지 않는다.
- 실행 시작점은 이 계획 브랜치가 main에 반영된 이후의 `origin/main`이다.
- D76부터 D79까지 정본 기록이 첫 단계다. 코드가 결정보다 먼저 merge되지 않는다.
- 모든 시크릿은 Infisical 주입이며 값은 문서, 커밋, 로그에 나오지 않는다.
- 실데이터는 Supabase 이전 리허설과 동의 법률 게이트 전까지 금지한다.
- 외부 STT는 합성 데이터와 preview에서만 사용하며 승인 전 운영 기본값은 Whisper다.
- 긴 대시는 새 한국어 산출물에서 쓰지 않는다. 가운데 점은 한 호흡 병렬에만 쓴다.

---

## Consolidated Source Register

| 시각 | 원본 | 상태 | 이 계획에서의 처리 |
|---|---|---|---|
| 2026-08-29 06:29 | 세션 local `impl-prep-worktrees-plan.md` | 실행 완료 | 워크트리와 prep 스펙을 다시 만들지 않는다. 조사 출처와 기존 티켓 연결만 사용한다. |
| 2026-08-29 | `origin/prep/db-beta-scale`의 `2026-08-29-db-beta-scale-prep.md` | 부분 유효 | D1 규모, pagination, 인덱스, 측정 하네스는 유지. D65의 D1 유지와 PostgreSQL 연기 전제는 D76이 대체한다. |
| 2026-08-29 | `origin/prep/stt-engine`의 `2026-08-29-stt-engine-prep.md` | 부분 유효 | Engine 계약, CLOVA와 RTZR 응답 조사, G1부터 G3까지 설계는 유지. 3엔진 구도와 미확인 보관 표는 D78과 8월 30일 조사로 갱신한다. |
| 2026-08-29 | `origin/prep/mobile-signup-signature`의 가입 스펙 | 부분 유효 | 모바일 가입 UX와 token 만료는 Supabase Auth 계획에 흡수. 전자서명은 이 실행 범위에서 제외한다. |
| 2026-08-29 | `origin/prep/oss-local-package`의 로컬 패키지 스펙 | 부분 유효 | D63 로컬 모드와 D1 유지 경계만 Supabase 계획에 흡수. 패키징 구현은 제외한다. |
| 2026-08-30 18:54 | `.omo/ulw-research/20260830-185405-cloud-stt/` | 연구 완료, 미추적 | 검증된 사실을 tracked vendor matrix로 옮긴다. RTZR 처리 위치와 CLOVA 계약 보증은 미확인으로 유지한다. |
| 2026-08-30 20:48 | 세션 local `grilling-2026-08-29-plan.md` | 미실행 | D76부터 D79까지 결정 원문과 Linear 갱신 골격을 사용한다. |
| 2026-08-30 23:42 | 루트 `그릴링_결정_기록_PLAN.md` | 위 파일과 동일 | 바이트가 같으므로 별도 계획으로 세지 않는다. 사용자 파일은 삭제하지 않는다. |
| 2026-08-31 | 이 디렉터리의 실행 계획 3개 | 실행 정본 | 이후 구현자는 이 세 문서만 따라도 되게 구성한다. |

## Execution Worktrees

계획 브랜치가 main에 반영되면 먼저 결정 전용 워크트리 하나만 만든다.

| 경로 | 브랜치 | 소유 범위 |
|---|---|---|
| `.worktrees/supabase-stt-decisions` | `docs/supabase-stt-decisions` | D76부터 D79 정본과 vendor matrix |
| `.worktrees/supabase-platform` | `feat/supabase-platform-cutover` | 데이터베이스 포트, PostgreSQL, Auth, Storage, 이전 리허설 |
| `.worktrees/stt-consent` | `feat/stt-consent-cutover` | 엔진 어댑터, 동의 4영역, benchmark |

결정 워크트리 생성:

```bash
git fetch origin main
git worktree add -b docs/supabase-stt-decisions .worktrees/supabase-stt-decisions origin/main
```

결정 PR이 main에 merge된 뒤 두 실행 워크트리를 최신 `origin/main`에서 만든다. 공유 스키마와 preview 통합 워크트리는 해당 wave가 시작될 때 최신 main에서 별도로 만든다.

## Shared Contracts

### Migration 번호

현재 main 기준 다음 SQLite 번호를 다음처럼 예약한다.

- `0045_consent_four_domains.sql`: STT·동의 트랙 소유.
- `0046_supabase_auth_identity.sql`: Supabase 트랙 소유.
- `0047_audio_object_lifecycle.sql`: Supabase 트랙 소유.

다른 migration이 먼저 main에 들어오면 통합 워크트리 소유자가 세 번호를 다음 연속 번호로 함께 민다. 두 실행 워크트리는 독자적으로 번호를 다시 고르지 않는다. PostgreSQL 기준선은 별도 경로 `migrations/postgres/0001_baseline.sql`이고 SQLite 번호와 경쟁하지 않는다.

### 공유 파일 소유권

| 파일 | 먼저 쓰는 트랙 | 두 번째 변경 처리 |
|---|---|---|
| `CLAUDE.md` | 통합 | D76부터 D79를 한 커밋으로 기록. 실행 트랙은 직접 수정하지 않는다. |
| `docs/adr/0040-*` | 통합 | 네 결정을 한 파일에 기록. 실행 트랙은 인용만 한다. |
| `db/gateway.ts` | Supabase | 데이터베이스 포트 전환 merge 뒤 STT 트랙의 동의 함수 commit을 통합 브랜치에서 적용한다. |
| `apps/api/src/request-handler.ts` | Supabase | Auth와 audio route 전환 merge 뒤 consent route 변경을 적용한다. |
| `apps/api/src/identity.ts` | Supabase | STT 트랙은 수정하지 않는다. |
| `apps/pipeline/**` | STT | Supabase 트랙은 수정하지 않는다. |
| `db/consent-notice.ts` | STT | Supabase 트랙은 읽기만 한다. |
| `docs/ops.md` | 통합 | 각 트랙은 자기 구획 commit을 만들고 통합 브랜치가 최종 목차와 cutover 순서를 정리한다. |

### Runtime contracts

- `Database` 포트는 Supabase 계획 문서의 인터페이스가 정본이다.
- `Engine` 계약은 `Callable[[str], list[Segment]]`를 유지한다.
- 외부 STT 정책은 provider, purpose, consentEvidenceId, contractApprovalRef만 전달한다. 원문과 PII는 정책 메타데이터에 없다.
- consent migration이 merge된 뒤 PostgreSQL baseline을 만든다. baseline 생성 뒤 consent 스키마를 별도 patch로 덧붙이지 않는다.

---

### Task 1: 계획 브랜치 검토와 merge 준비

**Files:**
- `docs/superpowers/plans/2026-08-31-supabase-stt-orchestration.md`
- `docs/superpowers/plans/2026-08-31-supabase-platform-cutover.md`
- `docs/superpowers/plans/2026-08-31-stt-consent-cutover.md`

- [ ] **Step 1: 세 계획의 내부 참조를 검사한다**

```bash
test -f docs/superpowers/plans/2026-08-31-supabase-platform-cutover.md
test -f docs/superpowers/plans/2026-08-31-stt-consent-cutover.md
```

Expected: 두 명령 모두 exit 0이고 총괄 문서의 파일명과 실제 파일명이 같다.

- [ ] **Step 2: 금지 placeholder와 부호를 검사한다**

파일 검색 도구로 미완성 표식과 긴 대시를 각각 검색한다.

Expected: 두 검색 모두 0건.

- [ ] **Step 3: 계획 브랜치를 커밋하고 PR을 준비한다**

```bash
git add docs/superpowers/plans/2026-08-31-supabase-stt-orchestration.md docs/superpowers/plans/2026-08-31-supabase-platform-cutover.md docs/superpowers/plans/2026-08-31-stt-consent-cutover.md
git commit -m "docs(plan): Supabase와 STT 전환 계획 통합"
```

---

### Task 2: Wave 0, 결정 정본

**Worktree:** `.worktrees/supabase-stt-decisions`

- [ ] **Step 1: Supabase 계획 Task 1과 STT 계획 Task 1을 한 커밋 경계로 실행한다**

ADR-0040, CLAUDE.md D76부터 D79, vendor matrix를 함께 만든다. 기존 그릴링 플랜의 긴 대시 1건은 새 문서에 복사하지 않는다.

이 Wave에서는 총괄 계획이 우선한다. 두 실행 계획 Task 1의 마지막 개별 커밋 단계는 건너뛰고, 아래 Step 3의 통합 커밋 하나만 만든다.

- [ ] **Step 2: prep 스펙을 main으로 복사하지 않는다**

두 새 실행 계획이 필요한 계약과 단계 전체를 흡수했으므로 오래된 prep 스펙을 새 SSOT로 승격하지 않는다. origin prep 브랜치는 근거 보존용으로 둔다.

- [ ] **Step 3: 문서 검증과 커밋을 실행한다**

```bash
pnpm guard:doc-numbers
pnpm guard:secrets
git add CLAUDE.md docs/adr/0040-seoul-region-supabase-auth-stt-consent.md docs/aside/2026-08-30-cloud-stt-vendor-matrix.md
git commit -m "docs(decisions): 2026-08-29 그릴링 D76-D79 기록"
```

Expected: PASS.

- [ ] **Step 4: 결정 커밋을 main에 먼저 반영한다**

```bash
git push -u origin docs/supabase-stt-decisions
```

PR 검토와 merge가 끝나기 전에는 두 실행 트랙의 코드 커밋을 시작하지 않는다.

---

### Task 3: Wave 1, 독립 기반 작업

**Parallel work:** 가능.

**Supabase worktree:** 실행 계획 Task 2와 Task 3.

- 데이터베이스 포트.
- D1 계약 테스트.
- PostgreSQL 어댑터.
- gateway 공통 SQL 부분집합.

**STT worktree:** 실행 계획 Task 2부터 Task 5까지.

- 네 엔진 registry와 config.
- Qwen local adapter.
- CLOVA adapter.
- RTZR adapter.

두 트랙은 이 wave에서 공유 파일을 수정하지 않는다. Supabase 트랙은 `apps/pipeline`을, STT 트랙은 `db/gateway.ts`와 `request-handler.ts`를 건드리지 않는다.

- [ ] **Step 1: 결정 정본이 들어간 최신 main에서 두 실행 워크트리를 만든다**

```bash
git fetch origin main
git worktree add -b feat/supabase-platform-cutover .worktrees/supabase-platform origin/main
git worktree add -b feat/stt-consent-cutover .worktrees/stt-consent origin/main
```

- [ ] **Step 2: 각 트랙의 지정 테스트를 통과시킨다**
- [ ] **Step 3: 각 트랙을 독립 PR로 검토한다**
- [ ] **Step 4: Supabase 기반 PR을 먼저 main에 merge한다**
- [ ] **Step 5: STT adapter PR을 그 다음 main에 merge한다**

---

### Task 4: Wave 2, 공유 스키마 직렬화

**Worktree:** `.worktrees/supabase-stt-schema`

- [ ] **Step 1: 최신 main에서 공유 스키마 워크트리를 만든다**

```bash
git fetch origin main
git worktree add -b feat/supabase-stt-schema .worktrees/supabase-stt-schema origin/main
```

- [ ] **Step 2: STT 계획 Task 6의 `0045_consent_four_domains.sql`을 먼저 적용한다**

구 2종 자동 승격 금지, append-only 사건, provider와 purpose 증거를 테스트한다.

- [ ] **Step 3: Supabase 계획 Task 4의 PostgreSQL baseline을 그 최종 스키마에서 만든다**

PostgreSQL baseline에는 consent 4영역이 처음부터 포함된다.

- [ ] **Step 4: `0046`, `0047`을 예약대로 추가한다**

Auth identity와 audio lifecycle을 순서대로 추가한다.

- [ ] **Step 5: 두 백엔드 스키마 계약을 실행한다**

```bash
pnpm --filter @ccc/api exec vitest run test/participant-consent-four-domains.test.ts test/postgres-schema.test.ts
pnpm guard:db
pnpm guard:doc-numbers
```

Expected: PASS.

---

### Task 5: Wave 3, 표면과 정책

**Serialized order:** Supabase 뒤 STT.

1. Supabase 계획 Task 5와 Task 6을 실행한다.
   - Supabase Auth와 action link.
   - 관리자 MFA와 퇴사 비활성화.
   - Supabase Storage와 30일 삭제.
2. 최신 main 위에서 STT 계획 Task 7과 Task 8을 실행한다.
   - 동의 API와 화면.
   - 기관별 provider 정책.
   - worker 정책 연결.

`request-handler.ts`는 두 트랙이 동시에 수정하지 않는다. Supabase surface가 merge된 뒤 STT surface branch를 최신 main으로 rebase하고 consent route를 추가한다.

- [ ] **Step 1: Supabase surface 테스트와 브라우저 smoke를 통과시킨다**
- [ ] **Step 2: Supabase surface를 merge한다**
- [ ] **Step 3: STT surface를 최신 main으로 rebase한다**
- [ ] **Step 4: 동의 API, 화면, pipeline policy 테스트를 통과시킨다**
- [ ] **Step 5: STT surface를 merge한다**

---

### Task 6: Wave 4, 독립 리허설

**Parallel work:** 가능.

**Supabase:** 실행 계획 Task 7.

- 합성 D1 export.
- PostgreSQL load.
- row count, FK, checksum 검증.
- 두 번 반복.

**STT:** 실행 계획 Task 9.

- 합성 대화 10개 이상.
- Whisper와 Qwen local 기준선.
- 승인된 preview 자격 증명이 있을 때 CLOVA와 RTZR.
- CER, 반복률, DER, RTF, 비용, 안전성.

외부 provider 결과가 없어도 Supabase 이전 리허설은 진행할 수 있다. 반대로 Supabase 운영 전환이 없어도 STT local benchmark는 진행할 수 있다.

---

### Task 7: Wave 5, 통합 preview

**Worktree:** `.worktrees/supabase-stt-integration`

- [ ] **Step 1: 최신 main에서 통합 worktree를 재생성한다**

이전 통합 브랜치가 decision과 migration commits를 이미 main에 보냈다면 새 `feat/supabase-stt-preview` 브랜치를 만든다. 오래된 merge commit 위에 계속 쌓지 않는다.

- [ ] **Step 2: Supabase preview cutover를 실행한다**

가입, 인테이크, 일정, 기록, 오디오, 동의, 감사 흐름을 가상 시드로 완주한다.

- [ ] **Step 3: STT 네 경로를 실행한다**

수기 전용, Whisper, Qwen, 승인된 외부 provider 경로를 각각 확인한다.

- [ ] **Step 4: rollback을 실행한다**

D1과 R2 설정으로 되돌리고 같은 가상 사용자 흐름이 동작하는지 확인한다.

- [ ] **Step 5: 최종 검증을 실행한다**

```bash
(cd apps/pipeline && python3 -m unittest discover tests)
pnpm guard:db
pnpm guard:consent-copy
pnpm guard:secrets
pnpm guard:doc-numbers
pnpm typecheck
pnpm test
pnpm build
```

Expected: PASS.

---

### Task 8: Linear 정리

**External procedure:** 실행 전 `~/developer/tools/portwright/services/linear.md`를 읽는다.

- [ ] **Step 1: 기존 티켓에 방향 변경 코멘트를 남긴다**

- CCC-134: 네 엔진과 외부 provider 운영 게이트.
- CCC-136: Supabase Auth action link, 관리자 MFA, 퇴사 비활성화.
- CCC-137: D1 규모 준비에서 Supabase 서울 이전으로 확대.

- [ ] **Step 2: 신규 티켓 2건을 만든다**

1. `Supabase 서울 플랫폼 전환`
2. `동의 4영역과 외부 STT 운영 게이트`

각 본문은 해당 실행 계획 경로, 선행 wave, 완료 게이트를 포함한다. Slack 스레드는 만들지 않는다.

- [ ] **Step 3: 블록 관계를 연결한다**

- 동의 4영역 migration blocks PostgreSQL baseline 확정.
- PostgreSQL baseline and Auth blocks Supabase preview cutover.
- 법률 검토 blocks 외부 STT production activation.
- G1부터 G3까지 비교 blocks 최종 STT 엔진 선택.

---

## Stop Conditions

다음은 전체 작업을 멈추지 않고 해당 production 문만 닫는다.

- Supabase 서울 물리 리전 증빙 미확인: 로컬과 preview만 진행, 실데이터 이전 금지.
- RTZR 처리 위치 미확인: adapter와 synthetic test는 진행, 운영 선택 금지.
- CLOVA 계약급 국내 추론 보증 미확인: adapter와 synthetic test는 진행, 운영 선택 금지.
- 법률 검토 미완료: 동의 구조와 가상 preview는 진행, 실데이터와 외부 STT 금지.
- 처리 장비 부재: adapter contract와 harness는 진행, G1부터 G3까지 실측만 보류.

## Done Definition

1. D76부터 D79까지 ADR과 CLAUDE.md에 기록됨.
2. D1과 PostgreSQL이 같은 gateway 계약 테스트를 통과함.
3. Supabase Auth 초대, 관리자 MFA, 퇴사 비활성화가 preview에서 동작함.
4. R2와 Supabase Storage가 같은 audio contract를 통과하고 30일 삭제가 증명됨.
5. 네 STT 엔진이 registry에 있고 자동 폴백이 없음.
6. 동의 4영역 현재값과 append-only 사건이 있고 구 2종은 자동 승격되지 않음.
7. 합성 이전 리허설 2회와 rollback 1회가 성공함.
8. G1부터 G3까지 비교 보고서가 있고 최종 엔진은 Q가 선택함.
9. 외부 provider production은 계약과 법률 게이트 없이는 fail-closed함.
10. 루트 디자인 checkout의 시작 변경이 그대로 보존됨.
