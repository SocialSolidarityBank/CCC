# 레인 B 착수 준비 — 당사자 등록 화면 (Y6·Y7·Y8·Y10)

- **작성**: 2026-07-30 (Claude Code) · 워크트리 `.worktrees/lane-b-register` · 브랜치 `fix/lane-b-register-form`
- **전제 문서**: `artifacts/ui-revision-sweep-v1/findings.md` · `work-design.md` (둘 다 워크트리 `.worktrees/ui-revision`, 브랜치 `plan/ui-revision`)
- **상태**: 코드 변경 0건. 준비만 했다. **미결 1건(Y10)** 이 남아 있다.

---

## 1. 착수 지점 확인

| 항목 | 결과 |
| --- | --- |
| 브랜치 위치 | `fix/lane-b-register-form` = `origin/main`(`9b3f919`) **정확히 일치** — 리베이스 불필요 |
| 워킹 트리 | clean |
| `pnpm install` | 완료(`node_modules` 있음) |
| `pnpm typecheck` | **✓** |
| `pnpm --filter @ccc/web run test` | **✓ 26 파일 / 173 테스트** |
| `pnpm build` | **✓** |

`work-design.md` 는 브랜치 이름을 `fix/hero-mobile-and-register` 로, STATUS 는 "착수 전 리베이스"를 적었다.
그 브랜치의 내용(R7)은 **PR #16 으로 이미 머지됐다**(`6126c5e`, `origin/main` 에 포함 확인). 그래서
새 브랜치를 `origin/main` 에서 떠 왔고 리베이스할 것이 없다.

## 2. 남은 범위 — 4건

| # | 결함 | 대상 |
| --- | --- | --- |
| Y6 | 등록 화면만 카드가 없다 · 프라이머리 버튼만 풀폭 | `register-form.tsx` |
| Y7 | 버튼 라벨 `가입하기` → `등록하기` (자기 가입 폼은 그대로) | `register-form.tsx:196` |
| Y8 | 필수 항목 표시(`*`)가 없다 | `register-form.tsx` |
| Y10 | 동의 블록만 회색 테두리 fieldset | **미결 — §5** |

**R7 은 이미 끝났다**(PR #16). `work-design.md` 레인 B 행의 "R7 · Y6~Y10" 중 R7 이 빠진 자리다.

**Y9(실무자가 이메일로 표시)는 이 레인이 아니다.** `work-design.md` 는 범위를 "Y6~Y10" 이라고 썼지만
항목 목록에는 Y9 가 없고 STATUS 도 4건만 센다. 코드를 보면 이유가 분명하다 —
`register-form.tsx:96` 이 이미 `currentUser.name ?? currentUser.email` 이다. 이메일이 보이는 것은
**시드 계정의 `name` 이 비어 있어서**이고, 화면 결함이 아니라 표시명 데이터(D40 이 다루지 않은 자리)
문제다. CSS 로 고칠 것이 없어 범위에서 뺀다.

## 3. 완료 기준 — 스크립트 실측 확인 완료 (`green`)

레인 A 는 완료 기준에 적힌 `layout-measure.py after-a` 가 **그 화면을 대상에 안 갖고 있어**
끝에서야 못 쓰는 것을 알았다(STATUS 2026-07-30 기록). 그래서 레인 B 는 착수 전에 확인했다.

`scripts/design/ia-shots.py` 를 열어 보니 **둘 다 있다**:
- `("participant-new", "/participants/new")` — 37행, 대상 화면에 포함
- `("mobile", {"width": 390, "height": 844})` — 56행, 390px 뷰포트 있음

즉 완료 기준이 그대로 쓸 수 있다:
```bash
pnpm typecheck && pnpm --filter @ccc/web run test && pnpm build
SHOT_BENEFICIARY=firefly-001 ~/.local/share/uv/tools/playwright/bin/python scripts/design/ia-shots.py after-b
# after-b/participant-new-desktop.png · participant-new-mobile.png 눈으로 확인
```
`SHOT_BENEFICIARY` 는 등록 화면과 무관하지만(당사자 범위 화면용 변수) 스크립트가 다른 화면도
같이 찍으므로 그대로 준다.

## 4. `work-design.md` 의 충돌 검증에 구멍이 하나 있다 — CSS 파일

`work-design.md` §1 은 "교집합 0" 을 **화면 `.tsx` 파일끼리만** 비교해서 얻었다. 실제 CSS 는 다른 곳에 있다:

- `.consent-fieldset` (431·432행) · `.wire-register-form` (459행) · `.wire-register-submit` (460행)
  → 전부 **`apps/web/app/layout.tsx`** 안에 있고, 이 파일은 레인 B 소유 목록에 없다.
- 그 세 클래스는 **화면 3개가 함께 쓴다**:
  `participants/new/register-form.tsx` · `join/participant/[token]/signup-form.tsx`(D39 자기 가입) ·
  `participants/[beneficiaryId]/page.tsx`(동의 수정 허브)

→ 그 규칙을 고치면 **손대지 않은 화면 2개가 같이 바뀐다.**

**그래서 이렇게 한다** (파일 소유를 지키는 길이 이미 있다):
- 새 CSS 는 전부 레인 B 소유인 **`wire-styles.ts`** 에 넣는다. 이 파일은 `layout.tsx:10` 에서
  `wireStyles` 로 import 돼 `shellStyles`(552행)에 이미 합쳐지므로, 규칙을 넣기만 하면 적용된다.
- 새 규칙은 `register-form.tsx` 에서 새로 붙이는 클래스로 **범위를 좁힌다** — 공용 클래스를 덮지 않는다.
- Y6 은 CSS 가 아니라 **컴포넌트 층에서** 해결한다: `register-form.tsx` 안에서 `WireCard` 로 감싼다.
  `.wire-register-form` 을 다시 칠하는 방식은 쓰지 않는다.

레인 A 는 머지됐고 레인 C 는 D47 대기라 지금 레인 B 혼자다 — 이것은 머지 충돌 문제가 아니라
**엉뚱한 화면이 조용히 바뀌는 것을 막는 문제**다.

## 5. `red` 미결 1건 — Y10 과 Y6 이 서로 부딪힌다

Y6 이 폼을 `WireCard` 안에 넣으면 동의 fieldset 은 **카드 안의 상자**가 된다.
그런데 계약 두 곳이 그 경우를 이미 정하고 있다:

- `wire-card.tsx:14` — 카드 계약: 흰 배경 · radius 12 · `--line` 1px · `--shadow-soft`
- `wire-styles.ts:112` — 동의 수정 허브가 `consent-fieldset` 을 **카드 안에서** 재사용하며 간격만 준다
- 현행 `.consent-fieldset` — `--line` 1px, 그림자 없음

즉 "카드 안에 또 카드를 두지 않는다"가 지금 규칙이고, Y10 이 제안한 `--shadow-soft` 는
Y6 을 하면 **카드 안 카드**가 된다. 둘 다 할 수는 없다.

**추천**: Y6 을 살리고 **Y10 을 다시 정의한다** — 그림자를 넣지 않고, 테두리 1px 을 유지한 채
배경·간격·legend 만 카드 안 그룹 언어로 맞춘다. 이유는 Y10 의 목적이 "동의 블록만 시각 언어가
다르다"를 없애는 것이고, 폼 전체가 카드 안으로 들어가면 그 이질감의 원인 자체가 사라진다.

**시안**: `artifacts/ui-revision-sweep-v1/lane-b-y10-options.html` (Q 요청으로 생성).
실제 앱 CSS(`design/tokens.css` + `layout.tsx`·`wire-styles.ts` 의 스타일 문자열)를 그대로 뽑아
인라인했으므로 색·간격·테두리가 화면과 같은 값이다. 생성기는 세션 스크래치패드의
`build-y10-options.mjs` — 손으로 옮겨 적지 않았다. 콘솔 오류 0건, 렌더 확인 완료(1400px).

시안이 보여 준 것: **안 B 의 그림자는 흰 카드 위 흰 상자라 거의 보이지 않는다** — 규칙상으로만
카드 안 카드가 되고 눈으로는 현재와 구별되지 않는다. 안 A(배경 한 톤 + 제목 민트)가 그림자
없이도 "카드 안의 한 덩어리"로 읽힌다.

## 6. 곁가지 2건

1. **Y8 표시 방식 — 결정됨(2026-07-30 Q): 등록 화면 안에서 `*` 표시만.**
   `wire-form-required`(`*`)는 `SearchInput` 이 아니라 **`WireFormField`** 안에 있다
   (`wire-form-field.tsx:69`). 등록 폼은 `SearchInput` 7개를 쓴다. 부품을 `WireFormField` 로
   갈아타면 입력칸 높이가 61 → `--control-height` 로 바뀌어 7칸 모양이 전부 달라지므로,
   Y6 의 컨테이너 변경과 겹쳐 한 번에 보이는 변화가 커진다. 부품 통일은 별건으로 돌린다.
2. **`afterEach(cleanup)` 한 줄 — 결정됨(2026-07-30 Q): 이번에 넣는다.**
   `register-form.test.tsx` 에 그 줄이 없다(확인 완료 — 0건). STATUS Next Action #1 이 이 파일을
   12개 목록에 넣어 뒀고 이 파일은 레인 B 소유다. 이 누락이 있으면 테스트가 전부 통과해도
   종료코드가 1 이 되어 CI 가 붉게 나온다. 나머지 11개 파일은 별도 세션 몫으로 남는다.

## 7. Q 추가 요청 6건 — 이번 세션 / 다음 세션 나누기 (2026-07-30)

| # | 요청 | 판정 | 근거 |
| --- | --- | --- | --- |
| 1 | 동의 항목 2개로 통합(개인정보 / AI 녹취기록) + 사업마다 새로 받기 | **다음 세션** | 결정 변경(D15 는 녹음·텍스트 **분리** 동의를 지정) + API·게이트웨이·문안·테스트 4층. §8 |
| 2 | 화면 구성 추천안(안 A) | **이번 세션** | Y6·Y10 그 자체다 |
| 3 | 서명 동의서 업로더 | **이번 세션은 자리만** | 파일 저장은 R2·감사·보존까지 걸린다. §8 |
| 4 | 생년월일 한국어화 | **다음 세션** | Q 승인 + 이미 있는 별도 레인(R6 날짜 포맷)과 같은 문제다. §8 |
| 5 | 참여 사업을 선택칸 → 고정 표시 | **이번 세션** | 화면 한 파일. 서버 영향 0 (아래) |
| 6 | 성별을 생년월일 위로 | **이번 세션** | 순서 바꾸기 |

**5번이 안전한 이유(확인 완료)**: 서버 액션이 `programType: 'financial_support_v1'` 을 **하드코딩**하고
폼이 보낸 값을 아예 읽지 않는다(`actions.ts:796`). 선택칸을 없애도 서버는 달라지지 않는다.
반대로 **필드를 새로 더하면 안 된다** — 게이트웨이가 `assertExactKeys` 로 예상 키 목록을 강제한다
(`gateway.ts:7392`). 그래서 숨은 input 도 추가하지 않고 그냥 표시로만 바꾼다.

**5번 배치 주의**: Q 가 말한 "이름 위"는 **카드 안**의 이름 칸 위다. Y6 이 폼 전체를 카드에 넣는
중이고 D37 락이 "화면의 모든 글자는 카드 안에"이므로, 카드 바깥에 띄우면 그 락을 깬다.

**5·6 번은 훑기 결함 목록에 없다** — `findings.md` 에서 온 것은 Y6·Y7·Y8·Y10 이고 5·6 은 이번
세션 Q 요청이다. 둘 다 `register-form.tsx` 안이라 파일 소유는 문제없지만, 커밋·PR·STATUS 에
**어느 것이 훑기에서 왔고 어느 것이 이번 요청인지 구분해 적는다**. 그러지 않으면 다음 사람이
diff 를 `findings.md` 와 맞춰 볼 수 없다.

## 8. 구현 계획 — 이번 세션

순서에 이유가 있다: **껍데기(카드) → 내용(필드·라벨) → 마지막에 껍데기 장식(Y10)**.
Y10 은 컨테이너 규칙이라 안에 든 것이 다 자리를 잡은 뒤에 정해야 두 번 고치지 않는다.

| 순 | 할 일 | 대상 | 테스트 |
| --- | --- | --- | --- |
| 1 | **Y6** 폼 전체를 `WireCard` 로 감싼다. 제출 버튼을 풀폭 → 콤팩트 알약으로 | `register-form.tsx` | 카드 존재 확인 1건 신규 |
| 2 | **요청 5** 참여 사업 선택칸 삭제 → 카드 안 이름 칸 위에 고정 표시 조각 | `register-form.tsx` · `wire-styles.ts`(표시 조각 CSS) | 기존 1건 **수정**(아래) + 신규 1건 |
| 3 | **요청 6** 성별을 생년월일 위로 | `register-form.tsx` | 순서 확인 1건 신규 |
| 4 | **Y7** `가입하기` → `등록하기` (자기 가입 폼은 건드리지 않는다) | `register-form.tsx:196` | 기존 1건 **수정** |
| 5 | **Y8** 필수 3칸(이름·이메일·연락처) 라벨에 `*` | `register-form.tsx` | 신규 1건 |
| 6 | **요청 3** 서명 동의서 첨부 **자리만** | `register-form.tsx` · `wire-styles.ts` | 신규 1건(비활성 확인) |
| 7 | **Y10** 동의 블록 시각 언어 — **안 A 확정**(2026-07-30 Q "추천안대로") | `wire-styles.ts` + `register-form.tsx` 클래스 | 시각이라 실측 스크린샷으로 |
| 8 | `afterEach(cleanup)` 한 줄 (§6-2, Q 승인) | `register-form.test.tsx` | 그 자체가 테스트 정리 |

**기존 테스트 영향(전수 확인 완료)** — `register-form.test.tsx` 10건 중 깨지는 것은 **1건뿐**이다:
- 첫 번째 테스트가 `select[name="programType"]`(요청 5로 사라짐)과 `가입하기`(Y7로 바뀜)를 함께
  검사한다 → 그 두 줄을 고친다.
- 동의 체크박스 3개를 검사하는 테스트 3건은 **이번 세션에서 안 깨진다**(항목 통합은 다음 세션).
- 긴급 등록·담당 실무자 표시 테스트 6건은 영향 없다.

**요청 3(업로더 자리)을 어떻게 두는가 — 일부러 못 쓰게 만든다.**
동의 화면에 파일 올리는 자리가 **작동할 것처럼** 보이면, 실무자가 스캔한 동의서를 올렸다고
믿을 수 있다. 그래서 이번에는 `<input type="file">` 을 **넣지 않고** 동의 블록 안에
`서명 동의서 첨부 — 준비 중` 라벨 한 줄만 둔다(누를 데 없음). 자리는 보이고 기능은 없다는 것이
한눈에 읽혀야 한다.

**완료 기준(§3 그대로)**
```bash
pnpm typecheck && pnpm --filter @ccc/web run test && pnpm build
SHOT_BENEFICIARY=firefly-001 ~/.local/share/uv/tools/playwright/bin/python scripts/design/ia-shots.py after-b
# after-b/participant-new-desktop.png · participant-new-mobile.png(390px) 눈으로 확인
```

## 9. 다음 세션으로 넘기는 것 — 기능 구현 세션 묶음

### 9-1. 동의 항목 2종 통합 (요청 1) — `red` **결정이 먼저다(D48 후보)**

`green` **좋은 소식: 마이그레이션이 필요 없다.** Q 가 원하는 2개 구조가 **인테이크 경로에 이미 있다** —
`IntakeConsentInput { privacy, recordingAi }`(`db/gateway.ts:10314`)가 `recordingAi` 하나로
`consent_recording_at` · `consent_text_ai_at` **두 컬럼을 동시에** 기록한다. 주석이 그 의도를 적어 뒀다:
"D15 법률 검토 결과에 따라 **마이그레이션 없이 되돌리기 쉬운 구조**". 즉 DB는 3컬럼을 그대로 두고
**화면·API 표면만 2개로 접으면** 된다.

`red` **다만 결정 변경이다.** D15 는 "동의서는 녹음/텍스트 항목 **분리** 동의로 설계"를 지정하고
D44 는 동의 **3종**을 말한다. 문안은 법률 검토 동결 상태의 DRAFT 배지를 달고 있다(D46).
그래서 티켓 하나가 아니라 **D 번호를 받는 결정 + 구현**이다.

바꿔야 하는 표면(전수):
1. `createInitialParticipantProgram`(등록) — 지금 boolean 3개
2. 당사자 정보 페이지의 동의 수정 경로(D44) — 지금 3개
3. `record_consent` 감사 기록과 `participant_consent_records` 이력 표기
4. 문안 `consent-copy.ts`(`CONSENT_DETAIL_SECTIONS`) — **자기 가입 폼과 공유**한다
   (`join/participant/[token]/signup-form.tsx:7`). 문안을 고치면 그 화면도 같이 바뀐다
5. 화면 3곳: 등록 폼 · 자기 가입 폼 · 동의 수정 허브

`red` **함께 발견한 구멍 — "사업마다 새로 받기"의 절반이 API에 없다.**
Q 가 말한 "새 사업 참여마다 동의를 새로 받는다"는 ① 개인정보에 대해서는 이미 그렇게 동작한다
(`createSupportCase` 가 앞 사업 동의를 물려주지 않는다 — D44 기록과 일치, 확인 완료).
그런데 그 함수는 **`consentPrivacy` 만 받는다**(`gateway.ts:7386~7394`, `assertExactKeys`) —
두 번째 참여 사업을 열 때 **② 녹음·AI 동의를 기록할 API 경로가 아예 없다.** 지금은 사업을 만든 뒤
당사자 정보 페이지에서 따로 고쳐야 한다. 워크플로우로 필요한 것이라면 이 함수에 동의 인자를
넓히는 일이 요청 1과 **같은 묶음**이다.

### 9-2. 서명 동의서 업로드 (요청 3 기능 본체)

- 모델은 이미 있다: `apps/api/src/audio-store.ts` — R2 바인딩을 이 파일 하나로 격리하고,
  키에 PII 를 넣지 않고(`audio/<sessionId>/<uuid>`), MIME 허용 목록과 크기 상한을 강제한다.
  같은 형태로 `consent-doc-store.ts` 를 두는 것이 맞다.
- `red` **스캔한 동의서는 PII 문서다.** 이름·서명·연락처가 이미지로 들어온다. 그래서
  ① 열람마다 감사(D14) ② 보존 기간·아카이브 전환(D32·D46 — 그 cron 이 아직 즉시 파기다)
  ③ 반출 금지 규칙이 오디오와 같은 층으로 걸려야 한다. 이번 세션에 자리만 두고 기능을 미루는
  이유가 바로 이것이다.

### 9-3. 생년월일 한국어 입력 (요청 4)

- **이미 열린 레인이 있다**: `work-design.md` §3 이 R6(날짜 입력 표기)을 A·B 머지 뒤 **단독 레인 D**
  로 분리해 뒀다. 대상 파일이 7개로 흩어져 어느 레인에 넣어도 충돌하기 때문이다.
- 두 건은 같은 원인이다 — 네이티브 `<input type="date">` 의 표기는 **보는 사람의 브라우저 UI 언어**를
  따르고 페이지 로케일을 무시한다. 그래서 "한국어화"는 CSS 나 로케일 설정으로는 안 되고
  **부품 교체**여야 한다. 요청 4 를 레인 D 에 합쳐 한 번에 한다.

**부품을 어떻게 고르는가 (2026-07-30 Q 지시)**: 직접 만들기부터 시작하지 않는다.
**다른 날짜 입력 부품으로 갈아타거나, 한국어 사이트에서 실제로 쓰는 것을 찾아서 넣는다.**
착수 순서:

1. **한국 서비스에서 쓰는 방식을 먼저 조사한다** — 은행·공공·복지 신청 화면이 생년월일을
   어떻게 받는지(연·월·일 3칸 분리 / `YYYY.MM.DD` 마스크 입력 / 한글 라벨 달린 달력 등).
   생년월일은 달력을 넘겨 찾는 값이 아니라 **아는 값을 적는 값**이라, 달력 팝업보다
   숫자 입력이 빠른 경우가 많다 — 실제 사례가 그 판단의 근거가 된다.
2. **한글 로케일을 제대로 지원하는 공개 부품을 후보로 놓고 비교한다.** 판단 기준은
   ① 표기가 보는 사람 환경에 안 흔들리는가 ② 한국어 월·요일 표기와 라벨 ③ 키보드로만
   입력·이동되는가(접근성) ④ 라이선스 표기가 있는가 — **라이선스 미표기 저장소는 사용 금지**
   (§5 모델 규칙과 같은 기준). 번들 크기와 shadcn/ui 골격·D34 토큰에 얹을 수 있는지도 본다.
3. **직접 만드는 것은 1·2 가 다 안 맞을 때의 마지막 선택**이고, 그때도 위 4개 기준을 그대로 쓴다.
4. 고른 근거·후보 비교·기각 이유를 레인 D 착수 문서에 남긴다 — 날짜 칸이 7개 화면에 흩어져 있어
   한 번 고르면 되돌리는 비용이 크다.

### 9-4. 이번 세션에서 안 하는 작은 것 하나

`red` 로 남는 것 없음. Y9(실무자 이메일 표시)는 §2 에 적은 대로 표시명 데이터 문제다.

## 10. 레인 밖 관찰 — 주 체크아웃의 `main` 이 갈라져 있다

`~/developer/projects/CCC-new` 의 로컬 `main`(`4878e1b`)에 **푸시되지 않은 문서 커밋 2개**
(`docs(postmortem)` 2건)가 있고, 그 밑동이 `origin/main` 보다 오래된 지점(`56d9be4`)이다.
그래서 로컬 `main` 은 `origin/main` 의 조상이 아니다 — 그 체크아웃에서 그냥 push 하면 거부된다.

**레인 B 와는 무관하다**(이 워크트리는 `origin/main` 을 정확히 가리킨다). 주 체크아웃 문제이고,
이번 작업에서 손대지 않았다.
