# 베타 0.9 공용 UI 인계: 공유 wire 부품 패치

작성: 2026-09-09. 작업: DESIGN 레인 (`design/work`). 감사 대상: `feat/settings-backend@71778f3`.

머신: MacBook Apple M4 Pro (arm64). CWD: `/Users/seongqkim/DEVELOPER/PROJECTS/CCC-new/.worktrees/DESIGN`. 브랜치: `design/work`. 모델: anthropic/claude-sonnet-4-6.

결과 파일: `docs/superpowers/plans/2026-09-09-beta-shared-ui-handoff.md`.

---

## 목적

오케스트레이션 계획의 첫 번째 병렬 파동: 후보 커밋 `71778f3`의 `apps/web/app/components/wire/` 변경이 현재 `main`/`design/work` 기준과 다른 부분을 감사하고, DESIGN 레인이 적용할 최소 공유 컴포넌트 패치와 FRONTEND가 받아야 할 소비 계약을 확정한다. 경쟁 디자인 시안이나 미세 취향 조정은 없다.

---

## 감사 범위와 결과

### 후보 커밋이 `apps/web/app/components/wire/`에 적용한 변경 3파일

| 파일 | 변경 규모 | 내용 |
|---|---|---|
| `client-surface.ts` | +4줄 | `WireItem`/`WireItemProps` export 추가, `Icon`/`IconName` export 추가, `WireRadioGroup` export 추가 |
| `wire-section.tsx` | 3줄 교체 | `WireItem`의 `status` 슬롯을 title `<p>` 내부 인라인으로 이동 |
| `wire-styles.ts` | 2줄 교체 | `.wire-item-title`에 flex 레이아웃 + `min-height:var(--badge-height)` 추가 |

후보 커밋의 나머지 변경(apps/web 화면, api.ts, actions.ts, adapters, migrations, apps/api/test/*, apps/client/*)은 이 감사 범위 밖이다.

---

## 1. `client-surface.ts` 신규 export 3건

### 파일 소유권 — 모든 export 추가가 동일하게 차단됨

`apps/web/app/components/wire/client-surface.ts`는 현재 CLAUDE.md에 따라 **STT 클라이언트 독립 레인(`.worktrees/stt-client`)이 소유하는 브라우저 중립 공개 진입점**이다. 파일 자체에 소유권이 걸려 있으므로 세 export 추가 모두 DESIGN 레인이 단독으로 적용할 수 없다. `WireItem`/`WireItemProps` 누락이 "단순 누락"이라도, `Icon`이 Next.js 의존이 없어도, 이 파일의 변경 권한이 DESIGN에 없다는 사실은 동일하다. 세 export 모두 STT 레인 비반대 또는 ORCHESTRATOR가 명시적 소유권 인계를 확정한 뒤 적용한다.

### 현황

현재 `client-surface.ts`는 `wire-section.tsx`의 `WireCardSection`, `WireCardSectionProps`, `WireSectionTone`을 export하고 있지만 **같은 파일의 `WireItem`/`WireItemProps`는 export하지 않는다.**  
`wire-icon.tsx`와 `wire-radio-group.tsx`는 아예 공개되지 않았다.

### 후보가 추가하는 export

```ts
// 1. wire-section.tsx 에서 (WireItem은 이미 해당 파일에 있으나 공개 안 됨)
export { WireCardSection, type WireCardSectionProps, type WireSectionTone, WireItem, type WireItemProps } from './wire-section';

// 2. 신규 export 2줄
export { Icon, type IconName } from './wire-icon';
export { WireRadioGroup } from './wire-radio-group';
```

### 각 export 기술 적격성 평가 (소유권과 별개)

**`WireItem / WireItemProps`**
- `wire-section.tsx`에 이미 구현 완료. `apps/client/src/business/settings-modules.tsx`가 `@ccc/web/wire`에서 `WireItem`을 import한다. Next.js/서버 전용 모듈 의존 없음. client-surface 기술 적격.
- **적용 차단:** 파일 소유권 인계 필요.

**`Icon / IconName`**
- `wire-icon.tsx`는 React JSX만 사용하고 Next.js 의존 없음. client-surface 기술 적격.
- **적용 차단:** 파일 소유권 인계 필요.

**`WireRadioGroup`**
- `wire-radio-group.tsx`의 `'use client'` 디렉티브는 Next.js 힌트 메타데이터다. Vite는 이를 무시한다. `useLayoutEffect`, `useRef`, `observeRadioLayout`(순수 DOM 유틸)만 사용하며 서버/Next.js 런타임 모듈을 끌어오지 않는다. client-surface 기술 적격.
- **적용 차단:** 파일 소유권 인계 필요.

**`SearchInput`**
- `search-input.tsx`가 현재 main에 존재하지만 후보도 client-surface에 추가하지 않았다. `settings-modules.tsx`는 사용하지 않으므로 현재 불필요. DESIGN 이번 파동에서 추가하지 않는다.

---

## 2. `wire-section.tsx` — `WireItem` status 위치 변경

### 현행 구조

```tsx
<div className="wire-item" ...>
  <p className="wire-item-title">{title}</p>
  {description !== undefined && <p className="wire-item-desc">{description}</p>}
  {status !== undefined && <span className="wire-item-status">{status}</span>}  // 별도 grid 행
  {action !== undefined && <span className="wire-item-action">{action}</span>}
</div>
```

badge가 title 아래 별도 행으로 렌더된다. `.wire-item{display:grid;gap:var(--space-1)}`에서 grid 아이템으로 쌓인다.

### 후보 구조

```tsx
<div className="wire-item" ...>
  <p className="wire-item-title">
    {title}
    {status !== undefined && <span className="wire-item-status">{status}</span>}
  </p>
  {description !== undefined && <p className="wire-item-desc">{description}</p>}
  {action !== undefined && <span className="wire-item-action">{action}</span>}
</div>
```

badge가 title 텍스트 바로 뒤 인라인으로 이동한다.

### 평가: DESIGN-RULES 기준 승인

DESIGN-RULES.md §1:  
> "배지는 제목 글자 바로 뒤에 붙는다(2026-09-04 Q 전역 기준). 카드 제목·접힘 카드 제목·입력칸 라벨 모두 같다."  
> "배지가 설 수 있는 줄은 배지 유무와 무관하게 높이 22(`--badge-height`)를 예약한다"

후보의 `status` 인라인 이동이 규칙과 일치한다. 현행 구현이 규칙을 어기고 있던 것이다.

**`<p>` 내 `status` ReactNode 유효성 — 구현 시 LSP 호출자 분석 필요:**  
`status` prop의 타입은 `ReactNode`이므로 호출자가 block-level 요소를 포함할 경우 `<p>` 안에 들어가면 HTML 무결성 위반이다. WireBadge가 `<span>`을 렌더하더라도 각 호출자가 `status`에 무엇을 실제로 전달하는지 LSP references로 확인해야 한다. 구현 전 7개 호출자 전체를 점검하고, block-level 자식이 발견되면 `status`를 `<p>` 밖으로 유지하거나 별도 인라인 wrapper를 선택해야 한다.

### 기존 `status` 사용 화면 영향

현재 `WireItem`에 `status`를 전달하는 호출자:
- `record-list.tsx`, `fixture-draft-view.tsx`, `record-onepage.tsx`, `briefing-cards.tsx` (기록/리포트)
- `admin/ai-provider/stt-status.tsx`, `admin/assign/page.tsx`, `admin/users/page.tsx` (관리)
- `kit/page.tsx` (전시용, 감사 제외)

**시각 변화:** 모든 호출자에서 status 배지가 title 아래 별도 행에서 title 바로 뒤 인라인으로 이동한다. 이는 규칙 교정이며 의도된 변화다. 적용 후 DESIGN이 주요 화면에서 넘침/행 잘림/정렬 검수를 수행해야 한다.

---

## 3. `wire-styles.ts` — `.wire-item-title` CSS

### 변경

```css
/* 현행 */
.wire-item-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}

/* 후보 */
.wire-item-title{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);min-height:var(--badge-height);margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
```

### 평가

- `display:flex;flex-wrap:wrap;align-items:center`: title 텍스트와 badge span을 한 행으로 정렬, 좁은 폭에서 줄바꿈 허용.
- `gap:var(--space-2)`: 텍스트와 badge 사이 8px. DESIGN-RULES §1 "라벨 행 안 조각 간격(글자 ↔ 배지) 8"과 일치.
- `min-height:var(--badge-height)`: 배지 없는 행도 22px 예약. DESIGN-RULES §1 "배지가 설 수 있는 줄은 배지 유무와 무관하게 높이 22를 예약한다"와 일치.

이미 `.wire-item-status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2)}`는 현행 main에 존재한다. status 자체가 여러 badge를 담는 flex 컨테이너이고, 이것이 title flex 컨테이너 안의 아이템이 되므로 flex-in-flex 중첩이 발생한다. 이는 의도된 구조로, 외부 gap이 텍스트↔badge 간격을 제어하고 내부 gap이 badge-사이 간격을 제어한다.

---

## 적용 결정 요약

| 변경 | DESIGN 적용 여부 | 이유 |
|---|---|---|
| `client-surface.ts`: `WireItem / WireItemProps` 추가 | **Q 승인 완료 · 구현됨** | 2026-09-09 Q가 DESIGN에 좁은 export 인계 명시 승인. STT 행동 불변 |
| `client-surface.ts`: `Icon / IconName` 추가 | **Q 승인 완료 · 구현됨** | 동일 |
| `client-surface.ts`: `WireRadioGroup` 추가 | **Q 승인 완료 · 구현됨** | 동일 |
| `wire-section.tsx`: status 인라인 이동 | **이번 패치 제외 — 후속 공유 레이아웃 수락 작업** | 7개 호출자 LSP 분석 + 소유권 슬롯 별도 확정 필요 |
| `wire-styles.ts`: flex + min-height | **이번 패치 제외 — 후속 공유 레이아웃 수락 작업** | status 인라인과 동반이라 독립 적용 불가 |

---

## 적용하지 않는 변경 (범위 밖)

| 파일 | 슬롯 | 조건 |
|---|---|---|
| `apps/web/app/lib/api.ts` — `programId` 교체, `getProgramOptions`, `ProgramOption` | **레거시 웹 통합 슬롯: ORCHESTRATOR 배정 대기** | BACKEND 계약 수락 후 ORCHESTRATOR가 담당을 정한다. 단, capabilities 읽기 함수는 FRONTEND 예외 경로로 보호 |
| `apps/web/app/actions.ts` — `programId` 교체, `program_admission_required` | **레거시 웹 통합 슬롯: ORCHESTRATOR 배정 대기** | 동일 |
| `apps/web/app/participants/invite/invite-issue.tsx` | 레거시 웹 통합 슬롯 | 동일 |
| `apps/web/app/participants/invite/page.tsx` | 레거시 웹 통합 슬롯 | 동일 |
| `apps/web/app/participants/new/page.tsx` | 레거시 웹 통합 슬롯 | 동일 |
| `apps/web/app/participants/new/register-form.tsx` | 레거시 웹 통합 슬롯 | 동일 |
| `apps/client/**` | FRONTEND 레인 | client-surface export 소유권 인계 후 소비 |

**Programs API 상태 구분 — 오케스트레이션 정본:**
- **현재 main:** `programs` 관리 라우트/표가 없다.
- **후보 `71778f3`:** Programs API가 구현돼 있고 `settings-foundation-verification.txt`에서 실제 브라우저 검증까지 완료됐다(PostgreSQL 격리 DB, `확인 및 직원 지속`, 중복 제출 1 mutation, 409 동시성, 사업 종료 후 신규 등록 차단, 1280px/390px 스크린샷 보존).
- **현재 통합 상태:** 후보 커밋은 BACKEND의 `integrate/beta-0.9-backend` 브랜치에 수락되지 않았다. 따라서 위 web 화면 변경은 BACKEND 통합 브랜치가 Programs API를 포함해 main에 병합되고 ORCHESTRATOR가 레거시 웹 슬롯 담당을 배정한 뒤 적용된다.

**`apps/web/app/lib/api.ts` 소유 예외:** FRONTEND 레인은 이 파일의 `GET /capabilities` 읽기 함수만 보호 범위로 갖는다. 나머지 변경(programId, getProgramOptions 등)은 레거시 웹 통합 슬롯이며 BACKEND 범위(`apps/web/**`)가 아니다.


---

## FRONTEND 소비 계약

`apps/client/src/business/settings-modules.tsx`가 `@ccc/web/wire`에서 import하는 항목:

```ts
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice,
  WireDataRow, WireDataRows, Icon, WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
```

DESIGN이 위 export 패치를 적용하면 FRONTEND는 `@ccc/web/wire`에서 다음을 안전하게 가져올 수 있다:

| export | 현재 가능 | 패치 후 |
|---|---|---|
| `WireCard` | O | O |
| `WireCardSection` | O | O |
| `WireSectionTone` (type) | O | O |
| `WireChoice` | O | O |
| `WireFormField` | O | O |
| `WireButton` | O | O |
| `WireBadge` | O | O |
| `WireCallout` | O | O |
| `WireEmpty, WireError` | O | O |
| `WireDataRow, WireDataRows` | O | O |
| **`WireItem` (settings에서 필요)** | X | **O** |
| **`Icon` (settings에서 필요)** | X | **O** |
| **`WireRadioGroup` (settings에서 필요)** | X | **O (STT 확인 후)** |

---

## 수용 기준

- `wire-section.tsx`와 `wire-styles.ts` 변경 후 `pnpm typecheck`가 통과한다.
- `wire-section.test.tsx`가 `status` prop을 포함한 기존 테스트를 통과한다.
- `kit/page.tsx` 전시 화면에서 `WireItem`의 status 배지가 title 바로 뒤에 인라인으로 나타난다.
- `client-surface.ts` export 추가 후 `apps/client/src/business/settings-modules.tsx`가 타입 오류 없이 컴파일된다.
- `align-harness.test.tsx`, `hierarchy-harness.test.tsx`가 통과한다(후보 커밋에서 이 두 파일을 ±9줄 수정했으나 net 변경이 적다. 현재 main 기준 실행 후 결과 확인).

---

## 막힌 의존성

- **`client-surface.ts` export 3건:** Q 승인 완료. 구현 및 타입 검증 완료. 이 문서와 같은 커밋에 포함.
- **`wire-section.tsx` + `wire-styles.ts`:** 이번 패치 제외. 7개 `status` 호출자 LSP 분석 + ORCHESTRATOR 후속 슬롯 배정 후.
- **레거시 웹 화면 programId 교체:** BACKEND `integrate/beta-0.9-backend`가 Programs API를 포함해 main에 통합되고 ORCHESTRATOR가 레거시 웹 슬롯 담당을 배정한 후.
- **FRONTEND P2 셸 조립:** `WireLinkProvider`, `WireButton`, `WireFormField`는 이미 export 중이므로 셸 조립 자체는 현재 exports로 시작 가능하다. Settings 화면(`WireItem`, `Icon`, `WireRadioGroup`)은 이번 커밋 후 즉시 가능.

---

## 다음 단계

1. ~~ORCHESTRATOR STT 레인 소유권 확인~~ — Q가 2026-09-09 명시 승인 완료.
2. ORCHESTRATOR가 `wire-section.tsx`/`wire-styles.ts` 변경을 별도 후속 슬롯으로 배정한다. 7개 호출자 LSP 분석 선행.
3. FRONTEND는 이번 커밋(`client-surface.ts`) 후 `apps/client/src/business/settings-modules.tsx`를 컴파일 검증한다.
4. BACKEND `integrate/beta-0.9-backend` 브랜치 통합이 확정되면 ORCHESTRATOR가 레거시 웹 슬롯(`api.ts`, `actions.ts`, `participants/**`)의 담당을 배정한다.

---

## FRONTEND P1/P2 소비 감사: `apps/client/src/business/business.css`

감사 기준: DESIGN 레인 읽기 전용 소스 비교 감사. 브라우저 픽셀 QA가 아니다.  
대상: 후보 `71778f3:apps/client/src/business/business.css` (62줄) + `business-page.tsx` + business 모듈 10개.  
비교 기준: `DESIGN-RULES.md`, `apps/web/app/components/wire/wire-styles.ts`, `apps/web/app/layout.tsx` 현행 main.

### 클래스 이름 전수 대사 (orphan 없음)

| 클래스 | 정의처 | 판정 |
|---|---|---|
| `business-form`, `business-actions`, `business-qr` | `business.css` | ✓ |
| `settings-layout`, `settings-content`, `settings-navigation-list` | `business.css` | ✓ |
| `settings-navigation` | `business.css` (미디어 쿼리 선택자 한정자만, 독립 규칙 없음) | ✓ |
| `navigation-link` | `business.css` (`text-decoration:none` 추가) + `layout.tsx` 공유 CSS(상태 포함) | ✓ 아래 참조 |
| `page-header`, `page-actions`, `page-content` | `layout.tsx` 공유 CSS | ✓ |
| `wire-choice-group`, `wire-fieldset`, `wire-form-hint`, `wire-section-value` | `wire-styles.ts` 공유 CSS | ✓ |

orphan 클래스 없음.

### 토큰 준수 확인 (경쟁 디자인 값 없음)

`business.css`가 직접 지정하는 모든 비구조값은 `var(--*)` 토큰이다:
- 간격: `var(--space-5)`, `var(--space-3)`, `var(--space-0-5)`, `var(--space-4)`, `var(--section-gap)` 전용
- 색, 폰트 크기/굵기, border-radius, box-shadow: 직접 값 없음
- 원시 px: `minmax(220px, 280px)` (settings nav 격자 열 폭). 220=55×4, 280=70×4, 4의 배수 준수. 레이아웃 격자 정의에 전용 토큰이 없으며 색·폰트·간격 계약을 침범하지 않음
- 미디어 쿼리 `(max-width: 767px)`: 단일 브레이크포인트 계약과 일치
- 10개 business 모듈: `style=` 인라인 속성 없음

### `.navigation-link` 상태 — 공유 CSS가 이미 처리함, 새 CSS 불필요

`business.css`는 `.settings-navigation-list .navigation-link { display:flex; align-items:center; text-decoration:none }`만 추가한다. 호버·선택 상태는 `business.css`에 없지만, 이는 결함이 아니다. `layout.tsx` 공유 CSS가 이미 `composeSharedCss()` 출력에 다음을 포함한다:

- `.navigation-link { min-height:var(--pill-height); padding:0 var(--space-2); border:1.5px solid transparent; border-radius:var(--radius-control); color:var(--sub); ... }`
- `.navigation-link[data-current="true"] { background: linear-gradient(var(--blue-tint),...) padding-box, var(--gradient-brand) border-box; color:var(--ink); font-weight:600 }`
- `.navigation-link:not([data-current="true"]):hover { background:var(--ink); color:var(--panel) }`
- 다크 모드 변형 포함

`SettingsLink`가 이미 `data-current="true"`를 활성 항목에 설정하므로 공유 CSS 선택 상태 규칙이 적용된다. **FRONTEND는 `.navigation-link` 상태 규칙을 새로 작성하지 않는다.** Q가 디자인 세부사항을 유보했으며 공유 CSS로 충분하다.

### 관찰: 모바일 WireCardSection 구분선 재정의

`business.css` 모바일 미디어 쿼리가 `.settings-navigation .wire-card-section + .wire-card-section`의 `margin-inline`, `padding-top`, `padding-inline`, `border-top`을 0으로 재정의한다. 범위가 `.settings-navigation` 안으로만 한정돼 다른 화면에 영향 없음. `wire-styles.ts`가 해당 속성을 바꾸면 이 재정의가 깨질 수 있다. 이번 파동에서 교정하지 않고 관찰로 기록한다.

### 공유 CSS 로딩 방식과 정적 출력 계약

**현재 후보 상태 (`main.tsx`):**
```js
const style = document.createElement('style');
style.textContent = sharedCss;  // virtual:ccc-shared-css → composeSharedCss() 출력
document.head.append(style);
```
런타임 `<style>` 주입이다. `style-src 'self'`만으로는 동작하지 않으며 `'unsafe-inline'` 또는 nonce가 필요하다. 현재 후보를 CSP 준수로 보고하지 않는다.

**필수 미래 통합 (P2 셸 조립 시):** `virtual:ccc-shared-css`를 통한 런타임 `<style>` 주입을 Vite 정적 CSS 파일 출력으로 교체해야 `style-src 'self'` 준수가 가능하다. `build/shared-styles.mjs`의 `composeSharedCss()`를 Vite 빌드 플러그인 또는 별도 입력 CSS 파일로 전환하는 것이 해당 작업이다. 이것은 현재 증거가 아니라 요구되는 후속 작업이다.

**`business.css`는 이 변환과 무관하다.** `import './business.css'`는 Vite가 정적 파일로 처리하며 현재도 `dist/assets/*.css`로 출력된다.

### 소비 판정

**`business.css`는 수정 없이 소비 가능하다.** 경쟁 디자인 값 없음. 토큰 준수. 모든 클래스 출처 확인. `.navigation-link` 상태는 공유 CSS가 담당. DESIGN이 이 파일을 수정하지 않는다.

FRONTEND 수령 조건 2건:
1. 공유 CSS(`composeSharedCss()` 출력)가 `business.css`보다 **먼저** 로드돼야 공유 `.navigation-link` 기반 규칙이 적용된다. 현재 후보 `main.tsx`는 이 순서를 지킨다.
2. P2 시점에 `virtual:ccc-shared-css` 런타임 주입을 정적 파일 출력으로 교체한다. 이것이 완료되기 전까지 CSP `style-src 'self'` 준수를 완료로 세지 않는다.
