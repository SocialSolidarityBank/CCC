# apps/web 원음 업로드 진입 이식 인계

수신자는 DESIGN 레인이다. 이 문서는 `.claude/skills/frontend-lane/SKILL.md:45-56`의 필수 8항목을 따른다. 작성 기준은 `release/0916`의 `4388f62a`이며, 아래 줄번호는 이 소스 기준이다. 파일명 날짜는 배정받은 이름을 유지했다. 실제 인계 기준일은 2026-09-16이다.

**상태: 배치와 호출 계약을 전달하는 문서이며, 업로드 활성화 승인이나 구현 완료 보고가 아니다.** 16일 실사용은 수기 기록으로 진행한다. 사용자 보고에 따른 차단은 ① NER 산정 미달 ② 실사용 `apps/web`의 업로드 UI 부재 ③ 기존 Cloudflare 스택의 업로드 API fail-closed다. 이번 이식 대상은 ②뿐이며, ①과 ③의 해제를 대신하지 않는다. 운영 환경이나 시크릿을 조회하지 않았고 `apps/pipeline`은 읽지 않았다.

## 1. 목표 한 줄

`apps/client`에 있는 회차별 녹음 업로드 진입을 실사용 `apps/web`의 기록 목록과 AI 정리 검토 화면에 기존 Wire 부품만으로 이식하되, 서버가 허용하지 않는 업로드를 성공으로 표시하지 않는다.

## 2. 붙을 자리

### 소스와 목적지

| 역할 | 정확한 파일과 근거 | 이식할 자리와 이유 |
| --- | --- | --- |
| 원본 목록 진입 | [apps/client/src/screens/records.tsx](../../../apps/client/src/screens/records.tsx):333-337 | `sttMode`가 `local` 또는 `azure`일 때 회차의 `녹음 올리기` 버튼이 같은 회차의 `/review`로 이동한다. 파일 선택은 목록에서 하지 않는다. |
| 원본 업로드 구획 | 같은 파일:515-591, 697-700 | `AudioUploadSection`은 `draft === 'none'`이고 STT 모드가 `local` 또는 `azure`일 때만 선다. 로딩, 조회 오류, 기존 초안이 있는 상태와 구분한다. |
| 웹 목록 데이터 연결 | [apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/page.tsx](../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/page.tsx):248-258 | 기존 `RecordList`에 STT 노출 조건을 전달한다. 목록은 이미 회차와 케이스 범위를 확보하는 자리다. |
| 웹 목록 버튼 | [apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/record-list.tsx](../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/record-list.tsx):226-265 | **각 펼친 `RecordCard`의 `이 회차에서 나온 것` 구획 뒤, `.record-body`가 닫히는 261행 앞**에 `WireButton variant="neutral"`을 둔다. URL은 `${recordsHref}/${encodeURIComponent(record.id)}/review`다. summary 안에 버튼을 넣거나 HERO 행동을 늘리지 않는다. 기존 `승인 내용 보기` 링크(235행)는 그대로 둔다. |
| 웹 검토 데이터 분기 | [apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/[sessionId]/review/page.tsx](../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/[sessionId]/review/page.tsx):155-177 | 160-168행의 회차 존재, 당사자와 사업 결속, `program.authorized` 검사를 통과한 뒤에만 초안 부재를 업로드 대기로 해석한다. 현재 175-176행은 초안 없음과 `legacy_import`를 함께 오류로 돌리므로 둘을 분리해야 한다. |
| 웹 검토 실제 배치 | [apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/[sessionId]/review/fixture-draft-view.tsx](../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/[sessionId]/review/fixture-draft-view.tsx):200-228, 254-263 | 기존 `DraftReviewView`의 `GridContainer`와 `PageTitle`, `ParticipantHeroCard`를 유지한다. **HERO와 오류 안내 뒤, 기존 AI 초안 카드가 시작하는 254행 자리에 초안 없음 전용 카드**를 둔다. 카드 안에서 `WireEmpty`의 초안 없음 안내 다음에 `WireCardSection title="녹음 올리기"`를 배치한다. 기존 초안이 있으면 지금의 초안 카드, 대조, 승인, 재생성만 렌더하고 업로드는 숨긴다. |

목록 URL은 `/participants/:beneficiaryId/programs/:supportCaseId/records`, 업로드 목적지는 `/participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review`다. 새 URL이나 별도 업로드 페이지는 만들지 않는다. 목록의 STT 조건만으로 초안 유무나 업로드 권한을 추정하지 않으며, 목적지에서 다시 확인한다. 승인된 핵심 한 줄이 없다는 사실도 초안 없음의 근거가 아니다.

현재 서버는 초안 부재를 `null` 응답이 아니라 **404 `not_found`**로 보낸다(`packages/http-api/src/request-handler.ts:3296-3300`). 웹의 `getAiDraft`는 이를 `ApiError`로 던진다(`apps/web/app/lib/api.ts:1328,1440-1442`). 따라서 `ReviewContent`에서 검증된 회차의 `getAiDraft` 호출만 좁게 감싸 이 오류를 초안 없음으로 바꾼다. 바깥 조회의 404, 403, 인증 실패, 서비스 장애는 기존 오류 경로에 남긴다. `legacy_import`도 업로드 대상으로 바꾸지 않는다. nullable 초안은 실제 부재 상태로 전달하고, 빈 가짜 `DraftReviewViewModel`을 만들지 않는다.

### 재사용 부품과 클래스

**새 컴포넌트 0건, 새 CSS 0건, 새 색 0건, 새 여백 값 0건**을 이식 수용 조건으로 삼는다. `AudioUploadSection`이라는 새 웹 컴포넌트를 복제하지 않고 기존 `DraftReviewView`에 조건부 구획과 업로드 상태를 넣는다. 브라우저 상태가 필요한 기존 뷰를 client boundary로 전환하는 것은 구현 제안이며, 새 부품을 만드는 뜻이 아니다. 그 경우 서버 API 모듈은 가져오지 않고 서버 액션을 props로 받는다.

| 쓰임 | 재사용 대상 | 소스 근거 |
| --- | --- | --- |
| 제목과 당사자 맥락 | `GridContainer`, `PageTitle`, `ParticipantHeroCard`, `.page-content`, `.page-header` | `fixture-draft-view.tsx:200-212` |
| 초안 없음 카드와 업로드 구획 | `WireCard`, `WireCardSection`, `.wire-section-value` | 같은 파일:254-281, `packages/wire/src/wire-styles.ts:657` |
| 파일 선택과 안전 안내 | `WireFormField`, 네이티브 `input type="file"`, 기존 `hint` 슬롯 | `packages/wire/src/wire-form-field.tsx:75-127` |
| 버튼 묶음 | `WireButton`과 `.wire-form-actions` | `packages/wire/src/wire-styles.ts:765-766` |
| 오류, 전송 중, 완료 | `WireError`, `WireEmpty live`, `WireCallout tone="info"` | 원본 `records.tsx:564-590`, 웹 뷰:1-18 |
| 입력칸의 스타일 | 부품이 만드는 `.wire-form-field`, `.wire-form-label`, `.wire-input-box`, `.wire-form-hint` | `packages/wire/src/wire-form-field.tsx:104-120`, `wire-styles.ts:717-749` |

원본의 `.business-actions`는 웹으로 복사하지 않고 `.wire-form-actions`로 바꾼다. `.record-writing-help`는 작성 화면 전용이므로 검토 화면으로 옮기지 않는다. 안전 문구는 파일 입력의 `hint`에 두 줄로 두고 `aria-describedby`로 연결한다. 입력 도움말의 기존 13px 규칙을 쓰므로 별도 설명 클래스가 필요 없다. 레이아웃과 부품의 공용 간격을 그대로 받으며 style 속성이나 보정 margin을 추가하지 않는다. 최종 시각 배치와 정렬 판정은 DESIGN 레인이 맡는다.

## 3. API 계약

### 웹과 클라이언트의 호출 계층 차이

| 항목 | apps/client의 현재 구현 | apps/web의 현재 구현과 이식안 |
| --- | --- | --- |
| 신원과 실행 위치 | `BusinessTransport`가 브라우저에서 검증된 설치의 `apiBase`로 `Authorization: Bearer`를 보낸다. `/capabilities` 초기화와 세션 수명 검사를 거친다(`transport.ts:67-132`). | `apps/web/app/lib/api.ts`는 `server-only`다. `accessHeaders()`가 운영 Access JWT 또는 `CF_Authorization`, 프리뷰의 `ccc_preview` 쿠키만 전달한다(1237-1270행). 브라우저에 Access 토큰을 꺼내 주거나 `BusinessTransport`를 import하지 않는다. |
| 네트워크 | API 요청은 `credentials:'omit'`, `cache:'no-store'`, `redirect:'error'`다. | `fetchApi()`는 운영에서 `env.CCC_API` service binding, 개발에서 `fetch`를 쓴다(1293-1299행). `requestJson`은 JSON 전용이며 본문이 있으면 JSON Content-Type을 설정한다(1302-1336행). 원음 File을 이 함수에 넣지 않는다. |
| capability 조회 | `mode`, `sttMode`, `sttEngine`, `agentStatus`를 세션에서 읽는다. | 기존 `getSttCapabilities()`를 재사용한다(`api.ts:2522-2545`). 반환값에는 `mode`가 없고 `sttOptions`는 `options`로 변환된다. 타입에 없는 배포 모드를 화면이 읽는다고 적거나 추정하지 않는다. |
| 업로드 | `RecordsApi.uploadAudio()`가 발급, 파일 PUT, 완료 등록을 조합한다(`records.ts:377-395`). | **서버 API 호출에 해당하는 함수는 `apps/web/app/lib/api.ts`의 회차/AI 함수군(`getAiDraft`, 1440행 인근)에 둔다.** 제안 이름은 `createAudioUploadTarget`, `completeAudioUpload`이며 아직 없다. `apps/web/app/actions.ts`에 해당 메타데이터 액션을 연결하고, 기존 `DraftReviewView` 안의 업로드 함수가 브라우저 File PUT을 사이에 조합한다. 서버 액션은 파일을 받지 않는다. |

웹에 `uploadAudio(sessionId, File)`를 서버 함수 하나로 복제하면 원음이 Next/Cloudflare를 지나간다. 이 인계는 그 우회를 채택하지 않는다. **Cloud 경로는 메타데이터만 웹 서버를 거치고 원음 바이트는 승인된 기관 소유 Storage 업로드 대상으로 브라우저가 직접 보낸다.** 현재 스택에서 그 대상을 발급하지 못한다는 차단은 §8에 남긴다.

서버 액션은 기존 `generateAiDraftAction`의 ID 검증, 회차/케이스 결속 확인, 재검증 패턴(`apps/web/app/actions.ts:653-678`)을 재사용한다. 발급과 완료 모두 당사자/케이스/회차 결속을 확인하고 실제 권한은 gateway가 재검사한다. 발급 성공 때는 검증한 `{audioObjectId, url, expiresAt}`를 해당 브라우저 호출에만 반환하고, 완료 성공 때는 검증한 `{sessionId, aiStatus: 'uploaded'}`를 반환한다. 실패 때는 실패 여부와 허용된 코드만 반환한다. 서명 URL은 전송 중 메모리에서만 쓰고 영속 저장하지 않는다. 파일명, 서명 URL, 응답 원문을 notice, 쿼리, 로그에 넣지 않는다. 기존 승인/재생성 실패 문구와 섞이지 않도록 업로드 오류는 업로드 구획의 상태로 표시한다.

### 요청과 응답

기준 구현은 `packages/http-api/src/request-handler.ts:2198-2298,3345-3359`다. STT가 Azure라는 것과 배포 모드가 Cloud라는 것은 별개 축이다.

| 단계 | 경로와 메서드 | 헤더, 본문, 응답 |
| --- | --- | --- |
| 상태 읽기 | `GET /capabilities` | 웹의 기존 신원 전달과 `Accept: application/json`을 쓴다. `sttMode`, `sttEngine`, `agentStatus`, `sttOptions`를 기존 디코더로 검사한다. 실패하면 허용 상태로 대체하지 않는다. |
| Cloud 대상 발급 | `POST /sessions/:sessionId/audio-upload-target` | 웹 신원 헤더와 JSON Content-Type을 쓴다. `{contentLength: file.size, contentType, clientAssertedSha256: null}`를 보낸다. 201 응답은 `{audioObjectId, url, expiresAt}`이며 `cache-control: no-store`다. 업로드 대상의 기한은 서버가 판정한다. |
| Cloud 파일 전송 | 발급 응답의 `url`에 `PUT` | 원음 File을 본문으로 보내고 허용 MIME의 `Content-Type`만 붙인다. Bearer, Access 쿠키, 프리뷰 쿠키를 붙이지 않는다. credentials omit, cache no-store, redirect error를 유지한다. 응답 성공만으로 회차 등록 완료라고 표시하지 않는다. |
| Cloud 완료 등록 | `POST /sessions/:sessionId/audio-upload-target/:audioObjectId/complete` | 웹 신원 헤더, JSON `{}`를 보낸다. 200 세션 응답에서 `id === sessionId`와 `aiStatus === 'uploaded'`를 검사한 뒤에만 완료로 전환한다. 서버는 동의, 권한, 저장된 크기/MIME를 재검사한다. |
| Local 비교용 계약 | `PUT /sessions/:sessionId/audio` | 원본 `putFile`의 경로다. 원음 본문, 허용 MIME, 필수 Content-Length 1~209,715,200바이트, 선택 `x-ccc-audio-sha256` 64자리 소문자 hex를 받는다(2131-2187행). **현재 Cloud 웹 이식에서는 호출하지 않는다.** 현 `resolveAgentRuntime`은 항상 `protected-get`을 반환하고 이 PUT을 거부한다(1590-1603,2138-2140행). |

파일 상한은 **209,715,200바이트**이며 화면 원문은 `200MB`로 유지한다. 허용 MIME 여섯 개는 `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/x-m4a`다(`packages/core/src/gateway.ts:7094-7099`). 0바이트와 상한 초과는 보내지 않는다. 원본 `audioContentType`의 MIME 정규화와 비어 있거나 octet-stream일 때만 확장자로 보완하는 규칙을 유지한다(`apps/client/src/business/records.ts:399-414`). 서버 검증도 그대로 남긴다.

원본 `putSigned`는 설치의 `apiBase`와 같은 origin인지 검사한다(`transport.ts:168-184`). 웹에는 그 설치 객체가 없고 `CCC_API_ORIGIN`은 기존 Worker API이므로, **같은 검사를 웹 origin이나 Worker origin으로 바꿔 끼우지 않는다.** 허용 Storage origin과 서명 대상 형식은 서버/설치 레인이 검증된 설치 사실로 먼저 제공해야 한다. 그 전에는 브라우저 PUT을 열지 않는다. 임의 외부 URL 수용, 리다이렉트 추종, 자동 재시도, 다른 저장소로 자동 전환은 넣지 않는다.

## 4. 거부와 상태 전체

### 여섯 코드 갈래와 원문 문구

아래는 `apps/client/src/screens/records.tsx:515-535`의 **여섯 코드 갈래**다. 엔진과 동의에 각각 하위 분기가 있으므로 문구는 총 여덟 개다. 문구를 축약하거나 한 가지 오류로 합치지 않는다. 구현 시 서버 코드와 최신 capability를 받아 같은 분기표를 기존 뷰 안에서 사용한다.

| 코드 / HTTP | 서버가 거부하는 조건과 근거 | 표시할 문구 |
| --- | --- | --- |
| `engine_unavailable` / 422 | `admitRecordingUpload`에서 엔진 또는 엔진 ID가 null이거나 유효한 readiness가 없다(`gateway.ts:9105-9110`). 응답 후 읽은 `sttEngine === null`이면 첫 문구를 쓴다. | 이 설치는 아직 녹음 전사가 켜지지 않았습니다. 수기 기록으로 남겨 주세요. |
| 같은 코드 / 422 | 같은 서버 거부이며, 화면 capability의 `sttEngine !== null`이면 두 번째 문구를 쓴다. readiness는 기관/모드/엔진 일치, `state='ready'`, `capacity=1`, 미만료를 요구한다(`gateway.ts:8994-9021`). | 녹음을 처리할 장비가 아직 준비되지 않았습니다. 잠시 뒤 다시 시도하거나 수기 기록으로 남겨 주세요. |
| `consent_not_effective` / 409 | Azure는 `counseling_recording`과 `external_stt_processing`을 모두 요구한다. 유효한 동의가 없거나 업로드 사이 동의 receipt가 바뀌면 거부한다(`gateway.ts:9111-9114,7117-7126,7410-7416`). `sttMode === 'azure'`일 때 표시한다. | 녹음 동의와 외부 전사 처리 동의가 모두 필요합니다. 당사자 정보에서 두 동의를 확인한 뒤 다시 올려 주세요. |
| 같은 코드 / 409 | Local은 `counseling_recording`만 요구한다. 위 코드가 왔고 `sttMode !== 'azure'`일 때 원본의 두 번째 문구를 쓴다. 이 표는 Local 화면 상태 검수도 정의할 뿐 현재 Cloud 서버의 Local 지원을 뜻하지 않는다. | 녹음 동의가 확인되지 않아 올릴 수 없습니다. 당사자 정보에서 동의를 확인한 뒤 다시 올려 주세요. |
| `program_admission_required` / 409 | 저장/처리 미결정, 저장소 불일치, 미확인, 선택/문안/설치 정책 변경, STT off, Azure인데 사업의 외부 처리 불허, 사업 실효 STT와 런타임 엔진 불일치 등이 해당한다(`gateway.ts:15923-15966,9108`). 응답의 `reason`을 동의 오류로 바꾸지 않는다. | 이 사업의 도입 확인이 녹음 처리를 허용하지 않습니다. 사업 설정을 확인한 뒤 다시 시도해 주세요. |
| `forbidden` / 403 | `assertSessionWriteAccess` 및 연결된 케이스 쓰기 권한 검사에서 거부한다. 다른 기관/회차 또는 담당 쓰기 권한이 없는 요청은 통과시키지 않는다(`gateway.ts:2052-2055,1380-1383,15606-15626`). 관리자 열람권을 업로드 쓰기권으로 취급하지 않는다. | 이 회차의 담당 실무자만 녹음을 올릴 수 있습니다. |
| `conflict` / 409 | `recording_result_commits`에 이미 확정 결과가 있거나 완료 단계의 저장 객체 크기/MIME가 맞지 않는 경우 등이 해당한다(`gateway.ts:7045-7063`, `request-handler.ts:2275-2283`). | 이미 처리가 끝났거나 다른 변경이 먼저 저장된 회차입니다. |
| `invalid_request` / 400 | 지원하지 않는 MIME, 크기/요청 형식 오류, 승인된 회차, 비대면 회차 등을 거부한다(`request-handler.ts:2207-2217`, `gateway.ts:7026-7038`). 이미 승인된 세션은 위 `conflict`가 아니라 이 코드다. 원본의 파일 검증도 API 전송 전에 같은 갈래로 처리한다. | 지원하지 않는 파일이거나 회차 상태가 맞지 않습니다. 대면 상담 회차의 200MB 이하 녹음 파일인지 확인해 주세요. |

HTTP 매핑 근거는 `packages/contracts/src/agent-jobs.ts:353-368`, `packages/core/src/gateway.ts:175-180,203-206`, `packages/http-api/src/request-handler.ts:2301-2340`이다. 서버는 권한/회차 상태/사업 도입 확인을 엔진/동의보다 먼저 검사할 수 있으므로, 여러 조건이 동시에 실패할 때 화면이 우선순위를 새로 정하지 않는다. 받은 코드를 그대로 선택한다. `invalid_request`에는 영업일 달력 미설정도 포함될 수 있다(`gateway.ts:9045-9083`). 원문 보존 때문에 파일 오류 안내가 넓게 쓰인다는 한계이며, 달력 문제는 서버 선행 점검으로 막는다.

**현재 웹의 누락:** `ApiErrorCode`와 `knownErrorCodes`(`apps/web/app/lib/api.ts:21-68`)에는 `engine_unavailable`, `consent_not_effective`, `program_admission_required`가 없다. 현 상태로는 각각 422→`invalid_request`, 409→`conflict`로 바뀐다(1278-1290행). 프런트엔드/API 연결 담당이 두 목록에 세 코드를 모두 보존하도록 반영해야 한다. 기존 `ApiError`는 HTTP status 필드를 보관하지 않으므로, 화면이 `error.status`를 이미 쓸 수 있다고 가정하지 않는다.

### 코드 여섯 갈래 밖의 상태

| 상태 | 렌더와 행동 |
| --- | --- |
| 초안 조회 중 | 기존 `PageLoading`/`WireEmpty live`를 유지하고 업로드를 표시하지 않는다. |
| 회차 결속 확인 후 초안 없음 | `이 회차에는 AI 초안이 없습니다.`를 표시한다. STT local/azure일 때만 구획을 보이며, off 또는 capability 조회 실패 때는 파일 전송을 열지 않는다. |
| 기존 초안 또는 legacy_import | 기존 초안의 검토/승인/반려/fixture 제한을 유지한다. legacy_import는 기존 오류 경로에 남긴다. 둘 다 업로드 대기로 바꾸지 않는다. |
| 엔진 미지정 | 원본 안내 `전사 엔진이 정해지지 않아 지금은 녹음을 올릴 수 없습니다.`를 쓴다. 원본은 이 값만으로 버튼을 비활성화하지는 않는다(`records.tsx:546-581`). 서버 선행 차단이 풀리기 전에는 이 구현을 활성화 승인으로 간주하지 않는다. |
| Agent 상태가 connected 아님 | 원본 안내 `처리 장비가 아직 준비되지 않았습니다. 올려도 서버가 거부할 수 있습니다.`를 쓴다. connected도 capacity가 남았다는 보장은 아니므로 최종 허용은 서버가 정한다. |
| 엔진 지정 및 Agent connected | 원본 안내 `지금 녹음을 올릴 수 있습니다.`는 서버/설치 선행 조건을 충족한 경로에서만 사용한다. capability만으로 동의와 사업 도입 확인이 통과했다고 단정하지 않는다. |
| idle / sending / done | 파일 없음 또는 sending이면 버튼을 비활성화한다. sending일 때 파일 선택을 잠그고 버튼은 `올리는 중`, live 안내는 `녹음을 올리고 있습니다.`로 표시한다. 완료 API 검증 뒤에만 done으로 바꾸고 선택 파일을 비운다. 실패하면 idle로 돌리되 성공 안내를 띄우지 않는다. |
| 인증 실패 / 허용 범위 밖 주소 | 웹의 기존 인증/접근 오류 경로를 따른다. 클라이언트의 `session.auth.signOut()`을 그대로 복사하지 않는다. 파일 PUT 실패 후 완료 호출도 하지 않는다. |
| 503, 전송 장애, 알 수 없는 오류 | `WireError`에 고정된 안전 문구 `녹음을 올리지 못했습니다. 잠시 후 다시 시도하거나 수기 기록으로 남겨 주세요.`를 표시한다. 이 문구는 이식안이며 서버 원문이나 서명 URL은 출력하지 않는다. 503을 엔진 미지정으로 단정하지 않는다. |

## 5. 문구 초안

§4의 여섯 코드 갈래는 원문을 그대로 사용한다. 새 오류 사유를 임의로 추가하지 않는다.

파일 입력의 안전 도움말은 다음 두 줄이며, 버튼을 누르기 전에 읽을 수 있어야 한다. 두 번째 줄은 Azure 경로를 명시한 조건형 고지이므로 Local을 외부 전송 경로로 오인시키지 않는다.

> 원음은 처리 직후 지워집니다.
> Azure 경로에서는 가림 처리 전 원음이 외부로 나갑니다.

구획 제목과 버튼은 `녹음 올리기`, 입력 라벨은 `녹음 파일`이다. 완료 시 제목은 `녹음을 받았습니다`, 본문은 원본 그대로 `다음 영업일 처리 기회부터 전사됩니다. 원음은 처리 직후 지워지며 늦어도 올린 뒤 7일 안에 지워집니다.`를 쓴다(`records.tsx:585-589`). 이는 처리 정책 안내이지 처리 시작/완료 실측값이 아니다. 업로드 응답에 처리 예정 시각은 없으므로 날짜나 남은 시간을 계산해 표시하지 않는다. 수기 기록으로 돌아가는 기존 `상담 기록 확인하기` 버튼은 항상 유지한다.

## 6. 적용되는 DESIGN-RULES.md 절

정본은 [DESIGN-RULES.md](../../../DESIGN-RULES.md)이며 이 문서는 규칙 변경을 승인하지 않는다.

| 절 | 이번 적용 |
| --- | --- |
| §1 위계, §2 부품 | 카드 안 구획은 `WireCardSection`을 쓰고 제목, 본문, 입력 라벨을 임의 스타일로 만들지 않는다. |
| §3 형태, §4 색 | 기존 `WireButton` 형태와 높이, neutral/primary 역할을 재사용한다. 정보 안내는 기존 `WireCallout`을 쓰며 새 위험 색을 만들지 않는다. |
| §5 입력과 도움말, HERO | 파일 입력의 보이는 라벨과 접근성 연결을 유지한다. 안전 문구는 기존 13px `hint` 슬롯에 둔다. `PageTitle` 하나만 h1으로 두고 HERO의 이름과 상태는 기존 라벨/값 계약을 따른다. 초안이 없는데 `검토 대기`라고 표시하지 않는다. |
| §7 여백 | `.page-content`, 카드와 구획, `.wire-form-actions`의 공용 간격을 그대로 쓴다. 새 gap, margin, padding이나 수동 픽셀 보정을 넣지 않는다. |
| §9 좁은 화면 카드 행동 | 당사자 카드 전용 전폭 행동 규칙을 업로드 폼으로 확대하지 않는다. 기존 폼 행동의 계약으로 모바일을 검수한다. |
| 디자인 미리보기의 기본 상태, 검사가 잡는 것과 못 잡는 것 | 합성 자료로 채운 상태와 빈 상태/거부 상태를 따로 렌더한다. 기준선 완화나 새 위반 등록 없이 실제 DOM 치수와 위계를 확인한다. |

`@ccc/wire`와 스타일의 실제 정본은 `packages/wire/src`다. 웹의 `wire-styles.ts:1-5`는 패키지를 다시 내보낼 뿐이므로, 없는 웹 전용 스타일 파일이나 컴포넌트를 새로 만들지 않는다.

## 7. 수용 기준과 검수 방법

아래는 **DESIGN 및 연결 담당이 구현한 뒤 수행할 검수**다. 이 문서 작업에서는 UI를 실행하거나 업로드 성공을 검증했다고 주장하지 않는다.

1. 실제 `apps/web`의 지정 목록에서 해당 회차의 `녹음 올리기`를 눌러 같은 당사자/케이스/회차의 검토 URL로 이동한다. 초안 없음 404는 이 회차의 업로드 대기로만 바뀌고, 다른 케이스나 없는 회차의 오류를 빈 초안으로 바꾸지 않는다.
2. 초안 없음 × STT off/local/azure, 기존 초안, legacy_import, 조회 중/실패를 각각 렌더한다. 업로드 구획은 정한 두 조건에서만 보인다. 수기 기록과 기존 승인/반려/재생성/fixture 차단은 그대로 작동한다.
3. §4의 여섯 코드와 두 하위 분기를 모두 실제 웹 오류 변환 계층을 거쳐 렌더한다. **세 누락 코드가 HTTP 상태 폴백으로 변하지 않는지** 확인한다. 401/403/404/503과 잘못된 응답도 별도로 확인한다. 합성 응답 fixture는 문구 검수 증거일 뿐 서버 개통 증거가 아니다.
4. 파일 없음, 0바이트, 상한과 상한 초과, 허용 MIME, MIME 부재 시 확장자 보완, 비허용 MIME을 확인한다. sending 중 이중 클릭이 두 발급을 만들지 않는지, 파일 선택 잠금과 live 안내가 동작하는지 확인한다. 대상 발급 실패, 파일 PUT 실패, 완료 등록 실패 각각에서 성공으로 넘어가지 않아야 한다.
5. 서버 선행 조건이 열린 승인된 시험 환경에서만 합성 녹음 한 건으로 발급→직접 PUT→완료를 실행한다. 네트워크에서 원음 본문이 웹 Server Action이나 Worker API를 통과하지 않는지, 외부 PUT에 인증 헤더/쿠키가 없는지 확인한다. 원본 `id`와 `aiStatus='uploaded'`가 확인돼야 접수 성공이다. 업로드 뒤 초안이 생긴 사실이나 원음 삭제 완료는 별도 서버 증거 없이 단정하지 않는다.
6. 같은 시험에서 동의 철회, 권한 변경 또는 저장 객체 불일치가 완료 전 일어나면 등록이 거부되는지 확인한다. 잘못된 origin과 리다이렉트 대상에는 파일을 보내지 않는다. 자동 재시도나 자동 저장소 전환이 없어야 한다.
7. 실제 웹 화면을 1280, 767, 390, 320px과 라이트/다크로 열어 스크린샷과 DOM 실측을 남긴다. 긴 파일명과 가장 긴 거부 문구에서도 가로 넘침, 파일 입력 잘림, 버튼 겹침이 없어야 한다. PageTitle/HERO 위계, 도움말 연결, 키보드 파일 선택과 버튼 조작, 오류/live 안내도 확인한다. 기존 부품의 글자, 버튼 높이, 간격이 유지되는지 측정한다.
8. 구현 시 기존 `review/page.test.tsx`, `review/fixture-draft-view.test.tsx`와 웹 API 관련 검사를 필요한 범위만 실행하고, DESIGN 레인의 해당 화면 시각 검수를 받는다. 새 컴포넌트/CSS/색/여백 값은 모두 0건이어야 한다. 공용 가드나 기준선을 바꿔 통과시키지 않는다.

본 문서의 검수는 필수 8항목, 인용한 소스와 줄 범위, 여덟 원문 거부 문구, 안전 문구 두 줄, 제외 범위 및 문서 단독 변경 여부를 확인하는 것으로 끝낸다. 전체 테스트와 전체 빌드는 실행하지 않는다.

## 8. 손대지 말 것과 선행 조건

### 선행 조건과 소유자

아래 소유자는 작업 역할이며 별도 지정이 없는 담당자 이름을 추정한 것이 아니다. 오케스트레이터가 연결 작업자를 배정하고, 기존 파일 소유권 밖 변경은 레포의 정식 인계/예외 절차를 먼저 따른다. 이 문서 자체는 새 수정 권한을 부여하지 않는다.

| 선행 조건 | 현재 근거와 필요한 결과 | 소유자 |
| --- | --- | --- |
| NER 자격과 전사 활성화 승인 | NER 산정 미달은 사용자 보고 사실이다. 이 작업은 측정 수치나 처리 코드의 변경 상태를 확인하지 않았다. 품질 충족과 활성화 승인 전에는 16일 수기 운영 결정을 유지한다. | NER/처리 담당과 오케스트레이터, 활성화 승인자 Q |
| 서명 설치와 일치하는 capability/runtime | `verifiedInstallManifest`는 manifest/서명 검증 실패와 non-community-cloud를 거부한다(`capabilities.ts:36-56`). `buildCapabilities`는 Local을 false로 고정하고 승인 Azure와 readiness를 사용한다(59-84행). `resolveAgentRuntime`은 env의 local을 거부하며 승인된 Azure만 엔진으로 고른다(`request-handler.ts:1590-1603`). 정책 DB 기반 capability와 env 기반 runtime이 일치해야 한다. **현재 웹에 Local 버튼을 그리는 것으로 Local API가 열리지 않는다.** | 서버/설치 레인 |
| Cloud 업로드 대상 발급 | `apps/api/src/index.ts:27-37`의 기본 조합은 R2이며 `adapters/audio-r2/src/index.ts:166-168`의 `createUploadTarget()`은 null이다. 이 null은 503이 된다(`request-handler.ts:2242-2251`). 승인된 기관 소유 Supabase private Storage와 유효한 업로드 대상 발급 경로, 허용 origin 전달, 브라우저 PUT 허용이 먼저 연결돼야 한다. R2를 새 원음 저장소로 열거나 direct PUT 분기로 강제 전환하지 않는다. | 서버/Storage/설치 레인 |
| 도입 확인, 동의, 담당 권한 | §4의 gateway 검사와 등록 직전 재검사를 모두 통과해야 한다. 사업 저장/처리 선택과 문안/설치 버전의 재확인을 화면 버튼으로 대신하지 않는다. | 서버/core 레인, 기관 관리자와 담당 실무자 |
| 건강한 Agent와 영업일/삭제 경로 | `getSttReadiness`의 미만료 ready/capacity=1, 다음 영업일 산정용 달력, 업로드 실패 정리, 처리 후 삭제 및 7일 상한을 실제 배포에서 검증해야 한다(`gateway.ts:8994-9135`, `request-handler.ts:2237-2257,2275-2297`). 이 문서는 실제 처리 장비나 삭제 실행 상태를 조사하지 않았다. | 서버/처리/운영 레인 |
| 웹 메타데이터 호출과 거부 보존 | §3의 `api.ts` 함수와 서버 액션, §4의 누락 코드 세 가지를 먼저 연결한다. 실제 신원 아래 capability 조회가 되는지도 확인한다. 없는 함수/필드를 화면 담당이 임의 응답으로 채우지 않는다. | 프런트엔드/API 연결 담당, 소유권 조정은 오케스트레이터 |
| 화면 이식과 검수 | 기존 `DraftReviewView`와 `RecordList`를 확장하고 §7의 실화면 증거를 남긴다. | DESIGN 레인 |

위 선행 조건이 열리지 않은 상태에서는 합성 응답으로 배치와 거부 문구를 검수할 수는 있어도, **동작 가능한 원음 업로드 인계 완료나 실사용 개통으로 판정하지 않는다.** 운영 게이트 우회가 필요한 상황이면 화면 구현을 억지로 이어 가지 않고 해당 소유자에게 되돌린다.

### 이번 범위가 아닌 것

- 이 작업이 만드는 파일은 이 문서 하나다. 코드, 테스트, 공유 스타일, 디자인 토큰, `DESIGN.md`, `DESIGN-RULES.md`는 수정하지 않는다.
- `apps/pipeline`의 열람과 수정, NER 튜닝/재측정, STT 엔진 채택과 활성화, 배포 환경/시크릿/권한 변경은 하지 않는다.
- 업로드 API 개통, Storage 전환, Local 런타임 구현, 동의 모델이나 보존 정책 변경은 이 문서의 선행 조건이지 이번 실행 범위가 아니다.
- 새 컴포넌트, 새 CSS, 새 색, 새 여백, 녹음기, 드래그앤드롭, 파형/재생기, 전사 전문 뷰어, 진행률 숫자, 자동 재시도/전환을 추가하지 않는다.
- 수기 기록 경로, R1~R5, 승인/반려와 화자 확인, 서버 권한/감사/동의 검사를 약화하지 않는다.
- 다른 작업자의 산출물, 다른 워크트리와 브랜치는 변경하지 않는다. 커밋은 이 문서 하나만 한 번 만들고 push, merge, `ccc-preview` 또는 운영 배포는 하지 않는다.
