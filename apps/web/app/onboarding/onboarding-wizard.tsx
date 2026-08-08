'use client';

import { WireBadge } from '../components/wire/wire-badge';
import { useState } from 'react';
import { SearchInput } from '../components/wire/search-input';
import { WireButton } from '../components/wire/wire-button';

export interface OnboardingWizardProps {
  /**
   * 제출 시 실행할 서버 액션(FormData → 저장). 페이지가 주입한다 — 폼을 서버 전용 import
   * 에서 떼어내 단위 테스트에서 렌더 가능하게 한다(register-form 과 같은 구조).
   */
  action: (formData: FormData) => void | Promise<void>;
  /** 다시 방문하면 저장돼 있던 이름이 미리 채워진다 — 온보딩은 수정 경로 겸용이다. */
  initialOrgName?: string;
  initialProgramName?: string;
}

/**
 * 관리자 온보딩 2단계 위저드 (CCC-32 · 스펙 #78 US 1). 단계마다 질문 하나 —
 * ① 기관 이름 ② 첫 사업 이름. 저장은 마지막 단계의 서버 액션 한 번이고,
 * 그 전까지는 클라이언트 상태만 움직인다(중간 저장 없음).
 *
 * 시각은 새로 정하지 않는다 — 킷 부품(SearchInput·WireButton)과 .surface-card,
 * D34 색·D37 레이아웃 계약을 그대로 쓴다.
 */
export function OnboardingWizard({ action, initialOrgName = '', initialProgramName = '' }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [orgName, setOrgName] = useState(initialOrgName);
  const [programName, setProgramName] = useState(initialProgramName);

  const orgNameReady = orgName.trim().length > 0 && orgName.trim().length <= 80;
  const programNameReady = programName.trim().length > 0 && programName.trim().length <= 120;

  return (
    <form className="onboarding-form" action={action} aria-label="기관 온보딩">
      <article className="surface-card onboarding-card">
        <WireBadge tone="blue" aria-live="polite">{step}단계 / 2단계</WireBadge>
        {step === 1 ? (
          <>
            <h2>기관 이름을 입력하세요</h2>
            <p className="onboarding-help">사이드바와 화면 전체에 이 이름이 표시됩니다.</p>
            <SearchInput
              label="기관 이름"
              name="orgName"
              placeholder="예: 사회연대은행"
              value={orgName}
              onChange={setOrgName}
            />
            <div className="onboarding-actions">
              <WireButton
                type="button"
                variant="primary"
                align="center"
                disabled={!orgNameReady}
                onClick={() => setStep(2)}
              >
                다음
              </WireButton>
            </div>
          </>
        ) : (
          <>
            <h2>첫 사업 이름을 입력하세요</h2>
            <p className="onboarding-help">
              {orgName.trim()}에서 운영할 첫 사업의 표시 이름입니다. 저장하면 사업 전환기와 등록 화면에 보입니다.
            </p>
            {/* 1단계 값은 화면에서 사라져도 폼과 함께 제출돼야 한다. */}
            <input type="hidden" name="orgName" value={orgName} />
            <SearchInput
              label="첫 사업 이름"
              name="programDisplayName"
              placeholder="예: 마이크로크레딧 씬파일러 금융지원·멘토링"
              value={programName}
              onChange={setProgramName}
            />
            <div className="onboarding-actions">
              <WireButton type="button" variant="secondary" align="center" onClick={() => setStep(1)}>
                이전
              </WireButton>
              <WireButton type="submit" variant="primary" align="center" disabled={!programNameReady}>
                저장하고 시작하기
              </WireButton>
            </div>
          </>
        )}
      </article>
    </form>
  );
}
