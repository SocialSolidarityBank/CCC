// 컴포넌트 킷 — 디자인 시스템 V0.1(D34 · ADR-0012 · DESIGN.md §5 계약).
//
// 2026-07-26 스킨 패스로 그레이스케일 와이어프레임 토큰(--wire-*)을 걷어냈다. 색·형태 값은
// design/tokens.css(:root)에서만 오고, 이 파일은 그 토큰을 쓰는 규칙만 갖는다. 클래스 이름은
// 그대로 두었다 — 화면 30개가 참조하고 있어 이름을 바꾸면 스킨 패스가 구조 변경이 된다.
//
// 그라데이션 테두리는 배경 2겹(padding-box + border-box)으로 만든다. border-image 는 브라우저가
// border-radius 를 무시해 모서리가 각지므로 금지다(DESIGN.md §3-3). 이 방식은 테두리가 background
// 안에 들어가므로, 나중에 background 를 통째로 덮으면 테두리가 사라진다. 그래서 채움색을
// --surface-fill 변수로 빼두고 hover·selected 는 그 변수만 바꾼다.
export const wireStyles = `
/* ── 카드 계약 ── **아웃라인 카드**다(2026-08-05 Q 개정 · ADR-0030 — 구 --shadow-soft 폐지).
   경계는 그림자가 아니라 **선 2종**이 만든다(Infisical·Cloudflare·Vercel·Supabase 레퍼런스):
     기본(비선택) = 회색 --line 1px / 선택·활성 = --gradient-brand 1px.
   그림자는 본문 흐름 밖으로 떠 있는 층(모달·팝오버·스티키 헤더)만 쓴다 — 본문 카드가
   그림자를 나눠 가지면 정작 떠 있는 층이 뜨지 않는다.
   그라데이션을 **상시** 두르는 컴포넌트는 여전히 리스크 배너 하나뿐이다(D9 — 전 카드에
   두르면 배너가 묻힌다). 카드의 그라데이션은 '선택·활성'의 어휘다.
   채움을 바꿀 때는 --surface-fill 만 바꾼다(선택 상태는 배경 2겹이라 background 를 덮으면 테두리가 날아간다). */
.surface-card{
  --wire-outline-color:var(--line);
  --wire-outline-width:1px;
  --surface-fill:var(--panel);
  border:var(--wire-outline-width) solid var(--wire-outline-color);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  color:var(--ink);
}
/* 안내줄 변형(D59 ②): 블루 tint 면 — 자동 저장·저장 완료 같은 시간·상태 축 안내(D34).
   테두리는 기본 카드와 같은 --line 이다 — 리스크 어휘(--risk 테두리)는 배너 전용(D9). */
.surface-card[data-tone="info"]{--surface-fill:var(--blue-tint)}
/* 콜아웃 톤 확장(2026-08-07 · WireCallout): 민트 = 사람·소속, 라벤더 = 주의·대기(색 규율 5). */
.surface-card[data-tone="mint"]{--surface-fill:var(--mint-tint)}
.surface-card[data-tone="lavender"]{--surface-fill:var(--lavender-tint)}
/* 안내줄 안 조각 — 제목 16/600 --ink · 본문 14 --sub · 행동 줄. draft-notice ·
   intake-saved-notice 가 인라인 스타일로 제각각 그리던 것을 한 계약으로 모았다(2026-08-05). */
.notice-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.notice-desc{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 안내줄 안 목록(2026-08-09) — 기하는 .wire-bullets 를 그대로 빌리고 크기·색만 본문 짝
   (14/400 --sub)에 맞춘다. 16/--ink 로 두면 목록이 제목(16/600)과 같은 위계로 읽혀
   "무엇이 남았나" 보다 목록 자체가 먼저 눈에 든다. 단일 항목(.wire-bullets-single)도 같은 값.
   클래스 둘(0-2-0)로 적는 이유는 .wire-bullets 가 이 파일 뒤쪽에 있어 한 클래스끼리는
   순서로 지기 때문이다(.wire-row.schedule-candidate-row 와 같은 처리). */
.wire-bullets.notice-list,.wire-bullets-single.notice-list{font-size:var(--text-sm);color:var(--sub)}
.notice-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
/* 자동 저장 상태 한 줄, 카드 밖 플랫 텍스트. 보조 정보라 400 이다(2026-08-07 짝 통일). */
.notice-status{margin:0;font-size:var(--text-sm);font-weight:400;color:var(--sub)}
/* ── 당사자 카드 ── 일정과 당사자 목록은 이름·ID·우상단 배지·정보 행의 공통 골격을 쓴다.
   내부 선 없이 14/600 라벨과 16/400 값을 같은 줄에 놓고 정보 행은 세로로 쌓는다. */
.participant-card-link{display:block;color:inherit;text-decoration:none}
/* 헤더와 정보행 사이도 정보행 간격과 같은 10 이다(2026-08-23 Q "이름-라벨 간격을 필드
   행간과 시각적으로 맞출 것"). 이름 18(행상자 27)의 하프리딩이 라벨 14(행상자 21)보다
   1px 커서, 기하 10 = 잉크 간격 18 ≈ 행간 잉크 간격 17 로 시각적으로 같은 리듬이 된다. */
.participant-card{display:grid;align-content:start;gap:var(--space-2-5);min-width:0;overflow:hidden;padding:var(--space-5) var(--space-6)}
.participant-card-header{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);min-width:0}
/* 이름 열과 ID 는 정보 행의 라벨 열(80px, .wire-field-row)과 같은 격자를 쓴다
   (2026-08-26 Q "participant-card-id 를 participant-card-date 와 열 맞추기") — 이름이
   80px 안이면 ID 가 아래 값들과 같은 x 에서 시작하고, 길면 자연히 밀린다.
   column-gap 은 compact 행과 같은 --space-2-5 다. */
.participant-card-identity{display:grid;grid-template-columns:minmax(80px,max-content) minmax(0,1fr);column-gap:var(--space-2-5);flex:1 1 auto;align-items:center;min-width:0;overflow:hidden}
/* 이름 크기는 자리 두 단이다(2026-08-27 Q, 구 전역 21 한 벌 대체). 목록·일정 카드(row)는
   카드 내용과 같은 16/600, 당사자 정보·HERO(hero·hub)는 카드 제목과 같은 18/600(§2 짝 계약).
   전용 토큰(--text-participant-name)은 마지막 사용처가 사라져 폐기, 계단 토큰만 쓴다. */
.participant-card-name-group{flex:0 1 auto;min-width:0;overflow:hidden}
.participant-card-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink);font-weight:600}
.participant-card-name.is-empty{color:var(--sub)}
.participant-card-fields{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-2-5)}
.participant-card-fields>.wire-field-row{min-width:0}
.participant-card-date,.participant-card-emphasis{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 참여 사업 수는 14/600 민트 deep — 진행·소속 축(D34)의 강조 값이라 역할표 라벨 행 안이다. */
.participant-card-emphasis{color:var(--mint-deep);font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal)}
/* 가명 ID 는 설명 단(14/400 --sub)으로 이름보다 한 발 물러선다. */
/* 가명 ID는 당사자 카드에서만 이름을 보조하는 12/400 정보다. 본문 계단과 배지 토큰을
   재사용하지 않고 전용 토큰으로 자리를 잠근다(2026-08-23 Q). */
.participant-card-id{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sub);font-size:var(--text-participant-id);font-weight:400;line-height:var(--leading-normal)}
/* 배지는 두 화면 모두 같은 우상단 자리다. 지난 일정만 유형 옆에 상태 배지가 하나 더 붙는다. */
.participant-card-badges{display:inline-flex;align-items:center;gap:var(--space-2);flex:none;margin-left:auto}
/* 선택·활성 표면: 여기서만 브랜드 그라데이션 테두리를 쓴다. border-image 는 radius 를 죽이므로
   배경 2겹(padding-box + border-box)으로 만든다(DESIGN.md 3-3). */
/* details 로 만든 카드는 **펼친 것이 곧 활성**이다(D47 상담 기록 회차 카드). 상태가 브라우저
   쪽에서 바뀌므로 data 속성 대신 [open] 을 같은 규칙에 얹는다 — 어휘가 갈라지지 않는다. */
/* details 는 overflow:clip 이 필수다(2026-08-03) — Chromium 이 details 의 border-box
   그라데이션 배경층을 하단 border-radius 로 잘라내지 못해, 펼친 회차 카드의 아래 모서리가
   각지고 링이 삐져나온다(킷 '그라데이션 테두리 3종'에서 실측). 레이어 승격(will-change)으로는
   안 고쳐지고 클립만 고친다. summary 포커스 링은 안쪽(-2px)으로 옮겨 잘리지 않게 한다. */
details.surface-card{overflow:clip}
.surface-card[data-selected="true"],.surface-card[aria-current="true"],.surface-card[open]:not(.schedule-past-day):not(.schedule-day-accordion),.is-selected-surface{
  border-color:transparent;
  background:linear-gradient(var(--surface-fill),var(--surface-fill)) padding-box,var(--gradient-brand) border-box;
}
/* ── 펼친 카드의 제목 줄 채움 (2026-08-09 Q) ──
   '고른 행'(.wire-row[data-selected])이 쓰는 --gradient-action 면 + --on-action 글자를
   **펼친 카드의 제목 줄**이 그대로 빌린다. 제목 줄은 구조적으로 행이므로 D60 ④ 를 고칠 일이
   없다 — 카드는 여전히 --gradient-brand 아웃라인으로 활성을 알리고, 그 위에 행 어휘가 얹힌다.

   카드 **전체**를 채우지 않는 이유: 펼친 카드의 본문은 읽는 면이다. 회차 본문과 기록지
   아코디언 본문은 긴 글이라 파스텔 면 위에 앉으면 읽기가 나빠진다.

   **전면 적용이다(2026-08-28 Q "펼침 상단 바 그라데이션 모든 페이지 전체 적용" — 구
   브리핑 3영역·세션 목표 수정·일정 날짜 제외 폐지).** 구 제외 근거(open 기본값 카드는
   파스텔 띠가 상시로 선다)는 Q 가 화면을 보고 통일 쪽으로 기각했다. 예외는 하나만 남는다.
     * **위기·안전 아코디언**(.is-crisis)은 --risk 틴트·테두리를 갖는 자리다. 경고색 독점을
       지키려면 그 위에 다른 채움을 얹지 않는다(D9. 2026-08-28 Q 예외 승인).

   **채운 면 위 글자는 늘 --on-action 이다.** --gradient-action 은 두 테마에서 같은 밝은
   파스텔이라(tokens.css 다크 주석 ③) --ink 를 그대로 두면 다크에서 밝은 글자가 밝은 면에
   얹힌다. 제목 줄 안 조각들이 저마다 --ink·--sub 를 선언하고 있어 하나씩 덮는다.
   색상 배지는 계열 deep 면과 테마별 --on-badge 글자를 가진 독립 표면이라 같은 예외를 따른다. */
details.surface-card[open]>.record-summary,
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary{
  background:var(--gradient-action);
  color:var(--on-action);
}
details.surface-card[open]>.record-summary>.record-ordinal,
details.surface-card[open]>.record-summary>.record-held-at,
details.surface-card[open]>.record-summary>.record-one-liner,
details.surface-card[open]>.record-summary .record-flag{color:var(--on-action)}
/* 채운 면 위 배지 계약(2026-08-28 Q "수기 배지가 그라데이션에 묻힘" — 구 회차 유형
   mint·lavender 2종 한정을 대체): 색상 배지는 deep 글자 + --on-badge 면으로 뒤집고
   (base 를 글자로 쓰면 라이트 패널 위 대비 부족), **톤 없는 배지는 채운 면 전용
   선·글자로 선다**(--line-on-action·--on-action — 구 --line·--ink 가 그라데이션에
   묻히던 버그의 수정). deep 짝이 없는 변형 톤(coral·amber·lime·cyan·light-magenta)은
   불투명 단색 면이라 채운 면 위에서도 그대로 읽힌다. */
details.surface-card[open]>.record-summary .wire-badge[data-tone="mint"],
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-badge[data-tone="mint"]{--wire-outline-color:var(--mint-deep);background:var(--on-badge);color:var(--mint-deep)}
details.surface-card[open]>.record-summary .wire-badge[data-tone="lavender"],
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-badge[data-tone="lavender"]{--wire-outline-color:var(--lavender-deep);background:var(--on-badge);color:var(--lavender-deep)}
details.surface-card[open]>.record-summary .wire-badge[data-tone="blue"],
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-badge[data-tone="blue"]{--wire-outline-color:var(--blue-deep);background:var(--on-badge);color:var(--blue-deep)}
details.surface-card[open]>.record-summary .wire-badge[data-tone="risk"],
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-badge[data-tone="risk"]{--wire-outline-color:var(--risk);background:var(--on-badge);color:var(--risk)}
details.surface-card[open]>.record-summary .wire-badge:not([data-tone]),
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-badge:not([data-tone]){--wire-outline-color:var(--line-on-action);color:var(--on-action)}
/* 접힘 카드 제목 줄 안 조각들. 제목은 자기 색(--ink)을 갖고 있어 면만 채우면 회색 글자가
   파스텔 위에 남는다. 화살표는 원형 컨테이너라 면(--panel)이 대비를 만들고 테두리만 채운
   면 전용 선색으로 바꾼다. 메타 줄 세로선도 같은 계약(D56 --line-on-action)이다. */
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary>.wire-card-title{color:var(--on-action)}
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-card-arrow{border-color:var(--line-on-action)}
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .wire-meta-row>span+span{border-left-color:var(--line-on-action)}
/* 새로 편입된 일정 날짜 아코디언(2026-08-28)의 이름 목록·건수도 채운 면 글자다
   (--sub 를 스스로 선언한 두 조각. 제목 span 은 .wire-card-title 을 상속해 이미 맞다). */
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .schedule-day-names,
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary .schedule-day-count{color:var(--on-action)}
/* 카드는 패딩을 갖고 있어 제목 줄이 안쪽에 떠 있다 — 같은 값의 음수 마진으로 면을 아웃라인까지
   밀고 패딩으로 글자 자리를 되돌린다. 값은 --card-pad 에서 되읽으므로 카드가 패딩을 바꿔도
   따라온다(2026-08-09 — 구 손 계산 16/20 대체). 회차 카드(.record-summary)는 카드에 패딩이
   없어 이 보정이 필요 없다. */
.wire-card-details[open]:not(.is-crisis)>.wire-card-summary{
  margin:calc(var(--card-pad, var(--space-6)) * -1) calc(var(--card-pad, var(--space-6)) * -1) var(--card-pad, var(--space-6));
  padding:var(--card-pad, var(--space-6));
}
/* 셸: 새 앱 헤더가 올라가는 전 페이지 컨테이너. body 배경은 덮지 않고 이 래퍼에만 캔버스색. */
.wire-shell{min-height:100dvh;background:var(--canvas)}
/* 업무 바 필드는 시각 라벨 대신 이 접근성 라벨을 쓴다. absolute + clip-path라 레이아웃을
   차지하지 않지만 label의 이름 계산에는 남는다. */
.wire-toolbar-label{position:absolute;clip-path:inset(50%);white-space:nowrap}
/* GridContainer: 페이지 안의 **섹션 스택**이다. 장폭·좌우 여백은 갖지 않는다 —
   그건 .page-content(셸) 의 일이다(2026-07-26).
   이전에는 여기에 고정 거터 230px 이 박혀 있어 셸의 여백과 겹쳤고, 화면 폭이 바뀌면
   콘텐츠 컬럼만 제멋대로 늘었다 줄었다 했다. 폭 결정권을 한 곳으로 모은 결과 이 클래스는
   "세로 리듬"만 담당한다. width prop 은 호출부 호환을 위해 남아 있으나 폭을 정하지 않는다. */
.wire-container{width:100%;display:grid;gap:var(--section-gap);align-content:start}
.wire-container[data-grid="true"]{grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--space-5);row-gap:var(--space-5);align-items:stretch}
/* **나란한 카드는 그 줄에서 가장 높은 카드에 높이를 맞춘다**(2026-08-10 Q "나란히 2개 이상이면
   최대 펼침면에 높이 맞추기"). 격자 기본값이 이미 stretch 라 지금도 그렇게 그려지지만,
   **선언돼 있지 않아 계약이 아니었다** — 누가 align-items 를 건드리면 조용히 어긋나고,
   실제로 .card-grid 쪽은 이 일을 하려고 flex 두 줄을 따로 갖고 있었다. 여기 적어 둔다.
   카드가 칸을 채우도록 height 도 함께 준다: 칸(.wire-col-*)은 늘어나도 그 안의 카드는
   블록이라 내용 높이에 머문다.
   **접힌 아코디언은 이 규칙 밖이다**(2026-08-10 Q 확정 — 같은 날 "접혀 있어도 맞춘다"로
   바꿨다가 실물을 보고 되돌렸다. 접힘 카드가 요약 줄 72 대신 246 이 되어 174 가 빈 채로
   남았다). 높이를 맞추는 대상은 **읽는 자료 카드**이고, 접힘은 "지금 안 보겠다"는 상태라
   자리를 비운다. 규칙은 .briefing-cards-grid 가 갖는다(layout.tsx). */
.wire-container[data-grid="true"]>[class*="wire-col-"]{display:flex;flex-direction:column}
.wire-container[data-grid="true"]>[class*="wire-col-"]>.wire-card{flex:1 1 auto}
.wire-col-3{grid-column:span 3}
.wire-col-4{grid-column:span 4}
.wire-col-6{grid-column:span 6}
/* col-8 은 인테이크 위저드(단계 목록 4 + 본문 8)가 쓰는데 규칙이 없어 span 이 안 먹었다 —
   본문이 12분의 1 칸으로 떨어져 글줄이 몇 어절에서 끊겼다(2026-07-26 확인). */
.wire-col-8{grid-column:span 8}
.wire-col-9{grid-column:span 9}
/* ── 바로가기 목차 레일(2026-08-09) ── 상담 기록 작성·인테이크 작성·인테이크 조회 공용.
   기본 숨김이고 광폭 컨테이너(≥1150 — 장폭 1280 개정으로 생기는 자리)에서만 우측 열로
   선다. 모바일·태블릿·중폭 미표시는 Q 지시다. 트랙 정의(어느 열에 서나)는 화면 격자
   (.record-grid·.intake-grid·.intake-read-grid)가 갖고, 여기는 옷과 붙박이만 둔다.
   링크가 알약으로 서면 목차가 버튼 기둥이 되므로 문서 목차 문법의 텍스트 목록이다
   (D58 ⑥의 인라인 참조 축). */
.wire-toc-rail{display:none}
@container (min-width: 1150px){
  .wire-toc-rail{display:block;position:sticky;top:calc(var(--header-height) + var(--space-6));align-self:start}
}
.wire-toc-list{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-1-5);font-size:var(--text-sm)}
/* 두 층 목차(인테이크 조회): 부(部) 링크는 600 --ink, 소절은 들여쓴 --sub — 위계를 가른다. */
.wire-toc-list ol{margin:0;padding-left:var(--space-3);list-style:none;display:grid;gap:var(--space-1-5)}
.wire-toc-list a{font-size:var(--text-sm);font-weight:400;color:var(--sub);text-decoration:none;cursor:pointer}
.wire-toc-list a.wire-toc-part{font-weight:600;color:var(--ink)}
.wire-toc-list a:hover{color:var(--ink);text-decoration:underline}
.wire-toc-list a:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 목차 이동 시 대상 구획 머리가 스티키 헤더 아래로 숨지 않게 하는 전역 스크롤 여백. */
.page-content [id]{scroll-margin-top:calc(var(--header-height) + var(--space-4))}
.wire-col-12{grid-column:span 12}
/* 레일 격자는 레일, 본문, 광폭 목차 화면이 함께 쓴다. 인테이크와 상담 기록 작성이
   같은 레이아웃을 쓰도록 공용화했다. 기본 목록 gap은 20이고 레일과 본문은 서로 다른
   페이지 구획이므로 spacing v2의 --section-gap 32를 쓴다. 선택자 우선순위를 맞추려고
   .wire-container.rail-grid 두 클래스로 적는다. */
.wire-container.rail-grid{row-gap:var(--section-gap);column-gap:var(--section-gap)}
@media(max-width:767px){
  .wire-container[data-grid="true"]{grid-template-columns:1fr}
  /* col-8 이 이 목록에 빠져 있었다(CCC-76 실측) — 한 열 전환 후에도 span 8 이 남아 암묵
     8열이 생기고, 레일(col-4)이 본문(col-8)보다 좁게 그려졌다(744px 실측 572 vs 712). */
  .wire-col-3,.wire-col-4,.wire-col-6,.wire-col-8,.wire-col-9,.wire-col-12{grid-column:auto}
}
/* ── 레일 화면 폭 계단(2026-08-09 Q "일정 폭 이하에선 사이드바가 안 보이거나 상단으로") ──
   구 상태는 축이 둘로 갈려 있었다: 한 열 전환은 **뷰포트** 767, 3열 전환은 **컨테이너** 1150.
   그 사이에서 레일은 12칸 중 3~4칸이라 폭을 따라 계속 줄었고, 카드 패딩 24 를 빼면 글이
   설 자리가 사라졌다(실측: 뷰포트 1100 에서 레일 228·안쪽 165, 900 에서 162·안쪽 124 —
   제목 '이번 상담 목표'가 두 줄로 접혔다). 축을 컨테이너 하나로 모으고 레일에 **고정 트랙**을
   준다 — 레일은 설계 폭(--rail-width)에서 더 줄지 않고, 좁아지는 몫은 본문이 받는다.
   숨김이 아니라 상단 이동인 이유: 이 레일들은 장식이 아니라 기능이다(상담 기록은 나가기·저장
   버튼, 인테이크는 4단계 이동). 숨기면 화면이 못 쓰게 된다.
   880의 근거는 실측이다. 흔한 1280 창의 컨테이너에서도 레일 300, 간격 32, 본문이 함께 서고
   그보다 좁은 컨테이너에서는 한 열로 접는다.
   레일 폭은 화면이 --rail-width 로 정하고, 안 정하면 트랙 기본값 300 이 선다(기본값을 이
   규칙에 선언하지 않는 이유: 그러면 0-2-0 이 되어 화면의 한 클래스 선언이 조용히 지고,
   렌더는 멀쩡해 보이는데 폭만 틀린 상태가 된다 — 실제로 인테이크가 260 대신 300 으로 났다). */
.wire-container.rail-grid{grid-template-columns:minmax(0,1fr)}
@container (min-width: 880px){
  .wire-container.rail-grid{grid-template-columns:var(--rail-width, 300px) minmax(0,1fr)}
}
@container (min-width: 1150px){
  /* 목차가 셋째 열로 선다(.wire-toc-rail 이 자기 숨김·붙박이를 갖는다 — 그 아래 폭에서는
     display:none 이라 트랙을 차지하지 않는다). */
  .wire-container.rail-grid{grid-template-columns:var(--rail-width, 300px) minmax(0,1fr) 200px}
}
/* 카드-섹션 여백은 세 값이다:
     ① 페이지 세로 스택 = 32 (--section-gap)
     ② 같은 목록 안 카드 사이 = 20 (--space-5)
     ③ 행 카드 스택 = 12 (--space-3)
   카드 안 패딩은 24다. 화면 목록 클래스가 위 세 값만 쓰며 별도 유틸은 만들지 않는다. */
/* 카드 목록은 기본 폭 전체를 쓰고 --grid-min이 열을 만든다. 표준 420은 spacing v2 최대
   장폭에서 3열까지 열리고 컨테이너가 좁아지면 2열과 1열로 접힌다. 열 수는 직접 쓰지 않고
   빈 트랙을 남기지 않는 auto-fit을 사용한다. */
/* 나란한 카드는 높이를 맞춘다(2026-08-07 Q — 구 align-items:start 대체). 그리드 기본
   stretch 가 같은 줄 카드를 같은 높이로 편다. */
.card-grid{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr))}
.card-grid>.wire-card{display:flex;flex-direction:column}
.card-grid>.wire-card>.wire-card-body{flex:1 1 auto;display:flex;flex-direction:column;align-items:stretch}
/* 링크로 감싼 당사자 카드도 줄 높이를 다 쓴다 — 링크가 그리드 아이템이라 카드가 못 받는다. */
.card-grid>.participant-card-link>.participant-card{height:100%}
/* 조밀 그리드 — GAS 게이지·정보 필드처럼 작은 칸이 여럿일 때(D37 §4-2, 최소 280 → 3열).
   **3열 아니면 1열이다** — 2열이면 3개짜리 묶음(D33 세부 목표)이 둘 + 외톨이 하나로 앉는다. */
.card-grid-dense{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min-dense)),1fr));align-items:start}
@container (max-width:879px){.card-grid-dense{grid-template-columns:minmax(0,1fr)}}
/* (.list-toolbar 는 2026-08-23 D75 로 삭제 — 마지막 사용처였던 일정 화면 시간순 정렬
   토글이 통합에서 빠졌다. 날짜 묶음 제목이 순서를 이미 말한다.) */
/* 인라인 강조 링크. AppHeader(D35 로 폐기) 시절 클래스지만 관리자 사용자 상세가 계속 쓴다. */
.wire-header-link{font-size:var(--text-md);font-weight:600;color:var(--ink)}
.wire-header-link:hover{text-decoration:underline}
/* 이름 표기 (D59 · 2026-08-04): 화면 표기는 실명 하나 — 가명 ID 는 백엔드 전용이고,
   이름이 없는 두 경우(무응답·파기)에만 ID 가 이름 자리에 폴백으로 나온다.
   동명이인 구분은 전화번호가 맡는다(전체 번호, 자리는 화면이 정한다). */
.participant-name-group{display:inline-flex;align-items:baseline;gap:var(--space-1);flex-wrap:wrap}
.participant-name{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.participant-name-group[data-size="row"] .participant-name{font-size:var(--text-md);font-weight:600;line-height:var(--leading-tight);color:var(--ink)}
.participant-name-group[data-size="hero"] .participant-name,
.participant-name-group[data-size="hub"] .participant-name{font-size:var(--text-lg);font-weight:600;line-height:var(--leading-tight);color:var(--ink)}
/* ParticipantHeroCard (D38 · DESIGN.md §5): 당사자 중심 화면의 공통 머리.
   .page-header(flex) + .surface-card(카드 계약) 위에 안쪽 구조만 정한다.
   브리핑도 이 부품을 쓴다(2026-08-05 컴포넌트화 — 구 .briefing-hero 손 마크업 삭제). */
/* 기본 골격은 2행이다. 1행 = 이름·태그(좌) + 버튼(우), 구분선 아래 2행 = 연락처·메타.
   좁아지면 버튼 묶음이 통째로 이름 아래 줄로 내려간다. 767 이하는 내용 크기의 버튼을
   가로로 모아 자연스럽게 줄바꿈하고 카드 폭에 맞춰 늘리지 않는다. */
/* gap 24 = 세로 패딩과 같은 값 — 1행(이름)·2행(정보)이 아웃라인과 구분선 사이
   정중앙에 선다(2026-08-07 Q 9차, 구 16 은 위 24/아래 16 비대칭). */
.participant-hero-card{flex-direction:column;align-items:stretch;padding:var(--space-6);gap:var(--space-6)}
.participant-hero-top{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4) var(--space-5);flex-wrap:wrap;min-width:0}
.participant-hero-divider{height:0;margin:0 calc(var(--space-6) * -1);border:0;border-top:1px solid var(--line)}
.participant-hero-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-width:0;margin:0;font-size:var(--text-2xl);font-weight:600;line-height:var(--leading-tight);color:var(--ink)}
/* HERO 의 '상담 준비' 태그도 .wire-status-tag 하나를 쓴다(2026-08-07 통합 — 구
   .participant-hero-stage 는 같은 선언의 복사본이라 삭제. 알약·400 재개정은 2026-08-06 Q,
   레시피는 아래 .wire-status-tag 가 소유한다). 줄바꿈 금지만 HERO 한정으로 남긴다. */
.participant-hero-title .wire-status-tag{white-space:nowrap}
.participant-hero-meta{margin:0;color:var(--sub);font-size:var(--text-sm)}
.participant-hero-inline-item{display:inline-flex;align-items:baseline;gap:var(--space-3);white-space:nowrap}
/* 연락처는 읽는 값이라 당사자 카드 정보 칸과 같은 16/400 --sub 다. 가명 ID 는 화면 어디서나
   같은 조각이다(2026-08-26 Q "당사자와 일정의 ID 가 다르다" — 카드 칩과 같은 12/400 --sub,
   구 16/400 옅은 색 폐지). */
.participant-hero-contact{color:var(--sub);font-size:var(--text-md);font-weight:400;white-space:nowrap}
.participant-hero-id{color:var(--sub);font-size:var(--text-participant-id);font-weight:400;white-space:nowrap}
/* 767 이하도 이름 크기는 데스크톱과 같다(row 16, hero·hub 18. 2026-08-27 두 단 분리로
   구 '모바일 18 강제'가 무의미해짐). 정보와 메타는 설명 단으로 정리한다. */
@media(max-width:767px){
  .participant-hero-title{gap:var(--space-2);font-size:var(--text-lg);font-weight:600;line-height:var(--leading-normal)}
  .participant-hero-contact{color:var(--sub);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal)}
  .participant-hero-meta .wire-meta-row{flex-direction:column;align-items:flex-start;gap:var(--space-1)}
  .participant-hero-meta .wire-meta-row>span+span{border-left:0;padding-left:0}
}
/* 목록 아래 안내 한 줄. 본문 흐름의 보조 정보라 14/400 --sub 다. */
.note-inline{color:var(--sub);font-size:var(--text-sm)}
.note-inline a{font-size:var(--text-sm);color:var(--blue-deep);font-weight:600;text-decoration:underline}
/* 일정·당사자 목록의 한 줄 업무 도구. 페이지 제목과 행동을 다시 나누지 않고 검색·기간
   조작·등록을 한 면에 묶는다. 그림자는 없고 카드 안 카드를 만들지 않는다. */
.work-toolbar{padding:var(--space-3);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel)}
/* 모든 글자 버튼은 알약이다(2026-08-25 Q). 이 업무 바의 검색·선택창은 사각 6,
   화살표 전용 링크는 면 없는 고정 슬롯을 유지한다. */
/* 당사자 목록 — 찾기 칸 + 행동 버튼 + 행 목록. 행은 gap 그리드에 낱개로 놓이므로 카드
   계약을 쓴다(DESIGN.md §5 '리스트 행' — 낱개는 카드, 붙어 있으면 구분선). */
.participant-search-layout{display:grid;gap:var(--space-5)}
.participant-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)}
.participant-toolbar-search{flex:1 1 360px;max-width:540px;min-width:0;padding:0 var(--space-2)}
.participant-toolbar .participant-toolbar-search{min-height:var(--pill-height)}
.participant-toolbar-actions{display:flex;align-items:center;gap:var(--space-2);flex:none}
@media(max-width:767px){
  .participant-toolbar{flex-wrap:wrap}
  .participant-toolbar-search{flex-basis:100%;max-width:none}
  .participant-toolbar-actions{width:auto;margin-left:auto;flex-wrap:wrap}
  .participant-toolbar-actions>.wire-button{flex:none}
}
/* 당사자 행도 카드다 — 수가 늘면 열이 갈린다(2026-07-26 Q 지시). */
.participant-row-list{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));align-items:stretch}
.participant-row-list>div,.participant-row-list>div>.participant-card-link,.participant-row-list>div>.participant-card-link>.participant-card{height:100%}
/* 당사자 정보 허브 (D35 §3 · D36 · 2026-08-06 Q 개편). 사업별 낱개 카드를 걷고
   '참여중인 사업'·'최신 일정' 두 카드(WireCard)가 나란히 선다. 사업은 카드 안 **행**이고
   행 사이는 --line 구분선이다(카드 안 카드 금지 — D59 ③). 동의서는 맨 아래 카드로 옮겼다. */
/* 카드 경계 프로토타입의 strong 안을 이 화면에 적용한다. 선 굵기와 구조는 그대로 두고
   패널 대비만 높여 그림자 없이도 카드 범위가 또렷하게 읽히게 한다. */
.participant-hub-card>.wire-card-divider{display:none}
.participant-hub-card>.wire-card-body{margin-top:var(--space-5)}
/* 허브 카드 3장(참여중인 사업·최신 일정·동의서)의 제목은 18 이다(2026-08-07 Q 8차
   "폰트 크기 2px 키우기". 전역 카드 제목 16 위의 이 화면 예외로, 섹션 역할의 전폭
   카드라 섹션 제목 단(--text-lg)을 쓴다). */
.participant-hub-card>.wire-card-title{font-size:var(--text-lg)}
.participant-program-row{display:grid;gap:var(--space-2);min-width:0}
/* 행 구분선 위아래 12/12 — 위 간격은 카드 본문 gap(12)이 주므로 패딩도 12 로 맞춘다(9차). */
.participant-program-row+.participant-program-row{padding-top:var(--space-3);border-top:1px solid var(--line)}
/* 행 제목은 카드 제목(18)보다 한 단 아래 16 이다. 배지는 제목과 같은 y 세로 중앙이다
   (2026-08-07 Q "뱃지를 제목과 같은 y값에 가운데 정렬" — 구 flex-start 는 배지가 위로 붙었다). */
.participant-program-head{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);min-width:0}
.participant-program-head-main{display:flex;align-items:center;gap:var(--space-2);min-width:0;flex:1 1 0;flex-wrap:nowrap}
.participant-program-head-main>h3{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.participant-program-head>.wire-button{flex:none}
/* 사업명 리스트 항목은 400 이다(2026-08-07 Q 8차, 리스트업이지 제목이 아니다). 동의서
   카드의 사업명 묶음 머리(.participant-consent-program)는 저장 버튼을 거느린 구획 제목이라
   600 을 유지한다. */
.participant-program-row .participant-program-head-main>h3{font-weight:400}
/* 배지는 줄바꿈하지 않는다 — 사업명이 길면 "진행/중" 으로 쪼개져 읽힌다. */
.participant-program-head-main .wire-badge{flex:none;white-space:nowrap}
.participant-program-meta{margin:0;color:var(--sub);font-size:var(--text-sm)}
.participant-program-assignee{display:flex;gap:var(--space-2);align-items:baseline;font-size:var(--text-sm);color:var(--ink)}
.participant-program-assignee-label{font-size:var(--text-sm);color:var(--mint-deep);font-weight:600}
/* 구 .participant-program-actions(카드 하단 버튼 줄)는 2026-08-07 가로 행 개편으로 삭제 —
   버튼은 일정 행의 오른쪽 끝(margin-left:auto)에 선다. */
/* 구 .participant-program-locked(담당하지 않는 사업 잠금 문구)는 2026-08-07 사업명
   리스트업 단순화로 삭제 — 행에 버튼이 없어져 잠금을 설명할 대상도 없다. */
/* 동의 2종 수정(D44 · 항목 수는 D49). 등록 폼의 consent-fieldset 를 그대로 재사용하고 카드 안 간격만 준다. */
.participant-program-consent{min-width:0;max-width:100%;margin-top:0}
.participant-consent-nowrap{white-space:nowrap}
.participant-program-consent-meta{margin:var(--space-2) 0 var(--space-3);color:var(--sub);font-size:var(--text-sm)}
/* 동의서 카드 안 사업별 묶음 — 사업이 여럿일 때만 머리(사업명)가 선다. 묶음 사이는
   --line 구분선, 묶음 안 fieldset 의 자체 윗선은 끈다(카드 제목 구분선과 겹쳐 이중선이 된다). */
.participant-consent-block{display:grid;gap:var(--space-2)}
/* 위 12(본문 gap)/아래 12(패딩) — 구분선 중심 대칭(9차, .participant-program-row 와 같은 계약). */
.participant-consent-block+.participant-consent-block{padding-top:var(--space-3);border-top:1px solid var(--line)}
.participant-consent-block .consent-fieldset{border-top:0;padding-top:0}
.participant-consent-program{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
/* 목표 트리 (D62 §8 · CCC-69) — 목표는 사람·소속·진행 축이 아니므로 구획 라벨은
   14/600 neutral, 값은 16/400 --ink로 둔다. 케이스 구획 사이는 --line 구분선이다. */
.goal-tree-case{display:grid;gap:var(--space-4)}
.goal-tree-case+.goal-tree-case{padding-top:var(--space-3);border-top:1px solid var(--line)}
.goal-tree-case-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.goal-tree-section{display:grid;gap:var(--space-2)}
.goal-tree-label{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.goal-tree-overall{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.goal-tree-overall-text{font-size:var(--text-md);line-height:normal;color:var(--ink)}
.goal-tree-overall-text.is-empty{color:var(--sub)}
/* 세부 목표는 여럿이 나란히 서는 형제 목록이다 — 2026-08-09 Q "위계나 정리 없이 막 나열된
   경향이 크다, 앞에 구분자를 넣어 달라". 구분자는 새로 만들지 않고 §5 불릿 목록 부품
   (.wire-bullets — 6px 원형 --sub 점 + 들여쓰기 16)을 목록에 얹는다. 항목이 2개 이상일 때만
   얹는 것도 그 부품의 규칙이라(2026-08-07) 클래스를 붙이는 쪽에서 가른다 — 한 항목뿐이면
   목록이 아니라 문장이다. 글자 단은 그대로 ③ 값·본문(16/400 --ink)이라 §2-2 위계 4단에
   다섯 번째 단이 생기지 않는다. */
.goal-tree-goals{display:grid;gap:var(--space-4);margin:0;padding:0;list-style:none}
/* 불릿 목록 기본 간격은 8 인데 여기는 16 이다(클래스 둘 0-2-0 — .wire-bullets 가 이 파일
   뒤쪽이라 한 클래스끼리는 그쪽이 이긴다): 세부 목표마다 세션 목표 가지가 매달려 있어,
   8 이면 옆 목표의 가지와 자기 제목이 같은 간격으로 붙어 어디까지가 한 목표인지 흐려진다. */
.goal-tree-goals.wire-bullets{gap:var(--space-4)}
.goal-tree-goal{display:grid;gap:var(--space-2)}
.goal-tree-goal-details>summary{cursor:pointer;list-style:none}
.goal-tree-goal-details>summary::-webkit-details-marker{display:none}
.goal-tree-goal-head{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.goal-tree-goal-body{display:grid;gap:var(--space-2);padding-top:var(--space-2)}
.goal-tree-goal-title{font-size:var(--text-md);line-height:normal;color:var(--ink)}
/* 닫힌 목표는 흐리게 — 기록으로 남기되 활성과 한눈에 갈린다(D62 §5). 사유는 배지가 말한다. */
.goal-tree-goal.is-closed .goal-tree-goal-title{font-weight:400;color:var(--sub)}
.goal-tree-goal-head .wire-badge{flex:none;white-space:nowrap}
/* 세션 목표는 세부 목표 아래 들여쓴 가지다 — 회기 시각 · 문구. 왼쪽 --line 세로선이
   소속을 만든다(트리의 가지 표시. 그라데이션 세로선은 인용 전용이라 쓰지 않는다 — §5). */
.goal-tree-session-rows{display:grid;gap:var(--space-2);margin:0;padding-left:var(--space-4);border-left:1px solid var(--line);list-style:none}
/* 한 줄 = [날짜][문장][상태]. 날짜·상태는 줄지 않고 문장만 자기 칸 안에서 접힌다 — 구
   MetaRow 한 줄은 문장이 접힐 때 조각 구분 세로선이 본문 앞 막대로 남았다(2026-08-09 Q 보고).
   접힌 둘째 줄이 문장 시작선에 맞으므로 날짜 칸이 그대로 눈금 역할을 한다. */
.goal-tree-session-row,.goal-tree-linked-session{display:flex;align-items:baseline;gap:var(--space-3);font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal);color:var(--sub)}
/* 날짜는 메타 단이다(브리핑 회차 날짜 .briefing-session-date 와 같은 계약 — 14/400 --sub
   + tabular + line-height normal). 구 --blue-deep 600(2026-08-09 "컬러로 구분")은 deep 을
   라벨 축 밖 본문 날짜에 쓴 계단 밖 조합이라 폐지했다(2026-08-28 Q). 이력 아코디언 안
   시각은 원래부터 메타 줄이라 그대로다. */
.goal-tree-session-date{flex:none;font-size:var(--text-sm);font-weight:400;line-height:normal;color:var(--sub);font-variant-numeric:tabular-nums}
.goal-tree-session-body{min-width:0}
/* 문구 이력(D62 §4) — 기본 숨김, '이력 보기'로만 연다. 요약은 처리 이력(.briefing-history)과
   같은 14/600 --sub 어휘로 목표 문구와 같은 줄 오른쪽에 서고, 펼친 이력은 줄을 통째로 쓴다.
   details 가 상자를 버리고(display:contents) 자식을 그대로 flex 줄에 내놓는 동의 '전문 보기'
   패턴이다. 전폭 규칙이 둘인 이유도 같다: 요즘 브라우저는 비-summary 자식을 ::details-content
   상자로 감싸므로 그 상자가 flex 항목이고, 없는 브라우저에서는 목록 자신이 flex 항목이다. */
.goal-tree-history{display:contents}
.goal-tree-history>summary{cursor:pointer;font-size:var(--text-sm);font-weight:600;color:var(--sub);line-height:normal}
.goal-tree-history::details-content{flex-basis:100%;min-width:0}
.wire-timeline{list-style:none;margin:var(--space-1) 0 0;padding:0;display:grid;gap:var(--space-4)}
.wire-timeline-item{position:relative;display:grid;gap:var(--space-1);padding-left:var(--space-5)}
.wire-timeline-item::before{content:"";position:absolute;left:0;top:5px;width:7px;height:7px;background:var(--ink)}
.wire-timeline-item::after{content:"";position:absolute;left:3px;top:18px;bottom:-14px;width:1px;background:var(--line)}
.wire-timeline-item:last-child::after{display:none}
/* CCC-81 단계 표시 부품 — 진행 상태는 블루 축(D34), 현재=채움·완료=tint·대기=무채색. */
.wire-steps{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-5);align-items:center}
.wire-step{display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm)}
.wire-step-marker{display:grid;place-items:center;min-width:20px;height:20px;padding:0 var(--space-1);border-radius:var(--radius-control);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-step-current .wire-step-marker{background:var(--blue);color:var(--on-action)}
.wire-step-done .wire-step-marker{background:var(--blue-tint);color:var(--blue-deep)}
.wire-step-upcoming{font-size:var(--text-sm);font-weight:400;color:var(--sub)}
.wire-step-upcoming .wire-step-marker{background:var(--panel);color:var(--sub);font-weight:400}
/* CCC-81 표 부품: 라벨 고정폭 + 값이 유연한 정의 목록 2열 — 세로 적층 눌린 쌓임의 대안. */
.wire-data-rows{display:grid;margin:0;gap:0;border-top:1px solid var(--line)}
.wire-data-row{display:grid;grid-template-columns:minmax(160px,260px) minmax(0,1fr);gap:var(--space-3);border-bottom:1px solid var(--line);padding:var(--space-2) 0}
.wire-data-row>dt{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-data-row>dd{margin:0;font-size:var(--text-md);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:767px){.wire-data-row{grid-template-columns:1fr;gap:var(--space-1)}}
/* 펼치면 확정 문구(16)와 메타 줄(최초 작성/수정 · 수정자 · 시각)이 최신부터 쌓인다. */
.goal-tree-history{display:contents}
.goal-tree-history-row{display:grid;gap:var(--space-1)}
.goal-tree-history-title{margin:0;font-size:var(--text-md);color:var(--ink)}
.goal-tree-history-meta{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 최신 일정 카드 행동은 제목 줄 오른쪽에 한 행으로 묶는다. */
.participant-next-schedule-actions{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-3);flex-wrap:wrap}
@media(max-width:767px){
  .participant-hub-card .wire-card-head{flex-wrap:wrap}
  .participant-next-schedule-actions{width:auto;justify-content:flex-start;flex-wrap:wrap}
}
/* 일정 내용은 회차별 정리 행과 같은 어휘다: 날짜, 종류 배지, 참여 사업.
   빈 상태도 같은 행 높이를 유지한다. */
.participant-next-schedule-row{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-height:var(--control-height)}
.participant-next-schedule-date,.participant-next-schedule-program{font-size:var(--text-md);line-height:normal;color:var(--ink)}
.participant-next-schedule-program{white-space:nowrap}
/* 행 전체가 브리핑 링크다(2026-08-08 Q — 구 '상담 준비' 버튼 대체). 격자 좌 1fr / 우
   auto: 내용은 좁으면 줄바꿈하되 꺽쇠는 **행 전체의 세로 중앙**에 남는다("가운데 정렬").
   여러 행이면 --line 가로선으로 갈리고 상하 12 씩 눌러 클릭 면을 벌린다. 호버는 면 호버
   tint 쌍(D60 ④ — 행 배경 --muted). */
/* 좌우 -12 는 사이드바 알약과 같은 트릭 — 호버 면을 글자 밖까지 벌리되 글자는 카드
   좌측선(24)에 남긴다. */
.participant-next-schedule-link{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--space-3);padding:var(--space-3);margin-inline:calc(var(--space-3) * -1);color:inherit;text-decoration:none;border-radius:var(--radius-control)}
.participant-next-schedule-main{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-width:0}
.participant-next-schedule-link+.participant-next-schedule-link{border-top:1px solid var(--line)}
@media (hover:hover){.participant-next-schedule-link:hover{background:var(--muted)}}
/* ListRow (§5 리스트 행): 패딩 16/24 · 호버 --muted.
   화면들이 행을 gap 으로 띄운 그리드에 낱개로 놓으므로, 행 사이 구분선 대신 카드 표면을 쓴다
   (구분선 계약은 행이 한 컨테이너 안에 붙어 있을 때 성립한다 — 이 차이는 STATUS 에 남긴다).
   호버·선택은 --surface-fill 만 바꾼다: background 를 덮으면 그라데이션 테두리가 사라진다. */
.wire-row{display:flex;align-items:center;gap:var(--space-3);width:100%;min-height:72px;padding:var(--space-4) var(--space-6);font-size:var(--text-md);font-weight:600;text-align:left;cursor:pointer}
button.wire-row{font:inherit;font-size:var(--text-md);font-weight:600}
/* 호버도 그라데이션이다(2026-08-03 Q 결정 — 구 --muted 단색). 채움만 바꾸므로 실제 테두리
   (--line 1px)는 그대로다. 선택 행은 더 진한 --gradient-action 이라 구분된다. 터치 잔상은
   버튼과 같은 이유로 hover 미디어 안에 둔다. */
@media (hover:hover){
  .wire-row:not([data-static="true"]):not([data-selected="true"]):hover{background:var(--gradient-hover)}
  /* 행 안 메타 줄 세로선은 호버 채움 위에서 카드 표면색으로 뒤집는다(2026-08-07 Q "호버 시
     세로선 화이트" — 당사자 카드 구분선과 같은 계약). 다크는 더 밝은 --line-control. */
  .wire-row:not([data-static="true"]):not([data-selected="true"]):hover .wire-meta-row>span+span{border-left-color:var(--panel)}
  [data-theme="dark"] .wire-row:not([data-static="true"]):not([data-selected="true"]):hover .wire-meta-row>span+span{border-left-color:var(--line-control)}
}
.wire-row[data-static="true"]{cursor:default}
/* 고른 행(--gradient-action 면) 위 세로선은 채운 면 전용 선색을 쓴다(D56 --line-on-action). */
.wire-row[data-selected="true"] .wire-meta-row>span+span{border-left-color:var(--line-on-action)}
/* 고른 행도 **채운다**(2026-07-31 Q 지시 "리스트도 채운다"). 체크박스 켬과 같은
   --gradient-action 이라, 화면 어디서든 '내가 지금 고른 것'이 한 어휘로 읽힌다.
   구 --muted(#F5F5F4)는 패널 위에서 호버와 같은 색이라 고른 것인지 지나가는 중인지
   구분되지 않았다 — 실제로 아래 :hover 규칙이 같은 값을 쓴다.
   background 를 직접 쓰되 **테두리 그라데이션을 살려야 하므로 배경 2겹을 유지한다**
   (--surface-fill 변수로는 못 한다: linear-gradient() 의 색 자리에 그라데이션을 넣을 수 없다).
   호버가 이 규칙을 덮지 못하는 것도 의도다 — 이미 고른 행에 지나가는 중 표시가 겹칠 이유가 없다. */
.wire-row[data-selected="true"]{background:var(--gradient-action) padding-box,var(--gradient-brand) border-box;color:var(--on-action)}
.wire-row[data-align="center"]{justify-content:center;text-align:center}
.wire-row-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.wire-row[data-align="center"] .wire-row-text{flex:0 1 auto}
/* 꺽쇠(>) 한 벌 — 2026-08-10 Q "버튼과 listrow, 체브론 맞추기". **배수를 맞추는 것이지
   픽셀을 맞추는 것이 아니다**(같은 날 Q: 꺽쇠는 폰트 크기를 따라가야 하고, 글자에 붙어 있는
   자리는 특히 그렇다). 어긋나 있던 것은 배수가 넷이었다는 것이다 — .625 ListRow · .5625 카드 ·
   .5333 핵심 버튼 · .5 조작 버튼. 이제 --chevron-box 하나를 전부가 본다.
   광학 보정(translate)은 상자의 1/5 이다 — 회전한 사각형이라 잉크 중심이 기하 중심에서
   벗어나고, 상자가 커지면 그 어긋남도 같은 비율로 커진다. */
.wire-chevron{flex:none;width:var(--chevron-box);height:var(--chevron-box);border-right:var(--chevron-stroke) solid var(--sub);border-bottom:var(--chevron-stroke) solid var(--sub)}
.wire-chevron[data-dir="down"]{transform:translateY(calc(var(--chevron-box) / -5)) rotate(45deg)}
.wire-chevron[data-dir="right"]{transform:translateX(calc(var(--chevron-box) / -5)) rotate(-45deg)}
.wire-chevron[data-dir="left"]{transform:translateX(calc(var(--chevron-box) / 5)) rotate(135deg)}
/* WireCard (§5 카드): 헤더/본문을 회색 --line 1px 풀블리드 선으로 나눈다(2026-08-06 Q). */
/* --card-pad 는 이 카드의 사방 패딩이다. 변수로 두는 이유는 **풀블리드 조각들이 그 값을
   되읽어야 하기 때문**이다(펼친 제목 줄의 음수 마진). 예전에는 그 음수 값을 손으로 적어
   두고 주석에 "패딩을 바꾸면 여기도 고쳐라"라고 써 뒀는데, 패딩이 다른 카드(위기·안전)가
   생기자마자 어긋났다. 패딩을 바꾸는 카드는 --card-pad 만 덮으면 된다.
   커스텀 속성은 자식에게 상속되지만 **카드마다 이 줄에서 다시 선언하므로** 카드 안 카드도
   제 값을 읽는다. 되읽는 쪽에 폴백(var(--card-pad, var(--space-6)))을 다는 것은 .wire-card
   바깥에서 같은 규칙이 걸리는 경우의 안전판이다(--divider-gap 과 같은 문법). */
.wire-card{--card-pad:var(--space-6);padding:var(--card-pad)}
/* 카드 제목은 16/600 이다(2026-08-07 Q "wire-card-title 폰트 크기 줄일 것" — 구 18 대체.
   18 은 카드 여러 장을 묶는 섹션 제목(h2, .record-section-title 류)의 몫으로 올라간다). */
.wire-card-title{margin:0;font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug);color:var(--ink)}
/* 제목 슬롯에 시맨틱 헤딩(h2 카드 제목·h3 소절 제목)이 들어와도 크기는 카드 제목 계약을
   따른다 — UA 기본 크기가 새지 않게 한다(인테이크 소절 2026-08-05, h2 는 2026-08-07
   기본정보 수정의 카드 안 두 번째 구획 제목에서 추가). */
.wire-card-title>h2,.wire-card-title>h3{margin:0;font-size:inherit;font-weight:inherit;line-height:inherit}
/* 구분선은 회색 --line 이고 카드 아웃라인까지 가로지른다(2026-08-06 Q — 구 그라데이션
   안쪽 구분선 대체. 그라데이션 3색은 구조선이 아니라 정보 표시로 옮겨 간다).
   세로 여백은 **카드의 세로 패딩과 같게** 맞춰 각 구획이 아웃라인과 가로선의 정중앙에
   선다(2026-08-07 Q 9차 "가로선 기준 위아래 정렬" — 구 16 고정은 위 24/아래 16 로
   비대칭이었다). 세로 패딩이 24 가 아닌 카드는 --divider-gap 으로 제 패딩을 알린다. */
.wire-card-divider{height:0;margin:var(--divider-gap,var(--space-6)) calc(var(--space-6) * -1);border:0;border-top:1px solid var(--line)}
.wire-card-body{display:grid;gap:var(--space-3)}
/* WireCardDetails — 접힘 카드(2026-08-05 카드화 · ADR-0030, 구 브리핑 플랫 아코디언).
   접힌 상태 = 제목 줄만 남은 회색 카드, 펼친 상태 = 활성이라 .surface-card[open] 의
   그라데이션 테두리를 그대로 받는다(D47 회차 카드와 같은 어휘).
   제목 아래 그라데이션 1px 은 WireCard 의 구분선과 같은 선인데, 접혀 있으면 본문이 없어
   선도 없다 — 카드 바닥에 선만 남는 모양을 막는다. */
.wire-card-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);cursor:pointer;list-style:none}
/* 접힌 카드에서는 보이는 카드 면 전체가 summary 클릭 영역이다. 카드 padding 안쪽의 제목만
   눌리던 구 계약은 일정 날짜 카드에서 22px짜리 표적을 만들었다(2026-08-25 시각 QA). */
.wire-card-details:not([open])>.wire-card-summary{margin:calc(var(--card-pad, var(--space-6)) * -1);padding:var(--card-pad, var(--space-6))}
/* details 는 모서리 채움을 자르기 위해 overflow:clip 을 쓴다. 포커스 링은 안쪽으로 넣어
   좌우 2px가 잘리지 않게 한다. */
details.surface-card>.wire-card-summary:focus-visible{outline-offset:-2px}
.wire-card-summary::-webkit-details-marker{display:none}
.wire-card-summary-right{display:flex;align-items:center;gap:var(--space-4)}
/* 아코디언 화살표 어휘(2026-08-27 Q): 닫힘 = 아래 꺽쇠("펼칠 수 있음"), 펼침 = 위 꺽쇠.
   오른쪽 꺽쇠는 **페이지 이동 전용**이라 아코디언에 쓰지 않는다(구 닫힘 오른쪽이 이동
   링크와 혼동을 만들던 것을 대체). **모양은 원형 컨테이너 하나다**(2026-08-28 Q "버튼화
   통일" — 구 맨 꺽쇠 기본형 + 일정 전용 원형 변형 2벌을 이 기본형이 대체). summary 전체가
   클릭 영역이고 원은 상태 표시라 버튼을 중첩하지 않는다. 모션도 토큰 한 쌍
   (--motion-fast·--ease-standard)이다 — 구 하드코딩 .15s ease 폐지. optical: 꺽쇠 잉크는
   회전 때문에 상자 중앙에서 벗어난다. translate 로 되민다(.wire-chevron 과 같은 보정 계약). */
.wire-card-arrow{flex:none;display:inline-grid;place-items:center;vertical-align:middle;line-height:normal;width:var(--pill-height);height:var(--pill-height);border:var(--wire-outline-width) solid var(--wire-outline-color);border-radius:var(--radius-pill);background:var(--panel)}
.wire-card-arrow::before{content:"";width:var(--chevron-box);height:var(--chevron-box);border-right:var(--chevron-stroke) solid var(--sub);border-bottom:var(--chevron-stroke) solid var(--sub);transform:translateY(calc(var(--chevron-box) / -5)) rotate(45deg);transition:transform var(--motion-fast) var(--ease-standard)}
/* 펼침 = 위. 셀렉터를 details[open] 제네릭으로 두어 WireCardDetails·동의 전문·목표 트리
   같은 모든 아코디언이 한 규칙을 본다. 회전은 컨테이너가 아니라 꺽쇠 잉크(::before)만 한다. */
details[open]>summary .wire-card-arrow::before{transform:translateY(calc(var(--chevron-box) / 5)) rotate(-135deg)}
/* 화살표 있는 summary 는 네이티브 마커를 숨기고, 화살표와 옆 항목·텍스트의 간격을 한 값으로
   갖는다(2026-08-28 Q "여백 동일하게, 조금 더 넉넉하게" — 행 안 간격 16). 플레인 텍스트
   summary(이력 보기·근거 인용 류)도 flex 로 세워 같은 간격 계약을 받는다. */
summary:has(.wire-card-arrow){display:flex;align-items:center;gap:var(--space-4);list-style:none}
summary:has(.wire-card-arrow)::-webkit-details-marker{display:none}
/* 펼친 제목 밑 구분선도 회색 풀블리드다(2026-08-06 Q — .wire-card-divider 와 같은 선). */
.wire-card-details[open]>.wire-card-summary{margin:0 calc(var(--card-pad, var(--space-6)) * -1) var(--card-pad, var(--space-6));padding:0 var(--card-pad, var(--space-6)) var(--card-pad, var(--space-6));border-bottom:1px solid var(--line)}
/* 제목과 상태 배지·행동이 함께 오는 카드 헤더. 배지는 줄바꿈하지 않는다(사업명 카드와 같은
   이유). 세로는 제목과 같은 y 가운데 정렬이다(2026-08-07 Q — 구 flex-start 대체). */
.wire-card-head{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4)}
.wire-card-head .wire-badge{flex:none;white-space:nowrap}
/* 카드 안 하위 구획(WireCardSection). h3 에 규칙이 없어 브라우저 기본 크기(18.7px)가 그대로
   나오던 자리다. 카드 제목과 크기가 겹쳐 위계가 없었다. 구획 제목은 라벨이므로 14/600 이다.
   2026-08-10: 선언만 있고 쓰인 곳이 0 이던 이 계약을 부품으로 살렸다(wire-section.tsx).
   같은 레시피를 화면이 자기 이름으로 베껴 쓰던 두 벌(.briefing-qlabel · .record-block>h3)이
   있었고, 그중 형제 사이 구분선을 가진 것은 브리핑 한 벌뿐이라 같은 모양의 구획이 화면마다
   §2-2 규칙 2 를 지키기도 안 지키기도 했다. */
.wire-card-section{display:grid;gap:var(--space-2)}
/* **형제 구획이 이어지면 구분선이 자동으로 붙는다**(§2-2 규칙 2ⓐ). 화면이 판단하지 않는다.
   전폭이 아니라 안쪽 선이다 — 카드를 가로지르는 풀블리드 선(.wire-card-divider)은 카드의
   머리·본문을 가르는 어휘이고, 여기는 본문 안에서 구획을 가르는 한 단 아래다. */
.wire-card-section+.wire-card-section{padding-top:var(--space-4);border-top:1px solid var(--line)}
.wire-card-section>h3,.wire-card-section-head>h3{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-card-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)}
.wire-card-section-head>.wire-button{flex:none}
/* 라벨 계열 색(D34 고정 의미) — 기본은 무채색이고, 축이 분명한 구획만 계열을 입는다. */
.wire-card-section[data-tone="mint"]>h3,.wire-card-section[data-tone="mint"]>.wire-card-section-head>h3{color:var(--mint-deep)}
.wire-card-section[data-tone="lavender"]>h3,.wire-card-section[data-tone="lavender"]>.wire-card-section-head>h3{color:var(--lavender-deep)}
.wire-card-section[data-tone="discrepancy"]>h3,.wire-card-section[data-tone="discrepancy"]>.wire-card-section-head>h3{color:var(--discrepancy)}
/* 구획은 **안에 들어오는 것의 크기·색·여백을 정하지 않는다**(2026-08-10 — 구 자식 규칙
   (>p, >ul) 폐지). 자식 선택자(0,1,1)는 부품 클래스(0,1,0)를 특정도에서 이기므로, 그 규칙이
   있으면 구획에 들어온 부품이 자기 계약을 잃는다. 실제로 빈 줄(.empty 14/--sub)이 16/--ink 로
   커지고 목록 간격이 12 에서 8 로 줄어드는 자리가 있었다. 구획이 갖는 것은 넷뿐이다:
   세로 리듬 · 라벨 계약 · 계열 색 · 형제 구분선. */
/* 한 항목(WireItem) — 제목·설명·상태·행동을 위계 4단 안에서만 조립한다. 톤을 주면 tint 면이
   붙고, 안 주면 면 없이 줄만 선다. 크기·굵기·색을 바깥에서 정하는 길은 부품에 없다. */
.wire-item{display:grid;gap:var(--space-1)}
.wire-item[data-tone]{padding:var(--space-3) var(--space-4);border-radius:var(--radius-control)}
.wire-item[data-tone="mint"]{background:var(--mint-tint)}
.wire-item[data-tone="lavender"]{background:var(--lavender-tint)}
.wire-item-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.wire-item-desc{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 구획(WireCardSection) 안에 WireItem 없이 바로 오는 읽는 값(§2-2 위계 4단 ③ 16/400
   --ink). 구획은 자식 규칙을 갖지 않으므로(위 §2-2 안내 참고) 화면이 이 클래스로 직접
   계약을 받는다 — 전역 p 규칙(margin 위 8 + --sub, layout.tsx)을 그대로 쓰면 라벨과의
   간격이 구획 grid gap(8) 과 겹쳐 16 이 되고 색도 --sub 로 묻힌다(2026-08-19 CCC-100 검수). */
.wire-section-value{margin:0;color:var(--ink)}
.wire-item-status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2)}
/* 행동 줄은 제목과 같은 소리를 내면 안 된다. 14/600 계열 색 밑줄은 이 앱의 인라인 링크
   어휘 그대로다(.note-inline a · .wire-form-hint a). deep 색은 14 이상·600 에서만 쓴다(§9). */
.wire-item-action{justify-self:start}
.wire-item-action>a:not(.wire-button){font-size:var(--text-sm);font-weight:600;color:var(--blue-deep);text-decoration:underline}
/* 정보 필드: 라벨 14/600 + 값 16/400. 글자 크기가 달라도 베이스라인이 아니라 가운데를 맞춘다. */
.wire-field-row{display:grid;grid-template-columns:80px minmax(0,1fr);gap:var(--space-3);align-items:center}
.wire-field-row[data-compact="true"]{gap:var(--space-2-5)}
.wire-field-row[data-layout="stack"]{grid-template-columns:minmax(0,1fr);gap:var(--space-1);align-items:start}
/* margin 0 은 이 라벨이 격자 밖 한 줄(전체 목표 카드의 라벨처럼 p 로 서는 자리)에서도 같은
   레시피를 쓰게 한다 — 전역 p 규칙의 위 여백 8 이 붙으면 같은 라벨이 자리마다 달라진다. */
.wire-field-label{margin:0;color:var(--mint-deep);font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal)}
/* sub 톤 라벨은 400 이다(2026-08-23 Q) — 14/400 --sub 메타·설명 단. 이름 18/600 이 위계를
   이미 만들어 라벨 굵기가 물러선다. 기본(민트 deep) 라벨은 600 그대로다(§9 deep 은 600에서만). */
.wire-field-row[data-tone="sub"]>.wire-field-label{color:var(--sub);font-weight:400}
.wire-field-value{min-width:0;color:var(--ink);font-size:var(--text-md);font-weight:400;line-height:var(--leading-normal);overflow-wrap:anywhere}
.wire-field-row[data-truncate="true"]>.wire-field-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* size sm: 값을 라벨과 같은 14 로 내린다 — 제목(18)과의 대비를 키우는 카드 전용 단(2026-08-22 Q). */
.wire-field-row[data-size="sm"]>.wire-field-value{font-size:var(--text-sm)}
/* 불릿 목록(§5): 6px 원형 --sub 불릿 + 14/400(2026-08-28 Q 본문 14). 불릿은 2개 이상일 때만이다(2026-08-07 Q
   규칙 신설) — 단일 항목은 아래 .wire-bullets-single 문장으로 그린다(WireBullets 가 가른다). */
.wire-bullets{margin:0;padding-left:0;display:grid;gap:var(--space-2);list-style:none;color:var(--ink);font-size:var(--text-sm)}
.wire-bullets>li{position:relative;padding-left:var(--space-4)}
.wire-bullets>li::before{content:"";position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:var(--radius-pill);background:var(--sub)}
/* 단일 항목 — 목록이 아니라 문장이다. 크기·색은 불릿 항목과 같고 불릿·들여쓰기만 없다. */
.wire-bullets-single{margin:0;color:var(--ink);font-size:var(--text-sm)}
/* SearchInput (§5 입력칸): 높이 40 · radius 6 · --line-control 1px · 라벨은 항상 위. */
/* align-content:start — 폼 입력칸(.wire-form-field)과 같은 stretch 부풀림 방지 계약. */
.wire-search{display:grid;gap:var(--space-2);align-content:start}
.wire-search-label{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-search-box{display:flex;align-items:center;line-height:normal;gap:var(--space-2);width:100%;min-height:var(--control-height);padding:0 var(--space-3);background:var(--panel);border:1px solid var(--line-control);border-radius:var(--radius-control)}
/* 행간 normal — 단일행 컨트롤의 세로 중앙은 기하 정렬이 만든다(2026-08-06 Q, 버튼과 동일). */
.wire-search-box input,.wire-search-box select{width:100%;border:0;background:transparent;color:var(--ink);outline:0;font-size:var(--text-sm);line-height:normal;-webkit-appearance:none;appearance:none}
/* select 는 네이티브 화살표를 끄고 꺽쇠를 직접 그린다 — 네이티브는 테두리에 붙어 다른 입력칸과 안 맞는다. */
.wire-search-box select{padding-right:var(--space-6)}
.wire-search-box:focus-within{outline:2px solid var(--blue-deep);outline-offset:2px}
.wire-search-box input:focus-visible,.wire-search-box select:focus-visible{outline:none}
/* 입력 오류(§5): 테두리 1.5px --risk + 아래 메시지. 색만으로 알리지 않는다. */
.wire-search-box[data-invalid="true"]{border:1.5px solid var(--risk)}
.wire-field-error{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--risk)}
/* WireFormField (§5 입력칸) — 검색칸과 **같은 계약**을 폼에서 쓰는 형태다. 검색칸 규칙을
   .wire-search-box 에 묶어 둔 탓에 폼 화면들이 레거시 .field 로 각자 그리고 있었다.
   박스 규칙은 검색칸과 한 글자도 다르지 않고, 폼에만 필요한 것(필수 별표·도움말·오류 자리)만 는다. */
/* align-content:start(2026-08-07 Q "인풋 크기·높이 안 맞음" 근본 원인): 2열 그리드에서
   힌트 달린 이웃 칸이 행을 키우면, stretch 기본값이 남는 높이를 이 칸의 라벨·박스 행에
   나눠 줘 입력칸이 54.8px 로 부풀었다(기본정보 수정 이메일 칸 실측 +14.8). 행을 위로
   붙이면 모든 박스가 40 으로 고정된다. */
.wire-form-field{display:grid;gap:var(--space-2);align-content:start}
.wire-form-label{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
/* 필수 별표는 --risk 지만 리스크 독점(D9)의 예외가 아니다 — 오류·필수 표시는 §9 가 허용한 자리다. */
.wire-form-required{font-size:var(--text-sm);font-weight:600;color:var(--risk)}
/* 라벨 옆 '(선택)' 같은 보조 문구. 라벨과 같은 줄이므로 굵기만 낮춘다. */
.wire-form-note{margin-left:var(--space-1);font-size:var(--text-sm);color:var(--sub);font-weight:400}
.wire-input-box{display:flex;align-items:center;line-height:normal;gap:var(--space-2);width:100%;min-height:var(--control-height);padding:0 var(--space-3);background:var(--panel);border:1px solid var(--line-control);border-radius:var(--radius-control)}
.wire-input-box>input,.wire-input-box>select,.wire-input-box>textarea{width:100%;min-width:0;border:0;background:transparent;color:var(--ink);outline:0;font:inherit;font-size:var(--text-sm);font-weight:400;-webkit-appearance:none;appearance:none}
/* 단일행 컨트롤만 행간 normal(2026-08-06 Q) — textarea 는 다중행 본문이라 --leading-relaxed 를 유지한다. */
.wire-input-box>input,.wire-input-box>select{line-height:normal}
/* select 는 네이티브 화살표를 끄고 꺽쇠를 직접 그린다(검색칸과 같은 이유). */
.wire-input-box>select{padding-right:var(--space-6)}
.schedule-nav .schedule-view-select>select{align-self:stretch;height:auto}
/* textarea 는 박스가 세로로 늘어난다 — 높이 40 고정은 한 줄 컨트롤 계약이다. */
.wire-input-box[data-control="textarea"]{align-items:stretch;padding:var(--space-3)}
/* min-height 를 0 으로 되돌리는 이유: layout.tsx 의 전역 textarea 규칙(min-height 216px)이
   rows 지정을 덮어써서 rows=4 인 담당 실무자 의견과 rows=14 인 수기 메모가 같은 높이로 나온다.
   전역 규칙은 아직 레거시 화면들이 기대고 있어 두고, 킷 입력칸 안에서만 rows 가 높이를 정한다.
   (이 파일은 백틱 템플릿 리터럴이다 — 주석에 백틱을 쓰면 문자열이 거기서 끊긴다.) */
.wire-input-box>textarea{min-height:0;resize:vertical;line-height:var(--leading-relaxed)}
.wire-input-box:focus-within{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 포커스 링은 상자 하나만 — 내부 컨트롤의 전역 :focus-visible 링을 끈다(이중 링, 2026-08-03).
   datetime-fields 가 이미 쓰는 패턴이다. */
.wire-input-box>input:focus-visible,.wire-input-box>select:focus-visible,.wire-input-box>textarea:focus-visible{outline:none}
.wire-input-box[data-invalid="true"]{border:1.5px solid var(--risk)}
/* 도움말은 14(--text-sm)다(2026-08-10 Q. 구 12 --text-xs 대체. 2026-08-07 '도움말 12 전역
   통일'은 이 변경으로 완전히 걷혔고 본문 하한 14 가 예외 없이 돌아왔다). 당사자 등록 화면에서
   같은 폼에 선 .schedule-form-hint 14 와 크기가 갈려 있던 것이 계기다. 아래 a 규칙의 deep 색
   글자는 §6 규칙 3 이 '14 이상·굵기 600' 을 요구하는데 12 에서 이를 어기고 있었고, 14 로
   올라가면서 그 예외도 함께 닫힌다. */
.wire-form-hint{font-size:var(--text-sm);font-weight:400;color:var(--sub)}
.wire-form-hint a{font-size:var(--text-sm);color:var(--blue-deep);font-weight:600;text-decoration:underline}
/* 폼을 담은 카드는 본문 간격을 한 단 넓힌다 — 입력칸은 라벨·도움말을 달고 있어
   정보 카드(12)의 간격으로는 항목 경계가 안 읽힌다. */
.wire-form-card>.wire-card-body{gap:var(--space-5)}
/* 폼 2열. 화면마다 grid-template-columns 를 다시 쓰지 않는다(.card-grid 와 같은 취지). */
.wire-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-5)}
/* 폼 하단 버튼 줄: 오른쪽 정렬, 프라이머리가 오른쪽 끝(모달 하단과 같은 어휘). */
.wire-form-actions{display:flex;justify-content:flex-end;gap:var(--space-3)}
/* 기본정보 수정 폼 카드 스택(2026-08-07 Q 5차) — 폼 한 장 안에 카드 2장(기본·추가 정보)이
   페이지 스택 간격(여백 3단 ①)으로 쌓인다. 폼 요소 자체는 간격을 못 만들어 래퍼가 갖는다. */
.basic-info-stack{display:grid;gap:var(--section-gap)}
/* ── 위저드 공용 (2026-08-09 Q) ── 상담 등록과 인테이크 두 화면이 화면 전체를 인라인 스타일
   객체로 그리고 있었다. guard:tokens 는 layout.tsx·wire-styles.ts 두 파일만 훑으므로 인라인
   값은 검사 밖이었고, 실제로 제목이 계단에 없는 20px 로(다른 화면 h2 는 18) 서 있었다.
   같은 블록이 두 파일에 복사돼 있어 한쪽만 고치면 두 화면이 갈라진다 — 함께 옮긴다. */
.wizard-stack{display:grid;gap:var(--space-5);align-content:start}
/* 간격은 격자의 gap 하나가 준다(§4-6 규칙 3) — 전역 p 의 위 마진 8 이 남으면 캡션 **위**만
   28 이 되어 아래(20)와 어긋난다. 구 인라인 captionStyle 이 margin:0 을 갖고 있어 안 보이던
   결함이고, 클래스로 옮기며 드러났다. .panel-meta 자체는 건드리지 않는다 — 카드 제목 슬롯
   (.wire-card-title)은 격자가 아니라 그 8 이 제목과 설명을 갈라 주는 유일한 여백이다.
   위저드 격자 둘(스택·칸)의 직계 p 가 대상이다. 실제로 걸리는 것은 .panel-meta ·
   .wire-field-error · .wire-badge · .wire-field-value 뿐이고 넷 다 0 이 맞다 — 인테이크
   기본정보 줄은 이 규칙이 없으면 라벨↔값이 8(격자) + 8(p 마진) = 16 으로 벌어진다.
   (.wizard-form 은 2026-08-09 삭제 — 목표·질문 입력이 장폭 전폭으로 바뀌며 520 읽기 폭
   래퍼의 마지막 사용처가 사라졌다.) */
.wizard-stack>p,.wizard-field>p{margin:0}
/* 버튼 줄. 왼쪽부터 차는 이동 조작(이전·다음)이라 .wire-form-actions(오른쪽 정렬)와 다르다. */
.wizard-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
/* 무응답·해당 없음 줄(인테이크 서술 문항)만 8 — 버튼 사이가 입력칸↔버튼 줄 간격
   (.wizard-field gap 8)과 같아야 한 묶음으로 읽힌다(2026-08-09 Q). */
.wizard-answer-actions{gap:var(--space-2)}
/* 반복 칸의 +/- 세트(WireRepeatActions, 2026-08-09). 한 쌍이 한 줄에 오른쪽으로 붙는다 —
   조작 대상 바로 아래이고, 간격은 행 스택 값 8 이다(둘이 한 쌍으로 읽혀야 하므로 조작 줄
   기본 12 보다 좁다). 아이콘 버튼은 정사각이라 폭을 높이에 맞춘다. */
.wire-repeat-actions{display:flex;justify-content:flex-end;gap:var(--space-2)}
.wire-repeat-actions>.wire-button{width:var(--pill-height);padding:0}
/* 입력 묶음은 **폼 자신이 520 으로 좁힌다**(§4-1 "읽기 폭이 필요한 폼은 페이지가 아니라 폼
   자신이 좁힌다"). 장폭 1120 안에서 글줄 1040 짜리 textarea 는 한 줄이 너무 길어 눈이
   되돌아올 자리를 잃는다. 후보 목록처럼 폭을 다 써야 하는 것은 이 래퍼 밖에 둔다.
   2026-08-09: 목표·질문 묶음이 카드 안으로 들어갔지만 이 래퍼는 **카드 안에 그대로 남는다** —
   카드가 장폭 1120 을 쓰므로 래퍼를 빼면 textarea 글줄이 1070 이 되어 이 규칙이 무의미해진다.
   카드는 묶음을 보이게 하고, 읽기 폭은 여전히 이 래퍼가 정한다.
   → 2026-08-09 삭제: Q "입력 필드 길이 장폭에 맞춰서 최대로" 로 목표·질문 입력이 전폭
   한 줄 문법(.session-goal-*)으로 바뀌며 마지막 사용처가 사라졌다. */
/* 나란히 서는 컨트롤 줄(2026-08-09 Q "2 column grid"). 520 은 **글줄 폭**이라 여기 쓸 수
   없다 — 두 칸으로 나누면 250 이 되고, 날짜·시각 상자는 최소 288(칸 240 + 간격 8 + 달력
   버튼 40)이라 그 안에서 두 줄로 접힌다. 읽기 폭이 아니라 조작 폭이므로 §4-1 이 폼 화면
   폭으로 적어 둔 720 을 쓴다(칸마다 350). 767 미만 한 열은 .wire-form-grid 가 갖는다. */
.wizard-row{display:grid;gap:var(--space-4);max-width:720px}
/* 구획 머리(2026-08-09 Q "이름 카드 아래 물음 사이의 여백 더 주고 가로선으로 구분하기").
   위 카드와 성격이 다른 구획이 시작된다는 표시다 — 여백만으로는 스택의 다른 간격과
   구별되지 않았다(§2-2 규칙 2 ⓐ). 선은 회색 --line 1px, 카드 안 구분선과 같은 어휘다.
   위 여백은 스택 gap 20 위에 12 를 더해 32 로 벌린다(§3-4 여백 3단 밖의 새 값을 만들지
   않고 토큰 둘을 겹친다). 제목 자체의 크기·굵기는 전역 h2 계약 그대로다. */
.wizard-section-head{display:grid;gap:var(--space-2);padding-top:var(--space-3);border-top:1px solid var(--line)}
.wizard-section-head>h2{margin:0}
.wizard-section-head>p{margin:0}
/* 칸 하나(라벨·컨트롤·딸린 버튼)의 세로 묶음. WireFormField 안쪽 간격과 같은 8 이다.
   align-content:start 도 같은 계약이다(.wire-form-field 의 stretch 부풀림 방지와 같은 이유) —
   2열 그리드에서 키 큰 이웃(목표 문장 textarea)이 행을 키우면 stretch 기본값이 남는 높이를
   행 사이에 나눠 줘, "조작 대상 바로 아래"여야 할 +/- 세트가 칸 바닥으로 떨어진다(CCC-75 실측). */
.wizard-field{display:grid;gap:var(--space-2);align-content:start}
/* 세션 목표 수정의 카드 스택이다. 목표 한 묶음은 전폭 접이식 카드라 .wizard-row의 읽기
   폭을 쓰지 않는다. 2열 본문이 폭을 나누고 간격은 spacing v2 페이지 스택 32를 쓴다.
   카드 안 body 20은 .wire-form-card가 갖는다. */
.session-plan-stack{display:grid;gap:var(--section-gap)}
/* 여러 개 고르기 보기 줄 — WireChoice 가 각 보기의 옷을 갖고, 여기는 흐름만 정한다. */
.wizard-choice-row{display:flex;flex-wrap:wrap;gap:var(--space-3)}
/* 안 채운 필수 보기 줄(2026-08-09 Q). 여러 개 고르기에는 입력 상자가 없어 WireFormField 의
   invalid 를 빌릴 수 없으므로 **줄 자체가 경고 상자**가 된다. 레시피는 입력칸 오류와 같다
   (--risk 1.5px · radius 6, §5). 안쪽 보기는 그대로 두고 상자만 생긴다 — 체크 켬은
   --gradient-action 이라 리스크 면과 겹쳐도 어느 쪽이 켬인지 흐려지지 않는다. */
/* optical: 안쪽 여백 8/10 은 상자가 없던 자리에 상자를 얹으면서 보기가 테두리에 붙지 않게
   주는 값이다 — 이 줄만 갖는 상태라 간격 3단에 넣을 값이 아니다. */
.wizard-choice-row[data-invalid="true"]{padding:8px 10px;border:1.5px solid var(--risk);border-radius:var(--radius-control)}
/* 인테이크 조회의 값만 저장된 줄바꿈을 그대로 보인다 — 서술형 답변이 여러 줄로 들어온다.
   크기·색은 위 .wire-field-value(정보 필드) 그대로다. */
.intake-read-value{white-space:pre-wrap}
@media(max-width:767px){
  .wire-form-grid{grid-template-columns:minmax(0,1fr)}
}
/* WireChoice (§5 선택지 행): 컨트롤과 라벨이 같은 줄, 누를 면적은 컨트롤 높이(40)만큼.
   입력칸 규칙(width:100%)을 상속시키지 않는 것이 이 클래스의 존재 이유다. */
.wire-choice{display:flex;align-items:flex-start;gap:var(--space-3);min-height:var(--control-height);padding:var(--space-2) 0;font-size:var(--text-md);font-weight:600;color:var(--ink);cursor:pointer}
/* optical: 컨트롤 18px 을 라벨 첫 줄(16px · line-height 1.55 = 24.8px, 중심 12.4) 중심에
   맞추는 값은 3.4 ≈ 3px 이다. 구 4px 는 전 화면에서 컨트롤이 첫 줄보다 1.5px 아래로
   실측됐다(2026-08-05 킷·기록 작성 17곳). */
.wire-choice>input{margin:3px 0 0}
.wire-choice-text{display:grid;gap:var(--space-1);min-width:0;overflow-wrap:anywhere}
.wire-choice-desc{color:var(--sub);font-size:var(--text-sm);font-weight:400}
.wire-choice:has(>input:disabled){color:var(--sub);cursor:not-allowed}
/* 폼 안 묶음(fieldset). D59 '카드 안 카드 금지' — 상자 대신 위 구분선 하나 + 여백으로 가른다. */
.wire-fieldset{display:grid;gap:var(--space-3);min-width:0;margin:0;padding:var(--space-3) 0 0;border:0;border-top:1px solid var(--line)}
.wire-fieldset>legend{padding:0 var(--space-1-5);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-fieldset>legend small{font-weight:400}
.wire-fieldset-list{display:grid;gap:var(--space-4)}
/* 6영역 머리 줄(2026-08-08 Q): 가로선을 끄고 이름(600)과 직전 상태 배지를 한 줄 세로
   중앙에 세운다. legend 는 float 로 일반 흐름에 앉힌다(consent-fieldset legend 트릭) —
   기본 legend 는 fieldset 테두리 위에 걸터앉아 글줄이 어긋난다. */
/* 생활 6영역은 **영역 하나가 카드 하나**다(2026-08-09 Q). 구 fieldset 머리 줄(legend 를
   float 로 되돌리던 보정 포함)은 지웠다 — 영역 이름이 카드 제목 자리로 올라가면서 필요가
   없어졌다. 제목 줄은 2행이다: 이름이 위, '직전 상태 + 배지'가 아래(액션 카드와 같은 문법).
   이름·배지를 한 줄에 두면 이름과 값이 같은 위계로 읽힌다(D37 HERO 좌측 묶음과 같은 이유). */
.life-area-card>.wire-card-title{display:grid;gap:var(--space-2)}
.life-area-name{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.life-area-prior{margin:0;display:flex;align-items:center;gap:var(--space-2)}
.life-area-prior-label{font-size:var(--text-sm);font-weight:400;color:var(--sub)}
/* 선택지 묶음: 짧은 선택지는 한 줄에 여러 개, 길면 자연스럽게 접힌다. */
.wire-choice-group{display:flex;flex-wrap:wrap;gap:0 var(--space-6)}
.wire-choice-group[data-layout="stack"]{flex-direction:column;gap:0}
/* 라디오(§5): 체크박스와 같은 계약이고 모양만 원형이다. 선택 표시는 가운데 --ink 점.
   체크박스와 같은 이유로 ::after 가 아니라 background 로 그린다(input 은 replaced element). */
.wire-radio{flex:none;width:18px;height:18px;appearance:none;-webkit-appearance:none;margin:0;padding:0;border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box;cursor:pointer}
/* 라디오의 켬도 체크박스와 같은 어휘다 — 가운데 --ink 점 + **--gradient-action 면**.
   두 컨트롤이 같은 폼 안에 서므로 켬 신호가 갈리면 하나는 켜진 것처럼, 하나는 아닌 것처럼
   보인다. 채움 근거는 아래 .wire-checkbox:checked 주석에 한 번만 적어 둔다. */
.wire-radio:checked{background:radial-gradient(circle at center,var(--on-action) 0 4px,transparent 4px) padding-box,var(--gradient-action) padding-box,var(--gradient-deep) border-box}
.wire-radio:disabled,.wire-checkbox:disabled{background:linear-gradient(var(--muted),var(--muted)) padding-box,linear-gradient(var(--line),var(--line)) border-box;cursor:not-allowed}
/* WireButton (§5 버튼 5종 × 크기 2단). 크기 변형은 높이·패딩·라벨만 다르고 색 규칙은 같다.
   **형태는 알약**이다(2026-08-25 Q, 구 radius 6 대체). 입력·선택창은 사각 6, 아이콘 버튼은
   원형으로 남는다. 라벨은 줄바꿈하지 않고 좁은 화면에서는 행동 묶음 자체가 줄바꿈한다. */
/* 세컨더리(기본형). 테두리를 --line-control(#E3E3E3, 패널 위 1.24)에서 **--line-action
   (잉크 50%)** 으로 올린다(2026-07-31). 패널 위에서 1.24 짜리 테두리는 사실상 안 보여
   버튼이 버튼으로 읽히지 않았다 — 입력칸은 라벨이 형태를 알려 주지만(§9 완화) 버튼에는
   그 장치가 없다. 새 색이 아니라 프라이머리가 이미 쓰던 토큰이다.
   그래서 **일반 버튼과 강조 버튼의 구분이 테두리 굵기가 아니라 면으로 옮겨간다**:
   테두리는 둘이 같고, 프라이머리만 그라데이션 면을 갖는다(그림자는 2026-08-06 D60 후속으로
   폐지. 본문 흐름의 그림자는 떠 있는 층 몫이다). 두 버튼이 나란히 설 때 눌러야 할 쪽이
   뜨는 것은 이 면 대비이지 테두리 진하기가 아니다. */
/* 정렬 기본은 **가운데**다(2026-08-02 D58/CCC-50 — 구 왼쪽 기본은 버그, DESIGN.md §5).
   왼쪽·양끝 정렬은 data-justify 명시 옵션으로만 쓴다.
   세컨더리(기본형) 테두리는 **--gradient-brand 아웃라인**이다(2026-08-02 D58/CCC-51 —
   구 --line-action 을 대체, §3-3 배경 2겹 방식). 채움은 --button-fill 로만 바꾼다 —
   background 를 통째로 덮으면 테두리 층이 날아간다(카드 계약과 같은 함정). 프라이머리·
   고스트·위험·비활성은 background 를 덮어쓰므로 이 층의 영향을 받지 않는다. */
/* 행간은 default(normal)다 — 2026-08-06 Q: 단일행 컨트롤의 세로 중앙은 광학 보정이 아니라
   기하 정렬(flex 상하좌우 center + 기본 행간)이 만든다(구 --leading-none 대체). */
/* 높이는 전 버튼 32 하나다(2026-08-28 Q "버튼 컴포넌트 높이 전부 32" — 구 md 40 / sm 32
   2단 폐지). HERO·폼 행동이 40 이라 툴바·목록 32 옆에서 홀로 커 보이던 것을 없앤다.
   입력칸에 붙은 조작(달력 토글·인라인 값 편집)만 입력 높이 정렬 계약(40, --control-height)을
   따르는데 그건 .wire-button 이 아니라 자기 클래스라 이 규칙 밖이다. 라벨은 14/600,
   굵기는 전 버튼 600 하나(굵기 3단의 '강조 600', 조작 400 예외 폐지). */
/* 좌우 패딩은 14(--space-3-5) 하나다(2026-08-28 Q "패딩 14" — 2026-08-26 "16 최종"을
   실화면에서 둔중하다고 되돌린 값. --space-3-5 부활 이력은 tokens.css 주석에 있다). */
/* 아웃라인 언어 둘(2026-08-26 Q 최종): 아웃라인이 있는 버튼은 전부 **--gradient-brand
   1px**(알약화 이후 그레이 아웃라인 버튼이 중립 배지와 똑같이 읽혀 그레이를 폐지),
   아웃라인이 없는 버튼은 **면 채움**으로 선다(프라이머리 = --gradient-action,
   고스트 = --muted). 위험만 의미색 --risk 아웃라인이다. 두께는 --wire-outline-width. */
.wire-button{--button-fill:var(--panel);--wire-outline-width:1px;display:inline-flex;align-items:center;justify-content:center;line-height:normal;gap:var(--space-2);min-height:var(--pill-height);padding:0 var(--space-3-5);border:var(--wire-outline-width) solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-size:var(--text-sm);font-weight:600;text-align:center;white-space:nowrap;cursor:pointer;background-size:200% auto;background-position:50% 0}
/* 프라이머리: --gradient-action 배경 + --line-on-action 테두리. 그림자는 없다(2026-08-06,
   ADR-0030 후속 검토 종결). 본문 흐름의 그림자는 D60 이 폐지했고, 버튼도 본문 흐름이다.
   일반과 강조의 구분은 면이 이미 만든다: 채운 그라데이션 면 vs 흰 면 + 아웃라인. */
.wire-button[data-variant="primary"]{--wire-outline-color:var(--line-on-action);background:var(--gradient-action);border:var(--wire-outline-width) solid var(--wire-outline-color);color:var(--on-action);background-size:200% auto;background-position:50% 0}
/* 일반(neutral): 색이 세컨더리와 같은 라인 버튼이다(2026-08-26 4차 — 크기·굵기 전유를
   폐지해 별도 규칙이 없다). 이동·보기 조작 자리의 이름으로만 남는다(높이는 전 버튼 32
   단일이라 자리마다 지정하지 않는다, 2026-08-28 Q). */
/* 고스트: 아웃라인이 없는 버튼은 면으로 선다(2026-08-26 Q "아웃라인 없는 경우 백그라운드
   컬러로 고정") — 보조 표면 --muted 채움. 글자는 기본 --ink 그대로다(--sub 로 내리면
   비활성(muted 면 + --sub)과 똑같아지고 위계 조합 표 §2-1 밖이다). 높이는 전 버튼 32 단일이다(2026-08-28). */
.wire-button[data-variant="ghost"]{background:var(--muted);border-color:transparent}
/* 버튼 안 꺽쇠 크기 예외 2건은 2026-08-10 에 없앴다(Q "버튼과 listrow, 체브론 맞추기").
   구 값은 라벨을 따라가는 .5333em(15px 라벨 8)·.5em(14px 라벨 7)이었고, 그래서 같은 화면의
   버튼·행·카드 꺽쇠가 8·10·9 로 셋 다 달랐다. 이제 --chevron-box 하나를 함께 본다. */
/* 위험: 되돌리기 어려운 행동에만. 의미색 --risk 아웃라인, 두께는 기본 계약(1px)이 갖는다. */
.wire-button[data-variant="danger"]{background:var(--panel);border-color:var(--risk);color:var(--risk)}
.wire-button[data-justify="center"]{justify-content:center}
.wire-button[data-justify="left"]{justify-content:flex-start;text-align:left}
.wire-button[data-justify="between"]{justify-content:space-between;text-align:left}
.wire-button[data-justify="between"] .wire-button-text{flex:1 1 auto}
/* 호버·누름(2026-07-31 신설). 지금까지 버튼에 **상태가 disabled 하나뿐**이라, 누를 수 있는
   것과 없는 것은 구분됐지만 지금 가리키고 있는 것은 알 수 없었다. 새 색을 만들지 않고
   사이드바 내비가 이미 쓰는 잉크 워시(§5 '호버는 약한 신호')를 그대로 빌린다.
   @media (hover:hover) 안에 두는 이유는 터치 기기에서 탭한 버튼에 호버가 남아 눌린 채로
   굳은 것처럼 보이기 때문이다(내비 항목에서 겪은 것과 같은 결함).
   누름은 transform 만 쓴다(§6: 누름은 transform·opacity 만). */
@media (hover:hover){
  /* 세컨더리 호버는 --button-fill 만 바꾼다 — background 를 덮으면 그라데이션 테두리가 사라진다. */
  .wire-button:not(:disabled):not([aria-disabled="true"]):hover{--button-fill:color-mix(in srgb,var(--ink) 6%,var(--panel))}
  .wire-button[data-variant="primary"]:not(:disabled):not([aria-disabled="true"]):hover{background:var(--gradient-action);filter:brightness(.96)}
  .wire-button[data-variant="ghost"]:not(:disabled):not([aria-disabled="true"]):hover{background:color-mix(in srgb,var(--ink) 6%,var(--muted))}
  .wire-button[data-variant="danger"]:not(:disabled):not([aria-disabled="true"]):hover{background:var(--risk-tint-solid)}
  /* 흐름(§6·CCC-53): 그라데이션을 가진 버튼만 — 아웃라인 버튼(세컨더리·일반)은 아웃라인이,
     프라이머리는 채움이 흐른다. 고스트·위험·비활성은 그라데이션이 없어 흐를 것이 없다. */
  .wire-button:not([data-variant="ghost"]):not([data-variant="danger"]):not(:disabled):not([aria-disabled="true"]):hover{animation:motion-flow calc(var(--motion-flow-period) * 2) var(--ease-standard) infinite}
  /* 선택·활성 카드 테두리도 같은 어휘로 흐른다. */
  .surface-card[data-selected="true"]:hover,.surface-card[aria-current="true"]:hover,.surface-card[open]:hover{background-size:200% auto;animation:motion-flow calc(var(--motion-flow-period) * 2) var(--ease-standard) infinite}
  /* 클릭해서 들어가는 카드의 호버(2026-08-03 Q — "다른 카드도 그라데이션") — 채움은
     --gradient-hover(리스트 행과 같은 tint 쌍), 테두리는 --gradient-brand 아웃라인이 되어
     같은 흐름 애니메이션을 탄다. 링크가 감싼 카드는 자동으로 잡고, 링크가 아닌 복잡한
     카드형 div 는 data-hover-flow="true" 를 달아 같은 어휘를 쓴다. 선택·펼침 상태는
     위 규칙(더 진한 --gradient-action 채움 없이 테두리 흐름)이 이미 갖는다. */
  /* 테마 규칙(2026-08-05 Q · ADR-0030): ① 카드·행의 **면 호버**는 자기 테마의 tint 쌍
     (--gradient-hover — 다크 값은 tokens.css 가 갖는다). ② **선택**은 두 테마 공통 —
     카드는 --gradient-brand 아웃라인, 행·컨트롤은 --gradient-action 면 + --on-action 글자
     (채움이 두 테마에서 같은 밝은 파스텔이라 글자도 늘 어두운 잉크다). ③ **반전 호버**
     (내비류 강조 호버)는 라이트 = 어두운 면 + 그라데이션 글자 ↔ 다크 = 그라데이션 면 +
     --on-action 글자다 — 배선은 layout.tsx 내비 규칙에 있다. */
  a:hover>.surface-card:not([data-selected="true"]):not([open]),
  .surface-card[data-hover-flow="true"]:hover{
    border-color:transparent;
    background:var(--gradient-hover) padding-box,var(--gradient-brand) border-box;
    background-size:200% auto;
    animation:motion-flow calc(var(--motion-flow-period) * 2) var(--ease-standard) infinite;
  }
  /* 접힌 카드(details)도 눌러서 여는 클릭 대상이다(2026-08-06 Q 후속) — 링크 카드와 같은
     호버 어휘를 받는다. 펼친 카드는 위 [open] 규칙(활성 테두리 + 흐름)이 이미 갖는다. */
  details.wire-card-details:not([open]):hover{
    border-color:transparent;
    background:var(--gradient-hover) padding-box,var(--gradient-brand) border-box;
    background-size:200% auto;
    animation:motion-flow calc(var(--motion-flow-period) * 2) var(--ease-standard) infinite;
  }
}
.wire-button:not(:disabled):not([aria-disabled="true"]):active{transform:translateY(1px)}
.wire-button:disabled,.wire-button[aria-disabled="true"]{background:var(--muted);border-color:var(--line);color:var(--sub);cursor:not-allowed}
.wire-button:disabled .wire-chevron,.wire-button[aria-disabled="true"] .wire-chevron{border-color:var(--sub)}
.wire-button .wire-chevron{border-color:currentColor}
/* 한글 광학 보정(tokens.css --nudge-hangul) — 고정 높이 단일행 컨트롤의 텍스트만 내린다. */
.wire-button-text,.wire-badge,.wire-input-box>input,.wire-input-box>select,.wire-search-box input,.wire-search-box select{transform:translateY(var(--nudge-hangul))}
/* 텍스트 옆에 서는 꺽쇠도 같은 값으로 따라 내린다(2026-08-06 실측) — 글자만 내리면 버튼의
   화살표가 라벨보다 0.7px 떠 보인다. 꺽쇠는 회전 transform 을 이미 갖고 있어 합성 대신
   position 오프셋으로 옮긴다(기존 translateX·rotate 와 독립). */
.wire-button .wire-chevron,.wire-search-box .wire-chevron,.wire-input-box .wire-chevron{position:relative;top:var(--nudge-hangul)}
/* 선택창 꺽쇠는 **클릭을 통과시킨다** (2026-08-09 Q "클릭이 안 됨"). 네이티브 화살표를 끈
   자리라 이 꺽쇠가 선택창의 유일한 표시인데, 꺽쇠가 자기 칸을 차지하고 있어서 정확히 그
   위를 누르면 아무 일도 안 일어났다 — 버튼처럼 생겼는데 반응이 없는 상태다.
   지우면 선택창이 글자 입력칸과 똑같아 보이므로(네이티브 화살표가 이미 꺼져 있다) 지우는
   대신 **선택창 위에 얹고 통과시킨다**: 꺽쇠를 절대 위치로 빼면 선택창이 상자 폭을 다
   쓰므로 꺽쇠 자리 밑에도 선택창이 깔리고, pointer-events:none 이 클릭을 그리로 넘긴다.
   세로 가운데는 transform 이 아니라 inset+auto 마진으로 잡는다 — 회전(rotate 45deg)이
   이미 transform 을 쓰고 있어 겹치면 한쪽이 지워진다. 형태·크기·색은 그대로다. */
.wire-input-box,.wire-search-box{position:relative}
.wire-input-box .wire-chevron,.wire-search-box .wire-chevron{
  position:absolute;
  right:var(--space-3);
  top:0;
  bottom:0;
  margin-block:auto;
  pointer-events:none;
}
/* ── 모션 3종 뼈대 (2026-08-02 D58/ADR-0028 · DESIGN.md §6 · CCC-50) ──
   여기는 어휘 정의만 둔다 — 실제 배선(어느 요소에 어느 클래스를 다는가)은 CCC-51·CCC-53.
   시간·이징은 tokens.css 의 모션 토큰만 쓴다(§6: 이 밖의 값 위반).
   ① 흐름: 그라데이션 배경·테두리가 호버 동안 좌우로 흐른다. background-size 200% 가 전제라
      그라데이션을 가진 요소에만 의미가 있다. @media (hover:hover) 안에 두는 이유는 버튼
      호버와 같다 — 터치에서 탭 잔상이 남는다.
   ② 눌림: 위 .wire-button:active 의 translateY(1px)와 같은 어휘 — 버튼 밖 클릭 요소용.
   ③ 떠오름: 스크롤 첫 진입 1회. 반복 재생 금지는 배선 쪽(IntersectionObserver once)이 진다. */
/* 평시 창(50%)에서 출발해 좌우를 오가고 다시 50% 로 — 호버 진입·이탈에 튐이 없다. */
@keyframes motion-flow{0%{background-position:50% 0}25%{background-position:100% 0}75%{background-position:0% 0}100%{background-position:50% 0}}
.motion-flow{background-size:200% auto}
@media (hover:hover){
  .motion-flow:hover{animation:motion-flow calc(var(--motion-flow-period) * 2) var(--ease-standard) infinite}
}
.motion-press:active{transform:translateY(1px)}
/* 눌림 배선(§6·CCC-53): 모든 클릭 요소가 같은 어휘를 쓴다. 버튼은 위 :active 규칙이 이미 갖는다. */
.wire-row:not([data-static="true"]):active,.record-summary:active,.navigation-link:active,.wire-tab:active,.program-switcher-trigger:active{transform:translateY(1px)}
/* 떠오름(구 §6 ③)은 2026-08-04 Q 결정으로 폐지 — 로딩·스크롤 진입 모션은 없다.
   모션은 호버(흐름)·눌림 두 계열만 남는다(ADR-0028 개정 기록). */
/* 공용 아이콘(CCC-49): 문장 속에 서면 베이스라인에 맞춰 살짝 내린다(em 비례라 크기를 따라간다).
   플렉스 줄에서는 줄어들지 않는다. */
.wire-icon{display:inline-block;vertical-align:-0.15em;flex:none}
/* 버튼 라벨 안 아이콘은 글자 세로 중앙에 맞춘다(2026-08-06 Q "시간순 화살표가 가운데가
   아니다"). 값은 아래 optical 주석이 갖는다. */
.wire-button .wire-icon{vertical-align:-0.15em}
/* optical: -0.15em 은 14px 라벨 실측값(2026-08-07, 보정 후 잔차 0.09px). 버튼 라벨이 두 단
   모두 14 가 되면서(2026-08-28) 구 15px 실측값 -0.09em 과 sm 분기를 걷고 한 값이 됐다. */
/* 메타 줄(§10): 구분자 가운뎃점 대신 조각을 독립 노드로 두고 간격으로 띄운다.
   조각 사이는 **세로선 1px** 로 가른다(2026-08-06 Q — 여러 위계·성격의 값이 한 줄에 설 때
   간격만으로는 경계가 안 읽힌다). */
.wire-meta-row{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-3)}
.wire-meta-row>span+span{border-left:1px solid var(--line-control);padding-left:var(--space-3)}
/* 한 줄 넘침 처리 공용 계약(2026-08-06 Q "전역과 싱크"): 줄바꿈 대신 오른쪽 끝 48px 에서
   마스크로 자연스럽게 사라진다. 브리핑 회차 행·상담 기록 핵심 한 줄이 같은 규칙을 쓴다. */
.wire-fade-clip{white-space:nowrap;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,var(--ink) calc(100% - 48px),transparent);mask-image:linear-gradient(90deg,var(--ink) calc(100% - 48px),transparent)}
/* 배지·칩(§5): 높이 24 · 패딩 0 10 · 14/400(굵기는 2026-08-06 Q — 뱃지 글자는 본문과
   같은 400, 강조가 아니라 분류 표시다). 기본형은 색 없이 --sub 테두리로만 선다.
  2026-08-23 Q 재규정: 색상 배지는 기존 계열 **deep 면**과 같은 외곽선을 쓰고,
  전경은 테마에 따라 --on-badge 로 반전한다. 라이트는 밝은 글자, 다크는 어두운 글자다. */
/* **이 클래스가 화면 전체의 유일한 배지 계약이다**(2026-08-07 Q 리팩터링). 같은 레시피를
   제각각 복사하던 8개 클래스(.status 계열, .briefing-badge, .record-kind, .record-owner,
   .record-ai-source, .settings-user-status, .onboarding-step, .consent-upload-slot-state)를
   전부 이 클래스 + data-tone 으로 대체했다. 배지 모양을 고칠 일이 생기면 여기 한 곳만
   고치면 전 화면이 함께 바뀐다. 마크업은 WireBadge 컴포넌트(wire-badge.tsx)를 쓴다.
   굵기 400 은 2026-08-06 Q 재개정(강조 아닌 표시 값이라 본문과 같은 기본 굵기). */
.wire-badge{--wire-outline-color:var(--line);--wire-outline-width:1px;display:inline-flex;align-items:center;justify-content:center;line-height:normal;min-height:var(--badge-height);padding:0 var(--space-2-5);border:var(--wire-outline-width) solid var(--wire-outline-color);border-radius:var(--radius-pill);background:transparent;font-size:var(--text-sm);font-weight:400;color:var(--ink)}
/* 계열 배지: 민트=진행·상태·담당, 라벤더=AI·승인 대기, 블루=시간 축(TimeAxisBadge 전용).
   코랄·시안·라이트마젠타·앰버·라임은 여러 형제 배지의 구분 variation이다(기본 배정 순서는
   mint → lavender → coral → cyan → light-magenta, lime·amber 최후순위 — 2026-08-24 Q 결정).
   전용 surface 토큰이 라이트 deep 면과 다크 base 면을 갈아 끼우며 전경은 --on-badge가 맡는다.
   light-magenta 만 예외로 승인 hex #D96BC8 하나를 두 테마에서 같이 쓰고, 그 면 위 글자는
   전용 --on-badge-light-magenta(다크 캔버스 중립색 재사용)로 두 테마 모두 AA 를 넘긴다. */
/* sm(2026-08-23 Q "뱃지 안 텍스트 12px"): 높이 20 · 글자 12. 카드 헤더처럼 이름 옆
   곁다리로 서는 자리 전용이다. 본문 계열의 14px 하한을 풀지 않고 단일 배지 계약 안에
   컴팩트 크기만 추가한다(D61 ②). **좌우 패딩은 기본 배지와 같은 10(--space-2-5)으로
   통일한다**(2026-08-28 Q "뱃지 좌우 패딩 통일" — 구 8 은 md 배지와 나란할 때 제각각으로
   읽혔다. 컴팩트는 높이·글자만 줄이고 좌우 리듬은 배지 하나로 맞춘다). */
.wire-badge[data-size="sm"]{min-height:var(--space-5);padding:0 var(--space-2-5);font-size:var(--text-badge-compact)}
.wire-badge[data-tone="mint"]{--wire-outline-color:var(--badge-mint);background:var(--badge-mint);color:var(--on-badge)}
.wire-badge[data-tone="lavender"]{--wire-outline-color:var(--badge-lavender);background:var(--badge-lavender);color:var(--on-badge)}
.wire-badge[data-tone="blue"]{--wire-outline-color:var(--badge-blue);background:var(--badge-blue);color:var(--on-badge)}
.wire-badge[data-tone="coral"]{--wire-outline-color:var(--badge-coral);background:var(--badge-coral);color:var(--on-badge)}
.wire-badge[data-tone="amber"]{--wire-outline-color:var(--badge-amber);background:var(--badge-amber);color:var(--on-badge)}
.wire-badge[data-tone="lime"]{--wire-outline-color:var(--badge-lime);background:var(--badge-lime);color:var(--on-badge)}
.wire-badge[data-tone="cyan"]{--wire-outline-color:var(--badge-cyan);background:var(--badge-cyan);color:var(--on-badge)}
.wire-badge[data-tone="light-magenta"]{--wire-outline-color:var(--badge-light-magenta);background:var(--badge-light-magenta);color:var(--on-badge-light-magenta)}
/* 리스크 배지: 확인된 리스크·오류 상태 전용(D9 리스크 색 독점의 허용 자리, 구 .status.risk). */
.wire-badge[data-tone="risk"]{--wire-outline-color:var(--risk);background:var(--risk);color:var(--on-badge)}
/* 상태 태그: 기본은 neutral이고 AI 산출·승인 대기 낱말만 lavender다.
   화면 전체에서 이 클래스 하나만 쓴다(2026-08-07 통합). */
.wire-status-tag{display:inline-flex;align-items:center;justify-content:center;line-height:normal;min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:var(--text-sm);font-weight:400;color:var(--ink)}
/* 상태 태그 색 계열(D61 ② 개정, CCC-106): AI 산출·승인 대기 낱말(D58 ④)만
   라벤더로 연다. 다섯 계열을 미리 다 칠하지 않는다(쓰는 것만 연다). 글자는 배지와 같은
   레시피로 --ink 그대로 두고 테두리·배경만 계열을 바꾼다. 변수 자체가 테마 토큰이라
   다크(D56)에서 별도 선언 없이 함께 뒤집힌다. */
.wire-status-tag[data-tone="lavender"]{border-color:var(--lavender-deep);background:var(--lavender-tint)}
/* 체크박스(§5): 18px · radius 4 · --gradient-deep 1px 테두리. 리스크 변형은 테두리만 --risk. */
.wire-checkbox{flex:none;width:18px;height:18px;appearance:none;-webkit-appearance:none;margin:0;padding:0;border:1px solid transparent;border-radius:var(--radius-xs);background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box;cursor:pointer}
/* 리스크 변형: 테두리만 --risk 로 바꾼다(2026-07-26 Q 결정). 나머지는 기본과 같다.
   테두리를 불투명 단색으로 덮으므로 아래 그라데이션 레이어는 보이지 않는다. */
.wire-checkbox[data-tone="risk"]{border:1px solid var(--risk)}
/* 체크 표시는 ::before/::after 가 아니라 background-image 로 그린다.
   이유: input 은 replaced element 라 Firefox 가 생성 콘텐츠를 렌더하지 않는다 — ::after 로 그리면
   Firefox 에서 체크 표시가 조용히 사라져 선택·미선택이 구분되지 않는다. 동의 체크박스(D23)에서는
   그게 가장 위험한 자리다. background-image 는 전 브라우저에서 동작한다.
   data URI 안에는 var() 를 쓸 수 없어 획 색만 hex 로 박힌다 — --ink(#3D3445)·--risk(#B52573)와
   같은 값이며, 토큰이 바뀌면 이 두 줄도 함께 고쳐야 하는 유일한 자리다. */
/* 켬 = **면이 칠해진다**(2026-07-31 Q 결정). 이전에는 켜고 끄고가 12px 체크 글리프 하나로만
   갈렸다 — 18px 상자 안에서 그 차이는 훑을 때 잡히지 않고, 동의 체크박스(D23·D49)처럼
   "표시했나 안 했나"가 곧 법적 기록인 자리에서 가장 위험한 종류의 모호함이다.
   채움은 **프라이머리 버튼과 같은 --gradient-action** 이다(Q 지시: "확인 채울 때는 버튼
   컬러랑 같은 그라데이션으로 채워, 컬러 맘대로 바꾸지 말고"). 새 색도 새 그라데이션도
   아니다 — §3-3 이 허용한 5개 중 하나이고, '지금 내가 정한 것'이라는 뜻을 프라이머리
   버튼과 나눠 갖는다. 체크 획은 --ink 다(그라데이션 양끝 위 8.15 / 6.35 로 둘 다 통과). */
.wire-checkbox:checked{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.5 12.5l5 5 10-11' fill='none' stroke='%233D3445' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat,var(--gradient-action) padding-box,var(--gradient-deep) border-box}
/* 리스크 변형도 **같은 채움**이다 — §5 가 "테두리만 --risk 로 바꾸고 나머지는 기본과 같다"
   (2026-07-26 Q 결정)로 이미 정해 둔 그대로다. 리스크 색은 테두리가 계속 독점한다(D9).
   바뀐 것은 체크 획 하나다: 핑크 획은 채운 면 위에서 대비 1.85·1.44 라 아예 보이지 않아
   --ink 로 바꿨다. 리스크를 알리는 것은 획이 아니라 테두리이므로 신호는 잃지 않는다.
   (그래서 이제 data URI 안 원시 hex 는 --ink 한 값뿐이다 — 위 주석의 '두 줄'이 한 줄이 됐다.) */
.wire-checkbox[data-tone="risk"]:checked{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.5 12.5l5 5 10-11' fill='none' stroke='%233D3445' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat,var(--gradient-action) padding-box,var(--gradient-deep) border-box}
/* 오류 알림 한 줄(WireError, 2026-08-09 Q "알약 박스" 정정). 색·굵기는 layout.tsx 의
   [role="alert"] 전역 규칙(--risk·600)이 갖고, 여기는 .empty 와 같은 배치 + 크기만 더한다 —
   구 리스크 배지는 inline-flex 알약이라 그리드에 직접 서면 전폭 알약 막대가 됐다(D61 ②
   알약은 배지 라벨 전유물). 자리 예약은 .empty 와 같은 규칙: 카드의 유일한 내용일 때만. */
.wire-error{display:flex;align-items:center;gap:var(--space-2);margin:0;font-size:var(--text-sm)}
.wire-error[data-reserve="true"]{min-height:92px}
/* 빈 상태(§5): 무채색만. 라인 아이콘 28 + 제목 16/700 + 설명 14/400 + 다음 행동 버튼. */
.wire-empty{display:grid;justify-items:center;gap:var(--space-2);padding:var(--space-10) var(--space-6);text-align:center}
.wire-empty-icon{width:28px;height:28px;color:var(--sub)}
.wire-empty-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.wire-empty-desc{margin:0;max-width:34ch;font-size:var(--text-sm);color:var(--sub)}
.wire-empty>.wire-button{margin-top:var(--space-2)}
/* 탭(§5): 활성은 색이 아니라 대비로 구분한다. */
.wire-tabs{display:flex;gap:var(--space-6);border-bottom:1px solid var(--line)}
.wire-tab{position:relative;padding:calc(var(--space-2) + var(--nudge-hangul)) 0 calc(var(--space-2) - var(--nudge-hangul));border:0;background:none;color:var(--sub);font-size:var(--text-md);font-weight:600;cursor:pointer}
/* 활성 밑줄은 브랜드 그라데이션 2px 이고, 컨테이너 회색선(1px)을 **가운데로 관통**한다
   (2026-08-03 Q — 끝만 맞추면 2px 가 1px 위로 돌출해 계단으로 보인다). ::after 절대 배치라
   컨테이너 border 위에 정확히 얹힌다. 텍스트 보정(transform)과 독립이 되도록 밑줄을
   텍스트가 아니라 의사 요소에 둔다. */
.wire-tab[aria-selected="true"],.wire-tab[data-active="true"]{color:var(--ink)}
/* optical: -1.5px 는 간격이 아니라 컨테이너 선 1px 을 2px 밑줄이 ±0.5 로 감싸는 값 */
.wire-tab[aria-selected="true"]::after,.wire-tab[data-active="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1.5px;height:2px;background:var(--gradient-brand)}
/* 인용 블록(§5): AI 제안의 근거 발언 전용. 세로선은 --gradient-brand-v(흐르는 방향과 같게). */
.wire-quote{margin:0;padding-left:var(--space-3);border-left:2px solid transparent;background:var(--gradient-brand-v) left/2px 100% no-repeat;font-size:var(--text-sm);color:var(--sub)}
.wire-quote-time{display:block;margin-top:var(--space-1);font-size:var(--text-sm);font-weight:600;color:var(--sub);letter-spacing:var(--tracking-numeric)}
/* D73 근거 인용 접힘. 산출물 바로 아래에서만 열고, 링크는 회차 카드 앵커가 종점이다. */
.wire-source-quotes{margin-top:var(--space-2)}
.wire-source-quotes>summary{cursor:pointer;font-size:var(--text-sm);font-weight:600;line-height:var(--leading-normal);color:var(--sub)}
.wire-source-quotes-body{display:grid;gap:var(--space-2);margin-top:var(--space-2)}
.wire-source-quotes-link{justify-self:start}
/* 모달(§5): 폭 520 · radius 12 · 스크림 --scrim · --shadow-modal.
   하단 버튼 줄은 오른쪽 정렬, 세컨더리가 왼쪽·프라이머리가 오른쪽 끝. */
.wire-scrim{position:fixed;inset:0;z-index:var(--z-modal);display:grid;place-items:center;padding:var(--space-6);background:var(--scrim)}
.wire-modal{width:100%;max-width:520px;padding:var(--space-6);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-modal)}
.wire-modal-title{margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
.wire-modal-desc{margin:var(--space-2) 0 0;font-size:var(--text-sm);font-weight:400;color:var(--sub)}
.wire-modal-body{margin-top:var(--space-5)}
.wire-modal-actions{display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)}
/* 관리자 2차 내비(CCC-18a): 좌측 335px 컬럼 → 가로 탭. 셸 사이드바 옆에 기둥이 둘 서면
   "사이드바 = 장소"(D35)가 어느 쪽인지 읽히지 않는다. 탭 자체 규칙은 .wire-tab 이 갖고
   있고(DESIGN.md §5), 여기서는 좁은 화면 가로 스크롤만 더한다.
   스크롤은 nav 가 아니라 **바깥 래퍼**가 갖는다(2026-08-05 실측 수정): nav 자신에게
   overflow-x:auto 를 주면 overflow-y 도 visible 로 남지 못해(명세) 활성 탭 밑줄 2px 중
   경계선 아래로 나가는 1.5px 이 잘렸다 — 활성 밑줄이 0.5px 헤어라인으로만 보이던 원인.
   래퍼의 아래 패딩 2px 이 그 돌출분을 스크롤포트 안에 담고, 음수 마진이 자리 차지를 되돌린다. */
/* optical: 패딩·마진 2px 는 간격이 아니라 밑줄 돌출분(경계선 아래 1.5px)을 담는 클립 여유다 */
.wire-admin-tabs-scroll{overflow-x:auto;scrollbar-width:none;padding-bottom:2px;margin-bottom:-2px}
.wire-admin-tabs-scroll::-webkit-scrollbar{display:none}
/* 탭이 넘치면 nav 가 내용 폭만큼 늘어나야 경계선(border-bottom)이 끝까지 그려진다. */
.wire-admin-tabs{min-width:max-content}
.wire-admin-tabs .wire-tab{flex:none;white-space:nowrap}
/* 관리자 영역 레이아웃: 탭 아래 콘텐츠 한 단. */
.wire-admin-layout{display:block}
.wire-admin-content{min-width:0;padding:var(--space-6) 0 var(--space-10)}
.wire-admin-back{margin-bottom:var(--space-3)}
.wire-admin-back a{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.wire-admin-back a:hover{text-decoration:underline}
/* 두 컬럼의 첫 줄이 같은 높이에서 시작해야 한다(2026-08-03 Q '박스와 텍스트 여백 정렬') —
   좌열만 갖던 여분 margin-top 을 없앤다. 세로 간격은 .wire-admin-cols 의 margin 이 준다. */
.wire-admin-list{display:grid;gap:var(--space-4)}
/* 좌열(실무자 목록)은 '이메일  역할' 한 줄이 랩 없이 들어가는 최소 폭을 보장한다. */
.wire-admin-cols{display:grid;grid-template-columns:minmax(400px,1fr) minmax(0,1.2fr);gap:var(--space-6);margin-top:var(--space-6);align-items:start}
.wire-admin-cols>section{display:grid;gap:0;min-width:0}
.wire-admin-detail-head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3)}
.wire-admin-detail-name{margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.wire-admin-section{display:grid;gap:var(--space-3);margin-top:var(--space-6)}
.wire-admin-section>h2{margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
.wire-admin-form{display:grid;gap:var(--space-4);margin-top:var(--space-5)}
.wire-admin-form-row{display:flex;gap:var(--space-3);align-items:flex-end;margin-top:var(--space-5)}
.wire-admin-form-row .wire-search{flex:1 1 auto;min-width:0}
.wire-admin-form-row .wire-button{flex:none}
/* .wire-admin-caption 은 지웠다(CCC-63). 유일한 사용처가 '초대 보내기' 스텁 아래
   "Access 초대와 연동 예정" 한 줄이었고, 그 구획이 공용 안내줄(WireCallout)로 바뀌었다. */
/* 성공색은 이 시스템에 없다(D6·R4) — 완료 알림도 중립 잉크로 쓰고 문구로 알린다. */
.wire-admin-notice{margin:0 0 var(--space-3);color:var(--ink);font-weight:600}
@media(max-width:767px){
  .wire-admin-layout{flex-direction:column}
  .wire-admin-content{padding:var(--space-6) 0 var(--space-8)}
  .wire-admin-cols{grid-template-columns:1fr}
  .wire-admin-form-row{flex-direction:column;align-items:stretch}
}

/* PageTitle: 업무 도구 밀도 — 마케팅 랜딩의 큰 디스플레이 타입을 쓰지 않는다(§7-6).
   정렬은 **왼쪽**이다(2026-07-26). 가운데 정렬은 제목만 콘텐츠 축에서 떨어져 나와,
   페이지마다 제목 위치가 달라 보이는 원인이었다(설정 화면에서 특히). */
.wire-page-title{margin:0;text-align:start;font-size:var(--text-2xl);font-weight:600;line-height:var(--leading-tight);color:var(--ink)}
@media(max-width:767px){.wire-page-title{font-size:var(--text-xl)}}
/* 포커스(§5): 모든 조작 요소 공통, :focus-visible 만. */
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* ── 당사자 등록 화면(UI 수정 레인 B, 2026-07-30) ──
   규칙을 여기 두는 이유: .wire-register-form · .consent-fieldset · .wire-register-submit 은
   layout.tsx 에 있고 **자기 가입 폼(join/participant)·동의 수정 허브와 공유**한다. 그 규칙을 덮으면
   손대지 않은 화면 2개가 함께 바뀐다. 그래서 등록 화면에만 붙는 클래스로 범위를 좁혀 여기 둔다.
   (이 파일은 CSS 를 템플릿 리터럴로 담으므로 주석에 역따옴표를 쓰지 않는다 — 문자열이 끊긴다.) */
/* Y6: 폼을 카드 안에 넣었으므로 카드 밖 기준의 상단 여백(layout.tsx .wire-register-form)을 끈다. */
.register-card .wire-register-form{margin-top:0}
/* Y6: 풀폭 제출 버튼은 이 화면만의 예외였다. 그리드 항목이 늘어나지 않게 왼쪽에 세운다. */
.register-submit{justify-self:start}
/* 참여 사업 고정 표시(2026-07-30 Q): 고를 값이 아니라 이미 정해진 값이므로 입력칸이 아니다.
   민트 계열 = '사람·소속' 축이고 사업 라벨이 그 축에 든다(D34). 알약이 아니라 radius 6 이다 —
   행동 버튼이 아니다(§4-5, 사이드바 사업 전환기와 같은 이유). */
.register-program-fixed{display:inline-flex;align-items:baseline;gap:var(--space-2);margin:0;padding:var(--space-2) var(--space-3);border-radius:var(--radius-control);background:var(--mint-tint)}
.register-program-fixed-label{color:var(--mint-deep);font-size:var(--text-sm);font-weight:600}
.register-program-fixed-value{color:var(--ink);font-size:var(--text-sm);font-weight:600}
/* Y10 의 muted 배경은 D59 플랫화로 걷었다 — 동의 묶음은 이제 상자가 아니라 구분선이다. */
.consent-fieldset.register-consent>legend{font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
/* 서명 동의서 첨부 자리(2026-07-30 Q) — **일부러 조작할 수 없다.** 파일 입력도 버튼도 없다:
   올릴 수 있어 보이면 실무자가 스캔 동의서를 제출했다고 믿는다. 기능이 붙는 날 이 자리를 쓴다. */
.consent-upload-slot{display:grid;gap:var(--space-2);padding:var(--space-3);border:1px dashed var(--line-control);border-radius:var(--radius-control);background:var(--panel)}
.consent-upload-slot-label{color:var(--sub);font-size:var(--text-sm);font-weight:600}
/* '준비 중' 은 상태 표시다. 라벤더 = 'AI·승인 대기' 축이라 대기 상태가 그 축에 든다(D34).
   모양은 공용 배지(.wire-badge[data-tone="lavender"])가 갖고, 여기는 그리드 안 자리만 잡는다. */
.consent-upload-slot>.wire-badge{justify-self:start}
/* ── 날짜 선택(D48 · ADR-0020) ──────────────────────────────────────────────
   새 색·새 반경·새 그림자를 만들지 않는다 — 전부 기존 토큰의 조합이다.
   팝오버는 모달과 같은 표면 계약(흰 면 · radius 12 · --shadow-soft)이고 쌓임은
   드롭다운 층(z 30, DESIGN.md §4-5)이다. 테두리에 그라데이션을 두르지 않는다(§5 락). */
.wire-date-control{position:relative;display:flex;align-items:center;gap:var(--space-2);width:100%}
.wire-date-control>input{flex:1 1 auto;min-width:0}
/* 달력 버튼은 입력칸 높이에 맞춘 정사각형이다. 아이콘만 있으므로 접근성 이름은 aria-label 이 준다.
   아웃라인은 버튼 공통 그라데이션 1px(2026-08-26 Q 최종), 채움은 --button-fill 로만 바꾼다. */
.wire-date-toggle{--button-fill:var(--panel);flex:none;display:grid;place-items:center;line-height:normal;width:var(--control-height);height:var(--control-height);padding:0;border:1px solid transparent;border-radius:var(--radius-control);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--sub);cursor:pointer}
.wire-date-toggle:hover{--button-fill:var(--muted);color:var(--ink)}
.wire-date-toggle:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
.wire-date-toggle[aria-expanded="true"]{--button-fill:var(--blue-tint);color:var(--ink)}
.wire-date-popover{position:absolute;top:calc(100% + var(--space-2));left:0;z-index:var(--z-dropdown);display:block;padding:var(--space-3);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-soft)}

/* react-day-picker 덮어쓰기. 라이브러리 기본 accent 는 파랑 계열 링크색이라 D34 축과 다르다.
   블루 = '시간·상태' 축이므로 날짜 선택은 블루가 맞다(§1-5). */
.wire-date-popover .rdp-root{--rdp-accent-color:var(--blue);--rdp-accent-background-color:var(--blue-tint);--rdp-day-height:36px;--rdp-day-width:36px;--rdp-font-family:inherit;color:var(--ink)}
.wire-date-popover .rdp-month_caption{font-size:var(--text-md);font-weight:600;color:var(--ink)}
/* 요일 머리글은 라벨이다 — 14/700 --sub(§2). */
.wire-date-popover .rdp-weekday{font-size:var(--text-sm);font-weight:600;color:var(--sub);text-transform:none}
.wire-date-popover .rdp-day_button{border-radius:var(--radius-control);font-size:var(--text-sm);color:var(--ink);cursor:pointer}
.wire-date-popover .rdp-day_button:hover{background:var(--muted)}
.wire-date-popover .rdp-day_button:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* red — 선택일은 **면**을 블루 base 로 칠하고 글자는 --ink 다. --blue-deep 글자는 흰 위 대비
   2.47 로 WCAG 미달이고(§9 예외는 보조 정보 한정), 날짜는 읽어야 하는 값이다.
   (이 파일은 자바스크립트 템플릿 문자열이라 주석에 백틱을 쓰면 문자열이 끊긴다.) */
.wire-date-popover .rdp-selected .rdp-day_button{background:var(--blue);color:var(--ink);font-weight:600}
/* 오늘은 배경 틴트로만 표시한다 — 색만으로 구분하지 않도록 테두리도 함께 준다(KRDS). */
.wire-date-popover .rdp-today:not(.rdp-selected) .rdp-day_button{background:var(--blue-tint);border:1px solid var(--blue)}
.wire-date-popover .rdp-outside .rdp-day_button{color:var(--sub)}
.wire-date-popover .rdp-button_previous,.wire-date-popover .rdp-button_next{border-radius:var(--radius-control);color:var(--sub)}
.wire-date-popover .rdp-button_previous:focus-visible,.wire-date-popover .rdp-button_next:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}

/* 날짜 + 시각(2026-07-31 Q). 두 칸이 테두리 하나를 공유한다 — 하나의 값을 적는 자리이므로
   상자도 하나다. 다만 **그 상자는 여기서 그리지 않는다** — WireFormField 가 이미 모든 컨트롤을
   .wire-input-box(테두리 · radius · 초점 링)로 감싸고 있어서, 여기서 또 그리면 둥근 사각형이
   두 겹으로 겹치고 초점 링도 두 개가 된다. 이 껍데기는 배치와 세로 구분선만 맡는다.
   새 색·반경·그림자 0개. */
/* 높이는 **상자가 정한다**(2026-08-09). 안쪽 묶음이 40 을 직접 갖고 있어서 테두리 2px 이
   덧붙어 이 칸만 42 로 서 있었다(다른 입력칸 40, 하니스 실측). 안쪽은 늘어나기만 한다. */
/* 달력 버튼은 줄을 안 바꾼다(nowrap, CCC-93). 구 wrap 은 자리가 모자랄 때 **버튼을** 아래로
   내려보냈고, 그러면 버튼만 18px 로 눌린 채 홀로 서고 접혀야 할 두 입력칸은 그대로 남았다
   (폭 390 실측). 접히는 것은 안쪽 날짜·시각이어야 하므로 바깥은 줄을 고정하고, 자리가 모자라면
   .wire-datetime-fields 가 min-width:0 으로 줄어들다가 자기 안에서 두 줄이 된다. */
.wire-datetime-control{position:relative;display:flex;flex-wrap:nowrap;align-items:stretch;gap:var(--space-2);width:100%}
.wire-input-box>.wire-datetime-control{align-self:stretch}
/* 두 칸이 다 들어갈 자리가 없으면 **저절로 두 줄로 접힌다**(CCC-93). 접기 전에는 min-width
   104 + 112 가 이 묶음의 최소 폭을 259 로 잡고 있었고, 그 값이 상자(+26) 카드(+50)를 거쳐
   폭 390 에서 카드 최소 폭 371 을 만들어 들어갈 자리 343 을 28 넘겼다. 화면 전체가 12px
   밖으로 밀린 원인이 이것이다. 접히면 각 칸이 한 줄을 통째로 쓰므로 최소 폭이 132 로 떨어져
   여유가 99 생긴다. 값을 낮추는 대신 접는 이유는 104·112 가 12시간제에서 분이 잘리지 않는
   실측값이라서다(2026-08-07 Q 11차).

   화면 폭 분기를 새로 만들지 않는다 — 이 레포의 뷰포트 계단은 767 하나인데(D37) 그 폭에서는
   칸이 700 이라 접을 이유가 없고, 컨테이너 질의(880·1150)는 페이지 격자의 축이라 이 칸의
   폭을 모른다. 기준 폭을 px 로 두면 자리가 모자랄 때만 접혀 계단이 필요 없다.

   구분선은 **틈이 만든다** — 접히면 세로선이 가로선이 되어야 하는데 border 로는 방향을 못
   바꾼다. 묶음 바탕을 선 색으로 깔고 칸을 --panel 로 덮으면 남는 1px 이 곧 구분선이고, 한
   줄일 때는 세로로 두 줄일 때는 가로로 저절로 선다. */
/* optical: 1px 은 간격이 아니라 머리카락 선이다. 4의 배수 계단(--space-*)에 이 굵기가 없고,
   구분선 굵기는 다른 곳에서도 1px 이다(.wire-card-divider · --line-control 테두리). */
.wire-datetime-fields{flex:1 1 240px;min-width:0;display:flex;flex-wrap:wrap;align-items:stretch;gap:1px;background:var(--line-control)}
/* padding:0 은 UA 기본(1px 2px)을 걷는 값이다 — 안 걷으면 날짜칸 글자만 다른 입력칸보다
   2px 오른쪽에서 시작한다(2026-08-05 실측).
   height:100% 대신 min-height 를 쓴다 — 접히면 줄이 둘이라 100% 는 뜻을 잃는다(묶음 높이가
   내용에서 나오므로 순환이 되어 auto 로 풀리고, 칸이 글자 높이인 19 로 주저앉는다).
   40 이 아니라 40 빼기 2 인 이유: 상자(.wire-input-box)의 min-height 40 은 테두리를 포함한
   바깥 값이라(border-box) 안쪽에 남는 자리가 38 이다. 여기에 40 을 주면 상자가 42 로 커져
   옆에 선 다른 입력칸(40)과 높이가 갈린다 — 실제로 한 번 그렇게 났다. */
.wire-datetime-fields>input{min-height:calc(var(--control-height) - 2px);min-width:0;padding:0;border:0;border-radius:0;background:var(--panel);color:var(--ink);font-size:var(--text-sm);font-weight:400;line-height:normal}
/* 시각 칸의 네이티브 시계 아이콘은 끈다(2026-08-08 Q — 브라우저가 그리는 아이콘이라 다크
   테마에서 안 보였고, 달력 토글 하나로 충분하다). 파이어폭스는 원래 없다. */
.wire-datetime-fields>input[type="time"]::-webkit-calendar-picker-indicator{display:none}
.wire-datetime-fields>input:focus,.wire-datetime-fields>input:focus-visible{outline:none}
/* 날짜·시각은 **반반**이다(2026-08-07 Q 11차 "시간 필드가 너무 좁다" — 구 날짜 grow ·
   시각 128 고정은 날짜칸이 남는 폭을 다 가져갔다). 기준 폭을 둘 다 같은 px 로 두어 반반을
   지킨다 — 남는 폭을 똑같이 나눠 가지므로 한 줄에 설 때 폭이 정확히 같다(구 50%/50% 와
   같은 결과다). 50% 를 쓰면 둘의 합이 늘 100% 라 자리가 모자라도 접히지 않아 바꿨다. */
.wire-datetime-fields>input:first-child{flex:1 1 112px;min-width:104px;padding-right:var(--space-3)}
/* 시각 칸이 min-width 112 를 갖는 이유: 브라우저가 12시간제(오후 02:30)로 그릴 때가 있어
   그보다 좁으면 분이 잘린다.
   "좁은 화면에서는 줄어들어야 한다"고 적어 둔 자리가 여기다. 고정 폭을 min-width 로 바꿔
   반쯤 풀었지만 min-width 도 폭 390 에서는 안 들어갔고(카드가 28 넘쳤다), 그것을 위
   .wire-datetime-fields 의 접기가 마저 닫는다. 이제 이 값은 한 줄에 설 때만 폭을 정한다.
   구분선(구 border-left)은 묶음의 틈이 그린다 — 접히면 방향이 바뀌어야 하기 때문이다.
   (이 파일은 자바스크립트 템플릿 문자열이라 주석에 백틱을 쓰면 문자열이 끊긴다.) */
/* 달력 버튼도 같은 상자 안에 있으므로 테두리를 벗는다 — 상자 안의 상자를 만들지 않는다.
   날짜만 쓰는 자리(.wire-date-control)의 겉모습은 건드리지 않는다.

   ── 여백은 **상자가 아니라 글리프**가 지킨다 (2026-08-09 Q) ──
   버튼은 40 짜리 히트 영역 안에 16 글리프를 가운데 두므로, 상자를 입력칸 패딩(12) 안에
   그대로 세우면 글리프 오른쪽 여백이 12 + 12 = **25** 가 된다(하니스 실측). 왼쪽 글자는
   13 이라 눈에는 아이콘만 멀찍이 떨어져 보인다 — Q 가 지적한 그 어긋남이다.
   버튼 아웃라인을 보여 주는 쪽(그러면 24 가 버튼 패딩으로 읽힌다)은 상자 안의 상자를
   만들어 D60 ② 와 부딪히므로, **버튼을 패딩만큼 되밀어 글리프를 13 에 세운다.**
   히트 영역 40 은 그대로다. 오른쪽 모서리만 둥글려 호버 채움이 상자 곡선을 따라간다. */
.wire-datetime-control>.wire-date-toggle{
  border-color:transparent;
  background:transparent;
  height:auto;
  align-self:stretch;
  margin-right:calc(var(--space-3) * -1);
  border-radius:0 var(--radius-control) var(--radius-control) 0;
}
.wire-datetime-control>.wire-date-toggle:hover{background:var(--muted)}
/* 시각은 세로선에 붙는 좌측정렬이다(2026-08-07 Q 12차 — 구 가운데 정렬 대체). 왼쪽 12 는
   날짜칸이 상자 테두리에서 들어가는 값(.wire-input-box 패딩)과 같은 리듬이다. */
.wire-datetime-fields>.wire-datetime-time{flex:1 1 112px;min-width:112px;padding:0 var(--space-2) 0 var(--space-3);text-align:left}
/* 팝오버는 달력 + 시각 목록 두 단이다. 목록은 달력 높이에 맞춰 스크롤한다.
   width:max-content 가 필요하다 — 절대 위치 요소의 자동 폭은 **감싸는 상자 폭**이 상한이라
   그냥 두면 입력칸 폭(약 330px)에 갇혀 시각 목록이 달력 아래로 접힌다. */
.wire-datetime-popover{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--space-3);width:max-content;max-width:min(92vw,480px)}
/* position:relative 는 장식이 아니다 — 선택된 시각으로 목록을 감을 때 offsetTop 의 기준
   (offsetParent)이 이 목록이어야 한다. 없으면 기준이 바깥 컨트롤이라 엉뚱한 곳으로 감긴다. */
.wire-time-list{position:relative;display:flex;flex-direction:column;gap:var(--space-0-5);width:96px;max-height:296px;overflow-y:auto;padding-right:var(--space-1)}
.wire-time-slot{flex:none;padding:var(--space-1-5) var(--space-2);border:1px solid transparent;border-radius:var(--radius-control);background:transparent;color:var(--ink);font-size:var(--text-sm);font-variant-numeric:tabular-nums;text-align:center;cursor:pointer}
.wire-time-slot:hover{background:var(--muted)}
.wire-time-slot:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 선택된 시각도 날짜와 같은 규칙이다 — 면을 블루 base 로 칠하고 글자는 --ink 다.
   읽어야 하는 값에 deep 글자를 쓰지 않는다(§9 대비 예외는 보조 정보 한정). */
.wire-time-slot[aria-pressed="true"]{background:var(--blue);color:var(--ink);font-weight:600}
.wire-datetime-popover-foot{flex:1 0 100%;display:flex;justify-content:flex-end;padding-top:var(--space-2);border-top:1px solid var(--line)}
.wire-datetime-done{--button-fill:var(--panel);display:inline-flex;align-items:center;justify-content:center;line-height:normal;height:var(--pill-height);padding:0 var(--space-4);border:1px solid transparent;border-radius:var(--radius-control);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-size:var(--text-sm);font-weight:600;cursor:pointer}
.wire-datetime-done:hover{--button-fill:var(--muted)}
.wire-datetime-done:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
@media (max-width:767px){
  .wire-date-popover{left:auto;right:0}
  /* 좁은 화면에서는 시각 목록을 달력 아래 가로 줄로 눕힌다 — 세로 목록이면 팝오버가 화면을 넘는다. */
  .wire-datetime-popover .wire-time-list{flex-direction:row;flex-wrap:wrap;width:100%;max-height:none;overflow:visible}
}

/* /kit 데모 전용 */
.wire-kit-section{display:grid;gap:var(--space-4);margin-block:var(--space-10)}
.wire-kit-heading{margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
.wire-kit-caption{margin:0;font-size:var(--text-sm);color:var(--sub)}
.wire-kit-stack{display:grid;gap:var(--space-3)}
.wire-kit-row{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-start}
.wire-kit-swatch{display:grid;place-items:center;min-height:60px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--muted);color:var(--sub);font-size:var(--text-sm)}
/* 나란히 놓고 보는 두 칸(고치기 전 / 고친 후). 좁아지면 위아래로 선다. */
.wire-kit-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:var(--space-5)}
.wire-kit-compare-label{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
/* **반례 전용이다. 새 화면에서 이 셋을 쓰지 않는다.**
   2026-08-10 이전 15초 페이지의 AI 제안이 실제로 입고 있던 옷을 그대로 보존한 것이고,
   /kit 의 비교 구획에서 "고치기 전"을 보이려고만 남긴다. 값 자체는 전부 토큰이라
   pnpm guard:tokens 를 통과한다 — 검사가 못 보는 것이 조합이라는 사실의 실물 증거다.
   조합이 어긋난 자리 둘: 이유 줄이 16/400 --sub(위계 4단 표에 없는 조합)이고,
   링크가 제목과 완전히 같은 16/600 --ink 라 먼저 읽을 것이 사라진다. */
.wire-kit-flat{display:grid;gap:var(--space-1)}
.wire-kit-flat>p{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.wire-kit-flat>p.is-reason{font-weight:400;color:var(--sub)}
.wire-kit-flat>a{justify-self:start;font-size:var(--text-md);font-weight:600;color:var(--ink);text-decoration:underline}
`;
