import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
// 디자인 토큰 SSOT(V0.1 · D34/ADR-0012). 값을 이 파일에 복사하지 않는다 — 두 곳에 두면
// 다시 어긋난다. 색값 정본은 pen '색 토큰' 페이지이고, tokens.css 가 그 기계 소비용 사본이다.
import '../../../design/tokens.css';
// 달력 부품의 기본 CSS(D48 · ADR-0020). 겉모습은 wire-styles.ts '날짜 선택' 절이 D34 토큰으로
// 덮어쓴다 — 이 파일은 격자 배치·숨김 규칙처럼 덮으면 안 되는 뼈대만 제공한다.
import 'react-day-picker/style.css';
import { AppSidebar } from './components/wire/app-sidebar';
import { BackLink } from './components/wire/back-link';
import { getDisplayLabels } from './lib/display-labels';
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
/* 사업 전환기 드롭다운(2026-07-31). 방아쇠는 카드 안을 꽉 채우는 투명 버튼이다 — 알약을
   덧대면 카드 안에 컨트롤이 두 겹으로 보인다. 값 글자는 --ink 그대로(§9 대비 예외는 보조
   정보 한정이라 읽어야 하는 값에 deep 을 쓰지 않는다). */
.program-switcher-trigger{display:flex;align-items:center;gap:var(--space-2);width:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.program-switcher-trigger .wire-chevron{margin-left:auto;flex:none}
.program-switcher-trigger:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px;border-radius:var(--radius-control)}
/* 목록은 카드 바로 아래에 뜬다. 표면 계약은 date-picker 팝오버와 같은 값을 쓴다
   (--panel · --radius-card · --shadow-soft · z 30) — 새 표면을 만들지 않는다. */
.program-switcher-menu{
  position:absolute;top:calc(100% + var(--space-2));left:0;right:0;z-index:var(--z-dropdown);
  display:grid;gap:2px;padding:var(--space-2);margin:0;list-style:none;
  border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-soft);
}
.program-switcher-option{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-2);border-radius:var(--radius-control);color:var(--ink);font-size:14px;font-weight:700}
.program-switcher-option[data-selected="true"]{background:var(--blue-tint)}
@media (hover:hover){.program-switcher-option:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}}
/* 체크 글자에 deep 을 쓰지 않는다(§9 대비 예외는 보조 정보 한정). 선택 신호는 --blue-tint 면이 갖는다. */
.program-switcher-check{width:14px;flex:none;color:var(--ink)}
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
/* '준비 중' 배지 — 화면이 아직 없는 메뉴를 누르기 전에 알린다(CCC-23). 중립 회색 알약(§5 상태 배지).
   파스텔 신호 축(블루·민트·라벤더)에 속하지 않는 상태라 새 색을 쓰지 않는다. */
.navigation-soon{margin-left:auto;padding:0 8px;border:1px solid var(--sub);border-radius:var(--radius-pill);font-size:12px;font-weight:700;color:var(--sub);white-space:nowrap}
/* 푸터에 항목이 둘(설정·로그아웃)이 되어 가로 flex 로는 나란히 서 버린다 — 메뉴와 같은
   세로 목록이어야 같은 종류로 읽힌다. */
.sidebar-footer{margin-top:auto;display:grid;gap:var(--space-1);color:var(--sub);font-size:14px;font-weight:700}
.sidebar-logout-form{margin:0}
/* 로그아웃은 폼 버튼이지만 메뉴 항목처럼 보여야 한다 — .navigation-link 를 그대로 쓰고
   버튼 기본 스타일만 지운다. width:100% 는 눌리는 영역을 메뉴와 같게 맞춘다. */
.sidebar-logout{width:100%;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer}
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
/* ── 뒤로가기 줄(2026-07-31) ── 본문 열을 감싸는 div 와 그 안 첫 줄.
   min-width:0 이 필요하다 — 그리드 아이템의 기본 min-width:auto 때문에 내용이 넓으면
   본문 열이 트랙을 넘어 사이드바를 밀어낸다(표·코드 블록에서 실제로 난다). */
.content-column{display:flex;flex-direction:column;min-width:0}
/* 본문과 **같은** 컨테이너 값을 쓴다 — 여기서 다른 폭을 쓰면 '뒤로'와 제목의 왼쪽 끝이 어긋난다.
   아래 패딩은 0 이고, 뒤따르는 .page-content 의 위 패딩을 줄여 둘 사이가 벌어지지 않게 한다. */
.page-backbar{width:100%;max-width:var(--page-max);margin-inline:auto;padding:var(--page-pad-y) var(--page-pad-x) 0}
/* .narrow 는 --page-max 를 **.page-content 자기 자신에** 얹는다(위 .narrow 규칙). 뒤로가기 줄은
   그 형제라 그 값을 물려받지 못하고 :root 의 1120 을 쓴다 — 둘 다 가운데 정렬이므로 좁은 화면
   (960)에서 '뒤로'가 제목보다 80px 왼쪽에 선다. 다음 형제를 보고 같은 폭으로 맞춘다. */
.page-backbar:has(+ .page-content.narrow){max-width:var(--page-max-narrow)}
/* 형제 선택자라 뒤로가기 줄이 있는 화면에만 걸린다 — 공개 화면(셸 없음)은 그대로다. */
.page-backbar+.page-content{padding-top:var(--space-4)}
/* 고스트 버튼 계약(§5): 배경·테두리 없음, --sub 글자. 되돌리기는 주 행동이 아니다. */
.page-back{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--pill-height);padding:0 var(--space-2);margin-left:calc(var(--space-2) * -1);border:0;border-radius:var(--radius-control);background:transparent;color:var(--sub);font-size:14px;font-weight:700;cursor:pointer}
@media (hover:hover){.page-back:hover{background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink)}}
.page-back:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
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
  /* align-items 를 stretch 로 되돌리는 것이 핵심이다(기본은 97행의 flex-start).
     헤더가 세로로 누우면 교차축이 가로가 되는데, flex-start 인 채로는 .page-actions 가
     내용 크기로 쪼그라든다. 그 상태에서 안의 버튼이 아래 width:100% 를 받으면 기준 폭이
     "내용에 맞춰 줄어든 폭" 이라 폭이 순환 참조에 걸려, 두 버튼이 좁은 상자를 반씩 나눠
     갖고 라벨이 '당사자 정 / 보' 로 쪼개진다(R7 · 390px 실측 2026-07-30). */
  .page-header,.case-toolbar{flex-direction:column;align-items:stretch}
  /* 행동 버튼은 좁으면 **세로로 쌓는다**(D38 보강 — 라벨 줄바꿈 금지의 짝). 가로로 둔 채
     폭만 나누면 라벨이 길어질 때마다 같은 결함이 돌아온다 — 버튼 개수가 아니라 라벨 길이가
     변수이기 때문이다. 세로 배치는 라벨이 얼마나 길든 한 줄을 보장한다. */
  .page-actions{width:100%;flex-direction:column;align-items:stretch}
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
/* 카드 제목 오른쪽 자리 — 배지(승인 대기 등)와 화살표가 앉는다. */
.briefing-card-summary-right{display:flex;align-items:center;gap:var(--space-3)}
/* 전체 목표 카드(D45 · CCC-41) — 카드형 한 줄. 카드 계약(.surface-card)을 그대로 쓰고
   안쪽 가로 배치만 정한다. 점수·게이지 자리는 없다(D43). */
.briefing-goal{display:grid;gap:var(--space-2);padding:var(--space-4) var(--space-6)}
.briefing-goal-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.briefing-goal-text{flex:1;min-width:0;margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.briefing-goal-text.is-empty{color:var(--sub);font-weight:400}
.briefing-goal-form{display:flex;flex:1;align-items:center;gap:var(--space-3);flex-wrap:wrap}
/* 입력칸 계약(§5): 높이 40 · radius 6 · --line-control 1px. */
.briefing-goal-input{flex:1;min-width:min(100%,240px);height:40px;padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:16px;color:var(--ink)}
.briefing-goal-error{margin:0;font-size:14px;color:var(--risk)}
/* 브리핑 이어보기 — 페이지 맨 아래 한 줄(D37). 카드 계약을 그대로 쓰고 안쪽만 정한다. */
.briefing-more{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-5) var(--space-6)}
.briefing-more:hover{--surface-fill:var(--muted)}
.briefing-more-title{display:block;font-size:16px;font-weight:700;color:var(--ink)}
.briefing-more-desc{display:block;margin-top:var(--space-1);font-size:14px;color:var(--sub)}
/* 영역 ① — 실무자 입력·AI 제안의 세 섹션. */
.briefing-qsection{display:grid;gap:var(--space-2)}
.briefing-qlabel{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
/* AI 제안(CCC-39·D45) — 항목마다 제목·이유·근거 회차 링크 3층. */
.briefing-suggestions{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}
.briefing-suggestion{display:grid;gap:var(--space-1)}
.briefing-suggestion-title{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.briefing-suggestion-reason{margin:0;font-size:14px;color:var(--sub)}
.briefing-suggestion-link{justify-self:start;font-size:14px;font-weight:700;color:var(--ink);text-decoration:underline}
/* 영역 ③ 불일치 처리(D45 · CCC-42) — 처리 3종 버튼 줄과 접힌 이력. 처리는 표시일 뿐이라
   시각적 무게를 더하지 않는다(세컨더리 버튼·무채색 요약). */
.briefing-resolution-form{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2)}
.briefing-history{margin-top:var(--space-4);border-top:1px solid var(--line);padding-top:var(--space-4)}
.briefing-history>summary{cursor:pointer;font-size:14px;font-weight:700;color:var(--sub)}
.briefing-history>.briefing-qsection{margin-top:var(--space-4)}
/* 배지·메타·빈 상태(§5 상태 배지). */
.briefing-badges{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.briefing-badge{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:14px;font-weight:700;color:var(--sub)}
.briefing-badge.is-approved{border-color:transparent;background:var(--mint-tint);color:var(--mint-deep)}
/* 승인 대기는 라벤더 tint 배지다(색 규율 5 — v1 검정 반전 배지를 대체). */
.briefing-badge.is-pending{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.briefing-meta,.briefing-note{margin:0;font-size:14px;color:var(--sub)}
/* ── 상담 기록 화면 (D47 · ADR-0019) ──────────────────────────────────────────
   회차는 details 로 접는다 — 최신 1개만 열린 채 서버에서 오고, 브리핑 앵커로 들어오면
   그 회차가 추가로 열린다. 카드 계약(.surface-card)과 '펼친 것이 곧 활성'(surface-card[open])은
   wire-styles.ts 가 갖고, 여기서는 안쪽 배치와 계열 칩만 정한다. */
/* min-width:0 이 두 층에 다 필요하다(2026-07-30 1024px 실측으로 잡은 결함).
   그리드 아이템의 **자동 최소 크기는 min-content** 라, 접힌 줄의 white-space:nowrap 한 줄
   길이가 그대로 바닥이 되어 페이지 컨테이너를 1024 폭에서 918 까지 밀어냈다(가로 스크롤).
   한 줄 자체의 min-width:0 만으로는 안 풀린다 — 그건 레이아웃 때 줄어들 자유를 줄 뿐,
   컨테이너의 **고유 min-content 계산**에는 항목의 내용 폭이 그대로 들어가기 때문이다.
   그래서 바닥을 없애야 하는 곳은 한 줄이 아니라 그것을 담은 그리드 아이템이다. */
.record-list{display:grid;gap:var(--space-3);min-width:0}
.record-list>details{min-width:0}
/* 접힌 줄 = 펼친 카드의 머리. 두 상태가 같은 줄이라 자리가 안 흔들린다. */
.record-summary{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-6);cursor:pointer;list-style:none}
.record-summary::-webkit-details-marker{display:none}
.record-summary:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
.record-chevron{flex:none;width:12px;font-size:14px;color:var(--sub)}
.record-ordinal{flex:none;font-size:16px;font-weight:700;color:var(--ink)}
.record-held-at{flex:none;font-size:16px;color:var(--sub)}
/* 유형 칩 — 시간·상태 축이라 블루 tint. 글자는 --ink 다: 읽어야 하는 값이라 §9 의
   '보조 정보 한정' 대비 예외를 쓰지 않는다. 인테이크도 같은 블루이고 구분은 글자가 한다. */
.record-kind{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border-radius:var(--radius-pill);background:var(--blue-tint);font-size:14px;font-weight:700;color:var(--ink)}
/* 핵심 한 줄. 승인 전 폴백(수기 메모 발췌)은 --sub 로 낮춘다(D5). */
.record-one-liner{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;color:var(--ink)}
.record-one-liner.is-memo{color:var(--sub)}
.record-summary-right{flex:none;display:flex;align-items:center;gap:var(--space-2)}
/* 펼친 본문. 머리와 본문은 --gradient-brand 1px 로 나눈다(§5 카드 계약 — 그라데이션이
   남는 자리는 카드 안쪽 구분선뿐이다). */
.record-body{border-top:1px solid transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-brand) border-box;display:grid;gap:var(--space-5);padding:var(--space-5) var(--space-6)}
.record-block{display:grid;gap:var(--space-2)}
.record-block>h3{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.record-block>p{margin:0;font-size:16px;color:var(--ink);white-space:pre-wrap}
.record-block ul{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2)}
.record-block li{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-2);font-size:16px;color:var(--ink)}
/* '이번 상담의 목표' — GAS 가 있던 자리(D47 §2). 실무자가 정한 것이라 사람 축(민트)이다.
   재료가 없으면 이 블록 자체를 그리지 않는다 — 빈 블록은 뺀 자리를 다시 빈칸으로 만든다. */
.record-session-goal{display:grid;gap:var(--space-1);border-radius:var(--radius-control);background:var(--mint-tint);padding:var(--space-3) var(--space-4)}
.record-session-goal-label{font-size:14px;font-weight:700;color:var(--mint-deep)}
.record-session-goal p{margin:0;font-size:16px;color:var(--ink)}
/* 담당 칩 — 사람·소속 축(민트). 글자는 --ink(위 유형 칩과 같은 이유). */
.record-owner{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border-radius:var(--radius-pill);background:var(--mint-tint);font-size:14px;font-weight:700;color:var(--ink)}
/* AI 출처 칩 — AI 축(라벤더). 곁다리로 읽는 값이라 deep 글자가 남는 자리다(§9 예외). */
.record-ai-source{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border-radius:var(--radius-pill);background:var(--lavender-tint);font-size:14px;font-weight:700;color:var(--lavender-deep)}
.record-item-meta{font-size:14px;color:var(--sub)}
/* 리스크 레드는 **확인된** 플래그에만(D9·D34). 조회 API 가 확인된 것만 내려보내지만,
   색을 상태에 걸어 두면 나중에 범위가 넓어져도 규율이 깨지지 않는다. */
.record-flag{font-weight:700;color:var(--sub)}
.record-flag[data-confirmed="true"]{color:var(--risk)}
.record-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-4);border-top:1px solid var(--line);padding:var(--space-3) var(--space-6);font-size:14px;color:var(--sub)}
/* 전체 목표 한 줄 — 브리핑과 같은 어휘이되 이 화면은 읽기 전용이다(입력칸·저장 버튼 없음). */
.record-goal{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;padding:var(--space-4) var(--space-6)}
.record-goal-label{flex:none;font-size:14px;font-weight:700;color:var(--mint-deep)}
.record-goal-text{flex:1;min-width:0;margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.record-goal-text.is-empty{font-weight:400;color:var(--sub)}
.record-section-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:18px;font-weight:700;color:var(--ink)}
@media (max-width:767px){
  /* 좁으면 한 줄이 무너지므로 핵심 한 줄을 아래로 내린다(리스트 행 계약과 같은 접힘). */
  .record-summary{flex-wrap:wrap}
  .record-one-liner{flex-basis:100%;white-space:normal;overflow:visible}
}
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
/* G1: 긴급 등록(① 동의 하드 게이트의 예외). 예외 경로라 동의 3종과 가는 선 하나로 가르되,
   확인된 리스크가 아니므로 리스크 레드는 쓰지 않는다(D9 — 리스크 색 독점). */
.consent-emergency{display:grid;gap:var(--space-3);padding-top:var(--space-3);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
.consent-emergency textarea{min-height:88px}
`;

// CCC-19: 전체 일정(한 달 창). 행 어휘는 상담 기록 화면(D47)의 접힌 줄을 그대로 빌린다 —
// 같은 것을 두 화면에서 다르게 그리지 않기 위해서다. 새 색·새 반경은 없다.
const monthScheduleStyles = `
/* 월 이동 줄. 가운데 달 이름을 두고 좌우 화살표 버튼 — 사이드바=장소, 여기=창 이동이다. */
.month-nav{display:flex;align-items:center;justify-content:flex-start;gap:var(--space-4)}
.month-nav-label{min-width:9ch;font-size:16px;font-weight:700;color:var(--ink);text-align:center}
/* 하루 묶음. 날짜 제목 + 그 아래 붙은 행들 — 행이 붙어 있으므로 카드 계약이 아니라
   행 사이 1px --line 구분선을 쓴다(DESIGN.md §5 '리스트 행'의 맥락 규칙). */
.month-day{display:grid;gap:var(--space-3)}
.month-day-title{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.month-day-title[data-today="true"]{color:var(--blue-deep)}
.month-rows{display:grid;overflow:hidden;border-radius:var(--radius-card);border:1px solid var(--line);background:var(--panel)}
.month-rows>*+*{border-top:1px solid var(--line)}
.month-row{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-6);color:inherit;text-decoration:none}
@media (hover:hover){.month-row:hover{background:var(--muted)}}
.month-row:focus-visible{outline:2px solid var(--blue-deep);outline-offset:-2px}
/* 시간은 고정폭으로 세로 정렬을 맞춘다(§5 리스트 행: 시간 16/700 고정폭 → 이름 묶음). */
.month-row-time{flex:none;min-width:6ch;font-size:16px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
/* 이름 묶음 — '이름 (가명 ID)' 한 줄, 띄어쓰기는 문자열이 아니라 간격이 만든다(§5 이름 표기).
   이 블록은 템플릿 문자열이라 주석에도 백틱을 쓸 수 없다 — 쓰면 문자열이 거기서 끝난다. */
.month-row-name{display:flex;align-items:baseline;gap:var(--space-1);min-width:0;flex:1}
.month-row-name b{font-size:16px;font-weight:700;color:var(--ink);white-space:nowrap}
.month-row-name span{font-size:16px;font-weight:400;color:var(--sub);white-space:nowrap}
.month-row-right{flex:none;display:flex;align-items:center;gap:var(--space-2)}
/* 유형 칩 — 블루 tint + --ink 글자(D47 계열 칩 ①: 읽어야 하는 값이라 deep 을 쓰지 않는다). */
.month-row-kind{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border-radius:var(--radius-pill);background:var(--blue-tint);font-size:14px;font-weight:700;color:var(--ink)}
/* 상태는 지난 일정에만 붙는다(예정은 붙이지 않는다 — 대부분이 예정이라 전부 붙으면 소음이다).
   무채색 기본 배지다: 취소·불참은 경고가 아니라 사실이고, 리스크 색은 확인된 플래그 전용이다(D9). */
.month-row-status{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 10px;border:1px solid var(--sub);border-radius:var(--radius-pill);font-size:14px;font-weight:700;color:var(--sub)}
@media (max-width:767px){
  /* §5 모바일: 리스트 행은 시간+이름 / 메타 / 배지 3줄로 접힌다. */
  .month-row{flex-wrap:wrap}
  .month-row-name{flex-basis:calc(100% - 6ch - var(--space-3))}
  .month-row-right{flex-basis:100%}
}
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
/* margin-top 을 두지 않는다 — 바깥에서는 .wire-container 의 gap(--section-gap)이 이미
   섹션 간격을 주고, 카드 안에서는 그 여백이 제목 구분선 아래에 빈 띠로 남는다. */
.wire-invite-stack{display:grid;gap:var(--space-6)}
.wire-invite-section{display:grid;gap:var(--space-3)}
/* 왼쪽 정렬이다 — 가운데 정렬은 아래 입력칸 축에서 떨어져 나와 페이지마다 글이 다른 데서
   시작하는 것처럼 보인다(§5 '페이지 제목'이 가운데 정렬을 폐기한 것과 같은 이유). */
.wire-invite-caption{margin:0;font-size:14px;color:var(--sub)}
/* CCC-29: QR 은 입력칸이 아니라 카드 계약(--line 1px · radius 12)을 빌린 정사각 패널이다. */
.wire-invite-qr{display:inline-flex;justify-self:start;padding:var(--space-4);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card)}
/* 버튼은 내용만큼만 차지한다 — 그리드 아이템 기본 stretch 를 그대로 두면 카드 폭(880)을
   가로지르는 알약이 되어, 폼 제출도 아닌 행동이 마케팅 배너처럼 읽힌다. */
.wire-invite-stack .wire-button{justify-self:start}
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
/* 관리자 온보딩 2단계 (CCC-32). 새 시각 언어 없음 — .surface-card + 킷 부품 조합이고,
   단계 표시는 블루 계열(시간·상태 축, D34)이다. */
.onboarding-form{display:grid;margin-top:var(--space-8)}
.onboarding-card{display:grid;gap:var(--space-4);padding:var(--space-6)}
.onboarding-card h2{margin:0}
.onboarding-step{margin:0;justify-self:start;padding:2px 10px;border-radius:var(--radius-pill);background:var(--blue-tint);color:var(--ink);font-size:14px;font-weight:700}
.onboarding-help{margin:0;font-size:14px;color:var(--sub)}
.onboarding-actions{display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-2)}
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
/* 여닫기 줄 — 브리핑(.briefing-toolbar)과 같은 계약이다. 오른쪽 정렬, 고스트 32px 하나. */
.record-toolbar{display:flex;justify-content:flex-end}
.record-sticky,.record-accordion,.record-rail{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.record-sticky{position:sticky;top:0;z-index:var(--z-sticky);display:grid;gap:var(--space-2);padding:var(--space-4) var(--space-5)}
.record-sticky-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:var(--space-3) var(--space-4)}
.record-sticky-row>div:first-child{min-width:0;flex:1 1 240px}
.record-sticky-label{margin:0;font-size:14px;font-weight:700;color:var(--sub)}
.record-sticky-value{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.record-sticky-list{margin:0;padding-left:18px;display:grid;gap:var(--space-1);font-size:16px;font-weight:700;color:var(--ink)}
/* 나가기·저장(2026-07-31 Q). 이 둘은 원래 화면 양 끝에 흩어져 있었다 — 나가기는 제목 옆에서
   아무것과도 묶이지 않았고, 저장은 폼 맨 아래라 스크롤을 끝까지 내려야 보였다.
   고정 헤더에 함께 두면 어느 위치에서 쓰든 나가는 길과 저장이 늘 같은 자리에 있다.
   §4-5 순서를 따라 세컨더리 → 프라이머리이고, 좁아지면 줄바꿈한다. */
.record-sticky-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-2);flex:none}
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

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // 셸 = 좌측 사이드바 + 본문 (D35 · ADR-0014 §2). 768px 미만에서는 .app-shell 이 block 이 되고
  // **같은 사이드바가 드로어로 변한다**(DESIGN.md §4-4) — 화면 밖에 있다가 상단 손잡이 바를
  // 누르면 왼쪽에서 밀려 들어온다. 마크업이 한 벌이라 데스크톱·모바일 메뉴가 갈라질 수 없다.
  //
  // 공개 경로(CCC-28 · D39)는 이 셸 없이 렌더한다. middleware 가 /join 에 x-ccc-public 요청
  // 헤더를 붙이므로 서버에서 판별 가능 — 클라이언트 usePathname 으로 하면 서버 렌더와 어긋나
  // 하이드레이션 불일치가 난다. 셸을 빼면 AppSidebar 가 마운트되지 않아, 공개 당사자에게 실무자
  // 메뉴가 노출되지도 않고 사이드바가 신원을 물어 401 이 나지도 않는다. 스타일은 공개 화면에도
  // 전부 넣는다(가입 폼이 registerStyles 의 클래스를 쓰므로).
  const hdrs = await headers();
  const isPublic = hdrs.get('x-ccc-public') === '1';
  const shellStyles = styles + participantStyles + briefingStyles + settingsStyles + searchStyles + scheduleStyles + monthScheduleStyles + piiMaskingStyles + wireStyles + registerStyles + recordFormStyles;

  // 공개 경로는 표시 이름을 조회하지 않는다: 사이드바가 없어 값이 쓰이지 않고, 신원 없는
  // 요청으로 부르면 그 조회가 401 을 만든다(위 "사이드바가 신원을 물어 401" 과 같은 이유).
  if (isPublic) {
    return <html lang="ko"><head><style>{shellStyles}</style></head><body>{children}</body></html>;
  }

  // 기관·사업 표시 이름은 온보딩 저장값 우선(CCC-32) — 실패·미설정이면 헬퍼가 하드코딩 라벨로 폴백한다.
  const labels = await getDisplayLabels();
  // 본문 열을 div 로 한 번 감싼다 — 뒤로가기 줄이 본문과 **같은 컨테이너**(폭 1120·좌우 40)를
  // 써야 제목과 왼쪽 끝이 맞기 때문이다. 감싸지 않고 셸의 형제로 두면 그리드 다음 행,
  // 즉 사이드바 아래로 떨어진다.
  return (
    <html lang="ko">
      <head><style>{shellStyles}</style></head>
      <body>
        <div className="wire-shell app-shell">
          <AppSidebar orgLabel={labels.orgLabel} programLabels={labels.programLabels} />
          <div className="content-column">
            {/* nav 로 감싼다 — 화면에 보이는 유일한 출구인데 바깥에 두면 스크린 리더의
                랜드마크 이동에서 통째로 건너뛴다. */}
            <nav className="page-backbar" aria-label="페이지 이동"><BackLink /></nav>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
