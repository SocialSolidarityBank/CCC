import {
  WireBullets,
  WireButton,
  WireCard,
} from '@ccc/wire';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'CCC 사례관리 소개' };

/**
 * 공개 입구 화면(CCC-109 · 플로우맵 "서비스 소개와 로그인 입구").
 *
 * 인증도 데이터 조회도 없는 **동기** 서버 컴포넌트다 — 이 화면이 신원을 물으면 입구가
 * 로그인 뒤로 숨어 버린다. middleware 가 /welcome 에 x-ccc-public 을 세워 셸(사이드바)
 * 없이 렌더되고, 화면 문법은 같은 셸 없는 공개 화면인 /preview 의 게이트 문법
 * (preview-gate 계열 클래스)을 그대로 빌린다 — 새 색·새 클래스를 만들지 않는다.
 *
 * 카피 근거는 CONTEXT.md '브리핑' 항목이다: 5분은 여는 시점, 15초는 훑는 시간.
 * 여기 적힌 3영역이 곧 브리핑 화면의 실제 구조(D45 · ADR-0018)라 과장이 아니다.
 */
export default function WelcomePage() {
  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>CCC 사례관리</h1>
        <p>
          금전 지원 사업 당사자 상담을 인테이크부터 종결까지 기록하고,
          상담 5분 전 브리핑 한 화면으로 보여주는 내부 도구입니다.
        </p>
      </div>

      <WireCard as="section" title="15초 브리핑" className="preview-gate-card">
        <p>상담 5분 전에 열어 15초 안에 훑는 한 화면에 담기는 것:</p>
        <WireBullets
          items={[
            '오늘 만나기 전 꼭 기억할 것',
            '상담 내용 회차별 정리',
            '내용 불일치: 기록 사이에 어긋나는 서술을 나란히',
          ]}
        />
      </WireCard>

      <WireCard as="section" title="시작하기" className="preview-gate-card">
        <WireButton variant="primary" href="/onboarding" className="preview-gate-submit">
          기관 등록 시작
        </WireButton>
        <WireButton variant="secondary" href="/login" className="preview-gate-submit">
          실무자 로그인
        </WireButton>
        {/* 로그인은 이 앱의 /login 화면에서 이메일·비밀번호로 한다 — 계정은 기관 관리자의
            초대 링크로만 만들어진다. */}
        <p className="note-inline">
          실무자는 기관 관리자가 전달한 초대 링크로 계정을 만든 뒤, 이메일과 비밀번호로
          로그인합니다.
        </p>
      </WireCard>
    </main>
  );
}
