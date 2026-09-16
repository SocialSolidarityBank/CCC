'use client';

import {
  Icon,
  WireBadge,
  WireButton,
  WireCard,
  WireCardSection,
  WireChoice,
  WireError,
  WireRequiredMarker,
} from '@ccc/wire';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type CurrentConsentState,
} from '@ccc/contracts/consent';
import { useState } from 'react';
import { SearchInput } from '../../components/wire/search-input';
import { PROGRAM_LABELS } from '../../lib/labels';

// 성별 선택값은 정본 질문지 1-1 그대로다(D41). 빈 값은 '미입력' — 금고에 아무것도 쓰지 않는다.
const GENDER_OPTIONS = [
  { value: '', label: '선택 안 함' },
  { value: '여성', label: '여성' },
  { value: '남성', label: '남성' },
  { value: '기타', label: '기타' },
  { value: '무응답', label: '무응답' },
];

type ConsentDecisions = Partial<Record<ConsentDomain, 'grant' | 'decline'>>;

function consentDisclosuresInOrder(
  disclosures: readonly ConsentDisclosureSnapshot[],
  supportCaseId: string | null,
): ConsentDisclosureSnapshot[] | null {
  if (disclosures.length !== CONSENT_DOMAINS.length) return null;
  const byDomain = new Map(disclosures.map((snapshot) => [snapshot.domain, snapshot]));
  if (byDomain.size !== CONSENT_DOMAINS.length) return null;
  const programIds = new Set(disclosures.map((snapshot) => snapshot.scopeBinding.programId));
  if (
    programIds.size !== 1
    || disclosures.some((snapshot) => snapshot.scopeBinding.supportCaseId !== supportCaseId)
  ) {
    return null;
  }
  return CONSENT_DOMAINS.map((domain) => byDomain.get(domain)!);
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
  /** 서버가 이 등록 대상 사업에 발급한 고지 6건. 전문 표시와 hidden JSON이 같은 객체를 쓴다. */
  disclosures: readonly ConsentDisclosureSnapshot[];
}

/**
 * 당사자 등록 폼(재개편 T7, #37, Figma 1:95). 카드 안에 기본정보 입력 6칸과
 * 서버가 발급한 여섯 영역 동의 고지와 결정 입력, 등록 행동을 둔다.
 *
 * 동의는 여기서 받고 당사자 정보 페이지에서 고친다. 인테이크는 읽기만 한다(D44).
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
  disclosures,
}: RegisterFormProps) {
  const [consentDecisions, setConsentDecisions] = useState<ConsentDecisions>({});
  const [emergency, setEmergency] = useState(false);
  const allConsentDecided = CONSENT_DOMAINS.every((domain) => consentDecisions[domain] !== undefined);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const orderedDisclosures = consentDisclosuresInOrder(disclosures, null);
  if (orderedDisclosures === null) {
    return (
      <WireCard className="register-card">
        <WireError>지금 동의 내용을 불러올 수 없습니다. 페이지를 새로 고침해 주세요.</WireError>
      </WireCard>
    );
  }
  return (
    /* Y6: 등록 화면만 폼이 배경 위에 놓여 다른 화면의 카드 언어와 달랐다. 카드 안으로 넣는다. */
    <WireCard className="register-card">
      <form
        className="wire-register-form"
        action={action}
        noValidate
        onSubmit={(event) => {
          const emailInput = event.currentTarget.elements.namedItem('email');
          if (
            emailInput instanceof HTMLInputElement
            && emailInput.value.length > 0
            && !emailInput.validity.valid
          ) {
            event.preventDefault();
            setEmailError('이메일 형식으로 입력해 주세요. 예: participant@example.com');
            emailInput.focus();
          }
        }}
      >
        {/* 참여 사업은 고를 값이 아니다(2026-07-30 Q) — 초대 시점에 정해지고, 서버도 폼이 보낸
            값을 읽지 않는다(actions.ts 가 financial_support_v1 하드코딩). 그래서 select 를 없애고
            지금 등록하는 사업 하나만 고정 표시한다. 참여 사업이 여럿이어도 이 화면은 이번 것만 말한다.
            민트 계열은 '사람·소속' 축이고 사업 라벨이 그 축에 든다(D34).
            카드 **안** 이름 칸 위다 — 카드 밖에 두면 "화면의 모든 글자는 카드 안에"(D37)를 깬다. */}
        <p className="register-program-fixed">
          <span className="register-program-fixed-label">참여 사업</span>
          <span className="register-program-fixed-value">{programLabel}</span>
        </p>

        <div className="wire-container" data-grid="true">
          {/* 이름·이메일·연락처는 필수 표시를 달지 않는다(2026-08-08 Q). 서버가 셋 다 선택
              취급이고(createInitialParticipantProgramAction), D59 가 이름 없는 무응답 등록을
              설계된 경우로 인정한다. 구 Y8 별표는 이 서버 규칙과 어긋나 내렸다. */}
          <div className="wire-col-6">
            <SearchInput label="이름" name="name" placeholder="당사자 이름" />
          </div>
          <div className="wire-col-6">
            <SearchInput
              label="이메일"
              name="email"
              type="email"
              placeholder="participant@example.com"
              value={email}
              error={emailError}
              onChange={(nextEmail) => {
                setEmail(nextEmail);
                if (emailError !== undefined) setEmailError(undefined);
              }}
            />
          </div>
          <div className="wire-col-6">
            <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" />
          </div>
          {/* D41 1-1 · D42 ①: 인테이크 1단계의 기본정보는 여기서만 입력·수정한다. 값은 금고에
              암호화 저장되고(D3), 인테이크 화면은 읽어서 표시만 한다(세션 기록에 PII 미저장, R3).
              2026-07-30 Q: 성별이 생년월일 위다. */}
          <div className="wire-col-6">
            <SearchInput label="성별" variant="select" name="gender" value="" options={GENDER_OPTIONS} />
          </div>
          <div className="wire-col-6">
            {/* 레인 D: 네이티브 날짜 칸을 글자 입력으로 바꿨다(R6 + Q '생년월일 한국어화').
                자리 표시자·도움말·자동 하이픈은 부품이 갖는다 — date-text-input.tsx 참조. */}
            <SearchInput label="생년월일" type="date" name="birthDate" />
          </div>
          <div className="wire-col-6">
            <SearchInput label="주소 또는 거주지역" name="region" placeholder="예: 서울시 은평구" />
          </div>
        </div>

        {/* 등록자=담당 실무자(D7): 담당 실무자 지정 select 를 없애고 현재 사용자를 읽기 전용으로 보여준다.
            admin 은 서버 액션이 본인을 배정하고, counselor 는 게이트웨이가 자동 본인 배정한다.
            표시는 참여 사업 고정 표시와 같은 민트 tint 상자다(2026-08-07 Q "카드처리해서 잘
            보이게" — 담당 실무자도 '사람·소속' 축이라 같은 어휘가 맞다, D34). */}
        <div className="wire-invite-section">
          <p className="register-program-fixed">
            <span className="register-program-fixed-label">담당 실무자</span>
            <span className="register-program-fixed-value">{currentUser.name ?? currentUser.email}</span>
          </p>
          <p className="schedule-form-hint">
            등록한 실무자가 담당 실무자로 자동 배정됩니다. 담당 실무자 변경은 관리자에게 요청하거나 관리자가 배정 화면에서 처리합니다.
          </p>
        </div>

        {/* Y10(안 A, 2026-07-30 Q "추천안대로"): 카드 안에서는 그림자를 쓰지 않는다. 2026-08-29
            Q 가 동의 텍스트 덩어리를 테두리 상자(.register-consent-block)로 올렸다 — 그림자
            없는 --line 1px 상자라 Y10 과 충돌하지 않는다.
            `register-consent` 로 범위를 좁힌다 — `.consent-fieldset` 자체는 자기 가입 폼·동의 수정
            허브와 공유하는 규칙이라 덮으면 손대지 않은 화면 2개가 함께 바뀐다. */}
        <fieldset className="consent-fieldset register-consent">
          <legend>동의</legend>
          <div className="register-consent-block wire-repeat-card">
            {orderedDisclosures.map((disclosure) => {
              const domain = disclosure.domain;
              return (
                <WireCardSection
                  key={domain}
                  title={(
                    <span className="wire-title-with-badge">
                      <span>{CONSENT_COPY[domain].label}</span>
                      <WireRequiredMarker />
                    </span>
                  )}
                >
                  <p className="schedule-form-hint">{disclosure.fullKoreanCopy}</p>
                  <input
                    type="hidden"
                    name={`consentSnapshot_${domain}`}
                    value={JSON.stringify(disclosure)}
                  />
                  <div
                    className="wizard-choice-row"
                    role="radiogroup"
                    aria-label={CONSENT_COPY[domain].label}
                    aria-required="true"
                  >
                    <WireChoice
                      type="radio"
                      name={`consentDecision_${domain}`}
                      value="grant"
                      label="동의함"
                      checked={consentDecisions[domain] === 'grant'}
                      onChange={() => {
                        setConsentDecisions((current) => ({ ...current, [domain]: 'grant' }));
                        if (domain === 'personal_data_collection_use') setEmergency(false);
                      }}
                    />
                    <WireChoice
                      type="radio"
                      name={`consentDecision_${domain}`}
                      value="decline"
                      label="동의하지 않음"
                      checked={consentDecisions[domain] === 'decline'}
                      onChange={() => {
                        setConsentDecisions((current) => ({ ...current, [domain]: 'decline' }));
                      }}
                    />
                  </div>
                </WireCardSection>
              );
            })}
          </div>

          {/* 2026-07-30 Q: 자필 서명·스캔 파일로 받은 동의서를 올릴 **자리만** 만든다.
              파일 입력을 두지 않는 것이 의도다 — 올릴 수 있어 보이면 실무자가 스캔 동의서를
              제출했다고 믿는다. 스캔 동의서는 이름·서명이 담긴 PII 문서라 기능 본체는 R2 격리
              (audio-store.ts 형태)·열람 감사(D14)·보존 전환(D32·D46)이 함께 와야 한다.
              그 묶음은 다음 세션 몫이다(artifacts/ui-revision-sweep-v1/lane-b-prep.md §9-2). */}
          <div className="consent-upload-slot" data-state="pending">
            {/* 라벨과 상태 배지는 한 줄이다(2026-09-14 Q · §4-9) — 구 구조는 배지를 라벨 다음
                행에 두어 배지만 자기 줄을 썼다. */}
            <span className="wire-title-with-badge">
              <span className="consent-upload-slot-label">서명 동의서 첨부</span>
              <WireBadge tone="lavender">준비 중</WireBadge>
            </span>
            <p className="schedule-form-hint">
              종이에 자필 서명을 받거나 이메일·스캔으로 받은 동의서를 올리는 자리입니다. 파일 첨부는 아직 동작하지 않습니다.
            </p>
          </div>

          {/* G1 예외: 긴급 등록. 동의를 받을 수 없는 급박한 개입에서만 쓰고, 사유가 케이스에
              남으며 보완 기한(기본 14일) 전에 알림이 간다. 예외 경로일 뿐 확인된 리스크가
              아니므로 리스크 레드를 쓰지 않는다(D9 — 리스크 색 독점). */}
          <div className="consent-emergency register-consent-block wire-repeat-card">
            <label className="consent-checkbox">
              <input
                type="checkbox"
                className="wire-checkbox"
                name="emergencyRegistration"
                value="on"
                checked={emergency}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setEmergency(checked);
                  if (checked) {
                    setConsentDecisions((current) => {
                      if (current.personal_data_collection_use !== 'grant') return current;
                      const next = { ...current };
                      delete next.personal_data_collection_use;
                      return next;
                    });
                  }
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

        </fieldset>

        {/* Y7: 실무자가 남을 등록하는 화면이라 '가입하기'가 아니다. 당사자 본인이 쓰는 자기 가입
            폼(join/participant)은 '가입하기'가 맞으므로 그쪽은 건드리지 않는다.
            Y6: 풀폭 버튼은 이 화면만의 예외였다 — 다른 화면처럼 콤팩트 알약으로 되돌린다. */}
        <WireButton
          type="submit"
          size="large"
          className="register-submit"
          icon={<Icon name="check" />}
          disabled={!allConsentDecided}
        >
          등록하기
        </WireButton>
      </form>
    </WireCard>
  );
}

export interface ConsentEditorProps {
  beneficiaryId: string;
  supportCaseId: string;
  formId: string;
  recordedAtLabel: string;
  currentStates: readonly CurrentConsentState[];
  disclosures: readonly ConsentDisclosureSnapshot[];
  action: (formData: FormData) => void | Promise<void>;
}

function consentStatePresentation(state: CurrentConsentState['state'] | undefined): {
  label: string;
  tone: 'mint' | 'lavender' | 'neutral';
} {
  if (state === 'granted') return { label: '동의함', tone: 'mint' };
  if (state === 'not_granted') return { label: '동의하지 않음', tone: 'neutral' };
  return { label: '미기록', tone: 'lavender' };
}

export function ConsentEditor({
  beneficiaryId,
  supportCaseId,
  formId,
  recordedAtLabel,
  currentStates,
  disclosures,
  action,
}: ConsentEditorProps) {
  const [decisions, setDecisions] = useState<ConsentDecisions>({});
  const orderedDisclosures = consentDisclosuresInOrder(disclosures, supportCaseId);
  if (orderedDisclosures === null) {
    return <WireError>지금 동의 내용을 불러올 수 없습니다. 페이지를 새로 고침해 주세요.</WireError>;
  }
  const stateByDomain = new Map(currentStates.map((state) => [state.domain, state]));

  return (
    <form id={formId} className="participant-program-consent" action={action}>
      <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
      <input type="hidden" name="supportCaseId" value={supportCaseId} />
      <fieldset className="consent-fieldset" aria-label="동의">
        {orderedDisclosures.map((disclosure) => {
          const domain = disclosure.domain;
          const presentation = consentStatePresentation(stateByDomain.get(domain)?.state);
          const decision = decisions[domain];
          return (
            <WireCardSection
              key={domain}
              title={(
                <span className="wire-title-with-badge">
                  <span>{CONSENT_COPY[domain].label}</span>
                  <WireBadge tone={presentation.tone}>{presentation.label}</WireBadge>
                </span>
              )}
            >
              <div className="consent-detail-section">
                <p className="consent-detail-paragraph">{disclosure.fullKoreanCopy}</p>
              </div>
              {decision === undefined ? null : (
                <input
                  type="hidden"
                  name={`consentSnapshot_${domain}`}
                  value={JSON.stringify(disclosure)}
                />
              )}
              <div className="wizard-choice-row" role="radiogroup" aria-label={CONSENT_COPY[domain].label}>
                <WireChoice
                  type="radio"
                  name={`consentDecision_${domain}`}
                  value="grant"
                  label="동의함"
                  checked={decision === 'grant'}
                  onChange={() => setDecisions((current) => ({ ...current, [domain]: 'grant' }))}
                />
                <WireChoice
                  type="radio"
                  name={`consentDecision_${domain}`}
                  value="decline"
                  label="동의하지 않음"
                  checked={decision === 'decline'}
                  onChange={() => setDecisions((current) => ({ ...current, [domain]: 'decline' }))}
                />
              </div>
            </WireCardSection>
          );
        })}
        <p className="participant-program-consent-meta">마지막 기록 {recordedAtLabel}</p>
      </fieldset>
    </form>
  );
}
