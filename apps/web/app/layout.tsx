import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
// 디자인 토큰 SSOT(V0.1 · D34/ADR-0012). 값을 이 파일에 복사하지 않는다 — 두 곳에 두면
// 다시 어긋난다. 색값 정본은 pen '색 토큰' 페이지이고, tokens.css 가 그 기계 소비용 사본이다.
import '../../../design/tokens.css';
// 달력 부품의 기본 CSS(D48 · ADR-0020). 겉모습은 wire-styles.ts '날짜 선택' 절이 D34 토큰으로
// 덮어쓴다 — 이 파일은 격자 배치·숨김 규칙처럼 덮으면 안 되는 뼈대만 제공한다.
import 'react-day-picker/style.css';
import { AppHeader } from './components/wire/app-header';
import { AppSidebar } from './components/wire/app-sidebar';
import { BackLink } from './components/wire/back-link';
import { getDisplayLabels } from './lib/display-labels';
import { THEME_COOKIE_NAME, parseTheme } from './lib/theme-cookie';
import { wireStyles } from './components/wire/wire-styles';

// 앱 셸·레거시 화면 공통. 토큰은 design/tokens.css 에서만 온다 — 여기에 :root 를 다시 두지 않는다.
// 폐기 토큰 3종(--strong · --accent · --success)은 V0.1 에서 없앴다. --success 는 GAS 긍정을
// 색으로 표시하지 않는다는 D6·R4 와 정면 충돌해 역할 자체가 사라진 것이다.
const styles = `
:root{font-family:var(--font-sans);color:var(--ink);letter-spacing:var(--tracking-base)}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);font-size:var(--text-md);line-height:var(--leading-body)}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit}
/* 셸 = 헤더 1행(전폭) + 사이드바·본문 1행 (2026-08-05 Q — 헤더는 사이드바 위까지 화면
   전체 폭으로 확장하고, 기관명을 사이드바 메뉴('다가오는 일정')와 같은 좌측선(24)에 세운다). */
.app-shell{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);min-height:100dvh}
/* 사이드바(§4): **캔버스 배경 + 오른쪽 1px 그라데이션 라인**(2026-08-05 Q — 구 --gradient-sidebar
   면 배경 폐지: "모두 라인으로 영역 구분". 라인 3색은 그 배경의 블루→민트→라벤더 축 그대로).
   **뷰포트 고정**(2026-08-02 D58/CCC-52): 본문이 스크롤해도 제자리다. 메뉴가 넘치면
   아래 .navigation-list 만 안에서 스크롤한다.
   768 미만 드로어 블록이 position:fixed 로 덮으므로 여기 값은 데스크톱에만 산다.
   헤더가 1행을 차지하므로 sticky 기준은 헤더 아래(top 56)이고, 위 패딩 20 은 첫 메뉴 항목의
   윗변을 본문 열 '뒤로' 알약의 윗변(56+20=76)과 같은 높이에 세운다. */
.sidebar{display:flex;flex-direction:column;gap:var(--space-8);padding:var(--space-5) var(--space-6) var(--space-6);background:var(--canvas);color:var(--ink);position:sticky;top:var(--header-height);height:calc(100dvh - var(--header-height));overflow:visible}
.sidebar::after{content:"";position:absolute;top:0;bottom:0;right:0;width:1px;background:var(--gradient-frame-v)}
/* 메뉴만 내부 스크롤 담당(min-height:0 이 없으면 flex 아이템이 내용 높이를 고집해 안 줄어든다). */
.sidebar>.navigation-list{overflow-y:auto;min-height:0}
.navigation-link{display:flex;align-items:center;gap:var(--space-2)}
/* 드로어 머리 줄(768 미만 전용): 계정 행동 묶음(좌) + 닫기 X(우) — 2026-08-06 Q,
   구 기관명(브랜드 링크) 줄 대체. 기관·사업 맥락은 모바일 바가 전담한다. */
.sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)}
.sidebar-actions{display:flex;align-items:center;gap:var(--space-2)}
/* 드로어 닫기 X (2026-08-04 Q — 구 하단 '메뉴 닫기' 버튼 대체). 데스크톱엔 없다.
   **동그라미 버튼**이다(같은 날 Q — 뒤로 알약과 같은 세컨더리 옷: 그라데이션 1px 테두리 +
   --panel 채움). 28×28 로 기관 마크(32)보다 한 단 작다(2026-08-05 Q 2차 "X 버튼 크기랑
   조직 로고 크기랑 좀 맞추자 — 줄여도 될듯": 닫기는 보조 행동이라 마크 아래 서열). */
.drawer-dismiss{--button-fill:var(--panel);display:none;place-items:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);cursor:pointer}
@media (hover:hover){.drawer-dismiss:hover{--button-fill:color-mix(in srgb,var(--ink) 6%,var(--panel))}}
.drawer-dismiss:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* optical: 한글 잉크가 상자 중심보다 ~1px 위에 앉는다(16px·행간 1.55 실측 −1.08px, 2026-08-04
   canvas TextMetrics). 아이콘은 기하 중앙이라 글자만 1px 내려 잉크 중심을 맞춘다(보정 후 −0.07px).
   버튼의 --nudge-hangul(행간 1 전용, 0 확정)과 다른 행간 조합이라 별도 보정이다.
   기관명(18px)은 원래 −0.34px 라 보정하지 않는다 — 1px 을 얹으면 +0.66 으로 더 어긋난다. */
.navigation-link>span:not(.navigation-soon){transform:translateY(1px)}
.brand-mark{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--panel);color:var(--ink)}
/* 사업 전환기(D35·ADR-0014 §2): 기관명 아래·메뉴 위. 아래 메뉴의 범위를 정하므로
   포함 관계가 눈으로 읽히게 위에 둔다. 사업이 1개여도 선택창이다(2026-08-03 Q). */
/* 알약이 아니라 radius 6 이다(§4-5) — 행동 버튼이 아니라 값을 고르는 컨트롤이다. */
/* 2026-08-04 Q: '사업' 라벨은 선택창 **위** 2단이다(구 2026-08-03 '라벨+흰 상자 한 줄' 대체) —
   라벨 줄과 흰 상자가 사이드바 좌측선에 같이 선다. */
.program-switcher{display:flex;flex-direction:column;align-items:stretch;gap:var(--space-2)}
/* 흰 상자가 곧 선택창이다. 드롭다운의 기준점(position:relative)도 여기다.
   경계 --line-control 1px 은 2026-08-05 에 얹었다 — 드로어 배경이 그라데이션에서 캔버스로
   바뀌어, 캔버스(#FAFAF9) 위 흰 상자는 경계 없이는 형태가 안 잡힌다(§5 입력칸 계약). */
.program-switcher-box{position:relative;flex:1;min-width:0;display:grid;padding:var(--space-2) var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel)}
/* (구 .sidebar>.program-switcher 구분선 규칙 2026-08-06 제거 — 드로어에서 기관·사업
   블록이 빠져 선의 주인이 머리 줄(.sidebar-head::after, 모바일 블록)로 옮겨 갔다.) */
/* 라벨 색은 메뉴 비활성과 같은 --sub 다(2026-08-04 Q — 구 민트 deep 대체). 사이드바 글자는
   기본 500·강조 600, 크기 하한 16(--text-md) — 같은 그릴링의 사이드바 타이포 계약. */
.program-switcher-label{margin:0;color:var(--sub);font-size:var(--text-md);font-weight:500}
/* 사업 이름은 한 줄이고, 넘치면 꺾쇠(V) 앞에서 **자연스럽게 사라진다**(2026-08-03 Q —
   말줄임표가 아니라 마스크 페이드). 마스크는 알파만 쓰므로 색은 불투명하면 무엇이든 같다. */
.program-switcher-name{flex:1;min-width:0;margin:0;overflow:hidden;white-space:nowrap;color:var(--ink);font-size:var(--text-md);font-weight:500;-webkit-mask-image:linear-gradient(90deg,var(--ink) calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,var(--ink) calc(100% - 28px),transparent)}
/* 사업 전환기 드롭다운(2026-07-31). 방아쇠는 카드 안을 꽉 채우는 투명 버튼이다 — 알약을
   덧대면 카드 안에 컨트롤이 두 겹으로 보인다. 값 글자는 --ink 그대로(§9 대비 예외는 보조
   정보 한정이라 읽어야 하는 값에 deep 을 쓰지 않는다). */
/* min-width:0 이 필요하다 — 그리드 아이템의 자동 최소 크기는 min-content 라, nowrap 사업
   이름이 그대로 바닥이 되어 상자가 사이드바 밖으로 넘친다(2026-08-03 실측). */
.program-switcher-trigger{display:flex;align-items:center;gap:var(--space-2);width:100%;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
/* 상하 꺽쇠(2026-08-05 2차 — 구 아래 꺽쇠 대체). 값을 고르는 컨트롤의 어휘라 --sub 로
   한 발 물러선다 — 이름이 주인공이고 꺽쇠는 여긴 고를 수 있다는 표시다. */
.program-switcher-trigger .switcher-updown{margin-left:auto;flex:none;display:grid;place-items:center;color:var(--sub)}
.program-switcher-trigger:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px;border-radius:var(--radius-control)}
/* 목록은 카드 바로 아래에 뜬다. 표면 계약은 date-picker 팝오버와 같은 값을 쓴다
   (--panel · --radius-card · --shadow-soft · z 30) — 새 표면을 만들지 않는다. */
/* 접힌 상자에서는 이름이 잘려도, **열면 전체 글자가 보인다**(2026-08-03 Q) — 목록 폭은
   내용만큼(max-content) 벌어진다. 상한은 사이드바 폭이 아니라 **본문까지 침범하는 넉넉한
   폭**이다(2026-08-04 Q — 구 상한에서는 긴 사업명이 사이드바 끝에서 잘렸다. .sidebar 의
   overflow 도 같이 풀었다). 상한을 넘는 극단만 아래 옵션 규칙의 마스크로 사라진다. */
.program-switcher-menu{
  position:absolute;top:calc(100% + var(--space-2));left:0;z-index:var(--z-dropdown);
  min-width:100%;width:max-content;max-width:min(60vw,480px);
  display:grid;gap:var(--space-0-5);padding:var(--space-2);margin:0;list-style:none;
  border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel);box-shadow:var(--shadow-soft);
}
.program-switcher-option{display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-2);border-radius:var(--radius-control);color:var(--ink);font-size:var(--text-md);font-weight:500}
/* 상한을 넘는 이름은 옵션 안에서도 같은 방식으로 사라진다 — 말줄임표를 쓰지 않는다(위 이름 규칙과 동일 어휘). */
.program-switcher-option>span:last-child{min-width:0;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(90deg,var(--ink) calc(100% - 20px),transparent);mask-image:linear-gradient(90deg,var(--ink) calc(100% - 20px),transparent)}
.program-switcher-option[data-selected="true"]{background:var(--blue-tint);font-weight:600}
@media (hover:hover){.program-switcher-option:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}}
/* 체크 글자에 deep 을 쓰지 않는다(§9 대비 예외는 보조 정보 한정). 선택 신호는 --blue-tint 면이 갖는다. */
.program-switcher-check{width:14px;flex:none;color:var(--ink)}
/* (구 2026-08-04 :has z-lift 규칙은 2026-08-05 에 걷었다 — 데스크톱 전환기가 상단 헤더로
   옮겨 가, 팝업이 sticky 사이드바의 스태킹 컨텍스트에 갇히는 문제 자체가 사라졌다.
   헤더는 z-sticky 라 팝업(z-dropdown)이 본문 위에 선다. 드로어(768 미만)는 z-modal 그대로다.) */
/* 좌우 -12(--space-3)는 항목의 안쪽 패딩만큼 알약을 되밀어 **아이콘·글자가 사이드바
   좌측선(패딩 24)에 서게** 한다(2026-08-04 Q — 기관 마크·'사업' 라벨·선택창 상자와 한 줄).
   알약 배경은 12까지 삐져나오지만 콘텐츠 정렬이 우선이다. */
.navigation-list{display:grid;gap:var(--space-1);padding:0;margin:0 calc(var(--space-3) * -1);list-style:none}
/* 테두리 1px 은 전 상태 투명으로 깔아 둔다 — 활성만 테두리를 얹으면 상자가 2px 자라
   글자가 상태 전환마다 1px 씩 튄다. */
.navigation-link{min-height:var(--control-height);padding:0 var(--space-3);border:1px solid transparent;border-radius:var(--radius-control);color:var(--sub);font-size:var(--text-md);font-weight:500;transition:background-color .12s ease,color .12s ease}
/* 마우스가 실제로 있는 기기에서만 호버를 켠다 — 터치 기기는 탭한 항목에 :hover 가 남아
   "눌린 채로 굳은" 것처럼 보인다(2026-07-26 Q 보고). */
@media (hover:hover){
  /* 호버 = **어두운 면 위 그라데이션 글자**다(2026-08-03 Q — 구 잉크 6% 워시 대체).
     활성(블루 tint)과 어휘가 완전히 갈려, 지나가는 중과 지금 있는 곳이 섞여 보이지 않는다.
     아이콘은 currentColor 라 --panel(흰색)로 남긴다 — 파스텔 그라데이션을 획에 얹으면
     16px 라인 아이콘은 획이 끊겨 보인다. */
  .navigation-link:not([data-current="true"]):hover{background:var(--ink);color:var(--panel)}
  .navigation-link:not([data-current="true"]):hover>span:not(.navigation-soon){background:var(--gradient-brand);-webkit-background-clip:text;background-clip:text;color:transparent}
  /* 다크에서는 --ink 가 밝은 색이라 뒤집힌다 — 어두운 면은 --canvas 가, 아이콘은 --ink 가 맡는다. */
  [data-theme="dark"] .navigation-link:not([data-current="true"]):hover{background:var(--canvas);color:var(--ink)}
  /* 활성 항목 위에서는 활성 표시가 이겨야 한다 — 호버가 덮으면 "지금 어디인지"가 사라진다. */
  .navigation-link[data-current="true"]:hover{background:linear-gradient(var(--blue-tint),var(--blue-tint)) padding-box,var(--gradient-brand) border-box;color:var(--ink)}
}
/* 활성 내비는 블루 계열(시간·상태). 단 **글자는 --ink** 다 — --blue-deep(#67a9f0)을 --blue-tint
   위에 얹으면 대비가 1.9 라 라벨이 읽히지 않고, 비활성(--sub #534e57)보다 오히려 흐려져
   위계가 뒤집힌다. DESIGN.md §9 의 대비 예외는 '보조 정보 한정'이라 주 메뉴 라벨은 대상이 아니다.
   블루 신호는 아이콘이 갖는다 — 색은 남고 글자는 읽힌다. */
/* 활성 = tint 채움 + --gradient-brand 1px 테두리 (2026-08-04 Q — --blue-tint #E7EEF8 가
   사이드바 그라데이션 최상단 색과 동일해 위쪽 메뉴에서 활성 상자가 아예 안 보였다.
   그라데이션 테두리는 D58 '선택·활성' 어휘다). */
.navigation-link[data-current="true"]{background:linear-gradient(var(--blue-tint),var(--blue-tint)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-weight:600}
.navigation-link[data-current="true"] svg{color:var(--blue-deep)}
/* '준비 중' 배지 — 화면이 아직 없는 메뉴를 누르기 전에 알린다(CCC-23). 중립 회색 알약(§5 상태 배지).
   파스텔 신호 축(블루·민트·라벤더)에 속하지 않는 상태라 새 색을 쓰지 않는다. */
.navigation-soon{margin-left:auto;padding:0 var(--space-2);border:1px solid var(--sub);border-radius:var(--radius-pill);font-size:var(--text-md);font-weight:500;color:var(--sub);white-space:nowrap}
/* (구 .sidebar-footer 는 2026-08-06 제거 — 계정 행동 묶음이 드로어 상단 줄로 올라갔다.
   .sidebar-actions 가 그 묶음이다.) */
/* 데스크톱(768 이상): 머리(기관명)·사업 전환기·하단 묶음은 상단 헤더로 옮겨 갔다(2026-08-05 Q —
   Infisical 레퍼런스. D50 의 사이드바 배치·D58 ⑤ '하단 묶음 상시 노출'의 자리 부분 대체).
   마크업은 드로어(768 미만)가 그대로 쓰므로 지우지 않고 숨긴다 — app-sidebar.tsx 주석 참조.
   자식 선택자(0,2,0)인 이유: 개별 블록 규칙(.sidebar-head 등, 0,1,0)이 시트 뒤쪽에 있어
   동순위면 그쪽이 이긴다 — 미디어 쿼리는 특이도를 올려 주지 않는다. */
@media (min-width:768px){.sidebar>.sidebar-head{display:none}}
/* ── 드로어 부품 ── 데스크톱에는 없다(§4-4 는 768 미만에서만 드로어라고 말한다). */
/* 모바일 바 = 좁은 화면의 헤더다(2026-08-05 Q 2차 — 같은 날 ④ '메뉴 버튼만' 대체):
   좌측 = 기관·사업 선택창(데스크톱 헤더와 같은 내용), 우측 = 원형 사이드바 버튼.
   경계는 데스크톱 헤더와 같은 그라데이션 라인 1px. 선택창 팝오버가 바 밖(본문 위)으로
   나와야 하므로 z 는 스티키 층이다 — 팝오버(z-dropdown)는 이 스태킹 컨텍스트 안에서
   본문(z 0) 위에 선다. */
.drawer-bar{display:none;align-items:center;gap:var(--space-3);width:100%;height:56px;padding:0 var(--space-4);background:var(--canvas);color:var(--ink);position:sticky;top:0;z-index:var(--z-sticky)}
.drawer-bar::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--gradient-frame)}
/* 사이드바 버튼(구 햄버거+'메뉴' 글자)은 .header-icon-button 원형 옷을 그대로 입는다 —
   "circle + 아이콘 버튼을 웹화면과 통일"(2026-08-05 Q 2차). 자리만 바 오른쪽 끝. */
.drawer-bar .drawer-handle{margin-left:auto;flex:none}
.drawer-scrim{position:fixed;inset:0;background:var(--scrim);z-index:calc(var(--z-modal) - 1)}
/* ── 상단 헤더 (2026-08-05 Q · Infisical 레퍼런스 — 구 락 8 '상단 헤더 띠 금지' 대체) ──
   축이 두 층으로 갈린다: 헤더 = 맥락(기관·사업) + 계정 행동(설정·테마·로그아웃) /
   사이드바 = 장소(메뉴). **화면 전체 폭**(사이드바 위까지, 셸 그리드 1행)이고 z 는 스티키 층 —
   같은 날 Q "z-index 최상위로 확장". 좌우 패딩 24 라 기관 마크가 사이드바 메뉴 아이콘과
   같은 좌측선(24)에 선다. 배경은 캔버스 그대로, 본문과는 **하단 1px 그라데이션 라인**으로만
   가른다(같은 날 Q — ① 면 배경안 폐지 "라인으로만" ② 라인 색은 3색 그라데이션).
   sticky 라 스크롤해도 남는다. 768 미만에는 없다 — 손잡이 바 + 드로어가 담는다(§4-4). */
/* gap 32 는 기관명↔사업명 간격을 2배로 벌린 값이다(2026-08-05 Q — 구 16). */
.app-header{grid-column:1/-1;position:sticky;top:0;z-index:var(--z-sticky);display:flex;align-items:center;gap:var(--space-8);height:var(--header-height);padding:0 var(--space-6);background:var(--canvas)}
.app-header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--gradient-frame)}
/* optical: -7 은 기관 마크(32px 상자) 중심을 아래 메뉴 아이콘 중심(x=33: 패딩 24 + 알약 테두리 1
   + 아이콘 반폭 8)에 맞추는 값이다(2026-08-05 Q "메뉴 아이콘이랑 조직 로고랑 가운데 정렬") —
   33 − 16 = 17 이라 패딩 24 에서 7 을 되민다. 간격 토큰이 아니라 정렬 보정이다.
   (2026-08-05 2차: 기관명이 홈 링크 .brand 에서 기관 선택창으로 바뀌어 대상만 옮겼다 —
   마크가 트리거 첫 요소라 같은 좌측선 계산이 그대로 선다.) */
.app-header .org-switcher{margin-left:-7px}
/* 기관 | 사업 세로 구분선 — 글자 구분자(/·|)를 쓰지 않는다(§10). */
.header-divider{flex:none;width:1px;height:20px;background:var(--line)}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:var(--space-2)}
.header-action-form{margin:0;display:flex}
/* 계정 행동 3개 = 32px 원형 아이콘 버튼 — 드로어 닫기 X 와 같은 세컨더리 옷(그라데이션
   1px 테두리 + --panel 채움). 라벨은 aria-label + title 이 갖는다. */
.header-icon-button{--button-fill:var(--panel);display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);cursor:pointer}
@media (hover:hover){.header-icon-button:hover{--button-fill:color-mix(in srgb,var(--ink) 6%,var(--panel))}}
.header-icon-button:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* 설정이 현재 화면이면 활성 어휘(블루 tint 채움 + 블루 아이콘)를 입는다 — 내비 활성과 같은 신호. */
.header-icon-button[data-current="true"]{--button-fill:var(--blue-tint)}
.header-icon-button[data-current="true"] svg{color:var(--blue-deep)}
/* 헤더 안 전환기: **상자 없이 텍스트 + 화살표**다(2026-08-05 Q — '사업' 라벨도 뺀다.
   드로어에서는 구 형태(라벨 위 2단 + 흰 상자) 그대로). 라벨 p 는 display:none 이어도
   aria-labelledby 가 읽으므로 접근 이름("사업 <사업명>")은 유지된다.
   상자 노드는 드롭다운의 기준점(position:relative)으로만 남는다. */
/* 모바일 바(.drawer-bar)도 헤더와 같은 '상자 없는 텍스트' 전환기 옷을 입는다(2026-08-05 2차
   "웹화면, 모바일화면 동시수정"). */
.app-header .program-switcher,.drawer-bar .program-switcher{flex:none;flex-direction:row;align-items:center}
.app-header .program-switcher-label,.drawer-bar .program-switcher-label{display:none}
/* 폭 상한은 느슨하다(2026-08-05 Q "여백 많으니까 더 펼쳐줘" — 구 min(32vw,360px)에서는 긴
   사업명이 헤더의 빈 공간을 두고도 잘렸다). 웬만한 사업명은 끝까지 보이고, 상한을 넘는
   극단만 마스크로 사라진다. */
.app-header .program-switcher-box,.drawer-bar .program-switcher-box{flex:none;width:max-content;max-width:min(50vw,560px);padding:0;border:0;background:transparent}
/* 바에서는 사업 전환기가 남는 폭을 쓴다 — 기관(flex:none)·버튼(32) 사이에서 이름이 줄고,
   상한을 넘는 글자는 이름 규칙의 마스크가 지운다. */
.drawer-bar .program-switcher:not(.org-switcher){flex:1 1 auto;min-width:0}
.drawer-bar .program-switcher:not(.org-switcher) .program-switcher-box{width:max-content;max-width:100%}
/* 사업명은 현재 워크스페이스라 강조 600 — 셸 활성 어휘(§2-1 역할표). */
/* optical: 28 은 간격이 아니라 이름 규칙의 마스크 페이드 구간 폭이다 — 그 구간을 글자 뒤
   **빈 패딩**으로 밀어내, 상한(560) 안에서는 마지막 글자까지 불투명하게 만든다(2026-08-05 Q
   "여백 많으니까 더 펼쳐줘" — 구 상태에서는 안 잘렸는데도 끝 글자가 항상 흐려져 잘린 것처럼
   보였다). 상한을 넘는 극단만 기존 어휘대로 페이드로 사라진다. margin -28 은 빈 구간만큼
   화살표를 되당겨 이름↔화살표 간격 8 을 유지한다. */
.app-header .program-switcher-name,.drawer-bar .program-switcher-name{font-weight:600}
/* 빈 패딩 마스크 트릭(글자 뒤 28 빈 구간)은 **헤더 전용**이다 — 폭이 넉넉해 안 잘릴 때
   끝 글자가 흐려지는 것만 막는다. 바(좁은 화면)에서는 트릭이 꺽쇠 밑까지 글자를 밀어 넣어
   겹쳐 보였다(2026-08-06 Q ④) — 바는 기본 마스크가 꺽쇠 앞 28px 에서 먼저 지운다. */
/* optical: 28 은 간격이 아니라 이름 마스크의 페이드 구간 폭이다 — 그 구간을 글자 뒤 빈
   패딩으로 밀어내고, margin -28 이 꺽쇠를 되당겨 이름↔꺽쇠 간격 8 을 유지한다. */
.app-header .program-switcher-name{padding-right:28px;margin-right:-28px}
/* 기관명 크기 = 사업명 크기(16/600) — 2026-08-06 Q ⑤, 구 18(--text-lg) 대체. */
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
/* (.narrow 960 은 2026-08-05 폐지 — Q "특별한 이유가 없으면 장폭은 가장 넓은 페이지에 맞춰
   고정". 장폭은 --page-max 1120 하나다. 폼의 읽기 폭은 페이지가 아니라 폼 자신이 좁힌다.) */
/* ── 뒤로가기 줄(2026-07-31) ── 본문 열을 감싸는 div 와 그 안 첫 줄.
   min-width:0 이 필요하다 — 그리드 아이템의 기본 min-width:auto 때문에 내용이 넓으면
   본문 열이 트랙을 넘어 사이드바를 밀어낸다(표·코드 블록에서 실제로 난다). */
.content-column{display:flex;flex-direction:column;min-width:0}
/* 뒤로 알약은 **사이드바 쪽 고정**이다(2026-08-05 Q — 구 2026-08-04 '가운데 컨테이너 정렬 +
   본문 열 전체 가로선(높이 72 연속)' 계약 대체). 헤더 신설로 사이드바 상단 기하(기관명 중심
   36 · 구분선 72)가 사라져 선을 이을 대상이 없고, 알약은 컨테이너가 아니라 사이드바 안쪽선
   (24)에 붙는다 — 프레임 크롬이라 본문 제목과 왼쪽 끝을 맞추지 않는다(같은 날 Q 확인:
   본문은 가운데 정렬 유지). 뒤로가 안 그려지는 화면(히스토리 없음)은 이 줄이 0 높이다. */
.page-backbar{padding:0}
.page-backbar:has(.page-back){padding:var(--space-5) var(--space-6) 0}
/* 뒤로 알약이 있으면 본문 위 여백은 40 대신 24 — 알약 줄이 이미 20 을 벌렸다. */
.page-backbar:has(.page-back)+.page-content{padding-top:var(--space-6)}
/* 고스트 버튼 계약(§5): 배경·테두리 없음, --sub 글자. 되돌리기는 주 행동이 아니다. */
/* 뒤로가기도 알약 버튼이다(2026-08-04 Q — 구 투명 텍스트 대체). 단독 클릭 요소는 전부
   알약(D58 ⑥)이라 세컨더리 sm 과 같은 옷을 입는다 — 그라데이션 1px 테두리 + --panel 채움.
   --button-fill 은 .wire-button 과 같은 지역 변수 패턴(호버가 채움만 바꾼다). */
.page-back{--button-fill:var(--panel);display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--pill-height);padding:0 var(--space-3-5);border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-size:var(--text-sm);font-weight:600;cursor:pointer}
@media (hover:hover){.page-back:hover{--button-fill:color-mix(in srgb,var(--ink) 6%,var(--panel))}}
/* 눌림 모션(1px 가라앉음)은 일부러 없다(2026-08-04 Q) — 바로 아래 가로선에 걸려 보인다. */
.page-back:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* h1 과 행동 버튼(40)은 세로 중앙으로 맞춘다(2026-08-04 Q — flex-start 는 제목이 위로 떠 보였다). */
.page-header{display:flex;justify-content:space-between;gap:var(--space-6);align-items:center}
/* 우상단 행동 묶음 (D35 — 사이드바=장소 / 페이지 우상단=행동). 주 행동이 오른쪽 끝이다. */
.page-actions{display:flex;align-items:center;gap:var(--space-3);flex:none}
h1{margin:0;font-size:var(--text-2xl);line-height:var(--leading-tight)}
h2{margin:0;font-size:var(--text-lg);line-height:var(--leading-snug)}
p{margin:var(--space-2) 0 0;color:var(--sub)}
/* 버튼 규칙은 **.wire-button 하나가 소유한다**(2026-07-31). 여기 있던 .button 4종
   (.button-primary·.button-ghost·.button-danger·.button-sm)은 지웠다 — 마크업이 한 곳도
   쓰지 않는 죽은 CSS 였는데, 같은 계약을 두 벌로 적어 둔 탓에 §5 를 고칠 때마다 어느 쪽을
   고쳐야 하는지가 매번 판단거리였다. 무해한 죽은 코드가 아니라 **드리프트의 저장고**다.
   앱은 전부 WireButton 을 쓴다(components/wire/wire-button.tsx). */
/* 입력칸(§5): 높이 40 · radius 6 · --line-control 1px. 라벨은 항상 위에 둔다. */
/* 레거시 화면의 떠 있는 표면들도 카드 계약을 쓴다(§5). 기본 테두리는 **회색 --line** 이고,
   그라데이션 테두리는 선택·활성일 때만 쓴다(2026-07-26 Q 지적 · pen 실측). 채움은
   --surface-fill 로만 바꾼다 — 선택 상태는 배경 2겹이라 background 를 통째로 덮으면 테두리가 날아간다. */
.panel,.schedule-form{
  --surface-fill:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  background:var(--surface-fill);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.panel-meta{color:var(--sub);font-size:var(--text-sm);font-weight:600}
/* 상태 배지(§5 기본 배지): 색 없이 --sub 테두리로만 선다. */
.status{display:inline-flex;width:max-content;min-height:var(--badge-height);align-items:center;padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;color:var(--sub);font-size:var(--text-sm);font-weight:600}
/* 주의·대기·미완료는 라벤더 tint 배지다(색 규율 5 — v1 검정 반전 배지를 대체). */
.warning{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.risk{border-color:transparent;background:var(--risk-tint-solid);color:var(--risk)}
/* D58 계열 의미 고정(CCC-54): 민트=진행·상태, 블루=정보·일정. 읽어야 하는 값이라 글자는 --ink(D47). */
.status.mint{border-color:transparent;background:var(--mint-tint);color:var(--ink)}
.status.blue{border-color:transparent;background:var(--blue-tint);color:var(--ink)}
.panel{padding:var(--space-6)}
.empty{display:flex;align-items:center;gap:var(--space-2);min-height:92px;color:var(--sub);font-size:var(--text-sm)}
.form{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.42fr);gap:var(--space-5);align-items:start}
/* 라벨은 14/700 --sub 로 값 위에 둔다 — 입력 경계선(1.28) 하나에 기대지 않기 위한 규칙(§9). */
.field{display:grid;gap:var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.field input,.field select,.field textarea{width:100%;min-height:var(--control-height);padding:var(--space-2) var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:var(--text-md);font-weight:400}
/* 라디오·체크박스는 텍스트 칸이 아니다. 위 규칙의 width:100% 를 그대로 먹으면 동그라미가
   칸을 가로질러 늘어나고 라벨이 아래 줄로 밀려난다 — 선택지가 세로로 한 글자씩 쪼개져
   읽히던 원인이다(2026-07-26 Q 보고 "너무 좁아서 쓸 수 없는 칸"). */
.field input[type="radio"],.field input[type="checkbox"]{width:auto;min-height:0;padding:0;border:0;border-radius:0;background:none;accent-color:var(--blue-deep)}
/* 선택지 한 줄: 동그라미와 글자를 같은 줄에 세우고 누를 면적을 컨트롤 높이만큼 준다. */
.field:has(>span>input[type="radio"])>span,.field:has(>span>input[type="checkbox"])>span{
  display:flex;align-items:center;gap:var(--space-2);min-height:var(--control-height);
  color:var(--ink);font-size:var(--text-md);
}
textarea{min-height:216px;resize:vertical}
.note{display:flex;gap:var(--space-3);padding:var(--space-5) var(--space-6);border-radius:var(--radius-card);background:var(--muted)}
.note p{font-size:var(--text-sm)}
@media(max-width:767px){
  /* ── 768 미만: 사이드바는 드로어다 (§4-4) ──
     가로 줄로 눕히면 기관명·사업 전환기·메뉴가 한 줄에 밀려 아무것도 안 읽힌다.
     좁은 화면에서 '장소 전환'은 자주 하는 동작이 아니므로 평소엔 화면 밖에 두고
     손잡이를 눌렀을 때만 왼쪽에서 밀어 넣는다. 본문은 폭을 온전히 쓴다. */
  .app-shell{display:block}
  /* 상단 헤더는 데스크톱 전용(2026-08-05) — 좁은 화면은 드로어가 기관·사업·메뉴·계정
     행동을 전부 담는 기존 구조 그대로다(§4-4). */
  .app-header{display:none}
  .drawer-bar{display:flex}
  /* 드로어는 **오른쪽**에서 나온다(2026-08-06 Q ① — 여는 버튼이 바 오른쪽 끝이라
     패널도 같은 쪽에서 나와야 손과 눈이 이어진다. 구 왼쪽 대체). */
  .sidebar{
    position:fixed;top:0;bottom:0;right:0;left:auto;
    /* height 해제가 필수다 — 데스크톱 규칙의 calc(100dvh - 56px)가 남으면 top·bottom 을
       둘 다 박아도 height 가 이겨 드로어가 화면 아래 56px 을 못 덮는다(844 실측 788). */
    height:auto;
    width:280px;max-width:82vw;
    /* 위 패딩 0: 머리 줄이 스스로 높이 56 을 갖는다(아래 .sidebar-head — 바와 같은 높이).
       세로 스크롤은 데스크톱과 같은 구조로 메뉴 목록(.navigation-list)이 안에서만 맡는다. */
    padding:0 var(--space-6) var(--space-6);overflow:visible;
    z-index:var(--z-modal);
    transform:translateX(100%);transition:transform .15s ease;
  }
  /* 데스크톱의 오른쪽 세로 프레임 라인은 드로어에서 **왼쪽** 모서리로 옮긴다 — 패널이
     오른쪽에서 나오므로 본문과 만나는 모서리가 왼쪽이다. */
  .sidebar::after{right:auto;left:0}
  .sidebar[data-drawer-open="true"]{transform:none}
  .drawer-dismiss{display:grid}
  /* 머리 줄 높이 = 바 높이 56, 아래 1px 구분선이 정확히 y 56 — **본문 바의 프레임 라인과
     같은 높이**다(2026-08-05 Q "가로선 정렬" 유지. 선의 주인은 2026-08-06 에 사라진 사업
     전환기에서 머리 줄 ::after 로 옮겨 왔다). */
  .sidebar-head{position:relative;min-height:56px}
  .sidebar-head::after{content:"";position:absolute;left:calc(var(--space-6) * -1);right:calc(var(--space-6) * -1);bottom:0;height:1px;background:var(--line-sidebar)}
  /* 드로어 안 모든 아이템의 좌우 시작선을 맞춘다(2026-08-06 Q ③): 메뉴 알약의 -12 좌측
     보정을 풀면 활성 배경 상자·계정 행동 버튼(좌 24)과 닫기 X·상자 우변(우 24)이 한 줄에
     선다. 데스크톱의 -12 는 아이콘·글자를 24 에 세우는 보정이라 그대로 둔다. */
  .sidebar .navigation-list{margin-inline:0}
  /* 바의 선택창 목록은 상자가 아니라 **바 전폭**에 떨어진다 — 상자 기준 왼쪽/오른쪽 닻은
     어느 쪽이든 좁은 화면을 뚫거나 이름을 다시 자른다. 상자의 positioning 을 풀면 기준이
     바(sticky = positioned)로 올라가고, 좌우 16 만 남기고 화면 폭을 온전히 쓴다. */
  .drawer-bar .program-switcher-box{position:static}
  .drawer-bar .program-switcher-menu{left:var(--space-4);right:var(--space-4);width:auto;min-width:0;max-width:none}
  /* align-items 를 stretch 로 되돌리는 것이 핵심이다(기본은 97행의 flex-start).
     헤더가 세로로 누우면 교차축이 가로가 되는데, flex-start 인 채로는 .page-actions 가
     내용 크기로 쪼그라든다. 그 상태에서 안의 버튼이 아래 width:100% 를 받으면 기준 폭이
     "내용에 맞춰 줄어든 폭" 이라 폭이 순환 참조에 걸려, 두 버튼이 좁은 상자를 반씩 나눠
     갖고 라벨이 '당사자 정 / 보' 로 쪼개진다(R7 · 390px 실측 2026-07-30). */
  .page-header{flex-direction:column;align-items:stretch}
  /* 행동 버튼은 좁으면 **세로로 쌓는다**(D38 보강 — 라벨 줄바꿈 금지의 짝). 가로로 둔 채
     폭만 나누면 라벨이 길어질 때마다 같은 결함이 돌아온다 — 버튼 개수가 아니라 라벨 길이가
     변수이기 때문이다. 세로 배치는 라벨이 얼마나 길든 한 줄을 보장한다. */
  .page-actions{width:100%;flex-direction:column;align-items:stretch}
  /* 킷 버튼도 같이 잡는다 — 레거시 .button 만 있으면 교체한 화면에서 버튼이 줄어든다. */
  .page-header .wire-button{width:100%;justify-content:center}
  /* 뒤로 알약의 좌측선 = 컨테이너 패딩 16 (2026-08-05 Q 2차 "메뉴 - 뒤로 - 상담 일정 좌측
     정렬"). 데스크톱의 24 는 사이드바 안쪽선 정렬인데 모바일엔 사이드바가 없다 — 바 내용·
     본문 제목과 같은 16 에 세운다. */
  .page-backbar:has(.page-back){padding:var(--space-5) var(--space-4) 0}
  .form{grid-template-columns:1fr}
}`;
const participantStyles = `
/* 정보 라벨은 민트 계열(사람·소속). */
/* 상태 점은 시간·상태 축이라 블루. 종료·취소는 색이 아니라 문구가 구분한다(색 하나에 기대지 않는다). */
/* 오류는 --risk 글자 + 메시지 텍스트로 알린다. 색만으로 알리지 않는다(§5 입력 오류·§9 완화). */
[role="alert"]{color:var(--risk);font-weight:600}
[role="status"][aria-live],[aria-live="polite"]{min-height:1.5em}
/* 브레이크포인트는 767 하나다(D37 §4-4 · 락 11) — 구 768/359 두 벌을 합쳤다. 359 이하에서
   1열로 더 접던 단계는 사라지고 좁은 휴대폰에서도 2열로 남는다(필드가 짧고 min-width:0 ·
   overflow-wrap:anywhere 라 깨지지 않는다). 줄어든 패딩은 여기로 옮겼다. */
/* ticket-12: 상담 일정 */
/* 날짜 그룹(카드) 안의 상담 카드는 자기 테두리를 벗고 --line 구분선으로 나눈다 — 위 실무자 목록과 같은 이유. */
`;

const briefingStyles = `
/* 상담 준비 6카드 — 디자인 시스템 V0.1 계약. */
.briefing-page{display:grid;gap:var(--space-5)}
/* 이름 + 출구 버튼 2개(D35 §4). 버튼은 이름 바로 아래 줄이고, 화면 조작(전체 열기/닫기)과
   섞이지 않게 아래 툴바와 분리한다. 간격 4의 배수만 쓴다(D30 존치 규칙). */
/* 툴바 = 왼쪽 카드 바로가기 + 오른쪽 여닫기 버튼(2026-08-03 Q). */
.briefing-toolbar{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap}
/* 바로가기는 카드 타이틀 텍스트 그대로다 — 인라인 참조라 알약이 아니라 텍스트다(D58 ⑥). */
.briefing-toolbar-anchors{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.briefing-toolbar-anchors a{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
@media (hover:hover){.briefing-toolbar-anchors a:hover{color:var(--ink);text-decoration:underline}}
/* 리스크 경고 배너(D9 · §5). 배경 --risk-tint-solid + **--risk 단색 1.5px 균일 테두리**
   (2026-08-02 D58/CCC-51 — 구 --gradient-brand. 세컨더리 버튼이 브랜드 그라데이션
   아웃라인을 갖게 되어, 배너는 위험 버튼과 같은 "빨강 테두리 = 위험" 축으로 옮겼다).
   좌측 액센트 띠(border-left 두께 강조)는 금지 패턴이다 — 병합으로 되살아난 것을 걷었다(이슈 #49).
   배너가 서는 것은 테두리가 아니라 위치(HERO 바로 아래)·배경 틴트·아이콘이다.
   --risk 대비가 2.72 라 색 하나에 기대지 않는다: 아이콘·문구·고정 위치·접힘 불가 4중 신호(§9). */
.risk-banner{
  padding:var(--space-5) var(--space-6);
  border:1.5px solid var(--risk);
  border-radius:var(--radius-card);
  background:var(--risk-tint-solid);
  box-shadow:var(--shadow-soft);
  color:var(--ink);
}
.risk-banner-head{display:flex;align-items:center;gap:var(--space-2)}
.risk-banner-icon{flex:none;width:18px;height:18px;color:var(--risk)}
.risk-banner-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--risk)}
/* 항목은 흰 배경 행(radius 6 · --shadow-soft)에 체크박스 + 16/700 --ink. */
.risk-banner-list{margin:var(--space-3) 0 0;padding:0;display:grid;gap:var(--space-2);list-style:none}
.risk-banner-list li{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-radius:var(--radius-control);background:var(--panel);box-shadow:var(--shadow-soft);color:var(--ink);font-size:var(--text-md);font-weight:600}
.risk-banner-list .panel-meta{margin-left:auto;color:var(--sub);font-weight:600;font-size:var(--text-sm)}
/* 표준 카드 그리드(D37 §4-2) — **열 수를 쓰지 않는다**(락 10). 최소 폭 420 이 열을 만든다:
   1120 에서 2열(각 510)이고 컨테이너가 좁아지면 스스로 1열이 된다. */
.briefing-cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));gap:var(--space-5);align-items:start}
/* 아코디언이 나란할 때: 펼친 카드는 서로 높이를 맞추고, 접은 카드는 요약 줄만 남긴다(§4-2).
   JS 로 높이를 재서 박지 않는다 — 접으면 행이 실제로 줄어든다. */
.briefing-cards-grid>.briefing-card{align-self:start}
.briefing-cards-grid>.briefing-card[open]{align-self:stretch}
/* 브리핑 3영역·미해결 액션 = **플랫 구획**이다(D59 · 2026-08-04 — 구 카드 계약 대체).
   읽기만 하는 구획은 캔버스에 직접 얹고 제목 + 브랜드 1px 구분선 + 여백으로 선다 —
   카드(흰 상자)는 클릭·집어 드는 단위와 강조 컨테이너(HERO·리스크 배너·폼)만 쓴다.
   접힘(details)은 유지된다 — 형태만 바뀌고 전체 접기·앵커는 그대로다. */
.briefing-card{color:var(--ink)}
/* 구획 제목 줄. 구분선을 제목(summary)에 붙여 접혀 있어도 구획 리듬이 남는다. */
.briefing-card-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) 0 var(--space-3);background:var(--gradient-brand) bottom/100% 1px no-repeat;font-size:var(--text-lg);font-weight:600;cursor:pointer;list-style:none}
.briefing-card-summary::-webkit-details-marker{display:none}
.briefing-card-arrow{flex:none;width:9px;height:9px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub);transform:rotate(-45deg);transition:transform .15s ease}
/* 자식 결합자(>)로 두면 GAS 요약처럼 화살표를 배지와 함께 감싼 경우 회전이 안 먹어
   펼쳐져 있는데 화살표만 닫힌 모양으로 남는다(2026-07-27 렌더에서 확인). */
.briefing-card[open]>.briefing-card-summary .briefing-card-arrow{transform:rotate(45deg)}
/* 구분선은 제목(summary) 쪽이 갖는다 — 본문은 여백만. */
.briefing-card-body{display:grid;gap:var(--space-3);padding:var(--space-4) 0 var(--space-2)}
.briefing-fields{display:grid;gap:var(--space-2-5)}
/* 카드 내 중첩 아코디언(기본정보의 전체 참여사업). 기본 접힘. */
/* GAS — 목표별 최신 점수. 점수의 좋고 나쁨을 색으로 표시하지 않는다(D6·R4):
   계열 3색은 목표를 서로 구분하는 회전일 뿐이고 점수 숫자는 항상 --ink 다. */
/* GAS 전폭 섹션(CLAUDE.md 6장 · 2026-07-27 Q 결정 — 이 파일의 CSS 는 템플릿 리터럴이라 주석에 백틱을 쓰지 않는다). 섹션 제목은 카드 밖 h2 18/700 이고 그 아래 16 이다
   — §4-3 세로 리듬(40/24/16/20)에서 '섹션 제목↔내용'에 해당한다. 섹션 사이 24 는 페이지
   그리드의 gap 이 이미 준다(§4-6 규칙 3: 화면에서 margin 으로 띄우지 않는다). */
.briefing-page{display:grid;gap:var(--section-gap)}
.briefing-accordions{display:grid;gap:var(--section-gap)}
/* HERO 도 카드다(§4-5) — 화면의 모든 글자가 카드 안에 있고 예외는 섹션 제목뿐이다. */
.briefing-hero{padding:var(--space-6);gap:var(--space-5)}
.briefing-hero-identity{display:grid;gap:var(--space-2);min-width:0}
.briefing-hero-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:var(--text-2xl);line-height:var(--leading-tight)}
/* 상태 태그는 시간·상태 축이라 블루다(D34). 글자는 deep — base 는 글자에 쓰지 않는다(색 규율 3). */
.briefing-badge.is-stage{border-color:transparent;background:var(--blue-tint);color:var(--blue-deep)}
.briefing-hero-meta{margin:0;color:var(--sub);font-size:var(--text-sm)}
/* (구 두 번째 .briefing-toolbar 규칙은 위 정의와 겹쳐 삭제 — 2026-08-03) */
/* 카드 제목 오른쪽 자리 — 배지(승인 대기 등)와 화살표가 앉는다. */
.briefing-card-summary-right{display:flex;align-items:center;gap:var(--space-3)}
/* 전체 목표(D45 · CCC-41 · D59 플랫화) — 카드가 아니라 캔버스 위 한 줄이다.
   수정 가능성은 안쪽 표시 상자(.briefing-goal-display)가 알린다. 점수·게이지 자리는 없다(D43). */
.briefing-goal{display:grid;gap:var(--space-2);padding:0}
.briefing-goal-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.briefing-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.briefing-goal-text.is-empty{color:var(--sub);font-weight:400}
.briefing-goal-form{display:flex;flex:1;align-items:center;gap:var(--space-3);flex-wrap:wrap}
/* 입력칸 계약(§5): 높이 40 · radius 6 · --line-control 1px. */
.briefing-goal-input{flex:1;min-width:min(100%,240px);height:40px;padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-md);color:var(--ink)}
/* 목표 **표시**도 같은 상자다(2026-08-03 Q) — 맨글자는 수정 불가로 읽혀서, 수정할 수 있는
   목표는 입력칸과 같은 형태로 그리고 누르면 바로 편집이 시작된다. */
.briefing-goal-display{flex:1;min-width:min(100%,240px);display:flex;align-items:center;min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-md);font-weight:600;text-align:left;color:var(--ink);cursor:pointer}
.briefing-goal-display.is-empty{color:var(--sub);font-weight:400}
@media (hover:hover){.briefing-goal-display:hover{border-color:var(--blue-deep)}}
.briefing-goal-error{margin:0;font-size:var(--text-sm);color:var(--risk)}
/* 브리핑 이어보기 — 페이지 맨 아래 한 줄(D37). 카드 계약을 그대로 쓰고 안쪽만 정한다. */
/* 브리핑 이어보기는 알약 버튼이 됐다(D58/CCC-51 — 구 카드형). 그리드 아이템이라 폭이
   늘어나는 것만 막고(가운데 자리), 나머지는 .wire-button 계약 그대로다. */
.briefing-more{justify-self:center}
/* 영역 ① — 실무자 입력·AI 제안의 세 섹션. */
.briefing-qsection{display:grid;gap:var(--space-2)}
.briefing-qlabel{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
/* AI 제안(CCC-39·D45) — 항목마다 제목·이유·근거 회차 링크 3층. */
.briefing-suggestions{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}
.briefing-suggestion{display:grid;gap:var(--space-1)}
.briefing-suggestion-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.briefing-suggestion-reason{margin:0;font-size:var(--text-sm);color:var(--sub)}
.briefing-suggestion-link{justify-self:start;font-size:var(--text-sm);font-weight:600;color:var(--ink);text-decoration:underline}
/* 영역 ③ 불일치 처리(D45 · CCC-42) — 처리 3종 버튼 줄과 접힌 이력. 처리는 표시일 뿐이라
   시각적 무게를 더하지 않는다(세컨더리 버튼·무채색 요약). */
.briefing-resolution-form{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2)}
.briefing-history{margin-top:var(--space-4);border-top:1px solid var(--line);padding-top:var(--space-4)}
.briefing-history>summary{cursor:pointer;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.briefing-history>.briefing-qsection{margin-top:var(--space-4)}
/* 배지·메타·빈 상태(§5 상태 배지). */
.briefing-badge{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.briefing-badge.is-approved{border-color:transparent;background:var(--mint-tint);color:var(--mint-deep)}
/* 승인 대기는 라벤더 tint 배지다(색 규율 5 — v1 검정 반전 배지를 대체). */
.briefing-badge.is-pending{border-color:transparent;background:var(--lavender-tint);color:var(--lavender-deep)}
.briefing-note{margin:0;font-size:var(--text-sm);color:var(--sub)}
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
/* 카드가 overflow:clip 이라(그라데이션 테두리 하단 라운드 버그 수리, wire-styles 참조)
   바깥 링은 잘린다 — 안쪽 링으로 바꾼다. */
.record-summary:focus-visible{outline:2px solid var(--blue-deep);outline-offset:-2px}
.record-chevron{flex:none;width:12px;font-size:var(--text-sm);color:var(--sub)}
.record-ordinal{flex:none;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-held-at{flex:none;font-size:var(--text-md);color:var(--sub)}
/* 유형 칩 — 시간·상태 축이라 블루 tint. 글자는 --ink 다: 읽어야 하는 값이라 §9 의
   '보조 정보 한정' 대비 예외를 쓰지 않는다. 인테이크도 같은 블루이고 구분은 글자가 한다. */
.record-kind{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border-radius:var(--radius-pill);background:var(--blue-tint);font-size:var(--text-sm);font-weight:600;color:var(--ink)}
/* 핵심 한 줄. 승인 전 폴백(수기 메모 발췌)은 --sub 로 낮춘다(D5). */
.record-one-liner{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md);color:var(--ink)}
.record-one-liner.is-memo{color:var(--sub)}
.record-summary-right{flex:none;display:flex;align-items:center;gap:var(--space-2)}
/* 펼친 본문. 머리와 본문은 --gradient-brand 1px 로 나눈다(§5 카드 계약 — 그라데이션이
   남는 자리는 카드 안쪽 구분선뿐이다). */
.record-body{border-top:1px solid transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-brand) border-box;display:grid;gap:var(--space-5);padding:var(--space-5) var(--space-6)}
.record-block{display:grid;gap:var(--space-2)}
.record-block>h3{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-block>p{margin:0;font-size:var(--text-md);color:var(--ink);white-space:pre-wrap}
.record-block ul{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2)}
.record-block li{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-2);font-size:var(--text-md);color:var(--ink)}
/* '이번 상담의 목표' — GAS 가 있던 자리(D47 §2). 실무자가 정한 것이라 사람 축(민트)이다.
   재료가 없으면 이 블록 자체를 그리지 않는다 — 빈 블록은 뺀 자리를 다시 빈칸으로 만든다. */
.record-session-goal{display:grid;gap:var(--space-1);border-radius:var(--radius-control);background:var(--mint-tint);padding:var(--space-3) var(--space-4)}
.record-session-goal-label{font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-session-goal p{margin:0;font-size:var(--text-md);color:var(--ink)}
/* 담당 칩 — 사람·소속 축(민트). 글자는 --ink(위 유형 칩과 같은 이유). */
.record-owner{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border-radius:var(--radius-pill);background:var(--mint-tint);font-size:var(--text-sm);font-weight:600;color:var(--ink)}
/* AI 출처 칩 — AI 축(라벤더). 곁다리로 읽는 값이라 deep 글자가 남는 자리다(§9 예외). */
.record-ai-source{display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border-radius:var(--radius-pill);background:var(--lavender-tint);font-size:var(--text-sm);font-weight:600;color:var(--lavender-deep)}
.record-item-meta{font-size:var(--text-sm);color:var(--sub)}
/* 리스크 레드는 **확인된** 플래그에만(D9·D34). 조회 API 가 확인된 것만 내려보내지만,
   색을 상태에 걸어 두면 나중에 범위가 넓어져도 규율이 깨지지 않는다. */
.record-flag{font-weight:600;color:var(--sub)}
.record-flag[data-confirmed="true"]{color:var(--risk)}
.record-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-4);border-top:1px solid var(--line);padding:var(--space-3) var(--space-6);font-size:var(--text-sm);color:var(--sub)}
/* 전체 목표 한 줄 — 브리핑과 같은 어휘이되 이 화면은 읽기 전용이다(입력칸·저장 버튼 없음). */
.record-goal{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;padding:var(--space-4) var(--space-6)}
.record-goal-label{flex:none;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-goal-text.is-empty{font-weight:400;color:var(--sub)}
.record-section-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
@media (max-width:767px){
  /* 좁으면 한 줄이 무너지므로 핵심 한 줄을 아래로 내린다(리스트 행 계약과 같은 접힘). */
  .record-summary{flex-wrap:wrap}
  .record-one-liner{flex-basis:100%;white-space:normal;overflow:visible}
}
/* 767 블록에서 두 그리드를 1열로 강제하던 규칙은 지웠다 — 최소 폭(420·280)이 이미 접는다(락 10·11). */
`;


const settingsStyles = `
/* ticket-14: 설정 */
/* .settings-gear 4종 삭제(2026-07-27) — D35 가 설정을 사이드바 **메뉴 항목**으로 옮긴 뒤로
   이 클래스를 쓰는 마크업이 0곳이었다. 죽은 CSS 였지만 무해하지 않았다: 함께 있던
   .sidebar{position:relative} 가 뒤 문자열에 있어 드로어의 position:fixed 를 덮었고,
   그래서 768 미만에서 드로어가 화면 높이를 못 채우고 내용 높이(531px)로 떠 있었다.
   (주석에 백틱을 쓰지 않는 이유는 이 CSS 가 템플릿 리터럴이기 때문이다 — 쓰면 앱 전체가 500 이다.) */
.settings-page{display:grid;gap:var(--space-8)}
/* 설정 구획은 플랫이다(D59) — 읽기 구획이라 카드가 아니라 제목 + 구분선 + 여백으로 선다. */
.settings-section{display:grid;gap:var(--space-4);padding:0;color:var(--ink)}
.settings-section>h2{font-size:var(--text-lg);padding-bottom:var(--space-3);background:var(--gradient-brand) bottom/100% 1px no-repeat}
.settings-account{display:grid;gap:var(--space-4);margin:0}
.settings-field{display:grid;gap:var(--space-1)}
/* 사람 정보 라벨은 민트 계열. */
.settings-field dt{color:var(--mint-deep);font-size:var(--text-sm);font-weight:600}
.settings-field dd{margin:0;color:var(--ink);font-size:var(--text-md);font-weight:600;overflow-wrap:anywhere}
/* 실무자 목록은 카드(.settings-section) 안에 있으므로 행마다 테두리를 두르지 않고
   --line 구분선으로 나눈다(§5 리스트 행). 카드 안에 카드를 넣으면 경계가 두 겹으로 겹친다. */
.settings-user-list{display:grid;margin:0;padding:0;list-style:none}
.settings-user-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:var(--space-3);align-items:center;min-height:52px;padding:var(--space-3) var(--space-2);border-bottom:1px solid var(--line)}
.settings-user-row:last-child{border-bottom:0}
.settings-user-email{overflow-wrap:anywhere;font-weight:600}
.settings-user-role{color:var(--sub);font-size:var(--text-sm);font-weight:600}
.settings-user-status{display:inline-flex;align-items:center;width:max-content;min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);background:transparent;color:var(--sub);font-size:var(--text-sm);font-weight:600}
.settings-user-row[data-active="false"]{opacity:.6}
@media(max-width:767px){.settings-user-row{grid-template-columns:1fr;gap:var(--space-1)}.settings-user-role,.settings-user-status{justify-self:start}}
`;

const scheduleStyles = `
/* ticket-20: 상담 등록 */
.schedule-form{display:grid;gap:var(--space-5);max-width:520px;padding:var(--space-6)}
.schedule-form-hint{margin:0;color:var(--sub);font-size:var(--text-sm)}
/* 성공색은 이 시스템에 없다(D6·R4). 완료 알림은 중립 잉크 + 문구로 알린다. */
.schedule-form-notice{color:var(--ink);font-weight:600}
.schedule-form-error{color:var(--risk);font-weight:600}
/* 동의 묶음은 카드 안 상자였다 — D59 '카드 안 카드 금지'로 플랫: 위 구분선 하나 + 여백. */
.consent-fieldset{display:grid;gap:var(--space-3);margin:0;padding:var(--space-3) 0 0;border:0;border-top:1px solid var(--line);border-radius:0}
.consent-fieldset legend{padding:0 var(--space-1-5);font-weight:600;font-size:var(--text-sm);color:var(--sub)}
.consent-checkbox{display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-md);font-weight:600}
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
.month-nav-label{min-width:9ch;font-size:var(--text-md);font-weight:600;color:var(--ink);text-align:center}
/* 하루 묶음. 날짜 제목 + 그 아래 붙은 행들 — 행이 붙어 있으므로 카드 계약이 아니라
   행 사이 1px --line 구분선을 쓴다(DESIGN.md §5 '리스트 행'의 맥락 규칙). */
.month-day{display:grid;gap:var(--space-3)}
.month-day-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.month-day-title[data-today="true"]{color:var(--blue-deep)}
/* 날짜 묶음은 플랫이다(D59) — 행은 캔버스에 직접 얹고 사이는 구분선만. 행 자체가
   클릭 단위지만 붙어 있는 행이므로 카드가 아니라 구분선 계약이다(§5 리스트 행 맥락 규칙). */
.month-rows{display:grid}
.month-rows>*+*{border-top:1px solid var(--line)}
.month-row{display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-3);color:inherit;text-decoration:none}
/* 호버는 리스트 행과 같은 그라데이션 채움이다(2026-08-03 Q — 구 --muted 단색). */
@media (hover:hover){.month-row:hover{background:var(--gradient-hover)}}
.month-row:focus-visible{outline:2px solid var(--blue-deep);outline-offset:-2px}
/* 시간은 고정폭으로 세로 정렬을 맞춘다(§5 리스트 행: 시간 16/700 고정폭 → 이름 묶음). */
.month-row-time{flex:none;min-width:6ch;font-size:var(--text-md);font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
/* 이름 묶음 — '이름 (가명 ID)' 한 줄, 띄어쓰기는 문자열이 아니라 간격이 만든다(§5 이름 표기).
   이 블록은 템플릿 문자열이라 주석에도 백틱을 쓸 수 없다 — 쓰면 문자열이 거기서 끝난다. */
.month-row-name{display:flex;align-items:baseline;gap:var(--space-1);min-width:0;flex:1}
.month-row-name b{font-size:var(--text-md);font-weight:600;color:var(--ink);white-space:nowrap}
.month-row-name span{font-size:var(--text-md);font-weight:400;color:var(--sub);white-space:nowrap}
.month-row-right{flex:none;display:flex;align-items:center;gap:var(--space-2)}
/* 유형 칩 — 블루 tint + --ink 글자(D47 계열 칩 ①: 읽어야 하는 값이라 deep 을 쓰지 않는다). */
.month-row-kind{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border-radius:var(--radius-pill);background:var(--blue-tint);font-size:var(--text-sm);font-weight:600;color:var(--ink)}
/* 상태는 지난 일정에만 붙는다(예정은 붙이지 않는다 — 대부분이 예정이라 전부 붙으면 소음이다).
   무채색 기본 배지다: 취소·불참은 경고가 아니라 사실이고, 리스크 색은 확인된 플래그 전용이다(D9). */
.month-row-status{flex:none;display:inline-flex;align-items:center;min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
@media (max-width:767px){
  /* §5 모바일: 리스트 행은 시간+이름 / 메타 / 배지 3줄로 접힌다. */
  .month-row{flex-wrap:wrap}
  .month-row-name{flex-basis:calc(100% - 6ch - var(--space-3))}
  .month-row-right{flex-basis:100%}
}
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
.wire-invite-caption{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* CCC-29: QR 은 입력칸이 아니라 카드 계약(--line 1px · radius 12)을 빌린 정사각 패널이다. */
.wire-invite-qr{display:inline-flex;justify-self:start;padding:var(--space-4);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card)}
/* 버튼은 내용만큼만 차지한다 — 그리드 아이템 기본 stretch 를 그대로 두면 카드 폭(880)을
   가로지르는 알약이 되어, 폼 제출도 아닌 행동이 마케팅 배너처럼 읽힌다. */
.wire-invite-stack .wire-button{justify-self:start}
/* D15·D23: 동의 문안 "자세히 읽어보기" — briefing-subaccordion 패턴 재사용. */
.consent-detail{padding-top:var(--space-2);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
.consent-detail-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-1-5) 0;font-size:var(--text-sm);font-weight:600;color:var(--ink);cursor:pointer;list-style:none}
.consent-detail-summary::-webkit-details-marker{display:none}
.consent-detail[open]>.consent-detail-summary>.briefing-card-arrow{transform:rotate(45deg)}
.consent-detail-body{display:grid;gap:var(--space-4);padding-top:var(--space-3)}
.consent-detail-disclaimer{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.consent-detail-section{display:grid;gap:var(--space-1-5)}
.consent-detail-section h3{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.consent-detail-section p,.consent-detail-section li{margin:0;font-size:var(--text-sm);color:var(--sub)}
.consent-detail-section ul{margin:0;padding-left:var(--list-indent);display:grid;gap:var(--space-1-5)}
/* 관리자 온보딩 2단계 (CCC-32). 새 시각 언어 없음 — .surface-card + 킷 부품 조합이고,
   단계 표시는 블루 계열(시간·상태 축, D34)이다. */
.onboarding-form{display:grid;margin-top:var(--space-8)}
.onboarding-card{display:grid;gap:var(--space-4);padding:var(--space-6)}
.onboarding-card h2{margin:0}
.onboarding-step{margin:0;justify-self:start;padding:var(--space-0-5) var(--space-2-5);border-radius:var(--radius-pill);background:var(--blue-tint);color:var(--ink);font-size:var(--text-sm);font-weight:600}
.onboarding-help{margin:0;font-size:var(--text-sm);color:var(--sub)}
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
/* 이 세 패널은 카드 패딩 3종 중 **좁은 보조 패널(16/20)** 이다(DESIGN.md §3-4, 2026-07-31).
   본문 폭 전체를 쓰는 카드는 좌우 24 로 통일했지만, 이 화면은 우측 레일 200 을 떼고 남은
   좁은 열에 서고 레일 자체는 200px 이라 좌우 24 를 주면 안쪽 글 폭이 152 로 떨어진다.
   같은 값을 화면마다 다시 정하지 않도록 여기 한 곳에만 적어 둔다. */
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
.record-sticky-label{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.record-sticky-value{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-sticky-list{margin:0;padding-left:var(--list-indent);display:grid;gap:var(--space-1);font-size:var(--text-md);font-weight:600;color:var(--ink)}
/* 나가기·저장(2026-07-31 Q). 이 둘은 원래 화면 양 끝에 흩어져 있었다 — 나가기는 제목 옆에서
   아무것과도 묶이지 않았고, 저장은 폼 맨 아래라 스크롤을 끝까지 내려야 보였다.
   고정 헤더에 함께 두면 어느 위치에서 쓰든 나가는 길과 저장이 늘 같은 자리에 있다.
   §4-5 순서를 따라 세컨더리 → 프라이머리이고, 좁아지면 줄바꿈한다. */
.record-sticky-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-2);flex:none}
.record-sticky-meta{margin:0;font-size:var(--text-sm);color:var(--sub)}
.record-accordion{padding:var(--space-4) var(--space-5)}
.record-accordion-summary{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);font-size:var(--text-md);font-weight:600;color:var(--ink);cursor:pointer;list-style:none}
.record-accordion-summary::-webkit-details-marker{display:none}
.record-accordion-body{display:grid;gap:var(--space-4);padding-top:var(--space-4)}
/* 위기 영역은 확인된 리스크와 같은 축이므로 --risk 균일 테두리 + 배경 틴트로 표시한다(D9). */
/* optical: 15/19 는 눈대중이 아니라 **16/20 에서 테두리 1.5px 을 뺀 값**이다. 위기 아코디언만
   테두리가 1.5px(다른 카드는 1px)이라, 패딩을 16/20 그대로 두면 이 카드 안쪽만 0.5px 씩
   넓어져 옆 카드와 글자 시작선이 어긋난다. 토큰으로 스냅하면 그 어긋남이 돌아온다. */
.record-accordion.is-crisis{--surface-fill:var(--risk-tint-solid);border:1.5px solid var(--risk);background:var(--risk-tint-solid);padding:15px 19px}
.record-accordion.is-crisis .record-accordion-summary{color:var(--risk)}
.record-rail{position:sticky;top:0;display:grid;gap:var(--space-2);padding:var(--space-4)}
.record-rail-count{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-rail-list{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-1-5);font-size:var(--text-sm);color:var(--sub)}
.record-rail-list li[data-done="true"]{color:var(--ink);font-weight:600}
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
  // 테마는 **서버가 정해 <html> 에 박는다**(D56 · ADR-0026). 첫 페인트 전에 정해져 있어야
  // 어두운 화면을 기대한 사람에게 흰 화면이 번쩍이지 않는다 — localStorage 로 하면 자바스크립트가
  // 돈 뒤에야 읽혀서 그 번쩍임을 막으려 <head> 에 블로킹 인라인 스크립트를 넣어야 한다.
  // 라이트일 때는 속성 자체를 두지 않는다(:root 기본값이 곧 라이트다).
  const theme = parseTheme((await cookies()).get(THEME_COOKIE_NAME)?.value);
  const themeAttr = theme === 'dark' ? 'dark' : undefined;
  const shellStyles = styles + participantStyles + briefingStyles + settingsStyles + scheduleStyles + monthScheduleStyles + wireStyles + registerStyles + recordFormStyles;

  // 공개 경로는 표시 이름을 조회하지 않는다: 사이드바가 없어 값이 쓰이지 않고, 신원 없는
  // 요청으로 부르면 그 조회가 401 을 만든다(위 "사이드바가 신원을 물어 401" 과 같은 이유).
  if (isPublic) {
    // 공개 화면에도 테마는 적용한다 — 셸이 없을 뿐 같은 앱 화면이다(토글은 사이드바에 있으므로
    // 여기서 바꿀 수는 없고, 앞서 켜 둔 값이 그대로 따라온다).
    return <html lang="ko" data-theme={themeAttr}><head><style>{shellStyles}</style></head><body>{children}</body></html>;
  }

  // 기관·사업 표시 이름은 온보딩 저장값 우선(CCC-32) — 실패·미설정이면 헬퍼가 하드코딩 라벨로 폴백한다.
  const labels = await getDisplayLabels();
  // 본문 열을 div 로 한 번 감싼다 — 뒤로가기 줄이 본문과 **같은 컨테이너**(폭 1120·좌우 40)를
  // 써야 제목과 왼쪽 끝이 맞기 때문이다. 감싸지 않고 셸의 형제로 두면 그리드 다음 행,
  // 즉 사이드바 아래로 떨어진다.
  return (
    <html lang="ko" data-theme={themeAttr}>
      <head><style>{shellStyles}</style></head>
      <body>
        <div className="wire-shell app-shell">
          {/* 상단 헤더(2026-08-05 Q · Infisical 레퍼런스) — 셸 그리드 1행, **화면 전체 폭**
              (사이드바 위까지). 기관 마크가 사이드바 메뉴와 같은 좌측선(24)에 선다.
              768 미만에서는 렌더만 되고 CSS 가 숨긴다(손잡이 바 + 드로어가 담당). */}
          <AppHeader orgLabel={labels.orgLabel} programLabels={labels.programLabels} theme={theme} />
          <AppSidebar orgLabel={labels.orgLabel} programLabels={labels.programLabels} theme={theme} />
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
