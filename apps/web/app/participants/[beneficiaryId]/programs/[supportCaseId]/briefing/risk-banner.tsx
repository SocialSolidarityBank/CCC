import { MetaRow } from '../../../../../components/wire/meta-row';
import type { FlagType } from '../../../../../lib/api';

// 순수 프레젠테이션 컴포넌트로 분리한다: lib/api 런타임 값을 가져오지 않으므로(`import type`만 사용)
// jsdom 컴포넌트 테스트에서 server-only 로드 없이 렌더할 수 있다.
export type RiskFlagReviewStatus = 'confirmed' | 'pending' | 'rejected';

export interface RiskBannerFlag {
  id: string;
  flagType: FlagType;
  source: 'ai' | 'counselor';
  reviewStatus: RiskFlagReviewStatus;
}

const flagLabels: Record<FlagType, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거·생계 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
};

// 확인된(confirmed) 플래그가 있을 때만 렌더한다. 검토 전 AI 제안은 브리핑에 노출하지 않는다 (D9, R2).
// 접기 UI 없이 항상 펼친 경고 배너로 표시하며, 플래그가 없으면 DOM에 아무것도 남기지 않는다 (D22, 6장).
//
// 신호를 색 하나에 기대지 않는다 — `--risk` 대비가 흰 위 2.72 로 WCAG 아래에 있다(DESIGN.md §9).
// 그래서 배너는 네 가지로 경고를 만든다: ① 경고 아이콘 ② "확인된 리스크 N건" 문구
// ③ HERO 바로 아래 고정 위치 ④ 접힘 불가. 색을 전혀 못 보는 상태에서도 이 배너가
// 무엇인지 알 수 있어야 한다(WCAG 1.4.1).
export function RiskBanner({ flags }: { flags: RiskBannerFlag[] }) {
  const confirmedFlags = flags.filter((flag) => flag.reviewStatus === 'confirmed');
  if (confirmedFlags.length === 0) return null;

  return (
    <aside className="risk-banner" role="alert" aria-label="확인된 리스크 경고">
      <div className="risk-banner-head">
        {/* 단색 라인 아이콘 18px(§3-4). aria-hidden — 옆 문구가 같은 내용을 이미 말한다. */}
        <svg
          className="risk-banner-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9.5v5" />
          <path d="M12 17.5h.01" />
        </svg>
        <p className="risk-banner-title">확인된 리스크 {confirmedFlags.length}건</p>
      </div>
      <ul className="risk-banner-list">
        {confirmedFlags.map((flag) => (
          <li key={flag.id}>
            <MetaRow items={[
              flagLabels[flag.flagType],
              <span key="source" className="panel-meta">{flag.source === 'ai' ? '승인된 AI 제안' : '실무자 기록'}</span>,
            ]} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
