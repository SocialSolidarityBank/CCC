# ADR-0021 — 동의 2종 통합: 개인정보 + AI를 활용한 녹취기록

- 상태: 채택 (2026-07-30)
- 결정: **D49** (D15의 '분리 동의' 문장과 D44의 '3종' 표기를 대체)
- 관련: D15(미동의 경로) · D23(오프라인 수령·시스템 기록 범위) · D44(받는 자리/고치는 자리) · D46(동의 게이트 G1·법률 검토 동결) · D2(마스킹)

---

## 맥락

Q 요청(2026-07-30): 동의를 **2개로 줄이고, 새 참여 사업마다 다시 받는다.**

1. 개인정보 수집·이용
2. **AI를 활용한 녹취기록** — 기존 ② 녹음·음성 분석 + ③ 텍스트 AI 정리를 합친 것

이는 확정 결정을 뒤집는 일이다. D15는 녹음/텍스트를 **분리 동의**로 지정했고, D44는 동의
**3종**을 전제로 저장·수정·철회 흐름을 세웠다. 그래서 티켓이 아니라 D 번호를 받는 결정이다.

### 착수 전 실측 — 분리를 지탱하던 기능이 없다

D15가 분리 동의를 요구한 이유는 **미동의 경로**였다: "녹음 미동의여도 수기 메모의 텍스트 AI
정리는 제공한다." 합치면 그 중간 상태가 사라지므로, 먼저 그 경로가 코드에 있는지 확인했다.

| 컬럼 | 쓰기 | **판정(게이트)** |
| --- | --- | --- |
| `consent_recording_at` | 있음 | **있다** — 녹음 파이프라인 등록을 막는다(`db/gateway.ts:4823`, 전사 후보 조회 3곳) |
| `consent_text_ai_at` | 있음 | **없다** — 전 레포에서 읽기는 화면 표시(`request-handler.ts:924`)와 이력 조회뿐 |

`consent_text_ai_at` 은 **어떤 코드 경로도 막지 않는다.** 즉 D15의 미동의 경로는 문서상
약속이었고 구현된 적이 없다. 합쳐도 **잃는 기능은 0**이다. (텍스트 AI 정리 파이프라인 자체가
2단계 몫이라 아직 없다 — 판정할 대상이 없었던 것이다.)

**Q 결정(2026-07-30)**: 그대로 합친다. 잃는 것은 "녹음은 거부하되 수기 메모 AI 정리는 받는"
**미래의** 중간 상태이고, 그 대가로 당사자가 읽어야 하는 동의 항목이 3개에서 2개로 줄어든다.

### 마이그레이션이 필요 없는 이유

인테이크 경로에 이미 접힌 구조가 있다 — `IntakeConsentInput { privacy, recordingAi }`
(`db/gateway.ts` 10329)가 `recordingAi` **한 체크로 두 컬럼을 동시에** 기록한다. 주석이 그
의도를 적어 뒀다: "D15 법률 검토 결과에 따라 **마이그레이션 없이 되돌리기 쉬운 구조**".

## 결정

### 1. DB는 3컬럼 그대로, 접는 것은 화면·API 표면이다

`support_cases.consent_recording_at` · `consent_text_ai_at` · `consent_privacy_at` 3컬럼과
`participant_consent_records` 이력 표를 **바꾸지 않는다**(새 마이그레이션 0개). ② 를 체크하면
**두 컬럼에 같은 시각을 찍는다** — 0008·0014의 insert 가드가 "NULL 아닌 동의 시각 =
`recorded_at`"을 요구하므로 값이 갈리면 트리거가 거부한다.

`yellow` **이 불변식은 이번에 바꾼 경로 전부에서 성립하고, 레거시 경로 하나에서는 성립하지
않는다**: `POST /cases`(구 케이스 생성, `request-handler.ts` 1890~1898)는 `consentRecordingAt`·
`consentTextAiAt` 를 **각각 독립 시각으로** 받아 `createCase` 에 넘긴다 —
`createInitialParticipantProgram` 의 레거시 호환 인자(`LegacyInitialSupportCaseCompatibility`)도
같은 모양이다. 이번 결정은 이 경로를 **건드리지 않는다**(등록·동의 수정·두 번째 사업·자기
가입이 사람이 지나는 길이고, 저 경로는 구 데이터 호환용이다). 그래서 갈린 상태는 여전히
만들어질 수 있고, 그것을 흡수하는 것이 아래 결정 3의 표시 규칙이다.

이유는 되돌릴 여지다. 법률 검토(L1, D46로 동결)가 재개돼 "분리해야 한다"로 결론나면 화면
표면만 다시 펴면 된다. 반대로 컬럼을 합쳤다면 그때 데이터 마이그레이션이 필요하다.

### 2. 입력·출력 이름은 `recordingAi` 하나로 통일한다

인테이크가 이미 쓰는 이름을 표준으로 올린다. 3종 시절 이름 2개(`recording`·`textAi`)는
쓰기 경로에서 사라진다.

| 층 | 전 | 후 |
| --- | --- | --- |
| 폼 체크박스 | `consentRecording` · `consentTextAi` | `consentRecordingAi` |
| 게이트웨이 입력 | `ParticipantConsentInput { recording, textAi }` | `{ recordingAi }` |
| API 응답 | `consent { privacy, recording, textAi }` | `consent { privacy, recordingAi }` |
| 감사 `record_consent` detail | `{ privacy, recording, textAi }` | `{ privacy, recordingAi }` |

### 3. 구 3종 기록의 표시 규칙 — 어느 한쪽이라도 찍혀 있으면 ② 동의로 읽는다

`participant_consent_records` 에는 3종 시절 행이 남아 있고, 그중 (녹음 O, 텍스트 AI X) 같은
상태는 2칸 화면에 그릴 자리가 없다. 읽기 규칙을 **`recordingAt !== null || textAiAt !== null`**
로 고정한다 — 넓은 쪽으로 읽는 것은 "동의했다고 표시했는데 실제로는 미동의"를 만들지 않기
위해서다(둘 중 하나는 실제로 동의받은 항목이다). 실무자가 그 화면에서 저장을 한 번 하면 두
컬럼이 같은 값으로 정리된다.

`yellow` 알고 받아들이는 결과: 구 데이터에서 "텍스트 AI 만 동의" 였던 케이스는 화면상
**녹음까지 동의한 것처럼** 보인다. 다만 녹음 파이프라인 게이트는 `consent_recording_at` 을
직접 보므로(표시값이 아니라 컬럼) **녹음이 실제로 열리지는 않는다**.

### 4. 두 번째 참여 사업에서 ② 를 기록할 경로를 만든다 (요청의 나머지 절반)

"사업마다 다시 받는다"는 ① 에 대해서는 이미 그렇게 동작한다 — `createSupportCase` 는 앞
사업의 동의를 물려주지 않는다(D44). 그런데 그 함수는 **`consentPrivacy` 만 받았다**
(`assertExactKeys`) — 두 번째 사업을 열 때 ② 를 기록할 API 경로가 아예 없어, 사업을 만든 뒤
당사자 정보 페이지에서 따로 고쳐야 했다. `consentRecordingAi` 를 **선택 인자**로 넓힌다.

- 선택으로 두는 이유: ② 는 하드 게이트가 아니다(① 만 게이트, G1·D46). 보내지 않으면 미동의.
- 재생(replay) 해시에 `consentRecordingAi` 를 넣는다 — 같은 제출 id 로 동의만 바꾼 재시도가
  조용한 재생으로 통과하면 안 된다.

### 5. 문안은 두 파일을 함께 고친다 (DRAFT 배지 유지)

`docs/consent/consent-draft-v0.md`(정본)와 `apps/web/app/participants/new/consent-copy.ts`
(화면 표시)의 5절 항목 2개를 하나로 합치고, 6절 거부 권리를 "거부하면 녹음·전사·감정 분석과
AI 요약·정리가 함께 제공되지 않는다"로 다시 쓴다. 화면 문안은 정본에서 자란 것이라 D46의
민감정보(질병명) 마스킹 문장을 이때 정본 쪽에 맞춘다.

**`CONSENT_DETAIL_DISCLAIMER` 의 DRAFT 성격은 유지한다** — D46이 법률 검토 트랙을 동결했고
(L1·L3·L4는 해제가 아니라 동결) 화면 DRAFT 배지 유지가 그 조건이다. 이 ADR은 문안을
확정하지 않는다.

`yellow` **법률 검토 재개 시 다시 볼 것**: 개인정보보호법 제22조는 필수/선택의 **구분** 동의를
요구한다. 두 처리(녹음·전사 / 외부 AI 위탁 요약)를 한 항목으로 묶는 것이 그 요건에 맞는지는
법률 검토에서 판정할 사항이고, 이 ADR은 **화면·저장 구조를 그 판정에 맞춰 되돌릴 수 있게**
두는 것으로 대응한다(결정 1).

### 6. 문안 상수는 자기 가입 폼과 공유한다 — 같이 바뀐다

`consent-copy.ts` 는 등록 폼과 `join/participant/[token]/signup-form.tsx` 가 함께 쓴다.
대행 입력과 본인 입력이 읽는 글이 갈라지면 동의의 근거가 화면마다 달라지므로 **의도된
공유**다. 문안을 고치면 자기 가입 폼도 같이 바뀌고, 두 화면 모두 체크 2개가 된다.

## 결과

바뀌는 표면(전수):

| # | 자리 | 파일 |
| --- | --- | --- |
| 1 | 등록(초기 사업 생성) | `db/gateway.ts` `createInitialParticipantProgram` |
| 2 | 동의 수정 허브 | `db/gateway.ts` `updateParticipantConsent` + `participants/[beneficiaryId]/page.tsx` |
| 3 | 두 번째 사업 생성 | `db/gateway.ts` `createSupportCase` |
| 4 | 자기 가입 | `db/gateway.ts` 초대 가입 경로 + `join/participant/[token]/signup-form.tsx` |
| 5 | API 응답·요청 파싱 | `apps/api/src/request-handler.ts` |
| 6 | 웹 클라이언트·서버 액션 | `apps/web/app/lib/api.ts` · `apps/web/app/actions.ts` |
| 7 | 등록 화면 | `apps/web/app/participants/new/register-form.tsx` |
| 8 | 인테이크 읽기 표시 | `.../records/intake/intake-wizard.tsx` |
| 9 | 문안 2곳 | `docs/consent/consent-draft-v0.md` · `.../participants/new/consent-copy.ts` |

- **새 마이그레이션 0개** · **DB 스키마 변경 0** · 녹음 파이프라인 게이트 불변.
- D15의 '분리 동의' 문장과 미동의 경로 중 **텍스트 AI 부분은 폐기**된다. D15의 나머지(녹음
  미동의여도 수기 메모 기록·브리핑은 수기 폴백으로 동작)는 그대로다.
- D44의 흐름(받는 자리=등록, 고치는 자리=당사자 정보 페이지, 인테이크는 읽기만)은 불변 —
  항목 수만 3에서 2로 줄어든다.
