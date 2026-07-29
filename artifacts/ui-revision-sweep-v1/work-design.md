# UI 수정 — 병렬 작업 설계 v1

- **작성**: 2026-07-30 (Claude Code) · 전제 문서: 같은 폴더 `findings.md`
- **원칙**: 레인끼리 **같은 파일을 절대 건드리지 않는다.** 병렬 작업이 깨지는 이유는 거의 항상 공용 파일 충돌이라, 결함 종류가 아니라 **파일 소유권**으로 갈랐다.
- **배치**: 워크트리는 프로젝트 안에 둔다 — `.worktrees/<브랜치>` (AGENTS.md 규칙).

---

## 0. 먼저 정해야 하는 것 — 브리핑이 어디서 안 뜨는가

`red` **제 훑기에서는 브리핑이 정상 렌더됐습니다.** 로컬에서 firefly-001·otter-001 둘 다 전 영역이 나왔고 콘솔 오류 0건입니다(`artifacts/ia-shots/rev-baseline/briefing-desktop.png`). 그래서 **깨진 곳이 preview 일 가능성이 큽니다.**

**1순위 가설 — preview D1에 마이그레이션 0027이 안 갔다.**
- 어제 머지된 CCC-42(내용 불일치)가 `session_discrepancies` 테이블을 새로 만들었다(마이그레이션 0027).
- 브리핑 영역③이 그 테이블을 읽는다.
- `docs/ops.md` 가 명시한다: **"마이그레이션은 자동으로 안 간다(워크플로도 마찬가지다)."** 배포는 자동, 스키마는 수동이다.
- → preview 웹은 새 코드인데 preview DB엔 테이블이 없다 → 브리핑 조회가 통째로 실패 → 빈 화면.

이 가설이 맞으면 **코드 수정이 아니라 명령 한 줄**로 끝난다:
```bash
pnpm --filter @ccc/api exec wrangler d1 migrations apply ccc-preview --env preview --remote
```

**확인을 제가 못 했습니다.** `wrangler d1 migrations list ccc-preview --env preview --remote` 가 계정 권한 오류로 막혔습니다(`code: 7403`, 이 맥의 wrangler OAuth가 해당 계정에 인가되지 않음). ops.md는 이 맥이 이미 로그인돼 있다고 적어 뒀으니 **토큰이 만료됐거나 계정이 바뀐 것**입니다.

**Q에게 필요한 것 (둘 중 하나면 됩니다)**
1. 브리핑이 **어디서** 안 뜨는지 — preview 인지, 로컬인지, 특정 당사자만인지. 화면 하나만 보여주셔도 됩니다.
2. 또는 터미널에 `! pnpm --filter @ccc/api exec wrangler login` — 그러면 제가 preview DB 상태를 직접 확인하고 필요한 마이그레이션까지 적용하겠습니다.

> **이건 다른 레인을 막지 않습니다.** A·B 레인은 지금 바로 시작할 수 있고, 이 건은 확인되는 대로 별도로 처리하면 됩니다.

---

## 1. 레인 배치 — 파일 소유가 겹치지 않는다

| 레인 | 브랜치 | 다루는 결함 | **단독 소유 파일** | 선행 |
| --- | --- | --- | --- | --- |
| **0** | `fix/preview-briefing-blank` | 브리핑 빈 화면 | 앱 코드 없음(배포·마이그레이션·`docs/ops.md`) | Q 정보 |
| **A** | `fix/intake-wizard` | R4 번호 중복·순서 · R5 패널 늘어남 | `records/intake/intake-wizard.tsx` + 그 테스트 | 없음 — **바로 시작** |
| **B** | `fix/hero-mobile-and-register` | R7 모바일 버튼 · Y6~Y10 등록 화면 | `components/wire/participant-hero-card.tsx` · `components/wire/wire-styles.ts` · `participants/new/register-form.tsx` + 각 테스트 | 없음 — **바로 시작** |
| **C** | `feat/records-screen` | R1 GAS 잔존 · R2 HERO 없음 · R3 브레드크럼·가명 ID | `records/page.tsx` · `records/new/record-onepage.tsx` | **D47 그릴링** |

**충돌 검증(실측)**: A의 `intake-wizard.tsx`, B의 `wire-styles.ts`·`participant-hero-card.tsx`·`register-form.tsx`, C의 `records/page.tsx`·`record-onepage.tsx` — **교집합 0**. R5의 원인도 공용 CSS가 아니라 `intake-wizard.tsx:619` 의 인라인 스타일이라 A가 통째로 소유합니다.

`STATUS.md` 는 **레인마다 건드립니다.** 머지 순서를 A → B → C 로 고정하면 충돌해도 한 줄짜리라 즉시 해소됩니다.

---

## 2. 레인별 상세

### 레인 A — 인테이크 위저드 (`fix/intake-wizard`)

**R4. 소절 번호 중복·순서**
- 지금: `1-1` → `동의 기록` → `1-3(자동)` → `1-2` → `1-3` → `1-4`. `1-3` 이 두 번이다.
- 정본 `PRD/intake-questionnaire-v1.md` 는 `1-1 / 1-2 / 1-3 / 1-4` 각 하나씩이다(확인 완료).
- 할 일: `intake-wizard.tsx:695` 의 하드코딩된 `1-3. 상담 운영정보 (자동)` 이 정본의 어느 항목인지 정하고 번호를 바로잡는다. 자동 채움 블록은 정본에 없는 화면 전용 블록이므로 **번호를 떼는 쪽**이 맞을 가능성이 높다(`상담 운영정보 (자동 입력)` 처럼). 순서도 정본대로 `1-1 → 1-2 → 1-3 → 1-4` 로 되돌린다.

**R5. 진행 단계 패널 세로 2,854px**
- 원인 확정: `intake-wizard.tsx:619` 의 `<nav className="wire-col-4" style={{ ...stackStyle, gap: 8 }}>` 에서 `stackStyle = { display:'grid', gap:20 }`(119행). `align-content` 가 없어 5개 행이 본문 길이만큼 늘어난 컬럼 높이를 균등 분배한다.
- 할 일: 그 nav 에 `alignContent: 'start'` 를 준다. **한 줄**이다.
- 검증: 1440px 에서 단계 버튼 높이가 568px → 한 줄 높이로 떨어지는지 실측.

**완료 기준**
```bash
pnpm typecheck && pnpm --filter @ccc/web run test && pnpm build
# + 실측: 진행 단계 패널 높이가 본문 길이를 따라가지 않는다
MEASURE_PARTICIPANT=firefly-001 MEASURE_PROGRAM_TYPE=financial_support_v1 \
  ~/.local/share/uv/tools/playwright/bin/python scripts/design/layout-measure.py after-a
```

### 레인 B — HERO 모바일 + 당사자 등록 화면 (`fix/hero-mobile-and-register`)

- **R7** 390px 에서 `당사자 정보` 버튼이 `당사자 정`/`보` 로 쪼개진다 → `participant-hero-card.tsx` + `wire-styles.ts` 의 버튼 규칙. D38 은 행동 버튼 최대 2개만 정하고 줄바꿈 규정은 없으므로, **줄바꿈 금지 + 좁을 때 세로 배치**를 이번에 계약으로 굳히고 `DESIGN.md` §5 에 한 줄 추가한다.
- **Y6** 등록 화면만 카드가 없다 → 다른 화면과 같은 `WireCard` 안으로.
- **Y7** 버튼 라벨 `가입하기` → 실무자 대행 등록 화면이므로 `등록하기`. (D39 자기 가입 폼에서 넘어온 문구 — 그쪽은 `가입하기` 가 맞으니 **등록 화면만** 바꾼다.)
- **Y8** 필수 표시 없음 → `wire-form-required` 가 이미 있다(`wire-styles.ts:173`). 쓰기만 하면 된다.
- **Y10** 동의 블록만 회색 테두리 fieldset → D34 의 `--shadow-soft` 로.

**완료 기준**
```bash
pnpm typecheck && pnpm --filter @ccc/web run test && pnpm build
SHOT_BENEFICIARY=firefly-001 ~/.local/share/uv/tools/playwright/bin/python scripts/design/ia-shots.py after-b
# 390px 스크린샷에서 HERO 버튼 라벨이 한 줄인지 눈으로 확인
```

### 레인 C — 상담 기록 화면 (`feat/records-screen`) · **D47 선행**

R1·R2·R3 이 전부 이 화면 하나에 몰려 있고, **D42가 예고한 "브리핑·상세 기록 정리 그릴링" 중 상세 기록 반쪽이 아직 안 된 자리**입니다(브리핑 반쪽은 D45로 끝났습니다). 지금 손대면 D47이 그 화면 구조를 정할 때 버려집니다.

- 그릴링에 들고 갈 재료: GAS를 뺀 자리에 무엇이 오는가(D43은 보류만 정하고 대체물을 안 정했다) · HERO를 달면 브리핑과 기록 화면의 행동 버튼이 어떻게 갈리는가 · 회차 번호 표기.

---

## 3. 레인에서 뺀 것과 그 이유

**R6 날짜 미국식 포맷 — `red` 에서 내리고 결정 항목으로 돌립니다.**
`<input type="date">` 의 표기는 **보는 사람의 브라우저 UI 언어**를 따르고 페이지 로케일을 안 따릅니다(ko-KR 컨텍스트로 다시 렌더해도 `mm/dd/yyyy` 그대로였습니다). 즉 **팀원마다 다르게 보이고**, 제가 본 미국식은 헤드리스 브라우저 기본값일 수 있습니다. 고칠 값어치는 있지만(보는 사람에 따라 달라지는 입력칸은 그 자체가 문제) 대상 파일이 7개로 흩어져 있어 **어느 레인에 넣어도 충돌을 만듭니다.** A·B가 머지된 뒤 단독 레인으로 돌리는 것이 맞습니다.

---

## 4. 순서와 합류

```
지금 ─┬─ 레인 A (인테이크)   ─┐
      ├─ 레인 B (HERO·등록)  ─┤→ A → B 순서로 머지 → 레인 D(날짜) 착수 가능
      └─ 레인 0 (브리핑 진단) ─┘   ※ Q 정보 오면 즉시

Q가 /grill-with-docs 로 D47 확정 ── → 레인 C (상담 기록 화면) 착수
```

- 각 레인은 **머지 전에 `pnpm typecheck && pnpm test && pnpm build` 를 통과**한다(HARNESS §2 — 밖으로 나가기 전 검증 게이트).
- 레인마다 종료 시 `STATUS.md` History 한 줄을 추가한다.

## 5. 워크트리 만들기

```bash
cd /Users/seongqkim/developer/projects/CCC-new
git worktree add .worktrees/intake-wizard      -b fix/intake-wizard              main
git worktree add .worktrees/hero-register      -b fix/hero-mobile-and-register   main
# 레인 C 는 D47 확정 후:
# git worktree add .worktrees/records-screen   -b feat/records-screen            main
```

각 워크트리에서 처음 한 번 `pnpm install --frozen-lockfile` 이 필요합니다(이 워크트리에서도 그랬습니다).
