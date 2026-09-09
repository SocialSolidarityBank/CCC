# apps/client 업무 프런트엔드 전체 구현 계획

> **실행 제약:** FRONTEND가 검증된 pre-D89 BACKEND `004a97d`를 자기 `frontend/beta-0.9-client`에 로컬 병합했다. client/P1/SDK/DESIGN exports와 양쪽 pinned lock을 보존하고 지정된 결합 검증만 실행했다. 최신 결과는 §14다. push/origin-main merge/배포, D89 변경, 추가 PostgreSQL/전체 API suite, 자격/사업자 호출과 하위 에이전트는 실행하지 않는다.

작성/갱신: 2026-09-09. 상태: **검증된 pre-D89 소스 결합 후 client typecheck/43 tests/build와 API typecheck 통과. hosted P1·D89·전체 베타는 미완이다.** §11=P0, §12=source-edit, §13=독립 기준선, §14=현재 결합 검증이다.

**목표:** 기존 업무 웹앱의 기능과 승인된 새 화면을 `apps/client`에서 실제 API와 연결해 구현한다. 기존 업무 소스와 공유 자산을 정리한 뒤 후속 계약까지 통합하고 세 배포 모드에서 전체 흐름을 검증한다. 뼈대나 시안 제작만으로 끝내지 않는다.

**요청 해석:** 이 세션은 프런트엔드 구현 책임자다. `design-adjustments`의 최신 결정과 작업물을 검수해 파일 소유와 인계 순서를 분리한다. 디자인 레인에 업무 화면 구현 전체를 떠넘기거나 인증 준비만을 최종 목표로 삼지 않는다.

**구조:** 프런트엔드는 라우팅, 상태, API 호출, 데이터 검증, 폼 제출, 권한별 화면 조립을 맡는다. 디자인 레인은 공용 부품, CSS, 토큰, 표현 규칙과 디자인 검수를 맡는다. API/DB/인증/설치기는 해당 레인이 제공하며, 프런트엔드는 그 결과를 실제 사용자 흐름으로 연결한다.

**도구:** 기존 React/Vite, 승인된 React Router와 `@supabase/supabase-js@2.116.0`, 기존 Wire/계약 패키지를 사용한다. 이번 소스는 `@ccc/contracts:workspace:*`와 지정 SDK만 client manifest에 추가하며 Router 소비부가 없어 Router 패키지는 아직 추가하지 않는다. 앱 버전/기존 도구 버전은 유지한다. 새 CSS/다른 외부 의존성은 추가하지 않는다.

**실행:** 독립 P1 checkpoint `16f89a0`을 보존하고 Main이 승인한 `004a97d`만 로컬 병합했다. 제품 충돌/ours-theirs 선택/lock 재해석은 없었다. 기존 두 그래프의 pinned resolution과 backend importer 둘, client SDK를 그대로 결합했다. 제품·CSS/STT/wire·D89 계약을 추가 수정하지 않고, 정상 hooks로 merge checkpoint를 남긴 뒤 combined root lock을 반환한다.

**근거:** [S2 인증/설치 계약](../../specs/S2-auth-capability-manifest.md), [S3 화면/API 대응표](../../specs/S3-screen-api-map.md), [D86](../../adr/0044-onboarding-invite-and-admin-surfaces.md), [D87](../../adr/0045-public-project-admission-gate.md), [실행 티켓 계획](../../../CCC_OPEN_PILOT_PLAN.md), [녹음 업로드 인계](2026-09-09-audio-upload-design-handoff.md). D88의 ADR-0047과 디자인 스펙은 현재 M에 포함됐다. 후보 C는 M과 통합되지 않았다. 총괄 계획의 절대 경로와 고정 SHA는 §11에 남긴다.

## 1. 현재 조사 기준과 이전 검수의 적용 범위

- 원본은 `frontend/main@e444805`의 untracked 379줄 계획이다. 별도 보존/해시 확인 뒤 fetched main `4352d32`에서 `frontend/beta-0.9-client`를 만들었다. 원본 hash와 보존 위치는 §11.1이다.
- M=`origin/main@4352d32`, C=`origin/feat/settings-backend@71778f3`의 Git 객체를 읽었다. 후보를 checkout/cherry-pick하거나 다른 worktree에 쓰지 않았다. M과 C의 고유 커밋 수는 12/1이다.
- 디자인의 이전 조사 기준은 `design/participant-hub-prototypes@d490b42`였고 D88은 이후 main에 병합됐다. 지금 구현 인계 상대는 총괄이 지정한 DESIGN(`design/work`)이다. 이전 폴더와 시안을 새로운 작업자 소유권으로 추정하지 않는다.
- 이전 잠금 확인에서 “Cloud 인증/client/settings API가 없다”는 결론은 당시 main의 사실이었다. 후보에는 실제 구현이 있으므로 이번 계획은 신규 제작이 아니라 **후보 선별 재사용과 main 통합 대기**로 바꾼다.
- 디자인 시안의 과거 측정은 이번 wave의 실행 증거가 아니다. D88는 승인된 표현의 정본이고, 실제 데이터/부품 구현과는 구별한다. 오래된 readiness 문서의 기각된 시안이나 후보의 초기 조사 txt보다 최신 ADR과 고정 commit 코드가 우선한다.
- main의 STT 상태 카드와 만료 preview 복구는 C보다 새롭다. 후보의 Next page 5개 차이를 §9에서 분리했으며 전체 커밋/트리 덮어쓰기로 main 후속을 되돌리지 않는다.
- 현재 작업의 소유/순서는 총괄의 `2026-09-09-beta-0.9-orchestration.md`를 따르며, 레인 간 실제 인계 수락과 검증 완료를 이 정적 조사에서 추정하지 않는다.

## 2. 겹치지 않는 역할과 파일 소유

| 영역 | 구현 책임 | 파일과 경계 |
|---|---|---|
| 업무 client 전체 | 이 프런트엔드 세션 | `apps/client/**`에서 `src/stt-trial/**` 제외. 앱 시작, 인증 UI/세션 소비, React Router, API/DTO, 업무 폼/화면, PWA, 기능별 검증 |
| 기존 STT 설정 상태 | 이 프런트엔드 세션 | `apps/web/app/admin/ai-provider/**`, `apps/web/app/lib/api.ts`의 capabilities 읽기 함수만. PR #319를 재구현하지 않고 이전할 때 재사용 |
| 승인 화면 표현과 공유 UI | 디자인 레인 | `apps/web/app/components/wire/**`, 기존 웹 화면, `layout.tsx`의 공유 스타일, `globals.css`, `design/**`, `DESIGN.md`, `DESIGN-RULES.md`, 기존 디자인 guard/harness와 디자인 아티팩트 |
| STT 시험 | stt-client 레인 | `apps/client/src/stt-trial/**`. 시험 API는 업무 API와 별개로 유지한다 |
| 브라우저 중립 공개 exports | 기존 소유자와 명시적 인계 | `client-surface.ts`와 `apps/web/package.json` exports는 STT 예외 소유도 걸려 있다. 디자인이 부품을 고치고 export 소유자가 공개하는 한 번의 인계로 처리한다. 프런트엔드가 몰래 export를 늘리지 않는다 |
| 공유 파일과 client 검사 연결 | O가 작성자/슬롯 지정 | 현재 wave에서 루트 `package.json`, `pnpm-lock.yaml`, contracts/exports, 모든 design guards/harness는 수정 금지다. 이전 예외가 있어도 동시에 수정하지 않는다. 이후 명시적 슬롯에서만 변경 |
| 인증/업무 API/DB/AI | 해당 백엔드 및 설치 레인 | `packages/http-api/**`, `packages/core/**`, `adapters/**`, `apps/pipeline/**`, migrations. 이 세션은 계약과 필요한 응답을 요청하고 직접 수정하지 않는다 |
| 공개 site와 web 삭제 | E2-6/E2-7 통합 작업 | `apps/site/**`, 기존 Next 업무 코드 삭제, deploy/rollback 연결은 현재 소유 예외 밖이다. 이 세션이 누락 없이 출고를 조정하되, 실행 전 소유 조항 PR 또는 기존 소유자의 통합 PR이 필요하다 |

같은 화면에서의 분담은 다음과 같다.

- 디자인 레인은 배치, 위계, 색, 문안을 한 묶음으로 정하고 공용 부품을 제공한다.
- 프런트엔드는 승인된 부품과 배치로 자기 `apps/client` 화면을 조립하고 조회/입력/저장/실패/권한을 연결한다. 디자인 검수 지적도 자기 파일이면 여기서 반영한다.
- 디자인 레인이 같은 기능을 기존 Next 앱에도 구현해야 하는지는 별도 작업으로 정한다. client 이전 때문에 Next에 같은 새 화면을 먼저 만들게 하지 않는다.
- 새로운 디자인이 없는 기존 화면은 현행 승인 계약을 재사용한다. 공용 부품이 모자라는 화면만 인계 대기하며 다른 화면의 계약 작업은 진행한다.
- 코드의 존재와 수정 권한은 다르다. 순수 formatter/decoder라도 공개 export가 없으면 잠긴 파일을 상대경로로 끌어오거나 복사본을 정본으로 삼지 않는다.

## 3. 두 레인이 주고받을 산출물

### 프런트엔드 → 디자인

기능별로 API 계약과 상태를 먼저 확정하고 `docs/superpowers/plans/<날짜>-<기능>-design-handoff.md`에 인계한다. 필수 항목은 frontend-lane 정본의 8개다: 목표, 파일/URL, API 계약, 전체 거부/상태, 문구 초안, 적용 규칙 절, 렌더 수용 기준, 금지 범위/선행 조건/소유자. 빈 DTO나 확정하지 않은 성공 상태로 착수를 요청하지 않는다.

### 디자인 → 프런트엔드

이름뿐인 “시안 완료” 대신 다음을 받는다.

1. 승인 ADR과 병합된 기준 커밋. 시안에만 남은 표현은 따로 표시한다.
2. 사용할 공개 부품과 props, 이벤트/callback, CSS 자산 경로. Next와 서버 모듈 의존을 끊은 실제 export가 있어야 한다.
3. 읽기/선택/쓰기 상태별 배치와 문구, 키보드/초점 동작, 좁은 화면과 두 테마의 측정 결과.
4. 바꾼 파일, 유지하는 기존 호출자, 변경 후 client가 받아야 할 API 차이.

먼저 주고받을 공용 부품과 화면 표현은 아래 다섯 묶음이다.

| 인계 묶음 | 디자인이 제공할 것 | 프런트엔드가 연결할 것 |
|---|---|---|
| 셸과 공개 부품 | 브라우저 중립 셸/링크, HERO, 날짜 입력, 탭, 모달, Steps, 목록, 아이콘의 필요한 export | Router 링크, 역할별 메뉴, theme, 로그아웃, focus 이동 |
| 당사자 관리/허브 | D88 목록과 HERO, 선택창, 모바일 행동 | 검색/필터, case ID, 상세권한, 예약/기록 진입 |
| 일정 | 공용 월간 7열 격자, `+N건`, 기존 일간/주간 부품, Steps 되돌아가기 | 기간 URL, 실제 일정, 종일/색 저장, 후보와 선택한 일정 |
| 기록/리포트 | 기존 기록지 재사용 경계, 리포트 구획/출처 부품 | 실제 입력, 저장/복구/승인, 검증된 리포트 DTO와 근거 회차 |
| 인증/관리/요청 링크 | D86/D87 새 화면 배치와 필요한 공용 표현 | 실제 인증, 역할 대기, 기관 설정, 사업 확인, 1회 요청 |

이 표의 묶음은 인계 패킷을 대체하지 않는다. 이번 P0는 정확한 후보 diff/소비/차단을 제출하고, O가 BACKEND/DESIGN의 수락과 통합 commit을 회수한다. FRONTEND가 다른 레인의 작업을 재배정하지 않는다.

## 4. 전역 불변 조건

- 설치 확인을 생략하지 않는다. `import.meta.env.DEV`라도 manifest/신뢰키/주소 일치를 건너뛰지 않는다. Q의 첫 번째 선택을 유지한다.
- React Router를 사용한다. 임시 pathname router를 만들었다가 다시 갈아엎지 않는다.
- `sttMode=off`, `sttEngine=null`, preview/production의 `GET /capabilities` 503과 로컬 Agent 제약은 사용자 제공 사실로 유지한다. 이 세션에서 재조사하거나 고치거나 켜지 않는다.
- local-actor는 개발용 고정 신원이지 Bearer 인증이 아니다. HTTPS만 맞췄다고 제품 인증 완료로 판정하지 않는다.
- 합성 데이터로 검증한다. 이전 출력에 노출된 로컬 키를 안전하다고 단정하지 않는다. 실제 로컬 DB 시연 전 키 교체/시드 복구의 안전 준비를 별도 확인하며 값은 읽거나 출력하지 않는다.
- client의 토큰, PII, 기록 초안은 S2의 저장 경계를 따른다. 기존 localStorage 초안을 그대로 옮기거나 no-write 함수로 기능을 없애지 않는다. 허용된 저장 경로가 없으면 재시작 후 복구는 선행 계약 대기다.
- AI 초안은 승인 전 공식 기록이 아니고 수기는 즉시 공식 기록이다. 근거 없는 리포트, GAS 자동 채점, 감정 진단, 권한 없는 원문 노출은 금지한다.
- 관리자/감독의 읽기와 담당 실무자의 쓰기를 구별한다. 비담당에게 숨기는 데이터는 응답에서도 제한돼야 한다.
- 브라우저의 직접 URL, 뒤로/앞으로, 새로고침, 저장 실패에서도 선택한 사람/case/일정과 입력의 의미가 유지돼야 한다.
- 상대 워크트리의 checkout/reset/clean/stash, 파일 삭제와 직접 수정은 하지 않는다. `ccc-preview` 수동 배포는 디자인 소유다.

## 5. P0 차단 분류와 단일 작성자

아래는 4352d32와 71778f3을 대조한 현재 분류다. 코드의 존재, main 통합, 실제 HTTP, 브라우저 성공과 운영 배포는 다르다. 정적 조사인 이번 wave에서는 후보 테스트 파일이나 과거 smoke 문서를 실행 증거로 승격하지 않는다.

| ID | 정확한 경계와 현재 상태 | 소유자 | P1/업무 화면이 받을 것 |
|---|---|---|---|
| BE1 | M Worker는 preview/local/Access다. C에 `adapters/identity-supabase`, `apps/community-cloud/src/runtime.ts`의 Bearer/JWKS/MFA/CORS가 있지만 미통합. C 설치 로더는 Office/Single을 거부한다 | BACKEND(`integrate/beta-0.9-backend`), 설치/인증 후속은 O 배정 | 통합 commit, 실제 공급 가능한 signed manifest/빌드 신뢰키/설치 ID, Cloud endpoint prefix/CORS, `/capabilities`, `/me`, `/auth/logout` DTO/거부. 기관 코드 신뢰 조회와 Local 인증은 별도 잔여 |
| BE2 | C에 profile PATCH, programs/직원/확인 evidence, program-options, 계정·역할, 감사, 보존, 내보내기 구현. M에는 대응 관리 API 다수가 없다. 등록/초대 입력은 M `programType`에서 C `programId`로 변한다 | BACKEND 단독으로 core/handler/contracts/migrations 통합. 공유 manifests/lock은 O 슬롯 | 고정된 field/envelope/권한/409 계약, 기존 데이터에 대한 program_id 연결과 초기 정책 row, 초기 기관 setup 후 실제 사업 확인, 새 migration 번호/통합 증거 |
| BE3 | D88 데이터는 M/C 모두 미완: 목록 email/사업명, hub birthDate/회차 집계, 종일 `all_day`/`display_color`가 HTTP 응답/입력에 없다 | BACKEND 후속 슬롯 | 별도 D88 DTO/권한·감사/저장 계약. `programs.tsx`의 기관 사업 목록이 당사자 목록 응답을 대신하지 않음 |
| BE4 | 기존 기록/일정/목표 API는 있다. 후보 client에는 업무 기록/복구 없음. 기존 localStorage draft를 새 S2 경계로 그대로 이식 불가. E2-8 목표, 선택 일정과 기록 보완값의 저장 의미 확인 필요 | FRONTEND는 기존 입력/상태 재사용, API/초안 영속 경로·E2-8은 BACKEND/O 배정 | scheduleId/expectedScheduleVersion/submissionId/official 범위와 unknown-outcome 복구, 합법적인 재시작 복구. 메모리 복구만으로 기존 초안 복구 완료라고 하지 않음 |
| BE5 | D86 기관코드, Auth 이메일 초대, 팀 관리/MFA 초기화, 비담당 축소 hub/실무자 발 요청, fragment public join/Local 전달함, 기관 동의 문안 6영역은 C에도 완성되지 않음 | BACKEND 및 O가 지정한 인증/동의/전달함 소유자 | 승인된 endpoint/DTO/역할 대기/1회 제출 계약. C accounts의 관리자 발 배정·강제 이관과 D86 실무자 발 요청을 혼동하지 않음 |
| BE6 | 전체 리포트 DTO/최초 목표 근거 미완. C의 JSON export와 상담 memory는 리포트가 아니다. C Cloud runtime은 `audioStore:null`; adapter 파일 존재가 업로드 연결 아님. STT/AI/복원/업데이트 활성 선행 유지 | BACKEND, PRIVACY/STT, 설치·리포트 담당을 O가 배정 | 실제 리포트/근거 DTO, 업로드/삭제/동의 응답, 허용 환경에서만 활성 경로. Off/null과 기존 503을 바꾸지 않음 |
| DES1 | M wire 공개 면에 C가 쓰는 `WireItem`, `Icon`, `WireRadioGroup`가 없다. C가 수정한 `client-surface.ts`, `wire-section.tsx`, `wire-styles.ts`와 `business.css`는 표현 통합을 받아야 함 | DESIGN(`design/work`, 실제 경로/연락은 O roster), export/STT 경계는 O 조정 | 후보 공개 부품 diff와 CSS를 DESIGN이 수령/검수한 commit. F는 잠긴 barrel이나 CSS를 직접 고치지 않음 |
| DES2 | 업무 셸, D88 목록/HERO/격자/Steps, 기록·인테이크·리포트와 D86 초기 설정의 승인된 표현/공개 부품이 필요 | DESIGN, client 화면 조립과 동작은 FRONTEND | Next 중립 props/events, 승인된 문안/키보드/두 테마/좁은 화면 조건. 경쟁 시안이나 prototype shim 복사 없음 |

**공유 통합 절대조건:** C는 M보다 공통 조상 뒤 12개 main 커밋이 부족하고 후보 고유 커밋은 1개다. 원본 커밋 전체 cherry-pick이나 `gateway.ts`/`request-handler.ts` 통째 덮어쓰기는 금지한다. M의 SQLite `0051_consent_six_domains`, `0052_audio_objects`, `0053_ai_draft_canonical_consent`, PostgreSQL `0007_consent_six_domains`, `0008_audio_objects`, `0009_ai_draft_canonical_consent`를 보존한다. C의 동일 번호 identity/program/account migration은 BACKEND가 새 forward migration으로 통합하며 F는 번호를 배정하지 않는다.

시스템 인증서/신뢰 저장소 변경은 별도 승인이다. 설치 문서와 같은 미검증 위치에서 신뢰키를 받아 검증을 꾸미지 않는다. main의 schema가 존재한다는 사실로 API/client/Agent 동의 6영역이 전부 통합됐다고 보고하지 않는다.

## 6. 전체 구현 순서

단계는 독립 배포물이 아니라 전체 목표의 검증 가능한 묶음이다. 선행 API가 막혀도 공개 계약 분석, 독립 decoder/상태 전이 검증, 인계 작성은 계속할 수 있다. 합성 fixture 검증만 끝난 묶음은 통합 대기로 남기고 실제 화면 완료와 구분한다.

### P0. 화면 대응표와 인계부터 고정한다 (E2-1)

- [x] M/C의 기존 route 30개와 page 입력/API/action·공통 진입을 §9에 연결했다. 현재 판정은 정적 대응표이며 HTTP/브라우저 검증은 미실행이다.
- [x] D86/D87/D88와 새 리포트 요구를 §11.3에 분류했다. C에 있는 settings/auth/client를 새로 만들지 않고 재사용 경계를 표시했다.
- [ ] 디자인은 공용 표현, 프런트엔드는 client 화면/동작, 백엔드는 데이터 계약으로 인계를 확정한다. §5에서 실행 티켓이 확인되지 않은 항목은 기존 티켓을 먼저 찾고, 없으면 해당 레인의 실행 티켓으로 요청한다. 없는 티켓 번호나 담당 수락을 만들어 적지 않는다.
- [ ] D88 디자인 PR과 frontend 기준을 맞추고, 잠긴 순수 API/부품 이동과 E2-6/E2-7에 필요한 소유 조항 PR을 먼저 준비한다. 반영 전 소유 밖 파일을 수정하지 않는다.
- [ ] 총괄이 제공한 BE1/BE2 계약으로 첫 로그인→기관 초기 설정→사업 확인 최소 경로를 P3 저장 검증보다 먼저 연결한다. 기존 seed나 DB 직접 수정으로 이 사용자 경로를 대신하지 않는다. P7 나머지 관리 기능과 P10 최종 동의 통합은 뒤에 유지한다.

**파일:** 현재 계획, 기능별 인계 패킷. client 전용 대응 데이터가 필요하면 `artifacts/design/client/`에 둔다. 기존 `scripts/design/route-inventory.json` 자체의 변경은 기존 하니스 소유자와 조정한다.
**완료:** 모든 기존 route 및 새 요구가 구현/대체/폐기/선행 대기 중 하나로 분류되고, 인계할 경계에 소유자와 완료 증거가 있다.

### P1. 실제 접속 가능한 bootstrap과 API/인증 경계를 만든다 (E2-2/E2-3)

**재사용 파일:** C의 `apps/client/src/business/installation.ts`, `auth.ts`, `auth-view.tsx`, `transport.ts`, `errors.ts`, `api.ts`, `programs.tsx`와 관련 실제 settings module(§11.2). 같은 역할의 bootstrap/auth/API 모듈을 새로 만들지 않는다. public/config/package 파일 적용은 O 슬롯 후에만 한다.

- [ ] contracts의 manifest 검증, bootstrap 일치, effective API base 계산을 직접 재사용한다. 개발 모드 우회는 없다. 신뢰키/설치 ID/sequence는 설치 계약을 따른다.
- [ ] 검증된 endpoint에만 fetch하고 업무 Bearer는 메모리에서 받는다. STT `api.ts`의 실패 처리 패턴은 참고하지만 STT 내부 API와 업무 API를 한 경로로 합치지 않는다.
- [ ] web transport의 `headers()`, cookie forwarding, service binding을 가져오지 않는다. endpoint별 DTO와 decoder는 실제 서버 응답을 기준으로 이전한다. 오류 코드 목록은 한 client 정본을 사용하고 각 화면은 관련 오류만 처리한다.
- [ ] Cloud 기관 코드와 Supabase 로그인/MFA, Office 로컬 로그인, Single 앱 잠금 연계를 모드별 실제 인증과 붙인다. 인증 종료/회수 시 요청과 메모리 데이터를 정리한다. 해당 서버 계약 전에는 로그인 성공 UI를 내지 않는다.
- [ ] 업무 인증 뒤 `/me`를 읽고, `/capabilities` 전체 응답은 `packages/contracts/src/capabilities.ts`의 `decodeCapabilityManifest`에 검증된 manifest의 registry를 넘겨 검사한다. mode와 응답의 `X-CCC-Installation-Id`도 대조한다. 기존 STT 카드의 부분 DTO나 타입 캐스팅으로 전체 검증을 대신하지 않는다. 공개 요청 경로는 업무 capability 조회 없이 검증된 endpoint로 분리한다.

**완료:** 유효한 설치에서 실제 인증 왕복, 잘못된 설치에서 업무 요청 차단, 만료/회수 처리, cross-origin 권한 거부가 입증된다. local-actor 성공만으로 이 단계를 닫지 않는다. 먼저 준비된 한 모드의 P1/P2 통합으로 해당 모드의 업무 화면 구현을 진행하고, 다른 모드의 최종 통합은 P10에서 닫는다. Single의 E7-2는 E2-4c를 선행으로 요구하므로 Single 앱 잠금 완성을 P5 시작의 조건으로 삼지 않는다.

### P2. 공용 셸, 라우팅, PWA를 연결한다 (E2-2/E2-3)

**파일:** `apps/client/src/main.tsx`, 새 React Router 연결, C의 `src/business/business-page.tsx`/`guide.tsx`, `index.html`, `build/shared-styles.mjs`, `vite.config.ts`, 필요한 `public/` 정적 자산. 후보의 auth revision/module 상태를 재사용하고 두 번째 인증/설정 앱을 만들지 않는다. shared CSS/exports는 DESIGN이 담당한다.

- [ ] React Router의 route/loader/action/error 경계에 업무 화면과 공개 진입을 나눈다. `WireLinkProvider`의 기존 경계로 링크를 연결한다.
- [ ] 셸은 승인된 브라우저 중립 부품을 사용한다. 잠긴 Next 셸을 JSX/CSS 사본으로 복제하거나 Next alias/shim으로 숨기지 않는다.
- [ ] 초기 경로, 역할별 메뉴, 사업 전환, theme, 로그아웃, 뒤로/앞으로, 직접 URL과 새로고침을 연결한다. service 신원과 역할 대기는 업무 셸에 들어가지 않는다.
- [ ] STT 레인과 `main.tsx` 마운트/URL 인계를 합의한다. STT 기능 파일과 API 의미는 바꾸지 않는다. 제품 업무 경로와 내부 시험을 섞지 않는다.
- [ ] 기존 스타일 조합을 재사용하되 런타임 `<style>` 삽입을 그대로 생산 CSP에 넣지 않는다. client 빌드에서 같은 CSS를 정적 파일로 출력해 `style-src 'self'`에 맞추는 경로를 검증한다. 새 CSS 값은 만들지 않는다.
- [ ] PWA manifest와 service worker는 정적 shell/asset만 다룬다. API 응답, PII, 토큰, 원음, 설치 신뢰 자료를 오래된 cache에서 조용히 재사용하지 않는다. 업데이트와 offline 안내에서 입력을 잃거나 성공을 꾸미지 않는다.

**완료:** 모든 진입/새로고침/뒤로가기가 같은 route 의미를 지키고, 공개 화면에는 업무 요청이 없으며, production CSP와 저장 경계를 지킨 빌드가 실제 브라우저에서 열린다.

### P3. 당사자 관리, 등록, 허브와 기본정보를 구현한다 (E2-4a/E2-5b의 대응 범위)

**대상:** `src/participants/` 아래 목록, 등록, 허브, 기본정보 화면. 원본은 부록의 P3 네 route다.

**티켓 순서:** P3은 파일 묶음이지 E2-5b 선행 관계를 바꾸는 티켓이 아니다. 목록/등록(E2-4a)을 먼저 구현해 P4와 기록 골든 흐름에 제공한다. 허브/기본정보/목표를 포함하는 E2-5b의 정식 완료는 E2-4c와 E2-8 이후로 둔다. 그 전에는 확정된 계약과 부품 준비만 수행하며 P3 전체를 완료로 세지 않는다.

- [ ] D88의 목록 검색/상태/사업 필터, 이메일/사업 이름과 행동을 실제 목록/후보 응답에 연결한다. 목록 행마다 허브를 추가 호출해 누락 필드를 억지로 채우지 않는다.
- [ ] 등록, 기본정보 수정과 동의 입력은 현행 동작을 보존하되 S2/D82의 6영역과 D87 서버 잠금으로 전환할 지점을 계약표에서 분리한다. 구 2종 동의를 자동 승격하지 않는다.
- [ ] 허브는 사람 ID와 선택 case ID를 분리하고 D88 HERO 값을 실제 응답으로 받는다. D86 비담당 허브는 허용된 정보만 렌더하며 상세 데이터는 응답에 없어야 한다.
- [ ] 후보가 바뀌면 이전 사람의 사업/일정/입력을 버리는 조건을 명시한다. 예약/기록 진입에 선택한 case ID를 전달하며 첫 사업을 임의 선택하지 않는다.

**완료:** 담당/비담당/관리자/종결 케이스별 검색→허브→수정/진입 흐름이 실제 API로 동작한다. 동명이인과 복수 사업에서 잘못된 대상에게 저장하지 않는다. 상세 목표 트리 완성은 P5의 E2-8 검수와 결합하며 기본 허브 완료로 전체를 닫지 않는다.

### P4. 일정과 15초 페이지를 구현한다 (E2-4b)

**대상:** `src/schedules/` 아래 보기, 등록, 계획 수정과 `src/briefing/`의 15초 페이지. 네 일정 route, 기존 15초 페이지 route 및 D88 종일/색.

- [ ] 월간 격자는 디자인이 제공한 공용 부품을 사용하고 FullCalendar를 추가하지 않는다. 일간/주간/월간과 기준 날짜를 URL에 보존한다. 옛 `/schedule/all` 진입은 의미를 보존해 canonical 경로로 보낸다.
- [ ] `+N건`은 해당 날짜 일간으로 이동한다. 자정 예약과 종일을 구별하고, 색은 서버 허용 값만 저장한다. 계약 없는 일정 수정 endpoint를 꾸미지 않는다.
- [ ] 후보 선택, 상담 일시, 목표/맞춤형 질문, Steps 왕복을 연결한다. 이미 선택된 사람/사업을 다음 화면에서 또 고르게 하지 않는다.
- [ ] `expectedVersion` 충돌과 시작 시각 이후 목표 잠금을 유지한다. 달력 시각을 이유로 서버 잠금을 우회하지 않는다.
- [ ] 현행 15초 페이지의 HERO, 확인할 내용, 공식 회차 정리, 불일치, 미해결 액션과 출처를 실제 API로 옮긴다. 관리자 읽기와 담당 실무자 쓰기를 나누고, E2-8이 바꿀 목표 부분은 현재 계약으로 먼저 옮긴 뒤 P5의 후속 검수에서 갱신한다.

**완료:** 일정 등록→재조회→선택 일정 계획 수정과 15초 페이지 조회/허용된 변경을 확인한다. 월말/연말/주차 경계와 보기 왕복에서 날짜가 조용히 달라지지 않는다. 종일/색은 실제 저장 검증 전 완료가 아니다. 15초 페이지가 완료돼야 E2-4b를 닫고 P5의 E2-4c 골든 흐름으로 간다.

### P5. 상담 입구, 기록, 인테이크, 목표와 AI 검토를 연결한다 (E2-4c/E2-5b, E2-8)

**대상:** `src/records/`, `src/intake/`, `src/goals/`, 종결 화면과 P4 `src/briefing/`의 E2-8 후속 변경. 부록 P5 다섯 route와 P4의 briefing route, 새 기록 입구 동작.

**내부 순서:** E2-4a와 P4에서 E2-4b 전체를 완료한 뒤 E2-4c 기록/승인 골든 흐름을 닫는다. 그 뒤 E2-8 결과를 받아 E2-5b 인테이크/목표/케이스 화면, P4의 15초 페이지 목표 부분과 P3의 해당 부분을 완성한다. 초기 경로를 제외한 관리자 P7 나머지는 E2-4c 완료 후 별도로 진행할 수 있다.

- [ ] 상담 입구에서 선택한 일정 또는 명시적 예약 없음을 전달한다. 예약 없음은 기록만 저장하고 가짜 예약을 만들지 않는다. 실제 상담 일시와 사전 정보는 동일한 선택을 따른다.
- [ ] 기록 작성/조회, 인테이크 작성/수정/조회, 목표 입력/이력/종료, 케이스 종결을 실제 API로 옮긴다. 인테이크를 기본 상담 기록지로 대체하지 않는다.
- [ ] `submissionId`, `expectedVersion`, 중복 제출, 409 복구, 초안과 선택 일정의 분리, 공식 기록 전환을 보존한다. 저장을 누르기 전 업무 데이터가 생기지 않되 감사는 유지한다.
- [ ] P4에서 이전한 15초 페이지의 내용 불일치/미해결 액션/출처 링크를 기록·승인 결과와 종단 연결하고, E2-8 뒤 목표 부분을 갱신한다. 관리자 읽기와 담당 실무자 쓰기를 나눈다.
- [ ] AI 초안 생성/검토/승인/반려/재생성, 대조 3종, 근거 인용, 액션 등록, 리스크 확인을 구현한다. AI가 꺼져도 수기 경로는 작동한다. 꺼진 AI의 성공 화면을 만들지 않는다.
- [ ] 녹음 업로드는 기존 design 인계 패킷과 §5의 선행 조건을 유지한다. 본 세션은 조건이 열린 뒤 client 통합과 모드별 API 연결을 맡고, 동일 업로드 화면을 따로 시안 제작하지 않는다. 화면 전용 거부 코드와 문구는 한 커밋으로 연결한다.

**완료:** 당사자 선택→예약 유무 선택→기록 저장→조회→승인(허용된 환경만)→브리핑의 실제 흐름과 실패 복구를 증명한다. Off 경로와 활성 환경 검증은 별도다. 권한 없는 case/다른 일정으로 입력이나 결과가 섞이지 않는다.

### P6. 전체 상담 리포트를 구현한다 (디자인 리포트 인계 + 도메인/API 후속)

**대상:** `src/reports/`와 당사자 허브의 리포트 탭. 별도 route를 추가하기 전에 기존 허브의 탭 상태로 충분한지 본다.

- [ ] 디자인의 5개 리포트 구획과 회차별 요약 요구를 응답 계약에 매핑한다. 원문/예시 JSON의 누락과 최초 목표 선택 규칙은 도메인 담당이 확정한다.
- [ ] 공식 기록과 실제 최초 인테이크 목표의 근거를 소비한다. 현재 목표나 가장 오래된 문자열을 최초 목표라고 추측하지 않는다.
- [ ] 근거 없는 구획은 생략하고, 준비되지 않은 응답은 빈 정상 리포트와 구별한다. 과제의 기록 없음과 실제 진행 확인을 혼동하지 않는다.
- [ ] 순서 번호는 공용 부품이 만들고, 출처 링크는 올바른 회차/원문으로 연결한다. 시안의 합성 원문과 콜로폰은 제품 데이터가 아니다.

**완료:** 권한이 다른 두 case를 오갈 때 리포트/출처가 섞이지 않고 모든 지표와 변화가 실제 근거로 연결된다. 실제 리포트 API가 없는 동안 이 단계는 차단 상태이지 전체 목표의 제외 항목이 아니다.

### P7. 관리자, 개인 설정, 기관 초기 설정과 사업 도입 확인을 구현한다 (E2-5a, D86/D87)

**대상:** `src/admin/`, `src/settings/`, `src/onboarding/`, 사업 도입 확인 화면. 부록 P7 여덟 route를 역할 합 기반 설정 화면으로 연결한다.

**초기 경로 우선:** 이 단계의 첫 로그인/기관 초기 설정/사업 확인은 총괄 지시대로 P3 저장 검증보다 먼저 제공한다. C의 onboarding/ProgramsModule을 재사용하고 나머지 관리 기능은 원래 순서를 유지한다.

**동의 전환 순서:** E2-5a의 화면/호출자 이전과 E4-6의 6영역 원자적 통합을 분리한다. E4-6은 E2-7을 선행으로 요구하므로, P7은 이전 단계에서 동작하는 계약의 이전 증거를 남기고 P10에서 API/Agent와 함께 최종 동의 계약을 적용한다. 미래 응답을 반환하는 모의 성공이나 영구 호환 계층을 만들지 않는다.

- [ ] 기관/사용자/역할/팀 감독/초대/배정/보존 파기/동의 문안·보유기간/AI·STT·연결을 역할 합만큼 제공한다. 기존 단일 `admin` 비교로 technical-admin이나 역할 대기를 처리하지 않는다.
- [ ] 이메일에 묶인 1회 실무자 초대와 역할 대기, 사용자 활성/비활성/MFA 초기화, 담당 배정 요청 승인/거절/이관을 서버 계약에 맞게 연결한다.
- [ ] 기관 초기 설정은 이미 설치된 기관의 설정이다. “기관 워크스페이스 생성” 화면을 추가하지 않는다.
- [ ] D87 저장 위치/처리 경로/확인 기록/설치 설정 변경 뒤 재확인/문안 버전 변경을 연결한다. 미확인 상태의 API 차단이 있어야 완료다. 안내 문구만으로 잠금을 대신하지 않는다.
- [ ] 기존 STT 상태 카드를 읽기 전용으로 이전한다. 설치 상태와 제품 승인 상태를 구분하고 여기서 엔진을 켜지 않는다.

**완료:** 겸임 역할, 역할 대기, 비담당 관리자, 기술 관리자, 일반 실무자의 접근/변경이 실제 서버 권한과 일치한다. 지원하지 않는 모드의 관리 화면은 열지 않는다.

### P8. 공개 요청 링크와 초대를 구현한다 (E2-5c, D86)

**대상:** `src/join/`, `src/invitations/`. 부록의 두 옛 join route와 당사자 초대 화면을 대체한다.

- [ ] S2의 `/join#t=<token>`→exchange→URL 제거→nonce로 complete를 구현한다. 업무 셸/Bearer/capabilities 호출을 섞지 않는다.
- [ ] 목적/만료/1회 사용, 스캐너의 GET으로 소진하지 않음, 중복 제출과 성공 후 안내를 검증한다. 옛 소비 토큰 자기 확인 페이지를 이식하지 않는다.
- [ ] 복사/QR를 연결한다. 카카오톡/문자와 새 요청 목적을 임의 추가하지 않는다. Local 원격은 승인된 암호화 전달함 계약을 받은 뒤 연결하며 터널로 대체하지 않는다.
- [ ] token path route와 기존 API는 이 레인에서 혼자 삭제하지 않는다. API/공개 링크 소유자와 전환 커밋을 맞추고, 구 URL에서 token을 추가 유출하는 자동 리다이렉트를 만들지 않는다.

**완료:** Cloud 요청 링크의 실제 1회 제출과 재사용 거부, 허용된 Local 전달 경로, Single/Office의 worker 가입 지원 범위가 각 모드 계약과 일치한다. 토큰/PII가 로그/저장/Referer에 남지 않는다.

### P9. 공개 site와 공유 자산을 분리하고 기존 web 소스를 정리한다 (E2-6/E2-7)

**대상:** `apps/client`의 통합/검사/빌드; `apps/site`, 기존 Next 소스와 배포 설정은 소유 예외 또는 소유자 PR 이후만 수정한다.

- [ ] `/welcome`은 도입 안내로, `/preview`와 `/preview/admin` 및 unlock은 기존 테스트 접점의 교체/은퇴 대상으로, `/kit`은 디자인 검수 접점으로 분류한다. 업무 route 수에서 사라졌다는 이유로 링크를 방치하지 않는다.
- [ ] web의 Wire/CSS/순수 UI 자산이 먼저 독립된 공개 위치로 이동하도록 디자인 및 export 소유자가 컷오버한다. `shared-styles.mjs`의 web layout 참조와 STT 호출자까지 옮긴 뒤에만 web 삭제가 가능하다. 공유 위치 이름을 또 하나 임의로 만들지 않고 소유자 PR에서 하나로 정한다.
- [ ] old/new 대응표의 모든 caller, server action, DTO, redirect, 공개 링크, guard/harness, build/deploy/rollback 참조를 처리한다. 기간 한정 이전 중 중복만 허용하고 영구 이중 앱과 호환 shim을 남기지 않는다.
- [ ] E2-7의 완료 기준인 기존 업무 기능 이전을 실제 API와 검증하고, E4-6 및 E5-9처럼 E2-7 이후 티켓이 소유한 최종 통합은 P10에 연결한다. 이 후속 통합을 E2-7의 선행으로 되걸지 않는다.
- [ ] 소스의 Next 업무 코드 삭제(E2-7)와 운영 Cloudflare runtime 은퇴(E6-6c)를 구분한다. production 변경은 릴리스 소유자의 승인 절차로 넘긴다. 이 계획 승인만으로 merge/배포를 실행하지 않는다.

**완료:** E2-6/E2-7의 source cutover, 공유 자산 독립, 호출자와 검사/배포/rollback 참조 정리가 끝났다. 이것은 전체 프런트엔드 목표나 운영 전환 완료가 아니다. 최종 계약과 세 모드 통합은 P10에서 닫는다.

### P10. 후속 계약과 세 모드의 전체 사용자 흐름을 검증한다

**대상:** P3/P5/P7/P8의 동의 관련 client 호출자와 화면, P5의 장문 AI 결과 소비, 전체 모드별 통합 시나리오. API/Agent 및 릴리스 소유자가 실제 전환 코드를 제공한다.

- [ ] E4-6의 API/client/Agent 6영역 원자적 cutover에 맞춰 등록, 초기 설정, 동의 변경, 공개 요청과 업로드의 소비부를 같은 계약으로 전환한다. 사건 8개 필드와 구 2종 미확정 상태를 확인하고 자동 승격하지 않는다.
- [ ] E5-9의 장문 AI Packet/부분 실패/근거 보존 계약이 제공되면 관련 결과 표시를 연결한다. E2-7 이전에 그 처리가 완료됐다고 보고하지 않는다.
- [ ] 준비된 기관의 기록 흐름뿐 아니라 새 기관의 설치→실제 로그인→초기 설정→사업 확인→당사자 등록→일정/기록→승인/리포트를 허용된 모드와 기능에서 완주한다. Cloud/Office/Single 각각 결과를 남긴다.
- [ ] AI Off, 미동의, API 장애와 역할 제한을 별도로 검증한다. 원음 업로드나 AI 활성 경로의 선행이 열리지 않았다면 해당 경로를 미완으로 남긴다.

**완료:** §8의 최종 조건을 충족한다. P9 source cutover와 P10 최종 통합을 구분해 순환 의존을 없애되, 원래 전체 구현 목표에서 후속 통합을 빼지 않는다. 운영 반영과 E6-6c 은퇴는 별도 승인/소유 절차다.

## 7. 병렬 순서와 첫 실행 단위

```text
P0 전체 대응표/소유/계약 요청
 ├─ 디자인: 승인 기준 병합 → 공용 부품/CSS/exports → 렌더 검수
 ├─ API/설치: 신뢰 endpoint/인증 → D88/D86/D87/리포트 응답
 └─ frontend: bootstrap/decoder/Router/PWA 및 확정된 독립 계약 검증
                 ↓ 해당 부품/실제 API 수령
          P1/P2 → P7 초기 로그인/기관 설정/사업 확인
                 ↓ 실제 준비 절차 뒤
          P3 목록·등록 → P4 일정·15초 페이지 → P5 기록·승인 골든 흐름
          이후 E2-8 관련 허브/목표/인테이크, P6 리포트, P7 나머지 관리자
          P8 공개 요청은 P1 계약 이후 별도 개발 가능
                 ↓ E2-7의 선행 화면과 공개 site 이전 완료
          P9 공유 자산 독립/web source cutover (E2-7)
                 ↓ E4-6/E5-9 후속 계약의 원자적 통합
          P10 새 기관 초기 설정부터 세 모드 전체 흐름 검증
```

첫 실행 단위는 **P0 대응표와 셸/당사자용 공용 export 인계, P1 설치 검증 소비부 및 실제 접속 조건 확보**다. 코드 파일 몇 개를 만든 뒤 전체 완료로 보고하지 않는다. API가 막힌 기능 때문에 이미 확정된 decoder 검증이나 독립 계약 작업을 멈추지 않으며, 반대로 준비되지 않은 기능의 가짜 화면을 만들지 않는다.

P3/P4 일부는 서버 계약과 공용 부품이 먼저 준비되면 병렬 작업할 수 있다. P5의 골든 흐름은 둘의 실제 결과가 필요하다. E2-8의 목표 검수와 공개 site 분리 등 `CCC_OPEN_PILOT_PLAN.md`의 선행 관계는 이 그림으로 삭제하지 않는다. 파일 소유 충돌이 있는 패키지/잠금 파일/Router 통합은 이 세션 한 작업자가 직렬로 반영한다.

P1과 P2는 후보의 설치/auth/transport를 재사용하는 기반 묶음이다. 총괄이 지정한 초기 P7을 앞당겨 실제 로그인/기관 준비/사업 확인을 거친 뒤 P3로 간다. 관련 API가 준비되지 않으면 이 사용자 흐름을 차단으로 보고하며, 설치/사업 확인 우회나 미리 채운 DB로 완료를 대신하지 않는다.

## 8. 검증과 완료 판정

### 기능마다 남기는 증거

1. 대응표의 route/API/권한/거부/성공 흐름이 실제 브라우저에서 작동한 결과를 남긴다. fixture 렌더, local-actor 개발 smoke, 제품 인증 통합, 운영 배포를 서로 다른 상태로 기록한다.
2. 새로고침/뒤로/직접 진입, 대상을 바꾸는 중 늦은 응답, 중복 클릭, 401/403/409/503, 저장 실패와 초안 복구를 확인한다. 반복 전송으로 쓰기 실패를 숨기지 않는다.
3. 실제 화면에서 밝은/어두운 테마와 기존 하니스의 폭을 검사한다. D88 격자와 모바일 행동의 추가 폭/조건은 승인 spec을 따른다. fixture 이미지로 실제 저장 증거를 대체하지 않는다.
4. client의 typecheck/test/build와 영향 있는 계약 검사를 실행한다. 보안/데이터 손실/상태 충돌을 방어하는 회귀 테스트는 유지하되 코드 문자열이나 내부 연결만 검사하는 테스트를 늘리지 않는다.
5. 커밋 전 `pnpm guard:tokens`, `pnpm guard:align`, `pnpm guard:hierarchy`, `pnpm --filter @ccc/web run test`를 실행한다. 화면 변경 때 `pnpm design:align`, `pnpm design:hierarchy`도 실행하고 기준을 완화하지 않는다. web 삭제 후 검사 대체는 삭제 PR에서 명시적으로 연결한다.
6. 관문 통과 뒤 격리된 읽기 전용 디자인 검수를 받고 자기 소유 파일의 수정을 반영한다. 소유 밖 지적은 해당 레인으로 돌려보낸다.
7. 테스트 서버는 Hub로 관리하고 이 세션이 띄운 서버만 끝나면 끈다. 기존 디자인 시안 서버 3106과 다른 세션이 쓰는 포트는 건드리지 않는다. 제공된 API 8790/web 3011은 기존 개발 smoke용이며 제품 인증 증거로 바꾸어 부르지 않는다.

### 최종 완료 조건

- 기존 route 30개의 기능과 처리방향에 누락이 없고, D86/D87/D88 및 리포트/업로드의 신규 요구도 해당 계약으로 검증됐다.
- Cloud/Office/Single에서 설치 확인과 실제 인증을 거친 기능 흐름이 검증됐다. AI Off/모드 비지원 경로는 정상 계약으로 별도 입증한다.
- 공용 부품/CSS/토큰 사본, Next shim, 가짜 API 성공, no-write 제품 저장, 토큰/PII 브라우저 영속 저장이 없다.
- old web 자산 참조와 모든 caller를 옮겼고, 소유자와 합의한 source cutover가 끝났다. 운영 배포는 별도 승인 여부를 정확히 보고한다.
- backend/디자인/설치 선행이 하나라도 필요한 기능을 막고 있으면 전체 완료가 아니라 미완 경로와 소유자를 보고한다. 최종 목표 자체를 축소하지 않는다.

## 9. P0 기존 30개 route 수용 표

M은 fetched `origin/main@4352d32`, C는 원본 후보 `origin/feat/settings-backend@71778f3`다. `W/`는 `apps/web/app/`, `C/`는 후보의 `apps/client/src/business/`를 뜻한다. `M 이전`은 main의 동작/검증/부품을 재사용해 client에 연결한다는 뜻이며 Next 파일을 그대로 복사한다는 뜻이 아니다. `C 재사용`도 미통합 원본을 무조건 적용하라는 뜻이 아니다.

**기계적 대조:** M과 C 모두 `page.tsx` 30개, route inventory 30개이며 inventory는 같다. Next page 본문은 25개가 같고 5개가 다르다. 같은 page라도 공통 `api.ts`, `actions.ts`, layout과 HTTP/core의 계약은 달라질 수 있다. 표는 page/import·API 함수·후보 module/HTTP dispatch를 함께 읽은 정적 인벤토리이고 실행 검증이 아니다.

**공통 적용:** 모든 업무 route의 제품 진입은 BE1 통합과 F의 Router/transport가 필요하다. 후보 client에는 `/login`, `/settings`만 분기돼 있고 다른 주소는 STT 시험이므로 업무 route를 추가해야 한다. `F`는 FRONTEND, `O`는 총괄, `BE1~BE6`과 `DES1~DES2`의 정확한 선행/소유자는 §5다. 미존재 화면이 주 담당 F여도 필요한 데이터/공용 표현은 별도 차단으로 표시한다.

| 기존 route와 정확한 원본 파일 | M의 실제 소비/행동 | C의 재사용/차이 | 분류와 단계 | 작성자와 남은 조건 |
|---|---|---|---|---|
| `/`<br>`W/page.tsx` | GET /me → lastProgramType로 기본 사업 이동 | 같은 Next root. C decodeIdentity는 lastProgramType을 버리고 로그인 뒤 settings/account로 보냄 (Next page 동일) | M 이전 + F 신규, P2 | F Router 목적지/사업 선택, BE1 인증·기관 준비, DES1 셸 |
| `/admin`<br>`W/admin/page.tsx` | GET /organization/profile + /users, 관리자 홈 | C InstitutionModule + AccountsModule을 settings로 통합 가능 (Next page 동일) | C 재사용 + F 연결, P7 | F /admin 목적지 정리, BE2 profile/accounts 통합, DES1 |
| `/admin/ai-provider`<br>`W/admin/ai-provider/page.tsx` | GET /ai/provider/status + /capabilities, POST /ai/provider/activate-runtime | C ai/speech는 capability 읽기만. 후보 Next 페이지에는 main STT 카드 없음 (Next page 상이) | M 유지 + C 일부 재사용, P7 | F 실제 상태 소비; BE6 key/activation 소유. main PR #319 역행 금지, DES1 |
| `/admin/assign`<br>`W/admin/assign/page.tsx` | 후보/사용자/배정 조회, POST /support-cases/:id/assignees | C AccountsApi/AccountsModule에 배정·강제 이관 연결 (Next page 동일) | C 재사용 + F 연결, P7 | BE2 통합; 실무자 발 요청/관리자 승인과는 다른 동작(BE5), DES1 |
| `/admin/invite`<br>`W/admin/invite/page.tsx` | POST /users, POST /invites/counselor의 기존 등록·초대 | C AccountsModule 끝은 인증 초대 미연결 안내. 새 초대 UI/SDK provision 없음 (Next page 동일) | F 신규 + B 차단, P7 | BE5 이메일 1회 Auth 초대·역할 동봉, DES2 새 표현. 익명 초대 이식 금지 |
| `/admin/users`<br>`W/admin/users/page.tsx` | GET /users + /users/:id/assignments | C AccountsApi.directory/updateRoles/deactivate + AccountsModule (Next page 동일) | C 재사용 + F 연결, P7 | BE2 accounts/roles/assignments 통합, DES1 |
| `/admin/users/:id`<br>`W/admin/users/[id]/page.tsx` | 사용자 상세와 배정 읽기 | C accounts 화면의 selectedId는 메모리 상태. 직접 URL 선택 미구현 (Next page 동일) | C 재사용 + F 신규, P7 | F deep-link와 선택 초기화, BE2, DES1 |
| `/join/participant/:token`<br>`W/join/participant/[token]/page.tsx` | GET /invites/participant/:token + POST /signup/participant | Next 동일. C business에는 공개 join 진입/transport 없음 (Next page 동일) | F 신규 + B 차단, P8 | BE5 /public/join/exchange·complete 및 전달함, DES2. 옛 token path는 폐기 |
| `/join/worker/:token`<br>`W/join/worker/[token]/page.tsx` | GET /invites/worker/:token + POST /invites/worker | Next 동일. 이메일 Auth 초대 provision/fragment 흐름 없음 (Next page 동일) | F 신규 + B 차단, P8 | BE5 Auth user/nonce/역할, DES2. Office/Single 지원 경계 필요 |
| `/kit`<br>`W/kit/page.tsx` | 기존 부품 하니스, 자체 업무 API 없음(공통 셸 별도) | C wire/harness 변경은 있으나 Vite kit route 없음 (Next page 동일) | M 유지 + D 인계, P9 | DESIGN이 기존 harness 보존/공개; F client 소비. 이번 wave guard 수정 금지 |
| `/onboarding`<br>`W/onboarding/page.tsx` | GET /me,/organization/profile; POST /organization/onboarding 두 이름 | Next 같음. C core onboarding은 첫 실제 program을 미확인으로 만듦; C InstitutionModule은 PATCH 이름 편집뿐 (Next page 동일) | M/C 재사용 + F 신규, P7-초기 | F 첫 로그인→기관/첫 사업→확인 연결을 P3 앞 배치. BE2 초기 상태, BE5 문안 6영역, DES2 |
| `/participants`<br>`W/participants/page.tsx` | GET /participants; 검색/상태 필터, main 만료 preview 복구 | C Next 목록은 main 복구 이전 버전. C에도 목록 이메일/사업명 DTO 없음 (Next page 상이) | M 이전 + F 신규 + B/D 차단, P3 | BE3 D88 목록 응답, DES2 목록 부품. main 복구 회귀 금지 |
| `/participants/invite`<br>`W/participants/invite/page.tsx` | 기존 사업 유형 기반 초대 발급/QR | C Next에 getProgramOptions/선택 programId + POST /invites/participant 연결 (Next page 상이) | C 로직 재사용 + F 신규, P8 | BE2 programId, BE5 fragment/1회 요청, DES2. C Next 화면 직접 적용은 DESIGN |
| `/participants/new`<br>`W/participants/new/page.tsx` | GET /me, POST /participants(programType), RegisterForm | C Next는 program-options/선택 programId 및 admission 오류 추가. Vite 등록 화면 없음 (Next page 상이) | C 로직 재사용 + F 신규, P3 | BE2 등록 DTO/사업 확인·staff, BE5 동의, DES2 등록 부품. candidate 전체 page 복사 금지 |
| `/participants/:beneficiaryId`<br>`W/participants/[beneficiaryId]/page.tsx` | GET /participants/:id/hub,/goal-tree; PUT /support-cases/:id/consent | Next 동일. C hub도 birthDate/기록 집계 추가 없음, authorized와 동의 metadata 혼재 유지 (Next page 동일) | M 이전 + F 신규 + B/D 차단, P3 | BE3 제한 hub/D88 7정보, BE5 요청형 배정, DES2 HERO/탭 |
| `/participants/:beneficiaryId/edit`<br>`W/participants/[beneficiaryId]/edit/page.tsx` | GET/PUT /participants/:id/basic-info | Next 동일. Vite 기본정보 화면 없음 (Next page 동일) | M 이전 + F 신규, P3 | BE1 통합된 권한/DTO, BE5 최종 동의, DES2 form/HERO |
| `/participants/:beneficiaryId/programs/:supportCaseId/briefing`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/briefing/page.tsx` | GET 해당 briefing; PUT overall-goal/discrepancy resolution, 액션·근거 | Next 동일. Vite briefing 없음; C memory/admission 변경만 존재 (Next page 동일) | M 이전 + F 신규, P4→P5 | BE1 실제 API, BE4 E2-8 목표, DES2. E2-4b에서 기존 15초 페이지 완료 |
| `/participants/:beneficiaryId/programs/:supportCaseId/close`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/close/page.tsx` | GET closure,briefing,goal-tree; POST /support-cases/:id/close | Next 동일. Vite 종결 없음 (Next page 동일) | M 이전 + F 신규, P5 | BE4 목표/종결 계약, BE1, DES2 |
| `/participants/:beneficiaryId/programs/:supportCaseId/records`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/records/page.tsx` | GET /support-cases/:id/records?official=true,/participants/:id/support-cases | Next 동일. C exports는 JSON 내보내기이지 기록 조회 화면 아님 (Next page 동일) | M 이전 + F 신규, P5 | BE1; F official query 허용(후보 transport는 거부), DES2 기록/출처 |
| `/participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/records/[sessionId]/review/page.tsx` | GET ai/기록, POST ai generate/draft review 및 근거 액션 | Next 동일. C capability ai 화면은 이 검토 화면이 아님 (Next page 동일) | M 이전 + F 신규 + B 차단, P5 | BE6 AI/원음/동의 활성 선행, BE4 E2-8, DES2. Off 성공 꾸미지 않음 |
| `/participants/:beneficiaryId/programs/:supportCaseId/records/intake`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/page.tsx` | GET/POST/PUT /support-cases/:id/records/intake + goals/전체목표 | Next 동일. Vite 인테이크/복구 없음 (Next page 동일) | M 이전 + F 신규, P5 | BE4 초안/목표·일정, BE5 동의, DES2 인테이크 부품 |
| `/participants/:beneficiaryId/programs/:supportCaseId/records/new`<br>`W/participants/[beneficiaryId]/programs/[supportCaseId]/records/new/page.tsx` | 기록 context/목표, POST records, submissionId·expectedScheduleVersion | C Next recovery에 program_admission_required 문구만 추가, Vite 기록지 없음 (Next page 상이) | M/C 로직 재사용 + F 신규, P5 | BE4 저장/복구 범위, BE2 admission 의미, DES2 RecordOnepage 공개. shared ApiErrorCode만 단독 이식 금지 |
| `/preview`<br>`W/preview/page.tsx` | 코드 입력→POST /preview/unlock(Next handler) | Next 동일. C client login은 Supabase이며 preview cookie 대체 아님 (Next page 동일) | M 유지/은퇴 조정, P9 | O 배포/공개 접점 소유; F 제품 인증으로 복사하지 않음 |
| `/preview/admin`<br>`W/preview/admin/page.tsx` | 관리자 코드 입력→POST /preview/unlock | Next 동일. C /settings URL은 admin 역할을 만들지 않음 (Next page 동일) | M 유지/은퇴 조정, P9 | O 배포/공개 접점 소유; D 기존 화면 |
| `/programs/:programType/schedule`<br>`W/programs/[programType]/schedule/page.tsx` | GET /schedules/today/upcoming/month; PUT /me/last-program, view/date URL | Next 동일. C business에는 일정 UI 없음. all_day/display_color도 없음 (Next page 동일) | M 이전 + F 신규 + B/D 차단, P4 | BE3 D88 일정 데이터, BE2 programId 대 programType, DES2 월간 격자; F query 허용 확장 |
| `/programs/:programType/schedule/all`<br>`W/programs/[programType]/schedule/all/page.tsx` | ?month 유지 후 canonical 월간 route로 redirect | Next 동일. C router에 canonicalizer 없음 (Next page 동일) | M 규칙 재사용 + F 신규, P4 | F React Router redirect, DES2 보기 계약 |
| `/schedules/new`<br>`W/schedules/new/page.tsx` | GET candidates/goals/briefing; POST /schedules | Next 동일. Vite 후보/Steps/일시/목표 UI 없음 (Next page 동일) | M 이전 + F 신규 + B/D 차단, P4 | BE3 후보 추가 필드·종일, BE4 선택 schedule/목표, DES2 Steps |
| `/schedules/:scheduleId/plan`<br>`W/schedules/[scheduleId]/plan/page.tsx` | GET/PUT /schedules/:id/plan + goals, expectedVersion | Next 동일. Vite 편집기 없음 (Next page 동일) | M 이전 + F 신규, P4 | BE4 잠금/복구, DES2 폼; 시작 시각 잠금 유지 |
| `/settings`<br>`W/settings/page.tsx` | GET /me,/assignment-requests,/users,memory; 수락·memory 저장 | C BusinessPage 19목적지 + 8 실제 API 묶음 + 9 capability 읽기 + 2 안내 (Next page 동일) | C 재사용 + F Router 연결, P7 | BE1/BE2 미통합 API, DES1 wire/CSS. 기관 초기 설정/동의/초대 완료와 구분 |
| `/welcome`<br>`W/welcome/page.tsx` | 공개 안내, 업무 API 없음 | Next 동일. candidate apps/site와 public entry 없음 (Next page 동일) | M 내용 재사용 + F/O 신규, P9 | E2-6 apps/site 소유는 O가 배정, DES2. 이번 wave 파일 생성 없음 |

`POST /preview/unlock`은 page 30개 밖의 기존 Next Route Handler다. M의 만료 코드 복구와 함께 보존하며 제품 Cloud 로그인으로 이름만 바꾸지 않는다. public/site 전환은 O가 별도 슬롯을 배정한다. D86/D87/D88와 리포트 등 30개 밖의 요구는 §11.3에서 빠짐없이 분류한다.

## 10. 승인과 후속 관리

Q는 전체 베타 완성과 지정된 검증 커밋의 로컬 통합, `@supabase/supabase-js@2.116.0` 추가를 승인했다. Main은 BACKEND의 lock 동결 뒤 FRONTEND에 승인된 importer/SDK 그래프의 lock 갱신, frozen 설치, 독립 P1 검증과 로컬 checkpoint 슬롯을 넘겼다. 원본 브랜치/기존 버전을 보존하고 push/origin-main merge/배포는 하지 않는다. D89를 수령했지만 shared manifest/runtime 수정, 실제 인증/인프라 변경과 사업자 활성화는 별도 관문이다.

진행 상태는 커밋과 기존 실행 티켓에 남긴다. 새 STATUS 문서나 별도 상시 진행 장부는 만들지 않는다. 미배정된 선행 티켓과 새 도메인 판단만 P0에서 정확히 연결하고, 환경/문서/코드로 답할 수 있는 질문을 Q에게 다시 넘기지 않는다.

## 11. P0 정적 인벤토리 기록과 P1 소비 요건

### 11.1 이번 wave의 수용 판정

이 세션은 FRONTEND만 맡는다. 총괄 계획은 `/Users/seongqkim/DEVELOPER/PROJECTS/CCC-new/.worktrees/beta-0.9-orchestrator/docs/superpowers/plans/2026-09-09-beta-0.9-orchestration.md`이며 2026-09-09 Q 승인 아래 실행한다. 총괄은 Herdr로 이 결과를 점검한다. 이번 수정은 이 계획 한 파일뿐이고 원본 후보를 적용하지 않았다.

| P0 수용 항목 | 결과 | 근거/남은 경계 |
|---|---|---|
| 기존 379줄 계획 보존 후 분기 | 완료 | 원본 50,226 bytes, SHA-256 `01ee219cd75af77e0262287c6985cfefbdca0841b1eb81ad3d29d94bdd500834`. 별도 보존본 `local://frontend-foundation-pre-beta-p0-original.md`; branch switch 직후 동일 hash 확인 |
| fetched main 및 후보 pin | 완료 | M=`4352d32168b2fd9514ee67075f3a53f2b4f246c0`, C=`71778f3ab8fffd938e9565fdfd7b2757a303ac07`. 새 local/remote `frontend/beta-0.9-client` 이름이 비어 있음을 확인 후 M에서 분기 |
| 30 route 양쪽 비교 | 정적 조사 완료 | M/C 각각 30 page, 같은 inventory. page 25동일/5상이. §9에 원본 경로/동작/후보 재사용/소유/차단 전수 연결 |
| Main의 독립 route 집합 대조 | 정적 coverage 확인 | Main이 M/C와 표의 일치를 독립 확인: 30/30, missing=0, extra=0. E2-1 runtime 완료를 뜻하지 않음 |
| D86/D87/D88/리포트 추가 요구 | 정적 조사 완료 | §11.3. 후보의 구현, 안내만 있는 메뉴, 미구현 기능을 분리 |
| P1 재사용 파일과 소비 요건 | 작성 완료 | §11.2/§11.4. 코드/DTO 계약만 확인했으며 실제 인증/HTTP/브라우저 검증은 미실행 |
| 레인 작업 수락/통합 완료 | 대기 | BACKEND/ DESIGN의 최종 통합 commit, 소유 슬롯과 검증 증거를 O가 회수. F가 상대 worktree를 수정하지 않음 |
| P1/전체 앱 완료 | 아님 | 이번 산출은 P0 인벤토리다. 설치/runtime 제공, source 통합과 실제 기능 검증이 남음 |

보존본은 이 세션의 local artifact다. 총괄이 같은 머신에서 읽을 절대 경로는 `/Users/seongqkim/.omp/agent/sessions/-DEVELOPER-PROJECTS-CCC-new-.worktrees-frontend/2026-09-09T07-50-49-091Z_01a08525-e803-7720-99cc-8b890efefaf3/local/frontend-foundation-pre-beta-p0-original.md`다. 원본 plan은 새 브랜치에서도 그대로 보존된 것을 확인한 뒤 이 P0 결과로 갱신했다.

### 11.2 후보를 재구현하지 않고 가져올 단위

아래 경로는 모두 **C commit의 파일**이다. 현재 working tree의 코드라고 말하지 않는다. `artifacts/settings-backend-contract.txt`는 앞선 조사 이력이므로 그 안의 “없음”과 현재 C 코드가 다르면 코드가 우선한다.

| 재사용 단위 | 정확한 후보 파일/심볼 | 지금 가진 동작 | 나중에 F가 할 일 / 다른 소유자 |
|---|---|---|---|
| 설치 검증 | `apps/client/src/business/installation.ts`: `loadInstallation`, `assertInstallationCurrent` (38-82) | build-time public-key map, manifest→bootstrap exact match, origin 검사, expiry, WeakSet으로 검증 객체 관리 | 파일 재사용. `minSequence`, expected installation, revoked keys는 호출에 전달하지 않고 Office/Single은 명시 거부하므로 BE1 최종 신뢰/Local 공급에 맞춰 보완 |
| Cloud 인증/MFA | `business/auth.ts`: `CloudAuth` (22-316), `auth-view.tsx`: `AuthView` | Supabase SDK memory-only, URL 세션 검출 금지, TOTP 등록/확인, idle 30분, revision 교체, logout 폐기 요청/실패 구분 | 재작성 금지. 기관 코드 앞단, Local 모드, 역할 대기 진입과 공용 Router에 연결. `@supabase/supabase-js@2.116.0` 후보 의존성은 O의 승인/공유 슬롯 전까지 설치/추가하지 않음 |
| 업무 통신 | `business/transport.ts`: `BusinessTransport` | signed apiBase, Bearer, omit/no-store/redirect:error, abort, token revision, full capability와 설치 ID 검사, logout 204 | 재사용 후 필요한 path/query/method만 계약대로 확대. 아래 §11.4의 한계를 보존/보완 |
| 오류/편집 상태 | `business/errors.ts`, `editing.ts`, `settings-modules.tsx`의 편집 흐름 | 안전 오류만 표시, 409/unknown 쓰기 후 draft 유지 및 최신 조회 요구 | 업무 오류를 여기에 연결. old web ApiErrorCode 복사본 21개라는 계획 폐기. 원문 오류/토큰을 저장하지 않음 |
| 개인/기관/기억 | `business/api.ts`: `SettingsApi`; `settings-modules.tsx`: `AccountModule`, `InstitutionModule`, `MemoryModule` | `/me`, 받은 배정 요청 수락, 기관 이름 PATCH CAS, memory GET/PUT | 3개 화면 다시 만들지 않음. 기관 이름 PATCH를 최초 onboarding POST 대신 호출하지 않음. 일반 실무자 셸에 admin 전용 `getProfile()`을 오용하지 않음 |
| 사업 도입 확인 | `business/programs.tsx`: `ProgramsApi`, `ProgramsModule` | 사업/직원 목록, 생성/수정/상태, CAS, 문안/설치 hash evidence와 확인, 재조회 | 최초 기관 설정 직후 이 module을 연결해 P3 전에 진짜 사업 확인. contract export/migration/API 통합은 BE2 |
| 계정·역할/배정 | `business/accounts.tsx`: `AccountsApi`, `AccountsModule`; `case-options.ts` | 사용자 pagination, 역할 저장, 비활성화, 배정 조회/요청/이관; 서버 permissions 사용 | deep-link와 Router만 보완. 이메일 초대/MFA reset/팀 편집/실무자 발 요청은 여기 구현된 것처럼 말하지 않음 |
| 보존/감사 | `business/retention-policy.tsx`: `RetentionPolicyApi`, `RetentionPolicyModule`; `audit-retention-modules.tsx`: `AuditModule`, `RetentionModule` | 정책 version CAS, 보존/파기 검토, 제한된 audit pagination | 동일 구현 재사용; 초기 설정 연결과 허용 역할 정리. `purge_disabled`는 실제 파기 완료가 아님 |
| 공식 기록 내보내기 | `business/exports.tsx`: `ExportsApi`, `ExportsModule` | 대상 조회, 공식 기록 JSON export, 이력, blob 다운로드 | 재사용. 전체 상담 리포트 또는 backup/restore로 대체하지 않음 |
| 설정 연결/설명 | `business/business-page.tsx`, `guide.tsx`, `capability-settings.tsx` | 19메뉴, memory session provider, 역할별 module. capability 9개는 읽기/제한 안내, consent/guide는 문서 | 업무 로직을 보존하며 React Router/공용 셸에 연결. `SettingsLink`의 pushState/popstate와 main의 두 경로 hard switch를 전체 Router로 전환. 안내 module을 작업 완료로 세지 않음 |
| 공유 표현 의존 | `business/business.css`; `apps/web/app/components/wire/client-surface.ts`, `wire-section.tsx`, `wire-styles.ts` | 새 class와 WireItem/Icon/WireRadioGroup 공개 변경 | DESIGN에 정확한 diff를 넘겨 반영을 받는다. F가 CSS와 barrel/guard를 직접 적용하지 않음 |

**C의 19개 목적지 분류:** 실제 API가 연결된 묶음은 account/institution/programs/accounts/retention/exports/audit/memory 8개다. speech/ai/agent/database/storage/backup/security/system/updates 9개는 capability 읽기와 미구현 한계 안내다. consent/guide 2개는 동의 설명/사용 안내다. 메뉴가 보이는 것은 해당 엔진이나 정책 저장이 구현됐다는 뜻이 아니다.

### 11.3 D86/D87/D88와 리포트 요구별 수용

| 요구 | M에 있는 것 | C에 있는 것 | 재사용/신규 및 차단·소유 |
|---|---|---|---|
| D86 기관 코드→기관 로그인, `/k/<코드>` | 승인 ADR만, Cloud client 없음 | signed 단일 기관 Cloud 로그인/MFA 있음, 코드 조회/`/k` 없음 | C auth 재사용 + F 코드 진입 신규, BE1 신뢰 매핑/상태 계약·DES2 |
| D86 첫 기관 초기 설정 | Next 두 이름 폼과 POST 있음 | 동일 Next page. core `completeOrganizationOnboarding`가 최초 실제 program을 미확인 상태로 생성 | backend 메서드 재사용, F 초기 흐름 신규. `InstitutionModule`은 편집 전용. BE2 초기 상태/첫 program ID 식별, DES2 |
| D86 이메일 1회 직원 초대/역할 대기 | 익명/Access 계열 기존 초대 | account 관리와 “역할 대기” 읽기는 있음. Auth 초대는 `accounts.tsx:445-447`에서 미연결을 명시 | F 기존 accounts 재사용; BE5 Auth provisioning/초대/대기권한, F 진입 guard 신규 |
| D86 당사자 요청 링크/Local 전달함 | token-path GET/POST | programId 바인딩 초대는 추가, fragment exchange/nonce complete 없음 | C program 선택 로직 재사용; F public transport/폼/URL 제거 신규 + BE5. 채널 발송 새로 만들지 않음 |
| D86 비담당 축소 hub | 기존 hub와 authorized 값 | 같은 hub serializer에 consent metadata도 유지 | M 표시부 재사용 + F 축소화면 신규; BE3 응답 최소화, DES2. UI만 숨겨 해결 금지 |
| D86 실무자 발 배정 요청 | 관리자 발 배정/실무자 수락 | C도 관리자 발 요청/강제이관과 수락 UI | 해당 부분 재사용. 반대 방향 요청/승인/거절은 BE5+F 신규 |
| D86 역할 합 관리자/팀/보존/보유기간 | 기존 admin/settings 및 보존 core | roles/accounts, 보존정책/검토/audit/exports/memory UI/API | C 재사용. 팀 생성/감독 편집, MFA reset, 기관 동의 문안은 BE5+F 잔여 |
| D87 사업 registry/도입 확인/재확인 | `programs` API 없음 | `programs`, staff, confirmation evidence, admission state, policy row, program-options/등록 연결 있음 | C 재사용, BE2 migration/handler/core 통합, DES1 표현. “서버 잠금 미구현” 전면 재작성 금지: 후보에는 구현 존재 |
| D87 설치 변경 영향·import·AI 경계 | 미완 | `requireProgramAdmission`에 registration/audio/llm과 memory/Agent 관련 호출 존재. 설치 변경 UI는 읽기 전용, import 엔진 없음 | BE2/BE6가 operation별 차단·재확인 영향 계약을 제공. 화면 recovery 문구 추가만으로 기록/기존 case의 전건 차단을 증명하지 않음 |
| D88 ①월간 격자·⑥셀 글자 | M에 D88 ADR/시안 있음, 실제 일정은 기존 보기 | 해당 D88 시안/제품 코드 없음, 후보 client에도 일정 없음 | M 승인 부품을 DESIGN이 제공, F 기간/일정 소비 신규, BE3 종일 데이터. FullCalendar 도입 없음 |
| D88 ②종일/표시 색 | 결정만. HTTP 입력/응답에 필드 없음 | 해당 필드/엔드포인트 변경 없음 | BE3 저장/DTO 신규, F 연결, DES2. 자정을 종일로 추정 금지 |
| D88 ③목록 이메일·사업명 | 목록 serializer는 name/phone/programCount/newSignup | 같은 serializer, 기관 `programs` 목록만 새로 존재 | BE3 당사자 목록 DTO/감사 확장, F 목록 소비 신규. 허브 N회 호출로 대체 금지 |
| D88 ④간격·⑤계단 유지 | M의 승인 규칙/시안 | C `business.css`는 별도 설정 표현 | DES1/DES2 규칙 준수 공용 자산 수령. F 새 CSS/토큰 추가 없음 |
| D88 ⑦지나온 Steps | 승인 결정, 기존 Steps | C 설정에는 해당 업무 위저드 없음 | DESIGN Steps 공개/되돌아가기, F 일정 위저드 연결 신규 |
| D88 ⑧HERO 일곱 항목 | hub 응답은 birthDate/회차 집계 없음 | 같은 응답, 신규 값 없음 | BE3 권한/감사/응답, DESIGN HERO 공개, F 선택 case 연결 |
| D88 ⑨안내·⑩모바일 행동·⑫리포트 번호 | M의 승인 규칙과 시안 | C 업무 리포트/당사자 화면 없음 | DES2 부품/표현, F 조립 신규. 안내 크기나 번호 로직 별도 복제 금지 |
| D88 ⑪calendar-plus/record 아이콘 | M `shell-icons.tsx`에 있음 | 후보 기준은 M의 D88 이전 | M 구현 재사용. 필요한 공개 export는 DESIGN; 후보 전체 트리로 main 아이콘 되돌리지 않음 |
| 전체 상담 리포트 | 합성 시안/근거 요구, 실제 리포트 route/DTO 없음 | JSON export와 memory는 있지만 전체리포트 DTO/UI 없음 | F 새 소비/탭 + BE6 공식 원문/최초 목표/상태 계약 + DES2. export를 리포트라고 표시 금지 |
| 상담 입구·기록·인테이크·목표·브리핑 | 기존 업무 화면과 API/상태 | Next 대부분 동일, record recovery에 admission 코드만 추가; client는 없음 | M 로직/부품 이전 + F Router/API/복구 신규, BE4/DES2. 경쟁 기록지 구현 아님 |
| 원음/AI/동의·후속 복원 | M의 0051~0053/0007~0009 schema와 원음 경로 | C audio-supabase adapter 있지만 Cloud runtime `audioStore:null`; capability/backup 메뉴는 읽기 안내 | BE6 통합/검증 전 업로드 성공 경로 없음. F 기존 업로드 인계 유지, P10 동의/장문/복원 전체 완료는 별도 |
| PWA/공개 site/old web 은퇴 | client는 정적 STT entry, CSS는 web layout 의존 | 두 route switch/inline style 유지, SW/React Router/apps/site 없음 | F Router·정적 CSS 자산 소비·PWA 신규, DESIGN 공유 자산 독립, O E2-6/E2-7 슬롯. source 삭제/배포 이번 wave 금지 |

### 11.4 P1 소비 요건: BACKEND/DESIGN이 넘겨야 하는 정확한 계약

아래는 후보의 실제 shape와 F의 통합 요구다. 새 endpoint를 임의로 선언한 것이 아니며, 통합 뒤 달라지는 부분은 BACKEND의 전달표가 확정한다.

| 소비 항목 | 후보의 현재 request/response/오류 | F가 유지/보완할 것 | 선행 소유 |
|---|---|---|---|
| 설치→인증 | `loadInstallation(clientOrigin, publicKeyConfig, fetcher)`; `VITE_CCC_INSTALL_SIGNING_KEYS` public map; fixed manifest/ bootstrap 경로. `trust_missing`, `installation_invalid/expired`, `local_*_unsupported` | 신뢰키를 미검증 bootstrap에서 읽지 않음. 후보는 `publicKeys, now`만 verifier에 넘김: revoked-key/sequence-floor/expected-installation 및 기관코드 mapping을 받기 전 그 보호까지 완료로 보고하지 않음 | BE1 설치/신뢰 계약, O 빌드 public config 슬롯 |
| dependency/export | C `@ccc/contracts` + `@supabase/supabase-js@2.116.0`, program-admission 공개 subpath, M에 없는 wire exports | candidate 파일 재사용과 의존성 설치는 별개. 이번 wave 설치/추가 없음. O가 승인/작성자를 정하고 DESIGN이 wire를 넘긴 뒤 F가 적용 | O 공유 manifest/lock/exports, DESIGN |
| capability gate | `initialize()`가 GET `/capabilities`, exact `CapabilityManifest`, signed approvedSttEngineIds, `X-CCC-Installation-Id`, mode 검사 | STT subset으로 대체하지 않음. 503을 기본 off 객체로 바꾸지 않음. init 성공 token과 달라지면 재검증 | BE1 handler/runtime/headers |
| identity | GET `/me`: id,orgId,email(nullable),role,active,name(nullable),lastProgramType(nullable),roles. `decodeIdentity`는 active=true와 human roles 배열을 읽고 legacy role/lastProgramType은 버림 | Router에는 lastProgramType/기관 초기 상태/역할 대기 필요. backend 전달표로 첫 program ID·준비 판정을 받아야 하며 orgName null만으로 전체 초기화 판정을 만들지 않음 | BE1/BE2 응답 의미, F decoder/진입 |
| logout/MFA | POST `/auth/logout` `{}`→204; missing human session 403, store failure 503. CloudAuth revision/abort, SDK local signout, TOTP lifecycle | 서버 폐기 실패와 로컬 clear를 구별. session/token을 snapshot/URL/storage에 싣지 않음. 재로그인/refresh에 이전 데이터 미노출 | BE1 세션 회수/aal2/JWKS |
| 기관 조회/편집/초기화 | GET/PATCH `/organization/profile`; PATCH `{orgName,expectedOrgName}`→`{orgId,orgName,programDisplayName}`. POST `/organization/onboarding` `{orgName,programDisplayName}`는 최초 program을 만들되 미확인으로 둠 | `SettingsApi.getProfile()`은 admin-only여서 일반 업무 셸에 그대로 쓰지 않음. 초기 POST와 편집 PATCH를 구분. C에는 초기 POST를 호출하는 Vite UI가 없어 FRONTEND가 연결 | BE2 CAS/초기 상태; DES2 폼 |
| 사업 확인 | GET `/programs`→`{programs,staffOptions,admissionCopy:{version,hash,copy},installation:{deploymentMode,sttMode,llmMode,policyVersion,configHash}}`; POST/PATCH→`{program}` | C `ProgramsApi/ProgramsModule` 재사용. confirmation의 copyVersion/copyHash/installationPolicyVersion/installationConfigHash는 서버 readback에서 얻고 변경 시 재확인. stale version→409. `ready`는 정책 확인이지 STT/AI 활성 아님 | BE2 정책/테이블/문안 export |
| 등록·초대 대상 | GET `/program-options`→`{programs:[{id,displayName,programType,admissionState}]}`. 등록/새 case/초대는 `programId` 필요 | M `programType` 입력을 client에서 그대로 보내지 않음. programId/supportCaseId/programType 구별. C Next 선택/오류 로직 재사용하되 client endpoint decoder를 연결 | BE2 전체 caller/기존 데이터 mapping |
| 개인·기관 settings | assignment requests/accept, memory `enabled,expectedVersion`, account roles/expectedRoles, retention `expectedVersion,piiPurgeGraceDays`, audit pagination, export/history는 §11.2의 API 메서드가 정본 | 이미 있는 SettingsApi/AccountsApi/RetentionPolicyApi/ExportsApi를 재구현하지 않음. 409와 결과 불명에 입력 보존/최신 조회, 감독 역할 직접 grant 금지 | BE2 통합 권한/미래 runtime 증거 |
| 일반 업무 transport 확대 | C `request`는 GET/PATCH/PUT/POST, JSON body. query 허용은 audit/history/cursor 등 settings뿐. 일반 204는 invalid_response, logout 204만 예외 | 기존 records `?official=true`, schedule `?date/?month`, search `?q`를 지금 함수가 거부한다. 허용할 경로/키만 실제 API 표에 맞춰 확장. 필요한 DELETE/204/body/header는 용도별로 받고 모든 URL/query를 열지 않음. 공개 join/원음은 별도 protocol | F, BE 전달 계약 |
| 오류 사전 | H:401 `actor_authentication_required`,403 `mfa_required`/`forbidden`,409 `program_admission_required`/`conflict`/`purge_disabled`,503 `service_unavailable`. C `httpError`:401→unauthenticated,403/409 선택 코드 유지,400/422→invalid_request,404/기타→unavailable | 업무 기능에서 필요한 not-found/consent/engine/unknown-outcome 처리를 기존 오류 모듈에 추가하되 실제 H 전달표에 없는 코드를 만들지 않음. web RecoveryState와 결합된 수정은 DESIGN 슬롯으로 남김 | F 오류·화면, BACKEND DTO/거부 확정 |
| Cloud CORS/prefix | C runtime은 Supabase가 `/functions/v1`을 제거한 `/<function>` prefix를 받음. headers allow는 authorization/content-type/idempotency-key/x-request-id/x-region, expose는 installation ID | S2의 If-Match/ETag/Max-Age 및 실제 업로드 경로와 차이를 BACKEND가 정리해야 함. F가 서버를 proxy로 우회하거나 CORS wildcard 추가하지 않음 | BE1 runtime/S2 계약 |
| 표현/CSP | C main은 inline `<style>`, BusinessPage는 `business.css`와 새 wire exports에 의존. 단 두 path 외 STT fallback | F는 candidate state/API를 보존하며 React Router로 연결. DESIGN은 CSS/공용 부품 diff를 수령. 정적 CSS 출력으로 S2 CSP 준수, 공용 root/guard 동시 수정 없음 | DES1/DES2, O 빌드 슬롯 |

### 11.5 첫 사용자 여정과 실제 적용 순서

총괄 계획에 따라 **초기 로그인/기관 준비/사업 확인을 P3의 성공 저장보다 먼저** 제공한다. 과거 계획의 “P7을 전부 나중에 구현하고 확인된 seed를 전제”는 이 순서로 대체한다.

1. BACKEND가 C의 서버/계약/새 번호 migration을 M 위에서 선별 통합한다. DESIGN이 C의 wire/export/CSS 중 자기 소유 diff를 받는다. 원본 C는 보존한다.
2. O가 공유 dependency/export 슬롯과 소비 가능한 commit을 알려주면 F는 §11.2의 candidate `business/` 설치/auth/transport/실제 settings 로직을 재사용한다. P0 시점에는 적용하지 않았고, 승인된 현재 선별 적용은 §12에 기록한다.
3. F가 P1/P2에서 Router·signed boot·역할 대기를 연결하고, 최소 기관 초기 설정 POST→첫 program 식별→ProgramsModule 확인을 앞당긴다. 인증/초기 상태/첫 program ID를 추측해 성공 화면을 만들지 않는다.
4. 실 데이터 대신 합성 기관으로 이 **실제 준비 경로**를 확인한 뒤 당사자 등록→일정→인테이크/수기→15초 페이지를 연결한다. 테스트 계정 준비나 fixture가 새 기관 첫 설정 흐름 자체를 대신하지 않는다.
5. P7 나머지 계정/감독/정책, P6 리포트, P8 요청, P9 source cutover와 P10 최종 동의/장문/세모드 통합은 유지한다. 기능 일부가 미지원 안내라는 이유로 해당 작업을 완료로 바꾸지 않는다.

**P0 당시 금지 범위:** 하위 에이전트, 서버, 설치, 테스트/빌드/formatter, 다른 worktree 수정, shared manifests/lock/contracts/backend/wire/CSS/guards/STT trial 변경, push/merge/deploy, 인증서/의존성/사업자 활성화. 이후 승인된 source-edit와 지정 commit 통합 범위는 §10/§12를 따른다.

### 11.6 실행 보고

- 머신: MacBook Apple M4 Pro, `gimseong-gyuui-MacBookPro.local`, arm64.
- cwd: `/Users/seongqkim/DEVELOPER/PROJECTS/CCC-new/.worktrees/frontend`.
- branch: `frontend/beta-0.9-client` (M에서 새로 분기, 후보 미통합).
- 실제 세션 모델: `openai-codex/gpt-6-astra`. Q가 P0 재개 전에 Fable→GPT 전환을 승인했다. 앞선 “이 wave에서 모델 전환 없음” 보고는 잘못됐으며 이 기록으로 정정한다.
- 산출: 이 계획의 §5/§9/§11. 원본 보존 SHA와 경로는 §11.1.
- 실행 증거: Git commit/tree/blob 읽기와 파일 집계/보존 hash. HTTP, 브라우저, 테스트/build는 실행하지 않음.
- 다음 소비 관문: BE1/BE2 통합 결과, DES1 공개 부품/CSS, O의 shared dependency/validation 슬롯. D86/D88/리포트 잔여는 §11.3에서 제외하지 않고 유지.

## 12. P1 기반 source-ready 인계

### 로컬 커밋과 적용 범위

- P0 계획 로컬 commit: `eb745e3`. Q가 P0 재개 전에 승인한 Fable→GPT 전환을 기록에 정정했다. Main의 독립 30/30 route 집합 대조는 정적 coverage이며 E2-1 runtime 완료가 아니다.
- 지정 DESIGN 원본 `e29aa40`을 로컬 `9e245a6`으로 cherry-pick했다. 공개 exports와 `2026-09-09-beta-shared-ui-handoff.md`만 포함하며 충돌은 없었다. 원본 branch/commit을 이동하거나 삭제하지 않았다.
- Main이 실제 `@ccc/web/wire` named imports를 bundle/실행해 `PUBLIC_EXPORT_SMOKE_PASS`를 보고한 증거를 수령했다. FRONTEND는 같은 smoke를 다시 실행하지 않았다. 이 export 증거는 auth/API/runtime 통합 증거가 아니다.
- `.githooks/pre-commit`은 `guard:hierarchy:test`를 자동 실행하므로 이번 승인된 local commit/cherry-pick 명령에만 `-c core.hooksPath=/dev/null`을 사용해 검증을 보류했다. 저장소 config나 hook 파일은 바꾸지 않았고 이후 검사 슬롯에서 관문을 실행해야 한다.
- 후보 전체 commit은 적용하지 않았다. 아래 10개 source/test 파일만 `71778f3` Git blob에서 가져왔으며 byte-for-byte hash가 모두 같다.

### 최소 의존성 경계

| 파일 (`apps/client/src/business/`) | 가져온 이유 | 직접 의존성 |
|---|---|---|
| `installation.ts` | 서명/주소/만료 검증, 검증된 설치 객체 | `errors`, contracts/install-manifest, contracts/runtime |
| `auth.ts` | 기존 memory-only CloudAuth/TOTP/session lifecycle | `installation`, `transport`, `errors`, 지정 Supabase SDK |
| `transport.ts` | 설치 ID/registry/capability를 통과한 Bearer 요청 | `installation`, `errors`, contracts/capabilities, contracts/runtime |
| `errors.ts` | 공급자 원문 없이 안전 code/상태 매핑 | 없음 |
| `editing.ts` | CAS/불명확 쓰기 이후 초안과 재조회 상태 유지 | errors type |
| `api.ts` | 기존 settings 테스트의 실제 추가 source dependency | `transport`, `errors`, contracts/runtime, contracts/counseling-memory |
| `auth.test.ts` | 기존 실제 SDK 기반 합성 Auth/MFA 회귀 | `auth`, `test-support`, 기존 Vitest |
| `boundary.test.ts` | 기존 설치/주소/설치 ID/세션 경계 회귀 | `installation`, `transport`, `test-support`, 기존 Vitest |
| `settings.test.ts` | 기존 identity/DTO/CAS/불명확 쓰기 회귀 | `api`, `editing`, `errors`, `transport`, `test-support`, 기존 Vitest |
| `test-support.ts` | 위 테스트의 기존 합성 서명/응답 helper | `installation`, contracts/install-manifest, contracts/capabilities, contracts/runtime |

상대 import의 누락 파일은 없다. 이번 source 경계에 필요한 contracts subpath 네 개는 현재 main의 공개 export에 이미 있다. program-admission export와 programs/settings UI는 이번 최소 기반 의존성에 없으므로 가져오지 않았다. `auth-view.tsx`, `business-page.tsx`, `business.css`, 전체 settings TSX, Router, UI 마운트와 `stt-trial`은 수정하지 않았다. fake login 화면도 만들지 않았다.

`apps/client/package.json`에는 `@ccc/contracts: workspace:*`, `@supabase/supabase-js: 2.116.0`만 추가했다. 앱 `0.6.1`, React/React DOM `19.2.7`, TypeScript `5.9.3`, Vite `8.1.3`, Vitest `4.1.10`, 기존 scripts/devDependencies는 원래 값 그대로다.

### 소스 편집 시점의 루트/의존성/DTO 차단 (검증 후 상태는 §13)

| 차단 | 관측 사실 | 다음 소유자/행동 |
|---|---|---|
| 루트 lock 슬롯 | root lock의 `apps/client` importer에는 두 dependency가 아직 없다. root package/lock/contracts package의 source-edit 전후 SHA-256이 같다 | BACKEND checkpoint와 O의 슬롯 이전 뒤 importer/lock 갱신. 현재 FRONTEND 수정 없음 |
| 설치 링크 | `apps/client/node_modules/@ccc/contracts/package.json`, `@supabase/supabase-js/package.json`은 fixed-path 존재 검사에서 둘 다 없음 | 슬롯 이전 뒤 설치. 현재 source-ready는 module resolution/컴파일 성공이 아님 |
| 검증 슬롯 | install/build/test/typecheck/formatter/HTTP/브라우저 실행 0회 | O가 검증 슬롯을 지정하면 기존 auth/boundary/settings 테스트와 client typecheck/build, 실제 runtime을 순서대로 검증 |
| BACKEND 통합 | 이번에 지정/적용한 것은 DESIGN commit 하나뿐이다. `/capabilities`, canonical `/me`, `/auth/logout`, Cloud CORS/신뢰 입력의 최종 backend commit은 아직 소비하지 않았다 | O가 지정한 검증 BACKEND commit과 endpoint/거부 DTO 인계 수령 |
| 설치/모드 | 그대로 가져온 설치 로더는 `publicKeys, now`만 verifier에 전달하고 Office/Single을 명시 거부한다. 기관 코드/폐기키/sequence floor/기대 설치 ID 추가 공급은 미완 | BE1 신뢰/Local 계약 수령 후 보완. 현재 검사 생략이나 Cloud 폴백 없음 |
| 첫 기관 준비 DTO | 후보 decodeIdentity는 lastProgramType을 버리고 초기 완료/첫 사업 ID를 제공하지 않는다. profile PATCH는 편집이며 최초 POST와 다르다 | BE2 초기 상태/첫 program 식별 계약과 실제 onboarding 연계. 준비 여부 field를 F가 발명하지 않음 |
| 업무 요청 확대 | 기존 transport는 settings query와 JSON GET/PATCH/PUT/POST 중심이며 일반 204/DELETE/원음/public join protocol을 지원하지 않는다 | 후속 실제 caller/API 계약이 필요할 때 해당 경계만 확장. 현재 임의 query/메서드를 열지 않음 |
| DESIGN 시각 변경 | public export는 수령했지만 WireItem status layout/wire-styles/CSS는 이번 commit에서 제외됐다 | DESIGN 후속 소유 슬롯. F는 공유 CSS나 상태 배치 수정 없음 |

기존 signed installation/registry/installation-ID 검사, capability-before-business gate, memory-only credentials, revision/abort, 안전 오류와 CAS 편집 동작을 그대로 보존했다. code 존재와 기존 테스트 보존만으로 해당 계약이 현재 runtime에서 통과했다고 보고하지 않는다. 동의/사업자/엔진을 활성화하거나 provider를 호출하지 않았다.

**소스 편집 시점 판정:** P1 기반 source-ready였다. 이후 독립 검증과 lock 처리는 §13에 기록한다. 실제 UI 진입이나 P1 전체 완료와 구분하며, 작업 브랜치는 `frontend/beta-0.9-client`만 사용한다.

## 13. 독립 P1 기준선 검증 기록

### D89 수령과 검증 범위

정본은 총괄의 `/Users/seongqkim/DEVELOPER/PROJECTS/CCC-new/.worktrees/beta-0.9-orchestrator/docs/adr/0048-independent-cloud-api-runtime.md`다. 업무 API는 관리자 자격이 없는 독립 제한 실행 환경으로 옮기고 Supabase DB/Auth/private Storage는 유지한다. 최종 signed manifest는 정확한 독립 HTTPS API와 기관 Auth를 결합하며 **API host와 Supabase Auth host의 동일 조건은 최종 계약에서 폐기**된다. 서명/만료/폐기키/sequence/설치 ID/registry/exact CORS/CSP는 유지한다.

이번에는 shared manifest/runtime을 바꾸거나 검증되지 않은 BACKEND 코드를 가져오지 않았다. 기존 `loadInstallation`이 호출하는 shared verifier의 Supabase project-host 결합은 **보존한 이전 기준선**이며 D89 구현 완료가 아니다. 합성 fixture의 API URL도 이 기준선에 맞춰 사용했다. 독립 API 주소 수용, 첫 관리자/직원 초대, 실제 Auth와 제한 runtime 검증은 후속 통합으로 남는다. 이를 우회하거나 신규 readiness 필드로 가리지 않는다.

### lock 변경과 보존 증거

- 원래 lock SHA-256: `6831bdcc4713811da4cdae87c21b4c1e5f2f685ff20de716b1ba408f356b0cad`.
- 최종 lock SHA-256: `bc47d715ed0375ab0be688a2327d1a0dc1043152b93dedb6052e253d64cc8584`.
- importer 변경은 `apps/client` 하나이고, 추가는 `@ccc/contracts:workspace:* → link:../../packages/contracts`와 `@supabase/supabase-js:2.116.0` 두 개뿐이다. 기존 client dependency/devDependency, 다른 importer와 top-level lock 설정은 그대로다.
- 새 packages/snapshots는 8개이며 SDK dependency closure 안에 모두 있다: `@supabase/{auth-js,functions-js,postgrest-js,realtime-js,storage-js,supabase-js}@2.116.0`, `@supabase/phoenix@0.4.5`, `iceberg-js@0.8.1`.
- 기존 packages/snapshots 수정·삭제 0건, 승인된 SDK 그래프 밖 새 node 0건이다. frozen 설치 후에도 lock byte는 바뀌지 않았다. 유지할 unrelated lock drift는 없다.
- root/API/web/contracts/client package 및 pnpm workspace 설정의 검증 전후 hash는 같다. client manifest는 이전 source-edit에서 추가한 승인된 두 의존성을 그대로 사용했다. 기존 app/tool 버전과 scripts 변경 0건이다.
- 10개 P1 source/test 파일의 해시는 검증 전 및 후보 `71778f3`와 같다. owned source 수정 없이 통과했다.

기준 lock/계획은 `local://p1-validation-baseline/`에 보존했다. 실행 결과, 원본 source hash, dependency graph 비교와 절대 경로는 `local://p1-independent-validation-evidence.json`에 있다. 이는 이 세션의 로컬 증거이며 앱 코드나 production config로 사용하지 않는다.

### 실제 실행 결과

실행 환경: Node `v24.18.0`, pnpm `11.5.3`, Bun `1.4.0`. 명령은 순서대로 실행했고 native 작업에는 `RAYON_NUM_THREADS=1`, `UV_THREADPOOL_SIZE=1`, `GOMAXPROCS=1`을 적용했다.

| 명령 | 결과 | 증명하는 범위 |
|---|---|---|
| `pnpm --filter @ccc/client install --lockfile-only --ignore-scripts --network-concurrency=1 --child-concurrency=1` | exit 0 | 승인된 dependency 해석. deprecated subdependency/peer 경고 관측, 기존 dependency 그래프 변경은 없음 |
| `pnpm --filter '@ccc/client...' install --frozen-lockfile --ignore-scripts --network-concurrency=1 --child-concurrency=1` | exit 0, resolution skipped | 해석된 lock에서 설치, lifecycle script 실행 없음 |
| `pnpm --filter @ccc/client run typecheck` | exit 0 | 실제 client TS 소스와 가져온 테스트의 타입 검사 |
| `pnpm --filter @ccc/client run test --maxWorkers=1 --no-file-parallelism` | 6개 파일, 43개 테스트 PASS | auth/boundary/settings 및 기존 client 테스트 포함, 단일 worker |
| `pnpm --filter @ccc/client run build` | exit 0, Vite 8.1.3, 33 modules | 기존 STT mount를 유지한 client production build. 업무 앱 UI 통합을 뜻하지 않음 |
| `bun build --target=node --format=esm local://p1-import-transport-smoke.ts --outfile local://p1-import-transport-smoke.mjs` | exit 0 | 실제 P1 source와 설치된 SDK를 Node용으로 번들 |
| `node local://p1-import-transport-smoke.mjs` | `P1_IMPORT_TRANSPORT_SMOKE_PASS`, 11개 검사 | 실제 installation/auth/transport/API/editor imports와 합성 Request/Response fixture 경로 |

빌드 경고는 숨기지 않았다. 기존 `apps/web` package의 `MODULE_TYPELESS_PACKAGE_JSON` 경고와 main chunk 502.77 kB(gzip 157.87 kB, CLI 반올림 표시)의 500 kB 초과 경고가 있다. CSS, shared package type, bundle 임계값을 변경해 숨기지 않는다.

smoke는 신뢰키 없는 요청 차단, 변조 서명 뒤 bootstrap 미조회, 유효 설치, 실제 CloudAuth가 signed-out 유지, 설치 ID 불일치, registry 오류, 안전한 `/me` decoder, API 경로 이탈 차단, 409 무재시도/안전 오류/초안 유지, logout 204, token 교체와 늦은 응답 폐기를 확인했다. HTTP는 메모리의 실제 Request/Response fixture이며 외부 network, hosted Auth와 provider 호출은 없다. 실제 SDK를 쓰는 합성 TOTP lifecycle은 기존 auth 테스트가 담당했다.

첫 Bun 직접 실행은 실패했다. 원인은 Bun의 `new Request(...,{credentials:'omit'})`가 probe에서 `credentials:'include'`를 돌려준 환경 차이다. 동일 smoke를 Node 대상으로 번들한 뒤 source/assertion 변경 없이 통과했다. 이를 앱 버그 수정이나 Bun에서 통과한 결과로 보고하지 않는다.

재실행할 파일의 절대 경로:

- TS: `/Users/seongqkim/.omp/agent/sessions/-DEVELOPER-PROJECTS-CCC-new-.worktrees-frontend/2026-09-09T07-50-49-091Z_01a08525-e803-7720-99cc-8b890efefaf3/local/p1-import-transport-smoke.ts`
- Node bundle: `/Users/seongqkim/.omp/agent/sessions/-DEVELOPER-PROJECTS-CCC-new-.worktrees-frontend/2026-09-09T07-50-49-091Z_01a08525-e803-7720-99cc-8b890efefaf3/local/p1-import-transport-smoke.mjs`
- 결과 JSON: `/Users/seongqkim/.omp/agent/sessions/-DEVELOPER-PROJECTS-CCC-new-.worktrees-frontend/2026-09-09T07-50-49-091Z_01a08525-e803-7720-99cc-8b890efefaf3/local/p1-independent-validation-evidence.json`

### checkpoint와 남은 관문

로컬 checkpoint 범위는 10개 P1 module/test/helper, `apps/client/package.json`, `pnpm-lock.yaml`, 이 계획뿐이다. 기존 DESIGN/P0 commit은 보존한다. 생성된 dist와 로컬 smoke/evidence는 checkpoint에 넣지 않는다. push/merge/deploy는 하지 않는다.

**ROOT_LOCK_FROZEN:** 승인된 importer/SDK 그래프 갱신과 독립 검증이 끝났다. 위 최종 lock hash를 기준으로 O에 슬롯을 반환하며 다음 인계 전 lock을 더 바꾸지 않는다.

남은 관문은 D89 shared manifest/runtime 계약과 정확한 API/Auth 주소 결합, 실제 제한 실행 환경/실제 인증/MFA, 첫 관리자와 직원 초대, 기관 코드/첫 사업/초기 설정 DTO, Local Office/Single, 전체 업무 Router/UI와 후속 사업/동의/원음/리포트다. 이 검증은 기존 기준선의 독립 P1 통과이며 **D89 또는 P1 전체 완료가 아니다.**

## 14. 검증된 pre-D89 BACKEND와 P1 로컬 결합

### 승인 입력과 보존

- 시작 HEAD는 P1 checkpoint `16f89a05e9e47929eea38b707fb05af97c412f56`이고 tracked/untracked 변경이 없었다. 다른 worktree를 수정하지 않았다.
- 병합 입력은 Main이 수락한 `004a97dcc4757b840c472b9fe46c477f56775a60`이다. 이 Mac의 공유 Git 객체에서 읽었고 GitHub fetch/push나 main 병합은 하지 않았다.
- Main 제공 증거: PostgreSQL 5개 파일/59개 테스트 통과, restricted `ccc_api`의 실제 loopback HTTP admission/cross-org 5개 검사 통과, synthetic JWT/local JWKS, `hostedAuth:false`. source/generation parity hash는 `66884cd3343f8f8623bbf9ad4dc0b74eea9b8e7a8512b0b039c2eba1d7af075d`다. 정리 commit은 임시 smoke 제거/계획 갱신뿐이고 product/migration SQL은 검증된 `e717ad9`와 같다는 Main 판정을 수령했다.
- 위 backend 실행을 FRONTEND에서 다시 하지 않았다. 원본 branch/commit을 이동하거나 삭제하지 않았다. `git merge --no-ff --no-commit 004a97d`로 검증 전에 결합했다.
- client module/test 10개, client package, 현재 STT mount와 DESIGN exports는 병합 전후 바이트가 같다. SDK `2.116.0`과 앱/도구 버전을 유지했다.

### 충돌과 lock

- 제품 및 lock 충돌 **0건**. `pnpm-lock.yaml`은 Git이 자동 병합했고 수동 hunk 선택이나 blanket ours/theirs 처리가 없었다.
- 기존 pinned resolution을 바꿀 이유가 없어 lock regeneration/resolution 명령은 실행하지 않았다. 두 부모의 packages/snapshots 합집합과 결합 lock을 비교했다: 부모 node 누락 0, 부모 밖 node 0, 동일 key의 부모 값 불일치 0, 기존 node 수정 0.
- `apps/client` importer는 FRONTEND 부모와 같고, 그 밖 importer는 BACKEND 부모와 같다. 새로운 backend workspace importer 두 개 `adapters/identity-supabase`, `apps/community-cloud`와 client SDK 그래프가 모두 보존됐다.
- 양쪽 원본 lock은 `local://pre-d89-combined-baseline/frontend-lock.yaml`, `local://pre-d89-combined-baseline/backend-lock.yaml`에 보존했다.
- 최종 combined root lock SHA-256: `51d9e81fe5be8d9ed1671e49cf098ab174db226326c859f6c9747b949f7d694e`. frozen 설치 후 byte 변경 없음.

### 이번 branch에서 실제 실행한 검사

명령은 직렬 실행했고 `RAYON_NUM_THREADS=1`, `UV_THREADPOOL_SIZE=1`, `GOMAXPROCS=1`을 사용했다. Vitest는 worker 1개와 file parallelism off다.

| 명령 | 결과 |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts --network-concurrency=1 --child-concurrency=1` | exit 0, 16 workspace projects, resolution skipped, lock supply-chain policy 577 entries 통과 |
| `pnpm --filter @ccc/client run typecheck` | exit 0 |
| `pnpm --filter @ccc/client run test --maxWorkers=1 --no-file-parallelism` | 6개 파일/43개 테스트 PASS |
| `pnpm --filter @ccc/client run build` | exit 0, Vite 8.1.3, 33 modules |
| `pnpm --filter @ccc/api run typecheck` | exit 0 |

owned client/lock wiring 수정이 필요하지 않았다. 기존 빌드의 `MODULE_TYPELESS_PACKAGE_JSON`와 500 kB 초과 경고는 유지했다(표시값 502.77 kB, gzip 157.87 kB). protected web package/CSS나 경고 기준을 수정해 숨기지 않았다. build는 여전히 현재 STT mount의 빌드이며 새 업무 UI나 hosted 인증 증거가 아니다.

전체 API suite, 추가 PostgreSQL 실행, provider/hosted Auth/자격 조회, D89 manifest/runtime 변경과 하위 에이전트 실행은 없다. 앞선 독립 smoke와 Main의 backend smoke는 각자의 기준선 증거로 보존하고 이번 검사를 실제 hosted 실행으로 확대 해석하지 않는다.

### 인계

로컬 merge checkpoint에는 승인된 backend merge 결과와 자동 병합 lock, 이 frontend 계획의 인계 기록을 포함한다. commit은 정상 hooks를 사용하며 우회하지 않는다. 확정 SHA와 hook 결과는 commit 출력 및 `local://pre-d89-combined-validation.json`에 남긴다. 생성된 dist나 추가 임시 파일을 stage하지 않는다.

**COMBINED_ROOT_LOCK_FROZEN:** 위 SHA-256에서 combined lock 작업을 마쳤다. 후속 결합/변경은 총괄의 다음 슬롯 지시에 따른다.

남은 것은 D89 독립 제한 API/runtime과 signed 주소 계약, 실제 Auth/MFA/초기 관리자, 기관 준비 DTO/전체 Router/UI, 모드별 실제 수용 및 베타 전체 여정이다. 이번 단계의 판정은 **검증된 pre-D89 소스 결합**이며 hosted P1 또는 베타 완료가 아니다.

## 15. P2 Router 셸 작업

Main이 P2를 승인했다. 설치 검증과 실제 Auth/MFA/`/capabilities`/`/me`를 거친 역할 기반 메뉴, route 경계와 logout 정리를 구현한다. 초기 준비/첫 사업 DTO가 없는 상태는 확인 대기로 표시하고 성공 필드를 발명하지 않는다. 이 단계는 업무 앱 전체나 최초 기관 설정 완료가 아니다.

### 승인된 의존성과 표현 재사용

- Q가 추가 확인에서 `react-router@8.3.1` 하나의 추가를 명시 승인했다. 다른 패키지/도구 버전은 바꾸지 않는다.
- Router를 정상 pnpm install로 추가했다. `apps/client` importer만 바뀌고 새 packages/snapshots는 React Router 8.3.1과 그 의존성 cookie-es 3.1.1뿐이다. 기존 resolution 수정/삭제 0건, root package.json hash 불변이다.
- 이때 root lock SHA-256은 `af24d40b0cdb783c0a99848a9ef10512001f0f62f7b99f631b12635c6815a8d2`다. 최종 checkpoint에서도 확인한다.
- DESIGN corrected handoff의 공유 CSS 정적 출력 조건을 따른다. 후보 `auth-view.tsx`와 검수된 `business.css`는 값 변경 없이 재사용한다. CSS를 새로 설계하거나 공유 Wire/CSS를 수정하지 않는다.

### route/인증 경계

| 진입 | P2 처리 |
|---|---|
| `/` | 기존 STT 시험 진입을 그대로 유지. 업무 설치/Auth를 시작하지 않는다 |
| `/welcome` | 공개 안내. 업무 요청 없음 |
| `/join`, `/k/:code` | 공개 계약 미연결 상태를 명시. 업무 Bearer/API를 사용하지 않음 |
| `/login` | 기존 signed installation과 CloudAuth/MFA. 성공은 실제 SDK 상태와 capability/identity 확인 뒤 판단 |
| `/settings`, `/settings?module=account` | 실제 `/me`의 내 정보와 역할 기반 메뉴 |
| `/settings?module=system` | 실제 capability 읽기. 기관/기술 관리자만 |
| `/onboarding` | 기관 관리자만 기존 profile 읽기. 준비 완료/첫 사업 식별은 unknown으로 표시 |
| `/participants` | 읽기 역할만 진입. 현재 준비 계약 미완을 명시하며 데이터/등록 완료를 꾸미지 않음 |
| 그 밖 | 명시적 not-found. 임의 경로를 STT나 성공 화면으로 보내지 않음 |

업무 경로에 직접 접근해 로그인이 필요하면 그 URL을 유지한 채 로그인 화면을 보인다. 인증 완료 후 같은 경로로 진행하므로 credentials/return URL을 query/storage에 저장하지 않는다. 새로고침은 memory-only 세션이 없어 다시 로그인하며, 뒤로/앞으로도 동일한 인증/역할 판정을 거친다. 공개/시험 경로로 떠나거나 logout/session revision이 바뀌면 업무 transport와 표시 데이터를 폐기한다.

### 위계 배치표

| 줄/상태 | 역할 | 기존 부품/클래스 |
|---|---|---|
| 각 페이지 이름 | 유일 h1 | PageTitle |
| 업무 메뉴/내 정보/연결 상태/기관 정보 | 카드 h2 | WireCard |
| 정보 라벨과 실제 `/me`/profile/capability 값 | 라벨/값 | WireDataRows, WireDataRow |
| 실제 roles | 분류 배지 | WireBadge, 기존 ROLE_LABELS |
| 권한 없음/응답 실패 | 오류 상태 | WireError |
| 초기 준비/first-program unknown | 명시적 차단/범위 안내 | WireCallout |
| 로딩, 서버 logout 대기 | 진행 상태 | WireEmpty live |
| 메뉴/뒤로/로그아웃 | 기존 제어 | WireLinkProvider + React Router Link, WireButton, navigation-link |
| 로그인/TOTP | 기존 폼 | 후보 AuthView + WireFormField/WireChoice, 검수된 business.css |

새 sidebar/HERO/신규 시안 부품이 필요한 후속 화면은 DESIGN 인계로 남긴다. P2는 이미 공개된 부품과 후보 settings 레이아웃으로 메뉴 골격을 조립한다. 전사/STT 내부 코드를 수정하지 않는다.

### P2 실행 결과

구현 파일은 `apps/client/src/app.tsx`(route/셸/경계), `src/business/navigation.ts`(메뉴와 역할 판정), `src/main.tsx`(Router 진입과 정적 CSS import), `vite.config.ts`(공유 CSS를 정적 stylesheet로 출력), `index.html`이다. 후보에서 값 변경 없이 가져온 표현은 `auth-view.tsx`, `settings-modules.tsx`, `business.css`다.

**브라우저 검수에서 실제 결함 1건을 찾아 고쳤다.** `CloudAuth`와 `BusinessTransport`의 기본 fetcher가 `fetch`를 클래스 필드로 담아 `this.fetcher(...)`로 불러서, 실제 Chrome에서는 모든 인증·업무 호출이 `Illegal invocation`으로 실패하고 화면에는 `unavailable`만 떴다. jsdom은 이 수신자 규칙이 없어 43개 테스트가 전부 통과했는데도 앱은 브라우저에서 로그인 자체가 불가능한 상태였다. 기본값을 `globalThis.fetch.bind(globalThis)`로 바꿔 해결했고, 이 계약은 단위 테스트가 아니라 아래 브라우저 smoke가 지킨다.

검수는 실제 production 번들을 합성 서명 설치 정보와 합성 Auth/API 응답 위에서 돌렸다. 확인한 사실은 다음과 같다.

| 확인 항목 | 결과 |
|---|---|
| 인증 전 업무 호출 | 로그인·MFA 단계까지 `/functions/v1/ccc/*` 호출 0건 |
| 업무 경로 직접 진입 | `/settings` URL 유지한 채 로그인 화면, 인증 뒤 같은 경로 |
| 역할 기반 메뉴 | `worker` 응답에서 `내 정보`, `당사자 목록`만 노출 |
| 역할 경계 | `/settings?module=system` 직접 진입은 로그인 뒤에도 권한 없음 표시 |
| SPA 이동 | 메뉴 클릭·뒤로·앞으로에서 문서 재적재 0회(창 표식 유지), 새로고침만 문서 교체 |
| 세션 수명 | 새로고침 뒤 다시 로그인 요구(memory-only 세션) |
| logout | `POST /functions/v1/ccc/auth/logout`과 provider logout 모두 발생 후 로그인 화면 |
| 요청 링크 | `/join#token=...`의 fragment가 주소에서 제거됨 |
| 스타일 | `<head><style>` 0개, 외부 stylesheet 1개, `--canvas` `#fafaf9` 적용 |
| CSP | `style-src 'self'`, `script-src 'self'` 헤더에서 위반 0건 |

검수의 한계도 그대로 남긴다. Chrome의 CORS preflight는 브라우저 계측을 우회하므로 smoke는 앱과 API를 같은 origin에 두고 돌렸다. 실제 Cloud 배치의 교차 origin CORS, hosted Supabase Auth, 실제 MFA·기관 준비 DTO는 여전히 미검증이며 BACKEND/D89 계약에 남아 있다.

### P2에 남은 PWA 수용 조건 (미구현)

`ceb849f`는 Router 셸까지다. **P2를 완료로 세지 않는다.** 현재 소스에 `serviceWorker`, `registerSW`,
`VitePWA`, `manifest.webmanifest`는 0건이고 D80의 PWA 부분은 아직 없다. 남은 수용 조건은 다음과 같다.

- 설치 가능한 `manifest.webmanifest`(이름, 시작 주소, 표시 모드, 아이콘)와 `index.html` 연결.
- 오프라인에서도 셸이 뜨는 최소 캐시와 새 버전 반영 경로.
- 인증 API 응답과 자격증명은 어떤 저장소에도 남기지 않는다.

최소 구현 제안(새 의존성 0, 승인된 도구만 사용):

1. `apps/client/public/manifest.webmanifest`와 `index.html`의 `<link rel="manifest">` 한 줄. 아이콘은
   기존 자산을 쓰고 새 그래픽을 만들지 않는다.
2. 손으로 쓴 `apps/client/public/sw.js`. 캐시 대상은 `index.html`과 `/assets/**`의 해시 파일뿐이고,
   `/functions/v1/**`, `/auth/v1/**`, `Authorization` 헤더가 붙은 요청은 **가로채지 않고 그대로 통과**시킨다.
   `POST`와 비 GET은 전부 통과. 캐시 이름에 빌드 해시를 넣어 새 배포에서 옛 캐시를 지운다.
3. 등록은 `main.tsx`의 `load` 이후 한 줄이고 `import.meta.env.PROD`에서만 돈다. 개발 서버와 STT 시험
   진입은 영향을 받지 않는다.
4. 검수는 브라우저 smoke로 한다: 오프라인 전환 뒤 셸이 뜨고, 업무 API 응답은 캐시에 0건이며,
   `caches.keys()`와 저장소에 토큰 문자열이 없다.

이 항목의 실행 순서는 Main이 정한다. 여기서는 수용 조건과 제안만 남긴다.

## 16. P3 당사자 화면과 기관 준비 연결

### 실행 범위

검증된 backend `8d4b109`를 로컬 결합(`9a8ee05`)한 뒤 P3 소유 화면 네 개와 기관 준비 화면을 실제 API로
구현했다. 다른 워크트리에서 소스를 복사하지 않았고 공유 CSS와 디자인 파일은 건드리지 않았다.

| 파일 | 역할 |
| --- | --- |
| `apps/client/src/business/participants.ts` | 목록·등록·허브·기본정보·동의 API와 응답 decoder |
| `apps/client/src/business/institution.ts` | 초기 설정 저장, 사업 목록, 도입 확인 PATCH, 문안 hash 대조 |
| `apps/client/src/business/session.ts` | 화면이 받는 세션 계약(토큰 없음) |
| `apps/client/src/screens/participants.tsx` | 목록, 등록, 허브, 기본정보 화면 |
| `apps/client/src/screens/institution.tsx` | 기관 준비 관측값과 사업 도입 확인 |
| `apps/client/src/business/api.ts` | `/me`의 `institution` 세 축 decoder, 공용 guard 공개 |
| `apps/client/src/business/errors.ts` | 422 동의 게이트 코드 두 개를 `invalid_request`에서 분리 |

### 계약을 지키는 방식

- `/me`의 `institution`은 필수다. 없거나 축이 빠진 응답은 준비된 것처럼 렌더하지 않고 거부한다.
  `creatorLinkState`, `initialSetupState`, `firstProgramAdmissionState`를 서로 섞지 않는다.
- 도입 확인은 **화면이 보여 주는 문안의 hash**(`sha256(canonicalizeJcs(PROGRAM_ADMISSION_COPY))`)가
  서버 `admissionCopy.hash`와 같고 버전도 같을 때만 열린다. 버전만 같고 내용이 다르면 잠근다.
  서버가 보낸 문안 본문을 그대로 렌더하며 hash를 대신 echo 하지 않는다.
- 등록은 서버 거부를 그대로 보여 준다. `privacy_consent_required`와 `emergency_reason_required`는
  `invalid_request`로 뭉치지 않는다. 잠긴 사업은 고를 수 없는 자리에 사유와 함께 남는다.
- 기본정보 저장은 `supportCaseContextId`와 `expectedVersion`을 서버 응답에서만 가져오고, 409에서는
  초안을 지우지 않고 다시 읽기를 준다.
- 비담당 사업은 담당자 이름과 사업 존재만 렌더하고 동의 조작을 만들지 않는다(D86 ⑤).

### 브라우저 검수 결과

실제 production 번들 + 합성 서명 설치 정보 + 합성 Auth/API로 확인했다. hosted 인증은 없다.

| 확인 항목 | 결과 |
| --- | --- |
| 목록 | 두 행 렌더, 상태 좁히기 `종결`은 `otter-011`만, 검색 `김합성`은 한 행 |
| 이름 없는 당사자 | 가명 ID가 제목 자리에 옴 |
| 등록 거부 | 동의 없이 제출하면 422를 그대로 보여 주고 저장되지 않음 |
| 등록 성공 | 동의 체크 뒤 201, 허브 주소로 이동 |
| 허브 | 담당 사업과 비담당 사업이 갈리고 비담당에는 요청 기능 미연결을 명시 |
| 동의 저장 | `PUT /support-cases/case-1/consent` 본문 `{privacy:true, recordingAi:true}` |
| 기본정보 | 1차 저장 `expectedVersion:3`에서 409, 다시 읽기 뒤 `expectedVersion:4`로 저장 성공 |
| 기관 준비 | 여덟 관측값 표시, 세 축을 각각 표시 |
| 도입 확인 잠금 | 문안 hash가 다르면 `확인 저장` 비활성 |
| 도입 확인 저장 | hash 일치 시 활성, `PATCH /programs/program-1` 본문에 `expectedVersion:3`과 서버 hash 그대로 |

### 남은 차단

`docs/superpowers/plans/2026-09-10-participant-screens-design-handoff.md` 8번에 소유자와 함께 적었다.
목록 이메일·사업 이름, 허브 생년월일·진행 상태, 실무자 발 배정 요청, 관리자 등록의 첫 담당 실무자 선택이
BACKEND 계약 대기이고, 잠김 전용 톤은 규칙 티켓이다. 교차 origin CORS와 hosted Auth는 여전히 미검증이다.

## 17. P4 일정과 15초 페이지, 그리고 합성 미리보기 하네스

### 결합한 backend

검증된 `b3dcf35`(서명된 독립 API 경계)를 로컬 merge했다. 충돌 0건, lock resolution 변경 0건,
root lock SHA-256 불변이다. 이 계약으로 `apiBase`는 정확한 origin과 명시된 경로여야 하고
Supabase Auth origin과 같을 필요가 없다.

### 구현

| 파일 | 역할 |
| --- | --- |
| `apps/client/src/business/schedules.ts` | 달 일정, 후보, 등록, 계획, 15초 페이지, 전체 목표 API와 decoder |
| `apps/client/src/screens/schedules.tsx` | `/schedule`, `/schedules/new`, `/schedules/:id/plan`, 15초 페이지 |
| `apps/client/src/business/transport.ts` | `/schedules/month`의 `month` 질의만 추가 허용 |
| `apps/client/src/business/navigation.ts` | 일정과 등록 목적지, 계획과 15초 페이지 경로 권한 매핑 |

날짜 경계는 서버가 준 기관 시간대(`timeZone`)로만 계산한다. 주간이 달을 걸치면 두 달을 받아 합치고,
브라우저 시간대로 날짜를 다시 만들지 않는다. 월간 7열 격자, 종일 일정, 업무 바 규격, 흐림은
공유 부품이 없어 `docs/superpowers/plans/2026-09-10-schedule-briefing-design-handoff.md` 3번으로 넘겼다.

### 합성 미리보기 하네스 (제품 코드 아님)

`apps/client/tools/synthetic-preview.mjs`와 `synthetic-api.mjs`는 검수용 하네스다. 두 번째 애플리케이션도,
영구적인 가짜 런타임도 아니며 제품 코드에 준비 완료 상태를 만들어 넣지 않는다.

- 실행: `bun apps/client/tools/synthetic-preview.mjs --port 4173`
- 포트: 클라이언트 `https://127.0.0.1:4173`, 독립 API `https://127.0.0.1:4174/api/v1`, 분리된 Auth `https://127.0.0.1:4175`
- 로그인: 아무 이메일과 비밀번호, 인증 번호 `123456`. 다른 번호는 거부된다.
- 인증서는 자체 서명이라 브라우저가 경고한다. 검수자가 경고를 넘긴 뒤 클라이언트 주소를 연다.

**실제 backend로 바꿔 끼우는 자리는 두 곳뿐이다.**

1. `bootstrap`과 `manifest` 생성: `synthetic-preview.mjs`가 `signInstallManifest`로 만든 manifest를
   클라이언트 origin의 `/ccc-install-manifest.json`과 `/ccc-bootstrap.json`으로 낸다. 실제 설치는 같은 두
   경로에 `install` 산출물을 두면 되고 클라이언트 코드는 그대로다. 서명 공개키는 빌드 시
   `VITE_CCC_INSTALL_SIGNING_KEYS`로 들어간다.
2. API listener: `synthetic-api.mjs`의 `handleApi`가 `apiBase` 경로 아래를 받는다. 실제로는 이 자리에
   `createCommunityCloudRuntime` 기반 listener를 두고 같은 origin과 경로를 서명 manifest에 적으면 된다.
   Auth listener(`handleAuth`)는 그때도 합성으로 남고, hosted Supabase Auth는 별도 관문이다.

**합성 fixture 성공은 실제 backend 성공이 아니다.** 아래 검수 결과는 화면과 계약 소비의 증거이고,
실제 `createCommunityCloudRuntime`과 제한 PostgreSQL 대상 검증은 Main이 수행한다.

### 브라우저 검수 결과 (실제 HTTPS, 실제 교차 origin CORS)

| 확인 항목 | 결과 |
| --- | --- |
| 잘못된 인증 번호 | 서버 거부를 그대로 표시하고 업무 화면으로 넘어가지 않음 |
| 주간 보기 | 서버 시간대 `Asia/Seoul`과 기간이 표시되고 오늘 일정이 뜸 |
| 월간 보기 | `?view=month&date=...`가 URL에 남고 같은 자료를 날짜별로 묶음 |
| 등록 | 인테이크 여부로 상담 유형이 정해지는 이유를 표시, 저장 뒤 계획 화면 이동 |
| 계획 저장 | `expectedVersion`으로 저장하고 서버 값으로 다시 읽음 |
| 15초 페이지 | 확인된 리스크, AI 제안, 수기 배지, 불일치 양쪽 원문, 승인 대기 1건, 미해결 액션 모두 렌더 |
| 전체 목표 저장 | 저장 뒤 서버 값이 다시 채워짐 |
| 저장소 | `caches` 0개, service worker 0개, localStorage와 sessionStorage 키 0개 |

### PWA는 여전히 미해결

§15의 수용 조건이 그대로 남는다. 추가 제약: service worker는 경로와 무관하게 **어떤 API 응답과 설치
메타데이터도 캐시하지 않는다**. `/functions/v1` 접두어로 판단하지 않고, 서명 manifest가 정한 `apiBase`와
Auth origin, `/ccc-install-manifest.json`, `/ccc-bootstrap.json`을 모두 통과 대상으로 둔다. 명시적 통과 전까지
P2는 완료가 아니다.

## 18. P5 첫 묶음: 상담 기록과 AI 정리 검토

### 상태 표기

P3와 P4는 **source-ready**이고 finished가 아니다. P3는 D88 목록·허브 필드, 관리자 등록, 배정 요청,
여섯 영역 최종 동의가 붙기 전까지 열린 상태다. P5도 이번 묶음(기록 읽기·쓰기, AI 정리 검토)만 세운다.

### 구현

| 파일 | 역할 |
| --- | --- |
| `apps/client/src/business/records.ts` | 공식 기록 목록, 기록 저장(제출 ID 재생 안전, 일정 버전 충돌), 플래그 6종과 서술 4종 정본 |
| `apps/client/src/business/ai-review.ts` | 초안 읽기와 승인·반려. 생성·활성화·업로드는 범위 밖 |
| `apps/client/src/screens/records.tsx` | 상담 기록 확인하기, 상담 기록하기, AI 정리 검토 |
| `apps/client/src/screens/schedules.tsx` | 15초 페이지에 승인 대기 회차의 검토 입구 추가(본문은 싣지 않음) |

지킨 계약: 저장은 같은 `submissionId`로 재전송해도 회차가 늘지 않고, 일정에 연결하면
`expectedScheduleVersion` 충돌을 그대로 보여 준다. 직접 쓴 기록은 저장 즉시 공식 기록이고,
AI 초안은 승인 뒤에만 목록의 핵심 한 줄로 오른다. `llmMode`가 `off`면 검토 화면이 그 사실을 밝히고
초안이 없으면 없다고 적는다. 사업자 활성화나 생성 실행 버튼은 만들지 않았다. GAS는 D43대로 빈 배열,
상담 방식은 D4대로 대면 고정이다.

### 아직 안 한 P5

인테이크 위저드(D41 4부), 세부 목표 신설·닫기, 불일치 처리 3종, 액션 등록, 종결 화면, 원음 업로드는
이 묶음에 없다. 화면에 "아직 없다"고 적어 두었고 성공으로 꾸미지 않았다.

### 옛 2종 동의는 미완이다

당사자 등록과 허브의 동의는 여전히 **구 2종 체크**(개인정보, AI 녹취기록)다. S2·D82의 여섯 영역
최종 계약이 붙기 전까지 이 자리는 완료가 아니며, design 인계 문서에도 이 사실을 숨기지 않는다.
기존 2종 기록을 여섯 영역으로 자동 승격하지 않는다.

### 브라우저 검수 결과 (합성 미리보기, 실제 HTTPS와 교차 origin)

| 확인 항목 | 결과 |
| --- | --- |
| 기록 목록 | 수기 배지, 미해결 액션, 확인된 플래그, 세부 목표가 뜨고 미승인 초안 문장은 없음 |
| 기록 저장 | 저장 직후 목록에 공식 기록으로 나타나고 액션과 플래그가 함께 보임 |
| 검토 입구 | 15초 페이지의 `승인 대기 1건`에서 회차 검토로 이동 |
| 검토 화면 | AI 꺼짐 사실, 대조 축, 근거 인용, 승인 전 경고 표시 |
| 승인 | 승인 뒤 상태가 `승인됨`으로 바뀌고 목록의 핵심 한 줄과 `AI 승인` 배지가 그때 생김 |
| 저장소 | caches 0, service worker 0, localStorage와 sessionStorage 키 0 |

제출 재생과 일정 버전 충돌은 `apps/client/src/business/records.test.ts`가 결정론으로 잡는다.

## 19. P2 PWA, 공유 부품 통합

### 공유 부품 통합 (DESIGN `7e7dd81` + `a2c8db2`)

- `WireMonthCalendar` + `buildMonthWeeks` 가 월간 화면을 그린다. 임시 날짜별 목록은 없앴다.
  같은 날 일정은 Map 을 덮어쓰지 않고 배열에 쌓아 넘긴다.
- 업무 바는 두 줄이다. 1행 기간 네비, 2행 오늘·`WireToolbarField` 보기 선택창·상담 등록.
  낡은 CCC-133 세 구역 배치는 쓰지 않는다.
- 당사자 허브 손 카드를 `ParticipantHeroCard` 로, 목록 이름을 `ParticipantName` 으로 바꿨다.
- 실측(합성 미리보기): 월간 셀 높이 데스크톱 148, 390px 88. `+1건` 링크가
  `/schedule?view=day&date=2026-09-18` 로 이동. 표는 `table`/`thead`/`tbody` 네이티브 계층.
  `.wire-button` 은 radius 9999px, 높이 32. 라우트 12개 전부 제목이 뜨고 권한 오류 없음.
- 남은 것: 종일 일정과 `display_color` 는 BACKEND 가 API 에 실을 때 붙인다. 값은 지어내지 않았다.
  기간 이동 화살표는 `Chevron` 이 아직 `@ccc/web/wire` 공개 진입점에 없어 글자 버튼이다(design 레인 몫).

### P2 PWA (새 의존성 0)

- `apps/client/build/pwa.mjs` 가 빌드에서 `manifest.webmanifest`, `icon.svg`, `sw.js` 를 만든다.
  캐시 목록은 그 빌드가 실제로 낸 파일 이름을 적은 정확한 허용 목록이다. 같은 origin 광범위
  규칙은 없다. 아이콘 색은 `design/tokens.css` 의 `--gradient-brand` 를 읽어 쓴다.
- 시작 주소는 업무 진입점 `/schedule` 이다. 내부 시험 화면(`/`)이 아니다. 등록도 업무 셸에서만 한다.
- 워커에 `skipWaiting` 과 강제 새로고침이 없다. 새 워커는 대기 상태로 남고 화면은 안내 한 줄만 띄운다.
- 캐시하지 않는 것: 업무 API, Auth, 설치 manifest, 부트스트랩, 개인정보, 원음. GET 이 아니거나
  다른 origin 이면 워커가 손대지 않는다.
- 실측: manifest 200 `application/manifest+json`, 워커 scope `/` 활성·제어, 캐시 항목 5개
  (`index.html`, `manifest.webmanifest`, `icon.svg`, 번들 js·css)뿐. `/api/v1/me` 는 캐시에 없음.
  서버를 내린 뒤 이동해도 셸과 정적 자산이 뜨고 저장됐다는 문구는 없다. 새 워커는 `installed`
  대기 상태로 남고 제어 워커와 페이지 상태가 그대로였다.

## 20. 여섯 영역 동의 clean cutover (S7 §5.1.1, §6)

### 없앤 것

- `screens/participants.tsx` 의 `ProgramConsent`(옛 2종 체크 쓰기)와 등록 화면의
  `개인정보 수집과 이용에 동의받았습니다`, `AI를 활용한 녹취기록에 동의받았습니다` 체크를 지웠다.
- `ParticipantsApi.updateConsent`(`PUT /support-cases/:id/consent`) 호출부와 `ParticipantConsent`
  타입, `register` 의 `consentPrivacy`·`consentRecordingAi` 본문 키를 지웠다. 합성 하네스의 옛
  `PUT /consent` 경로도 함께 없앴다.
- 별도 `/participants/:id/programs/:caseId/consent` 화면과 그 이동 버튼, 내비 매핑을 없앴다.
  S7 §6 대로 여섯 영역은 당사자 정보의 참여 사업 구획 안(`business/consent-panel.tsx`)에 붙는다.
- 허브의 `동의 기록 시각`(옛 컬럼) 행을 지웠다. 응답 모양은 계속 검증하고 화면으로는 내보내지 않는다.

### 첫 등록 경로: 지금은 막혀 있다 (BACKEND 선행 조건)

옛 불리언을 여섯 영역 사건으로 바꾸지 않았고, 개인정보 동의 게이트도 풀지 않았다. 그래서 일반
등록은 서버 게이트가 그대로 막고(`privacy_consent_required`), 화면은 그 사실을 미리 알린다.
긴급 등록 사유 경로(D46)는 그대로 열려 있다.

필요한 계약 셋(모두 BACKEND 소유):

1. **등록 전 고지문 발행.** 지금 고지문은 `GET /support-cases/:supportCaseId/consent/disclosures`
   뿐이라 케이스가 있어야 나온다. 등록 시점에는 케이스가 없으므로 `(orgId, programId)` 로 묶인
   `ConsentDisclosureSnapshot` 을 케이스 없이 발행하는 경로가 필요하다.
2. **케이스 생성과 동의 사건의 원자적 생성.** `POST /participants` 가 여섯 영역 사건 배열
   (`domain`, `decision`, `copyVersion`, `copyHash`, `disclosureSnapshotId`, `effectiveAt`,
   `idempotencyKey`)을 받아 케이스 생성과 같은 트랜잭션에 기록해야 한다.
3. **게이트 판정 근거 교체와 legacy 키 거부.** 등록 게이트가 `consentPrivacy` 불리언이 아니라
   `consent_events` fold 를 읽어야 하고, 그 경로에서 legacy 키는 400 으로 거부해야 한다
   (`packages/http-api/src/request-handler.ts` 의 `parseParticipantCreation` 은 지금
   `optionalBoolean(body, 'consentPrivacy')` 로 받는다).

### 실측 (합성 미리보기)

- 허브: 여섯 영역 구획이 뜨고 `동의함` 을 누르면 `철회함` 이 생긴다. 옛 2종 체크, `동의 상태 저장`
  버튼, `동의 기록 시각` 행, 별도 동의 화면 이동 버튼 모두 없다.
- 옛 `/consent` 주소는 `요청한 페이지가 없습니다` 로 떨어진다.
- 등록 화면: 막힘 안내가 뜨고 옛 동의 체크가 없다. 사업 도입 확인을 마친 뒤 일반 등록을 시도하면
  서버가 `개인정보 수집과 이용 동의가 없어 등록할 수 없습니다` 로 거절하고 폼에 머문다.
  긴급 등록 사유를 적으면 201 로 생성되어 당사자 정보로 이동한다.
- 단위 회귀: 등록 본문 키가 `programId`, `emergencyReason`, `name` 뿐이고 허브 자료에
  `consent`·`consentRecordedAt` 이 없다(`business/participants.test.ts`).

### 상태

P3, P5, P7 은 이 선행 조건 셋이 오기 전까지 완료로 표시하지 않는다.

## 21. P6, P8, P9 실계약 점검 (2026-09-10)

세 단계 모두 "실제 계약에만 붙인다"는 지시대로 코드를 읽고 판정했다. 없는 API 를 가정한 화면은
만들지 않았다.

### P6 전체 상담 리포트: 차단 (서버 계약 0건)

`packages/http-api/src/request-handler.ts` 에 리포트 엔드포인트가 없다(`report` 검색 결과는 STT
readiness 뿐). 다섯 구획과 회차별 요약, 최초 인테이크 목표 근거를 실을 응답이 없으므로 화면을
짓지 않았다. 최초 목표를 현재 목표나 가장 오래된 문자열로 추측하지 않는다.

**필요한 것(BACKEND·도메인):** case 하나에 대한 리포트 응답. 구획별 근거(회차 id, 원문 위치),
최초 인테이크 목표의 출처, 공식 기록만 싣는다는 표시, 준비되지 않은 구획과 빈 구획의 구분.

### P8 공개 요청 링크와 초대: 차단 (지금 계약이 D86·S7 과 어긋난다)

현재 서버에 있는 것과 D86·S2 가 요구하는 것이 다르다.

| 지금 있는 계약 | D86·S2·S7 요구 | 판정 |
|---|---|---|
| `GET /invites/participant/:token`, `GET /invites/participant/:token/me` | `/join#t=<token>` 조각 → exchange → 주소에서 제거 → nonce 로 complete. 자기 확인 페이지 폐기 | 경로에 토큰이 남아 Referer 유출 경계를 못 지킨다. 이식 금지 |
| `POST /signup/participant` 가 `consent: {privacy, recordingAi}` 를 **요구** | 여섯 영역 사건 | S7 §5.1.1 위반이라 붙일 수 없다 |
| `POST /invites/counselor` 익명 발급 | 이메일 1개 1회용, 역할 대기 | D86 ③ 이 익명 발급을 폐기했다 |
| 위 표면 전부가 `PUBLIC_SIGNUP_ENABLED === '1'` 뒤 | 실무자 초대만 여는 경계 | 내부 실무자 온보딩 목적으로 이 스위치를 켜지 않는다(Q 결정) |

그래서 이 단계에서 만들 수 있는 화면이 없다. 링크 발급 버튼만 먼저 만들면 곧바로 옛 동의 2종
가입으로 이어진다.

**필요한 것(API·공개 링크 소유자):** S2 exchange·nonce complete 경로, 이메일에 묶인 1회용 실무자
초대, 여섯 영역 동의를 받는 가입 완료 계약, 그리고 이 표면만 여는 스위치 경계.

### P9 공개 site 분리와 web 정리: 소유자 PR 선행

`apps/web` 과 배포 설정은 이 레인 소유가 아니다. 읽기만 해서 대응표를 남긴다.

| `apps/web` route | `apps/client` 대응 | 처리 |
|---|---|---|
| `/`, `/participants*`, `/schedules*`, `/programs/:type/schedule*`, `/settings`, `/onboarding` | 같은 자리 구현됨(일정은 `/schedule` 한 자리로 합침) | E2-7 소스 컷오버 대상 |
| `/admin`, `/admin/users*`, `/admin/assign`, `/admin/invite` | `/settings?module=` 탭으로 이전 중(사용자·팀·초대 탭 남음) | P7 잔여 + 컷오버 |
| `/admin/ai-provider` | 읽기 전용 STT 상태 카드(이 레인 소유) | 이전 대상 |
| `/join/participant/:token`, `/join/worker/:token` | 없음(위 P8 차단) | 계약 확정 전 이식 금지 |
| `/participants/:id/programs/:caseId/close` | 없음. 종결은 상담 기록 화면 안에 있다 | 링크 정리 필요 |
| `/preview`, `/preview/admin` | 없음 | 미리보기 코드 게이트 접점. 은퇴·교체는 릴리스 소유자 |
| `/kit` | 없음 | 디자인 검수 접점. design 레인 소유 |
| `/welcome` | `/welcome` 도입 안내 | 문안은 공개 site 소유자와 맞춘다 |

`shared-styles.mjs` 가 아직 `apps/web/app/layout.tsx` 를 읽고, STT 시험 화면이
`@ccc/web/wire` 공개 진입점을 쓴다. 공유 자산이 독립 위치로 옮겨지기 전에는 web 삭제가 불가능하다.
그 이전은 디자인·export 소유자 PR 이 먼저다.

## 22. P7 잔여: 사용자·역할, 보유기간 (실계약)

- `사용자와 역할` 탭: `GET /settings/accounts`, `PATCH /settings/accounts/:id/roles`(`roles`·`expectedRoles`),
  `POST /settings/accounts/:id/deactivate`. 역할은 겹칠 수 있고 서버가 `expectedRoles` 로 동시 변경을 막는다.
  초대 발급은 D86 계약이 서버에 없어 만들지 않았다(§21 P8).
- `개인정보 보유기간` 탭: `GET/PUT /settings/retention-policy`(`expectedVersion`·`piiPurgeGraceDays`).
- 실측(합성 관리자): 실무자 하나에게 실무 책임자 역할 추가 저장, 보유기간 365 → 400 저장 반영.
- 남은 P7: 팀 감독 지정, 담당 배정 요청 승인·이관(허브의 요청 발신은 있음), 동의 문안 관리 탭, 사업 도입 확인
  잠금(BACKEND, 미구현). 실무자 초대는 P8 계약 뒤다.
