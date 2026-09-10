import { WireBullets, WireButton, WireCard, WireCardSection } from '@ccc/wire';

/** 공개 소개 문안. 인증, 업무 API, 기관 생성 없이 렌더한다. */
export function WelcomePage({ loginOrigin = null }: { loginOrigin?: string | null }) {
  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>CCC 사례관리</h1>
        <p>
          금전 지원 사업 당사자 상담을 인테이크부터 종결까지 기록하고,
          상담 5분 전 브리핑 한 화면으로 보여주는 사례관리 도구입니다.
        </p>
      </div>

      <WireCard as="section" labelledBy="briefing-title" title={<h2 id="briefing-title">15초 브리핑</h2>} className="preview-gate-card">
        <p className="wire-section-value">상담 5분 전에 열어 15초 안에 훑는 한 화면에 담기는 것:</p>
        <WireBullets items={[
          '오늘 만나기 전 꼭 기억할 것',
          '상담 내용 회차별 정리',
          '내용 불일치: 기록 사이에 어긋나는 서술을 나란히',
        ]} />
        <p className="report-description">
          수기 메모는 저장하면 공식 기록이 됩니다. AI가 정리한 초안은 실무자가 검토하고 승인한 뒤에만 브리핑에 반영됩니다.
        </p>
      </WireCard>

      <WireCard as="section" labelledBy="start-title" title={<h2 id="start-title">시작하기</h2>} className="preview-gate-card">
        <WireButton variant="primary" href="#adoption" className="preview-gate-submit">
          도입 안내
        </WireButton>
        {loginOrigin !== null ? (
          <>
            <WireButton variant="neutral" href={loginOrigin} className="preview-gate-submit">
              실무자 로그인
            </WireButton>
            <p className="report-description">기관에서 안내받은 업무 클라이언트로 이동합니다. 이 소개 페이지에서는 로그인하지 않습니다.</p>
          </>
        ) : (
          <p className="report-description">
            이 소개 페이지에는 업무 로그인 주소가 연결되지 않았습니다. 이미 사용 중인 실무자는 기관 관리자에게 접속 주소를 확인해 주세요.
          </p>
        )}
      </WireCard>

      <WireCard as="section" labelledBy="adoption" title={<h2 id="adoption">도입 전에 확인할 것</h2>} className="preview-gate-card">
        <WireCardSection title="기관 설치와 초기 설정">
          <p className="wire-section-value">
            기관은 설치 절차에서 만듭니다. 이 페이지에는 기관을 직접 등록하는 폼이 없습니다.
            설치 후 첫 로그인에서 기관 이름, 첫 사업, 동의 문안과 보유기간을 설정하는 흐름입니다.
          </p>
        </WireCardSection>
        <WireCardSection title="저장 위치와 접속 범위">
          <WireBullets items={[
            'Community Cloud는 기관 소유 Supabase 서울 프로젝트를 사용하는 방식입니다.',
            'Local Single은 한 컴퓨터 안에서, Local Office는 기관 내부망에서 접속하는 방식입니다.',
            '도입 전 설치 담당자와 실제 설치 가능 여부, 저장 위치와 접속 범위를 확인해 주세요.',
          ]} />
          <p className="report-description">세 모드의 설계 방향을 안내하는 것이며, 이 페이지가 배포나 설치 검증 완료를 뜻하지는 않습니다.</p>
        </WireCardSection>
        <WireCardSection title="AI 처리와 동의">
          <p className="wire-section-value">
            AI를 사용하려면 기관 안에서 개인정보 가림 처리를 맡을 장비와 필요한 동의를 먼저 확인해야 합니다.
            음성 전사는 설치 직후 꺼져 있으며, 선택 경로의 검증과 승인 전에는 수기 기록을 사용합니다.
          </p>
        </WireCardSection>
        <WireCardSection title="도입 준비">
          <p className="wire-section-value">
            기관에서 설치를 맡을 담당자를 정하고, 사용할 배포 버전의 설치 가이드와 검증 결과를 함께 확인해 주세요.
            당사자 정보나 녹음 파일을 이 공개 페이지로 보내지 마세요.
          </p>
        </WireCardSection>
      </WireCard>
    </main>
  );
}
