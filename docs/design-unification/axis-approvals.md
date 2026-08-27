# 디자인 통일 5개 축 승인 대장

- 상태 기준: `pending`은 실측 전, `approved`는 Q가 실측 결과를 승인한 상태, `frozen`은 승인 규칙이 ADR과 현행 규칙 문서 및 코드에 반영된 상태다.
- 이 대장은 기존 Q 결정과 현재 `/kit` 렌더를 연결하는 색인이다. 새 규칙이나 색값을 만들지 않는다.
- 동결 커밋은 각 축의 현행 계약을 마지막으로 확정한 전체 Git SHA다. 일괄 화면 적용이 끝날 때까지 이 다섯 축을 다시 개정하지 않는다.
- 다크 캡처는 위계, 기하, 계약 확인용이다. 다크 색값 승인으로 해석하지 않는다.

## 실측 조합

대표 fixture는 `/kit` 한 건이며, 라이트와 다크 각각 1280, 767, 390 너비를 같은 코드 상태에서 캡처했다.

| 테마 | 1280 | 767 | 390 |
| --- | --- | --- | --- |
| 라이트 | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png) | [`light-767.png`](../../artifacts/design-unification/kit-measurements/light-767.png) | [`light-390.png`](../../artifacts/design-unification/kit-measurements/light-390.png) |
| 다크 | [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png) | [`dark-767.png`](../../artifacts/design-unification/kit-measurements/dark-767.png) | [`dark-390.png`](../../artifacts/design-unification/kit-measurements/dark-390.png) |

## 전 라우트 실측 도구

`pnpm design:routes`는 `scripts/design/shots.py --check-inventory`를 실행한다. 30개
`page.tsx`와 인벤토리의 경로·fixture·권한·통일 판정, 라우트당 라이트·다크와
1280·767·390의 6개 조합을 브라우저 없이 확인한다.

`pnpm design:sweep:capture`는 API(8787)와 웹(3000) 로컬 프리뷰를 띄워 둔 상태에서 실행한다.
`scripts/design/ia-shots.py`로 `artifacts/ia-shots/ac3-six-matrix`에 30개 라우트 x
2테마 x 3폭 캡처와 `report.json`을 생성한다. 포트가 점유돼 갈랐다면(`--port`) `SHOT_BASE`와
`CCC_API_ORIGIN`을 맞춘다. 초대 토큰 등 런타임 fixture는 `route-inventory.json`의
`fixtureEnvironment` 환경 변수로 주입한다.

`pnpm design:sweep`는 그 보고서와 PNG, 관측 테마·뷰포트·HTTP·브라우저 오류를
브라우저 없이 재검증한다. 시드 수용 기준 AC3의 판정 명령이 이것이다.

## 축별 승인과 동결

| 축 | 상태 | Q 승인 근거 | ADR | 실측 스크린샷 | 동결 커밋 |
| --- | --- | --- | --- | --- | --- |
| 버튼 | `frozen` | 2026-08-26 Q 최종 결정과 4차 결정: 아웃라인/면 어휘, 패딩 16, 높이별 40·32와 600 굵기. 커밋 본문에 `/kit` 실측값 기록 | [ADR-0031](../adr/0031-design-rule-refactor.md) | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png), [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png), [`light-390.png`](../../artifacts/design-unification/kit-measurements/light-390.png), [`dark-390.png`](../../artifacts/design-unification/kit-measurements/dark-390.png) | `c383fc92f32c65cbb0fa092f84cc13de92f34b83` |
| 배지 | `frozen` | 2026-08-24 Q 결정: 시간 축, 상담 유형, 형제 variation의 역할 분리. Q 작성 커밋에서 `DESIGN-RULES.md`, `DESIGN.md`, `/kit`과 공용 부품을 함께 개정 | [ADR-0031](../adr/0031-design-rule-refactor.md) | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png), [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png), [`light-767.png`](../../artifacts/design-unification/kit-measurements/light-767.png), [`dark-767.png`](../../artifacts/design-unification/kit-measurements/dark-767.png) | `b8ed645472f27b7f006b7a7e293b8e389079429e` |
| 카드 경계 | `frozen` | 2026-08-05 Q 지시: 본문 카드는 그림자 없이 기본 `--line` 1px, 선택·활성은 `--gradient-brand` 1px. 라이트·다크 실제 라우트 실측 기록 포함 | [ADR-0030](../adr/0030-outline-card-unification.md) | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png), [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png), [`light-390.png`](../../artifacts/design-unification/kit-measurements/light-390.png), [`dark-390.png`](../../artifacts/design-unification/kit-measurements/dark-390.png) | `8204e8e843549ce660d0893d42cb8777f5617642` |
| 타이포 | `frozen` | 2026-08-26 Q 지시: 읽는 글자 계단과 예외를 재확정. **2026-08-27 Q 부분 재개정**: 당사자 이름을 두 단으로 분리(목록·일정 카드 16/600, 당사자 정보·HERO 18/600은 카드 제목 단). 구 21/600 전용 토큰 폐기, `DESIGN-RULES.md`·토큰·가드를 같은 커밋에서 개정 | [ADR-0025](../adr/0025-design-token-refactor.md), [ADR-0031](../adr/0031-design-rule-refactor.md) | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png), [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png), [`light-767.png`](../../artifacts/design-unification/kit-measurements/light-767.png), [`light-390.png`](../../artifacts/design-unification/kit-measurements/light-390.png) | `5515561a682d7e36bd041e6fc636d805fb0ef92e` |
| 간격 | `frozen` | Q 승인 상태인 ADR-0015의 2026-08-24 spacing v2 개정: 실측 뒤 페이지 스택 32, 셸과 페이지 패딩, 브레이크포인트를 확정. `DESIGN-RULES.md`, `DESIGN.md`, ADR, 토큰과 셸을 같은 커밋에서 개정 | [ADR-0015](../adr/0015-layout-contract.md), [ADR-0030](../adr/0030-outline-card-unification.md) | [`light-1280.png`](../../artifacts/design-unification/kit-measurements/light-1280.png), [`dark-1280.png`](../../artifacts/design-unification/kit-measurements/dark-1280.png), [`light-767.png`](../../artifacts/design-unification/kit-measurements/light-767.png), [`dark-767.png`](../../artifacts/design-unification/kit-measurements/dark-767.png), [`light-390.png`](../../artifacts/design-unification/kit-measurements/light-390.png), [`dark-390.png`](../../artifacts/design-unification/kit-measurements/dark-390.png) | `9a6601166ba5195e8884ee377b991d1c870572da` |

**2026-08-27 Q 일괄 승인.** kit 실측 6장(라이트·다크 x 1280·767·390,
`kit-measurements/`)을 확인하고 다섯 축 동결을 일괄 승인했다. 리팩터링 완료까지
재개정 금지이며, 이후 변경은 해당 축을 `pending`으로 되돌리고 재승인을 거친다.

## 동결 범위

동결 대상은 `DESIGN-RULES.md`의 형태 어휘, 색 계열 의미, 크기·굵기 계단, 여백 3단과 `DESIGN.md`의 대응 현행 계약이다. `DESIGN.md`의 과거 이력 문단은 수정하지 않는다. 색 SSOT인 Pen 값도 이 대장에서 변경하지 않는다.

## 기계 검증

`node --test scripts/design/axis-approvals.test.mjs`는 다음 기록을 한 번에 확인한다.

- 정확히 다섯 축이 모두 `frozen`인지
- 각 축에 Q 승인 날짜, 실제 ADR 링크, 라이트·다크 실측 PNG, 현재 브랜치 조상인 40자리 동결 커밋이 있는지
- 공통 실측 조합이 라이트·다크와 1280·767·390을 빠짐없이 포함하고 PNG 실제 폭과 파일명이 일치하는지
