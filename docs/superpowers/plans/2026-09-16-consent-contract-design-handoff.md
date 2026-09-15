# 여섯 영역 동의 계약 DESIGN 인계 패킷

작성 기준: 2026-09-16, `release/0916`, 데이터 연결 커밋 `f9807fbb`.
수신자는 w1G:p1 DESIGN 레인이다. 이 문서는 `frontend-lane` 스킬의 필수 8항목을 따른다.

**상태: 화면 구현 완료 보고가 아니다.** 등록과 동의 수정의 서버 계약, 현재 화면의 누락, 이미 고친 데이터 계층 무결성 결함을 적은 인계다. 아래에서 `확인 필요`로 표시한 자리는 화면이 값을 만들거나 우회하면 안 된다.

정책 정본은 [`docs/specs/S7-consent-six-domains.md`](../../specs/S7-consent-six-domains.md)다. 이 패킷은 정본을 복제하거나 바꾸지 않고 `apps/web` 화면이 현재 코드 계약에 연결되는 방법만 구체화한다. 과거 D49, ADR-0021의 동의 2종 문서는 역사 기록이며 새 grant의 근거가 아니다(S7 §5.1.1).

## 1. 목표 한 줄

서버가 발급한 여섯 영역 고지의 `fullKoreanCopy`를 사용자가 그대로 읽고, 같은 응답의 `snapshotId`가 `disclosureSnapshotId`로 기록되도록 등록, 공개 가입, 동의 수정 화면을 연결한다.

## 2. 붙을 자리

| URL 또는 흐름 | 현재 파일 | 붙일 계약 |
| --- | --- | --- |
| `/participants/new` | [`apps/web/app/participants/new/page.tsx`](../../../apps/web/app/participants/new/page.tsx):39-81, [`register-form.tsx`](../../../apps/web/app/participants/new/register-form.tsx):24-89,91-203 | 사업 확정, 등록용 고지 6건 조회, 여섯 결정과 같은 스냅샷 제출 |
| `/participants/:beneficiaryId` | [`apps/web/app/participants/[beneficiaryId]/page.tsx`](../../../apps/web/app/participants/[beneficiaryId]/page.tsx):118-129,166-208,327-355 | 담당하는 참여 사업마다 현재 상태와 케이스용 고지 6건 조회, 바뀐 영역만 제출 |
| `/join/participant/:token` | [`apps/web/app/join/participant/[token]/page.tsx`](../../../apps/web/app/join/participant/[token]/page.tsx):15-38, [`signup-form.tsx`](../../../apps/web/app/join/participant/[token]/signup-form.tsx):36-50,61-127 | 공개 초대 토큰용 고지 6건 조회, 여섯 결정과 같은 스냅샷 제출 |
| 추가 참여 사업 등록 | [`apps/web/app/actions.ts`](../../../apps/web/app/actions.ts):1108-1140 | `createSubsequentParticipantProgramAction`도 같은 여섯 영역 계약을 쓴다. 현재 `apps/web/app`에서 이 액션을 호출하는 화면은 확인되지 않았다. 화면 범위는 확인 필요다. |

현재 세 화면은 `consentPrivacy`, `consentRecordingAi` 두 체크박스를 보낸다(`register-form.tsx:171-195`, `page.tsx:122-125,186-200`, `signup-form.tsx:75-94`). 서버 액션은 이 두 이름을 읽지 않는다(`actions.ts:820-825,1068-1082,1306-1317`). 그대로 두면 세 흐름 모두 API 호출 전에 `invalid_request`로 멈춘다. participant hub는 아직 `?error=`를 읽지 않아 그 실패를 화면에 표시하지 못한다.

데이터 함수는 이미 있다.

- 등록 전 고지: `issueRegistrationConsentDisclosures(programId)` (`apps/web/app/lib/api.ts:1101-1106`)
- 참여 사업 동의 고지: `issueSupportCaseConsentDisclosures(supportCaseId)` (`api.ts:1094-1099`)
- 공개 가입 고지: `getParticipantInviteConsentDisclosures(token)` (`api.ts:1129-1138`)
- 현재 여섯 영역 상태: `getSupportCaseConsent(supportCaseId)` (`api.ts:1078-1083`)

## 3. API 계약

### 3.1 호출과 헤더

| 용도 | 경로와 메서드 | 인증, 헤더, 캐시 | 성공 응답 |
| --- | --- | --- | --- |
| 등록 가능한 사업 | `GET /program-options` | 보호 경로. `Accept: application/json`, 운영 Access JWT 또는 쿠키, preview에서는 `ccc_preview` 쿠키. `cache: no-store`, `redirect: manual` | `{ programs: Array<{ id, displayName, programType, ... }> }`. web은 `id`, `displayName`, `programType`을 읽는다(`api.ts:1108-1125,1371-1404`). |
| 등록용 고지 발급 | `GET /programs/:programId/consent/disclosures` | 위 보호 경로와 같음 | 200, `{ disclosures: ConsentDisclosureSnapshot[] }`, `Cache-Control: no-store` (`request-handler.ts:2790-2794`) |
| 최초 등록 | `POST /participants` | 위 보호 경로와 같고 `Content-Type: application/json; charset=utf-8` | 201, `{ beneficiaryId, supportCaseId, assignmentRole: 'primary', replayed }` (`api.ts:697-702,1813-1817`, `request-handler.ts:2796-2807`) |
| 현재 동의 | `GET /support-cases/:supportCaseId/consent` | 보호 경로 | 200, `{ consent: CurrentConsentState[] }` (`request-handler.ts:3058-3061`) |
| 수정용 고지 발급 | `GET /support-cases/:supportCaseId/consent/disclosures` | 보호 경로 | 200, `{ disclosures: ConsentDisclosureSnapshot[] }`, `Cache-Control: no-store` (`request-handler.ts:3069-3076`) |
| 동의 이벤트 기록 | `POST /support-cases/:supportCaseId/consent-events` | 보호 경로, JSON | 201, 기록된 `ConsentEvent` 한 건 (`request-handler.ts:3078-3086`) |
| 공개 가입용 고지 | `GET /invites/participant/:token/consent/disclosures` | 공개 경로. `Accept: application/json`, Access 헤더 없음, `cache: no-store`, `redirect: manual` | 200, `{ disclosures: ConsentDisclosureSnapshot[] }`. 무효 토큰과 권한 실패는 404 `not_found` (`request-handler.ts:2400-2408`, `api.ts:1129-1138`) |
| 공개 가입 | `POST /signup/participant` | 공개 경로. `Accept`와 JSON `Content-Type`, Access 헤더 없음, `cache: no-store`, `redirect: manual` | 201, `{ beneficiaryId, supportCaseId }` (`api.ts:2732-2774`, `request-handler.ts:2413-2424`) |

보호 경로의 실제 헤더 전달과 오류 변환은 `apps/web/app/lib/api.ts:1371-1469`가 맡는다. 화면에서 Access 토큰이나 preview 쿠키를 직접 읽어 새 요청을 만들지 않는다.

`page.tsx`는 보호된 데이터 함수를 서버에서 호출하고 결과를 client form에 props로 넘긴다. client form이 보호 endpoint를 다시 fetch하거나 인증 값을 다루지 않는다. form은 받은 snapshot props로 전문과 hidden JSON을 함께 만든다.

### 3.2 서버가 내리는 고지 한 건

정본 타입은 `packages/contracts/src/consent.ts:60-67`, 발급 구현은 `packages/core/src/gateway.ts:8517-8582`다. 발급 함수는 `CONSENT_DOMAINS` 순서로 6건을 만들고 30분 뒤 만료되는 `expiresAt`을 붙인다.

| 응답 필드 | 타입 | 화면의 사용 |
| --- | --- | --- |
| `snapshotId` | `string` | 제출 이벤트의 `disclosureSnapshotId`가 되는 식별자 |
| `scopeBinding` | `{ orgId: string; programId: string; issuerId: string; supportCaseId: string | null }` | 화면 표시용이 아니다. 등록용은 `supportCaseId: null`, 수정용은 해당 케이스 ID다. |
| `domain` | 아래 6개 중 하나 | 행의 고정 식별자. 폼 필드 접미사와 같아야 한다. |
| `fullKoreanCopy` | `string` | 사용자가 읽는 전문. 줄이거나 로컬 문안으로 바꾸지 않는다. |
| `provider` | `ProviderId | null` | 화면이 다시 계산하지 않는다. 제출용 스냅샷 JSON에 보존한다. |
| `providerLegalRecipient` | `string | null` | 제출용 스냅샷 JSON에 보존한다. |
| `country` | `string | null` | 이벤트의 `providerCountry` 재료다. 이름을 바꾸지 않는다. |
| `purpose` | `PurposeLiteral | null` | 제출용 스냅샷 JSON에 보존한다. |
| `retentionProfile` | `'default_temporary_d85'` | 제출용 스냅샷 JSON에 보존한다. |
| `retentionDuration` | `'default_temporary_d85'` | 이벤트에는 `voice_original_retention_period`의 grant일 때만 들어가고 나머지는 `null`이다. 등록 변환은 `actions.ts:322-344`, 수정 변환은 `consent-contract.ts:71-111`이 한다. |
| `copyVersion`, `copyHash` | `string` | 서버가 발급본과 대조한다. 화면이 만들거나 고치지 않는다. |
| `issuedAt`, `expiresAt` | ISO UTC `string` | 만료된 고지는 저장되지 않는다. 재발급 뒤 전문을 다시 보여 주고 다시 결정받아야 한다. |

화면은 한 객체의 `fullKoreanCopy`를 보여 주고 같은 객체 전체를 `JSON.stringify(snapshot)` 한 문자열로 숨은 폼 필드에 실어야 한다. 제출 순간 새 고지를 발급해 기존 결정을 붙이지 않는다. 서버는 `snapshotId`, 기관, 사업, 케이스, 발급자, 영역, 만료, `copyVersion`, `copyHash`, 문안 정본을 다시 검사한다(`gateway.ts:8654-8682`).

만료를 미리 타이머로 막을지는 현재 계약에 정해져 있지 않아 확인 필요다. 확정된 최소 동작은 409에서 성공 상태로 가지 않고 페이지를 다시 불러 새 snapshot과 전문을 받은 뒤 결정을 다시 받는 것이다. 현재 web은 만료 code를 `conflict`로 접으므로 만료라고 단정한 전용 문구를 쓰지 않는다.

### 3.3 여섯 영역과 폼 필드 이름

정본 영역과 현재 한글 라벨은 `packages/contracts/src/consent.ts:3-24`다.

| 영역 `domain` | 한글 라벨 | 결정 필드 | 고지 스냅샷 필드 | 등록, 공개 가입 |
| --- | --- | --- | --- | --- |
| `personal_data_collection_use` | 개인정보 수집·이용 | `consentDecision_personal_data_collection_use` | `consentSnapshot_personal_data_collection_use` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. `grant`가 아니면 긴급 등록 사유가 없는 최초 등록과 공개 가입은 거부된다. |
| `sensitive_information_processing` | 민감정보 처리 | `consentDecision_sensitive_information_processing` | `consentSnapshot_sensitive_information_processing` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. |
| `counseling_recording` | 상담 녹음 | `consentDecision_counseling_recording` | `consentSnapshot_counseling_recording` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. |
| `external_stt_processing` | 외부 STT 처리 | `consentDecision_external_stt_processing` | `consentSnapshot_external_stt_processing` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. |
| `external_llm_cross_border_processing` | 외부 LLM·국외 처리 | `consentDecision_external_llm_cross_border_processing` | `consentSnapshot_external_llm_cross_border_processing` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. |
| `voice_original_retention_period` | 음성 원본 보유기간 | `consentDecision_voice_original_retention_period` | `consentSnapshot_voice_original_retention_period` | 두 필드 모두 필수. 결정은 `grant` 또는 `decline`. |

`consentDecision_<domain>`은 FormData `string`이다. `consentSnapshot_<domain>`도 FormData `string`이며 값은 사용자가 본 `ConsentDisclosureSnapshot` 전체의 JSON이다. 스냅샷 안 `domain`과 필드 접미사가 다르면 `FormInputError`다. 파싱과 검사는 `apps/web/app/actions.ts:272-316`이다.

등록과 공개 가입은 6개 영역의 두 필드가 모두 있어야 한다. 하나라도 빠지거나, JSON이 아니거나, 결정이 `grant|decline` 밖이면 API를 호출하기 전에 `invalid_request`로 멈춘다. 동의 수정은 바뀐 영역만 처리하지만 적어도 한 영역의 완전한 pair가 필요하다. 한쪽만 있거나 모든 신계약 필드가 없으면 `invalid_request`로 멈춘다(`actions.ts:292-316,820-825`).

### 3.4 `programId`와 등록 요청

**현재 FormData에 `programId`라는 필드는 없다.** 이름을 추정해 새 hidden input이나 select를 만들지 않는다.

`createInitialParticipantProgramAction`은 `GET /program-options` 결과에서 `programType === 'financial_support_v1'`인 항목이 정확히 하나일 때 그 `id`를 고른다. 0개 또는 2개 이상이면 API를 부르기 전에 `FormInputError`로 멈춘다(`actions.ts:345-353,1068-1082`). 등록 page도 같은 목록과 같은 단일 후보 규칙으로 `programId`를 확정한 뒤 그 ID의 고지를 발급해야 한다. page가 그 ID와 snapshot을 form props로 넘기고, 제출 action은 목록을 다시 읽어 같은 규칙을 재검사한다. 렌더 뒤 사업 목록이 바뀌어 두 결과가 달라지면 저장하지 않고 다시 불러와야 한다. 현재 `participants/new/page.tsx:48-81`은 사용자와 표시 라벨만 읽고 사업 ID와 고지를 읽지 않는다.

최초 등록의 API body는 다음 모양이다(`api.ts:643-666`, `request-handler.ts:504-553`).

| 필드 | 타입 | 필수 | 출처 |
| --- | --- | --- | --- |
| `programId` | `string` | 필수 | 위 단일 활성 사업 해석값 |
| `idempotencyKey` | UUID `string` | 필수 | 서버 액션이 `crypto.randomUUID()`로 만든다. 화면 필드가 아니다. |
| `consentEvents` | `AppendConsentEventInput[6]` | 필수 | 여섯 결정과 여섯 스냅샷에서 서버 액션이 만든다. 영역당 정확히 1건이어야 한다. |
| `initialAssigneeUserId` | `string` | admin만 필수 | 서버 액션이 현재 admin의 `identity.id`를 넣는다. 화면 필드가 아니다. |
| `emergencyReason` | `string`, 최대 500자 | 선택 | `emergencyRegistration`이 체크됐을 때 `emergencyReason` 폼 값을 보낸다. |
| `name`, `phone`, `email`, `birthDate`, `region`, `gender` | `string` | 선택 | 기존 등록 입력을 유지한다. |

추가 참여 사업은 `schemaVersion: 1`, `submissionId`, `programId`, `consentEvents[6]`을 요구한다(`api.ts:684-696`, `actions.ts:1111-1132`). 공개 가입은 초대 토큰이 사업을 묶으므로 `programId`를 보내지 않고 `token`, `name`, 선택 `phone|email`, `consentEvents[6]`을 보낸다(`api.ts:2691-2698`, `actions.ts:1300-1317`).

### 3.5 `consentEvents` 한 건의 모양

정본은 `packages/contracts/src/consent.ts:82-88`, 등록 변환은 `apps/web/app/actions.ts:322-344`, 수정 변환은 `apps/web/app/lib/consent-contract.ts:71-111`, HTTP 파서는 `packages/http-api/src/request-handler.ts:1537-1588`이다.

| 필드 | 타입 | 등록 시 값 |
| --- | --- | --- |
| `domain` | 6개 `ConsentDomain` 중 하나 | 폼 필드 접미사와 스냅샷의 `domain` |
| `decision` | `grant | decline` | 폼 값 그대로. 최초 등록에서 `withdraw|correct`는 허용하지 않는다. |
| `provider` | `ProviderId | null` | `grant`면 스냅샷 `provider`, `decline`이면 `null` |
| `providerLegalRecipient` | `string | null` | `grant`면 스냅샷 값, `decline`이면 `null` |
| `providerCountry` | `string | null` | `grant`면 스냅샷 `country`, `decline`이면 `null` |
| `purpose` | `PurposeLiteral | null` | `grant`면 스냅샷 값, `decline`이면 `null` |
| `retentionDuration` | `'default_temporary_d85' | null` | `voice_original_retention_period`의 grant만 스냅샷 값, 나머지는 `null` |
| `copyVersion`, `copyHash` | `string` | 스냅샷 값 그대로 |
| `disclosureSnapshotId` | `string` | 사용자가 읽은 같은 스냅샷의 `snapshotId` |
| `effectiveAt` | ISO UTC `string` | 액션이 한 번 만든 현재 시각. 화면 필드가 아니다. 미래이면 `future_effective_at`, 기록 시각보다 5분 넘게 과거면 `backdated_consent_event`다. |
| `idempotencyKey` | `string` | 등록은 `${registrationIdempotencyKey}-${domain}`, 공개 가입은 `${token}-${domain}`, 수정은 영역 이벤트마다 UUID |
| `correctionOfEventId` | `null` | 화면이 만들지 않는다. |
| `expectedRevision` | `number | null` | 등록과 새 grant/decline은 `null`. 철회는 서버가 내려준 현재 상태의 최신 `revision`을 보낸다(`consent-contract.ts:71-111`). |

등록 gateway는 배열 길이 6, 영역 중복 없음, `grant|decline`, `correctionOfEventId:null`, `expectedRevision:null`, 고지 scope 일치를 검사한다(`gateway.ts:8589-8619`). `personal_data_collection_use`가 grant가 아니면 최초 등록은 긴급 등록 계약을 거친다(`gateway.ts:16779-16783`).

### 3.6 동의 수정 요청

폼의 고정 필드는 `beneficiaryId`, `supportCaseId`다(`apps/web/app/participants/[beneficiaryId]/page.tsx:175-180`). 바뀐 영역은 해당 `consentDecision_<domain>`과 `consentSnapshot_<domain>` 두 필드를 함께 보낸다.

`updateParticipantConsentAction`은 제출된 영역만 `updateParticipantConsent`에 넘긴다(`actions.ts:815-832`). API 함수는 현재 상태를 먼저 읽고 다음처럼 이벤트 결정을 바꾼다(`api.ts:1859-1885`).

| 폼 결정 | 현재 상태 | POST 결정 |
| --- | --- | --- |
| `grant` | 모든 상태 | `grant` |
| `decline` | `granted` | `withdraw` |
| `decline` | `unconfirmed` 또는 `not_granted` | `decline` |

`grant`는 새 케이스용 스냅샷의 provider 범위를 쓴다. `decline`은 provider 관련 값을 모두 `null`로 보낸다. `withdraw`도 먼저 발급받은 케이스용 snapshot pair가 필요하고 서버가 모든 결정에서 snapshot scope를 검사한다(`gateway.ts:8706-8709`). 철회 이벤트는 대상 grant의 provider 범위와 최신 revision을 보낸다(`consent-contract.ts:71-111`). 현재 상태 decoder는 서버가 내린 provider 범위와 revision, eventSequence를 모두 보존한다(`consent-contract.ts:34-69`). core의 provider scope와 최신 revision 검사는 그대로다(`gateway.ts:8713-8748`).

현재 구현은 영역마다 `POST /consent-events`를 순서대로 부른다. 여러 영역을 한 번에 보내다가 뒤 이벤트가 실패하면 앞 이벤트는 이미 기록됐을 수 있다. API에 여섯 영역 수정용 원자 batch 경로는 확인되지 않았다. 화면은 실패 뒤 성공하지 않은 것으로 추정해 로컬 상태를 덮지 말고 현재 상태를 다시 읽어야 한다.

## 4. 거부와 상태 전체

### 4.1 서버와 web 변환

| 발생 조건 | API 응답 | 현재 web이 받는 코드 | 현재 화면 |
| --- | --- | --- | --- |
| 등록, 공개 가입에서 6쌍 중 하나 누락, 결정값 오류, snapshot JSON 오류, domain 불일치 | API 호출 전 `FormInputError` | `invalid_request` (`actions.ts:519-545`) | 등록은 `입력한 정보를 다시 확인하세요.`. 공개 가입은 `invalid_request` 문구가 없어 `알 수 없는 오류가 발생했습니다.` (`participants/new/page.tsx:15-27`, `signup-form.tsx:27-49`) |
| 수정에서 한 쌍의 한쪽만 누락, 또는 신계약 pair가 모두 없음 | API 호출 전 `FormInputError` | `invalid_request` | action은 저장하지 않고 `/participants/:id?error=invalid_request`로 돌아간다. participant hub의 오류 query 표시가 남은 화면 작업이다. |
| `programId` 후보 0개 또는 2개 이상 | API 호출 전 `FormInputError` | `invalid_request` | 등록 상단 일반 확인 문구 |
| 등록 body 형식, 정확히 6개가 아님, 중복 영역, 초기 결정에 `withdraw|correct` 포함 | 400 `invalid_request` | `invalid_request` | 등록 일반 확인 문구 |
| 개인정보 수집·이용 grant 없음, 긴급 등록 아님 | 422 `privacy_consent_required` | 같은 코드 보존 | `개인정보 수집·이용 동의를 체크해야 등록할 수 있습니다. 동의를 먼저 받을 수 없다면 긴급 등록을 선택하세요.` |
| 긴급 등록인데 사유가 빈 문자열 | 422 `emergency_reason_required` | 같은 코드 보존 | `긴급 등록에는 사유를 적어야 합니다.` |
| 프로그램 도입 상태가 등록 불가 | 409 `program_admission_required`와 `reason` | `ApiErrorCode`에 없어 `conflict`로 접힘 (`api.ts:28-75,1412-1424`) | 등록은 `이미 처리된 요청입니다. 다시 확인하세요.`로 표시한다. 원인을 정확히 말하지 못하는 현재 제한이다. |
| provider registry가 없어 고지를 발급할 수 없음 | 409 `provider_registry_unavailable` | `conflict` | 등록은 conflict 문구. participant hub는 오류 렌더 없음. |
| 만료, 다른 사업·케이스·발급자·영역의 스냅샷, copyVersion/hash/문안 불일치 | 409 `consent_disclosure_mismatch` | `conflict` | 등록은 conflict 문구. participant hub는 오류 렌더 없음. |
| provider, 수신자, 국가, 목적, 보유기간 범위 불일치 | 409 `provider_scope_mismatch` | `conflict` | 위와 같음 |
| 미래 또는 5분 넘게 과거인 effectiveAt | 409 `future_effective_at` 또는 `backdated_consent_event` | `conflict` | 위와 같음 |
| 철회 대상 grant 없음 | 409 `consent_not_effective` | `conflict` | participant hub 오류 렌더 없음 |
| 철회의 `expectedRevision`이 최신값과 다름 | 409 `revision_conflict` | `conflict` | participant hub 오류 렌더 없음 |
| 같은 idempotencyKey에 다른 body | 409 `idempotency_conflict` | `conflict` | 등록은 conflict 문구. participant hub 오류 렌더 없음. |
| 비담당, 역할·기관 불일치 | 403 `forbidden` | `forbidden` | 등록은 권한 문구. participant hub는 오류 렌더 없음. |
| 인증 없음 | 401 | `authentication_required` | 등록은 로그인 문구. 공개 가입은 Access 인증을 쓰지 않는다. |
| 응답 파싱 실패, 통신 실패, 그 밖 500 | 500 또는 fetch 실패 | `service_unavailable` | 등록과 공개 가입은 각 가용성 문구. participant hub는 오류 렌더 없음. |
| 성공 | 등록 201, 동의 이벤트 201 | 등록 redirect 또는 `consent_updated` | 최초 등록은 `/schedules/new?target=<beneficiaryId>|<supportCaseId>`로 이동한다(`actions.ts:1101-1105`). hub는 `동의 내용을 저장했습니다.` |

Consent 오류 8종은 `packages/core/src/gateway.ts:194-207`, HTTP 직렬화는 `packages/http-api/src/request-handler.ts:2301-2340`이다. 현재 `ApiErrorCode`는 이 세부 코드를 보존하지 않고 409를 모두 `conflict`로 접는다. DESIGN은 존재하지 않는 세부 code를 분기하지 않는다. 코드 보존이 필요하면 프런트엔드/API 연결 담당에게 되돌린다.

### 4.2 participant hub의 오류 누락

`updateParticipantConsentAction`은 실패하면 `/participants/:beneficiaryId?error=<code>`로 redirect한다(`actions.ts:824-826`). 현재 `ParticipantPage`는 `searchParams.notice`만 읽고 `error`를 읽지 않는다(`page.tsx:496-507`). 따라서 동의 수정 실패는 현재 화면에서 보이지 않는다. 성공 notice만 `동의 내용을 저장했습니다.`로 그린다(`page.tsx:306-309,355-365`). 오류 UI를 구현할 때 이 query 연결을 함께 닫아야 한다.

participant hub에 쓸 동의 수정 실패 문구는 현재 코드에 없어 확인 필요다. 기존 `WireError`를 쓸 수 있지만 세부 Consent code는 web에서 `conflict`로 접히므로, 서버가 구분해 주지 않는 원인을 문구에서 추정하지 않는다.

## 5. 문구 초안

영역 제목은 §3.3의 한글 라벨을 쓴다. 전문은 서버 응답의 `fullKoreanCopy`를 그대로 표시한다. `apps/web/app/participants/new/consent-copy.ts`가 다시 내보내는 구 2종 `consent-notice` 문안을 6영역 고지 대신 쓰지 않는다.

결정 control의 제출값은 `grant`, `decline`으로 고정한다. 보이는 문구는 DESIGN이 정하되, `decline`을 단순한 입력 누락과 구분해야 한다. 등록과 공개 가입에서는 여섯 영역 모두 명시적 결정을 보낸다.

현재 확인된 결과 문구는 다음뿐이다.

- 등록 `invalid_request`: `입력한 정보를 다시 확인하세요.`
- 개인정보 동의 필수: `개인정보 수집·이용 동의를 체크해야 등록할 수 있습니다. 동의를 먼저 받을 수 없다면 긴급 등록을 선택하세요.`
- 긴급 사유 필수: `긴급 등록에는 사유를 적어야 합니다.`
- 동의 수정 성공: `동의 내용을 저장했습니다.`
- 공개 가입 `invalid_request`: 확인 필요. 현재는 `알 수 없는 오류가 발생했습니다.`로 내려간다.
- 동의 수정 실패: 확인 필요. 현재 participant hub가 `error` query를 그리지 않는다.

## 6. 적용되는 `DESIGN-RULES.md` 절

| 절 | 적용 |
| --- | --- |
| §1 위계 표, §2 부품 2종 | 여섯 영역을 임의 제목 계단과 손으로 쌓은 구획으로 만들지 않는다. 기존 Wire 부품과 정해진 제목 계단을 쓴다. |
| §3 형태 어휘 3종 | 영역 행과 전문 펼침의 테두리, radius를 새로 만들지 않는다. 기존 반복 카드와 아코디언 형태를 재사용한다. |
| §4 색 계열 의미 | grant, decline, 오류의 의미에 새 색을 만들지 않는다. 기존 상태 의미를 따른다. |
| §5 안내 글자와 입력 | `fullKoreanCopy`, 도움말, 오류의 읽기 계단과 입력 label을 기존 규칙으로 둔다. 필드 이름을 시각 텍스트로 노출하지 않는다. |
| §7 여백 4단 | 여섯 행과 전문 사이에 새 gap, margin, padding 값을 만들지 않는다. |
| §8 꺽쇠와 펼침 채움 | 전문 펼침은 기존 `DisclosureChevron`과 아코디언 방향·채움 규칙을 쓴다. |
| 디자인 미리보기의 기본 상태 | 가상 데이터로 6영역 전체, 긴 문안, grant와 decline, 오류, 만료 상태를 렌더한다. 실제 개인정보를 쓰지 않는다. |
| 검사가 잡는 것과 못 잡는 것 | DOM 실측과 실제 FormData를 함께 확인한다. 보이기만 하는 합성 화면을 계약 완료로 판정하지 않는다. |

## 7. 수용 기준

1. `/participants/new`는 action과 같은 단일 `financial_support_v1` 후보 규칙으로 등록 대상 `programId`를 먼저 확정하고 그 ID로 발급한 고지 6건을 form props로 넘긴다. 6개 `fullKoreanCopy`가 모두 보이고 각 영역은 `grant|decline` 중 하나를 명시적으로 결정할 수 있다.
2. 등록 제출 FormData에는 §3.3의 `consentDecision_<domain>`과 `consentSnapshot_<domain>` 12개 필드가 있다. 각 snapshot 필드의 JSON은 화면에 보인 같은 객체다. API body의 `consentEvents`는 정확히 6건이고 `disclosureSnapshotId === snapshot.snapshotId`다.
3. snapshot JSON을 제거하거나 다른 영역의 snapshot을 넣으면 등록은 API 호출 전에 `invalid_request`로 멈춘다. 만료되거나 다른 scope의 snapshot이면 API가 409로 거부하고 화면은 성공으로 이동하지 않는다. 페이지를 다시 불러 새 전문을 보여 준 뒤 결정을 다시 받는다.
4. `personal_data_collection_use=decline`인 일반 등록과 공개 가입은 422로 멈춘다. 실무자 최초 등록에서만 기존 긴급 등록 사유 계약이 적용되고 공개 가입에는 긴급 예외가 없다.
5. participant hub는 담당하는 참여 사업마다 현재 6영역 상태와 그 support case에 묶인 새 고지 6건을 쓴다. 다른 사업용, 등록용, 다른 사용자가 발급한 snapshot을 재사용하지 않는다.
6. 동의 수정은 바뀐 영역의 두 필드만 함께 보낸다. 누락, 실패, 부분 성공 가능성 뒤에는 서버 현재 상태를 다시 읽고 저장 성공 문구를 먼저 띄우지 않는다.
7. 기존 grant 철회는 `withdraw` 이벤트에 서버가 내린 provider 범위와 최신 `expectedRevision`이 들어가야 한다. 회귀 테스트는 이 계약을 고정했으며, 화면 완료 검수에서는 실제 201과 최신 `not_granted` 상태를 확인한다.
8. 공개 가입은 `GET /invites/participant/:token/consent/disclosures`의 6건을 보여 주고 같은 12개 FormData 필드를 제출한다. `programId`를 만들지 않는다. 토큰이 사업 scope를 정한다.
9. 네트워크에서 보호 경로의 인증 헤더·쿠키 전달, 공개 경로의 무인증 요청, 모든 GET의 `no-store`, JSON POST를 확인한다. 응답 원문, snapshot JSON, token을 오류 query나 로그에 쓰지 않는다.
10. 1280, 767, 390, 320px과 라이트·다크에서 6영역 전체, 가장 긴 전문, 오류 문구, 펼침·접힘, 키보드 조작을 실제 화면으로 확인한다. 새 컴포넌트, 새 CSS, 새 색, 새 여백 값은 0건이어야 한다.

## 8. 손대지 말 것과 선행 조건

### 손대지 말 것

- `packages/contracts/src/consent.ts`, `packages/core/src/gateway.ts`, HTTP parser의 여섯 영역, snapshot 검증, provider scope, revision 검사를 화면 편의에 맞춰 약화하지 않는다.
- snapshot이 없을 때 기본 객체, 임의 `snapshotId`, 임의 `copyHash`, 임의 provider 값을 만들지 않는다.
- 화면에 보여 준 고지와 제출 snapshot을 갈라 놓지 않는다. 제출 시 재발급한 snapshot에 이전 결정을 붙이지 않는다.
- 구 `consentPrivacy`, `consentRecordingAi` 두 값을 여섯 영역으로 자동 확대하지 않는다. 특히 민감정보, 외부 STT, 외부 LLM·국외 처리 동의를 추정하지 않는다.
- `programId` FormData 필드 이름은 현재 정해져 있지 않다. action 계약이 정해지기 전에 select나 hidden 값을 임의로 추가하지 않는다.
- 새 컴포넌트, 새 CSS, 새 색, 새 여백 값을 만들지 않는다. 공유 스타일과 디자인 토큰 변경은 DESIGN 규약을 따른다.

### 완료된 data layer 계약

`consent-contract.ts:34-69`는 `CurrentConsentState` 전체를 보존하고, 71-111행은 withdraw에 최신 revision과 기존 provider 범위를 넣는다. `actions.ts:292-316,820-828`은 반쪽 pair와 빈 신계약 제출을 `invalid_request`로 막는다. `consent-action.test.ts` 2건과 `lib/consent-api.test.ts` 1건은 수정 전 실패하고 수정 후 통과했다.

### 선행 조건과 소유자

| 선행 조건 | 확인된 현재 상태 | 소유자 |
| --- | --- | --- |
| 등록 사업 선택 계약 | 현재 action은 활성 `financial_support_v1`이 정확히 하나일 때만 자동 선택한다. 여러 사업을 선택하는 FormData 이름은 없다. 여러 후보를 지원해야 한다면 action 입력 계약을 먼저 정해야 한다. | 프런트엔드/API 연결 담당, 오케스트레이터 |
| 등록 화면 고지 로드 | 현재 page는 `programId`와 disclosures를 form에 주지 않는다. `listProgramOptions`와 `issueRegistrationConsentDisclosures` 함수는 준비돼 있다. | w1G:p1 DESIGN, page 데이터 연결 포함 |
| hub 고지 로드 | 현재 hub는 접힌 2종 상태만 받고 support-case disclosures를 form에 주지 않는다. `issueSupportCaseConsentDisclosures` 함수는 준비돼 있다. | w1G:p1 DESIGN, page 데이터 연결 포함 |
| 공개 가입 고지 로드 | 현재 page는 invite info만 읽는다. `getParticipantInviteConsentDisclosures` 함수는 준비돼 있다. | w1G:p1 DESIGN, page 데이터 연결 포함 |
| hub 오류 표시 | action은 `?error=`로 돌아오지만 page는 `notice`만 읽는다. §4.2의 오류 연결이 필요하다. | w1G:p1 DESIGN |
| 세부 Consent 오류 보존 | raw API는 409 세부 코드를 주지만 `ApiErrorCode`가 모두 `conflict`로 접는다. 세부 문구가 필요하면 code 목록과 화면 매핑을 먼저 확정한다. | 프런트엔드/API 연결 담당 |
| preview API 버전 | `ccc-api-preview`가 고지·동의 이벤트 신계약을 포함한 release 코드와 맞아야 화면 실검증이 가능하다. 이 문서는 배포하지 않는다. | ProductionRelease 또는 preview 인프라 담당 |

이 작업은 화면, 서버, 배포를 변경하지 않았다. 데이터 계층과 회귀 테스트는 위 무결성 결함 두 건만 고쳤다. DESIGN은 남은 선행 조건이 풀리지 않은 경로를 합성 성공 상태로 대신하지 않는다.
