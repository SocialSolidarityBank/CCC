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
import { getNewSignupCount } from './lib/api';
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
   헤더가 1행을 차지하므로 sticky 기준은 var(--header-height) 아래다. 위 패딩 32는
   첫 메뉴 항목과 본문 열 '뒤로' 알약의 윗변을 같은 높이에 세운다. */
.sidebar{display:flex;flex-direction:column;gap:var(--space-8);padding:var(--space-8) var(--space-6) var(--space-6);background:var(--canvas);color:var(--ink);position:sticky;top:var(--header-height);height:calc(100dvh - var(--header-height));overflow:visible}
.sidebar::after{content:"";position:absolute;top:0;bottom:0;right:0;width:1px;background:var(--gradient-frame-v)}
/* 메뉴만 내부 스크롤 담당(min-height:0 이 없으면 flex 아이템이 내용 높이를 고집해 안 줄어든다). */
.sidebar>.navigation-list{overflow-y:auto;min-height:0}
.navigation-link{display:flex;align-items:center;gap:var(--space-2)}
/* CCC-26: 새 가입 숫자 배지는 메뉴 라벨 뒤가 아니라 trailing chip 자리(준비 중과 같은 우측 끝)에 둔다. */
.navigation-link>.wire-badge{margin-left:auto}
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
   바뀌어, 캔버스(#F4F1EC) 위 패널 상자는 경계 없이는 형태가 안 잡힌다(§5 입력칸 계약). */
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
/* 높이는 '뒤로' 알약과 같은 32다. 첫 메뉴와 뒤로 버튼은 헤더 아래 32에서 함께 시작한다. */
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
/* 활성 = tint 채움 + --gradient-brand 1px 테두리 (2026-08-04 Q — --blue-tint #DCE8F4 가
   사이드바 그라데이션 최상단 색과 동일해 위쪽 메뉴에서 활성 상자가 아예 안 보였다.
   그라데이션 테두리는 D58 '선택·활성' 어휘다). */
.navigation-link[data-current="true"]{background:linear-gradient(var(--blue-tint),var(--blue-tint)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-weight:600}
.navigation-link[data-current="true"] svg{color:var(--blue-deep)}
/* '준비 중' 배지 — 화면이 아직 없는 메뉴를 누르기 전에 알린다(CCC-23). 중립 회색 알약(§5 상태 배지).
   파스텔 신호 축(블루·민트·라벤더)에 속하지 않는 상태라 새 색을 쓰지 않는다. */
.navigation-soon{margin-left:auto;display:inline-flex;align-items:center;line-height:normal;min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);font-size:var(--text-md);font-weight:500;color:var(--sub);white-space:nowrap}
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
.app-header{grid-column:1/-1;position:sticky;top:0;z-index:var(--z-sticky);display:flex;align-items:center;gap:var(--space-10);height:var(--header-height);padding:0 var(--space-8);background:var(--canvas)}
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
/* 한글 글리프 중간을 녹이던 마스크를 모바일 바에서는 끈다. 기관명은 그대로 보이고,
   남는 폭보다 긴 사업명만 글리프 경계에서 말줄임표로 끝난다(2026-08-25 시각 QA). */
.drawer-bar .program-switcher-name{-webkit-mask-image:none;mask-image:none;text-overflow:ellipsis}
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
  /* spacing v2에서 컨테이너 최대 폭은 패딩을 포함한 1440이다.
     긴 설명은 페이지 폭이 아니라 해당 부품의 72ch 읽기 폭이 제한한다. */
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
/* .narrow 960은 폐지 상태다. 화면은 --page-max 하나를 쓰고 폼과 긴 글이 읽기 폭을 좁힌다. */
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
.page-backbar:has(.page-back){width:100%;max-width:var(--page-max);margin-inline:auto;padding:var(--space-8) var(--page-pad-x) 0}
/* 뒤로 알약 아래는 별도 탐색 구획이다. 본문 제목이 버튼에 붙어 보이지 않도록 40 을 둔다. */
.page-backbar:has(.page-back)+.page-content{padding-top:var(--space-10)}
/* 뒤로가기도 버튼이다(2026-08-04 Q, 구 투명 텍스트 대체. 형태는 2026-08-07 직사각 radius 6,
   구 알약 대체). 옷은 **일반(neutral)**
   그레이 아웃라인이다(2026-08-06 Q 위계 재편 — 구 그라데이션 테두리 대체: 이동·보기 조작은
   그레이, 컬러는 중요 행동만). 테두리는 카드 아웃라인과 같은 --line 이다(2026-08-07 Q
   "뒤로 아웃라인을 카드 div 아웃라인과 맞출 것" — neutral 버튼과 같은 개정).
   화살표와 글자 사이는 6 — 8은 떨어져 보인다(같은 날 Q).
   --button-fill 은 .wire-button 과 같은 지역 변수 패턴(호버가 채움만 바꾼다). */
.page-back{--button-fill:var(--panel);display:inline-flex;align-items:center;line-height:normal;gap:var(--space-1-5);min-height:var(--pill-height);padding:0 var(--space-4);border:1px solid transparent;border-radius:var(--radius-pill);background:linear-gradient(var(--button-fill),var(--button-fill)) padding-box,var(--gradient-brand) border-box;color:var(--ink);font-size:var(--text-sm);font-weight:600;cursor:pointer}
@media (hover:hover){.page-back:hover{--button-fill:color-mix(in srgb,var(--ink) 6%,var(--panel))}}
/* 눌림 모션(1px 가라앉음)은 일부러 없다(2026-08-04 Q) — 바로 아래 가로선에 걸려 보인다. */
.page-back:focus-visible{outline:2px solid var(--blue-deep);outline-offset:2px}
/* h1 과 행동 버튼(40)은 세로 중앙으로 맞춘다(2026-08-04 Q — flex-start 는 제목이 위로 떠 보였다). */
.page-header{display:flex;justify-content:space-between;gap:var(--space-6);align-items:center}
/* 우상단 행동 묶음 (D35 — 사이드바=장소 / 페이지 우상단=행동). 주 행동이 오른쪽 끝이다. */
.page-actions{display:flex;align-items:center;gap:var(--space-3);flex:none}
/* 굵기를 **선언해야** 한다(2026-08-09). 크기·행간만 적고 굵기를 비워 두면 UA 기본
   font-weight:bold 가 살아 700 으로 렌더된다 — 700 은 2026-08-03 에 폐지한 굵기이고(§2
   400·500·600), guard:tokens 는 '선언된 값'만 보므로 선언이 없어서 새는 이 경우를 못 잡았다.
   클래스 없는 제목이 실제로 700 이던 자리: 로딩·오류·빈 상태의 h1 6곳, 온보딩·관리자·가입
   완료의 h2. 클래스가 굵기를 정하는 제목(.wire-page-title·.record-section-title·
   .wire-card-title>h2)은 그대로다 — 여기 값은 그 아래 깔리는 바닥이다. */
h1{margin:0;font-size:var(--text-2xl);font-weight:600;line-height:var(--leading-tight)}
h2{margin:0;font-size:var(--text-lg);font-weight:600;line-height:var(--leading-snug)}
/* 본문 강조도 600 이다(D58 ② "본문 강조는 색이 아니라 굵기 600"). 위 h1·h2 와 같은 이유로
   선언이 없으면 UA 기본 bold 700 이 산다 — 실제로 상담 기록의 '기록 오류' 강조와 킷 본문이
   700 이었고, 상담 등록만 인라인으로 600 을 덮어쓰고 있었다. */
strong{font-weight:600}
/* 전역 p 는 body 상속과 합쳐 16/400 --sub 로 선다. 이 조합은 §1 표 밖(기존 부채)이라
   위계 baseline 에 등재돼 있다(2026-08-27 검수). 여기 세 축을 실효값 그대로 명시한 것은
   감사가 이 부채를 보게 하기 위함이며 시각 변화는 없다. 고칠 때 baseline 도 함께 지운다. */
p{margin:var(--space-2) 0 0;font-size:var(--text-md);font-weight:400;color:var(--sub)}
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
/* .panel 은 2026-08-09 에 지웠다 — 마지막 사용처였던 브리핑 빈 상태가 WireCard 로 바뀌면서
   쓰는 마크업이 0 이 됐다(guard:tokens dead-class 가 잡았다). 카드 패딩 24 는 .wire-card 몫이다. */
/* 빈 상태 한 줄(WireEmpty, 2026-08-09 전수 정리). 마크업은 그 부품을 쓴다.
   구 min-height:92px 는 지웠다 — 높이 예약은 빈 상태의 뜻이 아니라 화면 레이아웃의 일이고,
   그 값 때문에 브리핑이 .briefing-note 라는 두 번째 빈 상태 규칙을 따로 갖고 있었다
   (한 카드에 빈 줄이 둘이면 92 × 2 = 184 가 비어 보인다). 크기는 §2-2 위계 4단 ④ 다. */
/* margin:0 — 전역 p{margin-top:8}이 새면 reserve 92 안에서 위로만 8 밀려 가운데 정렬이
   깨진다(2026-08-29 Q "위에만 여백"). 형제와의 간격은 부품이 아니라 묶음 gap 이 만든다(§7). */
.empty{margin:0;display:flex;align-items:center;gap:var(--space-2);color:var(--sub);font-size:var(--text-sm)}
/* 자리 예약은 **켜는 것**이다(WireEmpty reserve) — 이 줄이 카드의 유일한 내용일 때만.
   태그를 붙여 0-2-1 로 올린다(2026-08-10). 아래 participantStyles 의 라이브 영역 바닥
   [aria-live="polite"] min-height:1.5em 이 **같은 0-2-0** 이고 이음 순서상 뒤에 와서,
   예약이 조용히 21px 로 덮여 있었다(실측: 로딩 카드 본문 30px). 켜 두었는데 안 켜지는
   상태였고 화면에서는 "글자가 위아래 가운데가 아니다"로 보였다. 순서에 기대지 않게 못 박는다. */
p.empty[data-reserve="true"]{min-height:92px}
.form{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.42fr);gap:var(--space-5);align-items:start}
/* 라벨은 14/600 --sub 로 값 위에 둔다 — 입력 경계선(1.28) 하나에 기대지 않기 위한 규칙(§9). */
.field{display:grid;gap:var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.field input,.field select,.field textarea{width:100%;min-height:var(--control-height);padding:var(--space-2) var(--space-3);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:var(--text-sm);font-weight:400}
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
  /* height 해제가 필수다. 데스크톱의 calc(100dvh - var(--header-height))가 남으면
     top과 bottom을 함께 정해도 height가 이겨 드로어가 화면 아래를 못 덮는다. */
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
     오른쪽에서 나오므로 본문과 만나는 모서리가 왼쪽이다. 닫힌 상태에서는 선만 숨긴다 —
     scrollbar-gutter 가 만든 15px 예약 폭 때문에 100% 이동 뒤에도 선이 화면 끝에 남는다. */
  .sidebar::after{right:auto;left:0;opacity:0}
  .sidebar[data-drawer-open="true"]::after{opacity:1}
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
  /* 모바일 페이지와 HERO 행동은 내용 크기의 가로 묶음으로 모이고, 자리가 부족하면
     자연스럽게 다음 줄로 넘어간다. 세컨더리 → 프라이머리 순서와 오른쪽 행동 축을 유지한다.
     flex:0 1 auto + min-width:0 이 없으면 기본 규칙의 flex:none(수축 0)이 살아, 묶음이
     내용 최대폭 밑으로 못 줄어 자체 wrap 이 영영 발동하지 않는다. 글자 폭이 넓은
     환경(CI 폰트)에서 390 오른쪽 19px 넘침의 원인이었다(2026-08-27 실측). */
  .page-header{flex-direction:column;align-items:stretch}
  .page-actions{width:auto;min-width:0;flex:0 1 auto;align-self:flex-end;flex-direction:row;align-items:center;justify-content:flex-end;flex-wrap:wrap}
  .page-header .wire-button{width:auto;justify-content:center}
  /* 뒤로 알약의 좌측선 = 컨테이너 패딩 16 (2026-08-05 Q 2차 "메뉴 - 뒤로 - 상담 일정 좌측
     정렬"). 데스크톱의 24 는 사이드바 안쪽선 정렬인데 모바일엔 사이드바가 없다 — 바 내용·
     본문 제목과 같은 16 에 세운다. */
  .page-backbar:has(.page-back){padding:var(--space-6) var(--space-4) 0}
  .page-backbar:has(.page-back)+.page-content{padding-top:var(--space-8)}
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
.risk-banner-list li{display:grid;gap:var(--space-2);padding:var(--space-3) var(--space-4);border:1px solid var(--line);border-radius:var(--radius-control);background:var(--panel);color:var(--ink);font-size:var(--text-md);font-weight:600}
.risk-banner-item-head{display:flex;align-items:center;gap:var(--space-2)}
.risk-banner-list .panel-meta{margin-left:auto;color:var(--sub);font-weight:400;font-size:var(--text-sm)}
/* 표준 카드 그리드(D37 §4-2)는 열 수를 쓰지 않는다. 최소 폭 420이 열을 만들며,
   spacing v2 최대 장폭에서는 3열까지 열리고 컨테이너가 좁아지면 2열과 1열로 접힌다. */
/* 아코디언이 나란할 때: **펼친 카드끼리는 높이를 맞추고, 접힌 카드는 요약 줄만 남긴다**(§4-2).
   높이는 내용이 정한다 — JS 로 재서 박지 않는다.

   2026-08-10 에 "접혀 있어도 맞춘다"로 한 번 바꿨다가 **실물을 보고 되돌렸다**(같은 날 Q
   "무조건 높이를 맞추는 게 아니라, 접혀 있을 때는 높이를 따라가지 말아"). 하니스 실측:
   접힘 카드가 요약 줄에 필요한 72 대신 246 이 되어 174 가 빈 채로 남았다. 이것이 §4-2 가
   처음부터 이 규칙을 이렇게 정해 둔 이유였고, 문장만 읽고 그림으로 확인하지 않은 채
   바꾼 것이 잘못이었다.
   높이 맞춤이 필요한 것은 **읽는 자료 카드**다(일정 위저드의 참고 카드 2장 — .card-grid 와
   .wire-container[data-grid] 가 이미 편다). 접힘은 "지금 안 보겠다"는 상태라 자리를 비운다. */
.briefing-cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--grid-min)),1fr));gap:var(--space-5);align-items:start}
.briefing-cards-grid>.briefing-card{align-self:start}
.briefing-cards-grid>.briefing-card[open]{align-self:stretch}
/* 브리핑 카드가 컨테이너다(2026-08-28) — 카드 안 2단 배치가 화면 폭이 아니라 **자기 폭**을
   본다(그리드 반칸이면 좁은 것이다. .record-list 와 같은 계약). */
.briefing-card{container-type:inline-size;min-width:0}
/* 브리핑 3영역·미해결 액션 = **접힘 카드**다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59
   플랫 구획 대체). 카드 모양·제목 줄·화살표는 WireCardDetails(wire-styles.ts)가 갖고,
   여기는 .briefing-card 로 남은 그리드 정렬 훅뿐이다.
   접힘(details)은 유지된다 — 전체 접기·앵커는 그대로다. */
/* 구 .briefing-card-arrow 는 2026-08-10 에 없앴다 — .wire-card-arrow 와 **값이 한 글자도
   다르지 않은 복사본**이었다(폭·획·보정·전환 전부 동일). 화면 4곳이 복사본 쪽 이름을
   쓰고 있었을 뿐이라 이름만 바꾸면 끝났다. 모양의 주인은 wire-styles.ts 한 곳이다. */
/* 불일치 양쪽 인용(2026-08-28 Q "가로 장폭이 길 때 화면을 적절하게" — 구 .briefing-fields
   세로 쌓임 대체): 대등한 짝 정보는 넓은 카드에서 2단으로 나란히 선다 — 대조가 한눈에
   들어온다. 카드가 좁으면(모바일·그리드 반칸) 세로로 돌아간다. */
.briefing-discrepancy-sides{display:grid;gap:var(--space-4)}
.briefing-discrepancy-side{display:grid;gap:var(--space-2);justify-items:start;min-width:0}
@container (min-width:720px){.briefing-discrepancy-sides{grid-template-columns:1fr 1fr;column-gap:var(--space-6)}}
/* 카드 내 중첩 아코디언(기본정보의 전체 참여사업). 기본 접힘. */
/* GAS — 목표별 최신 점수. 점수의 좋고 나쁨을 색으로 표시하지 않는다(D6·R4):
   계열 3색은 목표를 서로 구분하는 회전일 뿐이고 점수 숫자는 항상 --ink 다. */
/* GAS 전폭 섹션의 제목은 카드 밖 h2 18/600이고 그 아래 16이다.
   섹션 사이 32는 페이지 그리드의 gap이 주며 화면이 margin으로 별도 여백을 만들지 않는다. */
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
.briefing-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-sm);font-weight:400;color:var(--ink)}
.briefing-goal-text.is-empty{color:var(--sub);font-weight:400}
.briefing-goal-form{display:flex;flex:1;align-items:center;gap:var(--space-3);flex-wrap:wrap}
/* 저장·취소 묶음(2026-08-06 Q): 둘 다 버튼이고 컬러(세컨더리 아웃라인 vs 그레이 아웃라인)로
   가른다. 한 결정의 두 갈래라 사이 간격은 입력칸과의 12 보다 좁은 8 이다. */
.briefing-goal-buttons{display:flex;align-items:center;gap:var(--space-2)}
/* 입력칸 계약(§5): 높이 40 · radius 6 · --line-control 1px. */
.briefing-goal-input{flex:1;min-width:min(100%,240px);height:40px;padding:0 var(--control-pad);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-sm);font-weight:400;line-height:normal;color:var(--ink)}
/* 목표 **표시**도 같은 상자다(2026-08-03 Q) — 맨글자는 수정 불가로 읽혀서, 수정할 수 있는
   목표는 입력칸과 같은 형태로 그리고 누르면 바로 편집이 시작된다. */
.briefing-goal-display{flex:1;min-width:min(100%,240px);display:flex;align-items:center;line-height:normal;min-height:var(--control-height);padding:0 var(--control-pad);border:1px solid var(--line-control);border-radius:var(--radius-control);background:var(--panel);font:inherit;font-size:var(--text-sm);font-weight:400;text-align:left;color:var(--ink);cursor:pointer}
.briefing-goal-display.is-empty{color:var(--sub);font-weight:400}
@media (hover:hover){.briefing-goal-display:hover{border-color:var(--blue-deep)}}
.briefing-goal-error{margin:0;font-size:var(--text-sm);color:var(--risk)}
/* 활성 세부 목표 (D62 §8 · CCC-69) — 전체 목표 카드 안, 가로선 아래 기본 펼침 최대 3줄.
   말줄임 규칙: 회차 행과 같은 .wire-fade-clip(한 줄 압축 + 오른쪽 마스크 페이드),
   767px 이하는 줄바꿈 전환(아래 모바일 블록). 항목은 불릿 목록 14/400 --ink 다
   (2026-08-30 Q "불릿 처리 + 14" — 구 16 ③ 대체. §1 '긴 읽는 본문 14' 계약. 불릿
   .wire-bullets 는 2개 이상일 때만 얹는다 — 목표 트리와 같은 규칙, 마크업이 가른다). */
.briefing-subgoal-rows{display:grid;gap:var(--space-2);margin:0;padding:0;list-style:none}
.briefing-subgoal-row{font-size:var(--text-sm);line-height:normal;color:var(--ink)}
/* 세션 목표에 병기하는 부모 세부 목표 이름 (D62 §5) — 부모가 닫혔으면 흐리게(--sub).
   색에만 기대지 않게 문구도 '(종료)'를 함께 쓴다(마크업). */
.briefing-parent-goal{font-size:var(--text-sm);color:var(--sub);font-weight:600}
.briefing-parent-goal.is-closed{color:var(--sub)}
/* 전체 목표 미설정 안내 한 줄 (D62 §7) — 설명·메타 단(14/400 --sub, §2-2 단 ④).
   상자를 두르지 않는다(콜아웃 카드는 카드 안 카드가 된다 — D59 ③). */
.briefing-ai-goal-hint{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 브리핑 이어보기(.briefing-more)는 2026-08-06 Q 로 폐지 — '전체 상담 기록' 버튼이
   HERO 행동 줄(당사자 정보 옆)로 올라갔다. */
/* 영역 ① — 실무자 입력·AI 제안의 세 섹션. 2026-08-10 부터 공용 부품 WireCardSection 이
   맡는다(구 .briefing-qsection · .briefing-qlabel 폐지). 라벨 색·형제 가로선·세로 리듬은
   전부 부품 계약으로 옮겼고, 2026-08-06 Q 가 정한 "컬러 라벨 + 가로선" 모양은 그대로다.
   AI 제안 목록(CCC-39·D45)의 라벤더 tint 상자는 WireItem tone="lavender" 가 갖는다. */
/* 브리핑 카드 구획(세션 목표·맞춤형 질문·AI 제안·검토할 AI 초안)은 구획 하나가 낱개
   카드다(2026-08-30 Q "div 컴포넌트화" — 상자는 공용 .wire-repeat-card 가 갖는다.
   구 형제 구분선 대체). 카드 사이 16 은 본문 grid gap 이 만든다(§7 행 카드 스택). */
.briefing-card>.wire-card-body{gap:var(--space-4)}
.briefing-memo-item{display:grid;min-width:0}
.briefing-suggestions{display:grid;gap:var(--space-4);margin:0;padding:0;list-style:none}
/* 영역 ③ 불일치 처리(D45 · CCC-42) — 처리 3종 버튼 줄과 접힌 이력. 처리는 표시일 뿐이라
   시각적 무게를 더하지 않는다(세컨더리 버튼·무채색 요약). */
.briefing-resolution-form{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2)}
.briefing-history{margin-top:var(--space-4);border-top:1px solid var(--line);padding-top:var(--space-4)}
.briefing-history>summary{cursor:pointer;font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.briefing-history>.wire-card-section{margin-top:var(--space-4)}
/* 브리핑 배지도 공용 배지(.wire-badge)를 쓴다(2026-08-07 통합, 구 .briefing-badge 삭제).
   승인 대기는 data-tone="lavender"(색 규율 5). */
/* 빈 상태·처리됨 안내도 본문이다 — 16 기본(2026-08-06 Q). */
/* 영역 ② 회차 행(2026-08-06 Q — 구 불릿 + 메타 줄 대체): 날짜 → 유형 뱃지 → 수기 뱃지 →
   핵심 한 줄이 좌측정렬 고정 간격(12)으로 선다. 본문이 한 줄을 넘으면 줄바꿈 대신
   오른쪽 끝 48px 에서 마스크로 자연스럽게 사라진다 — 훑는 화면이라 행 높이가 고르게 남는다.
   전문은 근거 회차(상담 기록)에서 읽는다. */
.briefing-session-rows{display:grid;gap:var(--space-4);margin:0;padding:0;list-style:none}
/* 고정 칸 정렬(2026-08-07 Q 9차 "각 항목의 좌측 시작 위치를 고정"): 날짜·유형·수기가
   각자 고정 폭 칸을 가져 어느 행에서나 다음 칸이 같은 x 에서 시작한다. 수기 칸은 배지가
   없어도 자리를 지킨다 — 쌓였을 때 본문 시작점이 흔들리지 않게. 회차 목록(.record-summary)
   의 고정 칸과 같은 계약이고, 날짜 폭 136 도 .record-held-at 과 같은 값이다. */
.briefing-session-row{display:flex;align-items:center;gap:var(--space-4);min-width:0}
.briefing-session-kind{flex:none;width:84px;display:inline-flex}
.briefing-session-kind>.wire-badge{width:100%}
.briefing-session-memo{flex:none;width:52px;display:inline-flex}
.briefing-session-memo>.wire-badge{width:100%}
/* 행간 normal — 뱃지와 나란한 단일행 값의 세로 중앙은 기하 정렬이 만든다(2026-08-06 Q.
   1.55 행간의 글꼴 상자는 뱃지 글자보다 0.9px 위에 실측됐다 — 당사자 카드 셀과 같은 계약). */
/* 날짜는 메타 단이다: 14/400 --sub (2026-08-10 CCC-87, 구 16/400 --ink).
   좁은 화면에서 본문이 아래 줄로 접히면 날짜와 핵심 한 줄이 위아래로 붙는데 둘 다 16/400
   --ink 라 무엇을 먼저 읽을지가 사라졌다(하니스 실측, 767·390). 훑을 때 잡혀야 하는 것은
   핵심 한 줄이므로 날짜가 물러선다. 상담 기록의 .record-held-at 과 같은 값으로 맞춘다 —
   두 화면이 같은 것을 보여 주면서 브리핑만 --ink 였다. 칸 폭 136 은 그대로다. */
.briefing-session-date{flex:none;width:136px;white-space:nowrap;font-size:var(--text-sm);font-weight:400;line-height:normal;color:var(--sub);font-variant-numeric:tabular-nums}
.briefing-session-row .wire-badge{flex:none}
/* 넘침 처리는 공용 .wire-fade-clip(마크업에서 함께 단다)이 갖는다 — 상담 기록과 같은 규칙. */
.briefing-session-text{flex:1 1 auto;min-width:0;font-size:var(--text-sm);line-height:normal;color:var(--ink)}
/* 미해결 액션 행(2026-08-06 Q · 2026-08-28 Q 개정): 내용과 담당(민트)·기한(블루) 뱃지가
   **왼쪽에 한 묶음으로 붙고**, 출처 회차 버튼만 오른쪽 끝으로 떨어진다. 구 "내용이 남는
   폭을 갖고 뱃지를 끝으로 민다"는 뱃지가 버튼 옆에 붙어 크기가 안 맞은 한 쌍처럼 읽혔다
   (Q "버튼과 뱃지가 나란히 있어서 교정이 안 된 것처럼"). 내용은 자라지 않고(flex:0 1 auto)
   뱃지가 그 뒤에 서며, 버튼은 margin-left:auto 로 밀려 뱃지와 갈린다. */
.briefing-action-rows{display:grid;gap:var(--space-4);margin:0;padding:0;list-style:none}
.briefing-action-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;min-width:0}
.briefing-action-desc{flex:0 1 auto;min-width:0;font-size:var(--text-sm);line-height:normal;color:var(--ink);overflow-wrap:anywhere}
.briefing-action-row .wire-badge{flex:none;white-space:nowrap}
.briefing-action-source{flex:none;margin-left:auto}
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
.record-list{container-type:inline-size;display:grid;gap:var(--space-4);min-width:0}
.record-list>details{min-width:0}
/* 접힌 줄 = 펼친 카드의 머리. 두 상태가 같은 줄이라 자리가 안 흔들린다. */
.record-summary{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-4) var(--space-6);cursor:pointer;list-style:none}
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
/* 브리핑 회차 줄과 같은 값으로 맞춘다(2026-08-10 CCC-87, 구 16 + 굵기 미선언). 여기는 이미
   --sub 였고 크기만 갈렸다. 굵기를 안 적어 두면 검사가 조합을 확정하지 못한다(§2-1). */
.record-held-at{flex:none;width:136px;white-space:nowrap;font-size:var(--text-sm);font-weight:400;line-height:normal;color:var(--sub);font-variant-numeric:tabular-nums}
/* 유형 칩은 ConsultationTypeBadge가 기본 상담=mint, 인테이크=lavender로 고정한다
   (2026-08-24 CCC-132 후속 개정, 구 lime/amber 대체). 접힌 줄 안에서 줄어들지 않게만 잡는다. */
.record-summary>.wire-badge{flex:none}
/* 핵심 한 줄. 승인 전 폴백(수기 메모 발췌)은 --sub 로 낮춘다(D5). 넘침은 공용
   .wire-fade-clip(마크업에서 함께 단다)이 갖는다 — 브리핑 회차 행과 같은 규칙(2026-08-06 Q). */
.record-one-liner{flex:1;min-width:0;font-size:var(--text-sm);line-height:normal;color:var(--ink)}
.record-one-liner.is-memo{color:var(--sub);font-weight:400}
/* 오른쪽 묶음(리스크 → 수기 → 화살표)의 간격도 줄 간격과 같은 16 이다(2026-08-30 Q
   "여백 균일" — 구 8). 리스크는 수기 왼쪽에 선다(마크업 순서). */
.record-summary-right{flex:none;display:flex;align-items:center;gap:var(--space-4)}
/* 펼친 본문. 머리와 본문 구분선도 카드 아웃라인과 같은 --line 이다(2026-08-30 검수 —
   지시 "가로선 색이 다르면 아웃라인 색으로". 앱에 하나 남았던 --gradient-brand 안쪽
   구분선을 걷어 §5 '회색 풀블리드 구분선'(2026-08-06)과 한 벌이 된다). */
/* 본문 패딩은 카드 본문 24 사방(2026-08-07 여백 통일, 구 20/24 대체 — WireCard 와 같은 값). */
.record-body{border-top:1px solid var(--line);display:grid;gap:var(--space-5);padding:var(--space-6)}
.record-block{display:grid;gap:var(--space-2)}
/* 카드 안 구획 제목은 라벨이다: 14/600 --sub (2026-08-07 타이포 짝 통일, 구 16/600 --ink 대체.
   .wire-card-section>h3 과 같은 레시피 — 본문 16 과 크기가 겹치면 위계가 사라진다). */
/* '기록 오류' 흔적 — 카드 안 상자였던 .note 를 플랫 한 줄로(2026-08-05 · 카드 안 카드 금지). */
.record-error-note{margin:0;font-size:var(--text-sm);color:var(--sub)}
/* 인테이크 회차의 확인·수정 입구(2026-08-08 Q) — 버튼 한 줄, 전역 p 여백을 끈다. */
.record-intake-entry{margin:0}
/* 구획 라벨은 브리핑 영역 ① 과 같은 계약이다(2026-08-06 Q 컬러 규칙): 14/600 + 계열 컬러.
   수기 메모·액션 아이템 = 민트(사람·기록·상태 축), 플래그 = 라벨은 민트를 유지하고 리스크
   레드는 확인된 항목에만 남긴다(D9 — 색은 확인된 리스크 전용). */
.record-block>h3{margin:0;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-block>p{margin:0;font-size:var(--text-sm);color:var(--ink);white-space:pre-wrap}
.record-block ul{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-2)}
.record-block li{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-2);font-size:var(--text-md);color:var(--ink)}
/* 생활 6영역 행의 영역 이름(CCC-11) — 값과 구분되게 라벨로 센다. 배지·메모는 기존 행 계약. */
.record-life-area-name{font-weight:600;color:var(--ink)}
/* '이번 상담의 목표' — GAS 가 있던 자리(D47 §2). 실무자가 정한 것이라 사람 축(민트)이다.
   재료가 없으면 이 블록 자체를 그리지 않는다 — 빈 블록은 뺀 자리를 다시 빈칸으로 만든다. */
.record-session-goal{display:grid;gap:var(--space-1);border-radius:var(--radius-control);background:var(--mint-tint);padding:var(--space-3) var(--space-4)}
.record-session-goal-label{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.record-session-goal p{margin:0;font-size:var(--text-sm);color:var(--ink)}
/* 담당 칩(민트)과 AI 출처 칩(라벤더)도 공용 배지 톤이다(2026-08-07 통합,
   구 .record-owner, .record-ai-source 삭제). */
.record-item-meta{font-size:var(--text-sm);color:var(--sub)}
/* 리스크 레드는 **확인된** 플래그에만(D9·D34). 조회 API 가 확인된 것만 내려보내지만,
   색을 상태에 걸어 두면 나중에 범위가 넓어져도 규율이 깨지지 않는다. */
.record-flag{font-size:var(--text-sm);font-weight:600;color:var(--sub)}
.record-flag[data-confirmed="true"]{color:var(--risk)}
.record-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--space-4);border-top:1px solid var(--line);padding:var(--space-3) var(--space-6);font-size:var(--text-sm);color:var(--sub)}
/* 상담 일정 카드 본문 한 줄(2026-08-30 Q "본문 14"): 긴 읽는 본문 14/400 --ink(§1 ⑥ 재사용).
   전역 p 위 여백 8 을 꺼 가로선(24)·카드 바닥(24)과 위아래가 같아진다. */
.record-schedule-note{margin:0;font-size:var(--text-sm);font-weight:400;line-height:var(--leading-normal);color:var(--ink)}
/* '이 회차에서 나온 것'(D73)은 항목 하나가 낱개 카드다(2026-08-30 Q "이 파트도 div화" —
   상자는 공용 .wire-repeat-card 가 갖는다. 마크업이 li 에 단다). 항목 머리는 세로 쌓임
   대신 가로로 편다(같은 Q "가로로 넓게, 아래로 늘어뜨리지 말 것") — 제목·설명·배지·행동이
   한 줄에서 흐르고 좁으면 줄바꿈한다. 글자 계약(크기·굵기·색)은 WireItem 그대로다. */
.record-body .briefing-suggestions .wire-item{display:flex;flex-wrap:wrap;align-items:center;column-gap:var(--space-4);row-gap:var(--space-1)}
.record-body .briefing-suggestions .wire-item-action{margin-left:auto}
/* 전체 목표 한 줄 — 브리핑과 같은 어휘이되 이 화면은 읽기 전용이다(입력칸·저장 버튼 없음). */
/* 전체 목표 — 카드 모양은 WireCard 가 갖고(2026-08-05 컴포넌트화), 여기는 안쪽 한 줄 배치만. */
.record-goal-row{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap}
/* 전체 목표 라벨도 민트 deep 이다 — 목표 라벨은 화면 어디서나 같은 민트다(2026-08-29 Q,
   §4. goal-tree-label 과 같은 계약. 구 14/600 --sub). 값(record-goal-text)은 --ink 그대로. */
.record-goal-label{flex:none;font-size:var(--text-sm);font-weight:600;color:var(--mint-deep)}
.record-goal-text{flex:1;min-width:0;margin:0;font-size:var(--text-sm);font-weight:400;color:var(--ink)}
.record-goal-text.is-empty{font-weight:400;color:var(--sub)}
/* 섹션 제목(h2). 2026-08-28 부터 흰 패널 카드(.record-section) 안에 서므로 자기 좌우 패딩을
   갖지 않는다 — 패널 패딩 24 가 시작선을 정해 다른 카드 제목과 좌측이 맞는다. */
.record-section-title{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin:0;font-size:var(--text-lg);font-weight:600;color:var(--ink)}
/* 섹션 제목 + 그 아래 카드 = 한 흰 패널 카드(2026-08-28 Q "A안 + 배경 화이트"). 다른 카드와
   같은 흰 면·--line 테두리·radius 12·패딩 24 라 HERO·전체목표 카드와 한 표면 어휘로 선다.
   제목은 자기 padding-inline 을 버리고(위) 패널 패딩에 기대어 다른 h2 제목과 좌측이 맞는다.
   **카드 안 카드 예외**: 안쪽 회차·브리핑 카드가 이 패널 안에 들어 §5 '카드 안 카드 금지'의
   예외다(Q 승인). 제목-내용 간격 16 은 grid gap, 섹션 사이는 페이지 스택 32 가 가른다. */
.record-section{display:grid;gap:var(--space-4);min-width:0;padding:var(--space-6);border:1px solid var(--line);border-radius:var(--radius-card);background:var(--panel)}
/* 카드 본문 문단은 14 다(2026-08-28 Q — 카드 안 카드로 폭이 좁아져 긴 본문은 14 가 읽기 낫다.
   회차 본문의 수기 메모·세션 목표·담당 의견 등. 짧은 값·제목·폼 안내 문단은 §1 그대로 16). */
.record-body p{font-size:var(--text-sm)}
@container (max-width:600px){
  .record-summary{flex-wrap:wrap}
  .record-one-liner.wire-fade-clip{display:-webkit-box;flex:1 0 100%;order:5;max-width:100%;overflow:hidden;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2;-webkit-mask-image:none;mask-image:none}
  .record-summary-right{margin-left:auto}
}
@media (max-width:767px){
  /* 좁으면 한 줄이 무너지므로 핵심 한 줄을 아래로 내린다(리스트 행 계약과 같은 접힘).
     내려간 줄은 전문을 접어 보여주므로 페이드 마스크도 함께 끈다. */
  .record-summary{flex-wrap:wrap}
  /* 두 클래스 선택자 — 공용 .wire-fade-clip(한 클래스)보다 구체적이어야 마스크가 꺼진다. */
  .record-one-liner.wire-fade-clip{display:-webkit-box;flex:1 0 100%;order:5;max-width:100%;overflow:hidden;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2;-webkit-mask-image:none;mask-image:none}
  /* 브리핑 회차 행도 같은 접힘 — 고정 칸(136+84+48)이 좁은 화면 폭을 다 먹는다(9차). */
  .briefing-session-row{flex-wrap:wrap}
  .briefing-session-memo:empty{display:none}
  .briefing-session-text.wire-fade-clip{flex-basis:100%;white-space:normal;overflow:visible;-webkit-mask-image:none;mask-image:none}
  /* 활성 세부 목표 줄(D62 §8 · CCC-69)도 좁은 화면에서는 줄바꿈으로 전환한다(말줄임 규칙). */
  .briefing-subgoal-row.wire-fade-clip{white-space:normal;overflow:visible;-webkit-mask-image:none;mask-image:none}
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
/* 페이지 스택 간격은 spacing v2의 --section-gap 32를 따른다. */
.settings-page{display:grid;gap:var(--section-gap)}
/* 설정 구획은 카드다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59 플랫 대체). 카드 모양·제목
   구분선은 WireCard 가 갖고, .settings-section 은 훅으로만 남는다. */
.settings-account{display:grid;gap:var(--space-4);margin:0}
/* CCC-44 AI 사업자 상태 행 — 배지와 값이 한 줄로 나란히, 넘치면 다음 줄(css만, 값은 그대로). */
.settings-value-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:var(--space-2)}
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
/* 관리자 진입 링크 버튼도 1fr 칸에서 스트레치되지 않는다 — 버튼은 내용 폭이 계약이다
   (2026-08-29 결함 ⑥. register-form Y6 "풀폭 버튼 예외 되돌리기"와 같은 결론). */
.settings-user-row>.wire-button{justify-self:start}
.settings-user-row[data-active="false"]{opacity:.6}
@media(max-width:767px){.settings-user-row{grid-template-columns:1fr;gap:var(--space-1)}.settings-user-role{justify-self:start}}
`;

const scheduleStyles = `
/* 일정은 날짜 → 카드 두 층이다(CCC-133). 세 뷰 모두 일정이 있는 날짜만
   시간순으로 그리고, 기간 이름은 본문이 아니라 내비가 갖는다. */
.schedule-day-list{display:grid;gap:var(--section-gap)}
/* 구 오늘·미래 플랫 구획(.schedule-section + 18 제목 축소 규칙)은 2026-08-28 Q 로 폐지 —
   세 상태 모두 날짜 묶음 카드(WireCardDetails) 하나를 쓴다. */
/* 날짜 묶음 제목 옆 건수 — 16/400 --ink(③ 본문, 2026-08-29 Q "16px로". 구 14/400 --sub ④ —
   16px 에는 --sub 조합이 §1 표에 없어 본문 단으로 올린다). 제목 flex 의 gap 이 간격을 만든다. */
.schedule-day-count{font-size:var(--text-md);font-weight:400;line-height:var(--leading-normal);color:var(--ink)}
/* 일정 업무 바. 양쪽 1fr 이 가운데 기간 묶음을 페이지 정중앙에 고정한다. 왼쪽은
   [오늘]+보기 선택창, 오른쪽은 등록 행동 둘이고 전부 32 높이다. */
.schedule-nav{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:var(--space-3)}
.schedule-nav-controls,.schedule-nav-actions{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.schedule-nav-actions{justify-content:flex-end}
.schedule-nav-period{display:grid;grid-template-columns:var(--pill-height) auto var(--pill-height);align-items:center;gap:var(--space-3)}
/* 이전·다음은 공용 원형 아이콘 버튼이다. 32px 면과 포커스 링은 header-icon-button이
   갖고, 여기서는 일정 글자에 맞춘 glyph 굵기와 고정 크기만 잠근다. */
.schedule-nav-step{width:var(--pill-height);height:var(--pill-height);font-size:var(--text-md);font-weight:600;line-height:normal}
/* [오늘] 바로 옆의 보기 선택창. 글자와 꺽쇠가 들어갈 최소 폭만 남긴다. */
.schedule-nav .schedule-view-select{width:84px;flex:0 0 84px;min-height:var(--pill-height);padding-left:var(--space-2);padding-right:var(--space-1)}
.schedule-nav .schedule-view-select select{padding-right:var(--space-4)}
.schedule-nav .schedule-view-select .wire-chevron{right:var(--space-2)}
/* 일정 카드 전용 고정 2열. 일반 .card-grid 의 auto-fit 계약은 유지하고 이 화면만 승인된
   빈 트랙을 남긴다. 767px 이하는 승인대로 한 열이다. */
.card-grid.schedule-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.schedule-card-grid>.participant-card-link>.participant-card{height:100%}
.schedule-card-grid .participant-card[data-muted="true"]{opacity:.56}
/* 접힌 날짜 줄은 이름만 남는 중립 아코디언이다. 펼침은 조회일 뿐 선택이 아니므로
   두 줄 모두 WireCardDetails 의 활성 그라데이션을 쓰지 않는다(wire-styles 의
   :not() 목록이 둘을 함께 뺀다). 흐림은 지난 줄에만 걸고 오늘과 미래 줄에는 걸지 않는다. */
.schedule-past-day{--surface-fill:var(--muted);opacity:1}
/* 기간 이름은 누를 수 없는 14/500 읽는 값이다. 세 뷰 모두 자기 글자 폭만 차지하므로
   일간·주간·월간의 서로 다른 길이에서도 원형 버튼과 보이는 글자 사이가 12px로 같다. */
.schedule-period-label{display:inline-flex;align-items:center;justify-content:center;width:max-content;min-width:0;height:var(--pill-height);padding:0;font-size:var(--text-sm);font-weight:500;line-height:var(--leading-normal);letter-spacing:0;color:var(--ink);white-space:nowrap}
.schedule-day-summary-title{display:flex;align-items:baseline;justify-content:flex-start;gap:var(--space-3);min-width:0;text-align:left}
.schedule-day-names{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md);font-weight:400;line-height:var(--leading-normal);color:var(--ink)}
/* 셸 사이드바가 남는 768px 경계에서는 viewport 가 아니라 실제 본문 폭이 좁다. 페이지
   컨테이너를 기준으로 세 줄 툴바로 전환해 가운데 기간과 양쪽 행동이 겹치지 않게 한다. */
@container (max-width:760px){
  .schedule-nav{grid-template-columns:minmax(0,1fr);justify-items:center}
  .schedule-nav-controls{justify-content:center;flex-wrap:wrap}
  .schedule-nav-period{grid-template-columns:var(--pill-height) auto var(--pill-height);min-width:0}
  .schedule-nav-actions{width:auto;justify-content:center;flex-wrap:wrap}
  .schedule-nav-actions>.wire-button{flex:none}
}
@media(max-width:767px){
  /* 날짜 범위는 잘리면 무의미하므로 말줄임표를 쓰지 않는다. 좁은 폭에서는 잘라 버리는
     대신 두 줄로 풀어 전문을 보여 주고, 그 폭에서만 높이 고정을 풀어 둔다. 날짜를 숨기는
     것보다 줄이 늘어나는 편이 낫다. 글자는 건드리지 않는다 - 데스크톱과 같은 §1 ⑤ 기간 값 단
     (14/500 --ink)을 그대로 물려받아 세 뷰와 두 폭이 한 계약을 쓴다. */
  .schedule-period-label{width:max-content;max-width:100%;min-width:0;height:auto;min-height:var(--pill-height);white-space:normal;text-align:center;text-wrap:balance}
  .briefing-goal-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}
  .briefing-goal-row>.goal-tree-label{grid-column:1/-1}
  .briefing-goal-display,.briefing-goal-text{min-width:0;width:100%}
  .briefing-goal-form{grid-column:1/-1;min-width:0;width:100%}
  .card-grid.schedule-card-grid{grid-template-columns:minmax(0,1fr)}
  .schedule-day-summary-title{align-items:flex-start;flex-direction:column;gap:var(--space-1)}
}
/* ticket-20: 상담 등록 */
/* 당사자 선택 행(2026-08-07 Q "텍스트 weight 수정") — 행 기본 400, 이름만 600.
   당사자 카드의 굵기 계약(이름만 강조)을 위저드 행에도 잇는다.
   .wire-row 를 겹쳐 쓰는 이유: 버튼 행은 button.wire-row(0-1-1)가 600 을 다시 얹으므로
   클래스 둘(0-2-0)로 이긴다. */
.wire-row.schedule-candidate-row{font-weight:400;padding-block:var(--space-5)}
.schedule-candidate-name{font-weight:600}
/* 가명 ID 는 다른 당사자 카드·HERO 와 같은 조각이다 — 후보 행도 전용 클래스가 아니라
   공용 .participant-card-id 를 그대로 입어(회색 14/400 --sub, 2026-08-30 Q "카드 ID 14")
   화면 간 통일감을 준다(2026-08-28 Q "ID 가 다른 데와 달리 컬러 처리됨 → 당사자 카드
   디자인 통일"). 구 2026-08-09 "아이디 컬러처리"(전용 .schedule-candidate-id mint-deep
   14/600)를 대체.
   MetaRow 의 각 조각은 제 wrapper span 안에 들어 .participant-card-id 의 flex 는 inert 다.
   고른 행(그라데이션 면)에서만 다른 글자처럼 --on-action 으로 넘어간다. */
.wire-row[data-selected="true"] .participant-card-id{color:var(--on-action)}
/* 후보 정보는 카드끼리 같은 세로선에 선다(2026-08-29 Q "텍스트 위치 고정·세로 정렬") —
   이름 묶음·연락처 열은 고정폭이라 어느 카드에서나 같은 x 에서 시작하고, 이메일이 남은
   폭을 쓴다. 이름·이메일은 길면 말줄임(…)이다. 빈 조각은 그리지 않되 연락처·이메일이
   자기 열 번호를 갖고 있어 앞 조각이 없어도 열이 밀리지 않는다.
   .wire-meta-row 를 그대로 입어 세로 구분선과 선택·호버 선색 계약을 재사용한다. */
.schedule-candidate-select>.wire-meta-row{display:grid;flex:1 1 auto;grid-template-columns:240px 150px minmax(0,1fr);align-items:baseline;min-width:0}
.schedule-candidate-name-cell{display:flex;align-items:baseline;gap:var(--space-2);min-width:0}
.schedule-candidate-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.schedule-candidate-name-cell>.participant-card-id{flex:none}
.schedule-candidate-select>.wire-meta-row>.schedule-candidate-phone{grid-column:2;white-space:nowrap}
.schedule-candidate-select>.wire-meta-row>.schedule-candidate-email{grid-column:3;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 후보 목록(2026-08-09 인라인 정리) — 낱개 카드 스택이라 여백 3단 ③(행 스택 16)이다(§3-4). */
.schedule-candidate-list{display:grid;gap:var(--space-4)}
/* 한 후보 = 카드 한 장이 장폭을 다 쓰고, '당사자 정보' 버튼도 카드 안 오른쪽 끝이다
   (2026-08-09 Q — 구 행 밖 형제 버튼 대체). 카드 자체는 .wire-row 계약(72 높이·패딩)을
   그대로 입되 div 라, 고르기는 안쪽 flex:1 버튼이 갖는다 — 버튼 속 버튼을 만들지 않으면서
   행 면적 대부분이 '고르기'로 남는다. 안쪽 버튼은 행 글자 계약을 그대로 상속한다. */
.schedule-candidate-item{cursor:default}
.schedule-candidate-select{flex:1 1 auto;min-width:0;align-self:stretch;display:flex;align-items:center;margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;overflow-wrap:anywhere}
.schedule-candidate-item>.wire-button{flex:none}
@media (max-width: 767px){
  /* 좁은 화면에서는 버튼이 이름 묶음 아래로 내려간다(§5 모바일 규칙과 같은 처리). */
  .schedule-candidate-item{flex-wrap:wrap}
}
/* 열 정렬 격자는 화면 폭이 아니라 **본문 폭**으로 접는다(검수 실측: 768~900 viewport 는
   데스크톱 셸이지만 본문이 좁아 고정 3열이 이메일을 13px 로 눌렀다). schedule-nav 와 같은
   컨테이너 질의 760 — 본문이 좁으면 한 열로 접고 세로 구분선을 걷는다(허브 HERO 메타와
   같은 처리). */
@container (max-width:760px){
  .schedule-candidate-select>.wire-meta-row{grid-template-columns:minmax(0,1fr)}
  .schedule-candidate-select>.wire-meta-row>.schedule-candidate-phone,
  .schedule-candidate-select>.wire-meta-row>.schedule-candidate-email{grid-column:auto}
  .schedule-candidate-select>.wire-meta-row>span+span{border-left:0;padding-left:0}
}
/* 상담 유형 칸 = 선택창 하나 + (조건부) 경고 안내줄(2026-08-09 Q). 값·이름·접힘 세 클래스는
   함께 지웠다 — 값을 보여 주는 자리와 고치는 자리가 하나로 합쳐지면서 쓸 곳이 없어졌다. */
.schedule-kind{display:grid;gap:var(--space-3)}
/* 목표 패널(2026-08-28 Q item ③): '이번 상담의 목표는 무엇인가요?' 물음과 하위목표·지난
   브리핑·세부 목표 연결·세션 목표를 한 묶음으로 감싼다. hero 카드와 물음 사이 가로선(구
   .wizard-section-head border-top)을 없앤 자리다 — 카드가 아니라 제목+묶음만 갖는 플랫 div
   라 안의 WireCard 가 카드 속 카드가 되지 않는다. 세로 간격은 목록 스택 20 이고, hero 와의
   경계는 가로선 대신 위 여백 32(스택 20 + margin 12, 구 section-head 실효값)로 낸다. */
.wizard-goal-panel{display:grid;gap:var(--space-5);margin-top:var(--space-3)}
/* 목표·질문 입력 묶음(2026-08-09 Q 3차): 한 항목 = **연결 쌍 위, 세션 목표 쌍 아래**의
   세로 스택이고 폭 상한 없이 장폭을 다 쓴다(구 .wizard-row 720 · .wizard-form 520 상한
   대체). 여백 리듬: 쌍 안 라벨↔칸 8(입력칸 계약과 동일) · 쌍 사이 16 · 항목 사이 20. */
.session-goal-list{display:grid;gap:var(--space-5)}
.session-goal-entry{display:grid;gap:var(--space-4)}
.session-goal-entry>.session-goal-link{max-width:320px}
.session-goal-field{display:grid;gap:var(--space-2)}
/* 라벨 둘은 참고 카드 제목과 같은 16/600 --ink 다(Q "세부 목표 = 지난 상담 브리핑 =
   세션 목표 1 = 세부 목표 연결 폰트 크기 동일"). */
.session-goal-entry .wire-form-label{font-size:var(--text-md);color:var(--ink)}
.session-goal-label{font-size:var(--text-md);font-weight:600;line-height:var(--leading-snug);color:var(--ink)}
/* 연결 선택창은 아코디언 활성과 같은 그라데이션 아웃라인을 입는다(Q "아코디언 그라데이션
   스타일" — D60 ④ 선택·활성 어휘. 기본 펼침 채움 제외 명단과 같은 이유로 채움이 아니라
   아웃라인이다. 초점 링은 outline 이라 배경 2겹과 충돌하지 않는다). */
.session-goal-link .wire-input-box{border-color:transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--gradient-brand) border-box}
/* 입력 줄: 입력칸이 남은 폭을 다 쓰고 +·- 는 오른쪽 끝 세로, **+ 가 위 - 가 아래**로
   입력칸 위쪽에 맞춘다(Q 3차 — 구 바닥 정렬·- 위 대체). DOM 은 공용 부품 순서(- 먼저,
   + 나중) 그대로 두고 column-reverse 로 뒤집는다 — 공용 부품의 가로 배치(다른 화면)를
   건드리지 않는다. 반전축에서는 기본 justify-content:flex-end 가 위쪽 팩킹이 된다. */
.session-goal-input{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-3);align-items:start}
.session-goal-input>.wire-repeat-actions{flex-direction:column-reverse}
@media (max-width: 767px){
  /* 한 열에서는 +·- 가 가로로 돌아간다 — 순서는 그대로 + 먼저다(row-reverse + 반전축
     flex-end = 오른쪽 팩킹). */
  .session-goal-input{grid-template-columns:minmax(0,1fr)}
  .session-goal-input>.wire-repeat-actions{flex-direction:row-reverse;justify-content:flex-start}
}
/* 지난 상담 브리핑 불릿 — 출처 배지 + 본문이 한 문장으로 흐르고 긴 글은 줄바꿈으로 행이 는다. */
.schedule-briefing-item .wire-badge{margin-right:var(--space-1)}
/* (.schedule-form 카드 표면은 2026-08-09 삭제 — 마지막 사용처였던 미리보기 게이트가 전용
   .preview-gate-card 로 바뀌었다. -hint·-notice 는 등록·가입 화면이 계속 쓴다.) */
/* 안내 문구는 14(--text-sm)다 — 2026-08-09 Q 지시(구 12 --text-xs 대체). 입력칸에 붙는
   .wire-form-hint 도 2026-08-10 Q 지시로 14 가 되면서 두 도움말 크기가 같아졌고, 2026-08-07
   '도움말 12 전역 통일'은 완전히 걷혔다.
   이 클래스는 입력칸 아래 한 줄 도움말이 아니라 **구획 머리에 서는 안내 문단**이라 ④ 설명·메타
   단(14/400 --sub)으로 올라간다.
   위아래 여백 8 은 '마지막 기록' 줄(.participant-program-consent-meta)의 위 여백과 같은 값이다
   (2026-08-09 Q). 부모 격자의 gap 12 와 합쳐 렌더 여백이 20 으로 맞는다 — 실측으로 확인한
   '마지막 기록' 위 여백도 20 이다. 묶음의 첫 줄일 때는 위 여백을 걷는다: 그 자리는 카드
   구분선 아래 24(카드 계약)라 8 을 더하면 32 로 튄다. */
.schedule-form-hint{margin:var(--space-2) 0;max-width:72ch;color:var(--sub);font-size:var(--text-sm);text-wrap:pretty}
.schedule-form-hint:first-child{margin-top:0}
/* 성공색은 이 시스템에 없다(D6·R4). 완료 알림은 중립 잉크 + 문구로 알린다. */
.schedule-form-notice{color:var(--ink);font-weight:600}
/* 동의 묶음은 카드 안 상자였다 — D59 '카드 안 카드 금지'로 플랫: 위 구분선 하나 + 여백. */
.consent-fieldset{display:grid;gap:var(--space-3);min-width:0;max-width:100%;margin:0;padding:var(--space-3) 0 0;border:0;border-top:1px solid var(--line);border-radius:0}
/* legend 는 구획 타이틀 위계다(2026-08-07 Q — 구 14/600 --sub 라벨 대체): 소제목 16/600
   --ink(D61 ③ 짝 계약), 좌측정렬. float 는 legend 의 특수 렌더링(테두리 선 위에 띄우고
   들여쓰는 것)을 끄는 표준 장치다 — float 가 none 이 아니면 legend 는 일반 자식으로
   내려와 그리드 첫 행에 왼쪽 정렬로 선다(구 6px 들여쓰기 패딩도 함께 걷는다). */
.consent-fieldset legend{float:left;padding:0;font-weight:600;font-size:var(--text-md);color:var(--ink)}
.consent-checkbox{display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-md);font-weight:600}
/* 케이스 종결 화면(CCC-107): 폼·요약의 세로 스택. 행 문법은 briefing-action-rows 재사용. */
.close-case-stack{display:grid;gap:var(--space-4)}
/* 체크박스 모양은 .wire-checkbox 하나가 소유한다(§5). 여기서 다시 스타일하면 선택자가 더 구체적이라
   리스크 변형(테두리만 --risk)을 덮어써 버린다 — 실제로 그 버그를 겪어 규칙을 한 곳으로 모았다. */
.consent-checkbox input[type="checkbox"]:not(.wire-checkbox){width:18px;height:18px}
/* G1: 긴급 등록(① 동의 하드 게이트의 예외). 예외 경로라 동의 3종과 가는 선 하나로 가르되,
   확인된 리스크가 아니므로 리스크 레드는 쓰지 않는다(D9 — 리스크 색 독점). */
.consent-emergency{display:grid;gap:var(--space-3);padding-top:var(--space-3);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
.consent-emergency textarea{min-height:88px}
`;


const registerStyles = `
/* 미리보기 코드 게이트(2026-08-09 Q "컴포넌트 가운데 정렬로 전면 수정") — 셸 없는 공개
   화면이라 로그인 게이트 문법이다: 화면 세로·가로 중앙, 제목·설명·오류·카드가 전부 가운데
   축에 선다. 카드 폭은 400(입력 한 칸짜리 폼 — 장폭 카드는 빈 판으로 읽힌다), 카드 안은
   입력 축이라 왼쪽 정렬을 유지하고 입장 버튼만 전폭이다. */
.preview-gate{min-height:100dvh;align-content:center;justify-items:center;text-align:center}
.preview-gate-head{display:grid;gap:var(--space-2);justify-items:center}
.preview-gate-head>h1{margin:0}
.preview-gate-head>p{margin:0;font-size:var(--text-sm);font-weight:400;color:var(--sub)}
.preview-gate-card{width:min(400px,100%);display:grid;gap:var(--space-5);padding:var(--space-6);text-align:left}
.preview-gate-card .preview-gate-submit{width:100%;justify-content:center}
/* 당사자 등록·초대 (#37) */
.wire-register-form{display:grid;gap:var(--space-6);margin-top:var(--space-8)}
.wire-register-submit{width:100%}
/* margin-top 을 두지 않는다 — 바깥에서는 .wire-container 의 gap(--section-gap)이 이미
   섹션 간격을 주고, 카드 안에서는 그 여백이 제목 구분선 아래에 빈 띠로 남는다. */
.wire-invite-stack{display:grid;gap:var(--space-6)}
.wire-invite-section{display:grid;gap:var(--space-3)}
/* 왼쪽 정렬이다 — 가운데 정렬은 아래 입력칸 축에서 떨어져 나와 페이지마다 글이 다른 데서
   시작하는 것처럼 보인다(§5 '페이지 제목'이 가운데 정렬을 폐기한 것과 같은 이유). */
.wire-invite-caption{margin:0;font-size:var(--text-md);color:var(--ink)}
/* 낭독·전달용 화면이라 라벨·힌트를 16 진한색으로 올린다(2026-08-28 Q — §1 예외: 라벨
   ① 16/600 --ink, 힌트 ③ 16/400 --ink. 당사자에게 링크·QR·문안을 보여 주며 읽는 자리다). */
.wire-invite-stack .wire-form-label{font-size:var(--text-md);color:var(--ink)}
.wire-invite-stack .wire-form-hint{font-size:var(--text-md);color:var(--ink)}
/* CCC-29: QR 은 입력칸이 아니라 카드 계약(--line 1px · radius 12)을 빌린 정사각 패널이다. */
.wire-invite-qr{display:inline-flex;justify-self:start;padding:var(--space-4);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-card)}
/* 버튼은 내용만큼만 차지한다 — 그리드 아이템 기본 stretch 를 그대로 두면 카드 폭(880)을
   가로지르는 알약이 되어, 폼 제출도 아닌 행동이 마케팅 배너처럼 읽힌다. */
.wire-invite-stack .wire-button{justify-self:start}
/* D15·D23: 동의 문안 "자세히 읽어보기"·"전문 보기" — briefing-subaccordion 패턴 재사용.
   등록 폼(자세히 읽어보기)과 동의 수정 허브(항목별 전문 보기, 2026-08-07 Q)가 같은 부품이다. */
.consent-detail{padding-top:var(--space-2);background:linear-gradient(var(--line),var(--line)) top/100% 1px no-repeat}
/* 동의 항목 한 줄 = 체크 라벨 + '전문 보기' 알약이고, 펼친 전문만 그 아래 줄을 통째로
   쓴다(2026-08-08 Q "우측에 나란히 가운데 정렬"). 구 배치는 알약이 라벨 아래로 떨어져
   항목 하나가 두 줄을 먹었다.
   알약은 격자가 아니라 자기 width:max-content 가 폭을 정하므로 1fr 칸에서 늘어나지 않고
   라벨 바로 옆에 붙는다. 세로 가운데는 align-items 다. */
.consent-item{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:var(--space-3)}
/* details 는 상자를 버리고 자식을 그대로 격자에 내놓는다. 그래야 summary(알약)는 라벨과
   같은 줄에, 본문은 아래 줄에 설 수 있다. summary 를 details 밖으로 꺼낼 수는 없다. */
.consent-detail[data-inline="true"]{display:contents}
/* 펼친 전문은 두 칸을 다 쓴다. 규칙이 둘인 이유: 요즘 브라우저는 details 의 비-summary
   자식을 ::details-content 상자로 감싸므로 **그 상자**가 격자 항목이고, 그 상자가 없는
   브라우저에서는 본문 자신이 격자 항목이다. 둘 다 적어야 어느 쪽에서든 전폭이 된다. */
.consent-detail[data-inline="true"]::details-content{grid-column:1/-1}
.consent-detail[data-inline="true"]>.consent-detail-body{grid-column:1/-1}
/* 화살표는 텍스트 바로 옆이다(2026-08-07 Q 9차 — 구 space-between 은 화살표가 오른쪽
   끝으로 떨어져 라벨과 남남으로 읽혔다). */
.consent-detail-summary{display:flex;justify-content:flex-start;align-items:center;gap:var(--space-3);padding:var(--space-1-5) 0;font-size:var(--text-sm);font-weight:600;color:var(--ink);cursor:pointer;list-style:none}
.consent-detail-summary::-webkit-details-marker{display:none}
/* 동의 요약 줄의 꺽쇠만 기준 글자를 .7 로 낮춘다(2026-08-08 Q "꺽쇠 크기 더 줄이기").
   전역 배수(--chevron-box)는 16px 글줄에서 잡은 값이라 14px 글줄에서는 글자 대비 여전히
   컸다. 배수를 따로 두지 않고 기준 글자만 줄여, 상자와 획과 광학 보정이 한 비율로 함께
   작아진다(14px 글줄에서 상자 7.9 에서 5.5 로). 등록 폼 '자세히 읽어보기'와 허브
   '전문 보기'는 같은 부품이라 한 선택자가 둘 다 덮는다. */
/* 동의 요약 줄은 배지형 버튼 안이라 원형 컨테이너를 겹치지 않는다(알약 안 알약 금지) —
   꺽쇠 잉크만 남기고 기준 글자 .7em 축소(2026-08-08 Q)는 유지한다. */
.consent-detail-summary>.wire-card-arrow{font-size:.7em;width:auto;height:auto;border:0;border-radius:0;background:none}
/* 인라인 변형의 요약 줄은 **작은 배지형 버튼**이다(2026-08-07 Q 9차 "전문보기를 작은
   뱃지형 버튼으로" — 구 텍스트+화살표 줄 대체). 모양은 기본 배지 레시피(높이 24 ·
   --sub 외곽선 · 알약 · 14/400 --ink)를 그대로 빌리고, 조작이므로 호버 면만 얹는다.
   화살표 크기는 바로 위 규칙이 정한다(기준 글자 .7em). */
.consent-detail[data-inline="true"]>.consent-detail-summary{display:inline-flex;width:max-content;align-items:center;justify-content:flex-start;gap:var(--space-2);min-height:var(--badge-height);padding:0 var(--space-2-5);border:1px solid var(--sub);border-radius:var(--radius-pill);/* consent-detail-summary: 배지형 버튼(pill 허용목록 등재) */font-weight:400;color:var(--ink);line-height:normal}
@media (hover:hover){.consent-detail[data-inline="true"]>.consent-detail-summary:hover{background:var(--muted)}}
/* 열림 방향은 공용 규칙(details[open]>summary .wire-card-arrow = 위 꺽쇠)이 정한다
   (2026-08-27 화살표 어휘 통일, 구 개별 규칙 삭제). */
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
/* 레일은 세로 스택이고 위에 붙는다 — alignContent:start 가 없으면 grid 행들이 본문 길이만큼
   늘어난 컬럼 높이를 균등 분배해 단계 버튼 하나가 500px 넘게 벌어진다(2026-08-09 인라인 정리로
   여기 옮겼다). 단계 사이는 8 — .wizard-stack(20)보다 촘촘한 목록이다. */
.intake-step-nav{display:grid;gap:var(--space-2);align-content:start}
/* 레일 머리: '진행 단계' 제목 옆에 자동 저장 상태가 선다(2026-08-30 Q "자동 저장 대기
   배지를 진행 단계 텍스트 옆으로" — 구 본문 맥락 카드 아래). 제목 왼쪽, 상태 오른쪽 끝. */
.intake-step-nav-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);min-width:0}
.intake-step-nav-head>h2{margin:0}
/* 붙박이는 **두 열일 때만**이다(2026-08-09) — 기준을 .rail-grid 의 폭 계단과 같은 컨테이너
   880 으로 옮겼다. 구 뷰포트 768 기준은 한 열이 된 뒤에도 살아 있어, 상단으로 내려온 레일이
   본문 위에 붙박여 화면을 덮었다. */
@container (min-width: 880px){
  /* align-self·max-height·overflow 가 빠져 있어 **붙박이가 켜진 적이 없었다**(2026-08-10 실측:
     nav 높이 3065px, 내용 231px). 격자 칸은 기본이 stretch 라 레일이 본문 길이만큼 늘어나고,
     그러면 sticky 는 움직일 자리가 없다 — position 만 적혀 있고 아무 일도 안 하는 상태였다.
     구 align-content:start 는 **안쪽 버튼 배치**만 고쳤지 요소 자체 높이는 그대로 뒀다.
     레시피는 상담 기록 레일(.record-side)과 같다 — 두 화면이 같은 레이아웃이어야 한다는 것이
     2026-08-08 Q 지시이고, 그쪽에는 셋이 이미 다 있었다. */
  .intake-step-nav{
    position:sticky;
    top:calc(var(--header-height) + var(--space-6));
    align-self:start;
    max-height:calc(100dvh - var(--header-height) - var(--space-6) * 2);
    overflow-y:auto;
  }
}
/* 인테이크 작성의 레일 폭(2026-08-09 Q 3차 "인테이크 페이지에도 TOC"). 트랙 배치와 폭 계단은
   공용 .rail-grid 가 갖고, 화면은 자기 레일 폭만 정한다. */
.intake-grid{--rail-width:260px}
/* 인테이크 조회의 광폭 2열 — 본문 스택 + 우측 목차. 좁으면 한 열이고 목차는 숨는다. */
.intake-read-grid{display:grid;gap:var(--section-gap);align-items:start}
@container (min-width: 1150px){
  .intake-read-grid{grid-template-columns:minmax(0,1fr) 200px}
}
/* 단계 버튼: 입력칸과 같은 사각 어휘(radius 6 · --line-control 1px)다. 현재 단계는 시간·진행
   축이라 블루 계열(§1-5 배정표) — 채움은 tint, 글자는 deep. */
/* optical: 10/12 는 높이 40 짜리 컨트롤이 아니라 목록 줄이라 컨트롤 패딩(0 12)을 쓸 수 없다.
   두 줄로 접히는 긴 단계 이름까지 담으면서 32 알약보다 촘촘한 값이다. */
.intake-step{display:flex;justify-content:space-between;gap:var(--space-2);padding:10px 12px;border:1px solid var(--line-control);border-radius:var(--radius-control);background:transparent;color:var(--ink);font-size:var(--text-sm);font-weight:600;text-align:left;cursor:pointer}
.intake-step[data-step-state="current"]{background:var(--blue-tint);color:var(--blue-deep)}
/* 완료를 눌러 봤는데 필수가 남은 단계(2026-08-09 Q "좌측 사이드바에도 레드 컬러").
   입력 오류와 같은 어휘다 — 테두리 1.5px --risk + 리스크 틴트 면(§5 입력칸 오류·D9 허용 자리). */
/* optical: 9.5/11.5 는 눈대중이 아니라 **10/12 에서 테두리 0.5px 을 뺀 값**이다. 이 상태만
   테두리가 1.5px 이라 그대로 두면 이 단계만 글자가 0.5px 안으로 밀린다. 위기·안전 카드의
   23.5 와 같은 보정이고, 같은 이유로 레티나(DPR 2) 기준이다 — DPR 1 에서는 브라우저가
   테두리를 1px 로 반올림하므로 0.5px 남는다(정수로 깎으면 레티나에서 1px 어긋난다). */
.intake-step[data-step-state="missing"]{border:1.5px solid var(--risk);background:var(--risk-tint-solid);color:var(--risk);padding:9.5px 11.5px}
.intake-step-count{font-size:var(--text-sm);font-weight:400;color:var(--sub)}
.intake-step[data-step-state="current"] .intake-step-count{color:var(--blue-deep)}
.intake-step[data-step-state="missing"] .intake-step-count{color:var(--risk)}
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
/* 2026-08-08 Q "인테이크랑 같은 레이아웃": 격자는 .wire-container[data-grid] 의 좌 4 / 우 8 이
   대신 잡는다(구 .record-layout 1fr+우측 200px 레일 대체). 좌측 레일(.record-side)은 인테이크
   진행 단계 레일과 같은 sticky 계약이고, 768 미만 한 열에서는 본문 위에 선다. */
.record-main{display:grid;gap:var(--space-6);min-width:0}
/* 레일은 형제 카드 2장 스택이다(CCC-76 — 미해결 액션 아코디언 + 진척도 카드). 간격은
   본문 스택과 같은 24(D60 ③ 페이지 스택) — 좌우 열의 카드 리듬이 같아야 한 화면으로 읽힌다. */
.record-side{display:grid;gap:var(--space-6)}
/* 붙박이·자체 스크롤은 **두 열일 때만**이다(2026-08-09 — 기준을 .rail-grid 폭 계단과 같은
   컨테이너 880 으로 옮겼다. 구 뷰포트 768 기준은 한 열에서도 살아 있어, 상단으로 내려온
   레일이 본문 위에 붙박이고 자기 높이 안에서 또 스크롤했다). */
@container (min-width: 880px){
  /* 레일이 화면보다 길 수 있다(2026-08-09) — sticky 를 유지하려면 레일이 자기 안에서
     스크롤해야 저장 버튼이 손 닿는 곳에 남는다(문서 사이트 목차 레일 문법). */
  .record-side{position:sticky;top:calc(var(--header-height) + var(--space-6));align-self:start;max-height:calc(100dvh - var(--header-height) - var(--space-6) * 2);overflow-y:auto}
}
/* 구획 바로가기 목차(2026-08-09 Q 2차 "TOC 는 우측에, 모바일·태블릿은 안 보여도 돼" —
   구 레일 맨 위 카드 대체). 옷·붙박이·스크롤 여백은 공용 .wire-toc-rail/.wire-toc-list
   (wire-styles — 3차에서 인테이크 두 화면과 공용화)가 갖고, 트랙 배치와 폭 계단은 공용
   .rail-grid 가 갖는다. 화면은 자기 레일 폭만 정한다. */
.record-grid{--rail-width:300px}
/* 구 여닫기 줄(.record-toolbar)은 2026-08-09 삭제 — 전체 여닫기가 HERO 안 작은 버튼으로
   올라가면서(Q 지시) 이 줄에 담을 것이 없어졌다. */
/* 이 패널들은 카드 계약을 마크업의 .surface-card 로 받는다(2026-08-05 컴포넌트화 —
   구 계약 CSS 복사 5줄 삭제). 패딩은 **본문 카드와 같은 24 사방**이다(2026-08-09 —
   구 좁은 보조 패널 16/20 폐지): 그 예외는 레일이 200px 이던 시절 "좌우 24 를 주면 안쪽 글
   폭이 152 로 떨어진다"가 근거였는데, 레일이 격자 4칸(1120 기준 약 360)으로 넓어지면서
   근거가 사라졌다. 예외를 남겨 두면 같은 페이지에서 레일·아코디언만 글자 시작선이 4px
   앞으로 나온다(2026-08-09 하니스 실측: 카드 49 · 아코디언 45 · 위기 44). */
/* 구 상단 고정 헤더(.record-sticky)는 2026-08-08 좌측 레일 이전으로 삭제 — 목표·버튼이
   전부 레일로 갔다. */
/* 레일 카드 3장(2026-08-09 Q — 구 진척도 카드 한 장에서 분리): 이번 상담 목표 · 미해결
   액션 아코디언 · 체크리스트. 제목은 전부 카드 제목 계약(16/600)이라 같은 크기다.
   제목 오른쪽 배지는 flex 로 글줄 베이스라인이 아니라 세로 중앙에 맞춘다(CCC-76). */
.record-rail-title{display:flex;align-items:center;gap:var(--space-2)}
.record-rail-goals{margin:0;padding-left:var(--list-indent);display:grid;gap:var(--space-1);font-size:var(--text-md);font-weight:600;color:var(--ink)}
/* 구 .record-sticky-value·.record-sticky-meta 는 2026-08-09 삭제 — '미연결' 글자 표시는
   빈 상태 부품으로, 지난 상담 메타 줄은 미해결 액션 카드로 바뀌었다(Q 지시. 강조 콜아웃을
   거쳐 CCC-76 으로 레일 형제 아코디언 카드가 됐다 — 카드 안 카드 금지 해소, D59). */
/* 미해결 액션 아코디언 본문의 '자세히 보기'. 카드 본문이 grid 라 링크가 열 폭으로 늘어나는
   것을 막는다 — 알약이 전폭이 되면 버튼이 아니라 막대로 읽힌다. */
.record-open-actions-link{justify-self:start}
/* 나가기·저장은 레일 바닥이다(2026-08-08 Q — 구 고정 헤더 우측 대체). 레일이 sticky 라
   어느 위치에서 쓰든 늘 같은 자리에 있다. §4-5 순서: 세컨더리 → 프라이머리. */
.record-rail-actions{display:flex;flex-wrap:wrap;gap:var(--space-2);padding-top:var(--space-2)}
/* 접힘 칸 4개는 WireCardDetails 다(2026-08-09 — 구 .record-accordion 손 카드 4줄 삭제).
   여기 남는 것은 위기·안전 칸의 리스크 어휘뿐이다.
   **.is-crisis 는 이제 화면 전용 이름이 아니다** — 구 .record-accordion.is-crisis 는 이 화면에만
   있는 클래스와 짝지어 있었지만, 지금은 접힘 카드면 어디서든 걸린다. 리스크 어휘는 배너와
   이 칸의 것이므로(D9) 다른 화면에서 이 이름을 새로 붙이지 않는다. 규칙이 기록지 블록에
   사는 것은 쓰는 자리가 여기뿐이기 때문이다.
   위기 영역은 확인된 리스크와 같은 축이므로 --risk 균일 테두리 + 배경 틴트로 표시한다(D9).
   이 규칙이 wireStyles 보다 **뒤에** 실려야 펼쳤을 때도 빨간 테두리가 산다 — 같은 명시도의
   .surface-card[open] 이 border-color 를 투명으로 돌리기 때문이다(shellStyles 이음 순서).
   optical: 패딩만 23.5 인 이유는 이 카드만 테두리가 1.5px 이기 때문이다. 다른 카드의 글자
   시작선은 1 + 24 = 25 이고, 여기서도 1.5 + 23.5 = 25 로 맞춘다. --card-pad 로 덮으므로
   펼친 제목 줄의 풀블리드도 같은 값을 따라간다. */
.wire-card-details.is-crisis{--surface-fill:var(--risk-tint-solid);--card-pad:calc(var(--space-6) - 0.5px);border:1.5px solid var(--risk);background:var(--risk-tint-solid)}
.wire-card-details.is-crisis>.wire-card-summary,
.wire-card-details.is-crisis>.wire-card-summary>.wire-card-title{color:var(--risk)}
/* 미해결 액션 카드(2026-08-09 Q "액션은 카드화"). 제목 줄이 2행이다 — 내용이 위, 담당·기한
   배지가 아래다(구 legend 괄호 안 한 줄 대체: 배지가 글자 사이에 끼어 어느 쪽이 값인지
   흐렸다). 배지 계열은 §5 계약 그대로다: 담당 = 민트(사람·소속) · 기한 = 블루(일정·시간). */
.open-action-card>.wire-card-title{display:grid;gap:var(--space-2)}
.open-action-title{margin:0;font-size:var(--text-md);font-weight:600;color:var(--ink)}
.open-action-meta{margin:0;display:flex;flex-wrap:wrap;gap:var(--space-2)}
/* 구 .record-rail 손 카드·.record-rail-count 글줄은 2026-08-09 삭제 — 진척도 카드가
   WireCard 2장(이번 상담 목표·체크리스트)으로 갈라지며 카드 계약(패딩·구분선)은 부품이
     갖고, 필수 카운트는 체크리스트 제목 옆 neutral 배지가 됐다(§2-2 규칙 4). */
.record-rail-list{margin:0;padding:0;list-style:none;display:grid;gap:var(--space-1-5);font-size:var(--text-sm);color:var(--sub)}
.record-rail-list li[data-done="true"]{color:var(--ink);font-weight:600}
.record-rail-state{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* 구 컨테이너 질의(643px 레일 해제)는 2026-08-08 격자 이전으로 삭제 — 한 열 접힘은
   .wire-container[data-grid] 의 767 규칙이 대신한다(인테이크와 같은 동작). */
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
  const shellStyles = styles + participantStyles + briefingStyles + settingsStyles + scheduleStyles + wireStyles + registerStyles + recordFormStyles;

  // 공개 경로는 표시 이름을 조회하지 않는다: 사이드바가 없어 값이 쓰이지 않고, 신원 없는
  // 요청으로 부르면 그 조회가 401 을 만든다(위 "사이드바가 신원을 물어 401" 과 같은 이유).
  if (isPublic) {
    // 공개 화면에도 테마는 적용한다 — 셸이 없을 뿐 같은 앱 화면이다(토글은 사이드바에 있으므로
    // 여기서 바꿀 수는 없고, 앞서 켜 둔 값이 그대로 따라온다).
    return <html lang="ko" data-theme={themeAttr}><head><style>{shellStyles}</style></head><body>{children}</body></html>;
  }

  // 기관·사업 표시 이름은 온보딩 저장값 우선(CCC-32) — 실패·미설정이면 헬퍼가 하드코딩 라벨로 폴백한다.
  const labels = await getDisplayLabels();
  // CCC-26 새 가입 미확인 숫자. 조회 실패(아직 셸 밖 접근 등)면 0 — 배지가 안 그려질 뿐 화면은 성립한다.
  const newSignupCount = await getNewSignupCount().catch(() => 0);
  // 본문 열을 div로 한 번 감싼다. 뒤로가기 줄이 본문과 같은 1440 컨테이너와 좌우 32 패딩을
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
          <AppSidebar orgLabel={labels.orgLabel} programLabels={labels.programLabels} theme={theme} newSignupCount={newSignupCount} />
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
