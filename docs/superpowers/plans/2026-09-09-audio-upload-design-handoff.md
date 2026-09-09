# 녹음 업로드 화면 인계 패킷 (design 레인)

- 작성: 2026-09-09, `.worktrees/frontend` 레인
- 상태: **준비 완료, 착수 보류.** 8장 선행 조건 두 건이 열리기 전에는 켤 수 없는 화면이다
- 근거 결정: D77(STT 모드와 기본값), D81(원음 임시 보관), D85(원음 입장 조건과 7일 상한)

## 1. 목표

상담 회차에 녹음 원음을 올리는 자리를 만든다. 올린 뒤의 전사, 마스킹, 초안 생성은 처리 장비와
기존 승인 흐름이 이미 갖고 있고, 지금 없는 것은 **올리는 화면 하나**다.

## 2. 붙을 자리

업로드는 **이미 존재하는 회차(session)** 를 대상으로 한다. 새 기록을 쓰는 중에는 세션 ID 가
없으므로 작성 화면 안에서 바로 올릴 수 없다. 후보 둘:

| 후보 | 경로 | 제약 |
| --- | --- | --- |
| 회차 상세 | `apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/` 목록에서 회차를 여는 자리 | 세션 ID 가 이미 있어 그대로 부를 수 있다 |
| 작성 저장 직후 | `records/new` 저장 응답에 담긴 세션 ID 로 이어지는 후속 단계 | 저장과 업로드가 한 흐름으로 읽히지만 화면 하나가 두 단계를 갖는다 |

최종 배치는 design 레인 계획 단계가 정한다. 레포 전체에서 `input[type="file"]` 이 있는 화면은
`apps/client/src/stt-trial/stt-trial-page.tsx`(STT 시험, `stt-client` 레인 소유) 하나이므로 참고할
기존 업무 화면은 없다.

## 3. API 계약

배포 런타임의 `audioDelivery` 가 경로를 가른다(`resolveAgentRuntime`).

| 런타임 | 절차 |
| --- | --- |
| `api-stream`(Local) | `PUT /sessions/:sessionId/audio` 로 본문을 그대로 스트리밍 |
| `protected-get`(Community Cloud) | `POST /sessions/:sessionId/audio-upload-target` 로 대상을 먼저 받는다. 같은 런타임에서 `PUT` 은 `community cloud upload requires an upload target` 으로 거부된다 |

`PUT` 요청 계약(`packages/http-api/src/request-handler.ts` `handleAudioUpload`):

- `content-type`: 허용 목록(`normalizeAudioContentType`). 목록 밖이면 거부
- `content-length`: 필수. 1 이상 209,715,200 이하(200MiB)
- `x-ccc-audio-sha256`: 선택. 주면 소문자 hex 64자여야 한다
- 응답: 세션 응답 형태(`sessionResponse`). 등록 실패 시 방금 올린 객체를 서버가 정리한다
- 업로드 유효 시간: 2시간

입장 판정은 `admitRecordingUpload`(`packages/core/src/gateway.ts`)이 갖고, 통과하면 이 값을 준다.

- `sttEngine`, `sttEngineId`: 실제로 쓸 엔진
- `requiredConsent`: `azure` 면 `counseling_recording` + `external_stt_processing`, 그 밖은
  `counseling_recording`
- `eligibleAfter`: 처리 가능 시점(다음 영업일 관문)
- `retentionHardCapAt`: 업로드 기준 7일 절대 상한

## 4. 화면이 그려야 하는 상태

| 상태 | 서버 | HTTP | 화면이 말해야 하는 것 |
| --- | --- | --- | --- |
| 올릴 수 있다 | 입장 통과 | 200 | 진행률, 처리 예정 시점(`eligibleAfter`), 원음 보관 상한(`retentionHardCapAt`) |
| 엔진 없음 | `engine_unavailable`(`sttEngine` 이 null 이거나 readiness 없음) | 422 | 지금은 녹음을 받을 수 없고 수기 기록으로 남긴다 |
| 동의 미충족 | `consent_not_effective` | 409 | 어느 동의가 필요한지(`requiredConsent` 축) |
| 결과 확정됨 | 이미 처리 결과가 커밋된 회차 | 409 | 다시 올릴 수 없다 |
| 권한 없음 | 담당 배정 없는 회차 | 403 | 담당 실무자만 올릴 수 있다 |
| 파일 문제 | content-type, content-length 위반 | 422 | 형식과 용량 한도 |

`yellow` **거부 코드는 화면 문구와 한 커밋이다.** 지금 `apps/web/app/lib/api.ts` 의
`ApiErrorCode` 목록에는 `engine_unavailable` 과 `consent_not_effective` 가 없어 `errorCode()` 가
422 를 `invalid_request`, 409 를 `conflict` 로 뭉갠다. 프런트엔드 레인이 두 코드만 먼저 넣어
보냈지만 **타입이 막는다.** `records/new/page.tsx` 의 `RecoveryState` 가 `SubmissionFailure` 를
거쳐 이 목록에서 파생되고, 그 화면이 `Record<RecoveryState, string>` 로 **모든 코드에 문구를
강제**하기 때문에 코드만 추가하면 `tsc` 가 TS2739 로 떨어진다(2026-09-09 실측).

그래서 이 두 줄은 design 레인이 문구와 함께 한 커밋에서 넣는다. 넣을 자리 셋:

1. `apps/web/app/lib/api.ts` 의 `ApiErrorCode` 와 `knownErrorCodes`(프런트엔드 레인 소유 파일이지만
   이 두 줄은 화면 문구와 분리 불가라 같은 커밋에 둔다. 인계 합의 사항)
2. `records/new/page.tsx` 의 `Record<RecoveryState, string>` 문구 표
3. 업로드 화면 자체의 상태 문구(5장 초안)

## 5. 문구 초안

- 엔진 없음: `지금은 녹음을 받을 수 없습니다. 이 회차는 수기 기록으로 남겨 주세요.`
- 동의 미충족: `녹음 동의가 확인되지 않아 올릴 수 없습니다.` (외부 STT 경로면
  `외부 처리 동의까지 필요합니다.` 를 잇는다)
- 결과 확정됨: `이미 처리가 끝난 회차입니다.`
- 처리 예정: `<날짜> 이후 처리됩니다.`
- 보관 상한: `원음은 처리 뒤 바로 지웁니다. 늦어도 <날짜>까지만 보관합니다.`

부호는 `CLAUDE.md` 11장을 따른다(긴 대시 금지).

## 6. 적용되는 규칙 절

`DESIGN-RULES.md` 기준으로 최소 이 넷을 함께 본다.

- §1 위계 표, 특히 상태 낱말을 배지로 올리는 규칙
- §3 형태 어휘(버튼은 알약, 높이 32)
- §5 상담 기록 작성 전용 배치와 `.record-writing-help` 12/400 안내 계약
- §7 여백 3단

새 컴포넌트나 새 CSS 가 필요해지면 `apps/web/app/components/wire/` 의 부품을 고치는 쪽이
먼저다(§2).

## 7. 수용 기준

가상 데이터만 쓴다. 로컬 시드 절차는 `docs/ops.md` 미리보기 절과 아래 8장을 본다.

- 4장 표의 여섯 상태를 전부 렌더해 보인다. 최소한 엔진 없음, 동의 미충족, 올릴 수 있음 셋은
  실화면 캡처로 남긴다
- 1280, 767, 390 세 폭에서 가로 넘침 0
- `pnpm guard:tokens`, `guard:align`, `guard:hierarchy`, `design:align`, `design:hierarchy`,
  `pnpm --filter @ccc/web run test` 전부 통과
- 실제 오디오 파일을 올려 200 을 받는 경로는 8장 선행 조건이 열린 뒤에만 확인한다

## 8. 선행 조건과 손대지 말 것

| 선행 조건 | 지금 상태 | 소유 |
| --- | --- | --- |
| STT 승인(STT-G1~G3) | 미승인. 그래서 `sttEngine=null`, 입장이 항상 `engine_unavailable` | Q |
| Agent readiness 보고 | 없음. `CCC_RUNTIME_ENVIRONMENT` 에 `local` 값이 없고 NER attestation 과 release receipt 가 필요하다 | `.worktrees/e5-4-privacy-generalization` |
| `ApiErrorCode` 두 줄 추가 | 미구현. 타입이 화면 문구와 묶여 있어 4장 끝의 세 자리를 한 커밋에서 함께 채운다 | design 레인 |

손대지 말 것:

- `.worktrees/design-adjustments` 의 미커밋 파일. 최소 `apps/web/app/components/wire/shell-icons.tsx`
  가 수정 상태로 남아 있다
- `apps/client/src/stt-trial/**`(`stt-client` 레인 소유)
- 프리뷰의 `/capabilities` 503. 계약대로의 상태이며 고치지 않는다(`docs/ops.md`)

## 9. 참고: 이미 끝난 것

- 관리자 `AI·STT·연결` 탭의 STT 상태 카드(PR #319). 현재 처리, 지정된 엔진, 처리 장비 상태,
  엔진별 고정 사유 3종을 읽기 전용으로 보인다. 파일은
  `apps/web/app/admin/ai-provider/stt-status.tsx`
- 로컬 시드로 케이스 100건, 세션 550건을 넣고 당사자 허브, 15초 페이지, 상담 기록, 작성,
  승인 검토 화면이 200 으로 뜨는 것까지 확인했다
