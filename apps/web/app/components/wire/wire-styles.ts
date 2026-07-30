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
/* ── 떠 있는 표면(카드 계약) ── 흰 배경 · radius 12 · **회색 --line 1px** · --shadow-soft.
   pen 의 'C · 카드'는 테두리가 아예 없고 이중 파스텔 그림자만으로 뜬다. 그라데이션 테두리를
   가진 컴포넌트는 **리스크 배너 하나뿐**이다 — 그것이 배너를 서게 하는 장치이기 때문이다(D9).
   그래서 모든 카드에 그라데이션을 두르면 두 가지가 동시에 망가진다: 화면이 촌스러워지고
   (2026-07-26 Q 지적), 리스크 배너가 다른 카드와 구별되지 않는다.
   여기서는 캔버스(#FAFAF9) 위 흰 카드가 그림자만으로는 약해 **회색 1px** 을 기본으로 두고,
   **선택·활성일 때만** 그라데이션으로 바꾼다.
   채움을 바꿀 때는 --surface-fill 만 바꾼다(선택 상태는 배경 2겹이라 background 를 덮으면 테두리가 날아간다). */
.surface-card{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
/* 선택·활성 표면: 여기서만 브랜드 그라데이션 테두리를 쓴다. border-image 는 radius 를 죽이므로
   배경 2겹(padding-box + border-box)으로 만든다(DESIGN.md 3-3). */
/* details 로 만든 카드는 **펼친 것이 곧 활성**이다(D47 상담 기록 회차 카드). 상태가 브라우저
   쪽에서 바뀌므로 data 속성 대신 [open] 을 같은 규칙에 얹는다 — 어휘가 갈라지지 않는다. */
.surface-card[data-selected="true"],.surface-card[aria-current="true"],.surface-card[open],.is-selected-surface{
  border-color:transparent;
  background:linear-gradient(var(--surface-fill),var(--surface-fill)) padding-box,var(--gradient-brand) border-box;
}
/* 셸: 새 앱 헤더가 올라가는 전 페이지 컨테이너. body 배경은 덮지 않고 이 래퍼에만 캔버스색. */
.wire-shell{min-height:100dvh;background:var(--canvas)}
/* GridContainer: 페이지 안의 **섹션 스택**이다. 장폭·좌우 여백은 갖지 않는다 —
   그건 .page-content(셸) 의 일이다(2026-07-26).
   이전에는 여기에 고정 거터 230px 이 박혀 있어 셸의 여백과 겹쳤고, 화면 폭이 바뀌면
   콘텐츠 컬럼만 제멋대로 늘었다 줄었다 했다. 폭 결정권을 한 곳으로 모은 결과 이 클래스는
   "세로 리듬"만 담당한다. width prop 은 호출부 호환을 위해 남아 있으나 폭을 정하지 않는다. */
.wire-container{width:100%;display:grid;gap:var(--section-gap);align-content:start}
.wire-container[data-grid="true"]{grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--space-5);row-gap:var(--space-5)}
.wire-col-3{grid-column:span 3}
.wire-col-4{grid-column:span 4}
.wire-col-6{grid-column:span 6}
/* col-8 은 인테이크 위저드(단계 목록 4 + 본문 8)가 쓰는데 규칙이 없어 span 이 안 먹었다 —
   본문이 12분의 1 칸으로 떨어져 글줄이 몇 어절에서 끊겼다(2026-07-26 확인). */
.wire-col-8{grid-column:span 8}
.wire-col-12{grid-column:span 12}
@media(max-width:767px){
  .wire-container[data-grid="true"]{grid-template-columns:1fr}
  .wire-col-3,.wire-col-4,.wire-col-6,.wire-col-12{grid-column:auto}
}
/* ── 카드 목록 ── 기본은 폭 전체를 쓰고, 칸이 늘어나면 --grid-min 을 기준으로 열이 갈린다
   (D37 §4-2: 표준 420 → 1120 에서 2열 각 510 · 화면 1180 미만에서 1열). 화면마다
   grid-template-columns 를 다시 쓰지 않고 **열 수도 직접 지정하지 않는다**(락 10).
   auto-fill 이 아니라 **auto-fit** 이다 — auto-fill 은 빈 트랙을 남겨서 카드가 1개일 때도
   화면 절반만 차지한다(2026-07-26 Q 지시: 기본은 폭 전체). */
.card-grid{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));align-items:start}
/* 조밀 그리드 — GAS 게이지·정보 필드처럼 작은 칸이 여럿일 때(D37 §4-2, 최소 280 → 3열).
   **3열 아니면 1열이다** — 2열이면 3개짜리 묶음(D33 세부 목표)이 둘 + 외톨이 하나로 앉는다. */
.card-grid-dense{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min-dense)),1fr));align-items:start}
@container (max-width:879px){.card-grid-dense{grid-template-columns:minmax(0,1fr)}}
/* 목록 위 조작 줄(정렬·필터 등). 왼쪽이 주 조작, 오른쪽이 보조다. 아래 여백은 주지 않는다 —
   섹션 간격은 페이지 셸(--section-gap)이 갖는다. */
.list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-5);flex-wrap:wrap}
/* 인라인 강조 링크. AppHeader(D35 로 폐기) 시절 클래스지만 관리자 사용자 상세가 계속 쓴다. */
.wire-header-link{font-size:16px;font-weight:700;color:var(--ink)}
.wire-header-link:hover{text-decoration:underline}
/* 이름 표기 (D34 · DESIGN.md §5): "이름 (가명 ID)" 한 줄. 띄어쓰기는 문자열이 아니라
   간격 4로 만든다 — ID의 색·굵기가 실명과 달라야 하기 때문이다. 실명 크기는 자리마다
   다르므로 인라인 스타일이 정하고, 가명 ID는 자리와 무관하게 항상 16/400 --sub 다. */
.participant-name-group{display:inline-flex;align-items:baseline;gap:var(--space-1);flex-wrap:wrap}
.participant-name{color:var(--ink);font-weight:700;overflow-wrap:anywhere}
.participant-pseudonym{color:var(--sub);font-size:16px;font-weight:400}
/* ParticipantHeroCard (D38 · DESIGN.md §5): 당사자 중심 화면의 공통 머리.
   .page-header(flex) + .surface-card(카드 계약) 위에 안쪽 구조만 정한다.
   브리핑의 .briefing-hero 와 같은 구조이나 부품이 공유된다. */
.participant-hero-card{padding:var(--space-6);gap:var(--space-5)}
.participant-hero-identity{display:grid;gap:var(--space-2);min-width:0}
.participant-hero-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:28px;line-height:1.25}
/* 상태 태그는 컨트롤이다(§5) — 배지(pill)가 아니라 radius 6 · --blue-deep 1px 테두리.
   시간·상태 축이라 블루다(D34). 줄바꿈하지 않는다. */
.participant-hero-stage{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--blue-deep);border-radius:var(--radius-control);background:transparent;font-size:14px;font-weight:700;color:var(--blue-deep);white-space:nowrap}
.participant-hero-meta{margin:0;color:var(--sub);font-size:14px}
/* 목록 아래 안내 한 줄. 본문 흐름의 보조 정보라 14/400 --sub 다. */
.note-inline{color:var(--sub);font-size:14px}
.note-inline a{color:var(--blue-deep);font-weight:700;text-decoration:underline}
/* 당사자 목록 — 찾기 칸 + 행 목록. 행은 gap 그리드에 낱개로 놓이므로 카드 계약을 쓴다
   (DESIGN.md §5 '리스트 행' — 낱개는 카드, 붙어 있으면 구분선). */
.participant-search-layout{display:grid;gap:var(--space-5)}
/* 당사자 행도 카드다 — 수가 늘면 열이 갈린다(2026-07-26 Q 지시). */
.participant-row-list{display:grid;gap:var(--space-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));align-items:start}
/* 당사자 정보 허브 (D35 §3 · D36). 카드 계약(.surface-card)은 그대로 쓰고 안쪽만 정한다. */
.participant-contact{display:grid;gap:var(--space-1);margin:0 0 var(--space-6)}
/* 사람 정보 라벨은 민트 계열(D34). */
.participant-contact dt{color:var(--mint-deep);font-size:14px;font-weight:700}
.participant-contact dd{margin:0;color:var(--ink);font-size:16px;font-weight:700}
.participant-program-list{display:grid;gap:var(--space-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));align-items:start}
.participant-program{display:grid;gap:var(--space-2);padding:var(--space-5) var(--space-6)}
/* 배지는 줄바꿈하지 않는다 — 사업명이 길면 "진행/중" 으로 쪼개져 읽힌다. */
.participant-program-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4)}
.participant-program-head .status{flex:none;white-space:nowrap}
.participant-program-meta{margin:0;color:var(--sub);font-size:14px}
.participant-program-assignee{display:flex;gap:var(--space-2);align-items:baseline;font-size:14px;color:var(--ink)}
.participant-program-assignee-label{color:var(--mint-deep);font-weight:700}
.participant-program-actions{display:flex;gap:var(--space-3);margin-top:var(--space-3)}
/* 담당하지 않는 사업(D36): 잠긴 이유를 문장으로 남긴다. 색이 아니라 문장이 알린다 —
   리스크 색은 리스크 배너 독점이다(D9·D34). */
.participant-program[data-locked="true"]{background:var(--muted)}
.participant-program-locked{margin:var(--space-3) 0 0;color:var(--sub);font-size:14px}
/* 동의 2종 수정(D44 · 항목 수는 D49). 등록 폼의 consent-fieldset 를 그대로 재사용하고 카드 안 간격만 준다. */
.participant-program-consent{margin-top:var(--space-4)}
.participant-program-consent-meta{margin:var(--space-2) 0 var(--space-3);color:var(--sub);font-size:13px}
/* 참여 사업 목록을 좁은 화면에서 1열로 강제하던 규칙은 지웠다 — --grid-min 420 이 이미 접는다. */
/* ListRow (§5 리스트 행): 패딩 16/24 · 호버 --muted.
   화면들이 행을 gap 으로 띄운 그리드에 낱개로 놓으므로, 행 사이 구분선 대신 카드 표면을 쓴다
   (구분선 계약은 행이 한 컨테이너 안에 붙어 있을 때 성립한다 — 이 차이는 STATUS 에 남긴다).
   호버·선택은 --surface-fill 만 바꾼다: background 를 덮으면 그라데이션 테두리가 사라진다. */
.wire-row{display:flex;align-items:center;gap:var(--space-3);width:100%;min-height:72px;padding:var(--space-4) var(--space-6);font-size:16px;font-weight:700;text-align:left;cursor:pointer}
button.wire-row{font:inherit;font-size:16px;font-weight:700}
.wire-row:hover{--surface-fill:var(--muted)}
.wire-row[data-static="true"]{cursor:default}
.wire-row[data-static="true"]:hover{--surface-fill:var(--panel)}
.wire-row[data-selected="true"]{--surface-fill:var(--muted)}
.wire-row[data-align="center"]{justify-content:center;text-align:center}
.wire-row-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.wire-row[data-align="center"] .wire-row-text{flex:0 1 auto}
.wire-chevron{flex:none;width:10px;height:10px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub)}
.wire-chevron[data-dir="down"]{transform:translateY(-3px) rotate(45deg)}
.wire-chevron[data-dir="right"]{transform:translateX(-3px) rotate(-45deg)}
/* WireCard (§5 카드): 헤더/본문을 --gradient-brand 1px 선으로 나눈다. */
.wire-card{padding:var(--space-6)}
.wire-card-title{margin:0;font-size:18px;font-weight:700;line-height:1.35;color:var(--ink)}
.wire-card-divider{height:1px;margin:var(--space-4) 0;background:var(--gradient-brand);border:0}
.wire-card-body{display:grid;gap:var(--space-3)}
/* 제목과 상태 배지가 함께 오는 카드 헤더. 배지는 줄바꿈하지 않는다(사업명 카드와 같은 이유). */
.wire-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4)}
.wire-card-head .status,.wire-card-head .wire-badge{flex:none;white-space:nowrap}
/* 카드 안 하위 구획. h3 에 규칙이 없어 브라우저 기본 크기(18.7px)가 그대로 나오던 자리다 —
   카드 제목(18)과 크기가 겹쳐 위계가 없었다. 구획 제목은 라벨이므로 14/700 --sub 다. */
.wire-card-section{display:grid;gap:var(--space-2)}
.wire-card-section>h3{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
/* 수기 메모는 실무자가 줄바꿈한 그대로 읽혀야 한다. */
.wire-card-section>p{margin:0;font-size:16px;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.wire-card-section>ul{margin:0;padding:0;display:grid;gap:var(--space-2);list-style:none;font-size:16px;color:var(--ink)}
/* 정보 필드(§5): 라벨 14/700 민트 deep 위 · 값 16 아래. */
.wire-field-row{display:grid;grid-template-columns:80px minmax(0,1fr);gap:var(--space-3);align-items:baseline}
.wire-field-label{color:var(--mint-deep);font-size:14px;font-weight:700}
.wire-field-value{color:var(--ink);font-size:16px;overflow-wrap:anywhere}
/* 불릿 목록(§5): 6px 원형 --sub 불릿 + 16/400. */
.wire-bullets{margin:0;padding-left:0;display:grid;gap:var(--space-2);list-style:none;color:var(--ink);font-size:16px}
.wire-bullets>li{position:relative;padding-left:var(--space-4)}
.wire-bullets>li::before{content:"";position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:var(--radius-pill);background:var(--sub)}
/* SearchInput (§5 입력칸): 높이 40 · radius 6 · --line-control 1px · 라벨은 항상 위. */
.wire-search{display:grid;gap:var(--space-2)}
.wire-search-label{font-size:14px;font-weight:700;color:var(--sub)}
.wire-search-box{display:flex;align-items:center;gap:var(--space-2);width:100%;min-height:var(--control-height);padding:0 var(--space-3);background:var(--panel);border:1px solid var(--line-control);border-radius:var(--radius-control)}
.wire-search-box input,.wire-search-box select{width:100%;border:0;background:transparent;color:var(--ink);outline:0;font-size:16px;-webkit-appearance:none;appearance:none}
/* select 는 네이티브 화살표를 끄고 꺽쇠를 직접 그린다 — 네이티브는 테두리에 붙어 다른 입력칸과 안 맞는다. */
.wire-search-box select{padding-right:var(--space-6)}
.wire-search-box .wire-chevron{margin:0}
.wire-search-box:focus-within{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 입력 오류(§5): 테두리 1.5px --risk + 아래 메시지. 색만으로 알리지 않는다. */
.wire-search-box[data-invalid="true"]{border:1.5px solid var(--risk)}
.wire-field-error{margin:0;font-size:14px;font-weight:700;color:var(--risk)}
/* WireFormField (§5 입력칸) — 검색칸과 **같은 계약**을 폼에서 쓰는 형태다. 검색칸 규칙을
   .wire-search-box 에 묶어 둔 탓에 폼 화면들이 레거시 .field 로 각자 그리고 있었다.
   박스 규칙은 검색칸과 한 글자도 다르지 않고, 폼에만 필요한 것(필수 별표·도움말·오류 자리)만 는다. */
.wire-form-field{display:grid;gap:var(--space-2)}
.wire-form-label{font-size:14px;font-weight:700;color:var(--sub)}
/* 필수 별표는 --risk 지만 리스크 독점(D9)의 예외가 아니다 — 오류·필수 표시는 §9 가 허용한 자리다. */
.wire-form-required{color:var(--risk)}
/* 라벨 옆 '(선택)' 같은 보조 문구. 라벨과 같은 줄이므로 굵기만 낮춘다. */
.wire-form-note{margin-left:var(--space-1);color:var(--sub);font-weight:400}
.wire-input-box{display:flex;align-items:center;gap:var(--space-2);width:100%;min-height:var(--control-height);padding:0 var(--space-3);background:var(--panel);border:1px solid var(--line-control);border-radius:var(--radius-control)}
.wire-input-box>input,.wire-input-box>select,.wire-input-box>textarea{width:100%;min-width:0;border:0;background:transparent;color:var(--ink);outline:0;font:inherit;font-size:16px;font-weight:400;-webkit-appearance:none;appearance:none}
/* select 는 네이티브 화살표를 끄고 꺽쇠를 직접 그린다(검색칸과 같은 이유). */
.wire-input-box>select{padding-right:var(--space-6)}
/* textarea 는 박스가 세로로 늘어난다 — 높이 40 고정은 한 줄 컨트롤 계약이다. */
.wire-input-box[data-control="textarea"]{align-items:stretch;padding:var(--space-3)}
/* min-height 를 0 으로 되돌리는 이유: layout.tsx 의 전역 textarea 규칙(min-height 216px)이
   rows 지정을 덮어써서 rows=4 인 담당 실무자 의견과 rows=14 인 수기 메모가 같은 높이로 나온다.
   전역 규칙은 아직 레거시 화면들이 기대고 있어 두고, 킷 입력칸 안에서만 rows 가 높이를 정한다.
   (이 파일은 백틱 템플릿 리터럴이다 — 주석에 백틱을 쓰면 문자열이 거기서 끊긴다.) */
.wire-input-box>textarea{min-height:0;resize:vertical;line-height:1.6}
.wire-input-box:focus-within{outline:2px solid var(--blue-deep);outline-offset:2px}
.wire-input-box[data-invalid="true"]{border:1.5px solid var(--risk)}
.wire-form-hint{font-size:14px;font-weight:400;color:var(--sub)}
.wire-form-hint a{color:var(--blue-deep);font-weight:700;text-decoration:underline}
/* 폼을 담은 카드는 본문 간격을 한 단 넓힌다 — 입력칸은 라벨·도움말을 달고 있어
   정보 카드(12)의 간격으로는 항목 경계가 안 읽힌다. */
.wire-form-card>.wire-card-body{gap:var(--space-5)}
/* 폼 2열. 화면마다 grid-template-columns 를 다시 쓰지 않는다(.card-grid 와 같은 취지). */
.wire-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-5)}
/* 폼 하단 버튼 줄: 오른쪽 정렬, 프라이머리가 오른쪽 끝(모달 하단과 같은 어휘). */
.wire-form-actions{display:flex;justify-content:flex-end;gap:var(--space-3)}
@media(max-width:767px){
  .wire-form-grid{grid-template-columns:minmax(0,1fr)}
}
/* WireChoice (§5 선택지 행): 컨트롤과 라벨이 같은 줄, 누를 면적은 컨트롤 높이(40)만큼.
   입력칸 규칙(width:100%)을 상속시키지 않는 것이 이 클래스의 존재 이유다. */
.wire-choice{display:flex;align-items:flex-start;gap:var(--space-3);min-height:var(--control-height);padding:var(--space-2) 0;font-size:16px;font-weight:700;color:var(--ink);cursor:pointer}
.wire-choice>input{margin:var(--space-1) 0 0}
.wire-choice-text{display:grid;gap:var(--space-1);min-width:0;overflow-wrap:anywhere}
.wire-choice-desc{color:var(--sub);font-size:14px;font-weight:400}
.wire-choice:has(>input:disabled){color:var(--sub);cursor:not-allowed}
/* 폼 안 묶음(fieldset). 카드 안에 또 카드를 두지 않도록 --line 1px 만 두르고 그림자는 없다. */
.wire-fieldset{display:grid;gap:var(--space-3);min-width:0;margin:0;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-card)}
.wire-fieldset>legend{padding:0 6px;font-size:14px;font-weight:700;color:var(--sub)}
.wire-fieldset>legend small{font-weight:400}
.wire-fieldset-list{display:grid;gap:var(--space-4)}
/* 선택지 묶음: 짧은 선택지는 한 줄에 여러 개, 길면 자연스럽게 접힌다. */
.wire-choice-group{display:flex;flex-wrap:wrap;gap:0 var(--space-6)}
.wire-choice-group[data-layout="stack"]{flex-direction:column;gap:0}
/* 라디오(§5): 체크박스와 같은 계약이고 모양만 원형이다. 선택 표시는 가운데 --ink 점.
   체크박스와 같은 이유로 ::after 가 아니라 background 로 그린다(input 은 replaced element). */
.wire-radio{flex:none;width:18px;height:18px;appearance:none;-webkit-appearance:none;margin:0;padding:0;border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box;cursor:pointer}
.wire-radio:checked{background:radial-gradient(circle at center,var(--ink) 0 4px,transparent 4px) padding-box,linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box}
.wire-radio:disabled,.wire-checkbox:disabled{background:linear-gradient(var(--muted),var(--muted)) padding-box,linear-gradient(var(--line),var(--line)) border-box;cursor:not-allowed}
/* WireButton (§5 버튼 4종 × 크기 2단). 크기 변형은 높이·패딩·라벨만 다르고 색 규칙은 같다.
   **라벨은 줄바꿈하지 않는다**(R7 · 2026-07-30): 한글은 어디서나 끊길 수 있어 칸이 좁아지면
   '당사자 정 / 보' 처럼 낱글자로 쪼개진다. 버튼은 한 번에 읽히는 한 덩어리라 넘칠지언정
   쪼개지지 않는 쪽이 옳다 — 좁은 화면의 자리는 세로 배치가 만든다(layout.tsx 768 미만). */
.wire-button{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-4);border:1px solid var(--line-control);border-radius:var(--radius-pill);background:var(--panel);color:var(--ink);font-size:16px;font-weight:700;text-align:left;white-space:nowrap;cursor:pointer}
.wire-button[data-height="sm"]{min-height:var(--pill-height);padding:0 14px;font-size:14px}
/* 프라이머리: --gradient-action 배경 + --line-action 1px + --shadow-soft. */
.wire-button[data-variant="primary"]{background:var(--gradient-action);border:1px solid var(--line-action);color:var(--ink);box-shadow:var(--shadow-soft)}
/* 고스트: 배경·테두리 없음, --sub 글자. */
.wire-button[data-variant="ghost"]{background:transparent;border-color:transparent;color:var(--sub);box-shadow:none}
/* 위험: 되돌리기 어려운 행동에만. */
.wire-button[data-variant="danger"]{background:var(--panel);border:1.5px solid var(--risk);color:var(--risk);box-shadow:none}
.wire-button[data-justify="center"]{justify-content:center}
.wire-button[data-justify="between"]{justify-content:space-between}
.wire-button[data-justify="between"] .wire-button-text{flex:1 1 auto}
.wire-button:disabled,.wire-button[aria-disabled="true"]{background:var(--muted);border-color:var(--line);color:var(--sub);box-shadow:none;cursor:not-allowed}
.wire-button:disabled .wire-chevron,.wire-button[aria-disabled="true"] .wire-chevron{border-color:var(--sub)}
.wire-button .wire-chevron{border-color:currentColor}
/* 메타 줄(§10): 구분자 가운뎃점 대신 조각을 독립 노드로 두고 간격으로 띄운다. */
.wire-meta-row{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-3)}
/* 배지·칩(§5): 높이 24 · 패딩 0 10 · 14/700. 기본형은 색 없이 --sub 테두리로만 선다. */
.wire-badge{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:14px;font-weight:700;color:var(--sub)}
/* 계열 배지: tint 배경 + deep 글자. 민트=사람·소속, 라벤더=AI·승인 대기, 블루=시간·상태. */
.wire-badge[data-tone="mint"]{border-color:transparent;background:var(--mint-tint);color:var(--mint-deep)}
.wire-badge[data-tone="lavender"]{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.wire-badge[data-tone="blue"]{border-color:transparent;background:var(--blue-tint);color:var(--blue-deep)}
/* 상태 태그: 눌러서 상태를 바꾸는 컨트롤이라 radius 6 · 블루 deep 1px 테두리(배지가 아니다). */
.wire-status-tag{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--blue-deep);border-radius:var(--radius-control);background:transparent;font-size:14px;font-weight:700;color:var(--blue-deep)}
/* 체크박스(§5): 18px · radius 4 · --gradient-deep 1px 테두리. 리스크 변형은 테두리만 --risk. */
.wire-checkbox{flex:none;width:18px;height:18px;appearance:none;-webkit-appearance:none;margin:0;padding:0;border:1px solid transparent;border-radius:var(--radius-xs);background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box;cursor:pointer}
/* 리스크 변형: 테두리만 --risk 로 바꾼다(2026-07-26 Q 결정). 나머지는 기본과 같다.
   테두리를 불투명 단색으로 덮으므로 아래 그라데이션 레이어는 보이지 않는다. */
.wire-checkbox[data-tone="risk"]{border:1px solid var(--risk)}
/* 체크 표시는 ::before/::after 가 아니라 background-image 로 그린다.
   이유: input 은 replaced element 라 Firefox 가 생성 콘텐츠를 렌더하지 않는다 — ::after 로 그리면
   Firefox 에서 체크 표시가 조용히 사라져 선택·미선택이 구분되지 않는다. 동의 체크박스(D23)에서는
   그게 가장 위험한 자리다. background-image 는 전 브라우저에서 동작한다.
   data URI 안에는 var() 를 쓸 수 없어 획 색만 hex 로 박힌다 — --ink(#3D3445)·--risk(#F071B4)와
   같은 값이며, 토큰이 바뀌면 이 두 줄도 함께 고쳐야 하는 유일한 자리다. */
.wire-checkbox:checked{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.5 12.5l5 5 10-11' fill='none' stroke='%233D3445' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat,linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box}
.wire-checkbox[data-tone="risk"]:checked{background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.5 12.5l5 5 10-11' fill='none' stroke='%23F071B4' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat,linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-deep) border-box}
/* 빈 상태(§5): 무채색만. 라인 아이콘 28 + 제목 16/700 + 설명 14/400 + 다음 행동 버튼. */
.wire-empty{display:grid;justify-items:center;gap:var(--space-2);padding:var(--space-10) var(--space-6);text-align:center}
.wire-empty-icon{width:28px;height:28px;color:var(--sub)}
.wire-empty-title{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.wire-empty-desc{margin:0;max-width:34ch;font-size:14px;color:var(--sub)}
.wire-empty>.wire-button{margin-top:var(--space-2)}
/* 탭(§5): 활성은 색이 아니라 대비로 구분한다. */
.wire-tabs{display:flex;gap:var(--space-6);border-bottom:1px solid var(--line)}
.wire-tab{padding:var(--space-2) 0;border:0;border-bottom:2px solid transparent;background:none;color:var(--sub);font-size:16px;font-weight:700;cursor:pointer}
.wire-tab[aria-selected="true"],.wire-tab[data-active="true"]{color:var(--ink);border-bottom-color:var(--ink)}
/* 인용 블록(§5): AI 제안의 근거 발언 전용. 세로선은 --gradient-brand-v(흐르는 방향과 같게). */
.wire-quote{margin:0;padding-left:var(--space-3);border-left:2px solid transparent;background:var(--gradient-brand-v) left/2px 100% no-repeat;font-size:14px;color:var(--sub)}
.wire-quote-time{display:block;margin-top:var(--space-1);font-size:14px;font-weight:700;color:var(--sub);letter-spacing:var(--tracking-numeric)}
/* 모달(§5): 폭 520 · radius 12 · 스크림 rgba(61,52,69,.4) · --shadow-modal.
   하단 버튼 줄은 오른쪽 정렬, 세컨더리가 왼쪽·프라이머리가 오른쪽 끝. */
.wire-scrim{position:fixed;inset:0;z-index:var(--z-modal);display:grid;place-items:center;padding:var(--space-6);background:rgba(61,52,69,.4)}
.wire-modal{width:100%;max-width:520px;padding:var(--space-6);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-modal)}
.wire-modal-title{margin:0;font-size:18px;font-weight:700;color:var(--ink)}
.wire-modal-desc{margin:var(--space-2) 0 0;font-size:16px;color:var(--sub)}
.wire-modal-body{margin-top:var(--space-5)}
.wire-modal-actions{display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)}
/* 관리자 2차 내비(CCC-18a): 좌측 335px 컬럼 → 가로 탭. 셸 사이드바 옆에 기둥이 둘 서면
   "사이드바 = 장소"(D35)가 어느 쪽인지 읽히지 않는다. 탭 자체 규칙은 .wire-tab 이 갖고
   있고(DESIGN.md §5), 여기서는 좁은 화면 가로 스크롤만 더한다. */
.wire-admin-tabs{overflow-x:auto;scrollbar-width:none}
.wire-admin-tabs::-webkit-scrollbar{display:none}
.wire-admin-tabs .wire-tab{flex:none;white-space:nowrap}
/* 관리자 영역 레이아웃: 탭 아래 콘텐츠 한 단. */
.wire-admin-layout{display:block}
.wire-admin-content{min-width:0;padding:var(--space-6) 0 var(--space-10)}
.wire-admin-back{margin-bottom:var(--space-3)}
.wire-admin-back a{font-size:14px;font-weight:700;color:var(--sub)}
.wire-admin-back a:hover{text-decoration:underline}
.wire-admin-list{display:grid;gap:var(--space-3);margin-top:var(--space-5)}
/* 좌열(실무자 목록)은 '이메일  역할' 한 줄이 랩 없이 들어가는 최소 폭을 보장한다. */
.wire-admin-cols{display:grid;grid-template-columns:minmax(400px,1fr) minmax(0,1.2fr);gap:var(--space-6);margin-top:var(--space-6);align-items:start}
.wire-admin-cols>section{display:grid;gap:0;min-width:0}
.wire-admin-detail-head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3)}
.wire-admin-detail-name{margin:0;font-size:18px;font-weight:700;color:var(--ink);overflow-wrap:anywhere}
.wire-admin-section{display:grid;gap:var(--space-3);margin-top:var(--space-6)}
.wire-admin-section>h2{margin:0;font-size:18px;font-weight:700;color:var(--ink)}
.wire-admin-form{display:grid;gap:var(--space-4);margin-top:var(--space-5)}
.wire-admin-form-row{display:flex;gap:var(--space-3);align-items:flex-end;margin-top:var(--space-5)}
.wire-admin-form-row .wire-search{flex:1 1 auto;min-width:0}
.wire-admin-form-row .wire-button{flex:none}
.wire-admin-empty{margin:0;color:var(--sub);font-size:14px}
.wire-admin-caption{margin:6px 0 0;font-size:14px;color:var(--sub)}
/* 성공색은 이 시스템에 없다(D6·R4) — 완료 알림도 중립 잉크로 쓰고 문구로 알린다. */
.wire-admin-notice{margin:0 0 var(--space-3);color:var(--ink);font-weight:700}
.wire-admin-error{margin:0 0 var(--space-3);color:var(--risk);font-weight:700}
@media(max-width:767px){
  .wire-admin-layout{flex-direction:column}
  .wire-admin-content{padding:var(--space-6) 0 var(--space-8)}
  .wire-admin-cols{grid-template-columns:1fr}
  .wire-admin-form-row{flex-direction:column;align-items:stretch}
}

/* PageTitle: 업무 도구 밀도 — 마케팅 랜딩의 큰 디스플레이 타입을 쓰지 않는다(§7-6).
   정렬은 **왼쪽**이다(2026-07-26). 가운데 정렬은 제목만 콘텐츠 축에서 떨어져 나와,
   페이지마다 제목 위치가 달라 보이는 원인이었다(설정 화면에서 특히). */
.wire-page-title{margin:0;text-align:start;font-size:28px;font-weight:700;line-height:1.25;color:var(--ink)}
@media(max-width:767px){.wire-page-title{font-size:24px}}
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
.register-program-fixed-label{color:var(--mint-deep);font-size:13px;font-weight:700}
.register-program-fixed-value{color:var(--ink);font-size:14px;font-weight:700}
/* Y10(안 A): 카드 안에서는 그림자를 쓰지 않는다 — 카드 안에 또 카드가 되고 카드 계약과 어긋난다.
   테두리 1px 은 그대로 두고 배경만 한 톤 낮춰 '카드 안의 한 덩어리'로 읽히게 한다.
   선택자에 두 클래스를 겹치는 이유: layout.tsx 의 registerStyles 가 이 파일(wireStyles)보다
   **뒤에** 합쳐지므로(layout.tsx shellStyles), 같은 특정도면 저쪽 규칙이 이긴다. */
.consent-fieldset.register-consent{background:var(--muted)}
.consent-fieldset.register-consent>legend{color:var(--mint-deep)}
/* 서명 동의서 첨부 자리(2026-07-30 Q) — **일부러 조작할 수 없다.** 파일 입력도 버튼도 없다:
   올릴 수 있어 보이면 실무자가 스캔 동의서를 제출했다고 믿는다. 기능이 붙는 날 이 자리를 쓴다. */
.consent-upload-slot{display:grid;gap:var(--space-2);padding:var(--space-3);border:1px dashed var(--line-control);border-radius:var(--radius-control);background:var(--panel)}
.consent-upload-slot-label{color:var(--sub);font-size:14px;font-weight:700}
/* '준비 중' 은 상태 표시다. 라벤더 = 'AI·승인 대기' 축이라 대기 상태가 그 축에 든다(D34). */
.consent-upload-slot-state{justify-self:start;display:inline-flex;align-items:center;height:var(--badge-height);padding:0 var(--space-2);border-radius:var(--radius-pill);background:var(--lavender-tint);color:var(--lavender-deep);font-size:12px;font-weight:700}
/* ── 날짜 선택(D48 · ADR-0020) ──────────────────────────────────────────────
   새 색·새 반경·새 그림자를 만들지 않는다 — 전부 기존 토큰의 조합이다.
   팝오버는 모달과 같은 표면 계약(흰 면 · radius 12 · --shadow-soft)이고 쌓임은
   드롭다운 층(z 30, DESIGN.md §4-5)이다. 테두리에 그라데이션을 두르지 않는다(§5 락). */
.wire-date-control{position:relative;display:flex;align-items:center;gap:var(--space-2);width:100%}
.wire-date-control>input{flex:1 1 auto;min-width:0}
/* 달력 버튼은 입력칸 높이에 맞춘 정사각형이다. 아이콘만 있으므로 접근성 이름은 aria-label 이 준다. */
.wire-date-toggle{flex:none;display:grid;place-items:center;width:var(--control-height);height:var(--control-height);padding:0;border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--sub);cursor:pointer}
.wire-date-toggle:hover{background:var(--muted);color:var(--ink)}
.wire-date-toggle:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
.wire-date-toggle[aria-expanded="true"]{background:var(--blue-tint);color:var(--ink)}
.wire-date-popover{position:absolute;top:calc(100% + var(--space-2));left:0;z-index:30;display:block;padding:var(--space-3);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card);box-shadow:var(--shadow-soft)}

/* react-day-picker 덮어쓰기. 라이브러리 기본 accent 는 파랑 계열 링크색이라 D34 축과 다르다.
   블루 = '시간·상태' 축이므로 날짜 선택은 블루가 맞다(§1-5). */
.wire-date-popover .rdp-root{--rdp-accent-color:var(--blue-base);--rdp-accent-background-color:var(--blue-tint);--rdp-day-height:36px;--rdp-day-width:36px;--rdp-font-family:inherit;color:var(--ink)}
.wire-date-popover .rdp-month_caption{font-size:16px;font-weight:700;color:var(--ink)}
/* 요일 머리글은 라벨이다 — 14/700 --sub(§2). */
.wire-date-popover .rdp-weekday{font-size:14px;font-weight:700;color:var(--sub);text-transform:none}
.wire-date-popover .rdp-day_button{border-radius:var(--radius-control);font-size:14px;color:var(--ink)}
.wire-date-popover .rdp-day_button:hover{background:var(--muted)}
.wire-date-popover .rdp-day_button:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* red — 선택일은 **면**을 블루 base 로 칠하고 글자는 --ink 다. --blue-deep 글자는 흰 위 대비
   2.47 로 WCAG 미달이고(§9 예외는 보조 정보 한정), 날짜는 읽어야 하는 값이다.
   (이 파일은 자바스크립트 템플릿 문자열이라 주석에 백틱을 쓰면 문자열이 끊긴다.) */
.wire-date-popover .rdp-selected .rdp-day_button{background:var(--blue-base);color:var(--ink);font-weight:700}
/* 오늘은 배경 틴트로만 표시한다 — 색만으로 구분하지 않도록 테두리도 함께 준다(KRDS). */
.wire-date-popover .rdp-today:not(.rdp-selected) .rdp-day_button{background:var(--blue-tint);border:1px solid var(--blue-base)}
.wire-date-popover .rdp-outside .rdp-day_button{color:var(--sub)}
.wire-date-popover .rdp-button_previous,.wire-date-popover .rdp-button_next{border-radius:var(--radius-control);color:var(--sub)}
.wire-date-popover .rdp-button_previous:focus-visible,.wire-date-popover .rdp-button_next:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}

/* 날짜 + 시각. 좁은 화면에서는 세로로 쌓는다(§4-4 단일 브레이크포인트). */
.wire-datetime-control{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);width:100%}
.wire-datetime-control .wire-date-control{flex:1 1 200px}
.wire-time-input{flex:0 1 130px;min-width:0;height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:16px}
.wire-time-input:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
@media (max-width:767px){
  .wire-date-popover{left:auto;right:0}
}

/* /kit 데모 전용 */
.wire-kit-section{display:grid;gap:var(--space-4);margin-block:var(--space-10)}
.wire-kit-heading{margin:0;font-size:18px;font-weight:700;color:var(--ink)}
.wire-kit-caption{margin:0;font-size:14px;color:var(--sub)}
.wire-kit-stack{display:grid;gap:var(--space-3)}
.wire-kit-row{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-start}
.wire-kit-swatch{display:grid;place-items:center;min-height:60px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--muted);color:var(--sub);font-size:14px}
`;
