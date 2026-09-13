# 인계 패킷: 기존 웹 첫 상담 기록 화면의 v2 계약 전환

> `frontend-lane` 스킬의 여덟 칸 형식이다. 작성 주체는 베타 총괄 레인이며, 받는 곳은 `apps/web/**`를 소유한 DESIGN 레인이다. 이 패킷은 계약 사실과 수용 기준만 담고 배치·위계·문안은 design 레인이 정한다.

## 1. 목표 한 줄

기존 웹(`apps/web`) 첫 상담 기록 화면이 새 서버 계약(`schemaVersion: 2`)으로 저장·수정·조회하도록 바꾸고, 이전 형식 기록은 그대로 읽기 전용으로 보여 준다.

## 2. 붙을 자리

- `apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/**` (위저드, 조회, 임시본, 저장 알림)
- `apps/web/app/actions.ts`의 인테이크 저장·수정 액션
- `apps/web/app/lib/api.ts`의 인테이크 컨텍스트 디코더와 요청 전송
- `apps/web/app/components/wire/wire-button.tsx`와 해당 부품 검사: `ariaLabel`과 같은 공개 API 방식으로 `ariaExpanded`, `ariaControls`를 추가해 실제 DOM의 `aria-expanded`, `aria-controls`에 연결한다. 이 변경은 frontend 레인의 영역 접기 복구가 소비한다.
- 화면 URL: `/participants/:beneficiaryId/programs/:supportCaseId/records/intake`

## 3. API 계약

정본은 코어 체크포인트 `a1afc7a770daed0f2e3b994cdf145f3dbe181eae`의 `packages/contracts/src/intake.ts`와 `packages/http-api/src/request-handler.ts`(`intakeContextResponse`, 인테이크 라우트)다. 이 문서와 코드가 다르면 코드가 사실이다.

- `GET /support-cases/:id/records/intake`: 기존 필드에 `canWrite`, `writeSchemaVersion: 2`, `moduleSnapshot { programId, programVersion, financialSupportEnabled }`가 더해진다. `saved`는 `null` 또는 `{ sessionId, heldAt, channel, revision, history, ... }`이며 `schemaVersion: 1`이면 `questionnaire: null`과 `legacyDetailsJson`, `schemaVersion: 2`면 `questionnaire`와 `legacyDetailsJson: null`이다. `history` 항목은 `{ revision, schemaVersion, heldAt, channel, actorId | null, recordedAt, convertedFromRevision, detailsJson }`이고 현재 revision은 제외한다.
- `POST`: `{ schemaVersion: 2, submissionId, heldAt, channel, questionnaire, scheduleId?, expectedScheduleVersion? }`. 두 일정 필드는 함께만 보낸다. 같은 `submissionId` 재전송은 `200 replayed: true`.
- `PUT`: `{ schemaVersion: 2, expectedRevision, heldAt, channel, questionnaire, conversion? }`. `conversion`은 이전 형식(1) 기록을 새 형식으로 고칠 때만 `{ confirmed: true, sourceRevision: expectedRevision }`.
- `questionnaire`: `{ schemaVersion: 2, moduleSnapshot, answers, linkedOrgs, additionalItems, debts }`. `answers`는 `INTAKE_QUESTIONS` 키만 허용하고 `answered`는 `text` 또는 `choices` 또는 정수 `amount` 하나, `declined | unknown | not_applicable`는 값 없음. 표 두 종은 `{ response: 'answered', rows }` 또는 응답 코드만이다. `debts`는 `moduleSnapshot.financialSupportEnabled`이고 경제 영역을 골랐을 때만 표, 그 밖에는 `null`.
- 필수 판정: 공통 21문항 + `difficulty_areas`에서 고른 영역의 문항. 화면에서 접어도 필수는 유지된다. `requiredIntakeQuestionKeys(areas)`가 정본이다.
- 응답: `{ schemaVersion: 2, revision, record { id, heldAt, channel, kind: 'intake' }, replayed }`. `POST` 201(재전송 200), `PUT` 200.
- 사업 설정: `financialSupportEnabled`는 `POST /programs`, `PATCH /programs/:id`(expectedVersion 필요), `POST /organization/onboarding`이 받고 `ProgramRecord`, `ProgramView`, `institution.firstProgram`이 돌려준다. `ProgramOption`에는 없다. 화면은 `moduleSnapshot`으로만 모듈 여부를 판단한다.

공유 부품의 추가 계약은 `ariaExpanded?: boolean`, `ariaControls?: string`이다. 기존 `ariaLabel`, 버튼·링크 렌더러, 스타일과 크기를 유지한다. 지원하지 않는 `aria-*`를 넘겼는데 TypeScript 검사가 통과했다는 이유로 DOM에 전달됐다고 보지 않는다. frontend 레인은 이 두 공개 prop을 받은 뒤 자기 소유 화면의 접기 상태와 누락 검사를 복구한다.

## 4. 거부와 상태 전체

| 상황 | HTTP | 본문 | 화면이 그려야 하는 것 |
|---|---|---|---|
| 형식 오류, 이전 형식(평면) 본문, `channel`이 문자열 아님, 필수 누락 | 400 | `{ error: 'invalid_request' }` | 저장 실패와 빠진 항목 안내. 자동 재전송 없음 |
| 권한 없음 | 403 | `{ error: 'forbidden' }` | 읽기 전용 유지, 저장 버튼 없음 |
| 오래된 `expectedRevision`, 바뀐 사업 설정 버전, 잘못된 전환 상태, 일정 버전 불일치 | 409 | `{ error: 'conflict' }` | 초안을 보존한 채 다시 불러오기 안내. 조용한 재시도 금지 |
| 닫힌 사업의 후속 등록 재시도 | 409 | `{ error: 'program_admission_required', reason: 'program_closed' }` | 등록 화면 계약(참고) |
| `canWrite: false` | 200 | 컨텍스트 그대로 | 저장된 문답·표를 읽기 전용으로 표시. 입력 컨트롤 없음 |
| `saved.schemaVersion: 1` | 200 | `legacyDetailsJson` | 저장 당시 키와 값을 그대로 표시. 새 영역·위기도로 자동 분류 금지. 편집은 전환 확인 뒤에만 |

## 5. 문구 초안

- 안내: "첫 상담 기록(인테이크)은 당사자의 상황과 필요한 도움을 함께 정리하는 기록이에요. 저장 즉시 공식 기록이 돼요."
- 이전 형식 기록: "이전 값은 그대로 보존해요. 저장 당시의 항목 이름과 값을 그대로 보여 줘요. 현재 영역이나 위기도로 자동 분류하지 않아요."
- 전환 확인: "이전 원본을 보존하고 새 양식에 직접 작성해 전환할 것을 확인했어요"
- 충돌: "다른 곳에서 먼저 저장됐어요. 다시 불러온 뒤 이어서 작성해 주세요."
- 읽기 전용: "지금은 읽기만 할 수 있어요. 저장된 내용은 계속 확인할 수 있어요." 권한과 사업 상태 중 확인되지 않은 원인을 임의로 단정하지 않는다.
- `재약속`이라는 낱말은 쓰지 않는다. 해요체, 긴 대시 금지(`CLAUDE.md` 11장).

## 6. 적용되는 `DESIGN-RULES.md` 절

§1 위계 표(입력값 ⑥, 입력칸 도움말 ⑦, 폼 묶음 제목 ⑧), §2 부품 2종, §3 형태 어휘, §5 인테이크 작성 선택지 14px과 `IntakeStepRail` 계약, §7 여백 4단.

## 7. 수용 기준

- 담당 실무자가 등록 직후 v2로 저장하고, 공통 21문항과 고른 영역 문항이 모두 채워지지 않으면 저장이 막힌다. 고른 영역을 접어도 필수는 사라지지 않는다.
- `declined | unknown | not_applicable`가 값 없이 저장되고 조회에서 빈칸이 아닌 상태로 보인다.
- 금융지원 모듈이 켜지고 경제 영역을 골랐을 때만 채무 표가 보인다. 사업 유형 문자열로 추정하지 않는다.
- 이전 형식 기록은 원래 키·값 그대로 읽기 전용이며, 전환 확인 없이 수정 요청을 보내지 않는다.
- 409에서 초안이 유지되고 다시 불러오기 뒤에만 재전송한다.
- `apps/web` 위저드, 조회, 임시본, 저장 알림의 기존 테스트 6개 파일이 새 계약으로 갱신되고, 평면 본문을 고정하던 단언은 제거된다.
- 데스크톱과 390px 실화면에서 가로 넘침이 없다(실측).
- 영역 접기는 제거하거나 필수 판정을 바꾸는 방식으로 대체하지 않는다. 실제 접기/펼치기 상태와 연결 대상이 보조기기에 전달되고, 접힌 영역의 미응답 때문에 저장이 거부되며 펼친 뒤 값을 이어서 입력할 수 있어야 한다. 기존 입력값은 접기 때문에 사라지지 않는다.

## 8. 손대지 말 것과 선행 조건

- 손대지 말 것: `packages/**`, `migrations/**`, `apps/client/**`, 공유 CSS·토큰 규칙 변경(필요하면 `DESIGN.md`와 `DESIGN-RULES.md`를 같은 커밋에서 고치는 별도 티켓).
- 선행 조건 1: 코어 체크포인트 `a1afc7a7`이 DESIGN 워크트리에 반영돼 있어야 한다. 소유: 베타 총괄(로컬 Git 인계만, origin 푸시·PR은 Q 별도 승인).
- 선행 조건 2: `apps/client`의 v2 소비 체크포인트는 `9b5b5c6e`다. 기본 경로는 검증됐지만 영역 접기는 위 공유 prop을 받은 뒤 frontend 레인이 복구해야 한다. 두 클라이언트와 부품을 같은 출고 묶음으로 검증하며, 접기를 뺀 것을 완료로 취급하지 않는다. 소유: 베타 총괄과 frontend.
- 선행 조건 3: `ccc-preview` 반영과 운영 배포는 이 패킷의 범위가 아니다. 소유: Q 승인.
