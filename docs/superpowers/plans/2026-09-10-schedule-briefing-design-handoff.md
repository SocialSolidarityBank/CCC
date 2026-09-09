# 일정과 15초 페이지 design 인계 패킷

작성: 2026-09-10, 프런트엔드 레인(`.worktrees/frontend`, `frontend/beta-0.9-client`).
`frontend-lane` 필수 8항목. 공유 CSS와 공유 부품은 건드리지 않았고, 필요한 부품을 아래 3번과 8번에 정확히 적는다.

## 1. 목표

일정 보기, 상담 일정 등록, 상담 계획 수정, 15초 페이지를 실제 API 위에서 동작시켰다. 지금 배치는
기존 공개 부품만으로 조립한 임시 형태이고, D88 월간 7열 격자와 종일 표시는 부품이 없어서 넘긴다.

## 2. 파일과 URL

| URL | 화면 | 파일 |
| --- | --- | --- |
| `/schedule?view=day|week|month&date=YYYY-MM-DD` | 일정 | `apps/client/src/screens/schedules.tsx` `ScheduleScreen` |
| `/schedules/new` | 상담 일정 등록 | 같은 파일 `ScheduleCreateScreen` |
| `/schedules/:scheduleId/plan` | 상담 계획 | 같은 파일 `SchedulePlanScreen` |
| `/participants/:beneficiaryId/programs/:supportCaseId/briefing` | 15초 페이지 | 같은 파일 `BriefingScreen` |

API 경계는 `apps/client/src/business/schedules.ts`다.

## 3. 필요한 공유 부품 (design 레인 소유, 아직 없음)

| 필요한 것 | 왜 | 지금 대신 쓰는 것 |
| --- | --- | --- |
| 월간 7열 격자(D88 ①): 셀 148, 모바일 88, 날짜는 숫자만, 요일 줄은 이어지는 `--gradient-brand` 면에 `--on-action` 글자, 넘침은 `+N건` | 새 grid 레이아웃과 셀 글자 12px 예외(D88 ⑥)가 필요해 공유 CSS 없이 만들 수 없다 | 월간도 날짜별 목록(`WireCardSection` + `WireItem`) |
| 종일 일정 표시와 `display_color` 다섯 색(D88 ②) | 마이그레이션과 응답 필드가 아직 없다. 색 배정도 규칙 소관 | 표시하지 않음 |
| 업무 바(CCC-133): 왼쪽 `[오늘]`과 보기 선택창, 가운데 면 없는 32px 화살표와 22ch 기간 이름, 오른쪽 등록 행동 둘, 760px 이하 3줄 쌓기 | `WireToolbarField`가 공개 면에 없고 화살표 규격이 규칙이다 | `.business-actions` 안의 일반 버튼 넷과 보기 선택 `WireFormField` |
| 지난 줄과 완료 카드 흐림(CCC-133) | 흐림은 값 규칙이다 | 상태 배지 문자열로만 구분 |

## 4. API 계약

| 호출 | 화면이 읽는 값 |
| --- | --- |
| `GET /schedules/month?month=YYYY-MM` | `date`, `timeZone`, `startUtc`, `endUtc`, `schedules[]`(`scheduledAt`, `status`, `sessionKind`, `participantName`, `supportCaseId`, `completedSessionId`) |
| `GET /schedules/candidates` | `candidates[]`(`beneficiaryId`, `supportCaseId`, `participantName`, `intakeAt`) |
| `POST /schedules` | `{ id, scheduledAt }`(등록 뒤 계획 화면으로 이동) |
| `GET|PUT /schedules/:id/plan` | `version`, `sessionGoals[]`, `customQuestions[]`, `status`, `scheduledAt` |
| `GET /participants/:id/programs/:caseId/briefing` | 포커스 사업의 `overallGoal`, `activeGoals`, `aiSuggestions`, `sessionRows`, `discrepancies`, `openActionItems`, 확인된 `flags`, `pendingReviewSessionIds`, `focusUpcomingSchedule` |
| `PUT /support-cases/:id/overall-goal` | 저장된 `overallGoal` |

주간과 일간은 서버가 준 달 자료에서 서버 시간대(`timeZone`)로 잘라 낸다. 브라우저 시간대로 날짜를
다시 계산하지 않고, 주가 달을 걸치면 두 달을 받아 합친다.

## 5. 전체 거부와 상태

| 상황 | 화면 |
| --- | --- |
| 계획 저장 충돌 또는 시작 시각 지남 | 서버 오류 문구 + `최신 계획 다시 읽기`, 초안 유지 |
| 담당 활성 사업 없음 | 등록 화면이 빈 상태를 명시하고 저장 버튼이 열리지 않음 |
| 전체 목표 편집 불가(`canEditOverallGoal: false`) | 읽기 한 줄만 |
| 확인된 리스크 플래그 | 15초 페이지 위쪽 안내, 제안 상태 플래그는 싣지 않음(R5) |
| 불일치 | 양쪽 원문과 처리 상태만, 처리 조작 없음 |

## 6. 문구 초안

상태 라벨 4종(예정, 완료, 취소, 오지 않음), 리스크 유형 6종 라벨, 상담 유형 안내 두 줄,
"아직 목록 형태입니다" 안내, "처리 기능은 아직 없습니다" 안내.

## 7. 수용 기준

- 일정: 오늘, 이전, 다음과 보기 전환이 URL에 남고 새로고침해도 같은 기간이 뜬다.
- 등록: 인테이크 여부에 따라 상담 유형이 자동으로 정해지는 이유가 화면에 보인다.
- 계획: 목표 줄과 맞춤형 질문이 구분되고 저장 결과가 서버 값으로 다시 읽힌다.
- 15초 페이지: 리스크, 전체 목표, 이번 회차 목표, AI 제안, 회차별 정리, 불일치, 미해결 액션이
  한 화면에서 위에서 아래로 훑힌다.

## 8. 손대지 말 것과 선행 조건

- 공유 CSS, 토큰, `DESIGN.md`, `DESIGN-RULES.md`는 design 레인 소유다. 위 3번 부품이 생기기 전에는
  프런트엔드가 격자와 흐림을 손 CSS로 만들지 않는다.
- 종일 일정과 색은 마이그레이션과 응답 필드가 선행이다. 소유자 BACKEND.
- 불일치 처리 3종, 액션 등록, 승인 검토 화면은 P5 범위다.
- 15초 페이지의 근거 회차 링크는 아직 없는 `/records` 화면을 가리킨다. P5에서 그 화면이 생기면 연결이 닫힌다.
