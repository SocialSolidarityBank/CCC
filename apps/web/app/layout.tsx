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
import { NextLinkProvider } from './components/wire/next-link-provider';
import { getDisplayLabels } from './lib/display-labels';
import { getNewSignupCount } from './lib/api';
import { THEME_COOKIE_NAME, parseTheme } from './lib/theme-cookie';
import { shellStyles } from '@ccc/wire/shell-styles';

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

  // 공개 경로는 표시 이름을 조회하지 않는다: 사이드바가 없어 값이 쓰이지 않고, 신원 없는
  // 요청으로 부르면 그 조회가 401 을 만든다(위 "사이드바가 신원을 물어 401" 과 같은 이유).
  if (isPublic) {
    // 공개 화면에도 테마는 적용한다 — 셸이 없을 뿐 같은 앱 화면이다(토글은 사이드바에 있으므로
    // 여기서 바꿀 수는 없고, 앞서 켜 둔 값이 그대로 따라온다).
    return (
      <html lang="ko" data-theme={themeAttr}>
        <head><style>{shellStyles}</style></head>
        <body><NextLinkProvider>{children}</NextLinkProvider></body>
      </html>
    );
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
        {/* 링크 어댑터는 셸 전체를 감싼다(2026-09-08). DOM 을 하나도 더 만들지 않고 컨텍스트만
            얹으므로 그리드 구조와 디자인 게이트 계약은 그대로다. */}
        <NextLinkProvider>
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
        </NextLinkProvider>
      </body>
    </html>
  );
}
