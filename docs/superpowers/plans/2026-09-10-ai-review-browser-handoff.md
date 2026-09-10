# AI 초안 검토 실브라우저 인계

작성: 2026-09-10. 대상: `apps/client` P5 검토와 수기 기록 저장 충돌.

## 목적

호스팅 사업자, STT, 운영 시크릿 없이 **실제 `handleRequest`와 격리 DB**가 제공하는 합성 초안을
브라우저에서 검증한다. 승인 전 초안은 공식 기록이 아니며, 승인만 공식화한다. 반려와 409는 입력을
잃지 않는다.

## 소스에서 닫은 범위

- 15초 페이지 머리에 `상담 기록하기`, `상담 기록 확인하기` 입구를 붙였다. 회차 행에도 `회차 보기`
  링크가 있다.
- 검토 화면이 `regenerateAvailable`과 `regenerateSourceSnapshotId`를 읽고, 서버가 열어 준 경우에만
  `최신 재료로 다시 만들기`를 보여 준다. `POST /sessions/:id/ai/generate`에는 서버가 준 스냅샷 ID만
  돌려보낸다.
- 승인과 반려는 현재 버전의 `POST /sessions/:id/ai/drafts/:version/review`를 그대로 쓴다.
- 초안 409를 정확히 가른다.
  - `stale_draft_version`, `draft_version_required` → 최신 초안을 다시 읽으라는 안내
  - `speaker_confirmation_required` → 화자 매핑 확인 안내
  - `grounded_evidence_required` → 저장 근거 없는 내용 안내
  - `fixture_draft_approval_forbidden` → 합성 검수용 초안은 공식화할 수 없다는 안내
- 409 뒤 화자 확인과 액션 등록 초안은 지우지 않는다. 기록 작성 화면도 저장 실패 뒤 상담 일시,
  메모, 세부 기록, 액션, 플래그와 같은 `submissionId`를 그대로 둔다.

## 실제 API fixture 근거

새 우회 endpoint를 만들지 않았다. 정본 seam은 다음 파일에 이미 있다.

| 목적 | seam |
|---|---|
| 실제 handler + 요청 헤더 actor | `apps/api/test/support/local-worker.ts:18-27` |
| 격리 D1 + 최신 migration | `apps/api/test/support/d1.ts`의 `setupD1()` |
| AI 준비 전체 | `apps/api/test/routes.test.ts:263-311`의 `setupPhase1AiFixture()` |
| canonical LLM 동의 3영역 | 같은 파일 `322-356` |
| S5 text job claim/result → masked snapshot | 같은 파일 `359-465`의 `recordSourceSnapshot()` |
| 합성 provider 호출 | `FakeAiProviderAdapter`, env `AI_PROVIDER_ADAPTER`; 네트워크 호출 0 |
| 초안 생성 | 같은 파일 `469-480`의 `generateDraft()` |
| 관리자 읽기·승인 거부 | 같은 파일 `2406-2426` |
| 배정 안 된 실무자 403 | 같은 파일 `2449-2461` |
| 재생성 노출·새 버전 | 같은 파일 `2478-2529` |
| 반려 뒤 재생성 차단·stale 409 | 같은 파일 `2545-2568` |

## Standalone 브라우저 하네스

실행 파일은 `apps/api/test/tools/ai-review-preview.mjs`다. production 우회·seed endpoint 없이 프로세스
시작 중에만 격리 PostgreSQL에 합성 graph를 만든 뒤 실제 `handleRequest`를 연다.

```bash
bun apps/api/test/tools/ai-review-preview.mjs
```

고정 주소는 client `https://127.0.0.1:4281`, API `https://127.0.0.1:4282/api/v1`, 합성 Auth
`https://127.0.0.1:4283`이다. 임시 인증서, Ed25519 설치 키, PostgreSQL 자격, PII 키와 data는
격리된 임시 디렉터리·Docker DB에만 있고 프로세스 종료 때 삭제된다. ready 출력에는 route와 fixture
ID만 있고 auth token·refresh token·키는 없다.

| actor | 로그인 이메일 | 비밀번호 | MFA | 용도 |
|---|---|---|---|---|
| 담당 실무자 | `assigned@example.invalid` | `synthetic-password` | `123456` | A·B·C·E |
| 비담당 기관 관리자 | `admin@example.invalid` | `synthetic-password` | `123456` | D |
| 비담당 실무자 | `unassigned@example.invalid` | `synthetic-password` | `123456` | 추가 403 확인 |

Auth는 로그인마다 별도 subject·session·refresh·challenge를 발급한다. API resolver는 JWT의 `sub`를
`resolveDirectoryActorByAuthSubject`로 실제 `users.auth_subject`와 `user_role_assignments`에 다시
묶는다. 옛 `synthetic-api.mjs`의 전역 `state.role`과 단일 `USER_ID`를 쓰지 않는다.

하네스 ready JSON의 route 키를 그대로 연다.

| 시나리오 | ready route |
|---|---|
| A 승인 전 제외→승인 | `approveBriefing`, `approveReview` |
| B 반려·stale 409 | `rejectStaleReview` |
| C 늦은 재료 재생성 | `regenerateReview` |
| D 비담당 관리자 승인 거부 | `adminDeniedReview` |
| E 수기 기록 version 충돌 | `recordConflict` |

fixture 준비는 기존 route-test seam과 같은 순서다.

1. 실제 PostgreSQL migration 전부 적용 후 `ccc_api` 제한 연결을 연다.
2. 기관, 담당 실무자, 비담당 기관 관리자, 비담당 실무자, service actor를 서로 다른 ID와
   `auth_subject`로 만든다.
3. `seedTestProgramWithRuntimeModes(..., {sttMode:'off', llmMode:'openai'})`와 canonical provider
   registry를 적용한다.
4. case와 수기 memo session을 만들고 등록 시점 여섯 영역 동의를 실제 disclosure에 묶어 grant한다.
5. `TEXT_AI_PILOT_ENABLED='1'`, `AI_PROVIDER_ADAPTER=<testOnly FakeAiProviderAdapter>`를 쓰고 adapter
   config hash를 등록·활성화한다. `EXTERNAL_AI_CALLS_ENABLED`와 hosted key는 없다.
6. S5 text job을 enqueue→claim→result route로 제출해 masked snapshot을 만든다.
7. 일반 `/sessions/:id/ai/generate` route가 genuine adapter dispatch를 거쳐
   `origin='generated'`, `creationMode='provider_generated'` 초안을 만든다. approvable draft를 SQL로
   직접 넣지 않는다.
8. C graph에만 두 번째 S5 snapshot을 만든다. E graph에는 실제 일정 한 건을 만든다.

## 실행 시나리오

### A. 승인 전 제외 → 승인 → 공식 재조회

1. 담당 실무자로 `15초 페이지`를 연다.
2. `승인 대기 1건`과 `AI 정리 검토` 입구가 보이는지 확인한다.
3. draft `summaryText`, `oneLiner`가 `sessionRows`와 AI 제안에 없는지 확인한다.
4. 검토 화면을 열어 저장된 요약·대조·질문·근거를 확인한다.
5. 녹음 회차이면 `화자 매핑을 확인했습니다`를 고른 뒤 `승인`한다.
6. 응답 200, 상태 `승인됨`을 확인한다.
7. 15초 페이지와 상담 기록 목록을 다시 읽는다.
8. `승인 대기`가 사라지고 승인된 one-liner/summary만 공식 영역에 나타나는지 확인한다.

### B. 반려와 replay/stale 409

1. 같은 v1 draft를 탭 두 개에서 연다.
2. 탭 A에서 `반려`해 200과 `반려됨`을 확인한다. 15초 페이지 공식 영역에는 초안 본문이 없어야 한다.
3. 탭 B에서 액션 등록 문구와 담당·기한을 채우고 화자 확인을 고른 다음 `승인`한다.
4. 서버 409 `stale_draft_version`, 화면 `AI 초안이 바뀌어...` 안내를 확인한다.
5. 액션 문구, 담당, 기한과 화자 확인이 그대로인지 확인한다. 저장·승인 완료로 표시하면 실패다.
6. `최신 초안 다시 불러오기`를 눌러 terminal `반려됨`을 읽고 승인·반려 버튼이 사라지는지 확인한다.

### C. 재생성

1. v1 생성 뒤 같은 session에 두 번째 S5 masked snapshot을 `recordSourceSnapshot()`으로 저장한다.
2. 검토 화면을 다시 읽어 `최신 재료로 다시 만들기`가 보이는지 확인한다.
3. 버튼을 누른다. 요청 body는 `{sourceSnapshotId:<GET이 준 ID>}` 한 칸뿐이어야 한다.
4. 응답 201 v2, 다시 읽으면 `regenerateAvailable=false`, draft row 수 2, work item 수 1인지 확인한다.
5. 반려/승인 terminal draft에서는 늦은 재료가 있어도 버튼이 없어야 한다.

### D. 비담당 기관 관리자

1. 담당 배정 없는 기관 관리자로 같은 draft URL을 연다.
2. GET은 200으로 읽을 수 있다.
3. `승인` 요청은 403 `forbidden`, draft의 `reviewDecision`은 null, 15초 페이지 공식 영역은 그대로인지
   확인한다. 관리자가 비담당 case를 공식화하면 실패다.

### E. 수기 기록 저장 충돌 복구

1. 같은 예정 일정과 `expectedVersion`으로 상담 기록 작성 화면을 탭 두 개에서 연다.
2. 두 탭에 서로 다른 memo·세부 기록·액션·플래그를 적는다.
3. 탭 A 저장 201.
4. 탭 B 저장은 일정 version 충돌 409.
5. 탭 B의 상담 일시, memo, 세부 기록, 액션, 플래그가 그대로이고 `submissionId`도 바뀌지 않아야 한다.
6. 최신 기록/일정을 확인한 뒤 사용자가 직접 다시 제출한다. 화면이 자동으로 새 기준을 채택하거나
   저장 완료라고 표시하면 실패다.

## 증거 상태 구분

| 층 | 현재 상태 |
|---|---|
| client 소스 | 기록 입구, approve/reject/regenerate와 409 입력 보존 wiring 구현 |
| API fixture | 기존 route-test seam을 standalone 하네스가 실제 PostgreSQL·handleRequest로 조합 |
| standalone 실행 | Main 실행 대기. 이번 동시 변경 중 harness·build·test·lint·formatter 미실행 |
| 실제 DB 브라우저 | ready route A–E를 Main이 구동·검증하면 채워짐 |
| hosted provider/STT/운영 | 사용하지 않음. 활성화·시크릿·운영자료 0 |
