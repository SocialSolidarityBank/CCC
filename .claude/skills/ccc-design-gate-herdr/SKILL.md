---
name: ccc-design-gate-herdr
description: "CCC 레포에서 화면(디자인) 작업의 게이트를 돌릴 때: Herdr pane 에 screen-builder·rule-reviewer 서브에이전트 둘을 띄우고, ccc-dev 탭의 로컬 프리뷰(localhost 또는 테일넷)로 실물을 확인하는 절차. 사용자가 '디자인 게이트', '검수', '화면 작업' 을 말하거나 design-lane 스킬 3단계에 들어갈 때 쓴다."
---

# CCC 디자인 게이트 (Herdr pane 2개 + 로컬 프리뷰)

2026-09-07 Q 지시. 규칙 자체는 레포 `DESIGN-RULES.md`, 단계는 레포 `design-lane` 스킬이 갖는다. 이 스킬은 **누가 어느 pane 에서 무엇을 맡는지**와 **화면을 어디서 보는지**만 정한다.

## 0. 전제 확인

```bash
test "${HERDR_ENV:-}" = 1 && herdr pane layout --current | jq -c .result.layout.area
herdr agent list | jq -r '.result.agents[] | "\(.pane_id) \(.agent) \(.agent_status)"'
```

Herdr 밖이면 pane 을 만들지 말고 `task` 서브에이전트로 대체하고 그 사실을 말한다. 내 kind 는 `omp` 다. 서브에이전트도 `--kind omp`.

## 1. 로컬 프리뷰 (탭 `ccc-dev`)

워크트리: `/Users/barq/DEVELOPER/PROJECTS/CCC/.worktrees/design-refresh` (브랜치 `design/refresh`). 다른 브랜치면 경로만 바꾼다.

이미 있는지 먼저 본다: `herdr tab list --workspace "$HERDR_WORKSPACE_ID" | jq -c '.result.tabs[] | {tab_id,label}'`. 없으면:

```bash
WT=/Users/barq/DEVELOPER/PROJECTS/CCC/.worktrees/design-refresh
T=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$WT/apps/api" --label ccc-dev --no-focus)
API=$(echo "$T" | jq -r .result.root_pane.pane_id)
WEB=$(herdr pane split --pane "$API" --direction right --cwd "$WT/apps/web" --no-focus | jq -r .result.pane.pane_id)
herdr pane rename "$API" "api :8790"; herdr pane rename "$WEB" "web :3100"
herdr pane run "$API" "pnpm exec wrangler dev --port 8790"
herdr pane run "$WEB" "CCC_API_ORIGIN=http://127.0.0.1:8790 CCC_LOCAL_PREVIEW=true CCC_DEV_ORIGINS=100.112.68.113,mac-mini.tail79fba7.ts.net pnpm exec next dev -p 3100 -H 0.0.0.0"
herdr pane wait-output "$WEB" --regex "Ready in" --timeout 120000
```

- 8787/3000 은 `collie` 등이 잡고 있어 8790/3100 을 쓴다.
- 로컬 D1·시드가 없으면 `docs/ops.md` '로컬 프리뷰' 1-a~1-d 를 먼저(마이그레이션 → `.dev.vars` → `seed:generate:local` → `seed:apply:local`). `.dev.vars` 값은 stdout 에 내지 않는다.
- 시드 당사자 예: `deer-001`(강민재), 케이스 `5e11eba9-da69-43e1-aad0-d8e8ce791b84`.

**보는 주소**
- 같은 Mac: `http://localhost:3100`
- 원격(SSH 로 붙은 세션·다른 기기): `http://mac-mini.tail79fba7.ts.net:3100` 또는 `http://100.112.68.113:3100` (테일넷 전용, 공개 터널 금지 ADR-0044). `CCC_DEV_ORIGINS` 가 없으면 Next 16 이 `/_next/*` 를 403 으로 막는다.
- 헤드리스 실측은 `browser.open` 후 `page.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true})`. `isMobile` 없이는 15px 스크롤바가 생겨 본문이 375 가 된다.

## 2. pane 두 개 열기 (내 pane 옆, 포커스 유지)

```bash
WT=/Users/barq/DEVELOPER/PROJECTS/CCC/.worktrees/design-refresh
B=$(herdr pane split --current --direction right --cwd "$WT" --no-focus | jq -r .result.pane.pane_id)
R=$(herdr pane split --pane "$B" --direction down --cwd "$WT" --no-focus | jq -r .result.pane.pane_id)
herdr agent start screen-builder --kind omp --pane "$B" --timeout 60000
herdr agent start rule-reviewer  --kind omp --pane "$R" --timeout 60000
```

역할 분담(겹치지 않게):

| pane | 이름 | 맡는 것 | 하지 않는 것 |
| --- | --- | --- | --- |
| 오른쪽 위 | `screen-builder` | 사용자용 화면 구성: design-lane 1~2단계(배치표, 부품 조립, CSS), 로컬 프리뷰 캡처·시안(A/B) | 규칙 문서 수정, 검수 판정 |
| 오른쪽 아래 | `rule-reviewer` | design-lane 3단계 검수(`.claude/agents/design-reviewer.md` 관점 6개, DESIGN-RULES 장 번호로 근거) + 확정된 결정을 `DESIGN-RULES.md`·`DESIGN.md` 에 **같은 커밋**으로 반영(ADR-0033) | 화면 코드 수정 |
| 내 pane | 메인 | 계획, 지시, Q 결정 요청(`ask`), 관문 실행(`guard:*`, vitest, `design:hierarchy`, `design:align`), 커밋 | |

프롬프트는 `herdr agent prompt <name> "..." --wait --timeout 900000` 로 보내고, 결과는 `herdr agent read <name> --source recent-unwrapped --lines 200` 으로 읽는다. 긴 산출물은 `/tmp/ccc-mobile/` 에 파일로 쓰게 하고 경로만 받는다. `blocked` 면 `agent get`/`agent read` 로 UI 를 본 뒤 사용자에게 묻는다.

프롬프트에 반드시 넣는 것: 워크트리 경로, 관문·포매터·전체 테스트는 메인이 돌리니 돌리지 말 것, 서로의 파일(빌더=화면 코드, 리뷰어=규칙 문서)만 만질 것, 프리뷰 주소.

## 3. 순서

1. 메인: 계획(배치표·시안 절)을 `local://` 또는 `/tmp` 파일로 쓴다.
2. `screen-builder` 에게 구현 + 390/1280 캡처(`/tmp/ccc-mobile/after-*.png`)를 시킨다.
3. 메인: 관문 3종 + vitest 통과시킨다(값 위반이 남으면 검수가 그것만 잡는다).
4. `rule-reviewer` 에게 바꾼 파일 목록·화면 한 줄·시안·캡처 경로를 넘겨 검수받는다(출력 형식: 자리/무엇/근거/등급, 마지막 줄 `확실 N건, 판단 필요 M건`).
5. '확실' 은 빌더가 고친다. '판단 필요' 는 빌더에게 A/B 실물 캡처를 시키고 메인이 `ask` 로 Q 에게 결정을 받는다.
6. 결정이 나면 빌더가 코드, 리뷰어가 규칙 문서를 고치고 메인이 관문 재통과 후 한 커밋으로 묶는다.
7. 끝나면 두 agent pane 은 닫는다(`agent send-keys <name> ctrl+d` → `pane close <id>`). `ccc-dev` 탭은 사용자가 화면을 볼 수 있게 **남긴다**.
