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
/* 스크롤바 자리를 항상 확보한다(2026-08-06 Q "아코디언 접을 때 장폭이 변한다") — 내용이
   짧아져 스크롤바가 사라지면 본문 폭이 그만큼 늘어 페이지가 좌우로 들썩였다. */
html{scrollbar-gutter:stable}
*{box-sizing:border-box}
/* 줄바꿈 전역 계약(2026-08-07 Q 9차 "문맥상 맞게 잘라서 줄바꿈"): keep-all 은 한국어를
   어절 경계에서만 꺾고, pretty 는 두 줄 이상일 때 마지막 줄이 낱말 하나로 남는 극단
   (한 줄만 긴 모양)을 피한다. break-word 는 어절보다 긴 통짜 값(이메일 등)이 칸을
   뚫는 것만 막는 안전핀이다. */
body{margin:0;background:var(--canvas);font-size:var(--text-md);line-height:var(--leading-body);word-break:keep-all;overflow-wrap:break-word;text-wrap:pretty}
/* 제목·구획 머리는 balance — 두 줄이 되면 줄 길이를 고르게 나눈다(같은 계약). */
h1,h2,h3,legend{text-wrap:balance}
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
/* 드로어 닫기 = 여는 버튼과 같은 사이드바 아이콘·같은 32 원형이다(2026-08-06 Q 2차 —
   구 X 28 대체: 한 버튼이 여닫는 토글로 읽힌다). 옷·호버·초점은 .header-icon-button 이
   입히고, 여기서는 노출만 다룬다 — 데스크톱엔 없다(머리 줄 자체도 숨지만, 계약을 이중으로
   적어 한쪽 규칙이 움직여도 새지 않게 한다). */
.sidebar .drawer-dismiss{display:none}
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
.program-switcher-option{display:flex;align-items:center;line-height:normal;gap:var(--space-2);min-height:var(--control-height);padding:0 var(--space-2);border-radius:var(--radius-control);color:var(--ink);font-size:var(--text-md);font-weight:500}
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
/* 테두리는 전 상태 투명으로 깔아 둔다 — 활성만 테두리를 얹으면 상자가 자라 글자가 상태
   전환마다 튄다. 굵기 1.5px 은 2026-08-06 Q("아웃라인 굵기를 조금만 올려봐" — 구 1px). */
/* 높이는 '뒤로' 알약과 같은 32 다(2026-08-06 Q — 구 40. 첫 메뉴 윗변 = 뒤로 윗변(76)
   계약과 짝: 높이까지 같아야 두 크롬이 한 리듬으로 읽힌다). */
.navigation-link{min-height:var(--pill-height);padding:0 var(--space-3);border:1.5px solid transparent;border-radius:var(--radius-control);color:var(--sub);font-size:var(--text-md);font-weight:500;transition:background-color .12s ease,color .12s ease}
/* 마우스가 실제로 있는 기기에서만 호버를 켠다 — 터치 기기는 탭한 항목에 :hover 가 남아
   "눌린 채로 굳은" 것처럼 보인다(2026-07-26 Q 보고). */
@media (hover:hover){
  /* 호버 = **어두운 면 위 그라데이션 글자**다(2026-08-03 Q — 구 잉크 6% 워시 대체).
     활성(블루 tint)과 어휘가 완전히 갈려, 지나가는 중과 지금 있는 곳이 섞여 보이지 않는다.
     아이콘은 currentColor 라 --panel(흰색)로 남긴다 — 파스텔 그라데이션을 획에 얹으면
     16px 라인 아이콘은 획이 끊겨 보인다. */
  .navigation-link:not([data-current="true"]):hover{background:var(--ink);color:var(--panel)}
  .navigation-link:not([data-current="true"]):hover>span:not(.navigation-soon){background:var(--gradient-brand);-webkit-background-clip:text;background-clip:text;color:transparent}
  /* 다크는 **색 반전**이다(2026-08-05 Q · ADR-0030 호버 테마 규칙): 라이트가 "어두운 면 +
     그라데이션 글자"라면 다크는 "그라데이션 면 + 어두운 글자". 글자·아이콘은 --on-action
     (두 테마 공통의 어두운 잉크)이다 — 다크의 --ink 는 밝은 색이라 그라데이션 위에서 안 읽힌다.
     (구 규칙은 --canvas 면 + --ink 글자 — 그라데이션이 사라져 라이트와 어휘가 갈렸다.) */
  [data-theme="dark"] .navigation-link:not([data-current="true"]):hover{background:var(--gradient-brand);color:var(--on-action)}
  [data-theme="dark"] .navigation-link:not([data-current="true"]):hover>span:not(.navigation-soon){background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--on-action)}
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
@media (min-width:768px){.sidebar>.sidebar-head,.drawer-scrim{display:none}}
/* ── 드로어 부품 ── 데스크톱에는 없다(§4-4 는 768 미만에서만 드로어라고 말한다). */
/* 셸 크롬에서는 OS 탭 하이라이트(둥근 파란 플래시)를 끈다 — 눌림·호버 어휘는 §6 이
   정의하고, 시스템 블롭이 겹치면 열고 닫을 때 좌우 상단에 그림자 같은 잔상이 번쩍인다
   (2026-08-06 Q 보고). 속성은 상속되므로 컨테이너에만 둔다. */
.app-header,.drawer-bar,.sidebar,.drawer-scrim,.page-back{-webkit-tap-highlight-color:transparent}
/* 드로어 컨테이너의 프로그램적 초점(열릴 때 focus 이동)에는 UA 링을 그리지 않는다 —
   초점 신호는 안의 조작 요소들이 갖는다. */
.sidebar:focus{outline:none}
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
/* 스크림은 늘 있고 열림만 오간다(2026-08-06) — 어둠이 드로어와 같은 리듬으로 페이드해야
   닫힘이 뚝 끊기지 않는다. 닫힘 상태는 투명 + pointer-events:none 이라 본문을 막지 않는다. */
.drawer-scrim{position:fixed;inset:0;background:var(--scrim);z-index:calc(var(--z-modal) - 1);opacity:0;pointer-events:none;transition:opacity var(--motion-base) var(--ease-standard)}
.drawer-scrim[data-open="true"]{opacity:1;pointer-events:auto}
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
/* 뒤로 알약은 **본문 컨테이너와 같은 좌측선**에 선다(2026-08-06 Q "뒤로, 제목, 시간순,
   카드까지 좌측정렬" — 구 2026-08-05 '사이드바 안쪽선 24 고정·프레임 크롬' 대체).
   컨테이너 기하(.page-content 와 같은 장폭·auto 마진·좌우 패딩)를 그대로 받아, 알약의
   왼쪽 끝 = 페이지 제목·툴바·카드의 왼쪽 끝이다.
   뒤로가 안 그려지는 화면(히스토리 없음)은 이 줄이 0 높이다. */
.page-backbar{padding:0}
.page-backbar:has(.page-back){width:100%;max-width:var(--page-max);margin-inline:auto;padding:var(--space-5) var(--page-pad-x) 0}
/* 뒤로 알약이 있으면 본문 위 여백은 40 대신 24 — 알약 줄이 이미 20 을 벌렸다. */
.page-backbar:has(.page-back)+.page-content{padding-top:var(--space-6)}
/* 뒤로가기도 버튼이다(2026-08-04 Q, 구 투명 텍스트 대체. 형태는 2026-08-07 직사각 radius 6,
   구 알약 대체). 옷은 **일반(neutral)**
   그레이 아웃라인이다(2026-08-06 Q 위계 재편 — 구 그라데이션 테두리 대체: 이동·보기 조작은
   그레이, 컬러는 중요 행동만). 테두리는 카드 아웃라인과 같은 --line 이다(2026-08-07 Q
   "뒤로 아웃라인을 카드 div 아웃라인과 맞출 것" — neutral 버튼과 같은 개정).
   화살표와 글자 사이는 6 — 8은 떨어져 보인다(같은 날 Q).
   --button-fill 은 .wire-button 과 같은 지역 변수 패턴(호버가 채움만 바꾼다). */
.page-back{--button-fill:var(--panel);display:inline-flex;align-items:center;line-height:normal;gap:var(--space-1-5);min-height:var(--pill-height);padding:0 var(--space-3-5);border:1px solid var(--line);border-radius:var(--radius-control);background:var(--button-fill);color:var(--ink);font-size:var(--text-sm);font-weight:400;cursor:pointer}
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
/* 레거시 화면의 카드 표면(.panel·.schedule-form)도 마크업의 .surface-card 로 계약을 받는다
   (2026-08-05 컴포넌트화 — 구 계약 CSS 복사 5줄 삭제). 여기는 패딩·배치만 남는다. */
/* 제목 아래 설명 줄. 짝 계약(2026-08-07): 제목이 600 을 갖고 설명은 400 으로 물러선다. */
.panel-meta{color:var(--sub);font-size:var(--text-sm);font-weight:400}
/* 상태 배지는 공용 배지 계약(.wire-badge, wire-styles.ts) 하나만 쓴다(2026-08-07 통합).
   구 .status(.mint/.blue/.warning/.risk)는 같은 레시피의 복사본이라 삭제했다. */
.panel{padding:var(--space-6)}
.empty{display:flex;align-items:center;gap:var(--space-2);min-height:92px;color:var(--sub);font-size:var(--text-sm)}
.form{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.42fr);gap:var(--space-5);align-items:start}
/* 라벨은 14/700 --sub 로 값 위에 둔다 — 입력 경계선(1.28) 하나에 기대지 않기 위한 규칙(§9). */
.field{display:grid;gap:var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.field input,.field select,.field textarea{width:100%;min-height:var(--control-height);padding:var(--space-2) var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:var(--text-md);font-weight:400}
/* 단일행 컨트롤만 행간 normal(2026-08-06 Q — 킷 입력칸과 동일). textarea 는 다중행이라 제외. */
.field input,.field select{line-height:normal}
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
/* 구 .note 회색 상자는 2026-08-07 콜아웃(WireCallout, wire-callout.tsx)으로 대체했다. */
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
    /* 모션 토큰 준수(§6 — 시간 2단 + 이징 1종): 구 .15s ease 는 계약 밖 값이었고 감속이
       일러 끝이 뚝 멈춰 보였다(2026-08-06 Q "부자연"). */
    transform:translateX(100%);transition:transform var(--motion-base) var(--ease-standard);
  }
  /* 데스크톱의 오른쪽 세로 프레임 라인은 드로어에서 **왼쪽** 모서리로 옮긴다 — 패널이
     오른쪽에서 나오므로 본문과 만나는 모서리가 왼쪽이다. */
  .sidebar::after{right:auto;left:0}
  .sidebar[data-drawer-open="true"]{transform:none}
  .sidebar .drawer-dismiss{display:grid}
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
/* 툴바 = 왼쪽 카드 바로가기 + 오른쪽 여닫기 버튼(2026-08-03 Q). 여닫기는 줄이 접혀도
   **항상 오른쪽 끝**이다(2026-08-07 Q — 좁은 화면에서 뱃지 무리에 섞여 하나처럼 보였다.
   그레이 조작 알약 + 오른쪽 축으로 성격을 가른다). */
.briefing-toolbar{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap}
.briefing-toolbar>.wire-button{margin-left:auto}
/* 구 .briefing-toolbar-anchors(카드 바로가기 알약 4개)는 2026-08-07 Q 지시로 삭제 —
   카드 제목과 같은 문구가 두 번 서 소음이었다. 왼쪽 자리는 섹션 제목
   ('상담 전 꼭 봐야할 내용', .record-section-title 공용)이 이어받았다. */
/* 리스크 경고 배너(D9 · §5). 배경 --risk-tint-solid + **--risk 단색 1.5px 균일 테두리**
   (2026-08-02 D58/CCC-51 — 구 --gradient-brand. 세컨더리 버튼이 브랜드 그라데이션
   아웃라인을 갖게 되어, 배너는 위험 버튼과 같은 "빨강 테두리 = 위험" 축으로 옮겼다).
   좌측 액센트 띠(border-left 두께 강조)는 금지 패턴이다 — 병합으로 되살아난 것을 걷었다(이슈 #49).
   배너가 서는 것은 테두리가 아니라 위치(HERO 바로 아래)·배경 틴트·아이콘이다.
   --risk 대비가 2.72 라 색 하나에 기대지 않는다: 아이콘·문구·고정 위치·접힘 불가 4중 신호(§9). */
.risk-banner{
  padding:var(--space-6);
  border:1.5px solid var(--risk);
  border-radius:var(--radius-card);
  background:var(--risk-tint-solid);
  color:var(--ink);
}
.risk-banner-head{display:flex;align-items:center;gap:var(--space-2)}
.risk-banner-icon{flex:none;width:18px;height:18px;color:var(--risk)}
.risk-banner-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--risk)}
/* 항목은 흰 배경 행(radius 6 · --line 1px)에 체크박스 + 16/700 --ink.
   그림자는 아웃라인으로 대체됐다(2026-08-05 Q · ADR-0030 — 본문 카드는 선이 경계를 만든다). */
.risk-banner-list{margin:var(--space-3) 0 0;padding:0;display:grid;gap:var(--space-2);list-style:none}
.risk-banner-list li{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border:1px solid var(--line);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:var(--text-md);font-weight:600}
.risk-banner-list .panel-meta{margin-left:auto;color:var(--sub);font-weight:400;font-size:var(--text-sm)}
/* 표준 카드 그리드(D37 §4-2) — **열 수를 쓰지 않는다**(락 10). 최소 폭 420 이 열을 만든다:
   1120 에서 2열(각 510)이고 컨테이너가 좁아지면 스스로 1열이 된다. */
.briefing-cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));gap:var(--space-5);align-items:start}
/* 아코디언이 나란할 때: 펼친 카드는 서로 높이를 맞추고, 접은 카드는 요약 줄만 남긴다(§4-2).
   JS 로 높이를 재서 박지 않는다 — 접으면 행이 실제로 줄어든다. */
.briefing-cards-grid>.briefing-card{align-self:start}
.briefing-cards-grid>.briefing-card[open]{align-self:stretch}
/* 브리핑 3영역·미해결 액션 = **접힘 카드**다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59
   플랫 구획 대체). 카드 모양·제목 줄·화살표는 WireCardDetails(wire-styles.ts)가 갖고,
   여기는 .briefing-card 로 남은 그리드 정렬 훅뿐이다.
   접힘(details)은 유지된다 — 전체 접기·앵커는 그대로다. */
/* optical: 꺽쇠 잉크 보정 translate 는 .wire-card-arrow 와 같은 계약(2026-08-06 실측).
   크기는 em 이다(2026-08-07 Q 8차 "꺽쇠는 폰트 크기를 따라가게 전역 수정". 구 9px/2px
   고정은 14px 글줄(전문 보기) 옆에서 과대했다). 16px 기준 상자 9·획 2 그대로다. */
.briefing-card-arrow{flex:none;width:.5625em;height:.5625em;border-right:.125em solid var(--sub);border-bottom:.125em solid var(--sub);transform:translateX(-.125em) rotate(-45deg);transition:transform .15s ease}
.briefing-fields{display:grid;gap:var(--space-2-5)}
/* 카드 내 중첩 아코디언(기본정보의 전체 참여사업). 기본 접힘. */
/* GAS — 목표별 최신 점수. 점수의 좋고 나쁨을 색으로 표시하지 않는다(D6·R4):
   계열 3색은 목표를 서로 구분하는 회전일 뿐이고 점수 숫자는 항상 --ink 다. */
/* GAS 전폭 섹션(CLAUDE.md 6장 · 2026-07-27 Q 결정 — 이 파일의 CSS 는 템플릿 리터럴이라 주석에 백틱을 쓰지 않는다). 섹션 제목은 카드 밖 h2 18/700 이고 그 아래 16 이다
   — §4-3 세로 리듬(40/24/16/20)에서 '섹션 제목↔내용'에 해당한다. 섹션 사이 24 는 페이지
   그리드의 gap 이 이미 준다(§4-6 규칙 3: 화면에서 margin 으로 띄우지 않는다). */
.briefing-page{display:grid;gap:var(--section-gap)}
.briefing-accordions{display:grid;gap:var(--section-gap)}
/* HERO 는 공통 부품 ParticipantHeroCard 가 그린다(2026-08-05 컴포넌트화 — 구 .briefing-hero
   손 마크업·전용 CSS 삭제. 상태 태그도 부품의 participant-hero-stage 계약을 따른다 —
   트랙 C(PR #61)의 .is-stage 폐지와 같은 결론이라 리베이스에서 컴포넌트 쪽으로 합쳤다). */
/* (구 두 번째 .briefing-toolbar 규칙은 위 정의와 겹쳐 삭제 — 2026-08-03) */
/* 전체 목표(D45 · CCC-41) — 카드다(2026-08-05 카드화 · ADR-0030, 구 D59 플랫 대체).
   카드 모양은 WireCard 가 갖고, 수정 가능성은 안쪽 표시 상자(.briefing-goal-display)가
   알린다. 점수·게이지 자리는 없다(D43). */
.briefing-goal-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.briefing-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.briefing-goal-text.is-empty{color:var(--sub);font-weight:400}
.briefing-goal-form{display:flex;flex:1;align-items:center;gap:var(--space-3);flex-wrap:wrap}
/* 저장·취소 묶음(2026-08-06 Q): 둘 다 버튼이고 컬러(세컨더리 아웃라인 vs 그레이 아웃라인)로
   가른다. 한 결정의 두 갈래라 사이 간격은 입력칸과의 12 보다 좁은 8 이다. */
.briefing-goal-buttons{display:flex;align-items:center;gap:var(--space-2)}
/* 입력칸 계약(§5): 높이 40 · radius 6 · --line-control 1px. */
.briefing-goal-input{flex:1;min-width:min(100%,240px);height:40px;padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-md);color:var(--ink)}
/* 목표 **표시**도 같은 상자다(2026-08-03 Q) — 맨글자는 수정 불가로 읽혀서, 수정할 수 있는
   목표는 입력칸과 같은 형태로 그리고 누르면 바로 편집이 시작된다. */
.briefing-goal-display{flex:1;min-width:min(100%,240px);display:flex;align-items:center;line-height:normal;min-height:var(--control-height);padding:0 var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-md);font-weight:600;text-align:left;color:var(--ink);cursor:pointer}
.briefing-goal-display.is-empty{color:var(--sub);font-weight:400}
@media (hover:hover){.briefing-goal-display:hover{border-color:var(--blue-deep)}}
.briefing-goal-error{margin:0;font-size:var(--text-sm);color:var(--risk)}
/* 브리핑 이어보기(.briefing-more)는 2026-08-06 Q 로 폐지 — '전체 상담 기록' 버튼이
   HERO 행동 줄(당사자 정보 옆)로 올라갔다. */
/* 영역 ① — 실무자 입력·AI 제안의 세 섹션. 구획 사이는 --line 가로선이다(2026-08-06 Q —
   여러 위계의 텍스트가 이어질 때 컬러 라벨 + 가로선이 경계를 만든다). */
.briefing-qsection{display:grid;gap:var(--space-2)}
.briefing-qsection+.briefing-qsection{padding-top:var(--space-4);border-top:1px solid var(--line)}
/* 구획 라벨은 정보 필드 라벨(§5 민트 deep)과 같은 계약을 입는다(2026-08-06 Q "타이틀 컬러").
   AI 제안만 라벤더다 — AI·승인 대기 축(D58 ④). */
.briefing-qlabel{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.briefing-qlabel[data-tone="ai"]{color:var(--lavender-deep)}
/* AI 제안(CCC-39·D45) — 항목마다 제목·이유·근거 회차 링크 3층. */
.briefing-suggestions{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}
.briefing-suggestion{display:grid;gap:var(--space-1)}
.briefing-suggestion-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
/* 본문 16 기본(2026-08-06 Q) — 아코디언 안 읽는 글은 전부 16 이고, 14 는 라벨(qlabel)·
   메타(근거 링크·이력 요약)만 남는다. */
.briefing-suggestion-reason{margin:0;font-size:var(--text-md);color:var(--sub)}
/* 근거 링크도 본문 16 이다(2026-08-06 Q "폰트 크기 정렬" — 영역 ① 안 14 는 라벨만 남는다). */
.briefing-suggestion-link{justify-self:start;font-size:var(--text-md);font-weight:600;color:var(--ink);text-decoration:underline}
/* 영역 ③ 불일치 처리(D45 · CCC-42) — 처리 3종 버튼 줄과 접힌 이력. 처리는 표시일 뿐이라
   시각적 무게를 더하지 않는다(세컨더리 버튼·무채색 요약). */
.briefing-resolution-form{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2)}
.briefing-history{margin-top:var(--space-4);border-top:1px solid var(--line);padding-top:var(--space-4)}
.briefing-history>summary{cursor:pointer;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.briefing-history>.briefing-qsection{margin-top:var(--space-4)}
/* 브리핑 배지도 공용 배지(.wire-badge)를 쓴다(2026-08-07 통합, 구 .briefing-badge 삭제).
   승인 대기는 data-tone="lavender"(색 규율 5). */
/* 빈 상태·처리됨 안내도 본문이다 — 16 기본(2026-08-06 Q). */
.briefing-note{margin:0;font-size:var(--text-md);color:var(--sub)}
/* 영역 ② 회차 행(2026-08-06 Q — 구 불릿 + 메타 줄 대체): 날짜 → 유형 뱃지 → 수기 뱃지 →
   핵심 한 줄이 좌측정렬 고정 간격(12)으로 선다. 본문이 한 줄을 넘으면 줄바꿈 대신
   오른쪽 끝 48px 에서 마스크로 자연스럽게 사라진다 — 훑는 화면이라 행 높이가 고르게 남는다.
   전문은 근거 회차(상담 기록)에서 읽는다. */
.briefing-session-rows{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}
/* 고정 칸 정렬(2026-08-07 Q 9차 "각 항목의 좌측 시작 위치를 고정"): 날짜·유형·수기가
   각자 고정 폭 칸을 가져 어느 행에서나 다음 칸이 같은 x 에서 시작한다. 수기 칸은 배지가
   없어도 자리를 지킨다 — 쌓였을 때 본문 시작점이 흔들리지 않게. 회차 목록(.record-summary)
   의 고정 칸과 같은 계약이고, 날짜 폭 136 도 .record-held-at 과 같은 값이다. */
.briefing-session-row{display:flex;align-items:center;gap:var(--space-3);min-width:0}
.briefing-session-kind{flex:none;width:84px;display:inline-flex}
.briefing-session-kind>.wire-badge{width:100%}
.briefing-session-memo{flex:none;width:52px;display:inline-flex}
.briefing-session-memo>.wire-badge{width:100%}
/* 행간 normal — 뱃지와 나란한 단일행 값의 세로 중앙은 기하 정렬이 만든다(2026-08-06 Q.
   1.55 행간의 글꼴 상자는 뱃지 글자보다 0.9px 위에 실측됐다 — 당사자 카드 셀과 같은 계약). */
.briefing-session-date{flex:none;width:136px;white-space:nowrap;font-size:var(--text-md);line-height:normal;color:var(--ink);font-variant-numeric:tabular-nums}
.briefing-session-row .wire-badge{flex:none}
/* 넘침 처리는 공용 .wire-fade-clip(마크업에서 함께 단다)이 갖는다 — 상담 기록과 같은 규칙. */
.briefing-session-text{flex:1 1 auto;min-width:0;font-size:var(--text-md);line-height:normal;color:var(--ink)}
/* 미해결 액션 행(2026-08-06 Q): 내용은 왼쪽, 담당(민트 — 사람·담당 축)과 기한(블루 —
   일정 축)은 행 오른쪽 끝 뱃지다(D58 ④). 내용이 남는 폭을 갖고 뱃지를 끝으로 민다. */
.briefing-action-rows{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}
.briefing-action-row{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;min-width:0}
.briefing-action-desc{flex:1 1 auto;min-width:0;font-size:var(--text-md);line-height:normal;color:var(--ink);overflow-wrap:anywhere}
.briefing-action-row .wire-badge{flex:none;white-space:nowrap}
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
/* 회차 앞 꺽쇠(.record-chevron)는 2026-08-06 Q 로 폐지 — 좁은 폭에서 세로선으로 읽혔다.
   펼침 상태는 카드의 그라데이션 테두리(활성 어휘)가 이미 알린다. */
/* 고정 칸(2026-08-06 Q "좌측 정렬 되도록 영역·여백 고정"): 회차 번호·날짜가 고정 폭을
   가져 어느 행에서나 유형 뱃지·핵심 한 줄이 같은 x 에서 시작한다. 날짜는 공용 표기
   "2026년 8월 7일"이라 최장 "2026년 12월 31일"이 한 줄에 들도록 136 으로 닫는다
   (2026-08-07 Q 8차. 구 YYYY-MM-DD 96 은 표기 통일 뒤 두 줄로 접혔다).
   행간 normal 은 기하 정렬 계약이다. */
.record-ordinal{flex:none;width:52px;font-size:var(--text-md);font-weight:600;line-height:normal;color:var(--ink)}
.record-held-at{flex:none;width:136px;white-space:nowrap;font-size:var(--text-md);line-height:normal;color:var(--sub);font-variant-numeric:tabular-nums}
/* 유형 칩은 공용 배지 블루 톤이다(2026-08-07 통합, 구 .record-kind 삭제). 시간·상태 축이라
   블루이고 인테이크도 같은 블루, 구분은 글자가 한다. 접힌 줄 안에서 줄어들지 않게만 잡는다. */
.record-summary>.wire-badge{flex:none}
/* 핵심 한 줄. 승인 전 폴백(수기 메모 발췌)은 --sub 로 낮춘다(D5). 넘침은 공용
   .wire-fade-clip(마크업에서 함께 단다)이 갖는다 — 브리핑 회차 행과 같은 규칙(2026-08-06 Q). */
.record-one-liner{flex:1;min-width:0;font-size:var(--text-md);line-height:normal;color:var(--ink)}
.record-one-liner.is-memo{color:var(--sub)}
.record-summary-right{flex:none;display:flex;align-items:center;gap:var(--space-2)}
/* 펼친 본문. 머리와 본문은 --gradient-brand 1px 로 나눈다(§5 카드 계약 — 그라데이션이
   남는 자리는 카드 안쪽 구분선뿐이다). */
/* 본문 패딩은 카드 본문 24 사방(2026-08-07 여백 통일, 구 20/24 대체 — WireCard 와 같은 값). */
.record-body{border-top:1px solid transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-brand) border-box;display:grid;gap:var(--space-5);padding:var(--space-6)}
.record-block{display:grid;gap:var(--space-2)}
/* 카드 안 구획 제목은 라벨이다: 14/600 --sub (2026-08-07 타이포 짝 통일, 구 16/600 --ink 대체.
   .wire-card-section>h3 과 같은 레시피 — 본문 16 과 크기가 겹치면 위계가 사라진다). */
/* '기록 오류' 흔적 — 카드 안 상자였던 .note 를 플랫 한 줄로(2026-08-05 · 카드 안 카드 금지). */
.record-error-note{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 구획 라벨은 브리핑 영역 ① 과 같은 계약이다(2026-08-06 Q 컬러 규칙): 14/600 + 계열 컬러.
   수기 메모·액션 아이템 = 민트(사람·기록·상태 축), 플래그 = 라벨은 민트를 유지하고 리스크
   레드는 확인된 항목에만 남긴다(D9 — 색은 확인된 리스크 전용). */
.record-block>h3{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-block>p{margin:0;font-size:var(--text-md);color:var(--ink);white-space:pre-wrap}
.record-block ul{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2)}
.record-block li{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-2);font-size:var(--text-md);color:var(--ink)}
/* '이번 상담의 목표' — GAS 가 있던 자리(D47 §2). 실무자가 정한 것이라 사람 축(민트)이다.
   재료가 없으면 이 블록 자체를 그리지 않는다 — 빈 블록은 뺀 자리를 다시 빈칸으로 만든다. */
.record-session-goal{display:grid;gap:var(--space-1);border-radius:var(--radius-control);background:var(--mint-tint);padding:var(--space-3) var(--space-4)}
.record-session-goal-label{font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-session-goal p{margin:0;font-size:var(--text-md);color:var(--ink)}
/* 담당 칩(민트)과 AI 출처 칩(라벤더)도 공용 배지 톤이다(2026-08-07 통합,
   구 .record-owner, .record-ai-source 삭제). */
.record-item-meta{font-size:var(--text-sm);color:var(--sub)}
/* 리스크 레드는 **확인된** 플래그에만(D9·D34). 조회 API 가 확인된 것만 내려보내지만,
   색을 상태에 걸어 두면 나중에 범위가 넓어져도 규율이 깨지지 않는다. */
.record-flag{font-weight:600;color:var(--sub)}
.record-flag[data-confirmed="true"]{color:var(--risk)}
.record-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-4);border-top:1px solid var(--line);padding:var(--space-3) var(--space-6);font-size:var(--text-sm);color:var(--sub)}
/* 전체 목표 한 줄 — 브리핑과 같은 어휘이되 이 화면은 읽기 전용이다(입력칸·저장 버튼 없음). */
/* 전체 목표 — 카드 모양은 WireCard 가 갖고(2026-08-05 컴포넌트화), 여기는 안쪽 한 줄 배치만. */
.record-goal-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
.record-goal-label{flex:none;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.record-goal-text.is-empty{font-weight:400;color:var(--sub)}
.record-section-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
@media (max-width:767px){
  /* 좁으면 한 줄이 무너지므로 핵심 한 줄을 아래로 내린다(리스트 행 계약과 같은 접힘).
     내려간 줄은 전문을 접어 보여주므로 페이드 마스크도 함께 끈다. */
  .record-summary{flex-wrap:wrap}
  /* 두 클래스 선택자 — 공용 .wire-fade-clip(한 클래스)보다 구체적이어야 마스크가 꺼진다. */
  .record-one-liner.wire-fade-clip{flex-basis:100%;white-space:normal;overflow:visible;-webkit-mask-image:none;mask-image:none}
  /* 브리핑 회차 행도 같은 접힘 — 고정 칸(136+84+48)이 좁은 화면 폭을 다 먹는다(9차). */
  .briefing-session-row{flex-wrap:wrap}
  .briefing-session-memo:empty{display:none}
  .briefing-session-text.wire-fade-clip{flex-basis:100%;white-space:normal;overflow:visible;-webkit-mask-image:none;mask-image:none}
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
/* 페이지 스택 간격은 여백 3단 ①(24, ADR-0030)을 따른다 — 구 32 를 24 로 모았다. */
.settings-page{display:grid;gap:var(--section-gap)}
/* 설정 구획은 카드다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59 플랫 대체). 카드 모양·제목
   구분선은 WireCard 가 갖고, .settings-section 은 훅으로만 남는다. */
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
/* 활성 여부 배지는 공용 배지(.wire-badge)다(2026-08-07 통합, 구 .settings-user-status 삭제). */
.settings-user-row>.wire-badge{justify-self:start}
.settings-user-row[data-active="false"]{opacity:.6}
@media(max-width:767px){.settings-user-row{grid-template-columns:1fr;gap:var(--space-1)}.settings-user-role{justify-self:start}}
`;

const scheduleStyles = `
/* ticket-20: 상담 등록 */
/* 당사자 선택 행(2026-08-07 Q "텍스트 weight 수정") — 행 기본 400, 이름만 600.
   당사자 카드의 굵기 계약(이름만 강조)을 위저드 행에도 잇는다.
   .wire-row 를 겹쳐 쓰는 이유: 버튼 행은 button.wire-row(0-1-1)가 600 을 다시 얹으므로
   클래스 둘(0-2-0)로 이긴다. */
.wire-row.schedule-candidate-row{font-weight:400}
.schedule-candidate-name{font-weight:600}
.schedule-form{display:grid;gap:var(--space-5);max-width:520px;padding:var(--space-6)}
/* 도움말 문구는 12(--text-xs, 2026-08-07 Q 전역 통일) — .wire-form-hint 와 같은 역할이다. */
.schedule-form-hint{margin:0;color:var(--sub);font-size:var(--text-xs)}
/* 성공색은 이 시스템에 없다(D6·R4). 완료 알림은 중립 잉크 + 문구로 알린다. */
.schedule-form-notice{color:var(--ink);font-weight:600}
.schedule-form-error{color:var(--risk);font-weight:600}
/* 동의 묶음은 카드 안 상자였다 — D59 '카드 안 카드 금지'로 플랫: 위 구분선 하나 + 여백. */
.consent-fieldset{display:grid;gap:var(--space-3);margin:0;padding:var(--space-3) 0 0;border:0;border-top:1px solid var(--line);border-radius:0}
/* legend 는 구획 타이틀 위계다(2026-08-07 Q — 구 14/600 --sub 라벨 대체): 소제목 16/600
   --ink(D61 ③ 짝 계약), 좌측정렬. float 는 legend 의 특수 렌더링(테두리 선 위에 띄우고
   들여쓰는 것)을 끄는 표준 장치다 — float 가 none 이 아니면 legend 는 일반 자식으로
   내려와 그리드 첫 행에 왼쪽 정렬로 선다(구 6px 들여쓰기 패딩도 함께 걷는다). */
.consent-fieldset legend{float:left;padding:0;font-weight:600;font-size:var(--text-md);color:var(--ink)}
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
/* 월 이동 줄(2026-08-06 Q 개정): 버튼은 일반(neutral) 그레이 아웃라인, 꺽쇠는 당사자
   카드와 같은 부품(.wire-chevron)을 버튼 안 크기(8)로, 글자와 꺽쇠 사이는 12 로 벌린다. */
/* 2026-08-06 Q 후속 — 시안 2종을 data-variant 로 나란히 둔다(확정 전 임시 스위치 ?nav=2):
   ① group = 이전 달·달 라벨·다음 달 세 조각이 **상자 하나**에 든다.
   ② inverse = 세 버튼을 유지하고 **달 라벨만 반전** — 라이트 = 어두운 면 + 그라데이션 글자
     ↔ 다크 = 그라데이션 면 + --on-action 글자(사이드바 내비 반전 호버와 같은 계약,
     ADR-0030 테마 규칙 ③). 확정되면 남는 시안 하나로 접는다.
   형태는 D61(2026-08-07)로 직사각 radius 6 이다 — 구 알약 문구 대체. */
.month-nav{display:flex;align-items:center;justify-content:flex-start;gap:var(--space-4)}
.month-nav .wire-button{gap:var(--space-3)}
/* 달 라벨은 이 줄의 **값**이라 조작 버튼보다 한 발 선다(2026-08-06 Q "상대적으로 작아 보인다")
   — 크기 +1(15) · 600. 당사자 카드 이름과 같은 계단 광학 예외 형식이다(§2-1). */
.month-nav-label{display:inline-flex;align-items:center;justify-content:center;line-height:normal;min-width:9ch;min-height:var(--pill-height);padding:0 var(--space-4);border:1px solid var(--line);border-radius:var(--radius-control);font-size:calc(var(--text-sm) + 1px);font-weight:600;color:var(--ink);white-space:nowrap}
/* ── 시안 ① 하나의 상자 ── 겉 테두리는 neutral 버튼·카드와 같은 --line(2026-08-07 Q 통일,
   구 --line-action), 조각 사이 세로선도 --line. 높이도 조작 버튼과 같은 32 다.
   모서리 밖 삐침은 clip 으로 자른다. */
.month-nav-group{display:inline-flex;align-items:stretch;min-height:var(--pill-height);border:1px solid var(--line);border-radius:var(--radius-control);background:var(--panel);overflow:clip}
.month-nav-group .month-nav-label{border:0;border-radius:0;min-height:auto}
.month-nav-seg{display:inline-flex;align-items:center;line-height:normal;gap:var(--space-3);padding:0 var(--space-3-5);color:var(--ink);font-size:var(--text-sm);font-weight:400;white-space:nowrap}
/* 조각의 꺽쇠도 조작 버튼과 같은 .5em(14px 글자에서 7) — 글자를 따라 줄어든다. */
.month-nav-seg .wire-chevron{width:.5em;height:.5em}
.month-nav-seg+.month-nav-label,.month-nav-label+.month-nav-seg{border-left:1px solid var(--line)}
/* 상자 하나 안이라 포커스 링을 안으로 접는다 — overflow:clip 에 잘리지 않게. */
.month-nav-seg:focus-visible{outline-offset:-2px}
@media (hover:hover){.month-nav-seg:hover{background:color-mix(in srgb,var(--ink) 6%,var(--panel))}}
.month-nav-seg:active{transform:translateY(1px)}
/* ── 시안 ② 현재 달 반전 ── 글자 그라데이션은 안쪽 span 에 clip 으로 얹는다(겉은 어두운 면). */
.month-nav[data-variant="inverse"] .month-nav-label{background:var(--ink);border-color:transparent}
.month-nav[data-variant="inverse"] .month-nav-label>span{background:var(--gradient-brand);-webkit-background-clip:text;background-clip:text;color:transparent}
[data-theme="dark"] .month-nav[data-variant="inverse"] .month-nav-label{background:var(--gradient-brand)}
[data-theme="dark"] .month-nav[data-variant="inverse"] .month-nav-label>span{background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--on-action)}
/* 768 미만: ② 는 기존 그리드(라벨 위 전폭, 이동 두 버튼 아래 반반)를 유지하고,
   ① 은 상자가 전폭으로 늘며 라벨이 남는 폭을 가진다. */
@media(max-width:767px){
  .month-nav[data-variant="inverse"]{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}
  .month-nav[data-variant="inverse"] .month-nav-label{grid-column:1/-1;grid-row:1}
  .month-nav-group{width:100%}
  .month-nav-group .month-nav-label{flex:1;min-width:0}
  .month-nav-seg{flex:none}
}
/* 날짜 묶음·행(.month-day·.month-row*)은 2026-08-06 Q 카드 통일로 삭제 — 전체 일정도
   다가오는 일정과 같은 당사자 카드(ParticipantCard, wire-styles.ts)를 쓴다. 상태·유형
   뱃지는 카드의 .wire-badge 어휘가 이어받는다(트랙 C PR #61 의 배지 재규정 포함). */
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
/* D15·D23: 동의 문안 "자세히 읽어보기"·"전문 보기" — briefing-subaccordion 패턴 재사용.
   등록 폼(자세히 읽어보기)과 동의 수정 허브(항목별 전문 보기, 2026-08-07 Q)가 같은 부품이다. */
.consent-detail{padding-top:var(--space-2);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
/* 체크박스 바로 아래 붙는 변형(허브 전문 보기) — 항목 사이 구분선 없이 라벨만 살짝 들여 선다. */
/* optical: 18px 는 간격이 아니라 체크박스 상자 폭이다 — 라벨 첫 글자 x 에 요약 줄을 맞춘다 */
.consent-detail[data-inline="true"]{padding-top:0;background:none;margin-left:calc(18px + var(--space-3))}
/* 화살표는 텍스트 바로 옆이다(2026-08-07 Q 9차 — 구 space-between 은 화살표가 오른쪽
   끝으로 떨어져 라벨과 남남으로 읽혔다). */
.consent-detail-summary{display:flex;justify-content:flex-start;align-items:center;gap:var(--space-3);padding:var(--space-1-5) 0;font-size:var(--text-sm);font-weight:600;color:var(--ink);cursor:pointer;list-style:none}
.consent-detail-summary::-webkit-details-marker{display:none}
/* 인라인 변형의 요약 줄은 **작은 배지형 버튼**이다(2026-08-07 Q 9차 "전문보기를 작은
   뱃지형 버튼으로" — 구 텍스트+화살표 줄 대체). 모양은 기본 배지 레시피(높이 24 ·
   --sub 외곽선 · 알약 · 14/400 --ink)를 그대로 빌리고, 조작이므로 호버 면만 얹는다.
   화살표는 글자를 따라 줄어드는 em 계약이라 배지 안에서 저절로 작아진다. */
.consent-detail[data-inline="true"]>.consent-detail-summary{display:inline-flex;width:max-content;align-items:center;justify-content:flex-start;gap:var(--space-2);min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);/* consent-detail-summary: 배지형 버튼(pill 허용목록 등재) */font-weight:400;color:var(--ink);line-height:normal}
@media (hover:hover){.consent-detail[data-inline="true"]>.consent-detail-summary:hover{background:var(--muted)}}
.consent-detail[open]>.consent-detail-summary>.briefing-card-arrow{transform:translateY(-.125em) rotate(45deg)}
/* 전문 본문은 카드 안 묶음 상자다(2026-08-07 Q "카드 안에 넣어서 통일감" — 구 전폭 플랫
   텍스트는 글줄이 카드 폭 전체로 늘어져 혼자 길었다). 서명 첨부 자리와 같은 문법의 상자에
   담고 읽기 폭을 72ch 로 막는다. 새 색 없음 — 배경은 --muted, 테두리는 --line 이다. */
.consent-detail-body{display:grid;gap:var(--space-4);margin-top:var(--space-3);padding:var(--space-4) var(--space-5);max-width:72ch;background:var(--muted);border:1px solid var(--line);border-radius:var(--radius-control)}
.consent-detail-disclaimer{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.consent-detail-section{display:grid;gap:var(--space-1-5)}
.consent-detail-section h3{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.consent-detail-section p,.consent-detail-section li{margin:0;font-size:var(--text-sm);color:var(--sub)}
.consent-detail-section ul{margin:0;padding-left:var(--list-indent);display:grid;gap:var(--space-1-5)}
/* 인테이크 위저드 고정 요소(2026-08-07 Q 9차·10차 개정): **진행 단계 레일만** 스크롤해도
   화면에 남는다 — 맥락 카드(당사자·단계·실무자)는 static 으로 함께 흘러간다(10차 Q
   "당사자 카드는 스크롤하면 사라져야지" — 구 9차 sticky 지시 대체). sticky 기준은 헤더
   아래(사이드바와 같은 계약)이고, 768 미만은 한 열이라 고정하지 않는다 — 좁은 화면에서
   위가 붙박이면 본문이 안 보인다. */
@media (min-width:768px){
  .intake-step-nav{position:sticky;top:calc(var(--header-height) + var(--space-6));align-self:start}
}
/* 관리자 온보딩 2단계 (CCC-32). 새 시각 언어 없음 — .surface-card + 킷 부품 조합이고,
   단계 표시는 블루 계열(시간·상태 축, D34)이다. */
.onboarding-form{display:grid;margin-top:var(--space-8)}
.onboarding-card{display:grid;gap:var(--space-4);padding:var(--space-6)}
.onboarding-card h2{margin:0}
/* 단계 표시는 공용 배지 블루 톤이다(2026-08-07 통합, 구 .onboarding-step 삭제). */
.onboarding-card>.wire-badge{margin:0;justify-self:start}
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
/* 이 세 패널은 카드 계약을 마크업의 .surface-card 로 받는다(2026-08-05 컴포넌트화 —
   구 계약 CSS 복사 5줄 삭제). 여기 남는 것은 카드 패딩 3종 중 **좁은 보조 패널(16/20)**
   (DESIGN.md §3-4, 2026-07-31)과 배치뿐이다: 이 화면은 우측 레일 200 을 떼고 남은 좁은
   열에 서고 레일 자체는 200px 이라 좌우 24 를 주면 안쪽 글 폭이 152 로 떨어진다. */
/* 고정 헤더는 스크롤 중 본문 위에 뜨는 층이라 그림자를 유지한다(ADR-0030 — 그림자는 떠
   있는 층 전용). */
.record-sticky{position:sticky;top:0;z-index:var(--z-sticky);box-shadow:var(--shadow-soft);display:grid;gap:var(--space-2);padding:var(--space-4) var(--space-5)}
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
/* 좁은 보조 패널 16/20 (§3-4, 2026-08-07 여백 통일 — 구 16 사방). */
.record-rail{position:sticky;top:0;display:grid;gap:var(--space-2);padding:var(--space-4) var(--space-5)}
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
