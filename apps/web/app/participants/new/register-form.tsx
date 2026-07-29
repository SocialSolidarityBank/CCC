'use client';

import { useState } from 'react';
import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { PROGRAM_LABELS } from '../../lib/labels';
import { CONSENT_DETAIL_DISCLAIMER, CONSENT_DETAIL_SECTIONS } from './consent-copy';

// 성별 선택값은 정본 질문지 1-1 그대로다(D41). 빈 값은 '미입력' — 금고에 아무것도 쓰지 않는다.
const GENDER_OPTIONS = [
  { value: '', label: '선택 안 함' },
  { value: '여성', label: '여성' },
  { value: '남성', label: '남성' },
  { value: '기타', label: '기타' },
  { value: '무응답', label: '무응답' },
];

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
  /**
   * 참여 사업 표시 이름 — 페이지가 getDisplayLabels() 로 넣는다(온보딩 저장값 우선, CCC-32).
   * 생략하면 labels.ts 폴백 — 단위 테스트가 서버 fetch 없이 렌더할 수 있다.
   * 참여 사업은 v1 하나뿐이고 값 자체는 게이트웨이가 financial_support_v1 로 고정하므로 표시용이다.
   */
  programLabel?: string;
}

/**
 * 당사자 등록 폼(재개편 T7 · #37 · Figma 1:95). 2×2 그리드(이름·이메일·연락처·참여 사업) +
 * 항목별 동의 3종(D23·D44 — 개인정보·녹음·텍스트 AI) + 풀폭 "가입하기".
 *
 * D44: 동의는 **여기서 받고 당사자 정보 페이지에서 고친다**. 인테이크는 읽기만 한다.
 *
 * 저장하는 PII 는 이름·이메일·연락처와 생년월일·주소(거주지역)·성별이다 — 전부 금고에
 * 암호화 저장된다(D3). 인테이크 1단계(1-1 기본정보)는 이 값을 읽어 표시만 하므로,
 * 고치는 자리는 여기 하나뿐이다(D42 ①). 계좌는 여전히 updateParticipantPii 몫이다.
 */
export function RegisterForm({
  currentUser,
  action,
  programLabel = PROGRAM_LABELS.financial_support_v1,
}: RegisterFormProps) {
  // G1: ① 은 필수 체크이고, 긴급 등록을 켜면 그 필수가 사유 입력으로 옮겨 간다.
  // 둘은 **서로 배타**다 — 서버가 "동의가 있는데 긴급 예외까지 왔다"를 거부하므로(예외는
  // 동의가 없을 때만 성립), 화면에서 아예 함께 켜지지 않게 한다. 그러지 않으면 한 번의
  // 클릭으로 원인 없는 실패에 닿는다.
  const [privacy, setPrivacy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const programOptions = [{ value: 'financial_support_v1', label: programLabel }];
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
            options={programOptions}
          />
        </div>
        {/* D41 1-1 · D42 ①: 인테이크 1단계의 기본정보는 여기서만 입력·수정한다. 값은 금고에
            암호화 저장되고(D3), 인테이크 화면은 읽어서 표시만 한다(세션 기록에 PII 미저장, R3). */}
        <div className="wire-col-6">
          <SearchInput label="생년월일" type="date" name="birthDate" placeholder="YYYY-MM-DD" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="주소 또는 거주지역" name="region" placeholder="예: 서울시 은평구" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="성별" variant="select" name="gender" value="" options={GENDER_OPTIONS} />
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
          개인정보 수집·이용 동의는 등록에 반드시 필요하며, 녹음·텍스트 AI 는 미동의여도 등록이 진행됩니다.
        </p>
        {/* G1(2026-07-29 Q 결정1): ① 개인정보 수집·이용 동의는 **등록의 하드 게이트**다.
            체크 없이 제출하면 서버가 privacy_consent_required 로 되돌린다. 급박한 위기
            개입만 아래 '긴급 등록'으로 통과하며, 그때는 사유와 보완 기한이 함께 남는다. */}
        <label className="consent-checkbox">
          <input
            type="checkbox"
            className="wire-checkbox"
            name="consentPrivacy"
            value="on"
            required={!emergency}
            checked={privacy}
            onChange={(event) => {
              setPrivacy(event.currentTarget.checked);
              if (event.currentTarget.checked) setEmergency(false);
            }}
          />
          <span>개인정보 수집·이용 동의 (필수)</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentRecording" value="on" />
          <span>녹음·음성 분석 동의</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentTextAi" value="on" />
          <span>텍스트 AI 정리 동의</span>
        </label>

        {/* G1 예외: 긴급 등록. 동의를 받을 수 없는 급박한 개입에서만 쓰고, 사유가 케이스에
            남으며 보완 기한(기본 14일) 전에 알림이 간다. 예외 경로일 뿐 확인된 리스크가
            아니므로 리스크 레드를 쓰지 않는다(D9 — 리스크 색 독점). */}
        <div className="consent-emergency">
          <label className="consent-checkbox">
            <input
              type="checkbox"
              className="wire-checkbox"
              name="emergencyRegistration"
              value="on"
              checked={emergency}
              onChange={(event) => {
                setEmergency(event.currentTarget.checked);
                if (event.currentTarget.checked) setPrivacy(false);
              }}
            />
            <span>긴급 등록 (동의를 먼저 받을 수 없는 경우)</span>
          </label>
          {emergency ? (
            <label className="field">
              <span>긴급 등록 사유</span>
              <textarea
                name="emergencyReason"
                rows={3}
                maxLength={500}
                required
                placeholder="예: 당사자가 위기 상황이라 서면 동의를 먼저 받을 수 없었음"
              />
            </label>
          ) : null}
          <p className="schedule-form-hint">
            긴급 등록은 사유와 함께 기록되고, 동의 보완 기한(등록일부터 14일)이 생깁니다. 기한 전에 담당 실무자에게 알림이 갑니다.
          </p>
        </div>

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
