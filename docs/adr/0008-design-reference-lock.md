# 디자인 레퍼런스 락 — 모노크롬 골격 + 웜 뉴트럴, 색은 semantic 전용

2026-07-17 확정. 화면 개편(D19~D29)의 시각 언어를 Refero 레퍼런스 리서치로 근거를 잡고 **하나의 방향으로 락**한다. 모델의 일반적 감각이나 "적당히 예쁘게"로 화면을 그리지 않는다.

## 락 내용

**Primary: shadcn/ui** (https://ui.shadcn.com) — 컴포넌트 체계·색 규율·타이포 골격을 소유한다.
**Secondary: Dock** (https://dock.us) — **밀도·radius·웜 오프화이트만** 빌려온다. Dock의 일렉트릭 블루(#0068f9)는 가져오지 않는다.

역할을 넘기지 않는다: Dock에서 가져오는 건 표면 온도·여백과 **success 색 하나**뿐이고, 액션 색·컴포넌트 규칙은 shadcn이 끝까지 소유한다.

> **경계 수정 이력 (2026-07-17, 구현 중)**: 최초 락은 "Dock에서 가져오는 건 표면 온도와 여백뿐"이었다. 구현 후 렌더 검증에서 shadcn 토큰표의 success `#10c22b`가 회색 배지 위 **대비 2.14로 WCAG AA(4.5) 미달**임이 드러났다(shadcn 문서는 이 색을 "muted, serious green"이라 설명하지만 실제 값은 형광에 가깝다). Q 결정으로 Dock의 `--color-mint-green #046645`(대비 6.27)를 채택 — **역할 경계를 이 한 색에 한해 명시적으로 확장**한다. Dock의 일렉트릭 블루(`#0068f9`)는 여전히 가져오지 않는다.

### 이 락은 시각 기준이지 의존성 결정이 아니다

**shadcn/ui를 설치한다는 뜻이 아니다.** 현재 `apps/web`에는 Tailwind도 shadcn도 없고, 스타일은 `app/layout.tsx` 안의 CSS 문자열을 `<style>`로 주입하는 손수 만든 토큰 시스템이다(`:root`에 `--canvas`·`--accent`·`--line` 등). 이 구조는 D30을 담기에 충분하다 — 토큰 이름만 다를 뿐 형태가 같다.

즉 D30 준수 = **`:root` 토큰 값을 이 문서 값으로 맞추는 것**이고, shadcn 도입 여부는 별개의 미결 사항이다(현재 계획 없음). "shadcn 골격"은 *무엇을 보고 베꼈는가*이지 *무엇을 import 하는가*가 아니다.

### 토큰

| 역할 | 값 | 출처 |
| --- | --- | --- |
| 캔버스 | `#faf9f7` (웜 오프화이트) | Dock — Horizon Gray |
| 카드 | `#ffffff`, radius 14, padding 24 | shadcn(radius) + Dock(padding) |
| 보더 | `#e5e5e5` 1px | shadcn — Subtle Ash |
| 텍스트 | `#0a0a0a` / 보조 `#737373` | shadcn |
| 프라이머리 액션 | `#0a0a0a`, radius 10 | shadcn |
| 배지·필 | radius 9999 | shadcn |

### 색 예약 (이 락의 핵심)

무채색이 기본이고, **채도는 semantic에만 쓴다**.

| 용도 | 값 | 대비(회색 배지 위) |
| --- | --- | --- |
| 리스크 플래그 (D9) | `#c22b10` — 화면의 유일한 경고색 | 5.14 (AA) |
| GAS 긍정 · 완료 | `#046645` (Dock Mint Green) | 6.27 (AA) |
| 감정 추이 (R4) | 중립 그레이 스케일 | — |
| **주의·대기·미완료** | **색 없음 — 검정 반전 배지** | 17.68 (AA) |

브랜드 색·장식 그라데이션·컬러 배경을 도입하지 않는다.

**액센트 띠(한쪽만 border) 금지** (2026-07-17, Q 지시). `border-left:6px solid var(--risk)` 같은 한쪽 면만 두꺼운 색 띠를 쓰지 않는다 — 강조는 **테두리 전체·배경·대비**로 만든다. 리스크 배너도 예외가 아니며, 균일한 `border:2px solid var(--risk)` + 배경 틴트로 무게를 유지한다.

적용 제외(이 규칙의 대상이 아님): 리스트 행 구분선(`border-bottom`)은 장식 띠가 아니라 구조적 구분자다. `::before`의 `border-right/bottom` + `rotate`는 아코디언 화살표를 그리는 CSS 삼각형 기법이지 테두리 처리가 아니다.

**색 예약에 추가하려면 대비를 먼저 계산한다.** 이 표의 값은 전부 `#f2f2f2` 배지 배경 위 WCAG AA(4.5) 통과를 확인한 것이다 — 레퍼런스의 hex를 그대로 옮겨 적지 말 것(실제로 shadcn의 success `#10c22b`가 2.14로 미달해 교체됐다).

### 주의 상태는 색이 아니라 대비로 (2026-07-17 추가)

"승인 대기 N건"(D5), "미완료" 액션(D22), "저장 전" 같은 **주의 상태에는 색을 쓰지 않는다.** shadcn의 **Inverse Tag Badge** 패턴(검정 배경 + 흰 글자)으로 표시한다 — 색조가 아니라 대비로 시선을 끌기 때문에 "리스크가 화면의 유일한 색"이 그대로 유지된다.

```css
.warning{color:var(--panel);background:var(--ink)}
```

최초 락은 이 상태군을 예약 표에서 빠뜨렸다. 이 제품에서 D5 승인 대기 배지와 미해결 액션은 상담사가 5분 훑기에서 반드시 봐야 하는 신호라 무채색 회색(=기본 배지보다 흐림)으로 두면 안 된다.

### 타이포

**Pretendard** (Geist/Inter 골격의 한글 서체). 트래킹은 **한글 -0.01em / 숫자·영문 -0.03em** — 원 레퍼런스의 -0.05em을 한글에 그대로 쓰지 않는다(한글 자소는 이미 조밀해 뭉친다).

단, 이 트래킹 값은 **의도이고 구현은 근사치**다. CSS `letter-spacing`은 요소 단위라 "제비 003"처럼 한글·숫자가 한 줄에 섞이면 스크립트별로 나눠 줄 수 없다(span을 쪼개지 않는 한). 실무 기준: 본문·혼용 텍스트는 한글 기준 -0.01em로 두고, **숫자만 단독으로 서는 곳**(GAS 점수, 가명 ID 번호, 날짜)에만 -0.03em을 적용한다.

## Considered Options

- **디스플레이 세리프 + 아이보리 캔버스** (August Health, Ease Health, Alden, Vanta, Steep, Perplexity): 현재 헬스케어·케어 SaaS 트렌드의 큰 축이고 톤도 사업 성격에 맞지만, **한글 대체 서체가 없다** — 본명조·나눔명조는 "차분한 프리미엄"이 아니라 신문·공문으로 착지한다. 보정 불가로 기각.
- **순수 스타크 모노크롬** (shadcn/Vercel/Linear 그대로): 구현이 가장 빠르나(shadcn 기본값), 개발자 도구 톤이라 사회복지사 도구로 차갑게 읽힘 — 기각.
- **따뜻한 라운드** (Dock/Atoms/Aboard): 비영리 톤에 가장 맞지만 바탕에 파랑이 상시 깔려 리스크 배너가 배경 소음에 묻힌다 — 기각.
- **모노크롬 골격 + 웜 뉴트럴 + 색 예약**: 채택.

## Consequences

- **D9(리스크 최우선)가 디자인으로 강제된다.** 바탕이 무채색이라 확인된 플래그가 화면의 유일한 색이 되고, 배치가 아니라 색 대비로 먼저 눈에 들어온다. 6장의 "접힘 불가 경고 배너"와 같은 방향.
- **R4(감정은 숫자만)와 충돌하지 않는다.** 감정 추이에 색을 못 쓰므로 "빨강=불안" 같은 단정 표시가 애초에 불가능하다.
- **현재 팔레트가 이 락과 어긋나 있다.** 기존 `:root`는 쿨 민트 캔버스(`#F4F7F7`)에 **틸 액센트(`#006C6F`)를 크롬 전반에 상시 사용**한다(사이드바 활성, 프라이머리 버튼, GAS 게이지, HERO 태그 등 7곳). D30의 "색은 semantic 전용"과 정면 충돌 — 틸을 무채색으로 걷어내는 것이 구현의 실체다.
- 토큰이 `:root` 한 곳에 모여 있어 **값 교체만으로 11개 화면에 전파된다** — 마크업 수정 없이 가능.
- **Pretendard가 실제로는 로드돼 있지 않다**(font-family 스택에 이름만 있고 `@font-face`·`next/font` 없음) — 맥은 Apple SD Gothic Neo, Windows는 또 다른 서체로 조용히 폴백 중. D30의 타이포 항목은 서체 실로드부터가 시작이다.
- 새 색을 도입하려면 이 ADR을 고쳐야 한다. 화면별로 "여기만 파랗게"는 락 위반이다.

## 레퍼런스 미리보기 링크

Refero 캡처 이미지. 말로 적힌 토큰이 실제로 어떻게 보이는지 확인용.

### 채택

| 레퍼런스 | 역할 | 미리보기 | 사이트 |
| --- | --- | --- | --- |
| shadcn/ui | Primary — 컴포넌트·색 규율·타이포 | [preview](https://images.refero.design/styles/ui.shadcn.com/c14c0a94-1037-449e-bf5b-4cb972656ac7/preview_0.jpg) | https://ui.shadcn.com |
| Dock | Secondary — 웜 뉴트럴·밀도·padding만 | [preview](https://images.refero.design/styles/dock.us/a30dfeb9-9330-4e29-9477-76476481ef09/preview_0.jpg) | https://dock.us |

### 참고 (정독했으나 미채택)

| 레퍼런스 | 미리보기 | 사이트 |
| --- | --- | --- |
| Vercel | [preview](https://images.refero.design/styles/vercel.com/32824f01-0f25-473e-b57f-d8f2121bbcb1/preview_0.jpg) | https://vercel.com |
| Linear Changelog | [preview](https://images.refero.design/styles/linear.app/11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6/preview_0.jpg) | https://linear.app/changelog |
| Clerk | [preview](https://images.refero.design/styles/clerk.com/a81cd9a7-bd6a-4bfd-9f9c-4ecd75bb251a/preview_0.jpg) | https://clerk.com |

### 기각 — 디스플레이 세리프 + 아이보리 축

헤드라인을 한글로 바꿔 상상하면 왜 잘랐는지 바로 보인다. 저 축은 세리프 헤드라인이 톤의 전부인데 한글엔 대응 서체가 없다.

| 레퍼런스 | 미리보기 | 사이트 |
| --- | --- | --- |
| August Health | [preview](https://images.refero.design/styles/www.augusthealth.com/be1c2381-7af0-4d7c-91ca-09a715a06346/preview_0.jpg) | https://www.augusthealth.com |
| Ease Health | [preview](https://images.refero.design/styles/easehealth.com/954854b3-3477-4f6a-891e-302c15987973/preview_0.jpg) | https://easehealth.com |
| Alden | [preview](https://images.refero.design/styles/www.alden.health/6de9da02-1de3-4e85-8347-1b83d2c21438/preview_0.jpg) | https://www.alden.health |
| Vanta | [preview](https://images.refero.design/styles/www.vanta.com/79fffe1c-8b81-4ec9-917a-d34760e75850/preview_0.jpg) | https://www.vanta.com |

### 기각 — 따뜻한 라운드 축 (한글은 안전, 색 예약과 충돌)

| 레퍼런스 | 미리보기 | 사이트 |
| --- | --- | --- |
| Atoms | [preview](https://images.refero.design/styles/atoms.dev/ec16ba1d-4dc2-4b46-a8ee-774c7d985db5/preview_0.jpg) | https://atoms.dev |
| Aboard | [preview](https://images.refero.design/styles/aboardhr.com/735edf7d-e21b-4aec-bb2f-1404ac78e160/preview_0.jpg) | https://aboardhr.com |
| Flecto | [preview](https://images.refero.design/styles/flecto.io/a4da778b-6520-4fbc-9211-fcff23ba3b65/preview_0.jpg) | https://flecto.io |

## 외부 안티슬롭 검토 (2026-07-17, Q 요청)

Q가 세 소스를 주고 "확인해서 디자인 수정하라" 요청. 검토 결과와 채택 여부:

| 소스 | 판정 | 이유 |
| --- | --- | --- |
| [slopslap](https://github.com/vibedesignlab/slopslap) | **채택** | 감산형 + WCAG·Tailwind·Radix 수치 기준. 금지 패턴 스캔 결과 전부 clean(glassmorphism·mesh/blob·gradient text·glow·italic·이모지 0건) — D30 무채색 규율이 이미 걸러냄. 대신 **대비 결함 2건을 잡아냄**(아래) |
| [taste-skill](https://github.com/leonxlnx/taste-skill) | **미채택** | 레이아웃 변주·모션 강도·스크롤 트리거·마그네틱 애니메이션을 올려 premium하게 만드는 도구. **랜딩페이지 문법이라 이 제품에 해롭다** — 상담 5분 전 훑기가 유일한 직무인 내부 도구에서 비대칭 레이아웃·스크롤 모션은 정보 탐색을 방해한다 |
| `/frontend-design` | **부분 채택** | "미니멀은 정밀함이 생명"·"대담함은 한 곳에만"만 적용. hero=thesis·characterful display face·aesthetic risk는 미채택(마케팅 페이지 전제) |

**뜻밖의 외부 검증**: `/frontend-design`은 AI가 기본값으로 뱉는 3대 룩을 나열하는데 그 1번이 *"크림 배경(#F4F1EA) + 고대비 세리프 + 테라코타 액센트"* — D30이 한글 서체 부재로 기각한 바로 그 축이다. **다른 이유로 같은 결론**에 도달했다.

### "shadcn 모노크롬은 너무 뻔하지 않나"에 대한 답

정직하게 제기해야 할 질문이다 — shadcn 모노크롬은 현재 "AI가 만든 앱"의 가장 템플릿적인 룩이고, 자동 검사가 clean으로 나온다고 이 질문이 답해지지 않는다(검사는 "장식이 없는가"를 재지 "뻔한가"를 못 잰다).

Q 판단으로 **방향 유지 + 정밀도 투자**를 택했다. 근거:
- 내부 도구는 시선을 끌 이유가 없다. 상담사는 고객이 아니라 사용자고, 독특함의 수익자가 없다.
- **시그니처는 이미 있다** — 색 예약(리스크가 화면의 유일한 색)은 D9에서 나온 선택이지 기본값이 아니다. `/frontend-design`의 "대담함은 한 곳에만" 기준으로 이게 signature다.
- 따라서 독특함 예산은 장식이 아니라 **간격·타입·대비의 정밀함**에 쓴다.

### 이 검토로 고친 것

| 항목 | before | after | 근거 |
| --- | --- | --- | --- |
| `--sub` | `#737373` | `#6b6b6b` | 회색 배지 위 대비 **4.24 → 4.76**. 12px 텍스트라 AA 4.5 필수였다(`.provenance-label`·`.settings-user-status`·`.gas span`) |
| `--line` | `#e5e5e5` | `#d4d4d4` | 1.26 → 1.48. shadcn 원본은 흰 배경 위 1.26이라 **입력창 경계가 밝은 조명·저가 모니터에서 사라진다**. WCAG 3.0을 다 채우진 않지만(그러려면 `#949494`로 관공서 톤) 실사용 기준의 절충 |
| 간격 그리드 | 18/26/42/10/6px 혼재 | 4의 배수로 정리 | 입력창 42px가 버튼 40px과 어긋나 있던 것도 함께 해소. 남은 예외는 `gap:2px`(라벨-값 미세 간격)·`legend{padding:0 6px}`(테두리 끊는 광학 여백)뿐 — 리듬 값이 아니라 광학 보정 |

## 근거

Refero 스타일 6개 각도 검색, 전문 레퍼런스 4건(shadcn/ui, Vercel, Clerk, Dock) 정독. 레퍼런스는 전부 마케팅/랜딩 페이지이므로 **토큰만 이식하고 섹션 구성(히어로·컨익 그라데이션 등)은 가져오지 않는다** — CCC는 인앱 브리핑 화면이다.

"popular"는 Refero에 인기 랭킹 API가 없어 의미 검색(`popular trending 2025 …`)으로 근사한 것 — 트렌드 정렬이지 인기순 랭킹 그대로가 아니다.

(2026-07-17 /refero-design 리서치 세션에서 결정)
