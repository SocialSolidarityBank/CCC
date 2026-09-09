# 당사자 화면과 기관 준비 화면 design 인계 패킷

작성: 2026-09-10, 프런트엔드 레인(`.worktrees/frontend`, `frontend/beta-0.9-client`).
`frontend-lane` 스킬의 필수 8항목을 채운 인계다. 화면 규칙, 배치, 최종 문안은 design 레인이 정한다.

## 1. 목표

업무 클라이언트(D80 `apps/client`)의 당사자 목록, 등록, 정보 허브, 기본정보 수정과 기관 준비 화면을
실제 API 위에서 동작하는 상태로 세웠다. 프런트엔드 레인이 계약, 거부 코드, 잠금 사실을 확정했고,
남은 것은 배치와 부품이다. 새 CSS와 새 부품을 프런트엔드에서 만들지 않았다.

## 2. 파일과 URL

| URL | 화면 | 파일 |
| --- | --- | --- |
| `/participants` | 당사자 목록 | `apps/client/src/screens/participants.tsx` `ParticipantListScreen` |
| `/participants/new` | 당사자 등록 | 같은 파일 `ParticipantRegisterScreen` |
| `/participants/:beneficiaryId` | 당사자 정보 허브 | 같은 파일 `ParticipantHubScreen` |
| `/participants/:beneficiaryId/edit` | 기본정보 수정 | 같은 파일 `ParticipantBasicInfoScreen` |
| `/onboarding` | 기관 준비와 사업 도입 확인 | `apps/client/src/screens/institution.tsx` |

API 경계는 `apps/client/src/business/participants.ts`, `institution.ts`이고 권한 판정은
`apps/client/src/business/navigation.ts`가 갖는다.

## 3. API 계약

| 호출 | 응답에서 화면이 읽는 값 |
| --- | --- |
| `GET /participants` | `results[]`: `beneficiaryId`, `status`, `programCount`, `name`, `phone`, `newSignup` |
| `GET /program-options` | `programs[]`: `id`, `displayName`, `programType`, `admissionState` |
| `POST /participants` | `beneficiaryId`, `supportCaseId`, `assignmentRole`, `replayed` |
| `GET /participants/:id/hub` | `participantName`, `participantPhone`, `participantEmail`, `programs[]`(`authorized`, `assigneeNames`, `consent`, `consentRecordedAt`, `upcomingSchedule`, `intakeAt`, `status`) |
| `GET|PUT /participants/:id/basic-info` | 일곱 금고 항목 + `supportCaseContextId` + `version`(낙관적 잠금) |
| `PUT /support-cases/:id/consent` | `privacy`, `recordingAi`, `recordedAt` |
| `GET /me` | `institution` 세 축: `creatorLinkState`, `initialSetupState`, `firstProgramAdmissionState`(+ `installationState`, `retentionPolicyStatus`, `consentCopy`) |
| `POST /organization/onboarding` | 저장 뒤 `institution` 관측값 |
| `GET /programs`, `PATCH /programs/:id` | `admissionState`, `version`, `admissionCopy.version|hash`, `installation.policyVersion|configHash` |

## 4. 전체 거부와 상태

| 상황 | 화면이 받는 것 | 지금 렌더 |
| --- | --- | --- |
| 개인정보 동의 없이 등록 | 422 `privacy_consent_required` | 등록 화면 상단 오류 한 줄, 긴급 등록 사유 칸 노출 |
| 긴급 등록 사유 공백 | 422 `emergency_reason_required` | 같은 자리 오류 한 줄 |
| 도입 확인 전 사업 | 409 `program_admission_required` + `reason` | 잠김 안내, 저장 시도 금지 |
| 기본정보 저장 충돌 | 409 `conflict` | 오류 + `최신 정보 다시 읽기` 버튼, 초안 유지 |
| 비담당 사업 | `authorized: false` | 담당자 이름과 사업 존재만, 동의 조작 없음 |
| 문안 hash 불일치 | `admissionCopy.hash` 다름 | 확인 체크와 저장 버튼 비활성 + 안내 |
| 401, 403 mfa | 기존 transport 매핑 | 재인증 경로로 되돌림 |

## 5. 문구 초안

`ADMISSION_LABELS`(도입 확인 상태 9종), 등록 잠금 사유 4종, 허브의 "아직 싣지 않는 정보",
목록의 "목록에 아직 없는 것", 비담당 사업 안내가 초안이다. D87 문안 자체는
`packages/contracts/src/program-admission.ts` 정본을 그대로 렌더하며 프런트엔드가 고쳐 쓰지 않는다.

## 6. 적용 규칙 절

`DESIGN-RULES.md` §2 위계, §5 카드와 입력칸, §5 배지, §10 문안 부호. 지금은 기존 공개 부품만 쓰고
새 CSS를 만들지 않았기 때문에 아래 7번의 배치가 임시다.

## 7. 수용 기준

- 목록: 검색과 상태 좁히기가 한 화면에서 보이고, 이름 없는 당사자는 가명 ID가 제목이다.
- 등록: 잠긴 사업이 고를 수 없는 자리에 이유와 함께 보이고, 동의 두 줄과 긴급 등록이 한 흐름이다.
- 허브: 사람 정보와 사업별 카드가 구분되고, 비담당 사업이 담당 사업과 시각적으로 갈린다.
- 기본정보: 일곱 칸과 충돌 복구 버튼이 한 폼에서 읽힌다.
- 기관 준비: 세 축과 나머지 관측값이 표로 읽히고, 잠긴 확인이 눈으로 잠겨 보인다.

## 8. 손대지 말 것과 선행 조건

- STT 시험 화면(`apps/client/src/stt-trial/**`)과 기존 웹 화면은 이 패킷 범위가 아니다.
- 공유 CSS, 디자인 토큰, `DESIGN.md`, `DESIGN-RULES.md` 수정 소유는 design 레인이다.
- 선행 조건과 소유자
  - 목록 이메일과 참여 사업 이름(D88 ③): 서버 응답에 없음. 소유자 BACKEND.
  - 허브 HERO 일곱 항목 중 생년월일과 진행 상태(D88 ⑧): hub 응답에 없음. 소유자 BACKEND.
  - 비담당 허브의 담당 배정 요청(D86 ⑥): 현재 `POST /support-cases/:id/assignees`는 관리자 전용.
    실무자 발 요청 경로 없음. 소유자 BACKEND.
  - 관리자 계정의 당사자 등록: `initialAssigneeUserId`를 고를 디렉터리 화면과 계약이 없어
    이 화면은 실무자 역할로만 등록한다. 소유자 BACKEND와 후속 프런트엔드 wave.
  - 잠김 상태 전용 톤: 현재 `WireCallout`은 `info`, `mint`, `lavender`뿐이라 잠금 안내도 `info`다.
    잠김 표현이 필요하면 규칙 변경이라 티켓으로 간다.
