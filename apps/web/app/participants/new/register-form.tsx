'use client';

import { useState } from 'react';
import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { WireCard } from '../../components/wire/wire-card';
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

/** 필수 칸 라벨. 별표는 `wire-form-required`(--risk)이고 읽어 주지 않는다 — 폼 검증이 실제 강제다. */
function RequiredLabel({ children }: { children: string }) {
  return (
    <>
      {children} <span className="wire-form-required" aria-hidden="true">*</span>
    </>
  );
}

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
   */
  programLabel?: string;
}

/**
 * 당사자 등록 폼(재개편 T7 · #37 · Figma 1:95). 카드 안에 입력 6칸(이름·이메일·연락처·성별·
 * 생년월일·주소) + 항목별 동의 3종(D23·D44 — 개인정보·녹음·텍스트 AI) + "등록하기".
 *
 * D44: 동의는 **여기서 받고 당사자 정보 페이지에서 고친다**. 인테이크는 읽기만 한다.
 *
 * 저장하는 PII 는 이름·이메일·연락처와 생년월일·주소(거주지역)·성별이다 — 전부 금고에
 * 암호화 저장된다(D3). 인테이크 1단계(1-1 기본정보)는 이 값을 읽어 표시만 하므로,
 * 고치는 자리는 여기 하나뿐이다(D42 ①). 계좌는 여전히 updateParticipantPii 몫이다.
 *
 * 2026-07-30 UI 수정 레인 B — 어느 변경이 어디서 왔는지 남긴다:
 * - 훑기 결함(`artifacts/ui-revision-sweep-v1/findings.md`): Y6 카드·콤팩트 버튼 ·
 *   Y7 `등록하기` · Y8 필수 별표 · Y10 동의 블록 시각 언어
 * - 같은 날 Q 요청(훑기 목록 밖): 참여 사업 고정 표시 · 성별을 생년월일 위로 ·
 *   서명 동의서 첨부 자리(기능 없음)
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
  return (
    /* Y6: 등록 화면만 폼이 배경 위에 놓여 다른 화면의 카드 언어와 달랐다. 카드 안으로 넣는다. */
    <WireCard className="register-card">
      <form className="wire-register-form" action={action}>
        {/* 참여 사업은 고를 값이 아니다(2026-07-30 Q) — 초대 시점에 정해지고, 서버도 폼이 보낸
            값을 읽지 않는다(actions.ts 가 financial_support_v1 하드코딩). 그래서 select 를 없애고
            지금 등록하는 사업 하나만 고정 표시한다. 참여 사업이 여럿이어도 이 화면은 이번 것만 말한다.
            민트 계열은 '사람·소속' 축이고 사업 라벨이 그 축에 든다(D34).
            카드 **안** 이름 칸 위다 — 카드 밖에 두면 "화면의 모든 글자는 카드 안에"(D37)를 깬다. */}
        <p className="register-program-fixed">
          <span className="register-program-fixed-label">참여 사업</span>
          <span className="register-program-fixed-value">{programLabel}</span>
        </p>

        <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
          <div className="wire-col-6">
            <SearchInput label={<RequiredLabel>이름</RequiredLabel>} name="name" placeholder="당사자 이름" />
          </div>
          <div className="wire-col-6">
            <SearchInput
              label={<RequiredLabel>이메일</RequiredLabel>}
              name="email"
              placeholder="participant@example.com"
            />
          </div>
          <div className="wire-col-6">
            <SearchInput label={<RequiredLabel>연락처</RequiredLabel>} name="phone" placeholder="010-0000-0000" />
          </div>
          {/* D41 1-1 · D42 ①: 인테이크 1단계의 기본정보는 여기서만 입력·수정한다. 값은 금고에
              암호화 저장되고(D3), 인테이크 화면은 읽어서 표시만 한다(세션 기록에 PII 미저장, R3).
              2026-07-30 Q: 성별이 생년월일 위다. */}
          <div className="wire-col-6">
            <SearchInput label="성별" variant="select" name="gender" value="" options={GENDER_OPTIONS} />
          </div>
          <div className="wire-col-6">
            <SearchInput label="생년월일" type="date" name="birthDate" placeholder="YYYY-MM-DD" />
          </div>
          <div className="wire-col-6">
            <SearchInput label="주소 또는 거주지역" name="region" placeholder="예: 서울시 은평구" />
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

        {/* Y10(안 A, 2026-07-30 Q "추천안대로"): 카드 안에서는 그림자를 쓰지 않는다 — 카드 안에 또
            카드가 되고 카드 계약(wire-card.tsx)·동의 수정 허브(wire-styles.ts '동의 3종 수정')와
            어긋난다. 테두리 1px 을 유지한 채 배경을 한 톤 낮춰 '카드 안의 한 덩어리'로 읽히게 한다.
            `register-consent` 로 범위를 좁힌다 — `.consent-fieldset` 자체는 자기 가입 폼·동의 수정
            허브와 공유하는 규칙이라 덮으면 손대지 않은 화면 2개가 함께 바뀐다. */}
        <fieldset className="consent-fieldset register-consent">
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

          {/* 2026-07-30 Q: 자필 서명·스캔 파일로 받은 동의서를 올릴 **자리만** 만든다.
              파일 입력을 두지 않는 것이 의도다 — 올릴 수 있어 보이면 실무자가 스캔 동의서를
              제출했다고 믿는다. 스캔 동의서는 이름·서명이 담긴 PII 문서라 기능 본체는 R2 격리
              (audio-store.ts 형태)·열람 감사(D14)·보존 전환(D32·D46)이 함께 와야 한다.
              그 묶음은 다음 세션 몫이다(artifacts/ui-revision-sweep-v1/lane-b-prep.md §9-2). */}
          <div className="consent-upload-slot" data-state="pending">
            <span className="consent-upload-slot-label">서명 동의서 첨부</span>
            <span className="consent-upload-slot-state">준비 중</span>
            <p className="schedule-form-hint">
              종이에 자필 서명을 받거나 이메일·스캔으로 받은 동의서를 올리는 자리입니다. 파일 첨부는 아직 동작하지 않습니다.
            </p>
          </div>

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

        {/* Y7: 실무자가 남을 등록하는 화면이라 '가입하기'가 아니다. 당사자 본인이 쓰는 자기 가입
            폼(join/participant)은 '가입하기'가 맞으므로 그쪽은 건드리지 않는다.
            Y6: 풀폭 버튼은 이 화면만의 예외였다 — 다른 화면처럼 콤팩트 알약으로 되돌린다. */}
        <WireButton type="submit" size="large" chevron className="register-submit">
          등록하기
        </WireButton>
      </form>
    </WireCard>
  );
}
