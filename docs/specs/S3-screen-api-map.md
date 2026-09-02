# S3: 화면·서버 액션·API 대응표

- 상태: 확정 (2026-09-03)
- 근거: ADR-0041 D76~D82, ADR-0042, ADR-0039 D75, ADR-0038, `CCC_OPEN_PILOT_PLAN.md` E2-1
- 입력: `scripts/design/route-inventory.json`, `apps/web/app/**/page.tsx`, `apps/web/app/actions.ts`, `apps/web/app/{logout-action,theme-action}.ts`, `apps/web/app/lib/api.ts`, `apps/web/app/preview/unlock/route.ts`, `apps/api/src/request-handler.ts`, `apps/api/src/index.ts`, `apps/api/src/preview-gate.ts`, `apps/api/src/identity.ts`, `db/gateway.ts`, `docs/adr/0042-supabase-read-only-preflight.md`
- 산출: 현재 Next route, 화면 분류, 인증 표면, `Actor`, 화면별 API·DTO·서버 액션과 E2 소유권의 단일 대응표. 구현은 E2 티켓이 소유한다.
- 관련 티켓: E2-1, E2-2, E2-3, E2-4a, E2-4b, E2-4c, E2-5a, E2-5b, E2-5c, E2-7

## 1. 목적

현재 Next 화면을 정적 클라이언트로 옮길 때 빠지는 route, API, DTO 또는 권한이 없도록 기계적으로 대조할 계약을 정한다. 화면의 비즈니스 데이터는 Bearer/Access 인증 API에서만 읽고, 공개 가입 화면은 업무 셸과 인증 헤더를 사용하지 않는다. 화면 수와 redirect를 같은 방식으로 세어 E2-1의 probe 결과가 재현되게 한다.

## 2. 인터페이스와 규칙

### 2.1 인증·Actor 표면

| 표면 | 헤더·자격 | `Actor` 요구 | 적용 |
|---|---|---|---|
| `access` | 웹은 `CF_Authorization` 쿠키 또는 `cf-access-jwt-assertion`을 API로 전달한다. 로컬 개발 헤더는 운영 번들에 없다. | `actorFromRequest`가 Access JWT의 email/common_name을 기관 사용자로 해석한다. 사람은 `admin` 또는 `counselor`; `service`는 화면에 금지한다. | `permission.state=allowed`인 모든 행, 단 `/`·`schedule/all` redirect도 포함 |
| `public-join` | 정상 운영에서는 Access 헤더·업무 쿠키·Bearer 없음. participant/worker 초대 token이 business auth 자격이다. Preview mode에서는 먼저 `ccc_preview` cookie가 있어야 `/join/*`에 도달하고, API도 그 cookie를 받아 preview `Actor`를 해석한다. 현재 `apps/web/app/lib/api.ts` 공개 client는 이 cookie를 API로 포워딩하지 않는 gap이다. E2-5c가 이 gap의 owner이며, 기대 상태는 `ccc_preview`만 포워딩하는 것이다. business Bearer는 어느 mode에서도 보내지 않는다. `PUBLIC_SIGNUP_ENABLED=1`이 아니면 API와 middleware 모두 404다. | 정상 운영의 token API는 `Actor` 없음; Preview mode는 별도 `ccc_preview` 자격과 preview `Actor`가 필요하다. | `/join/participant/:token`, `/join/worker/:token` |
| `public-preview` | 최초 GET은 자격 없음. 코드 POST는 web adapter가 API JSON 응답을 받아 `ccc_preview` HttpOnly cookie를 발급한다. | `/preview/unlock`은 `Actor` 없음; 이후 미리보기 업무 API는 preview resolver가 선택한 사람 `Actor`를 쓴다. | `/preview`, `/preview/admin` |
| `public-welcome` | 자격 없음 | `Actor` 없음 | `/welcome` |
| `kit` | route 자체의 데이터 API는 없지만 `/kit`은 `x-ccc-public` 표식이 없어 RootLayout 업무 셸을 탄다. | 사람 `Actor` 필요(셸의 `/organization/profile`, `/participants/new-signup-count` 포함) | `/kit` |

`admin`은 `apps/web/app/admin/layout.tsx`의 `getMyIdentity()`와 gateway role guard가 함께 요구한다. 케이스 내용 API의 기본 규칙은 `admin` 또는 해당 케이스의 활성 `counselor` 배정이며, 전체 목표 수정은 담당 실무자만 허용한다. 표의 fixture actor가 `assigned-practitioner`인 행은 `counselor + active assignment`를 뜻하고, gateway가 허용하는 `admin` 접근을 숨기지 않는다.

### 2.2 화면 수와 유일성 규칙

`route-inventory.json`의 `routes` 배열을 입력 집합으로 삼고, `page` 값이 같은 항목은 하나로만 센다. `routePattern`은 `:param`으로 정규화한 문자열을 유일 키로 삼으며, query string은 화면을 늘리지 않는다. 모든 inventory 항목은 아래 네 분류 중 정확히 하나다.

| 분류 | 결정적 판정 | 수 |
|---|---|---:|
| 실제 인증 운영 화면 | inventory `permission.state=allowed`, `page.tsx`가 데이터/폼 화면을 렌더하고, redirect-only가 아님 | 22 |
| 공개 화면 | inventory `permission.state=public`이고 `/join`, `/preview`, `/welcome` 중 하나 | 5 |
| non-screen redirect | `page.tsx`의 반환이 redirect/notFound뿐인 canonicalizer: `/`, `/programs/:programType/schedule/all` | 2 |
| `/kit` | `routePattern=/kit`인 component-kit 화면. 운영 화면에서 제외 | 1 |
| **합계** | inventory page entry의 유일 키 합계 | **30** |

따라서 계획의 “운영 화면 29개, `/kit` 1개”는 **kit을 뺀 29개 route entry**를 뜻한다. 그 29개는 실제 인증 운영 화면 22개 + 공개 화면 5개 + non-screen redirect 2개로 세분화한다. `/preview/unlock`은 `page.tsx`가 아닌 Route Handler이므로 30개에 넣지 않고 §2.4에서 별도로 센다. action 내부의 성공·실패 redirect, `notFound`, query별 view 변형, `/records/new` 같은 redirect 목적지는 독립 route로 세지 않는다.

E2-1 probe의 누락 판정은 다음과 같다.

1. inventory의 각 `routePattern`이 이 문서 §3 표에 정확히 한 번 있어야 한다.
2. 실제 화면 행은 page loader와 모든 렌더링 component가 호출하는 API와 submit하는 server action을 모두 가져야 한다. `+shell-actions`와 `+admin-layout`은 §2.3의 상속 규칙으로 확장한다.
3. action의 API endpoint와 응답 DTO는 §4의 endpoint catalog에 존재해야 한다.
4. 공개 행에는 `+shell-actions`와 Access/Bearer가 있으면 실패다. redirect 행에는 렌더링 화면 API/DTO가 있으면 실패한다. 단 `/`의 `GET /me`는 목적지 선택에 필요한 선언된 prerequisite라 허용한다.
5. 위 조건을 만족하지 않는 action/API는 §5의 계약 행으로 남긴다. 이를 구현 TODO로 해석하지 않는다.

### 2.3 공통 업무 셸 API

비공개 route는 RootLayout이 다음을 공통으로 읽는다. `GET /organization/profile -> OrganizationProfile`, `GET /participants/new-signup-count -> { count: number }`, 그리고 `getDisplayLabels()`가 사용하는 `OrganizationProfile`이다. `getNewSignupCount` 실패는 셸의 숫자만 0으로 낮춘다. 공개 행은 이 두 호출을 하지 않으며 `AppHeader`, `AppSidebar`, `BackLink`를 렌더하지 않는다.
모든 `access`/`kit` 행은 `+shell-actions`를 상속한다. scanner는 이를 `toggleThemeAction`(쿠키 쓰기)과 `logoutAction`(미리보기 cookie 삭제 또는 Cloudflare Access logout redirect)으로 확장한다. §3의 개별 행에는 화면 고유 action만 적고, marker 자체를 두 action으로 다시 복제하지 않는다. 모든 `/admin*` 행의 `+admin-layout`은 admin layout의 inherited `GET /me -> MyIdentity` role guard를 확장한다.
`/preview/unlock`은 같은 method/path라도 두 경계를 혼동하지 않는다. Web Next Route Handler(`apps/web/app/preview/unlock/route.ts`)는 HTML form `{ mode, code }`를 받아 API JSON adapter를 호출하고 web `ccc_preview` cookie와 `303`을 만든다. 현재 web adapter/client는 wire `expiresAt`을 소비·검증하지 않는 gap이며, E2-3가 cookie를 쓰기 전에 유효한 `expiresAt`을 검증하는 기대 상태를 소유한다. API request-handler(`apps/api/src/index.ts`의 `handlePreviewUnlock`, `apps/api/src/preview-gate.ts`)의 JSON `POST /preview/unlock`은 `{ code }`를 받아 `200 { token, maxAgeSeconds, expiresAt }`와 API `Set-Cookie`를 반환한다.

### 2.4 Route Handler 공개 진입

`POST /preview/unlock -> PreviewUnlockWire { token, maxAgeSeconds, expiresAt }`는 코드만 받고 API 응답과 web adapter cookie를 각각 설정한 뒤 `303 /`(counselor) 또는 `303 /settings`(admin)로 보낸다. 이 handler는 `Actor`를 해석하지 않는다. 공개 초대 API는 production에서는 token-only라 `Actor`를 해석하지 않고, Preview mode에서는 `ccc_preview`를 검증하는 preview resolver가 `Actor`를 해석한 뒤 같은 token API를 실행한다: `GET /invites/participant/:token -> PublicInviteInfo`, `GET /invites/participant/:token/me -> ParticipantSelfCheck`, `POST /signup/participant -> PublicSignupResult`, `GET /invites/worker/:token -> PublicWorkerInviteInfo`, `POST /invites/worker -> WorkerSignupResult`. middleware가 공개 표식을 붙이는 정확한 `/join` 자체는 `page.tsx`가 없어 framework 404이고, 화면·API count에 넣지 않는다.
Route discovery는 정적 `page.tsx`만 읽지 않는다. E2-1은 각 inventory `page`에서 시작해 모든 조상·중첩 Next `layout.tsx`와 렌더링되는 import closure를 순회한다. RootLayout의 `AppHeader`, `AppSidebar`, `BackLink`와 `apps/web/app/admin/layout.tsx`의 admin guard, 그 하위 import의 API/action도 해당 route에 상속한다. 따라서 `page.tsx`에 직접 import가 없는 client component의 server action, 공통 또는 중첩 layout의 API도 §3에 기록한다. 순회 결과가 route row나 §4 endpoint row에 없으면 실패다.
| route-handler route | 인증 표면, Actor | API·DTO | E2 owner |
|---|---|---|---|
| `/preview/unlock` (page entry 아님) | `public-preview`; no `Actor`, code input only | Web form adapter: `POST /preview/unlock` → API `PreviewUnlockWire` `{ token,maxAgeSeconds,expiresAt }` + API `Set-Cookie`, then web cookie + 303. 현재 `expiresAt` 검증은 없음, E2-3가 기대 상태를 소유 | E2-3 |
Exact-key rule: `wire response exact shape`의 객체는 추가·누락 key를 허용하지 않는다. nullable key는 `null`, optional key는 `?`로만 표시하며 서로 바꾸지 않는다. Envelope(`results`, `candidates`, `assignees`, `requests`, `cases`, `jobs`, `reviews`)는 envelope 자체를 DTO와 동일시하지 않고 안쪽 배열 DTO를 별도로 검증한다. client projection이 wire 필드를 버리거나 합치는 경우에는 ledger에 그 변환을 적는다.


## 3. route·screen·API·DTO·E2 소유자 대응표

API 표기의 `GET`, `POST`, `PUT`, `PATCH`는 request-handler의 method/path이고, 괄호 안은 응답 DTO다. `action → endpoint`는 Next server action을 거쳐 같은 API를 호출한다. `+shell-actions`와 `+admin-layout`은 §2.3의 공통 호출 상속 marker다.

| # | route pattern, 화면 분류 | 인증 표면, Actor | 화면 API와 DTO | server action → API, DTO | E2 owner |
|---:|---|---|---|---|---|
| 1 | `/` non-screen redirect | `access`; human `admin\|counselor` | declared prerequisite `GET /me` (wire `MeWire`, required nullable `lastProgramType` selects destination) | 없음; `+shell-actions` | E2-1 |
| 2 | `/admin` 관리자 기관 홈 | `access`; `admin` `+admin-layout` | `GET /organization/profile` (`OrganizationProfile`), `GET /users` (`DirectoryUser[]`) | 없음; `+shell-actions` | E2-5a |
| 3 | `/admin/ai-provider` AI 사업자 | `access`; `admin` `+admin-layout` | `GET /ai/provider/status` (`AiProviderStatus`) | `activateAiProviderRuntimeAction` → `POST /ai/provider/activate-runtime` (`void`); `+shell-actions` | E2-5a |
| 4 | `/admin/assign` 배정 | `access`; `admin` `+admin-layout` | `GET /schedules/candidates` (wire `{candidates: ScheduleCandidate[]}`), `GET /users` (`DirectoryUser[]`), 선택 시 `GET /support-cases/:id/assignees` (wire `{assignees: SupportCaseAssigneeWire[]}`) | `addSupportCaseAssigneeAction` → `POST /support-cases/:id/assignees` (`SupportCaseAssignee`); `+shell-actions` | E2-5a |
| 5 | `/admin/invite` 실무자 초대·등록 | `access`; `admin` `+admin-layout` | 없음 | `registerCounselorAction` → `POST /users` (`DirectoryUser`); `createWorkerInviteAction` → `POST /invites/counselor` (`WorkerInvite`); `+shell-actions` | E2-5a |
| 6 | `/admin/users` 사용자 목록 | `access`; `admin` `+admin-layout` | `GET /users` (`DirectoryUser[]`), 선택 시 `GET /users/:id/assignments` (`CounselorAssignments`) | 없음; `+shell-actions` | E2-5a |
| 7 | `/admin/users/:id` 사용자 상세 | `access`; `admin` `+admin-layout` | `GET /users` (`DirectoryUser[]`), `GET /users/:id/assignments` (`CounselorAssignments`) | 없음; `+shell-actions` | E2-5a |
| 8 | `/join/participant/:token` 공개 participant 가입·자기 확인 | `public-join`; token only, no `Actor` | 가입 전 `GET /invites/participant/:token` (`PublicInviteInfo`), 소비 후 `GET /invites/participant/:token/me` (`ParticipantSelfCheck`) | `signupParticipantAction` → `POST /signup/participant` (`PublicSignupResult`) | E2-5c |
| 9 | `/join/worker/:token` 공개 실무자 가입 | `public-join`; token only, no `Actor` | `GET /invites/worker/:token` (`PublicWorkerInviteInfo`) | `signupWorkerAction` → `POST /invites/worker` (`WorkerSignupResult`) | E2-5c |
| 10 | `/kit` component kit, 운영 화면 아님 | `kit`; human `admin\|counselor` because business shell | route API 없음 | `+shell-actions` | E2-1 |
| 11 | `/onboarding` 기관·사업 이름 | `access`; `admin` | `GET /me` (`MyIdentity`), `GET /organization/profile` (`OrganizationProfile`) | `completeOrganizationOnboardingAction` → `POST /organization/onboarding` (`OrganizationProfile`); `+shell-actions` | E2-5a |
| 12 | `/participants` 당사자 목록, 인증 운영 화면 | `access`; human `admin\|counselor` | `GET /participants` (wire `{results: AssignedParticipantWire[]}` → client `AssignedParticipant[]`) | 없음; `+shell-actions`. 검색은 수신 목록의 client filter이며 `GET /participants/search`를 부르지 않는다 | E2-4a |
| 13 | `/participants/invite` 당사자 초대 | `access`; human `admin\|counselor` (gateway가 발급 권한 판정) | 없음 | `createParticipantInviteAction` → `POST /invites/participant` (`ParticipantInvite`); `+shell-actions` | E2-4a |
| 14 | `/participants/new` 당사자·첫 참여사업 등록 | `access`; human `admin\|counselor` | `GET /me` (`MyIdentity`) | `createInitialParticipantProgramAction` → `POST /participants` (`ParticipantProgramCreation`), 성공 시 `/schedules/new?target=...`; `+shell-actions` | E2-4a |
| 15 | `/participants/:beneficiaryId` 당사자 정보 허브 | `access`; human, 최소 1개 담당 케이스 또는 `admin` | `GET /participants/:id/hub` (`ParticipantHubDetail`), `GET /participants/:id/goal-tree` (wire `{cases: ParticipantGoalTreeCaseWire[]}` → client `ParticipantGoalTreeCase[]`) | `updateParticipantConsentAction` → `PUT /support-cases/:id/consent` (`ParticipantConsent`); `+shell-actions` | E2-5b |
| 16 | `/participants/:beneficiaryId/edit` 기본정보 수정 | `access`; `admin` 또는 해당 당사자의 활성 담당 `counselor` | `GET /participants/:id/basic-info` (`ParticipantBasicInfo`) | `updateParticipantBasicInfoAction` → `PUT /participants/:id/basic-info` (`void`); `+shell-actions` | E2-5b |
| 17 | `/participants/:beneficiaryId/programs/:supportCaseId/briefing` 15초 페이지 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`) | `updateOverallGoalAction` → `PUT /support-cases/:id/overall-goal` (`{ supportCaseId, overallGoal }`); `resolveDiscrepancyAction` → `PUT /support-cases/:id/discrepancies/:discrepancyId/resolution` (`SessionDiscrepancy`, 응답 body는 action이 무시); `+shell-actions` | E2-5b |
| 18 | `/participants/:beneficiaryId/programs/:supportCaseId/close` 케이스 종결 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/closure` (`SupportCaseClosureInfo`), `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`), `GET /participants/:id/goal-tree` (wire `{cases: ParticipantGoalTreeCaseWire[]}` → client `ParticipantGoalTreeCase[]`) | `closeSupportCaseAction` → `POST /support-cases/:id/close` (`SupportCase` wire, close response projection `{ id,status,closedAt }`); `+shell-actions` | E2-5b |
| 19 | `/participants/:beneficiaryId/programs/:supportCaseId/records` 전체 상담 기록 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/records?official=true` (`SupportCaseRecords`), `GET /participants/:id/support-cases` (wire `ParticipantProgram[]` → screen `ParticipantDetail`) | `+shell-actions` | E2-4c |
| 20 | `/participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review` AI 초안 검토 | `access`; `admin` 또는 케이스 활성 담당 `counselor`, AI review는 human만 | `GET /support-cases/:id/records?official=true` (`SupportCaseRecords`), `GET /participants/:id/support-cases` (wire `ParticipantProgram[]` → screen `ParticipantDetail`), `GET /sessions/:sessionId/ai` (`AiDraft`) | `reviewAiDraftAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /sessions/:id/ai/drafts/:version/review` (`AiDraftMutationWire`); `generateAiDraftAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /sessions/:id/ai/generate` (`AiDraftMutationWire`); `createActionItemFromAiClaimAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /cases/:id/action-items` (`OpenActionItem`); `+shell-actions` | E2-4c |
| 21 | `/participants/:beneficiaryId/programs/:supportCaseId/records/intake` 인테이크 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/records/intake` (`IntakeRecordContext`), `GET /me` (`MyIdentity`, optional recorder label) | `createIntakeRecordAction` → precheck `GET /participants/:id/support-cases` (`ParticipantProgram[]`), then `POST /support-cases/:id/records/intake` (`CreateIntakeRecordResult`); `updateIntakeRecordAction` → precheck same `GET /participants/:id/support-cases` (`ParticipantProgram[]`), then `PUT /support-cases/:id/records/intake` (`{ record: CreatedIntakeRecord }`); changed overall goal only → `PUT /support-cases/:id/overall-goal` (`{ supportCaseId, overallGoal }`); `+shell-actions` | E2-5b |
| 22 | `/participants/:beneficiaryId/programs/:supportCaseId/records/new` 정기 기록 작성 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/records?official=true` (`SupportCaseRecords`), `GET /participants/:id/support-cases` (wire `ParticipantProgram[]` → screen `ParticipantDetail`), 내부 `GET /schedules/:scheduleId/plan` (`ScheduleSessionPlan`) | `createCounselingRecordAction` → precheck `GET /participants/:id/support-cases` (`ParticipantProgram[]`), then `POST /support-cases/:id/records` (`CreateCounselingRecordResult`); goal UI: `createGoalAction` → precheck same `GET /participants/:id/support-cases`, then `POST /cases/:id/goals` (`Goal`); `updateGoalTitleAction` → precheck same `GET /participants/:id/support-cases`, then `PUT /goals/:id/title` (`Goal`); `countGoalUpcomingLinksAction` → precheck same `GET /participants/:id/support-cases`, then `GET /goals/:id/upcoming-links` (`{ upcomingCount }`); `closeGoalAction` → precheck same `GET /participants/:id/support-cases`, then `POST /goals/:id/close` (`Goal`); `+shell-actions` | E2-4c, E2-5b |
| 23 | `/preview` 공개 preview 코드 입력 | `public-preview`; no `Actor` | route API 없음 | HTML form `POST /preview/unlock` (web adapter, `PreviewUnlockWire`) → cookie/303 | E2-3 |
| 24 | `/preview/admin` 공개 관리자 preview 코드 입력 | `public-preview`; no `Actor` | route API 없음 | HTML form `POST /preview/unlock` (web adapter, `PreviewUnlockWire`) → cookie/303, 성공 목적지는 `/settings` | E2-3 |
| 25 | `/programs/:programType/schedule` 일정 통합 화면 | `access`; human `admin\|counselor` | `GET /schedules/today` 또는 `GET /schedules/upcoming` 또는 `GET /schedules/month` (`TodaySchedulesWire` → `TodaySchedules`), `PUT /me/last-program` (`{ok:true}`) | 없음; `+shell-actions` | E2-4b |
| 26 | `/programs/:programType/schedule/all` non-screen redirect | `access`; human `admin\|counselor` | 없음 | 없음; `+shell-actions`. `?month=`을 보존해 canonical `/programs/:programType/schedule?view=month`로 redirect | E2-1 |
| 27 | `/schedules/new` 상담 일정 등록 wizard | `access`; human `admin\|counselor` | `GET /schedules/candidates` (wire `{candidates: ScheduleCandidate[]}` → client `ScheduleCandidate[]`) | `loadScheduleContextAction` → `GET /cases/:id/goals` (`Goal[]`) + `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`); `createSchedulePlanAction` → `POST /schedules` (`CounselingScheduleWire` → `CounselingSchedule`); `+shell-actions` | E2-4b |
| 28 | `/schedules/:scheduleId/plan` 세션 목표 수정 | `access`; `admin` 또는 일정 케이스 활성 담당 `counselor` | `GET /schedules/:id/plan` (`ScheduleSessionPlanWire` → `ScheduleSessionPlan`), `GET /cases/:id/goals` (`Goal[]`) | `updateScheduleSessionGoalsAction` → `PUT /schedules/:id/plan` (`{scheduleId,version}`); `+shell-actions` | E2-4b |
| 29 | `/settings` 설정·배정 요청 | `access`; human `admin\|counselor` | `GET /me` (`MyIdentity`), `GET /assignment-requests` (wire `{requests: AssignmentRequestWire[]}` → client `AssignmentRequest[]`), admin이면 `GET /users` (`DirectoryUser[]`) | `acceptSupportCaseAssignmentAction` → `POST /support-cases/:id/assignees/:assignmentId/accept` (`{accepted:true}`); `+shell-actions` | E2-5a |
| 30 | `/welcome` 공개 안내 | `public-welcome`; no `Actor` | API 없음 | 없음 | E2-5c |

### 3.1 public route 불변 조건

Preview mode의 `/join/*` 공개 page/API는 현재 production token-only 경계와 preview-cookie 경계를 함께 만족하지 못한다. middleware가 cookie 없는 진입을 막는 것과 별개로, `getPublicInviteInfo`, `getParticipantSelfCheck`, `signupParticipant`, `getPublicWorkerInviteInfo`, `signupWorker`는 `accessHeaders()`를 쓰지 않아 `ccc_preview`를 API에 전달하지 않는다. E2-5c는 preview mode에서 `ccc_preview`만 포워딩하고 business Bearer는 보내지 않는 상태를 목표로 한다.
`/join/*`, `/preview*`, `/welcome`은 middleware가 요청에 `x-ccc-public=1`을 저작하고 RootLayout은 셸 없이 렌더한다. 정상 운영의 공개 page/API client는 Access/Bearer와 `accessHeaders()`를 호출하지 않고 participant/worker token만 전송한다. Preview mode의 `/join/*`는 별도 `ccc_preview` cookie를 API에 직접 포워딩해야 하며 현재 그 포워딩이 없어 E2-5c gap이다. 이름·연락처·이메일 등 공개 응답은 token 범위로만 내려가며, 공개 route에 `OrganizationProfile`, 새 가입 수, `CF_Authorization`, 업무 sidebar 링크가 있으면 계약 위반이다.

## 4. DTO·endpoint catalog

### 4.1 Endpoint ledger: wire response와 client projection

`wire`는 `apps/api/src/request-handler.ts`가 실제 JSON으로 내보내는 최상위 shape이고, `client`는 `apps/web/app/lib/api.ts`가 화면에 넘기는 projection이다. Envelope는 생략하거나 배열로 평탄화하지 않는다. E2-1은 method와 path를 이 표의 한 행과 exact match하고, response key가 wire 열과 다르면 실패시킨다.

| method, path | wire response exact shape | client DTO 또는 소비 |
|---|---|---|
| `GET /me` | object `{id,orgId,email,role,active,name,lastProgramType}` where `lastProgramType` is required and nullable | `MyIdentity`; root은 `lastProgramType`만 읽음 |
| `GET /organization/profile` | `{orgId,orgName,programDisplayName}` | `OrganizationProfile` |
| `GET /participants/new-signup-count` | `{count}` | number |
| `GET /users` | `DirectoryUser[]` | `DirectoryUser[]` |
| `POST /users` | `DirectoryUser` | `DirectoryUser` |
| `GET /ai/provider/status` | `{enabled,adapterId,adapterVersion,configHash,runtime:{configured,adapterId,adapterVersion,configHash,matches}}` | `AiProviderStatus` |
| `POST /ai/provider/activate-runtime` | `{enabled,adapterId,adapterVersion,configHash,replayed}` | action은 response를 사용하지 않음 |
| `GET /schedules/candidates` | envelope `{candidates: ScheduleCandidate[]}` | `ScheduleCandidate[]` |
| `GET /support-cases/:id/assignees` | envelope `{assignees: SupportCaseAssigneeWire[]}` | `SupportCaseAssignee[]` |
| `POST /support-cases/:id/assignees` | `SupportCaseAssigneeWire` | `SupportCaseAssignee` |
| `GET /users/:id/assignments` | `{userId,participants: AdminAssignmentParticipantWire[]}` | `CounselorAssignments` |
| `GET /invites/participant/:token` | `{programType}` | `PublicInviteInfo` |
| `GET /invites/participant/:token/me` | `{name,phone,email,programs,upcomingSchedules,pastSchedules}` | `ParticipantSelfCheck` |
| `POST /signup/participant` | `{beneficiaryId,supportCaseId}` | `PublicSignupResult` |
| `GET /invites/worker/:token` | `{orgName}` | `PublicWorkerInviteInfo` |
| `POST /invites/worker` | `{userId,email}` | `WorkerSignupResult` |
| `POST /invites/counselor` | `InviteTokenWire` `{token,kind,orgId,programType,issuedBy,status,issuedAt,usedAt,revokedAt,usedByBeneficiaryId}` | `WorkerInvite` client projection |
| `POST /invites/participant` | `InviteTokenWire` `{token,kind,orgId,programType,issuedBy,status,issuedAt,usedAt,revokedAt,usedByBeneficiaryId}` | `ParticipantInvite` client projection |
| `POST /organization/onboarding` | `{orgId,orgName,programDisplayName}` | `OrganizationProfile` |
| `GET /participants` | envelope `{results: AssignedParticipantWire[]}` | `AssignedParticipant[]` |
| `POST /participants` | `{beneficiaryId,supportCaseId,assignmentRole,replayed}` | `ParticipantProgramCreation` |
| `GET /participants/:id/support-cases` | `ParticipantProgramWire[]` | `ParticipantProgram[]`; `getParticipantDetail` additionally projects first `participantName/participantPhone` to `ParticipantDetail` |
| `POST /participants/:id/support-cases` | `{beneficiaryId,supportCaseId,assignmentRole,replayed}` | `ParticipantProgramCreation` |
| `GET /participants/:id/hub` | `{beneficiaryId,participantName,participantPhone,participantEmail,programs:ParticipantProgramWire[]}` | `ParticipantHubDetail` |
| `GET /participants/:id/goal-tree` | envelope `{cases: ParticipantGoalTreeCaseWire[]}` | `ParticipantGoalTreeCase[]` |
| `PUT /support-cases/:id/consent` | `{privacy,recordingAi}` | `ParticipantConsent` |
| `GET /participants/:id/basic-info` | `ParticipantBasicInfo` keys below | `ParticipantBasicInfo` |
| `PUT /participants/:id/basic-info` | `ParticipantPiiVault` `{beneficiaryId,version,purgeDue,purgedAt}` | void; action ignores response |
| `GET /participants/:id/programs/:case/briefing` | `ParticipantBriefingWire` keys below | `ParticipantBriefing` |
| `PUT /support-cases/:id/overall-goal` | `{supportCaseId,overallGoal}` | same inline object |
| `PUT /support-cases/:id/discrepancies/:discrepancyId/resolution` | `SessionDiscrepancyWire` | action ignores body, revalidation reads records |
| `GET /support-cases/:id/closure` | `SupportCaseClosureInfo` | `SupportCaseClosureInfo` |
| `POST /support-cases/:id/close` | full `SupportCase` wire object | action/client uses `{id,status,closedAt}` projection |
| `GET /support-cases/:id/records?official=true` | `SupportCaseRecordsWire` | `SupportCaseRecords` |
| `POST /support-cases/:id/records` | `{record:{id,heldAt,channel,memo},replayed}` | `CreateCounselingRecordResult` |
| `GET /support-cases/:id/records/intake` | `IntakeRecordContextWire` | `IntakeRecordContext` |
| `POST /support-cases/:id/records/intake` | `{record:{id,heldAt,channel,kind},replayed}` | `CreateIntakeRecordResult` |
| `PUT /support-cases/:id/records/intake` | `{record:{id,heldAt,channel,kind}}` | `{record:CreatedIntakeRecord}` |
| `POST /cases/:id/action-items` | `OpenActionItemWire` | `OpenActionItem` |
| `GET /sessions/:id` | `SessionWire` without `audioR2Key` | `ManualSession` client projection for action precheck |
| `GET /sessions/:id/ai` | `AiDraftGetWire` | `AiDraft` |
| `POST /sessions/:id/ai/generate` | `AiDraftMutationWire` | `AiDraft` client cast currently expects GET-only fields; action ignores response |
| `POST /sessions/:id/ai/drafts/:version/review` | `AiDraftMutationWire` | `AiDraft` client cast currently expects GET-only fields; action ignores response |
| `POST /cases/:id/goals` | `Goal` | `Goal` |
| `PUT /goals/:id/title` | `Goal` | `Goal` |
| `GET /goals/:id/upcoming-links` | `{upcomingCount}` | number |
| `POST /goals/:id/close` | `Goal` | `Goal` |
| `GET /schedules/today` | `TodaySchedulesWire` | `TodaySchedules` |
| `GET /schedules/upcoming` | `TodaySchedulesWire` | `TodaySchedules` |
| `GET /schedules/month` | `TodaySchedulesWire` | `TodaySchedules` |
| `POST /schedules` | `CounselingScheduleWire` | `CounselingSchedule` |
| `GET /schedules/:id/plan` | `ScheduleSessionPlanWire` including `channel` | `ScheduleSessionPlan` (client ignores extra `channel`) |
| `PUT /schedules/:id/plan` | `{scheduleId,version}` | `{scheduleId,version}` |
| `GET /assignment-requests` | envelope `{requests: AssignmentRequestWire[]}` | `AssignmentRequest[]` |
| `POST /support-cases/:id/assignees/:assignmentId/accept` | `{accepted:true}` | action ignores response |
| `PUT /me/last-program` | `{ok:true}` | void |
| `POST /preview/unlock` (API JSON boundary) | `{token,maxAgeSeconds,expiresAt}` with status 200 and API `Set-Cookie` | `PreviewUnlockResult` client currently consumes token/maxAge; `expiresAt` remains wire evidence |
| `GET /health` | `{status:'ok',service:'ccc-api'}` | liveness, no client |
| `GET /participants/search` | `{results:ParticipantSearchResultWire[]}` | no current page |
| `GET /consent/follow-ups` | `{results:PrivacyConsentFollowUp[]}` | no current page |
| `PATCH /schedules/:id/reschedule` | `CounselingScheduleWire` | no current page |
| `POST /schedules/:id/cancel` | `CounselingScheduleWire` | no current page |
| `POST /schedules/:id/no-show` | `CounselingScheduleWire` | no current page |
| `POST /support-cases/:id/force-transfer` | `{transferred:true}` | no current page |
| `POST /sessions/:id/ai/source` | `{sourceSnapshotId,sha256,maskingPipelineVersion,evidenceIds}` | `MaskedSourceAck`, `service` Actor only |
| `PUT /sessions/:id/audio` | `SessionWire` | no current page |
| `POST /sessions/:id/approve` | `SessionWire` | legacy approval |
| `GET /pipeline/health` | `PipelineHealth` | admin, no current page |
| `GET /pipeline/jobs` | `{jobs:PipelineJob[]}` | service, no current page |
| `GET /pipeline/text-jobs` | `{jobs:TextWorkItem[]}` | service, no current page |
| `GET /pipeline/text-jobs/:item/source` | `TextWorkSource` `{sessionId,text}` | service, no current page |
| `POST /pipeline/text-jobs/:item/complete` | 204 empty | service, no current page |
| `GET /pipeline/jobs/:sessionId/audio` | audio bytes; missing `{error:'audio_object_missing',jobId}` | service, no current page |
| `POST /pipeline/jobs/:sessionId/result` | 204 empty | service, no current page |
| `GET /pii-retention/reviews` | `{reviews:ParticipantPiiRetentionReview[]}` | admin, no current page |
| `POST /pii-retention/reviews/:id` | `ParticipantPiiRetentionReview` | admin, no current page |
| `POST /users/:id/deactivate` | `DirectoryUser` | admin, no current page |
| `GET /cases` | `CaseRecord[]` | legacy, no current page |
| `POST /cases` | `CaseRecord` | legacy, no current page |
| `GET /cases/:id` | `CaseRecord` | legacy, no current page |
| `GET /cases/:id/briefing` | `Briefing` | legacy, no current page |
| `GET /cases/:id/pilot-text-ai-consent` | `PilotTextAiConsent` | legacy, no current page |
| `POST /cases/:id/pilot-text-ai-consent` | `PilotTextAiConsent` | orphan action |
| `GET /cases/:id/goals` | `Goal[]` | schedule context and goal prechecks |
| `GET /cases/:id/sessions` | `SessionWire[]` | legacy, no current page |
| `POST /cases/:id/sessions` | `SessionWire` plus `replayed` | legacy, no current page |
| `GET /participants/:id/programs` | `ParticipantProgramWire[]` | alias, no current page |
| `POST /participants/:id/programs` | `ParticipantProgramCreation` | alias, no current page |
| `POST /sessions/:id/ai/drafts/:version/edit` | `AiDraftMutationWire` | orphan action |
| `GET /participants/:id/briefing?focusSupportCaseId=:case` | `ParticipantBriefingWire` | alias, no current page |
| `GET /beneficiaries` | `{results:AssignedParticipantWire[]}` | alias, no current page |
| `POST /beneficiaries` | `ParticipantProgramCreation` | alias, no current page |
| `GET /beneficiaries/search` | `{results:ParticipantSearchResultWire[]}` | alias, no current page |

### 4.2 Exact DTO key registry

The following names are the wire/client key contracts used above. `?` means the key is optional; `| null` means it is present and nullable. Nested rows are part of the exact shape, not prose examples.

```text
OrganizationProfile = {orgId,orgName|null,programDisplayName|null}
MeWire = {id,orgId,email,role,active,name|null,lastProgramType|null}
MyIdentity/DirectoryUser = {id,orgId,email,role,active,name|null}
AssignedParticipantWire = {beneficiaryId,status,programCount,name|null,phone|null,newSignup}
ParticipantProgramWire = {id,beneficiaryId,programType,status,intakeAt|null,creationKind,
  sourceSupportCase:{id,programType,status}|null,participantName|null,participantPhone|null,
  authorized,assigneeNames:string[],consent:{privacy,recordingAi},consentRecordedAt|null,
  upcomingSchedule:{id,scheduledAt,sessionKind}|null}
ParticipantDetail = {beneficiaryId,name|null,phone|null,programs:ParticipantProgram[]}
ParticipantHubDetail = {beneficiaryId,participantName|null,participantPhone|null,
  participantEmail|null,programs:ParticipantProgramWire[]} → client {beneficiaryId,name|null,phone|null,email|null,programs}
SourceSupportCase = {id,programType,status}
ParticipantGoalTreeCaseWire = {sourceSupportCase,overallGoal|null,
  overallGoalRevisions:GoalRevisionEntry[],goals:ParticipantGoalTreeGoal[]}
ParticipantGoalTreeGoal = {id,title,status,closedReason|null,closedAt|null,
  revisions:GoalRevisionEntry[],sessionGoals:{id,body,scheduledAt,scheduleStatus}[],
  linkedSessions:{sessionId,heldAt,oneLiner|null}[]}
GoalRevisionEntry = {title|null,editedByName|null,editedAt}
ParticipantBriefingWire = {beneficiaryId,focusSupportCaseId,overallGoal|null,
  activeGoals:{id,title}[],canEditOverallGoal,participant:{name|null,phone|null},
  sections:ParticipantBriefingSection[],focusUpcomingSchedule:BriefingUpcomingSchedule|null}
ParticipantBriefingSection = {sourceSupportCase,gasTrend:{goalId,goalTitle,status,closedAt|null,
  points:{heldAt,score}[]}[],lastSessionSummary:{source,text,pendingApprovalCount}|null,
  pendingReviewSessionIds:string[],openActionItems:{id,description,owner,dueDate|null,sessionId|null}[],
  flags:{id,flagType,source,reviewStatus,sessionId|null,quote|null}[],
  aiSuggestions:{title,reason|null,sessionId,heldAt|null,sourceQuotes:string[]}[],
  sessionRows:{sessionId,heldAt,kind,aiOneLiner|null,memoExcerpt|null}[],
  discrepancies:{id,kind,left:{sessionId,heldAt,quote},right:{sessionId,heldAt,quote},
    detectedAt,resolution:{status,resolvedAt}|null}[]}
BriefingUpcomingSchedule = {id,scheduledAt,sessionKind,channel,
  sessionGoals:{body,caseGoalId|null,caseGoalTitle|null,caseGoalStatus|null}[],customQuestions:string[]}
SupportCaseRecordsWire = {records:SupportCaseRecord[],goals:SupportCaseRecordGoal[],
  schedule:CounselingSchedule|null,recordErrorSessionIds:string[],overallGoal|null,caseStatus,programType}
SupportCaseRecord = {id,heldAt,channel,memo,managerOpinion|null,
  gasScores:{goalId,goalTitle,score}[],actionItems:{id,description,owner,dueDate|null,resolved}[],
  flags:{id,flagType,source,reviewStatus,quote|null}[],
  lifeAreaSnapshot:{areaKey,status,note|null}[],kind,createdAt,aiOneLiner|null,memoExcerpt|null,
  sessionGoals:string[],discrepancies:{id,kind,leftSessionId,rightSessionId,resolutionStatus|null}[]}
SupportCaseRecordGoal = {id,title,status,closedReason|null}
IntakeRecordContextWire = {beneficiaryId,supportCaseId,participant:{name|null,phone|null,email|null},
  sessionSequence,hasIntake,extendedPii:{birthDate|null,region|null,emergencyContact|null,gender|null},
  consent:{privacy,recordingAi},saved:IntakeSavedRecord|null,overallGoal|null,schedule:CounselingSchedule|null}
IntakeSavedRecord = {sessionId,heldAt,channel,answers,debts,linkedOrgs,additionalItems,managerOpinion|null}
AiDraftMutationWire = {version,origin,creationMode,summaryText,claims,oneLiner|null,
  reviewDecision,questions,evidence:{id,claimKey,quote}[],contrast}
AiDraftGetWire = AiDraftMutationWire + {regenerateAvailable,
  regenerateSourceSnapshotId|null,transcriptQuality:
  {transcriptReliable,warnings:{startSeconds,endSeconds,reason}[]}|null}
AiDraftClientProjection = AiDraftGetWire
TodaySchedulesWire = {date,timeZone,startUtc,endUtc,schedules:TodayScheduleWire[]}
TodayScheduleWire = {id,beneficiaryId,supportCaseId,scheduledAt,programType,status,
  participantName|null,participantPhone|null,sessionKind,completedSessionId|null}
ScheduleCandidate = {beneficiaryId,supportCaseId,programType,participantName|null,
  participantPhone|null,participantEmail|null,intakeAt|null}
ScheduleSessionPlanWire = {scheduleId,beneficiaryId,supportCaseId,scheduledAt,status,version,
  sessionKind,channel,sessionGoals:{id,body,caseGoalId|null,caseGoalTitle|null,ordinal}[],
  customQuestions:{id,body,ordinal}[]}
CounselingScheduleWire = {id,beneficiaryId,supportCaseId,scheduledAt,status,version}
SupportCaseClosureInfo = {supportCaseId,beneficiaryId,status,closedAt|null,closedReason|null,
  purgeDue|null,purgedAt|null,hasOtherActiveSupportCase}
AssignmentRequestWire = {id,supportCaseId,beneficiaryId,participantName|null,programType,
  role,status:'requested',requestedAt}
SupportCaseAssigneeWire = {id,supportCaseId,userId,role,status,acceptanceRequestedBy|null,
  acceptedAt|null,transferReason|null,notifiedBy|null,notifiedAt|null,assignedAt}
CounselorAssignments = {userId,participants:{beneficiaryId,supportCaseId,programType,status,
  assignmentRole,participantName|null,participantPhone|null}[]}
ParticipantSelfCheck = {name|null,phone|null,email|null,
  programs:{programType,counselorName|null,consent:{privacy,recordingAi}}[],
  upcomingSchedules:{id,scheduledAt,status}[],pastSchedules:{id,scheduledAt,status}[]}
PublicInviteInfo = {programType}
PublicWorkerInviteInfo = {orgName|null}
PublicSignupResult = {beneficiaryId,supportCaseId}
WorkerSignupResult = {userId,email}
InviteTokenWire = {token,kind,orgId,programType|null,issuedBy,status,issuedAt,
  usedAt|null,revokedAt|null,usedByBeneficiaryId|null}
PreviewUnlockWire = {token,maxAgeSeconds,expiresAt}
PreviewUnlockResultClient = {token,maxAgeSeconds}; web adapter currently drops expiresAt
ParticipantProgramCreation = {beneficiaryId,supportCaseId,assignmentRole,replayed}
CreateCounselingRecordResult = {record:{id,heldAt,channel,memo},replayed}
CreateIntakeRecordResult = {record:{id,heldAt,channel,kind},replayed}
CreatedIntakeRecord = {id,heldAt,channel,kind}
ParticipantConsent = {privacy,recordingAi}
ParticipantBasicInfo = {beneficiaryId,supportCaseContextId,version,name|null,phone|null,
  email|null,account|null,birthDate|null,region|null,gender|null}
ParticipantPiiVault = {beneficiaryId,version,purgeDue|null,purgedAt|null}
Goal = {id,caseId,title,status,closedAt|null,closedReason|null}
OpenActionItemWire = {id,caseId,sessionId|null,description,owner,dueDate|null,resolvedAt|null}
OpenActionItem = {id,description,owner,dueDate|null}
SessionWire = {id,caseId,counselorId,heldAt,channel,memo|null,aiStatus,transcript|null,
  aiSummary|null,aiSchema|null,aiContrast|null,emotionScores|null,speakerMappingConfirmedAt|null,
  approvedAt|null,approvedBy|null,extra|null,aiGasEvidence?,lifeAreaSnapshot?}
SessionDiscrepancyWire = {id,supportCaseId,kind,triggerSessionId,leftSessionId,leftQuote,
  rightSessionId,rightQuote,detectedAt,resolutionStatus|null,resolvedBy|null,resolvedAt|null}
SupportCase = {id,orgId,beneficiaryId,legacyCaseId|null,programType,status,intakeAt|null,
  consentRecordingAt|null,consentTextAiAt|null,consentPrivacyAt|null,overallGoal|null,
  closedAt|null,closedReason|null,creationKind,createdAt|null,updatedAt|null}
PilotTextAiConsent = {caseId,status,evidenceId|null,noticeVersion|null,noticeHash|null,
  evidenceHash|null,effectiveAt|null}
ParticipantSearchResultWire = {beneficiaryId,status,programCount,name|null}
PrivacyConsentFollowUp = {supportCaseId,beneficiaryId,programType,status,
  emergencyRegistrationAt|null,consentPrivacyDueAt|null,overdue}
PipelineJob = {id,caseId,status,audioAvailable}
PipelineHealth = {orgId,lastPolledAt|null,lastCompletedAt|null,stale,status,staleReasons,
  pendingJobCount,pendingTextWorkCount,pendingTotalCount,oldestPendingSince|null,
  oldestPendingHours|null,thresholdHours,queueThresholdHours}
TextWorkItem = {id,sessionId,reason,enqueuedAt,leaseExpiresAt,attemptCount}
TextWorkSource = {sessionId,text}
MaskedSourceSnapshot = {id,caseId,sessionId,maskedText,sha256,maskingPipelineVersion,
  createdAt,evidence:{id,sourceRef,sourceSha256,evidenceQuote,sourceStart,sourceEnd}[]}
MaskedSourceAck = {sourceSnapshotId,sha256,maskingPipelineVersion,evidenceIds:string[]}
ParticipantPiiRetentionReview = {beneficiaryId,status,archivedAt,reviewDueAt,retentionCapDueAt,
  reasonKind|null,retainUntil|null}
Briefing = {caseId,gasTrend,lastSessionSummary|null,openActionItems,flags,questions}
CaseRecord = {id,programType,status,intakeAt|null}

```

### 4.3 PII field authorization matrix

This is an allowlist, not a statement that a role may read every field in the database. A field may be serialized only in the listed DTO, route and Actor condition.

| DTO.field | authorized Actor | route |
|---|---|---|
| `MyIdentity.name` | authenticated actor itself | `GET /me` on `/`, any `/admin/**` layout route, `/settings`, `/onboarding`, `/participants/new`, `/participants/:id/programs/:case/records/intake` |
| `DirectoryUser.name` | `admin` for directory, self for own identity | `GET /users`, `POST /users`, `/settings` directory |
| `ParticipantProgramWire.assigneeNames` | `admin` or `counselor` with at least one assigned case for beneficiary; names are display-only | `GET /participants/:id/hub`, `GET /participants/:id/support-cases`, `GET /participants/:id/programs` alias |
| `GoalRevisionEntry.editedByName` | `admin` or active case-assigned `counselor` | `GET /participants/:id/goal-tree` |
| `ParticipantSelfCheck.programs.counselorName` | production: participant token holder, no Actor/Bearer; Preview: token plus preview `Actor` from `ccc_preview` | `GET /invites/participant/:token/me` |
| `WorkerSignupResult.email` | production: valid worker invite token holder, no Actor/Bearer; Preview: token plus preview `Actor` from `ccc_preview` | `POST /invites/worker` |
| `ParticipantSearchResultWire.name` | `admin` or assigned `counselor` | `GET /participants/search`, `GET /beneficiaries/search` |
| `AssignedParticipantWire.name`, `.phone` | `admin` or assigned `counselor` | `GET /participants`, `GET /beneficiaries` alias |
| `ParticipantProgramWire.participantName`, `.participantPhone` | `admin` or case-authorized human | `GET /participants/:id/support-cases`, `GET /participants/:id/programs` alias |
| `MyIdentity.email` | authenticated actor itself | `GET /me` on `/`, any `/admin/**` layout route, `/settings`, `/onboarding`, `/participants/new`, `/participants/:id/programs/:case/records/intake` |
| `DirectoryUser.email` | `admin` for directory, self for own settings response | `GET /users`, `POST /users`, `/settings` directory |
| `AssignmentRequest.participantName` | authenticated requesting `counselor` or `admin` | `GET /assignment-requests` |
| `ParticipantBriefingWire.participant.name`, `.phone` | `admin` or active case-assigned `counselor` | canonical `GET /participants/:id/programs/:case/briefing`, alias `GET /participants/:id/briefing?focusSupportCaseId=:case` |
| `ParticipantDetail.name`, `.phone` | `admin` or active case-assigned `counselor` | `GET /participants/:id/support-cases` as consumed by records/new/review |
| `ParticipantHubDetail.name`, `.phone`, `.email` | `admin` or human with at least one assigned case for beneficiary | `GET /participants/:id/hub` |
| `ParticipantBasicInfo.name`, `.phone`, `.email`, `.account`, `.birthDate`, `.region`, `.gender` | `admin` or active case-assigned `counselor` | `GET/PUT /participants/:id/basic-info` |
| `IntakeRecordContextWire.participant.{name,phone,email}` | `admin` or active case-assigned `counselor` | `GET /support-cases/:id/records/intake` |
| `IntakeRecordContextWire.extendedPii.birthDate`, `.region`, `.emergencyContact`, `.gender` | `admin` or active case-assigned `counselor` | `GET /support-cases/:id/records/intake` |
| `ScheduleCandidate.participantName`, `.participantPhone`, `.participantEmail` | `admin` or assigned `counselor` | `GET /schedules/candidates` |
| `TodayScheduleWire.participantName`, `.participantPhone` | `admin` or assigned `counselor` | `GET /schedules/today`, `/upcoming`, `/month` |
| `ParticipantSelfCheck.name`, `.phone`, `.email` | production: participant represented by consumed token, no Actor/Bearer; Preview: same token plus preview `Actor` from `ccc_preview` | `GET /invites/participant/:token/me` |
| `PublicInviteInfo.programType` | production: valid participant invite token, no Actor/Bearer; Preview: token plus preview `Actor` from `ccc_preview` | `GET /invites/participant/:token` |
| `PublicWorkerInviteInfo.orgName` | production: valid worker invite token, no Actor/Bearer; Preview: token plus preview `Actor` from `ccc_preview` | `GET /invites/worker/:token` |
| `CounselorAssignments.participants.participantName`, `.participantPhone` | `admin` | `GET /users/:id/assignments` |

No other route may add a PII field by reusing a broader gateway object. In particular, `ParticipantHubDetail.email` is hub-only, public join is token-only, and service `Actor` never satisfies a human PII row.

## 5. 현재 화면과 직접 연결되지 않는 계약 행

These are explicit `unmapped-by-current-page` rows. They are not implementation TODOs. E2-1 records them so E2-7 can either remove the legacy surface or preserve its caller deliberately.

| kind | exact method/path or symbol | wire DTO / Actor | current mapping and owner |
|---|---|---|---|
| contract observation | AI mutation client cast | `POST /sessions/:id/ai/generate`, `/ai/drafts/:version/review`, `/ai/drafts/:version/edit` return `AiDraftMutationWire`, while current client cast names `AiDraft` and therefore expects GET-only regenerate/source/transcript fields; all three server actions ignore the response body | E2-1 mismatch probe |
| server action | `recordPilotTextAiConsentAction` → `POST /cases/:id/pilot-text-ai-consent` | `PilotTextAiConsent`, human Actor | page caller 0; E2-7 legacy deletion |
| server action | `editAiDraftAction` → `GET /sessions/:id`, `POST /sessions/:id/ai/drafts/:version/edit` | `SessionWire`, `AiDraftMutationWire`, human Actor | page caller 0; E2-7 legacy deletion |
| server action | `createSubsequentParticipantProgramAction` → `POST /participants/:id/support-cases` | `ParticipantProgramCreation`, human Actor | page caller 0; E2-7 legacy deletion |
| server action | `createCounselingScheduleAction` → `POST /schedules` | `CounselingScheduleWire`, human Actor | replaced by `createSchedulePlanAction`; E2-7 legacy deletion |
| API | `GET /health` | `{status:'ok',service:'ccc-api'}`, no Actor | liveness only; E2-7 deletion/relocation |
| API | `GET /participants/search` | `{results:ParticipantSearchResultWire[]}`, human Actor | current list uses client filtering; E2-7 legacy deletion |
| API | `GET /consent/follow-ups` | `{results:PrivacyConsentFollowUp[]}`, `admin` or assigned `counselor` | legacy consent report; E2-7 legacy deletion |
| API | `PATCH /schedules/:id/reschedule` | `CounselingScheduleWire`, human case-authorized Actor | no current page; E2-7 legacy deletion |
| API | `POST /schedules/:id/cancel` | `CounselingScheduleWire`, human case-authorized Actor | no current page; E2-7 legacy deletion |
| API | `POST /schedules/:id/no-show` | `CounselingScheduleWire`, human case-authorized Actor | no current page; E2-7 legacy deletion |
| API | `POST /support-cases/:id/force-transfer` | `{transferred:true}`, `admin` Actor | no current page; E2-7 legacy deletion |
| API | `POST /sessions/:id/ai/source` | `MaskedSourceAck` `{sourceSnapshotId,sha256,maskingPipelineVersion,evidenceIds}`; `service` Actor only | Agent ingestion; E2-7 relocation |
| API | `PUT /sessions/:id/audio` | `SessionWire`, human case-authorized Actor | recording upload API; E2-7 relocation |
| API | `POST /sessions/:id/approve` | `SessionWire`, human Actor | legacy approval endpoint; E2-7 legacy deletion |
| API | `GET /pipeline/health` | `PipelineHealth`, `admin` Actor | admin watchdog API, no current page; E2-7 relocation |
| API | `GET /pipeline/jobs` | `{jobs:PipelineJob[]}`, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `GET /pipeline/text-jobs` | `{jobs:TextWorkItem[]}`, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `GET /pipeline/text-jobs/:item/source` | `TextWorkSource`, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `POST /pipeline/text-jobs/:item/complete` | 204 empty, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `GET /pipeline/jobs/:sessionId/audio` | audio bytes or `{error:'audio_object_missing',jobId}`, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `POST /pipeline/jobs/:sessionId/result` | 204 empty, `service` Actor | service queue API, no current page; E2-7 relocation |
| API | `GET /pii-retention/reviews` | `{reviews:ParticipantPiiRetentionReview[]}`, `admin` Actor | retention queue, no current page; E2-7 relocation |
| API | `POST /pii-retention/reviews/:id` | `ParticipantPiiRetentionReview`, `admin` Actor | retention queue, no current page; E2-7 relocation |
| API | `POST /users/:id/deactivate` | `DirectoryUser`, `admin` Actor | no current page; E2-7 legacy deletion |
| legacy API | `GET /cases` | `CaseRecord[]`, human Actor | no current page; E2-7 legacy deletion |
| legacy API | `POST /cases` | `CaseRecord`, human Actor | no current page; E2-7 legacy deletion |
| legacy API | `GET /cases/:id` | `CaseRecord`, human Actor | no current page; E2-7 legacy deletion |
| legacy API | `GET /cases/:id/briefing` | `Briefing`, human case-authorized Actor | superseded by participant briefing; E2-7 legacy deletion |
| legacy API | `GET /cases/:id/pilot-text-ai-consent` | `PilotTextAiConsent`, human Actor | no current page; E2-7 legacy deletion |
| legacy API | `POST /cases/:id/pilot-text-ai-consent` | `PilotTextAiConsent`, human Actor | orphan action only; E2-7 legacy deletion |
| legacy API | `GET /cases/:id/sessions` | `SessionWire[]`, human Actor | no current page; E2-7 legacy deletion |
| legacy API | `POST /cases/:id/sessions` | `SessionWire` + `replayed`, human Actor | no current page; E2-7 legacy deletion |
| API alias | `GET /participants/:id/programs` | `ParticipantProgramWire[]`, human Actor | `/support-cases` is canonical; E2-7 alias deletion |
| API alias | `POST /participants/:id/programs` | `ParticipantProgramCreation`, human Actor | `/support-cases` is canonical; E2-7 alias deletion |
| API alias | `GET /participants/:id/briefing?focusSupportCaseId=:case` | `ParticipantBriefingWire`, human Actor | `/programs/:case/briefing` is canonical; E2-7 alias deletion |
| API alias | `GET /beneficiaries` | `{results:AssignedParticipantWire[]}`, human Actor | `/participants` is canonical; E2-7 alias deletion |
| API alias | `POST /beneficiaries` | `ParticipantProgramCreation`, human Actor | `/participants` is canonical; E2-7 alias deletion |
| API alias | `GET /beneficiaries/search` | `{results:ParticipantSearchResultWire[]}`, human Actor | `/participants/search` is canonical; E2-7 alias deletion |



## 6. 세 모드에서 어떻게 다른가

| | Community Cloud | Local Single | Local Office |
|---|---|---|---|
| 업무 화면 route | 동일한 30개 inventory와 동일한 screen/API/DTO map | 동일 | 동일 |
| 인증 표면 | Cloudflare Access JWT → `Actor` | OS 사용자·앱 잠금이 local identity adapter에서 `Actor`로 변환 | Argon2id 계정·관리자 MFA가 local identity adapter에서 `Actor`로 변환 |
| 공개 route | 공개 join은 `PUBLIC_SIGNUP_ENABLED=1`일 때만; preview/welcome은 셸 없음 | 같은 route 계약, 단 local bootstrap/identity | 같은 route 계약, 단 local bootstrap/identity |
| API transport | 정적 client가 Bearer API를 호출, Cloudflare service binding 가능 | loopback HTTPS/Bearer | 내부망 HTTPS/Bearer |
| DTO·권한 | 차이 없음. 저장소·identity 경계만 다름 | 차이 없음 | 차이 없음 |
`docs/adr/0042-supabase-read-only-preflight.md`의 `pnpm supabase:bootstrap -- plan`은 화면/API 대응표를 바꾸지 않는 배포 전 read-only 확인이다. `apply`, `verify`, `status`를 이 표의 화면 operation으로 세지 않으며, plan의 시크릿·기존 데이터·리전 검사는 Cloud 자원 확인 계약으로만 남긴다.

## 7. 완료 조건

- [ ] `route-inventory.json`의 30개 page entry가 §3에 정확히 한 번 있고, 합계가 22 authenticated operating + 5 public + 2 redirect + 1 kit으로 재현된다.
- [ ] `access`, `public-join`, `public-preview`, `public-welcome`, `kit`의 credential·Actor 규칙과 공개 셸 제외가 문서에 고정되어 있다.
- [ ] 각 화면 행에 API method/path, DTO, server action과 E2 owner가 있다. redirect 행에는 렌더링 화면 API/DTO를 두지 않으며, `/`의 선언된 `GET /me` prerequisite만 예외다.
- [ ] §4의 DTO key 집합과 §5의 orphan action/service API 계약 행으로 E2-1 probe가 누락·중복을 판정할 수 있다.
- [ ] Community Cloud, Local Single, Local Office에서 route와 DTO는 같고 identity/transport만 다르다는 규칙이 고정되어 있다.
- [ ] `확정`은 계약 문서 완결 상태이며 실제 client 이식·probe 실행 결과를 뜻하지 않는다.

## 8. 검증 방법

구현 검증 시 저장소 루트에서 E2-1 probe를 실행한다.

- route inventory의 `routePattern` set과 §3 route key set을 비교한다. 차집합 또는 중복이 있으면 실패다.
- `page.tsx`의 API client import/call, JSX `action`, `actions.ts`의 exported action, request-handler method/path를 추출해 §3·§4와 비교한다. 화면 API 또는 DTO가 표에 없으면 실패다.
- 공개 route에서 `CF_Authorization`, `accessHeaders`, `OrganizationProfile`, `new-signup-count`, 업무 셸 import가 발견되면 실패다.
- 22/5/2/1 subtotal, `/preview/unlock` 별도 행, §5 orphan 행 수가 기대값과 다르면 실패다.
- 각 API response key가 §4 DTO key 집합과 다르면 실패다. PII 허용 여부는 단순 경로 목록이 아니라 §4.3의 DTO.field·Actor·route matrix와 exact match해야 한다.

실행 명령과 실제 probe·runtime 증거는 E2-1 구현 검증 때 기록한다. 이 문서의 `확정` 판정은 명령 정의와 기대 실패 조건이 닫힌 것으로 충분하다.

## 9. 이번에 안 하는 것

Vite client 이식, API decoder 구현, route 삭제, public site 분리, 세 모드의 실제 인증 어댑터 구현은 각각 E2-2~E2-7과 E1-7의 소유다. request-handler의 service-only API에 화면을 새로 만들지 않으며, §5의 현재 미연결 행을 임의 화면이나 가짜 DTO로 채우지 않는다.
