# S3: 화면, 서버 액션, API 대응표

- 상태: SG3의 승인된 안전 계약을 유지한 현행 대응표. CCC-201의 전체 완료 판정은 §7의 실제 증거와 미검증 범위를 따른다.
- 제품 기준: `beta-core-parity@7c7b632dc5b0a1cd6d7ff2ade4a15eaa3e6ecd07`. 실행용 임시 사본은 이 커밋의 archive 바이트와 일치한다. 제품 checkout에는 쓰지 않았다.
- 요구 정본: [Master E2](../../CCC_OPEN_PILOT_PLAN.md), [완료된 SG3](../superpowers/plans/2026-09-02-SG3-screen-api.md), [Relayer 적용 계획](../superpowers/plans/2026-09-12-relayer-domain-ai-replan.md), [카드 계약](../superpowers/specs/2026-09-12-relayer-card-ai-contract-design.md).
- 증거: [동결 입력](../../artifacts/ccc201-screen-api/freeze.json), [정적 심벌 경로](../../artifacts/ccc201-screen-api/coverage.json), [실제 API 응답](../../artifacts/ccc201-screen-api/runtime.json), [Next 30경로](../../artifacts/ccc201-screen-api/web.json), [공개 middleware](../../artifacts/ccc201-screen-api/public.json).
- `현재 호출됨`, `계약에 맞음`, `실제로 검증함`은 다른 판정이다. 소스의 결함을 기대값으로 바꾸지 않는다. 문서 대응 누락 0건을 제품 결함 0건으로 보고하지 않는다.

## 1. 바뀌지 않는 안전 계약

1. 업무 DB의 권한, 기관/사례 범위와 감사는 gateway가 검사한다. 셸 역할 필터나 보이지 않는 버튼은 서버의 거부를 대신하지 않는다. 수기는 저장 즉시 공식이며 AI 출력은 해당 초안 승인 전 공식 조회에 들어오지 않는다(R1/R2).
2. 사람의 역할 합과 담당/감독 관계를 구별한다(D74). 기관 관리자의 상담 읽기 권한은 비담당 쓰기 권한이 아니다. 담당 실무자의 쓰기, 기술 관리자 비노출, restricted 허브의 최소 정보 범위를 유지한다. 아래 구 Next 행의 `admin/counselor`는 잔존 코드의 경로 표기이지 D74의 권한을 축소하거나 확대하는 새 결정이 아니다.
3. 공개 화면에는 업무 sidebar/header/back-link와 기관 profile/새 가입 수를 렌더하지 않는다. middleware는 모든 요청에서 `x-ccc-public`을 직접 세우거나 지워야 한다. 외부 입력의 표식을 신뢰하지 않는다.
4. 당사자 요청 링크의 자격은 token이다. 일반 업무 Bearer/Access를 전달하지 않는다. Preview에서는 먼저 preview Actor를 검증하며 web client는 `ccc_preview`만 API에 전달해야 한다. 현재 그 전달이 없는 결함은 E2-5c/CCC-215에 남긴다.
5. D86의 실무자 초대는 `staff-invites`다. 공개 수락에서 선택적인 Auth 증거는 검증된 subject를 본인 이메일에 결합하는 별도 경계다. 이를 공개 페이지의 업무 셸 인증이나 임의 Bearer 허용으로 확대하지 않는다. 폐기된 worker/signup 자기 확인 경로를 되살리지 않는다.
6. nullable 필드는 존재하며 null일 수 있다. optional 필드는 생략될 수 있다. envelope를 배열로 평탄화한 client DTO는 원래 wire와 같은 형식이 아니다. 실제 serializer와 decoder가 다르면 차이를 기록하고 해당 소비자를 고쳐야 한다.
7. AI-off, `sttEngine=null`, 실제 동의/NER/서명 registry, 미승인 제외와 외부 전송 제한은 유지한다. S5/S6 문서 존재만으로 집행을 증명하지 않는다. CCC-237/238/239의 FAIL과 CCC-292/299 차단은 이 티켓으로 해소되지 않는다.

## 2. 경로 개수와 상속

현재 Next page는 30개이며 inventory와 1:1이다. 인증 운영 화면 22개, 공개 page 5개, redirect-only 2개, `/kit` 1개다. 계획의 ‘29개 + kit’은 공개/redirect를 포함한 page entry 집합이지 운영 화면 29개라는 관찰이 아니다. `/preview/unlock`은 별도 Route Handler 1개다. SCR CSV 21레코드와 client route 수는 별도 집합이다.

- RootLayout: `apps/web/app/layout.tsx:1271-1335`. 비공개 분기는 `getDisplayLabels`를 통한 `GET /organization/profile`과 `GET /participants/new-signup-count`를 시도한다. `AppHeader`, `AppSidebar`, `BackLink`, `NextLinkProvider`가 렌더 경로다. `+shell-actions`는 `toggleThemeAction`, `logoutAction`이다.
- AdminLayout: `apps/web/app/admin/layout.tsx:12-39`. `GET /me`의 `roles`를 사용해 메뉴가 없으면 notFound다. `+admin-layout`은 이 조회/역할 검사를 뜻한다.
- 공개 RootLayout 분기는 위 호출과 셸을 건너뛴다. 정적 import closure에는 양쪽 분기가 모두 잡히므로 `withLayouts`만 보고 공개에서 실행됐다고 판정하지 않는다.
- redirect는 화면 HTML을 남기지 않지만, Next가 조상 layout을 실행하면서 셸 API를 시도할 수 있다. 실제 `/`는 profile/me/count 세 호출 뒤 307, `schedule/all`은 profile/count 두 호출 뒤 307이었다. 선언된 목적지 선택의 `/me`와 조상 실행을 별도로 센다. 이것을 렌더된 화면 데이터로 세지 않는다.
- `coverage.json`은 page별 direct closure와 조상 layout closure, 참조의 원본 파일/줄, API helper, action, 호출 표현식과 source hash를 보존한다. 30개 page의 실제 렌더 호출은 `web.json`의 별도 `apiCalls`에 있다. query는 page 수를 늘리지 않는다.
- server action은 `actions.ts`의 34 exports, logout/theme 두 exports와 records/new의 내부 `submitRecord` 1개를 구별한다. orphan 4개도 삭제하지 않고 §5에 기록한다.

## 3. Next page별 실제 호출 대응

행의 API/DTO 이름은 §4의 현행 serializer/계약을 가리킨다. 폐기된 endpoint를 호출하는 잔존 action도 숨기지 않는다. 비공개 행은 §2의 공통 호출을 상속하고, 공개 행은 실제 RootLayout의 공개 분기를 따른다. action별 request parser와 반환은 아래 endpoint ledger의 고정 소스를 따른다.

| # | route pattern, 화면 분류 | 인증 표면, Actor | 화면 API와 DTO | server action → API, DTO | E2 owner |
|---:|---|---|---|---|---|
| 1 | `/` non-screen redirect | `access`; human `admin\|counselor` | declared prerequisite `GET /me` (wire `MeWire`, required nullable `lastProgramType` selects destination) | 없음; `+shell-actions` | E2-1 |
| 2 | `/admin` 관리자 기관 홈 | `access`; `admin` `+admin-layout` | `GET /organization/profile` (`OrganizationProfile`), `GET /users` (`DirectoryUser[]`) | 없음; `+shell-actions` | E2-5a |
| 3 | `/admin/ai-provider` AI 사업자 | `access`; `admin` `+admin-layout` | `GET /ai/provider/status` (`AiProviderStatus`), `GET /capabilities` (전체 CapabilityManifest → SttStatus 투영) | `activateAiProviderRuntimeAction` → `POST /ai/provider/activate-runtime` (`void`); `+shell-actions` | E2-5a |
| 4 | `/admin/assign` 배정 | `access`; `admin` `+admin-layout` | `GET /schedules/candidates` (wire `{candidates: ScheduleCandidate[]}`), `GET /users` (`DirectoryUser[]`), 선택 시 `GET /support-cases/:id/assignees` (wire `{assignees: SupportCaseAssigneeWire[]}`) | `addSupportCaseAssigneeAction` → `POST /support-cases/:id/assignees` (`SupportCaseAssignee`); `+shell-actions` | E2-5a |
| 5 | `/admin/invite` 실무자 초대·등록 | `access`; `admin` `+admin-layout` | 없음 | `registerCounselorAction` → `POST /users` (`DirectoryUser`); `createWorkerInviteAction` → 폐기된 `POST /invites/counselor` (404; 후속은 staff-invites); `+shell-actions` | E2-5a |
| 6 | `/admin/users` 사용자 목록 | `access`; `admin` `+admin-layout` | `GET /users` (`DirectoryUser[]`), 선택 시 `GET /users/:id/assignments` (`CounselorAssignments`) | 없음; `+shell-actions` | E2-5a |
| 7 | `/admin/users/:id` 사용자 상세 | `access`; `admin` `+admin-layout` | `GET /users` (`DirectoryUser[]`), `GET /users/:id/assignments` (`CounselorAssignments`) | 없음; `+shell-actions` | E2-5a |
| 8 | `/join/participant/:token` 공개 participant 요청 링크 | `public-join`; production token, Preview 별도 Actor | `GET /invites/participant/:token`의 issued/used 합집합. web은 구 PublicInviteInfo의 programType만 요구 | `signupParticipantAction` → `POST /signup/participant`; 구 `consent:{privacy,recordingAi}`는 현 consentEvents parser와 불일치해 거부됨 | E2-5c |
| 9 | `/join/worker/:token` 공개 실무자 가입 | `public-join`; 폐기된 worker API를 호출하는 잔존 공개 page | `GET /invites/worker/:token` (`PublicWorkerInviteInfo`) | `signupWorkerAction` → 폐기된 `POST /invites/worker` (404) | E2-5c |
| 10 | `/kit` component kit, 운영 화면 아님 | `kit`; human `admin\|counselor` because business shell | route API 없음 | `+shell-actions` | E2-1 |
| 11 | `/onboarding` 기관·사업 이름 | `access`; `admin` | `GET /me` (`MyIdentity`), `GET /organization/profile` (`OrganizationProfile`) | `completeOrganizationOnboardingAction` → `POST /organization/onboarding` (`OrganizationProfile`); `+shell-actions` | E2-5a |
| 12 | `/participants` 당사자 목록, 인증 운영 화면 | `access`; human `admin\|counselor` | `GET /participants` (wire `{results: AssignedParticipantWire[]}` → client `AssignedParticipant[]`) | 없음; `+shell-actions`. 검색은 수신 목록의 client filter이며 `GET /participants/search`를 부르지 않는다 | E2-4a |
| 13 | `/participants/invite` 당사자 초대 | `access`; human `admin\|counselor` (gateway가 발급 권한 판정) | 없음 | `createParticipantInviteAction` → `POST /invites/participant` (`ParticipantInvite`); `+shell-actions` | E2-4a |
| 14 | `/participants/new` 당사자·첫 참여사업 등록 | `access`; human `admin\|counselor` | `GET /me` (`MyIdentity`) | `createInitialParticipantProgramAction` → 내부 `GET /me` 후 `POST /participants` (`ParticipantProgramCreation`), 성공 시 `/schedules/new?target=...`; `+shell-actions` | E2-4a |
| 15 | `/participants/:beneficiaryId` 당사자 정보 허브 | `access`; human, 최소 1개 담당 케이스 또는 `admin` | `GET /participants/:id/hub` (`ParticipantHubDetail`), `GET /participants/:id/goal-tree` (wire `{cases: ParticipantGoalTreeCaseWire[]}` → client `ParticipantGoalTreeCase[]`) | `updateParticipantConsentAction` → 폐기된 `PUT /support-cases/:id/consent` (404; 새 계약은 consent-events); `+shell-actions` | E2-5b |
| 16 | `/participants/:beneficiaryId/edit` 기본정보 수정 | `access`; `admin` 또는 해당 당사자의 활성 담당 `counselor` | `GET /participants/:id/basic-info` (`ParticipantBasicInfo`) | `updateParticipantBasicInfoAction` → `PUT /participants/:id/basic-info` (`void`); `+shell-actions` | E2-5b |
| 17 | `/participants/:beneficiaryId/programs/:supportCaseId/briefing` 15초 페이지 | `access`; 사례 읽기 권한, 쓰기는 별도 담당 검사 | `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`) | `updateOverallGoalAction` → `PUT /support-cases/:id/overall-goal`; `resolveDiscrepancyAction` → `PUT /support-cases/:id/discrepancies/:discrepancyId/resolution`; `+shell-actions` | 화면 E2-4b/CCC-210; 목표/사례 쓰기 E2-5b/CCC-206 |
| 18 | `/participants/:beneficiaryId/programs/:supportCaseId/close` 케이스 종결 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/closure` (`SupportCaseClosureInfo`), `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`), `GET /participants/:id/goal-tree` (wire `{cases: ParticipantGoalTreeCaseWire[]}` → client `ParticipantGoalTreeCase[]`) | `closeSupportCaseAction` → `POST /support-cases/:id/close` (`SupportCase` wire, close response projection `{ id,status,closedAt }`); `+shell-actions` | E2-5b |
| 19 | `/participants/:beneficiaryId/programs/:supportCaseId/records` 전체 상담 기록 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/records?official=true` (`SupportCaseRecords`), `GET /participants/:id/support-cases` (wire `ParticipantProgram[]` → screen `ParticipantDetail`) | `+shell-actions` | E2-4c |
| 20 | `/participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review` AI 초안 검토 | `access`; `admin` 또는 케이스 활성 담당 `counselor`, AI review는 human만 | `GET /support-cases/:id/records?official=true` (`SupportCaseRecords`), `GET /participants/:id/support-cases` (wire `ParticipantProgram[]` → screen `ParticipantDetail`), `GET /sessions/:sessionId/ai` (`AiDraft`) | `reviewAiDraftAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /sessions/:id/ai/drafts/:version/review` (`AiDraftMutationWire`); `generateAiDraftAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /sessions/:id/ai/generate` (`AiDraftMutationWire`); `createActionItemFromAiClaimAction` → precheck `GET /sessions/:id` (`ManualSession`), then `POST /cases/:id/action-items` (`OpenActionItem`); `+shell-actions` | E2-4c |
| 21 | `/participants/:beneficiaryId/programs/:supportCaseId/records/intake` 인테이크 | `access`; `admin` 또는 케이스 활성 담당 `counselor` | `GET /support-cases/:id/records/intake` (`IntakeRecordContext`), `GET /me` (`MyIdentity`, optional recorder label) | `createIntakeRecordAction` → precheck `GET /participants/:id/support-cases` (`ParticipantProgram[]`), then `POST /support-cases/:id/records/intake` (`CreateIntakeRecordResult`); `updateIntakeRecordAction` → precheck same `GET /participants/:id/support-cases` (`ParticipantProgram[]`), then `PUT /support-cases/:id/records/intake` (`{ record: CreatedIntakeRecord }`); changed overall goal only → `PUT /support-cases/:id/overall-goal` (`{ supportCaseId, overallGoal }`); `+shell-actions` | E2-5b |
| 22 | `/participants/:beneficiaryId/programs/:supportCaseId/records/new` 정기 기록 작성 | `access`; 사례 읽기와 담당 쓰기 구별 | `GET /support-cases/:id/records?official=true`, `GET /participants/:id/support-cases`, `GET /schedules/:scheduleId/plan` | `submitRecord` → `createCounselingRecordAction` → 사전 `GET /participants/:id/support-cases`, `POST /support-cases/:id/records`; `createGoalAction` → `POST /cases/:id/goals`; `updateGoalTitleAction` → `PUT /goals/:id/title`; `countGoalUpcomingLinksAction` → `GET /goals/:id/upcoming-links`; `closeGoalAction` → `POST /goals/:id/close`. 목표 actions도 같은 참여사업 사전 조회를 사용; `+shell-actions` | E2-4c, E2-5b |
| 23 | `/preview` 공개 preview 코드 입력 | `public-preview`; no `Actor` | route API 없음 | HTML form `POST /preview/unlock` (web adapter, `PreviewUnlockWire`) → cookie/303 | E2-3 |
| 24 | `/preview/admin` 공개 관리자 preview 코드 입력 | `public-preview`; no `Actor` | route API 없음 | HTML form `POST /preview/unlock` (web adapter, `PreviewUnlockWire`) → cookie/303, 성공 목적지는 `/settings` | E2-3 |
| 25 | `/programs/:programType/schedule` 일정 통합 화면 | `access`; human `admin\|counselor` | `GET /schedules/today` 또는 `GET /schedules/upcoming` 또는 `GET /schedules/month` (`TodaySchedulesWire` → `TodaySchedules`), `PUT /me/last-program` (`{ok:true}`) | 없음; `+shell-actions` | E2-4b |
| 26 | `/programs/:programType/schedule/all` non-screen redirect | `access`; human `admin\|counselor` | 없음 | 없음; `+shell-actions`. `?month=`을 보존해 canonical `/programs/:programType/schedule?view=month`로 redirect | E2-1 |
| 27 | `/schedules/new` 상담 일정 등록 wizard | `access`; human `admin\|counselor` | `GET /schedules/candidates` (wire `{candidates: ScheduleCandidate[]}` → client `ScheduleCandidate[]`) | `loadScheduleContextAction` → `GET /cases/:id/goals` (`Goal[]`) + `GET /participants/:id/programs/:case/briefing` (`ParticipantBriefing`); `createSchedulePlanAction` → `POST /schedules` (`CounselingScheduleWire` → `CounselingSchedule`); `+shell-actions` | E2-4b |
| 28 | `/schedules/:scheduleId/plan` 세션 목표 수정 | `access`; `admin` 또는 일정 케이스 활성 담당 `counselor` | `GET /schedules/:id/plan` (`ScheduleSessionPlanWire` → `ScheduleSessionPlan`), `GET /cases/:id/goals` (`Goal[]`) | `updateScheduleSessionGoalsAction` → `PUT /schedules/:id/plan` (`{scheduleId,version}`); `+shell-actions` | E2-4b |
| 29 | `/settings` 설정·배정 요청 | `access`; human `admin\|counselor` | `GET /me` (`MyIdentity`), `GET /assignment-requests` (wire `{requests: AssignmentRequestWire[]}` → client `AssignmentRequest[]`), admin이면 `GET /users` (`DirectoryUser[]`), institution-admin이면 `GET /settings/counseling-memory` (`MemorySettingsView`) | `acceptSupportCaseAssignmentAction` → `POST /support-cases/:id/assignees/:assignmentId/accept` (`{accepted:true}`); `setCounselingMemorySettingsAction` → `PUT /settings/counseling-memory`, `refreshCounselingMemorySettingsAction` → 같은 GET; `+shell-actions` | E2-5a |
| 30 | `/welcome` 공개 안내 | `public-welcome`; no `Actor` | API 없음 | 없음 | E2-5c |

## 4. 현재 HTTP dispatch와 wire 경계

정본 소스는 `packages/http-api/src/request-handler.ts`의 고정 SHA다. 아래 줄은 그 파일 기준이다. 각 행의 parser/serializer 또는 계약 타입 참조는 실제 입력/출력 정의로 이동하는 경로이며 복사한 DTO가 runtime 증거라는 뜻이 아니다. 실행한 응답의 중첩 key/type/배열 변형은 `runtime.json`과 `web.json`에 별도로 보존한다. 미실행 분기의 optional/null/enum 전체를 이 샘플이 증명하지 않는다.

이 문서의 `*Wire`와 일부 화면 DTO 이름은 설명용 이름이며 새로운 TypeScript 계약이 아니다. [완전한 계약 참조 색인](../../artifacts/ccc201-screen-api/contracts.json)이 각 이름의 실제 producer, serializer, request parser, consumer와 타입 정의의 파일/전체 줄 범위 및 SHA-256을 연결한다. `typeIndex`는 중첩 타입을 따라가는 색인이다. 삭제된 wire는 dead consumer로, 이름 없는 반환값은 실제 inline literal로 구분하며 가짜 공개 타입을 발행하지 않는다. 파일/줄/hash 검사는 의미 검토나 runtime 검증을 대신하지 않는다.

| 설명용 이름 | 실제 입력/출력 정의의 시작점 |
|---|---|
| AiDraftMutationWire / AiDraftGetWire | `request-handler.ts:1534-1563`의 parseAiDraftGeneration/Edit/Review, `aiDraftResponse:1565-1593`; GET만 `3175-3181`의 regenerate/transcript 필드를 추가한다. 중첩 AiDraftVersion은 `gateway.ts:2883-2922` |
| SupportCaseRecordsWire / SupportCaseRecords | `request-handler.ts:2999-3025`의 공식 조회와 inline envelope, `counselingRecordDetailsResponse:1173-1218`; manual 원천의 실제 타입은 contracts/manual-record.ts |
| CounselingScheduleWire | `scheduleResponse`, `request-handler.ts:959-970`. 코어 CounselingSchedule 전체와 같지 않다 |
| ScheduleSessionPlanWire / TodaySchedulesWire | `scheduleSessionPlanResponse:972-997` 및 `gateway.ts`의 AuthoritativeDayInterval/TodayScheduleCard. 각 정의와 소비자는 계약 색인에서 따로 연결한다 |
| ParticipantBriefingWire / ParticipantProgramWire / ParticipantHubDetail | `normalizeParticipantBriefing:999-1112`, `participantProgramResponse:870-896`, `participantHubResponse:898-924`. restricted와 nullable/optional 분기는 합치지 않는다 |
| SessionWire | `sessionResponse:291-294`, 실제 Session에서 audioR2Key를 제외한 반환. client ManualSession은 그중 일부만 소비한다 |

pipeline/jobs와 pipeline/memory의 각 operation도 계약 색인의 별도 entry에서 실제 S5 타입, parser, 반환 producer를 따라간다. STT 내부 시험의 실제 producer는 business handler가 아니라 `apps/pipeline/ccc_pipeline/trial_server.py:601-650`이다. TypeScript 파일만 검색해 producer가 없다고 한 조사 오류를 바로잡았으며, client build/trial-fixtures.mjs의 응답 fixture와 혼동하지 않는다.

이 내부 시험 서버는 업무 `Actor`를 쓰지 않는다. `trial_server.py:671-680`은 Host를 loopback으로 제한하고 Origin이 있으면 그 Host와 같은 Origin인지 검사한다. `684-709`는 엔진, 본인 소유 시험 녹음 선언, Azure의 별도 외부 업로드 확인, 형식/크기/설정과 단일 실행 경계를 검사한다. 이 경로의 source 대조는 제품 STT 활성화·품질·동의 집행 완료가 아니며 이번 CCC-201에서는 원음 제출이나 STT 실행을 하지 않았다.

Actor 기호: **H**는 현재 사람이 인증된 뒤에도 gateway의 기관/사례/역할 검사가 필요한 경계다. **P**는 `PUBLIC_SIGNUP_ENABLED=1`의 당사자 token 경계, **T**는 그 스위치 밖의 실무자 token 경계다. P/T는 Preview에서 먼저 preview Actor를 검증한다. system, service, 사람의 권한은 호환 별칭이 아니다.

현재 `apps/api/src/index.ts:49-71`의 선택 순서는 preview resolver, 이중 잠금된 local-dev resolver, Agent Bearer를 앞에 둔 Access identity다. 일반 업무의 세 모드 인증은 이 잔존 Workers entry와 동일하지 않다. `/me`, `/capabilities`, 계정 관리처럼 원래 IdentityActor를 쓰는 지점과 gatewayActor 투영 뒤의 지점을 구별한다.

| method/path | handler 줄 | request와 실제 return 경계 | Actor 조건 | 기존 소유 |
|---|---|---|---|---|
| `GET /health` | 2226 | {status,service} | 무자격 | E2-7 |
| `GET /invites/participant/:token` | 2262-2271 | `getParticipantRequestLinkInfo`, gateway:21105-21153. issued `{status,programId,programType,orgName,expiresAt}` 또는 used `{status,counselorName,message}`. counselorName은 null 가능하며 발급자 email로 폴백 가능 | P, token 범위만 | E2-5c |
| `GET /invites/participant/:token/consent/disclosures` | 2272-2282 | {disclosures:ConsentDisclosure[]} | P | E2-5c |
| `POST /signup/participant` | 2283-2301 | token/name/phone?/email?/consentEvents → completeParticipantSignup의 201 결과 | P | E2-5c |
| `GET /staff-invites/token/:token` | 2302-2310 | getStaffInvitePublicInfo; 200/no-store | T | E2-5c |
| `POST /staff-invites/token/:token/accept` | 2311-2332 | name/email → acceptStaffInvite의 201 결과; 검증된 Auth subject만 결합 | T | E2-5c |
| `POST /agents/pair`; `POST /agents/token` | 2336-2344 | pairingCode 또는 refreshToken → AgentCredentialGrant; 실패401 | 교환 자격 | E6-4 |
| `POST /internal/scheduler/run` | 2354-2376 | 빈 body 또는 {} → {ranAt,jobs}; Origin 거부 | system/scheduler-secret/scheduler:run | S11 실행 소유자 |
| `POST /internal/storage/authorize` | 2377-2406 | StorageSignerRequest → StorageSignerDecision; Origin 거부 | system/검증된 Bearer/Cloud manifest | S11 실행 소유자 |
| `POST /auth/logout` | 2407-2419 | {} → 204 빈 본문 | human + 검증된 sessionId | E2-3 |
| `GET /capabilities` | 2420-2426 | CapabilityManifest + x-ccc-installation-id; manifest 없으면503 | human; Agent403 | E1-7/E2-3 |
| `GET /me` | 2427-2441 | MeResponse {id,orgId,email,role,active,name,lastProgramType,roles,institution} | 현재 본인 | E2-3 |
| `GET /settings/accounts` | 2442-2450 | DirectoryAccountPage; cursor | 원래 resolvedActor를 보존한 역할 검사 | E2-5a |
| `PATCH /settings/accounts/:userId/roles` | 2456-2462 | roles/expectedRoles → updateDirectoryRoles | 원래 resolvedActor를 보존한 역할 검사 | E2-5a |
| `POST /settings/accounts/:userId/deactivate` | 2463-2467 | reason → deactivateDirectoryAccount | 원래 resolvedActor를 보존한 역할 검사 | E2-5a |
| `GET /program-options` | 2472-2475 | {programs:ProgramOption[]} | H | E2-4a |
| `GET /programs`; `POST /programs`; `PATCH /programs/:id` | 2476-2504 | listPrograms 또는 {program}; 저장/처리 선택, confirmation, staff, financialSupportEnabled를 실제 parser가 검사 | H, 쓰기 기관 관리자 | E2-5a |
| `GET /audit-log` | 2505-2508 | limit/cursor/actorId/from/to/supportCaseId → AuditLogPage {items,nextCursor} | 기관 관리자 | E2-5a; 월간 집계 CCC-301 |
| `POST /schedules` | 2509-2516 | parseScheduleCreate → scheduleResponse | H, 사례 쓰기 | E2-4b |
| `GET /settings/counseling-memory`; `PUT /settings/counseling-memory` | 2517-2530 | MemorySettingsView; PUT은 현 MemorySettingsInput | 기관 관리자 | E2-5a/CCC-291 |
| `GET /organization/profile`; `PATCH /organization/profile` | 2531-2545 | OrganizationProfile; PATCH orgName/expectedOrgName | H, PATCH 기관 관리자 | E2-5a |
| `POST /organization/onboarding` | 2546-2558 | orgName/programDisplayName/financialSupportEnabled → OrganizationOnboardingResponse | 기관 관리자 | E2-5a |
| `PUT /me/last-program` | 2559-2567 | programType → {ok:true} | 현재 본인 | E2-4b |
| `GET /schedules/today`; `GET /schedules/upcoming`; `GET /schedules/month` | 2568-2583 | 날짜 query → AuthoritativeDayInterval + schedules:TodayScheduleCard[] | H, 조회 범위 | E2-4b |
| `GET /schedules/candidates` | 2584-2589 | {candidates:ScheduleCandidate[]} | H, 조회 범위 | E2-4b |
| `PATCH /schedules/:id/reschedule`; `POST /schedules/:id/cancel`; `POST /schedules/:id/no-show` | 2590-2615 | 현 transition parser/expectedVersion → scheduleResponse | H, 사례 쓰기 | E2-4b/E2-7 |
| `GET /schedules/:id/plan`; `PUT /schedules/:id/plan` | 2617-2631 | GET scheduleSessionPlanResponse; PUT {scheduleId,version,sessionGoals} | H, PUT 시각/버전/사례 쓰기 | E2-4b |
| `POST /invites/participant` | 2633-2643 | programId → InviteToken; switch 닫힘404 | H, 발급 권한 | E2-4a |
| `GET /staff-invites`; `POST /staff-invites`; `POST /staff-invites/:id/revoke` | 2644-2665 | GET `{invites}`, POST email/roles → `{invite,token}`, revoke `{invite}`. token은 발급 응답 한 번에만 반환 | 초대 권한의 합 | E2-5a/E2-5c |
| `GET /programs/:id/consent/disclosures` | 2666-2672 | {disclosures} | H, 등록 고지 범위 | E2-4a |
| `POST /participants`; `POST /beneficiaries` | 2674-2686 | parseInitialParticipantCreation → SupportCaseCreationResult | H, 등록 권한/사업 확인/6영역 동의 | E2-4a |
| `GET /participants/search`; `GET /beneficiaries/search` | 2687-2698 | q → {results:ParticipantSearchResult[]} | H, 조회 범위 | E2-7 |
| `GET /participants/new-signup-count` | 2699-2709 | {count} | H | E2-4a |
| `GET /participants`; `GET /beneficiaries` | 2710-2719 | {results:assignedParticipantResponse[]} | H, 조회 범위 | E2-4a |
| `GET /consent/follow-ups` | 2721-2724 | {results:PrivacyConsentFollowUp[]} | H, 조회 범위 | E2-7 |
| `GET /participants/:id/hub` | 2727-2738 | participantHubResponse: restricted에 따라 다른 필드 집합 | H; D86 축소 허브와 사례 접근 구별 | E2-5b |
| `GET /participants/:id/support-cases`; `GET /participants/:id/programs` | 2739-2747 | participantProgramResponse[]; programs는 잔존 별칭 | H | E2-5b/E2-7 |
| `POST /participants/:id/support-cases`; `POST /participants/:id/programs` | 2748-2760 | 현 생성 parser → SupportCaseCreationResult | H, 사례 생성 권한 | E2-4a/E2-7 |
| `GET /participants/:id/goal-tree` | 2762-2765 | {cases:participantGoalTreeResponse[]} | H, 사례 조회 | E2-5b |
| `GET /participants/:id/basic-info`; `PUT /participants/:id/basic-info` | 2769-2787 | ParticipantBasicInfo; PUT contextId/expectedVersion/허용 PII → ParticipantPiiVault | H, 별도 PII/쓰기 검사 | E2-5b |
| `GET /participants/:id/briefing`; `GET /participants/:id/programs/:case/briefing` | 2788-2804 | focusSupportCaseId query 또는 path → normalizeParticipantBriefing | H, 사례 조회 | E2-5b/E2-7 |
| `GET /exports/cases` | 2806-2809 | cursor → listSettingsSupportCaseOptions assigned scope | H, 반출 가능 사례 | E2-5a/CCC-298 |
| `GET /support-cases/:id/report` | 2812-2815 | SupportCaseReport; no-store | H, 사례 조회 | E2-5b/CCC-289 |
| `POST /support-cases/:id/export`; `GET /support-cases/:id/export-history` | 2816-2823 | CaseExportResponse 또는 ExportHistoryPage | H, 반출 권한/감사 | CCC-298/E2-5a |
| `GET /support-cases/:id/memory/trial`; `POST /support-cases/:id/memory/trial` | 2824-2840 | 시험 스위치 꺼짐404; POST confirmExternalAi → 실제 trial work | H, 내부 시험 | CCC-291 |
| `GET /support-cases/:id/memory`; `POST /support-cases/:id/memory/corrections` | 2841-2857 | 현 memory view; itemId/expectedRevision/body → 정정 | H, 사례/기억 권한 | CCC-291 |
| `POST /support-cases/:id/close`; `GET /support-cases/:id/closure` | 2858-2869 | reason → SupportCase; GET SupportCaseClosureInfo | H, POST 사례 쓰기 | E2-5b |
| `POST /support-cases/:id/assignment-requests`; `POST /support-cases/:id/assignment-requests/:assignmentId/review` | 2870-2890 | 요청 및 decision → 현 배정 요청 결과 | 요청자/검토 관리자 | E2-5a/E2-5b |
| `POST /support-cases/:id/force-transfer` | 2891-2903 | toUserId/reason/participantNotified → {transferred:true} | 기관 관리자 | E2-7 |
| `GET /support-cases/:id/assignees`; `POST /support-cases/:id/assignees`; `POST /support-cases/:id/assignees/:assignmentId/accept` | 2904-2935 | {assignees}; SupportCaseAssignee; {accepted:true} | H, 각 배정 권한 | E2-5a |
| `GET /support-cases/:id/consent`; `GET /support-cases/:id/consent/events`; `GET /support-cases/:id/consent/disclosures`; `POST /support-cases/:id/consent-events` | 2936-2967 | {consent}; {events}; {disclosures}; AppendConsentEventInput → event | H, 사례/동의 권한 | E2-4a/E2-5b |
| `PUT /support-cases/:id/overall-goal` | 2968-2979 | overallGoal → {supportCaseId,overallGoal} | H, 담당 실무자 쓰기 | E2-5b |
| `PUT /support-cases/:id/discrepancies/:discrepancyId/resolution` | 2980-2994 | resolution parser → SessionDiscrepancyWire | H, 담당 실무자 쓰기 | E2-5b |
| `GET /support-cases/:id/records/context` | 2995-2998 | ManualRecordContext | H, 읽기와 canWrite 구별 | CCC-290/E2-4c |
| `GET /support-cases/:id/records` | 2999-3025 | official query → SupportCaseRecordsWire, manual 투영 포함 | H, 사례 조회/승인 경계 | E2-4c |
| `POST /support-cases/:id/records` | 3026-3036 | 현 manual schema2 parser → {record,replayed} | H, 담당 쓰기/동의/사업 검사 | CCC-290/E2-4c |
| `GET /support-cases/:id/records/intake` | 3038-3041 | intakeContextResponse | H, canWrite를 별도 계산 | E2-5b/CCC-288 |
| `POST /support-cases/:id/records/intake`; `PUT /support-cases/:id/records/intake` | 3043-3061 | schema2/expectedRevision → {schemaVersion,revision,record,replayed}; PUT replayed=false | H, 담당 쓰기 | E2-5b/CCC-288 |
| `GET /cases`; `POST /cases`; `GET /cases/:id` | 3063-3082 | 현 gateway listCases/createCase/getCase; 구 CaseRecord 축소형과 동일하지 않음 | H | E2-7 |
| `GET /cases/:id/briefing`; `GET /cases/:id/pilot-text-ai-consent` | 3083-3086 | Briefing 또는 PilotTextAiConsentStatus | H, 사례 조회 | E2-7 |
| `GET /cases/:id/goals`; `POST /cases/:id/goals`; `POST /cases/:id/action-items` | 3087-3114 | Goal[]; Goal; OpenActionItemWire | H, 쓰기는 담당 | E2-5b |
| `GET /cases/:id/sessions`; `POST /cases/:id/sessions` | 3115-3138 | SessionWire[] 또는 SessionWire + replayed | H, 쓰기는 담당 | E2-7 |
| `POST /goals/:id/close`; `GET /goals/:id/upcoming-links`; `PUT /goals/:id/title` | 3140-3162 | Goal; {upcomingCount}; Goal | H, 쓰기는 담당 | E2-5b |
| `GET /sessions/:id`; `POST /sessions/:id/approve` | 3163-3233 | SessionWire; 승인 경계는 실제 handler/gateway 검사 | H, 사례/승인 권한 | E2-4c/E2-7 |
| `GET /sessions/:id/ai`; `POST /sessions/:id/ai/generate`; `POST /sessions/:id/ai/drafts/:version/edit`; `POST /sessions/:id/ai/drafts/:version/review` | 3163-3233 | AiDraftGetWire 또는 AiDraftMutationWire; 근거/초안 version 검사 | H, human 검토 권한 | E2-4c/CCC-293 |
| `PUT /sessions/:id/audio`; `POST /sessions/:id/audio-upload-target`; `POST /sessions/:id/audio-upload-target/:audioObjectId/complete` | 3163-3233 | 실제 audio upload/target/complete 계약; S8 참조 | H, 현재 동의/Agent/입장 조건 | E5-6/E2-4c |
| `GET /ai/provider/status`; `POST /ai/provider/activate-runtime` | 3234-3311 | AiProviderStatus; activation 결과 {enabled,adapterId,adapterVersion,configHash,replayed} | 기관 관리자 | E2-5a |
| `POST /pipeline/readiness`; `GET /pipeline/health` | 3313-3324 | recordSttReadiness 또는 PipelineHealth | service readiness/관리자 health | E5-1a/STT 준비 소유자 |
| `GET /audio-lifecycle/manual-notes`; `POST /audio-lifecycle/manual-notes/:id/ack` | 3325-3343 | 실제 manual-notes view/ack | H, 사례 권한 | E5-6 |
| `POST /pipeline/memory/claim`; `GET /pipeline/memory/:jobId/source`; `POST /pipeline/memory/:jobId/mask-dictionary`; `POST /pipeline/memory/:jobId/result`; `POST /pipeline/memory/:jobId/release` | 3344-3370 | S5 MemoryMaskJob/source/dictionary; result/release204 | service, claim-bound | CCC-291/E5-1a |
| `POST /pipeline/jobs/claim`; `POST /pipeline/jobs/:jobId/heartbeat`; `POST /pipeline/jobs/:jobId/release`; `POST /pipeline/jobs/:jobId/mask-dictionary`; `GET /pipeline/jobs/:jobId/source`; `GET /pipeline/jobs/:jobId/audio`; `POST /pipeline/jobs/:jobId/audio/verify`; `POST /pipeline/jobs/:jobId/egress/authorize`; `POST /pipeline/jobs/:jobId/egress/in-flight`; `POST /pipeline/jobs/:jobId/result` | 3372-3564 | S5 실제 job/attempt/claim 계약; result/release204, audio는 bytes/전송 경계 | service, claim-bound | E5-1a; CCC-292 차단 유지 |
| `GET /settings/retention-policy`; `PUT /settings/retention-policy` | 3565-3578 | {orgId,piiPurgeGraceDays,version}; PUT expectedVersion | 기관 관리자 | E2-5a |
| `GET /pii-retention/reviews`; `POST /pii-retention/reviews/:id` | 3579-3592 | {reviews}; 실제 보존/파기 결정 결과 | 기관 관리자/파기 이중 게이트 | E2-5a |
| `GET /assignment-requests` | 3594-3598 | {requests:AssignmentRequestWire[]} | H, 본인 요청 범위 | E2-5a |
| `GET /settings/assignments/cases`; `GET /settings/assignments/cases/:id` | 3599-3608 | 사례 options 또는 {assignees} | 기관 관리자 | E2-5a |
| `POST /agents/pairing-codes`; `POST /agents/:installationId/revoke` | 3609-3629 | AgentPairingCode 또는 {installationId,revokedAt} | 기관 관리자 | E6-4 |
| `GET /users`; `POST /users`; `POST /users/:id/deactivate`; `GET /users/:id/assignments` | 3630-3663 | DirectoryUser[]; DirectoryUser; DirectoryUser; CounselorAssignments | 기관 관리자 | E2-5a |

### 4.1 DTO 필드와 투영의 핵심 차이

동일 이름의 구 S3 표를 그대로 validator로 쓰지 않는다. 현재 wire 변경의 승인 근거는 D74/D86/D88과 각 versioned 계약이며, 소비 실패는 결함으로 남긴다.

| 경계 | 현재 wire와 nullable/optional | 실제 소비 차이와 증거 |
|---|---|---|
| MeResponse | `packages/contracts/src/institution.ts:35-44`의 실제 정의. `email`, `name`, `lastProgramType`은 required nullable이다. institution은 readiness 객체 | web `decodeDirectoryUser`가 email을 string으로 요구하고 `/me`에도 재사용한다(api.ts:2110-2128). null-email 소비 불일치는 E2-3/CCC-212 |
| DirectoryUser | `gateway.ts:12393-12410`의 serializer와 User 정의를 따른다. email/name은 nullable이며 목록은 토큰을 반환하지 않는다 | web은 nullable email을 거부한다. E2-5a/CCC-209가 소비자를 소유하며 빈 배열은 행 shape 검증이 아니다 |
| AssignedParticipantWire | `beneficiaryId,status,programCount,name,phone,email,programNames,newSignup`; name/phone/email null 가능 | D88의 목록 이메일은 허브 전용 제한의 승인된 예외다. 실제 목록 200은 이 필드를 포함한다 |
| ParticipantProgramWire | `id,beneficiaryId,programType,status,intakeAt,creationKind,sourceSupportCase,participantName,participantPhone,authorized,assigneeNames,consentRecordedAt,upcomingSchedule`; 구 `consent` 객체는 없음. upcomingSchedule은 null 또는 일정 표시 객체 | web `decodeParticipantProgram`은 여전히 consent 객체를 요구한다. 허브/기록/검토의 실제 렌더 실패로 확인했다. 구 객체를 임의 복원하지 않는다 |
| ParticipantHubDetail | `restricted`가 분기자다. 최소 name/phone/email/programs와 허용된 전체 허브의 birthDate/status/closedAt/sessionCount/lastSessionAt을 구별한다 | optional 개인정보를 restricted 응답에 추가하지 않는다. variants.json에서 담당/비담당의 실제 두 응답 shape와 birthDate 제외를 확인했다. 모든 자료 조합의 검증은 아님 |
| 일정 4종 | scheduleResponse와 plan, today, briefing upcoming은 `allDay`, `displayColor`를 가진다. channel은 해당 serializer에 실제 포함되는 자리에서만 센다 | `00:00`을 종일로 해석하지 않는다. PUT plan 응답에는 `sessionGoals`도 있다. 실제 schedule/plan 응답 shape 별도 기록 |
| InviteToken/공개 링크 정보 | InviteToken은 programId/expiresAt을 포함한다. 공개 조회는 `ParticipantRequestLinkInfo`와 `ParticipantRequestLinkUsedInfo` 합집합이다(gateway.ts:21105-21153) | used의 counselorName/email 폴백/message는 token 범위의 연락 안내이며 폐기된 자기 확인 API가 아니다. web의 programType 고정 기대는 E2-5c/CCC-215의 별도 결함 |
| 등록 결과 | SupportCaseCreationResult의 `canWriteIntake` 등 실제 필드는 HTTP 생성 응답에 있다 | client가 쓰기 권한을 hub 조회로 추정하거나 누락을 true로 채우지 않는다 |
| 수기 기록 | schema2 입력은 `contracts/manual-record.ts`. 생성 응답 `{record,replayed}`의 record에 `manual`이 포함된다. 공식 records에도 manual 원천/결과 투영이 있다 | web 및 현재 client의 구 details/actions 쓰기를 새 schema2 성공으로 가장하지 않는다. 실제 backend schema2 생성/조회만 별도 확인했다 |
| IntakeRecordContext | `canWrite,writeSchemaVersion,moduleSnapshot` 포함. `consent`는 6영역 상태 배열. saved는 null 또는 원문 schema1/2, revision, questionnaire/legacyDetailsJson/history의 실제 계약 | web은 구 consent 객체/평탄 saved를 요구해 실제 500. 새 lifecycle proposal의 schema3/추가 필드는 미발행이며 이 표에 넣지 않는다 |
| IntakeMutationResponse | POST/PUT 모두 `{schemaVersion,revision,record,replayed}`. PUT의 replayed는 false | POST 실제 201을 확인했다. 복사된 questionnaire round-trip만으로 handler 검증이라 하지 않는다 |
| AI draft | GET은 `AiDraftMutationWire`에 regenerateAvailable, regenerateSourceSnapshotId, transcriptQuality를 추가한다. mutation에는 GET 전용 필드가 없다 | web mutation의 AiDraft cast 불일치는 남는다. AI-off의 draft404는 생성/검토 성공 증거가 아니다 |
| CapabilityManifest | mode/sttMode/sttEngine/llmMode/agentStatus/options/features와 schemaVersion. sttEngine은 null 가능. 설치 ID는 별도 header | 실제 검증된 합성 manifest에서 off/null, manifest 부재503을 확인했다. 기관 설치나 STT 자격 승인으로 확대하지 않는다 |
| S5 job source/result | source의 현재 `sessionId/text`, claim/attempt와 result의 실제 S5 타입을 따른다 | source revision과 대응표 freshness, final-egress 집행은 CCC-292/291의 열린 경계다. richer source가 이미 있다고 쓰지 않는다 |
| preview unlock | API JSON `{token,maxAgeSeconds,expiresAt}`, web form `{mode,code}` → HttpOnly cookie와303 | web은 expiresAt을 검사하지 않는 기존 E2-3 결함이다. 유효 응답으로 cookie를 받았다는 사실은 잘못된 expiresAt 거부 증거가 아니다 |

### 4.2 PII와 권한 필드 대응

| 필드 묶음 | 허용 경계와 기존 규칙 | 검증 상태 |
|---|---|---|
| `/me`의 name/email/roles | 현재 본인. 다른 사용자의 조회 권한이 아니다 | 합성 본인 200 |
| directory name/email 및 배정 이름 | 해당 관리자 기능 또는 D36/D86이 허용한 기관 내 식별/담당 표시 | 관리자 users 200; 모든 역할 합은 미검증 |
| 목록 name/phone/email/programNames | D24/D88이 허용한 목록 응답과 감사 fields. 임의 다른 응답 재사용 금지 | 실제 목록 shape 확인 |
| 허브 기본 식별정보/참여 사업 | D86 restricted 분기. 상담 내용과 birthDate/기록 수는 비담당 최소 허브에 넣지 않는다 | 실제 합성 담당/비담당 응답, technical-only 접근 거부를 variants.json에 보존 |
| basic-info의 account/birthDate/region/gender 및 intake extendedPii/emergencyContact | 기존 PII 권한/감사와 사례 경계. 기술 관리자에게 상담자료를 새로 열지 않는다 | 담당 basic-info/intake 응답; 타 기관/비담당/서비스 기록 조회403 |
| briefing/records/goal revisions의 이름, 상담 내용과 인용 | 기관/사례 읽기, 담당/감독 관계와 허용된 관리자 읽기. AI 미승인 제외 | 현재 합성 공식 수기 조회. 모든 승인/감독 조합은 미검증 |
| 공개 request-info/가입 결과/실무자 수락의 이름/email | 실제 유효 token 범위와 D86의 1회 사용. 폐기된 자기 확인 API로 재공개하지 않는다 | participant token-only200, switch-off404, preview 무쿠키401. 별도 실제 Worker에서 participant signup201과 switch 없는 staff accept201을 확인 |
| 사용된 participant 링크의 counselorName/message | 원래 token 보유자에게 발급 담당자의 이름 또는 email 폴백만 제공한다(gateway.ts:21117-21140). 다른 상담/개인정보를 다시 공개하지 않는다 | used의 정확한 key 집합, null과 자기 발급자 email 폴백을 실제 응답으로 확인. issued 응답으로 대신하지 않음 |
| staff 발급 응답의 token | 발급 권한을 가진 사람에게 POST 응답 한 번만 제공한다. GET 목록과 revoke에는 포함하지 않는다 | 실제 발급 `{invite,token}`, 목록/revoke의 token 부재를 확인. token 값은 evidence/log에 저장하지 않음 |
| Agent 원천/사전 | service claim에 필요한 원천만. 일반 ResultRequest와 외부 AI에 원문/대응표를 넣지 않는다 | 이번 실행에서 외부 AI/STT/Agent claim을 시작하지 않음. S5/S6 집행 완료를 주장하지 않음 |

## 5. 현재 page가 없는 경로와 실제 결함

`unmapped-by-current-page`는 구현 TODO를 임의 발행하는 말이 아니다. §4의 모든 현재 경로는 Next 행에서 사용되거나 아래 client/service/legacy 영역에 남는다. 최종 삭제/이식은 해당 소유자가 한다.

- 실제 client 호출: capabilities/auth/logout, program-options, 6영역 consent, staff-invites, settings/accounts/assignments/retention, audit-log, report와 기관 memory 설정이다. 아래 보충표가 non-SCR 경로와 추가 호출을 구별한다.
- Agent/system 호출: agents 자격 교환, internal scheduler/storage, pipeline/jobs, pipeline/memory와 readiness다. `audio-lifecycle/manual-notes`는 이 묶음과 달리 사람의 사례 권한 경계이며 현재 화면 연결은 없다.
- `GET /exports/cases`, `POST /support-cases/:id/export`, `GET /support-cases/:id/export-history`는 현재 client screen 호출이 없다. transport allowlist만으로 소비자가 있다고 하지 않는다. `InstitutionApi.createProgram`도 현 screen 호출자가 없으며 테스트 호출과 구별한다.
- removed dispatch: `GET /invites/participant/:token/me`, `GET /invites/worker/:token`, `POST /invites/worker`, `POST /invites/counselor`, `PUT /support-cases/:id/consent`, `POST /cases/:id/pilot-text-ai-consent`, `POST /sessions/:id/ai/source`, `GET /pipeline/jobs`, `GET /pipeline/text-jobs`, `GET /pipeline/text-jobs/:item/source`, `POST /pipeline/text-jobs/:item/complete`. worker 경로와 자기 확인은 인증 전404이며, 나머지 미등록 경로는 먼저 인증 거부를 받을 수도 있다. ‘아직 호출하는 web 코드’와 ‘현재 존재하는 API’를 같은 것으로 표시하지 않는다.
- `GET /pipeline/jobs/:sessionId/audio`와 `POST /pipeline/jobs/:sessionId/result`의 파라미터 의미는 현재 jobId다. 별도의 `POST /pipeline/jobs/:sessionId/audio/result`는 다섯 segment의 미등록 경로이며 현재 네 segment `POST /pipeline/jobs/:jobId/result`와 같지 않다. removed-dispatch로 남기고 별칭을 만들지 않는다.

| orphan action | 실제 API와 serializer/소비 | Actor와 현재 page caller | 기존 소유 |
|---|---|---|---|
| `recordPilotTextAiConsentAction` | `POST /cases/:id/pilot-text-ai-consent`, 현재 dispatch 없음. 과거 PilotTextAiConsent 투영을 성공 계약으로 쓰지 않음 | human, page caller 0 | E2-7/CCC-217 |
| `editAiDraftAction` | 사전 `GET /sessions/:id`, `POST /sessions/:id/ai/drafts/:version/edit` → 실제 `aiDraftResponse`; client AiDraft cast는 GET 전용 필드까지 기대 | human/초안 권한, page caller 0 | E2-7/CCC-217 |
| `createSubsequentParticipantProgramAction` | `POST /participants/:id/support-cases` → 실제 SupportCaseCreationResult와 client 투영 | human/사례 생성 권한, page caller 0 | E2-7/CCC-217 |
| `createCounselingScheduleAction` | `POST /schedules` → `scheduleResponse`; 현재 화면은 createSchedulePlanAction을 사용 | human/사례 쓰기, page caller 0 | E2-7/CCC-217 |

inline `submitRecord`는 records/new 안에서 createCounselingRecordAction을 감싸는 실제 서버 제출 경계다.

| ID | 실제 차이 또는 막힌 부분 | 기존 소유 | 완료로 표시하지 않는 것 |
|---|---|---|---|
| G-MAP-01 | settings의 memory GET/PUT와 두 actions, admin/ai-provider의 GET capabilities가 구 S3에서 빠짐 | 문서 CCC-201, 제품 E2-5a/CCC-209 | 문서 추가는 제품 동작 변경이 아님 |
| G-WEB-01 | web ParticipantProgram decoder의 구 consent 기대와 현재 응답 불일치 | E2-4c/CCC-211, E2-5b/CCC-206, DESIGN | records/new/list 500; hub/review는 스트림200 안의 렌더 오류 |
| G-WEB-02 | web intake의 구 동의/원문 형식과 schema2 불일치 | CCC-288, E2-5b/CCC-206 | 실제 intake page500, 새 형식 전체 소비 미완료 |
| G-WEB-03 | participant preview cookie 포워딩 부재 | E2-5c/CCC-215 | API401 뒤 page404. 안전 기대는 cookie만 전달하는 그대로 |
| G-WEB-04 | retired worker/consent API를 호출하는 잔존 page/action | E2-5c/CCC-215, E2-5a/CCC-209, E2-7/CCC-217 | 폐기 API 복원이나 compatibility alias 금지 |
| G-WEB-05 | unlock expiresAt 검증 부재, AI mutation GET DTO cast | E2-3/CCC-212, E2-4c/CCC-211 | 유효 응답 수신은 malformed 응답 거부 증거가 아님 |
| G-WEB-06 | public signup action의 구 consent 객체, used 링크의 programType 기대 | E2-5c/CCC-215 | 실제 consentEvents/used 합집합을 낮추거나 자기 확인 API를 복원하지 않음 |
| G-WEB-07 | nullable email을 거부하는 web directory/identity decoder | E2-3/CCC-212, E2-5a/CCC-209 | null을 가짜 이메일로 채우지 않음 |
| G-CLIENT-01 | 수기 schema2 생산자와 구 client records 쓰기/읽기 | CCC-290/289, E2-4c/CCC-211 | synthetic-api가 대신 만든 응답은 실제 계약 통과가 아님 |
| G-CLIENT-02 | 4탭/새 상태/약속/리포트 소비 미완료 | E2-5b/CCC-206, CCC-291/295/296/298 | 새 표시명만으로 W 전체 완료 금지 |
| G-CLIENT-03 | staff 초대 화면은 supervisor 선택지를 만들지만 core의 DirectoryStoredRole 3종에는 없음. client invites.ts:13-24/screens:102-106과 gateway:12454-12458,21448-21454가 다름 | E2-5a/CCC-209, 별도 역할 변경 범위 보존 | 합성 POST가 supervisor400을 반환함. 팀 감독 grant의 읽기 권한과 초대 가능 역할을 합치거나 서버 검사를 완화하지 않음 |
| G-PROTECTED-01 | CCC-299/292의 소유 경로/출고 단위 부족 | 해당 티켓과 정본 인계 | 제안 버전/필드/마이그레이션 미발행 유지 |
| G-VERIFY-01 | 모든 endpoint의 모든 nullable/optional/역할/오류/수락 분기를 실행한 것은 아님 | CCC-201 증거 및 해당 계약 소유자 | 일부 응답과 정적 참조만으로 전 API PASS 금지 |
| G-VERIFY-02 | production Auth/세 모드 identity, client hydration/상호작용 전체는 실행하지 않음 | E2-3 및 각 모드/화면 소유자 | preview Actor로 Supabase MFA나 Local 암호화/인증 성공을 대신하지 않음 |

## 6. Relayer SCR 21행과 현재 client

CSV는 UTF-8 BOM과 여러 줄 quoted field를 CSV parser로 읽는다. 21개 record ID를 독립적으로 대조하며 물리줄 수를 화면 수로 쓰지 않는다. CSV의 이전 ‘논의 중’, ‘28문항’, 탭 질문은 승인 적용 계획/G1~G8을 다시 열지 않는다. 아래 source는 모두 고정 제품 소스다. 화면 구현 완료 표가 아니다.

Client는 `app.tsx:265-301`의 RouterRoot → RuntimeBoundary → 공개 token 또는 AuthBoundary → BusinessShell 경로다. 공통 준비는 서명 설치 정보와 `/me`, `/capabilities`이며 BusinessTransport/PublicTransport를 구별한다. `/`는 STT trial이다. `/welcome`, `/k/:code`, `/login`, `/join`, `/staff/join`, `/staff-invites`, 당사자 목록/등록/초대/기본정보 수정, `*` 오류 route도 별도 존재한다. `/k/:code`의 연결 준비 안내를 동작하는 기관 discovery로 보고하지 않는다.

Client 메뉴 역할: account는 네 사람 역할, system/staff-invites는 institution-admin 또는 technical-admin, schedule/participants 및 그 상세/records/report/plan은 institution-admin/supervisor/worker, 등록은 institution-admin/worker, 기관 설정/계정/배정/감사/보존은 institution-admin이다(`navigation.ts:14-32,62-92`). 이것은 화면 진입 조건이며 쓰기 허용은 API가 따로 정한다.

| SCR | 현재 route/module | 실제 client source | API/DTO와 승인 요구의 차이 | 기존 소유 |
|---|---|---|---|---|
| SCR-001 | /welcome; /는 STT trial | app.tsx:234-240,267-270 | 공개 소개는 최소 진입 카드, apps/site 없음 | E2-6/CCC-219; W11 |
| SCR-002 | 기존 web /preview, /preview/admin | app.tsx:265-300; tools/synthetic-preview.mjs | client 제품 demo route 없음. synthetic-api는 backend 증거가 아님 | E2-6/CCC-219, W11/W12 |
| SCR-006 | /onboarding | screens/institution.tsx:44-227; business/institution.ts:115-167 | `POST /organization/onboarding` → OrganizationOnboardingResponse, `GET /programs` → ProgramListResponse, `PATCH /programs/:id` → ProgramMutationResponse. 기관 관리자; N02 설치와 별도 | E2-5a/CCC-209, W03/W11 |
| SCR-007 | /settings?module=institution-profile | business/api.ts:403-415; business/settings-modules.tsx:189-220 | GET/PATCH organization/profile. 선택지 관리 G8 미결 유지 | E2-5a/CCC-209, W11 |
| SCR-011 | /settings?module=system; web /admin/ai-provider | app.tsx:150; screens/settings.tsx:441-457 | GET capabilities. 사업별 실제 상태와 미실행 구별은 후속, 새 AI 페이지 신설 아님 | CCC-291, E2-5a/CCC-209 |
| SCR-017 | /settings?module=account | business/api.ts:375-389; business/settings-modules.tsx:63-185 | GET me/assignment-requests, POST accept. 기관 memory와 별도 | E2-5a/CCC-209 |
| SCR-022 | /participants/:beneficiaryId | screens/participants.tsx:314-428; business/participants.ts:185-211,271-273; business/consent.ts | `GET /participants/:id/hub`; ConsentPanel의 `GET /support-cases/:id/consent`, `GET /support-cases/:id/consent/disclosures`, `POST /support-cases/:id/consent-events`; 비담당 요청은 `POST /support-cases/:id/assignment-requests`. 각 현재 계약과 사례 권한을 따름. restricted 분리, 4탭 미구현 | E2-5b/CCC-206, W11 |
| SCR-024 | /schedule; web /programs/:programType/schedule | screens/schedules.tsx:67-183; business/schedules.ts:298-301 | GET schedules/month. 새로운 할 일 띠의 수량/검사 상태는 기존 목록과 별도 | E2-4b/CCC-210, CCC-291/295 |
| SCR-025 | /schedules/new | screens/schedules.tsx:185-279; business/schedules.ts:303-329 | GET candidates, POST schedules. 현 create는 customQuestions를 보내지 않음 | E2-4b/CCC-210, W04/W11 |
| SCR-026 | /schedules/:scheduleId/plan | screens/schedules.tsx:281-365; business/schedules.ts:331-348 | GET/PUT plan. 현 save는 sessionGoals만; 질문 수정과 잠금 별도 계약 | E2-4b/CCC-210, W04 |
| SCR-027 | /participants/:id/programs/:case/briefing | screens/schedules.tsx:366-440; business/schedules.ts:350-366; business/records.ts | `GET /participants/:id/programs/:case/briefing`, `PUT /support-cases/:id/overall-goal`, `PUT /support-cases/:id/discrepancies/:id/resolution`, `POST /cases/:id/action-items`. 조회와 담당 쓰기를 구별하며 새 읽기 전용 소비는 미완료 | CCC-291/295/296, 화면 E2-4b/CCC-210; 사례 쓰기 E2-5b/CCC-206 |
| SCR-028 | /participants/:id/programs/:case/records/intake | business/intake.ts:114-131; screens/intake.tsx; contracts/intake.ts | GET/POST/PUT intake schema2. 공통21+선택장기목표1, 모듈 응답. 추가 질문 lifecycle은 미발행 | CCC-288/299, E2-5b/CCC-206 |
| SCR-029 | /participants/:id/programs/:case/records/new | screens/records.tsx:19-40,305-423; business/records.ts:142-186 | useRecordList의 `GET /support-cases/:id/records?official=true`, `POST /support-cases/:id/records`. 현 client는 구 details/actions이며 새 schema2 소비 전환이 남음 | CCC-290, E2-4c/CCC-211 |
| SCR-030 | /participants/:id/programs/:case/records/:sessionId/review | business/ai-review.ts:14-26,107-143; screens/records.tsx:424-611 | `GET /sessions/:id/ai`, `POST /sessions/:id/ai/generate`, `POST /sessions/:id/ai/drafts/:version/review`, `POST /cases/:id/action-items`. 실제 draft/할 일 계약과 human 검토/담당 쓰기. 올바른 축 이름은 새 근거 생산자 완료가 아님 | CCC-300/291/293, E2-4c/CCC-211 |
| SCR-031 | /participants/:id/programs/:case/records | screens/records.tsx:43-174,248-303; business/records.ts:283-327 | `GET /support-cases/:id/records?official=true`; GoalTreeCard의 `GET /participants/:id/goal-tree`, `POST /cases/:id/goals`, `PUT /goals/:id/title`, `GET /goals/:id/upcoming-links`, `POST /goals/:id/close`. ClosureCard는 SCR-036의 GET/POST도 상속. manual 투영과 4탭 미완료 | CCC-290/295, E2-4c/CCC-211; 목표/종결 E2-5b/CCC-206 |
| SCR-032 | /participants/:id/programs/:case/report | business/report.ts:170-175; screens/report.tsx:30-176 | GET report 5섹션과 근거. 실제 인쇄/JSON/HWPX/DOCX/CSV 버튼은 미연결 | CCC-289/295/298, E2-5b/CCC-206 |
| SCR-033 | /settings?module=assignments | screens/settings.tsx:334-433; business/api.ts:530-535; business/participants.ts:336-360 | `GET /settings/assignments/cases`, `GET /settings/assignments/cases/:id`, `POST /support-cases/:id/assignment-requests/:assignmentId/review`. 기관 관리자와 실제 options/assignees/review 계약. 이관 안내의 새 수량 미연결 | E2-5a/CCC-209, W11 |
| SCR-034 | /settings?module=accounts | screens/settings.tsx:175-259; business/api.ts:473-502 | GET accounts, PATCH roles, POST deactivate. 초대는 별도 staff-invites | E2-5a/CCC-209; 역할 별도 PR 범위 보존 |
| SCR-036 | records 안 ClosureCard; web .../close | screens/records.tsx:176-247; business/records.ts:362-383 | GET closure, POST close(reason). 일/목표 통합 정리와 파생자료 파기 미완료 | E2-5b/CCC-206, CCC-297 |
| SCR-052 | /settings?module=audit | screens/settings.tsx:30-67; business/api.ts:428-448 | GET audit-log. 월간 집계/점검 보고서의 세부 계약은 미확정 | CCC-301, E2-5a/CCC-209 |
| SCR-037 | /settings?module=retention-policy; module=retention | screens/settings.tsx:69-172,262-327; business/api.ts:450-518 | GET/PUT retention-policy, GET/POST reviews. 보유기간≠파기시점, 최신 파기 복원 미구현 | E2-5a/CCC-209, CCC-297, E3-7 |

### 6.1 SCR 밖의 현재 client 경계

각 행은 공통 Runtime/Auth/BusinessShell 준비를 필요한 범위에서 상속한다. 도달 가능한 helper만 있고 screen이 없는 경우를 따로 적는다.

| route/module 또는 잔여 표면 | 실제 호출과 DTO 경로 | Actor/소유와 분류 |
|---|---|---|
| `/` | `stt-trial/api.ts:59-87`: `GET /internal/stt/status`, `POST /internal/stt/trials`, `GET /internal/stt/trials/:trialId`, `GET /internal/stt/trials/:trialId/transcript`, `DELETE /internal/stt/trials/:trialId`; 응답은 같은 폴더 contract.ts. 일반 업무 API와 분리된 내부 시험 경계 | STT 전용 레인; 이번에는 호출/업로드/활성화하지 않음 |
| `/k/:code` | PublicScreen의 연결 준비 안내만 있으며 API 호출 없음 | 공개, E2-3/CCC-212; 성공한 기관 discovery가 아님 |
| `/login` | RuntimeBoundary/AuthBoundary 뒤 `/settings` 이동. installation/auth/transport의 검증과 `GET /me`, `GET /capabilities` | 본인 Auth, E2-3/CCC-212 |
| `/join` | PublicJoinApi의 `GET /invites/participant/:token`, `GET /invites/participant/:token/consent/disclosures`, `POST /signup/participant` | token-only, E2-5c/CCC-215; issued/used 합집합 |
| `/staff/join` | `GET /staff-invites/token/:token`, `POST /staff-invites/token/:token/accept`; `business/invites.ts`의 공개 decoder | token 및 선택적 본인 Auth 결합, E2-5c/CCC-215 |
| `/staff-invites` | `GET /staff-invites`, `POST /staff-invites`, `POST /staff-invites/:id/revoke`; InvitesApi/StaffInvite와 발급 응답 token | 기관 관리자/기술 관리자 초대 범위, E2-5a/CCC-209 |
| `/participants` | `GET /participants`; ParticipantsApi list decoder. GET program-options는 이 화면의 호출이 아님 | 사람 목록 범위, E2-4a/CCC-205 |
| `/participants/new` | `GET /program-options`, `GET /programs/:id/consent/disclosures`, `POST /participants`; 기관 관리자는 activeWorkerOptions를 통해 `GET /settings/accounts`의 cursor 페이지를 조회하고 활성 worker 선택지로 투영한다(`business/participants.ts:366-390`) | 기관 관리자 또는 worker의 등록 권한, E2-4a/CCC-205 |
| `/participants/invite` | `GET /program-options`, `POST /invites/participant`; InvitesApi 발급 응답과 public_signup capability | 기관 관리자/worker의 발급 권한, E2-4a/CCC-205 |
| `/participants/:beneficiaryId/edit` | `GET /participants/:id/basic-info`, `PUT /participants/:id/basic-info`; ParticipantBasicInfo/PiiVault와 expectedVersion | 사례 PII/담당 쓰기, E2-5b/CCC-206 |
| `/settings?module=memory` | `GET /settings/counseling-memory`, `PUT /settings/counseling-memory`; MemorySettingsInput/View | 기관 관리자, E2-5a/CCC-209, CCC-291 |
| `*` | PublicScreen missing, 업무 API 호출 없음 | 공개 오류 표시, E2-3/CCC-212 |
| `InstitutionApi.createProgram` | `POST /programs`; callable helper와 테스트만, 현재 screen caller 0 | 기관 관리자 API, E2-5a/CCC-209 |
| export API 3종 | `GET /exports/cases`, `POST /support-cases/:id/export`, `GET /support-cases/:id/export-history`; 현재 screen caller 0 | 사람 반출 권한, CCC-298/E2-5a. transport allowlist는 호출 증거 아님 |
| audio-lifecycle/manual-notes | `GET /audio-lifecycle/manual-notes`, `POST /audio-lifecycle/manual-notes/:id/ack`; 현재 screen caller 0 | 사람의 사례 권한, E5-6. service/system-only로 분류하지 않음 |

## 7. 실제 검증과 남은 범위

### 재현 경로

임시 snapshot에는 새 worktree/Git branch를 만들지 않았다. archive 1,337파일의 원본 바이트를 대조했고, workspace 의존성 링크는 snapshot 내부로 다시 연결했다. 외부 패키지는 기존 설치를 읽기만 한다. Node `v24.18.0`, Vitest `4.1.10`, Next `16.2.10`을 사용했다. 생성물/캐시는 task 또는 임시 경로에만 두었다. 실제 명령과 지문은 `freeze.json` 및 실행 계획을 따른다.

```sh
node artifacts/ccc201-screen-api/coverage.mjs <고정 snapshot> artifacts/ccc201-screen-api/coverage.json docs/specs/S3-screen-api-map.md
# 고정 snapshot, 허용 목록만 남긴 환경변수, 기존 Node 절대경로
node node_modules/vitest/vitest.mjs run --config artifacts/ccc201-screen-api/vitest.config.mts
# 같은 snapshot의 apps/web. 동시에 같은 .next를 쓰지 않고 직렬 실행한다.
node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 43982
node artifacts/ccc201-screen-api/web.mjs <고정 snapshot> artifacts/ccc201-screen-api/web.json
# CCC_PREVIEW/PUBLIC_SIGNUP_ENABLED 미설정의 별도 실행은 port43983
node scripts/guard-doc-numbers.mjs
```

### 관측 결과

- 정적 probe: page30/inventory30, 경로 누락/중복0, Route Handler1. route별 실제 helper/action/operation edge와 orphan4개의 연결도 비교한다. HTTP return predicate에서 독립 추출한145종은 현행 ledger144종과 retired 자기 확인 거부1종으로 대응되며 양쪽 차집합0이다. `/admin/ai-provider` 행의 capabilities 연결만 지운 반례는 endpoint catalog가 남아 있어도 정확히 실패했다([반례 근거](../../artifacts/ccc201-screen-api/negative-control.json)).
- 보완된 API/loopback collection은261응답(직접 Request/Response44, Next 통신217)을 보존한다. 독립 합성 DB와 실제 handler/Worker를 썼다. collection test1/1, exit0은 수집기 성공이지 모든 응답 PASS가 아니다. 최초140응답은 runtime-before-review.json에 보존했고, logger 보완 뒤 같은 source에서 재수집했다.
- HTTP 생성: 당사자, intake schema2, 수기 schema2, 일정, 초대가 각각201. 담당 공식 조회200, 비담당/타기관/service의 사례 records403. public participant token-only200, switch-off404, preview cookie 없음401, 사람 자격 없음401을 구별했다.
- 합성 서명 manifest의 `/capabilities`는200, STT off/null을 확인했다. manifest를 주지 않은 경우503이다. 실제 설치나 key/registry 변경은 없다.
- Next30경로: `web.json`은 HTTP status와 renderOutcome을 구별하고 실제 `#app-sidebar.sidebar`, h1, HTML SHA-256, 정제한 error marker/digest와 API 호출/자격 존재 여부/응답 shape를 보존한다. HTML 수신21, 스트림200 오류2, HTTP500 3, redirect2, 공개 거부2다. 오류 marker는 [renderer 로그](../../artifacts/ccc201-screen-api/renderer-log.txt)와도 대조할 수 있다. 이 숫자는 제품 완주율이 아니다.
- preview/admin HTML form POST는 실제 web adapter에서303과 HttpOnly cookie를 반환했다. root/schedule-all의307과 layout API 실행을 별도 기록했다. cookie 없는 preview의 welcome/kit/join/joinX는307이다.
- preview를 끈 별도 실행: welcome/preview/preview-admin은200이며 셸이 없다. 가입 스위치가 없으면 join은404다. 위조한 x-ccc-public을 보낸 joinX는404/업무 셸, kit은200/업무 셸로 공개 표식을 신뢰하지 않는 분기를 확인했다.
- headless에서 `/preview`, `/welcome`의 실제 렌더를 screenshot으로 확인했다. 초기 browser helper의 target 불일치/입력 timeout 뒤 별도 격리 BrowserContext에서 실제 목표 editor 열기 → 입력 → 저장, 다크 모드 클릭, 로그아웃 클릭을 실행했다. 목표 PUT200과 재조회, dark 표시, `/preview` 복귀/셸 없음이 모두 확인됐다([실제 브라우저 근거](../../artifacts/ccc201-screen-api/browser-actions.json)). 세 actions 외의 전체 UI나 production Auth 성공을 뜻하지 않는다.

- [보충 variant probe](../../artifacts/ccc201-screen-api/variants.json)는 실제 HTTP 응답30건과 key/type shape를 보존한다. 두 token 발급자의 issued→legacy consent body400→정상 signup201→used, 직원 초대 발급/목록/수락/회수, null-email `/me`/계정 목록, restricted/full 허브, 감독자의 읽기200/쓰기403, 비담당/기술 관리자 거부, 초대의 supervisor400을 확인했다. test1/1, exit0, 7.63초다. 사람 Actor 주입 검사는 실제 로그인 검증이 아니며, public 검사는 실제 Worker의 token 경계를 사용했다.

### 실패 이력과 해석 제한

최초 launch는 정리한 PATH에 설치된 Node가 없어127로 끝났다. 절대 Node 경로를 사용했다. 첫 API collection은 합성 install manifest를 준비하지 않은 채 off/null을 단언해 실패했다. API가503으로 닫힌 원본은 `runtime-initial.json`에 보존하고 기존 test signer로 manifest 입력을 준비한 뒤 같은 off/null 단언과 부재503을 확인했다. 두 번째 Next 시작은 기존 dev lock으로 종료됐고, 첫 renderer 종료 뒤 직렬로 실행했다. 제품 결함이나 검사 기준을 고친 것이 아니다.

URL-encoded native server-action 시도는 cookie 변경과 업무 PUT을 입증하지 못했고, SSR에 없는 목표 form도 찾지 못했다. 이 보조 시도는 web-action-attempt-history.json에 남기고 수집기에서 제거했다. 실제 격리 브라우저가 hydration 뒤 목표 form을 열어 위 세 actions를 검증했다. HTTP200만으로 그 시도를 성공 처리하지 않았다.

샘플이 비어 있는 배열의 미등장 행 shape, 모든 optional/null 조합, 나머지 server action submit, 세 모드의 실제 Auth/DB/전체 화면 완주, 외부 AI/STT 및 설치/파기 실행은 이 근거가 증명하지 않는다. 금지된 활성화나 운영 쓰기로 채우지 않는다. 현재 source와 실제 관측 실패를 기록하는 일과 해당 기능을 완성하는 일은 별도다. CCC-201의 최종 판정은 독립 coverage/contract 검토에서 전체 대응 수용 기준과 이 증거를 함께 대조한 결과로 기록한다.
