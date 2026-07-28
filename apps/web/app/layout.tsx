import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
// 디자인 토큰 SSOT(V0.1 · D34/ADR-0012). 값을 이 파일에 복사하지 않는다 — 두 곳에 두면
// 다시 어긋난다. 색값 정본은 pen '색 토큰' 페이지이고, tokens.css 가 그 기계 소비용 사본이다.
import '../../../design/tokens.css';
import { AppSidebar } from './components/wire/app-sidebar';
import { wireStyles } from './components/wire/wire-styles';

// 앱 셸·레거시 화면 공통. 토큰은 design/tokens.css 에서만 온다 — 여기에 :root 를 다시 두지 않는다.
// 폐기 토큰 3종(--strong · --accent · --success)은 V0.1 에서 없앴다. --success 는 GAS 긍정을
// 색으로 표시하지 않는다는 D6·R4 와 정면 충돌해 역할 자체가 사라진 것이다.
const styles = `
:root{font-family:var(--font-sans);color:var(--ink);letter-spacing:var(--tracking-base)}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);font-size:16px;line-height:1.55}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit}
.app-shell{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr);min-height:100dvh}
/* 사이드바(§4): --gradient-sidebar 배경 + 잉크 글자. 다크 패널이 아니다. */
.sidebar{display:flex;flex-direction:column;gap:var(--space-8);padding:var(--space-6);background:var(--gradient-sidebar);color:var(--ink)}
.brand,.navigation-link,.sidebar-footer{display:flex;align-items:center;gap:var(--space-2)}
.brand{font-weight:700}
.brand-mark{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--panel);color:var(--ink)}
/* 사업 전환기(D35·ADR-0014 §2): 기관명 아래·메뉴 위. 아래 메뉴의 범위를 정하므로
   포함 관계가 눈으로 읽히게 위에 둔다. 사업이 1개인 동안은 누를 데가 없어 링크가 아니다.
   민트 계열은 '사람·소속'이라 사업 라벨이 그 축에 든다(D34). */
/* 알약이 아니라 radius 6 이다(§4-5) — 행동 버튼이 아니라 값을 고르는 컨트롤이다. */
.program-switcher{display:grid;gap:var(--space-1);padding:var(--space-3);border-radius:var(--radius-control);background:var(--panel)}
/* 기관 | 사업 | 메뉴 세 덩어리를 1px 선으로 가른다(§4-5). 선 위아래 16씩이라 덩어리 간격
   32(--space-8)는 그대로 유지된다 — 선은 그 사이 가운데에 놓인다.
   --line(#E7E5E4)이 아니라 --line-sidebar 인 이유는 사이드바 그라데이션 위에서 거의 안 보이기 때문이다.
   좌우 -24 는 사이드바 패딩만큼 되밀어 선을 끝까지 긋는다. */
.sidebar>.program-switcher,.sidebar>.navigation-list{position:relative}
.sidebar>.program-switcher::before,.sidebar>.navigation-list::before{
  content:"";position:absolute;top:calc(var(--space-4) * -1);
  left:calc(var(--space-6) * -1);right:calc(var(--space-6) * -1);
  height:1px;background:var(--line-sidebar);
}
.program-switcher-label{margin:0;color:var(--mint-deep);font-size:14px;font-weight:700}
.program-switcher-name{margin:0;color:var(--ink);font-size:16px;font-weight:700}
.navigation-list{display:grid;gap:var(--space-1);padding:0;margin:0;list-style:none}
.navigation-link{min-height:var(--control-height);padding:0 var(--space-3);border-radius:var(--radius-control);color:var(--sub);font-size:14px;font-weight:700;transition:background-color .12s ease,color .12s ease}
/* 마우스가 실제로 있는 기기에서만 호버를 켠다 — 터치 기기는 탭한 항목에 :hover 가 남아
   "눌린 채로 굳은" 것처럼 보인다(2026-07-26 Q 보고). */
@media (hover:hover){
  /* 호버는 **약한 신호**다. 예전에는 흰색(--panel) 알약이라 활성 항목보다 더 선택된 것처럼
     보였다 — 사업 전환기 카드와 같은 흰 알약이었기 때문이다. 잉크 4% 워시로 낮춘다. */
  .navigation-link:hover{background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink)}
  /* 활성 항목 위에서는 활성 표시가 이겨야 한다 — 호버가 덮으면 "지금 어디인지"가 사라진다. */
  .navigation-link[data-current="true"]:hover{background:var(--blue-tint);color:var(--ink)}
}
/* 활성 내비는 블루 계열(시간·상태). 단 **글자는 --ink** 다 — --blue-deep(#67a9f0)을 --blue-tint
   위에 얹으면 대비가 1.9 라 라벨이 읽히지 않고, 비활성(--sub #534e57)보다 오히려 흐려져
   위계가 뒤집힌다. DESIGN.md §9 의 대비 예외는 '보조 정보 한정'이라 주 메뉴 라벨은 대상이 아니다.
   블루 신호는 아이콘이 갖는다 — 색은 남고 글자는 읽힌다. */
.navigation-link[data-current="true"]{background:var(--blue-tint);color:var(--ink)}
.navigation-link[data-current="true"] svg{color:var(--blue-deep)}
.sidebar-footer{margin-top:auto;color:var(--sub);font-size:14px;font-weight:700}
/* ── 드로어 부품 ── 데스크톱에는 셋 다 없다(§4-4 는 768 미만에서만 드로어라고 말한다).
   손잡이 바는 락 8 이 금지한 '상단 헤더 띠'가 아니다 — 데스크톱에 없고 내용은 손잡이뿐이다. */
.drawer-handle{display:none;align-items:center;gap:var(--space-3);width:100%;height:56px;padding:0 var(--space-4);border:0;border-bottom:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:16px;font-weight:700;text-align:left;cursor:pointer;position:sticky;top:0;z-index:var(--z-sticky)}
.drawer-handle-bars{display:flex;flex-direction:column;gap:3px;width:18px;flex:none}
.drawer-handle-bars i{height:2px;border-radius:var(--radius-bar);background:var(--ink)}
/* 지금 어느 사업인지는 드로어를 열지 않고도 보여야 한다 — 사업이 메뉴의 범위를 정하기 때문이다.
   민트 계열은 '사람·소속' 축이라 사업 라벨이 여기 든다(D34). */
.drawer-handle-program{margin-left:auto;color:var(--mint-deep);font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer-scrim{position:fixed;inset:0;background:rgba(61,52,69,.4);z-index:calc(var(--z-modal) - 1)}
.drawer-close{display:none;width:100%;min-height:var(--control-height);margin-top:var(--space-4);border:1px solid var(--line-control);border-radius:var(--radius-pill);background:var(--panel);color:var(--ink);font-size:14px;font-weight:700;cursor:pointer}
/* ── 페이지 셸 ── 장폭·여백의 유일한 주인(2026-07-26). 값은 design/tokens.css 에만 있다.
   width:100% 가 핵심이다 — .page-content 는 .app-shell 의 **그리드 아이템**이고 auto 마진을
   갖고 있어서, 폭을 명시하지 않으면 트랙을 채우지 않고 내용 크기로 줄어든다. 그래서 이전에는
   같은 클래스인데도 화면마다 컬럼이 429~1200px 로 달랐다.
   grid + gap 으로 섹션 간격도 여기서 한 번에 정한다 — 화면마다 margin 을 따로 주지 않는다. */
.page-content{
  width:100%;
  /* D37 §4-1: 1120 은 **패딩을 포함한** 컨테이너 폭이다(box-sizing:border-box). 이전에는
     calc(--page-max + 패딩*2) 라 실제 총폭이 1200 이었고 글 폭이 1120 으로 나왔다 —
     계약이 정한 글 폭은 1040(한 줄 약 65자)이다. */
  max-width:var(--page-max);
  margin-inline:auto;
  padding:var(--page-pad-y) var(--page-pad-x);
  display:grid;
  gap:var(--section-gap);
  align-content:start;
  /* 컨테이너 질의의 기준점. 열 수·span 해제는 화면 폭이 아니라 이 폭으로 판단한다(§4-2) —
     화면 폭으로 풀면 사이드바가 있고 없고에 따라 같은 폭에서 다른 결과가 나온다. */
  container-type:inline-size;
}
/* 폼·읽기 화면. 장폭만 좁히고 여백·간격은 그대로 쓴다. */
.narrow{--page-max:var(--page-max-narrow)}
.page-header{display:flex;justify-content:space-between;gap:var(--space-6);align-items:flex-start}
/* 우상단 행동 묶음 (D35 — 사이드바=장소 / 페이지 우상단=행동). 주 행동이 오른쪽 끝이다. */
.page-actions{display:flex;align-items:center;gap:var(--space-3);flex:none}
h1{margin:0;font-size:28px;line-height:1.25}
h2{margin:0;font-size:18px;line-height:1.35}
p{margin:var(--space-2) 0 0;color:var(--sub)}
/* 버튼 4종(§5). 기본은 세컨더리, .button-primary 가 프라이머리다. */
.button{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-4);border:1px solid var(--line-control);border-radius:var(--radius-pill);background:var(--panel);color:var(--ink);font-size:16px;font-weight:700;cursor:pointer}
.button-primary{background:var(--gradient-action);border:1px solid var(--line-action);color:var(--ink);box-shadow:var(--shadow-soft)}
.button-ghost{background:transparent;border-color:transparent;color:var(--sub);box-shadow:none}
.button-danger{background:var(--panel);border:1.5px solid var(--risk);color:var(--risk);box-shadow:none}
.button-sm{min-height:var(--pill-height);padding:0 14px;font-size:14px}
.button:disabled{background:var(--muted);border-color:var(--line);color:var(--sub);box-shadow:none;cursor:not-allowed}
.case-toolbar{display:flex;gap:var(--space-3);margin-bottom:var(--space-5)}
/* 입력칸(§5): 높이 40 · radius 6 · --line-control 1px. 라벨은 항상 위에 둔다. */
.search-field,.select-field,.input-icon{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--sub)}
.search-field{flex:1;max-width:420px}
.search-field input,.select-field select,.input-icon input{width:100%;border:0;background:transparent;color:var(--ink);outline:0}
.search-field:focus-within,.select-field:focus-within,.input-icon:focus-within{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 레거시 화면의 떠 있는 표면들도 카드 계약을 쓴다(§5). 기본 테두리는 **회색 --line** 이고,
   그라데이션 테두리는 선택·활성일 때만 쓴다(2026-07-26 Q 지적 · pen 실측). 채움은
   --surface-fill 로만 바꾼다 — 선택 상태는 배경 2겹이라 background 를 통째로 덮으면 테두리가 날아간다. */
.case-list,.panel,.detail-link,.today-schedule-card,.participant-stage-item,.schedule-day-group,.settings-section,.schedule-form,.pii-reveal-control{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
/* 케이스 목록: 목록 전체가 카드 하나이고 행은 --line 구분선으로 나눈다(§5 리스트 행). */
.case-list{overflow:hidden}
.case-list-heading,.case-row{display:grid;grid-template-columns:1fr 1.2fr 1fr 1.2fr var(--space-6);gap:var(--space-4);align-items:center}
.case-list-heading{padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--line);color:var(--sub);font-size:14px;font-weight:700}
.case-row{min-height:76px;padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--line)}
.case-row:last-child{border-bottom:0}
.case-row:hover{background:var(--muted)}
.detail-link:hover{--surface-fill:var(--muted)}
.case-identity{display:grid;gap:var(--space-1)}
.case-identity strong{font-size:16px;font-weight:700}
/* 이름 뒤 괄호 가명 ID 는 항상 16/400 --sub(§5 이름 표기). */
.case-identity small,.panel-meta{color:var(--sub);font-size:14px;font-weight:700}
.case-program{color:var(--sub);font-size:14px}
/* 상태 배지(§5 기본 배지): 색 없이 --sub 테두리로만 선다. */
.status{display:inline-flex;width:max-content;min-height:var(--badge-height);align-items:center;padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;color:var(--sub);font-size:14px;font-weight:700}
/* 주의·대기·미완료는 라벤더 tint 배지다(색 규율 5 — v1 검정 반전 배지를 대체). */
.warning{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.risk{border-color:transparent;background:var(--risk-tint-solid);color:var(--risk)}
.breadcrumb{display:flex;gap:var(--space-2);margin-bottom:var(--space-4);color:var(--sub);font-size:14px}
.briefing{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-5)}
.panel{padding:var(--space-6)}
.risk-panel,.gas-panel{grid-column:1/-1}
.panel-head{display:flex;justify-content:space-between;gap:var(--space-4);align-items:flex-start}
.panel-head>div{display:flex;gap:var(--space-2);align-items:center}
.gas{display:grid;grid-template-columns:repeat(5,1fr);gap:var(--space-2);margin-top:var(--space-6)}
.gas span{display:grid;place-items:center;min-height:48px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--muted);color:var(--sub);font-weight:700}
.lines{display:grid;gap:var(--space-2);margin-top:var(--space-6)}
.lines span{height:12px;border-radius:var(--radius-bar);background:var(--muted)}
.lines span:nth-child(2){width:86%}
.lines span:nth-child(3){width:70%}
.empty{display:flex;align-items:center;gap:var(--space-2);min-height:92px;color:var(--sub);font-size:14px}
.detail-link{display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-5);padding:var(--space-5);font-weight:700}
.form{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.42fr);gap:var(--space-5);align-items:start}
.form-panel{display:grid;gap:var(--space-5)}
.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
/* 라벨은 14/700 --sub 로 값 위에 둔다 — 입력 경계선(1.28) 하나에 기대지 않기 위한 규칙(§9). */
.field{display:grid;gap:var(--space-2);font-size:14px;font-weight:700;color:var(--sub)}
.field input,.field select,.field textarea{width:100%;min-height:var(--control-height);padding:var(--space-2) var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:16px;font-weight:400}
/* 라디오·체크박스는 텍스트 칸이 아니다. 위 규칙의 width:100% 를 그대로 먹으면 동그라미가
   칸을 가로질러 늘어나고 라벨이 아래 줄로 밀려난다 — 선택지가 세로로 한 글자씩 쪼개져
   읽히던 원인이다(2026-07-26 Q 보고 "너무 좁아서 쓸 수 없는 칸"). */
.field input[type="radio"],.field input[type="checkbox"]{width:auto;min-height:0;padding:0;border:0;border-radius:0;background:none;accent-color:var(--blue-deep)}
/* 선택지 한 줄: 동그라미와 글자를 같은 줄에 세우고 누를 면적을 컨트롤 높이만큼 준다. */
.field:has(>span>input[type="radio"])>span,.field:has(>span>input[type="checkbox"])>span{
  display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);
  color:var(--ink);font-size:16px;
}
textarea{min-height:216px;resize:vertical}
.form-actions{display:flex;justify-content:flex-end}
.note{display:flex;gap:var(--space-3);padding:var(--space-5);border-radius:var(--radius-card);background:var(--muted)}
.note p{font-size:14px}
@media(max-width:767px){
  /* ── 768 미만: 사이드바는 드로어다 (§4-4) ──
     가로 줄로 눕히면 기관명·사업 전환기·메뉴가 한 줄에 밀려 아무것도 안 읽힌다.
     좁은 화면에서 '장소 전환'은 자주 하는 동작이 아니므로 평소엔 화면 밖에 두고
     손잡이를 눌렀을 때만 왼쪽에서 밀어 넣는다. 본문은 폭을 온전히 쓴다. */
  .app-shell{display:block}
  .drawer-handle{display:flex}
  .sidebar{
    position:fixed;top:0;bottom:0;left:0;
    width:280px;max-width:82vw;
    padding:var(--space-6);overflow-y:auto;
    z-index:var(--z-modal);
    transform:translateX(-100%);transition:transform .15s ease;
  }
  .sidebar[data-drawer-open="true"]{transform:none}
  .drawer-close{display:block}
  .page-header,.case-toolbar{flex-direction:column}
  /* 킷 버튼도 같이 잡는다 — 레거시 .button 만 있으면 교체한 화면에서 버튼이 줄어든다. */
  .page-header .button,.page-header .wire-button{width:100%;justify-content:center}
  .search-field{max-width:none}
  .case-list-heading{display:none}
  .case-program{display:none}
  .briefing,.form,.field-grid{grid-template-columns:1fr}
  .risk-panel,.gas-panel{grid-column:auto}
  .case-row{grid-template-columns:minmax(0,1fr) var(--space-6);gap:var(--space-3)}
  .case-row .status{grid-column:1}
  .case-row>svg{grid-column:2;grid-row:1/4}
}`;
const participantStyles = `
.today-schedule-list{display:grid;gap:var(--space-3)}
.today-schedule-card{display:grid;grid-template-columns:1.1fr .8fr 1.2fr .7fr;gap:var(--space-4);align-items:center;padding:var(--space-5)}
.today-schedule-card:hover{--surface-fill:var(--muted)}
.schedule-field{display:grid;gap:var(--space-1);min-width:0}
.schedule-field strong{overflow-wrap:anywhere;font-size:16px;font-weight:700}
/* 정보 라벨은 민트 계열(사람·소속). */
.schedule-field-label{color:var(--mint-deep);font-size:14px;font-weight:700}
.provenance-label{color:var(--sub);font-size:14px;font-weight:700}
.schedule-status{display:inline-flex;align-items:center;gap:var(--space-2);width:max-content;font-size:14px;font-weight:700}
/* 상태 점은 시간·상태 축이라 블루. 종료·취소는 색이 아니라 문구가 구분한다(색 하나에 기대지 않는다). */
.status-dot{width:8px;height:8px;border-radius:var(--radius-pill);background:var(--blue)}
.schedule-status[data-status="completed"] .status-dot{background:var(--track)}
.schedule-status[data-status="cancelled"] .status-dot,.schedule-status[data-status="no_show"] .status-dot{background:var(--risk)}
.participant-stage{display:grid;gap:var(--space-5)}
.participant-stage-header{display:flex;justify-content:space-between;gap:var(--space-4);align-items:flex-start}
.participant-stage-list{display:grid;gap:var(--space-3)}
.participant-stage-item{padding:var(--space-5)}
.provenance-label{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent}
/* 오류는 --risk 글자 + 메시지 텍스트로 알린다. 색만으로 알리지 않는다(§5 입력 오류·§9 완화). */
.error-state,[role="alert"]{color:var(--risk);font-weight:700}
[role="status"][aria-live],[aria-live="polite"]{min-height:1.5em}
.pii-reveal-control{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4)}
.pii-reveal-control button{min-height:var(--control-height)}
.fixed-core-form{display:grid;gap:var(--space-5)}
/* 브레이크포인트는 767 하나다(D37 §4-4 · 락 11) — 구 768/359 두 벌을 합쳤다. 359 이하에서
   1열로 더 접던 단계는 사라지고 좁은 휴대폰에서도 2열로 남는다(필드가 짧고 min-width:0 ·
   overflow-wrap:anywhere 라 깨지지 않는다). 줄어든 패딩은 여기로 옮겼다. */
@media(max-width:767px){.today-schedule-card{grid-template-columns:repeat(2,minmax(0,1fr));padding:var(--space-4)}.participant-stage-header{flex-direction:column}.participant-stage-item{padding:var(--space-4)}}
/* ticket-12: 상담 일정 */
.schedule-section{display:grid;gap:var(--space-3)}
.schedule-section>h2{font-size:18px}
.schedule-day-groups{display:grid;gap:var(--space-3)}
.schedule-day-summary{display:flex;align-items:center;gap:var(--space-3);min-height:52px;padding:0 var(--space-5);font-size:16px;font-weight:700;cursor:pointer;list-style:none}
.schedule-day-summary::-webkit-details-marker{display:none}
.schedule-day-summary::before{content:"";flex:none;width:7px;height:7px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub);transform:rotate(-45deg);transition:transform .15s ease}
.schedule-day-group[open] .schedule-day-summary::before{transform:rotate(45deg)}
.schedule-day-count{margin-left:auto;color:var(--sub);font-size:14px;font-weight:700}
/* 날짜 그룹(카드) 안의 상담 카드는 자기 테두리를 벗고 --line 구분선으로 나눈다 — 위 실무자 목록과 같은 이유. */
.schedule-day-group .today-schedule-list{padding:0;gap:0}
.schedule-day-group .today-schedule-card{border:0;border-top:1px solid var(--line);border-radius:0;background:none;box-shadow:none}
.schedule-day-group .today-schedule-card:hover{background:var(--muted)}
`;

const briefingStyles = `
/* 상담 준비 6카드 — 디자인 시스템 V0.1 계약. */
.briefing-page{display:grid;gap:var(--space-5)}
/* 이름 + 출구 버튼 2개(D35 §4). 버튼은 이름 바로 아래 줄이고, 화면 조작(전체 열기/닫기)과
   섞이지 않게 아래 툴바와 분리한다. 간격 4의 배수만 쓴다(D30 존치 규칙). */
.briefing-identity{display:grid;gap:var(--space-3);justify-items:start}
.briefing-exits{display:flex;gap:var(--space-3);flex-wrap:wrap}
/* 이름 줄이 위로 올라가면서 툴바에는 토글만 남는다 — 오른쪽 정렬. */
.briefing-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.briefing-toolbar-toggles{display:flex;gap:var(--space-2);flex-wrap:wrap}
/* 리스크 경고 배너(D9 · §5). 배경 --risk-tint-solid + --gradient-brand 1.5px 균일 테두리.
   좌측 액센트 띠(border-left 두께 강조)는 금지 패턴이다 — 병합으로 되살아난 것을 걷었다(이슈 #49).
   배너가 서는 것은 테두리가 아니라 위치(HERO 바로 아래)·배경 틴트·아이콘이다.
   --risk 대비가 2.72 라 색 하나에 기대지 않는다: 아이콘·문구·고정 위치·접힘 불가 4중 신호(§9). */
.risk-banner{
  padding:var(--space-5) var(--space-6);
  border:1.5px solid transparent;
  border-radius:var(--radius-card);
  background:linear-gradient(var(--risk-tint-solid),var(--risk-tint-solid)) padding-box,var(--gradient-brand) border-box;
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.risk-banner-head{display:flex;align-items:center;gap:var(--space-2)}
.risk-banner-icon{flex:none;width:18px;height:18px;color:var(--risk)}
.risk-banner-title{margin:0;font-size:16px;font-weight:700;color:var(--risk)}
/* 항목은 흰 배경 행(radius 6 · --shadow-soft)에 체크박스 + 16/700 --ink. */
.risk-banner-list{margin:var(--space-3) 0 0;padding:0;display:grid;gap:var(--space-2);list-style:none}
.risk-banner-list li{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-radius:var(--radius-control);background:var(--panel);box-shadow:var(--shadow-soft);color:var(--ink);font-size:16px;font-weight:700}
.risk-banner-list .panel-meta{margin-left:auto;color:var(--sub);font-weight:700;font-size:14px}
/* 표준 카드 그리드(D37 §4-2) — **열 수를 쓰지 않는다**(락 10). 최소 폭 420 이 열을 만든다:
   1120 에서 2열(각 510)이고 컨테이너가 좁아지면 스스로 1열이 된다. */
.briefing-cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));gap:var(--space-5);align-items:start}
/* 아코디언이 나란할 때: 펼친 카드는 서로 높이를 맞추고, 접은 카드는 요약 줄만 남긴다(§4-2).
   JS 로 높이를 재서 박지 않는다 — 접으면 행이 실제로 줄어든다. */
.briefing-cards-grid>.briefing-card{align-self:start}
.briefing-cards-grid>.briefing-card[open]{align-self:stretch}
/* 카드 = 접힘 가능한 <details>. 카드 계약(§5)을 그대로 쓴다. */
.briefing-card{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.briefing-card-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-6);font-size:18px;font-weight:700;cursor:pointer;list-style:none}
.briefing-card-summary::-webkit-details-marker{display:none}
.briefing-card-arrow{flex:none;width:9px;height:9px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub);transform:rotate(-45deg);transition:transform .15s ease}
/* 자식 결합자(>)로 두면 GAS 요약처럼 화살표를 배지와 함께 감싼 경우 회전이 안 먹어
   펼쳐져 있는데 화살표만 닫힌 모양으로 남는다(2026-07-27 렌더에서 확인). */
.briefing-card[open]>.briefing-card-summary .briefing-card-arrow{transform:rotate(45deg)}
/* 헤더/본문 구분선은 --gradient-brand 1px(구조적 구분선 — 액센트 띠 금지 대상이 아니다, 색 규율 6). */
.briefing-card-body{display:grid;gap:var(--space-3);padding:var(--space-5) var(--space-6) var(--space-6);background:var(--gradient-brand) top/100% 1px no-repeat}
.briefing-fields{display:grid;gap:10px}
/* 카드 내 중첩 아코디언(기본정보의 전체 참여사업). 기본 접힘. */
.briefing-subaccordion{padding-top:var(--space-2);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
.briefing-subaccordion-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:6px 0;font-size:16px;font-weight:700;cursor:pointer;list-style:none}
.briefing-subaccordion-summary::-webkit-details-marker{display:none}
.briefing-subaccordion[open]>.briefing-subaccordion-summary>.briefing-card-arrow{transform:rotate(45deg)}
.briefing-subaccordion-body{padding-top:var(--space-2)}
.briefing-inline-link{font-size:16px;font-weight:700;color:var(--ink);text-decoration:underline}
/* GAS — 목표별 최신 점수. 점수의 좋고 나쁨을 색으로 표시하지 않는다(D6·R4):
   계열 3색은 목표를 서로 구분하는 회전일 뿐이고 점수 숫자는 항상 --ink 다. */
/* GAS 전폭 섹션(CLAUDE.md 6장 · 2026-07-27 Q 결정 — 이 파일의 CSS 는 템플릿 리터럴이라 주석에 백틱을 쓰지 않는다). 섹션 제목은 카드 밖 h2 18/700 이고 그 아래 16 이다
   — §4-3 세로 리듬(40/24/16/20)에서 '섹션 제목↔내용'에 해당한다. 섹션 사이 24 는 페이지
   그리드의 gap 이 이미 준다(§4-6 규칙 3: 화면에서 margin 으로 띄우지 않는다). */
.briefing-page{display:grid;gap:var(--section-gap)}
.briefing-accordions{display:grid;gap:var(--section-gap)}
.briefing-section{display:grid;gap:var(--space-4)}
.briefing-section-heading{font-size:18px;font-weight:700;color:var(--ink)}
/* HERO 도 카드다(§4-5) — 화면의 모든 글자가 카드 안에 있고 예외는 섹션 제목뿐이다. */
.briefing-hero{padding:var(--space-6);gap:var(--space-5)}
.briefing-hero-identity{display:grid;gap:var(--space-2);min-width:0}
.briefing-hero-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:28px;line-height:1.25}
/* 상태 태그는 시간·상태 축이라 블루다(D34). 글자는 deep — base 는 글자에 쓰지 않는다(색 규율 3). */
.briefing-badge.is-stage{border-color:transparent;background:var(--blue-tint);color:var(--blue-deep)}
.briefing-hero-meta{margin:0;color:var(--sub);font-size:14px}
/* 여닫기 줄은 오른쪽 끝. 화면 조작이라 고스트 32px 하나다. */
.briefing-toolbar{display:flex;justify-content:flex-end}
/* GAS 는 전폭 아코디언이다 — 안쪽 조밀 그리드가 3열이 되려면 1040 이 필요하다. */
.briefing-card-summary-right{display:flex;align-items:center;gap:var(--space-3)}
/* GAS 게이지 96px 원형(§5): 트랙은 계열 tint · 채움은 같은 계열 base · 중앙 점수 24/700.
   conic-gradient 로 채움 비율을 그리고 안쪽을 흰 원으로 덮어 링을 만든다. 점수의 좋고 나쁨은
   색으로 알리지 않으므로(D6·R4) 계열은 점수가 아니라 목표 순서가 정한다. */
.briefing-gas-goal{display:grid;justify-items:center;gap:var(--space-2);text-align:center}
.briefing-gauge{
  position:relative;display:grid;place-items:center;width:96px;height:96px;border-radius:var(--radius-pill);
  background:conic-gradient(var(--gauge-fill) var(--gauge-pct),var(--gauge-track) 0);
}
.briefing-gauge::before{content:"";position:absolute;inset:12px;border-radius:var(--radius-pill);background:var(--panel)}
.briefing-gauge .briefing-gas-score{position:relative}
.briefing-gas-goal[data-series="blue"]{--gauge-fill:var(--blue);--gauge-track:var(--blue-tint)}
.briefing-gas-goal[data-series="mint"]{--gauge-fill:var(--mint);--gauge-track:var(--mint-tint)}
.briefing-gas-goal[data-series="lavender"]{--gauge-fill:var(--lavender);--gauge-track:var(--lavender-tint)}
/* 미니 추이 — 직전 점수 흐름. 막대는 면이라 base 계열을 쓴다(색 규율 2). */
.briefing-gas-trend{display:flex;align-items:flex-end;gap:var(--space-1);height:24px}
.briefing-gas-trend i{width:6px;height:var(--bar);border-radius:var(--radius-bar);background:var(--gauge-fill)}
/* 브리핑 이어보기 — 페이지 맨 아래 한 줄(D37). 카드 계약을 그대로 쓰고 안쪽만 정한다. */
.briefing-more{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-5) var(--space-6)}
.briefing-more:hover{--surface-fill:var(--muted)}
.briefing-more-title{display:block;font-size:16px;font-weight:700;color:var(--ink)}
.briefing-more-desc{display:block;margin-top:var(--space-1);font-size:14px;color:var(--sub)}
/* 조밀 그리드(D37 §4-2) — 최소 280 이 열을 만든다. **3열 아니면 1열이다**: 2열이면 세부 목표
   3개(D33)가 둘 + 외톨이 하나로 앉는다. 접는 판단은 화면이 아니라 컨테이너 폭으로 한다. */
.briefing-gas-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min-dense)),1fr));gap:var(--space-5)}
@container (max-width:879px){.briefing-gas-grid{grid-template-columns:minmax(0,1fr)}}
/* 게이지 칸에는 배경 상자를 두지 않는다 — 계열 tint 는 **게이지 트랙**의 몫이다(§5).
   구 구현은 칸마다 tint 패널 + 그라데이션 테두리를 둘렀는데, 그러면 카드 안에 카드가 생기고
   (§5 '카드 안에 카드' 회피) 트랙과 패널이 같은 색이라 원형 게이지가 배경에 묻힌다. */
.briefing-gas-score{font-size:24px;font-weight:700;line-height:1;color:var(--ink);letter-spacing:var(--tracking-numeric)}
.briefing-gas-goal-title{font-size:16px;font-weight:700;color:var(--ink);overflow-wrap:anywhere}
/* 종료된 목표 칩 — 중립 배지(색 없이 테두리로만 선다). */
.briefing-gas-goal-closed{display:inline-flex;align-items:center;min-height:20px;margin-left:6px;padding:0 var(--space-2);border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:14px;font-weight:700;color:var(--sub)}
/* 오늘 확인할 질문 — 세 섹션. */
.briefing-qsection{display:grid;gap:var(--space-2)}
.briefing-qlabel{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
/* 배지·메타·빈 상태(§5 상태 배지). */
.briefing-badges{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.briefing-badge{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:14px;font-weight:700;color:var(--sub)}
.briefing-badge.is-approved{border-color:transparent;background:var(--mint-tint);color:var(--mint-deep)}
/* 승인 대기는 라벤더 tint 배지다(색 규율 5 — v1 검정 반전 배지를 대체). */
.briefing-badge.is-pending{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.briefing-meta,.briefing-note{margin:0;font-size:14px;color:var(--sub)}
/* 767 블록에서 두 그리드를 1열로 강제하던 규칙은 지웠다 — 최소 폭(420·280)이 이미 접는다(락 10·11). */
`;

const searchStyles = `
/* ticket-16: 당사자 검색 */
.participant-search{display:grid;gap:var(--space-3);margin-bottom:var(--space-6)}
.participant-search>h2{font-size:18px}
.participant-search-form{display:flex;gap:var(--space-3);align-items:flex-end}
.participant-search-field{display:grid;gap:var(--space-2);font-size:14px;font-weight:700}
.participant-search-form .participant-search-field{flex:1;max-width:420px}
.participant-search-label{color:var(--sub);font-size:14px;font-weight:700}
.participant-search-field input,.participant-search-select{width:100%;min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:16px;font-weight:400}
.participant-search-form .button{flex:none}
.participant-search-results{max-width:520px}
.participant-search-message{margin:0;color:var(--sub);font-size:14px}
.participant-search-message[role="alert"]{color:var(--risk);font-weight:700}
@media(max-width:767px){.participant-search-form{flex-direction:column;align-items:stretch}.participant-search-form .participant-search-field{max-width:none}.participant-search-form .button{width:100%}}
`;

const settingsStyles = `
/* ticket-14: 설정 */
/* .settings-gear 4종 삭제(2026-07-27) — D35 가 설정을 사이드바 **메뉴 항목**으로 옮긴 뒤로
   이 클래스를 쓰는 마크업이 0곳이었다. 죽은 CSS 였지만 무해하지 않았다: 함께 있던
   .sidebar{position:relative} 가 뒤 문자열에 있어 드로어의 position:fixed 를 덮었고,
   그래서 768 미만에서 드로어가 화면 높이를 못 채우고 내용 높이(531px)로 떠 있었다.
   (주석에 백틱을 쓰지 않는 이유는 이 CSS 가 템플릿 리터럴이기 때문이다 — 쓰면 앱 전체가 500 이다.) */
.settings-page{display:grid;gap:var(--space-6)}
.settings-section{display:grid;gap:var(--space-4);padding:var(--space-6)}
.settings-section>h2{font-size:18px}
.settings-account{display:grid;gap:var(--space-4);margin:0}
.settings-field{display:grid;gap:var(--space-1)}
/* 사람 정보 라벨은 민트 계열. */
.settings-field dt{color:var(--mint-deep);font-size:14px;font-weight:700}
.settings-field dd{margin:0;color:var(--ink);font-size:16px;font-weight:700;overflow-wrap:anywhere}
/* 실무자 목록은 카드(.settings-section) 안에 있으므로 행마다 테두리를 두르지 않고
   --line 구분선으로 나눈다(§5 리스트 행). 카드 안에 카드를 넣으면 경계가 두 겹으로 겹친다. */
.settings-user-list{display:grid;margin:0;padding:0;list-style:none}
.settings-user-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:var(--space-3);align-items:center;min-height:52px;padding:var(--space-3) var(--space-2);border-bottom:1px solid var(--line)}
.settings-user-row:last-child{border-bottom:0}
.settings-user-email{overflow-wrap:anywhere;font-weight:700}
.settings-user-role{color:var(--sub);font-size:14px;font-weight:700}
.settings-user-status{display:inline-flex;align-items:center;width:max-content;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;color:var(--sub);font-size:14px;font-weight:700}
.settings-user-row[data-active="false"]{opacity:.6}
@media(max-width:767px){.settings-user-row{grid-template-columns:1fr;gap:var(--space-1)}.settings-user-role,.settings-user-status{justify-self:start}}
`;

const scheduleStyles = `
/* ticket-20: 상담 등록 */
.schedule-actions{display:flex;justify-content:flex-end;margin-top:var(--space-2)}
.schedule-form{display:grid;gap:var(--space-5);max-width:520px;padding:var(--space-6)}
.schedule-form-hint{margin:0;color:var(--sub);font-size:14px}
/* 성공색은 이 시스템에 없다(D6·R4). 완료 알림은 중립 잉크 + 문구로 알린다. */
.schedule-form-notice{color:var(--ink);font-weight:700}
.schedule-form-error{color:var(--risk);font-weight:700}
.consent-fieldset{display:grid;gap:var(--space-3);margin:0;padding:var(--space-4);border:1px solid var(--line);border-radius:var(--radius-card)}
.consent-fieldset legend{padding:0 6px;font-weight:700;font-size:14px;color:var(--sub)}
.consent-checkbox{display:flex;align-items:center;gap:var(--space-3);font-size:16px;font-weight:700}
/* 체크박스 모양은 .wire-checkbox 하나가 소유한다(§5). 여기서 다시 스타일하면 선택자가 더 구체적이라
   리스크 변형(테두리만 --risk)을 덮어써 버린다 — 실제로 그 버그를 겪어 규칙을 한 곳으로 모았다. */
.consent-checkbox input[type="checkbox"]:not(.wire-checkbox){width:18px;height:18px}
`;

const piiMaskingStyles = `
/* ticket-18: PII 마스킹 */
.pii-panel{display:grid;gap:var(--space-3)}
.pii-fields{display:grid;gap:var(--space-2);margin:0}
.pii-field{display:grid;grid-template-columns:80px minmax(0,1fr);gap:var(--space-3);align-items:baseline}
/* 당사자 정보 라벨(연락처·비상연락처·거주지)은 민트 deep — 사람·소속 축(§1-5). */
.pii-field dt{color:var(--mint-deep);font-size:14px;font-weight:700}
.pii-field dd{margin:0;color:var(--ink);font-size:16px;font-weight:700;overflow-wrap:anywhere}
.pii-panel .pii-reveal-control{flex-wrap:wrap}
.pii-panel .pii-reveal-control button{min-height:var(--control-height);padding:0 var(--space-4);border:1px solid var(--line-control);border-radius:var(--radius-pill);background:var(--panel);color:var(--ink);font-size:16px;font-weight:700;cursor:pointer}
.pii-panel .pii-reveal-control button:hover:not(:disabled){background:var(--muted)}
.pii-panel .pii-reveal-control button:disabled{background:var(--muted);border-color:var(--line);color:var(--sub);cursor:not-allowed}
`;

const registerStyles = `
/* 당사자 등록·초대 (#37) */
.wire-register-form{display:grid;gap:var(--space-6);margin-top:var(--space-8)}
.wire-register-submit{width:100%}
.wire-invite-stack{display:grid;gap:var(--space-6);margin-top:var(--space-8)}
.wire-invite-section{display:grid;gap:var(--space-3)}
.wire-invite-caption{margin:0;text-align:center;font-size:14px;color:var(--sub)}
/* D15·D23: 동의 문안 "자세히 읽어보기" — briefing-subaccordion 패턴 재사용. */
.consent-detail{padding-top:var(--space-2);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
.consent-detail-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:6px 0;font-size:14px;font-weight:700;color:var(--ink);cursor:pointer;list-style:none}
.consent-detail-summary::-webkit-details-marker{display:none}
.consent-detail[open]>.consent-detail-summary>.briefing-card-arrow{transform:rotate(45deg)}
.consent-detail-body{display:grid;gap:var(--space-4);padding-top:var(--space-3)}
.consent-detail-disclaimer{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
.consent-detail-section{display:grid;gap:6px}
.consent-detail-section h3{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.consent-detail-section p,.consent-detail-section li{margin:0;font-size:14px;color:var(--sub)}
.consent-detail-section ul{margin:0;padding-left:18px;display:grid;gap:6px}
`;

const recordFormStyles = `
/* CCC-10: 정기 기록지 원페이지 — 고정 헤더 + 본문(P1→P4) + 우측 필수 채움 레일.
   강조는 사방 균일 테두리로만 준다 — 좌측 액센트 띠는 금지 패턴이다(이슈 #49). */
/* 상담 기록 작성 폼. 세로 한 단이다 — 레거시 .form(본문 + 사이드 레일 2열)을 쓰면
   아래 .record-layout 이 이미 갖고 있는 레일과 겹쳐 본문이 236px 로 짓눌렸다
   (2026-07-26 Q 보고 "너무 좁아서 쓸 수 없는 칸" 의 실제 원인). */
.record-form{display:grid;gap:var(--section-gap)}
.record-layout{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:var(--space-6);align-items:start}
.record-main{display:grid;gap:var(--space-6);min-width:0}
.record-sticky,.record-accordion,.record-rail{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.record-sticky{position:sticky;top:0;z-index:var(--z-sticky);display:grid;gap:var(--space-2);padding:var(--space-4) var(--space-5)}
.record-sticky-row{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-4)}
.record-sticky-label{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
.record-sticky-value{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.record-sticky-list{margin:0;padding-left:18px;display:grid;gap:var(--space-1);font-size:16px;font-weight:700;color:var(--ink)}
.record-sticky-count{margin:0;padding:2px 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:14px;font-weight:700;color:var(--sub);white-space:nowrap}
.record-sticky-meta{margin:0;font-size:14px;color:var(--sub)}
.record-accordion{padding:var(--space-4) var(--space-5)}
.record-accordion-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);font-size:16px;font-weight:700;color:var(--ink);cursor:pointer;list-style:none}
.record-accordion-summary::-webkit-details-marker{display:none}
.record-accordion-body{display:grid;gap:var(--space-4);padding-top:var(--space-4)}
/* 위기 영역은 확인된 리스크와 같은 축이므로 --risk 균일 테두리 + 배경 틴트로 표시한다(D9). */
.record-accordion.is-crisis{--surface-fill:var(--risk-tint-solid);border:1.5px solid var(--risk);background:var(--risk-tint-solid);padding:15px 19px}
.record-accordion.is-crisis .record-accordion-summary{color:var(--risk)}
.record-rail{position:sticky;top:0;display:grid;gap:var(--space-2);padding:var(--space-4)}
.record-rail-count{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.record-rail-list{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:14px;color:var(--sub)}
.record-rail-list li[data-done="true"]{color:var(--ink);font-weight:700}
.record-rail-state{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* 레일 해제는 **컨테이너 질의**로 한다(§4-2). 화면 폭으로 풀면 사이드바 240 이 있는 768~900 에서
   본문이 228px 로 짓눌린다 — 2026-07-26 에 900 으로 잡아 뒀던 이유이자, 브레이크포인트를 767 하나로
   모으면 되살아나는 결함이다. 644 = 본문 최소 420(--grid-min) + gap 24 + 레일 200. */
@container (max-width:643px){.record-layout{grid-template-columns:minmax(0,1fr)}.record-rail{position:static;order:-1}}
`;

export const metadata: Metadata = { title: 'CCC 사례관리', description: '비영리 사례관리 내부 운영 도구' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // 셸 = 좌측 사이드바 + 본문 (D35 · ADR-0014 §2). 768px 미만에서는 .app-shell 이 block 이 되고
  // **같은 사이드바가 드로어로 변한다**(DESIGN.md §4-4) — 화면 밖에 있다가 상단 손잡이 바를
  // 누르면 왼쪽에서 밀려 들어온다. 마크업이 한 벌이라 데스크톱·모바일 메뉴가 갈라질 수 없다.
  return <html lang="ko"><head><style>{styles + participantStyles + briefingStyles + settingsStyles + searchStyles + scheduleStyles + piiMaskingStyles + wireStyles + registerStyles + recordFormStyles}</style></head><body><div className="wire-shell app-shell"><AppSidebar />{children}</div></body></html>;
}
