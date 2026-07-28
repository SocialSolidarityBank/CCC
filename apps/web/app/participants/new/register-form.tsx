'use client';

import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { PROGRAM_LABELS } from '../../lib/labels';
import { CONSENT_DETAIL_DISCLAIMER, CONSENT_DETAIL_SECTIONS } from './consent-copy';

// 참여 사업은 v1 하나뿐이다(스키마 3층 구조의 템플릿 층 시작점). 선택지가 늘면
// 여기 옵션을 확장한다. 값 자체는 게이트웨이가 financial_support_v1 로 고정하므로 표시용이다.
const PROGRAM_OPTIONS = [{ value: 'financial_support_v1', label: PROGRAM_LABELS.financial_support_v1 }];

export interface RegisterFormProps {
  /**
   * 로그인한 현재 사용자 — 등록자가 곧 담당 실무자다(등록자=담당 실무자, D7). 담당 실무자 지정 select 대신
   * 이 값을 읽기 전용으로 보여준다. 표시는 이름 우선, 미입력이면 이메일로 폴백한다.
   */
  currentUser: { name: string | null; email: string };
  /**
   * 제출 시 실행할 서버 액션(FormData → 등록). 페이지가 주입한다 — 폼을 서버 전용 import
   * (actions.ts → 'server-only')에서 떼어내 단위 테스트에서 렌더 가능하게 한다.
   */
  action: (formData: FormData) => void | Promise<void>;
}

/**
 * 당사자 등록 폼(재개편 T7 · #37 · Figma 1:95). 2×2 그리드(이름·이메일·연락처·참여 사업) +
 * 항목별 동의 2종(D23 — 와이어프레임엔 없지만 확정 사항) + 풀폭 "가입하기".
 *
 * 이번 티켓이 저장하는 PII 는 이메일뿐이다(등록 경로가 enc_email 만 연다, #32). 이름·연락처는
 * 와이어프레임 충실성을 위해 렌더하되 전송·저장하지 않는다 — 채움은 이후 updateParticipantPii.
 */
export function RegisterForm({ currentUser, action }: RegisterFormProps) {
  return (
    <form className="wire-register-form" action={action}>
      <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="당사자 이름" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="이메일" name="email" placeholder="participant@example.com" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" />
        </div>
        <div className="wire-col-6">
          <SearchInput
            label="참여 사업"
            variant="select"
            name="programType"
            value="financial_support_v1"
            options={PROGRAM_OPTIONS}
          />
        </div>
      </div>

      {/* 등록자=담당 실무자(D7): 담당 실무자 지정 select 를 없애고 현재 사용자를 읽기 전용으로 보여준다.
          admin 은 서버 액션이 본인을 배정하고, counselor 는 게이트웨이가 자동 본인 배정한다. */}
      <div className="wire-invite-section">
        <span className="wire-search-label">담당 실무자 {currentUser.name ?? currentUser.email}</span>
        <p className="schedule-form-hint">
          등록한 실무자가 담당 실무자로 자동 배정됩니다. 담당 실무자 변경은 관리자에게 요청하거나 관리자가 배정 화면에서 처리합니다.
        </p>
      </div>

      <fieldset className="consent-fieldset">
        <legend>동의 (항목별, 기본 미동의)</legend>
        <p className="schedule-form-hint">
          동의는 오프라인(종이·구두)으로 받고, 시스템에는 체크·일시·기록자만 남깁니다.
          미동의여도 등록은 진행됩니다.
        </p>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentRecording" value="on" />
          <span>녹음·음성 분석 동의</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentTextAi" value="on" />
          <span>텍스트 AI 정리 동의</span>
        </label>

        {/* 정보 표시 전용 아코디언(기본 접힘) — briefing-cards.tsx의 briefing-subaccordion 패턴을
            그대로 참고한다(요약 + .briefing-card-arrow 회전 화살표). 체크박스 이름·액션·저장
            구조는 건드리지 않는다. */}
        <details className="consent-detail">
          <summary className="consent-detail-summary">
            <span>자세히 읽어보기</span>
            <span aria-hidden="true" className="briefing-card-arrow" />
          </summary>
          <div className="consent-detail-body">
            <p className="consent-detail-disclaimer">{CONSENT_DETAIL_DISCLAIMER}</p>
            {CONSENT_DETAIL_SECTIONS.map((section) => (
              <div className="consent-detail-section" key={section.heading}>
                <h3>{section.heading}</h3>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.items === undefined ? null : (
                  <ul>
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      </fieldset>

      <WireButton type="submit" size="large" chevron className="wire-register-submit">
        가입하기
      </WireButton>
    </form>
  );
}
