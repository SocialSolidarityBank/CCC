// Screenshot artifacts only. No business data, credentials or runtime requests.
// 모든 인물·기관·상담 내용은 가상이다. 작성 화면 캡처 묶음 — 당사자 등록, 인테이크 4단계,
// 상담 일정 등록 위저드, 세션 목표 수정, 당사자 기본정보 수정.
//
// 원본 화면의 비공개 부품(QuestionField·RowTable·ReadOnlyRow·renderGroups·candidateLabel)은
// 원본 파일이 next/navigation·서버 액션을 물고 있어 여기로 옮겨 적었다. 마크업과 클래스는
// 원본 그대로이고, 상태·제출만 뺐다(읽기 전용 값은 defaultValue/defaultChecked).
import React, { type ReactNode } from 'react';
import {
  DisclosureChevron,
  Icon,
  ParticipantHeroCard,
  WireBadge,
  WireBullets,
  WireButton,
  WireCallout,
  WireCard,
  WireCardDetails,
  WireChoice,
  WireFormField,
  WireRequiredMarker,
} from '../../packages/wire/src/index';
import { SearchInput } from '../../apps/web/app/components/wire/search-input';
import { WireSteps } from '../../apps/web/app/components/wire/wire-steps';
import { WireRepeatActions } from '../../apps/web/app/components/wire/wire-repeat-actions';
import { DateTimePickerControl } from '../../apps/web/app/components/wire/date-picker-control';
import { DateTextInput, dateTextHint } from '../../apps/web/app/components/wire/date-text-input';
import { DraftRetentionNote, DraftStatus } from '../../apps/web/app/components/draft/draft-notice';
import { CONSENT_DETAIL_DISCLAIMER, CONSENT_DETAIL_SECTIONS } from '../../apps/web/app/participants/new/consent-copy';
import {
  ADDITIONAL_COLUMNS,
  DEBT_COLUMNS,
  LINKED_ORG_COLUMNS,
  NOT_APPLICABLE_CODE,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_CODE,
  NO_RESPONSE_OPTION,
  STEP_GROUPS,
  STEP_TITLES,
  intakeSectionAnchor,
  type IntakeQuestion,
  type IntakeTableColumn,
} from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-questions';
import { IntakeStepRail } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-step-rail';

// ── 공용 가상 값 ────────────────────────────────────────────────────────────
const PARTICIPANT = {
  name: '김하늘',
  beneficiaryId: 'crane-001',
  birthDate: '2004-05-18',
  phone: '010-0000-1042',
  email: 'haneul@example.com',
  region: '서울시 은평구',
  gender: '여성',
  account: '함께은행 110-000-104210',
};
const WORKER_LABEL = '이서연';
const PROGRAM_LABEL = '함께온기금 울타리대출';
const HELD_AT = '2026-09-10T14:00';
const HELD_AT_LABEL = '2026년 9월 10일 오후 2:00';
const SCHEDULED_AT = '2026-09-15T14:00';
const SCHEDULED_AT_LABEL = '2026년 9월 15일 오후 2:00';
const DRAFT_SAVED_AT = Date.parse('2026-09-10T14:05:00+09:00');
const noop = () => {};

const GENDER_OPTIONS = [
  { value: '', label: '선택 안 함' },
  { value: '여성', label: '여성' },
  { value: '남성', label: '남성' },
  { value: '기타', label: '기타' },
  { value: '무응답', label: '무응답' },
];

// ── 당사자 등록 (participants/new/register-form.tsx) ─────────────────────────
function ParticipantRegister() {
  return (
    <WireCard className="register-card">
      <form className="wire-register-form" noValidate>
        <p className="register-program-fixed">
          <span className="register-program-fixed-label">참여 사업</span>
          <span className="register-program-fixed-value">{PROGRAM_LABEL}</span>
        </p>

        <div className="wire-container" data-grid="true">
          <div className="wire-col-6">
            <SearchInput label="이름" name="name" placeholder="당사자 이름" value={PARTICIPANT.name} />
          </div>
          <div className="wire-col-6">
            <SearchInput
              label="이메일"
              name="email"
              type="email"
              placeholder="participant@example.com"
              value={PARTICIPANT.email}
            />
          </div>
          <div className="wire-col-6">
            <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" value={PARTICIPANT.phone} />
          </div>
          <div className="wire-col-6">
            <SearchInput label="성별" variant="select" name="gender" value={PARTICIPANT.gender} options={GENDER_OPTIONS} />
          </div>
          <div className="wire-col-6">
            <SearchInput label="생년월일" type="date" name="birthDate" value={PARTICIPANT.birthDate} />
          </div>
          <div className="wire-col-6">
            <SearchInput label="주소 또는 거주지역" name="region" placeholder="예: 서울시 은평구" value={PARTICIPANT.region} />
          </div>
        </div>

        <div className="wire-invite-section">
          <p className="register-program-fixed">
            <span className="register-program-fixed-label">담당 실무자</span>
            <span className="register-program-fixed-value">{WORKER_LABEL}</span>
          </p>
          <p className="schedule-form-hint">
            등록한 실무자가 담당 실무자로 자동 배정됩니다. 담당 실무자 변경은 관리자에게 요청하거나 관리자가 배정 화면에서 처리합니다.
          </p>
        </div>

        <fieldset className="consent-fieldset register-consent">
          <legend>동의</legend>
          <div className="register-consent-block wire-repeat-card">
            <p className="schedule-form-hint">
              동의는 오프라인(종이·구두)으로 받고, 시스템에는 체크·일시·기록자만 남깁니다.
              개인정보 수집·이용 동의는 등록에 반드시 필요하며, AI를 활용한 녹취기록은 미동의여도 등록이 진행됩니다.
            </p>
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" name="consentPrivacy" value="on" defaultChecked />
              <span>개인정보 수집·이용 동의 (필수)</span>
            </label>
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" name="consentRecordingAi" value="on" defaultChecked />
              <span>AI를 활용한 녹취기록 동의</span>
            </label>
          </div>

          <div className="consent-upload-slot" data-state="pending">
            <span className="wire-title-with-badge">
              <span className="consent-upload-slot-label">서명 동의서 첨부</span>
              <WireBadge tone="lavender">준비 중</WireBadge>
            </span>
            <p className="schedule-form-hint">
              종이에 자필 서명을 받거나 이메일·스캔으로 받은 동의서를 올리는 자리입니다. 파일 첨부는 아직 동작하지 않습니다.
            </p>
          </div>

          <div className="consent-emergency register-consent-block wire-repeat-card">
            <label className="consent-checkbox">
              <input type="checkbox" className="wire-checkbox" name="emergencyRegistration" value="on" />
              <span>긴급 등록 (동의를 먼저 받을 수 없는 경우)</span>
            </label>
            <p className="schedule-form-hint">
              긴급 등록은 사유와 함께 기록되고, 동의 보완 기한(등록일부터 14일)이 생깁니다. 기한 전에 담당 실무자에게 알림이 갑니다.
            </p>
          </div>

          <details className="consent-detail register-consent-block wire-repeat-card">
            <summary className="consent-detail-summary">
              <span>자세히 읽어보기</span>
              <DisclosureChevron variant="plain" />
            </summary>
            <div className="consent-detail-body">
              <p className="consent-detail-disclaimer">{CONSENT_DETAIL_DISCLAIMER}</p>
              {CONSENT_DETAIL_SECTIONS.map((section) => (
                <div className="consent-detail-section" key={section.heading}>
                  <h3>{section.heading}</h3>
                  {section.paragraphs?.map((paragraph) => <p className="consent-detail-paragraph" key={paragraph}>{paragraph}</p>)}
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

        <WireButton type="submit" size="large" className="register-submit" icon={<Icon name="check" />}>
          등록하기
        </WireButton>
      </form>
    </WireCard>
  );
}

// ── 인테이크 작성 (records/intake/intake-wizard.tsx) ─────────────────────────
// 원본의 비공개 부품을 캡처용으로 옮긴다 — 마크업·클래스 동일, 상태만 제거.
type AnswerDraft = { response: 'answered' | 'declined' | 'unknown' | 'not_applicable'; text: string };
type TableRow = Record<string, string>;

function optionFromDraft(draft: AnswerDraft): string {
  if (draft.response === 'answered') return draft.text;
  if (draft.response === NO_RESPONSE_CODE) return NO_RESPONSE_OPTION;
  if (draft.response === NOT_APPLICABLE_CODE) return NOT_APPLICABLE_OPTION;
  return '';
}

/** 읽기 전용 한 줄(기본정보·동의) — 원본 ReadOnlyRow 그대로. */
function ReadOnlyRow(props: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="wizard-field" data-testid="intake-readonly-row">
      <span className="wire-field-label">{props.label}</span>
      <p className="wire-field-value" {...(props.emphasis === true ? { 'data-emphasis': 'true' } : { 'data-size': 'sm' })}>{props.value}</p>
    </div>
  );
}

/** 질문 1문 — 원본 QuestionField 그대로(고르기·여러 개 고르기·서술). */
function QuestionField(props: {
  question: IntakeQuestion;
  value: AnswerDraft;
  labelledBy?: string;
}) {
  const { question, value, labelledBy } = props;

  if (question.kind === 'select') {
    return (
      <WireFormField label={question.label} hideLabel={labelledBy !== undefined} control="select" required>
        <select
          aria-label={labelledBy === undefined ? question.label : undefined}
          aria-labelledby={labelledBy}
          data-answer-key={question.key}
          defaultValue={optionFromDraft(value)}
        >
          <option value="">선택하세요</option>
          {(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </WireFormField>
    );
  }

  if (question.kind === 'multi') {
    const selected = optionFromDraft(value).split(', ').filter((entry) => entry.length > 0);
    return (
      <div className="wizard-field" data-answer-key={question.key}>
        {labelledBy === undefined ? <span className="wire-form-label" id={`intake-${question.key}-label`}>
          {question.label} <WireRequiredMarker />
        </span> : null}
        <div className="wizard-choice-row" role="group" aria-labelledby={labelledBy ?? `intake-${question.key}-label`}>
          {(question.options ?? []).map((option) => (
            <WireChoice
              key={option}
              type="checkbox"
              label={option}
              ariaLabel={`${question.label} ${option}`}
              defaultChecked={selected.includes(option)}
            />
          ))}
        </div>
      </div>
    );
  }

  const answered = value.response === 'answered';
  return (
    <div className="wizard-field">
      <WireFormField label={question.label} hideLabel={labelledBy !== undefined} control="textarea" required>
        <textarea
          aria-label={labelledBy === undefined ? question.label : undefined}
          aria-labelledby={labelledBy}
          data-answer-key={question.key}
          placeholder={labelledBy === undefined ? question.hint : undefined}
          rows={3}
          defaultValue={answered ? value.text : ''}
          disabled={!answered}
        />
      </WireFormField>
      <div className="wizard-actions wizard-answer-actions">
        {([[NO_RESPONSE_OPTION, NO_RESPONSE_CODE], [NOT_APPLICABLE_OPTION, NOT_APPLICABLE_CODE]] as const).map(
          ([optionLabel, code]) => (
            <WireButton key={code}>
              {value.response === code ? <><Icon name="check" size={14} /> {optionLabel}</> : optionLabel}
            </WireButton>
          ),
        )}
      </div>
    </div>
  );
}

/** 반복 행 표 — 원본 RowTable 그대로. */
function RowTable(props: {
  title: string;
  hint: string;
  columns: readonly IntakeTableColumn[];
  rows: TableRow[];
  testId: string;
  required?: boolean;
}) {
  const { columns, rows, required = false } = props;
  return (
    <WireCard
      className="wire-form-card"
      title={<h3 id={intakeSectionAnchor(props.title)}>{props.title}</h3>}
      testId={props.testId}
    >
      <div className="wire-repeat-guide">
        <p className="panel-meta">{props.hint}</p>
        <WireRepeatActions
          itemLabel="줄"
          onAdd={noop}
          onRemove={rows.length === 0 ? undefined : noop}
          showRemove
        />
      </div>
      {rows.map((row, index) => (
        <div key={index} className="wizard-field">
          {columns.map((column, columnIndex) => {
            const fieldRequired = required && index === 0 && columnIndex === 0;
            return (
              <WireFormField
                key={column.key}
                label={`${column.label} ${index + 1}`}
                required={fieldRequired}
              >
                <input
                  aria-label={`${column.label} ${index + 1}`}
                  defaultValue={row[column.key] ?? ''}
                  placeholder={column.placeholder}
                />
              </WireFormField>
            );
          })}
        </div>
      ))}
    </WireCard>
  );
}

// 가상 답변 — 정본 질문지(intake-questions.ts)의 전 문항을 채운다.
const ANSWERS: Record<string, AnswerDraft> = {
  // 1-2 공적급여·수급자 여부
  welfare_basic_livelihood: { response: 'answered', text: '비수급' },
  welfare_benefit_type: { response: 'not_applicable', text: '' },
  welfare_near_poverty: { response: 'answered', text: '비해당' },
  welfare_other: { response: 'answered', text: '자립정착금과 자립수당을 받고 있습니다.' },
  // 1-3 상담 운영정보
  counsel_method: { response: 'answered', text: '대면' },
  referral_path: { response: 'answered', text: '기관 의뢰' },
  contact_time: { response: 'answered', text: '평일 저녁' },
  contact_caution: { response: 'answered', text: '문자로 먼저 연락해 주세요. 원가정에 상담 사실이 알려지지 않도록 주의가 필요합니다.' },
  // 1-4 상담 신청 사유
  application_reason: { response: 'answered', text: '경제·생계 어려움' },
  application_reason_detail: { response: 'answered', text: '보호종료 후 독립을 준비하며 월세 보증금과 취업 준비 비용이 필요해 소액대출 상담을 신청했습니다.' },
  // 현재 어려움 관련 영역
  difficulty_areas: { response: 'answered', text: '경제, 일·고용, 주거' },
  // 2-1 경제·부채상황
  economy_income_type: { response: 'answered', text: '복수 소득' },
  economy_monthly_income: { response: 'answered', text: '약 150만 원(근로 110만 원, 자립수당 40만 원), 근로일수에 따라 변동 있음' },
  economy_monthly_expense: { response: 'answered', text: '월세 40만 원, 식비 35만 원, 교통·통신비 15만 원, 학원비 25만 원, 비상금 적립 10만 원' },
  economy_arrears: { response: 'answered', text: '있음' },
  economy_debt_types: { response: 'answered', text: '카드대금, 공과금·통신비' },
  // 2-2 일·고용상황
  employment_status: { response: 'answered', text: '임시·일용근로' },
  employment_income_stability: { response: 'answered', text: '다소 불안정' },
  employment_detail: { response: 'answered', text: '주 4일 카페에서 일하며, 정보처리기능사 자격증 학원을 다니고 있습니다. 정규직 전환을 준비 중입니다.' },
  // 2-3 주거상황
  housing_type: { response: 'answered', text: '월세' },
  housing_instability: { response: 'answered', text: '비용 부담' },
  housing_detail: { response: 'answered', text: '보호종료 후 월세로 독립했으며, 계약 갱신 시 보증금 300만 원이 부족한 상황입니다.' },
  // 2-4 건강·심리정서
  health_physical: { response: 'answered', text: '양호' },
  health_care_barrier: { response: 'answered', text: '없음' },
  health_stress: { response: 'answered', text: '보통' },
  health_daily_impact: { response: 'answered', text: '수면' },
  health_detail: { response: 'answered', text: '독립 초기라 불안감이 있으나 일상생활에 큰 지장은 없습니다. 취업 준비로 수면이 다소 부족합니다.' },
  // 2-5 가족·관계·돌봄
  family_household_type: { response: 'answered', text: '1인 가구' },
  family_care_burden: { response: 'answered', text: '없음' },
  family_detail: { response: 'answered', text: '보호종료 후 혼자 살고 있으며, 원가정과는 연락이 끊긴 상태입니다.' },
  // 3-1 우선적으로 필요한 도움
  need_primary: { response: 'answered', text: '주거지원' },
  need_secondary: { response: 'answered', text: '채무상담·채무조정' },
  need_detail: { response: 'answered', text: '월세 보증금 소액대출과 카드대금 정리 상담을 우선으로 원합니다.' },
  // 3-2 이전 지원 경험
  previous_support_detail: { response: 'answered', text: '2026년 6월 자립지원전담기관에서 자립정착금과 주거 상담을 받았습니다.' },
  // 3-4 강점과 비공식 자원
  strength_relational: { response: 'answered', text: '자립지원전담기관 담당자, 직장 동료 1명' },
  strength_personal: { response: 'answered', text: '성실한 근무 태도와 문제 해결 의지' },
  strength_detail: { response: 'answered', text: '보호종료 후에도 근로를 유지해 왔고, 필요한 서류를 직접 준비하는 실행력이 있습니다.' },
  // 4-1 상담 참여 여건
  participation_barrier: { response: 'answered', text: '근무시간' },
  participation_preferred_method: { response: 'answered', text: '혼합' },
  participation_detail: { response: 'answered', text: '평일 낮에는 근무 때문에 참여가 어렵고, 화요일 18시 이후 전화 상담이 가능합니다.' },
  // 4-3 담당 실무자 판단 및 다음 단계
  summary_urgency: { response: 'answered', text: '주의' },
  summary_direction: { response: 'answered', text: '사례관리 진행' },
};

const DEBT_ROWS: TableRow[] = [
  { creditor: '○○카드', kind: '카드대금', balance: '180만 원', monthlyPayment: '15만 원', arrearsStatus: '1개월 연체' },
  { creditor: '○○통신', kind: '통신비 미납', balance: '40만 원', monthlyPayment: '4만 원', arrearsStatus: '2개월 미납' },
];
const LINKED_ORG_ROWS: TableRow[] = [
  { orgName: '은평구 자립지원전담기관', serviceName: '자립준비청년 사후관리', supportDetail: '자립수당 월 40만 원', usagePeriod: '2026.05~2026.12', progressStatus: '지원 중 / 김○○ 담당자' },
];
const ADDITIONAL_ROWS: TableRow[] = [
  { item: '신용점수와 전체 채무 잔액', reason: '대출 한도와 상환 계획 판단', method: '신용정보조회서 확인', dueNote: '다음 상담 전' },
];
const MANAGER_OPINION = '보호종료 직후 독립 초기 단계로, 월세 보증금과 카드대금 정리가 시급합니다. 소액대출 신청과 상환 계획 수립을 우선 진행하고, 자립수당 수급 기간 동안 비상금 적립 습관을 함께 점검합니다.';
const OVERALL_GOAL = '소액대출로 주거를 안정시키고 상환 계획을 세워 자립 기반을 다진다.';

// 단계별 필수 전체 수(질문 + 질문 밖 필수) — DESIGN-RULES §1: 11, 21, 8, 6.
const INTAKE_STEP_TOTALS = [11, 21, 8, 6] as const;

/** 원본 renderGroups 그대로 — 소절 카드 + 자동 채움 엑스트라 슬롯. */
function renderGroups(
  groups: readonly { title: string; questions: readonly IntakeQuestion[] }[],
  extras: Readonly<Record<string, ReactNode>> = {},
) {
  return groups.map((group) => {
    const singleQuestion = group.questions.length === 1 ? group.questions[0] : undefined;
    const headingText = group.title.replace(/^\d+-\d+\.\s*/, '');
    const repeatsHeading = singleQuestion !== undefined && (
      singleQuestion.label === headingText
      || singleQuestion.label.replace(/\s*(상세내용|내용|작성)$/, '') === headingText
    );
    const sharedLabel = repeatsHeading ? `intake-${singleQuestion.key}-label` : undefined;
    return (
      <WireCard key={group.title} className="wire-form-card" title={sharedLabel === undefined
        ? <h3 id={intakeSectionAnchor(group.title)}>{group.title}</h3>
        : <div className="wire-card-head" id={sharedLabel}>
          <h3 id={intakeSectionAnchor(group.title)}>{group.title}</h3>
          <WireRequiredMarker />
        </div>}>
        {sharedLabel !== undefined && singleQuestion?.hint !== undefined
          ? <p className="panel-meta">{singleQuestion.hint}</p>
          : null}
        {extras[group.title] ?? null}
        {group.questions.map((question) => (
          <QuestionField
            key={question.key}
            question={question}
            {...(sharedLabel === undefined ? {} : { labelledBy: sharedLabel })}
            value={ANSWERS[question.key] ?? { response: 'answered', text: '' }}
          />
        ))}
      </WireCard>
    );
  });
}

function IntakeStep({ step }: { step: 1 | 2 | 3 | 4 }) {
  const stepTocLabels: readonly string[] = step === 1
    ? ['1-1. 당사자 기본정보', '동의 기록', ...STEP_GROUPS[0]!.map((group) => group.title)]
    : step === 2
      ? [...STEP_GROUPS[1]!.map((group) => group.title), '대출·부채 현황 표']
      : step === 3
        ? [...STEP_GROUPS[2]!.map((group) => group.title), '3-3. 현재 연계된 기관·서비스']
        : [
          STEP_GROUPS[3]![0]!.title,
          '4-2. 추가 확인사항',
          STEP_GROUPS[3]![1]!.title,
          '전체 목표',
          '담당 실무자 종합의견',
          '연결된 상담 일정',
        ];

  return (
    <>
      <ParticipantHeroCard
        name={PARTICIPANT.name}
        beneficiaryId={PARTICIPANT.beneficiaryId}
        details={[
          { label: '인테이크', value: '작성 중' },
          { label: '전화번호', value: PARTICIPANT.phone, tone: 'mint' },
          { label: '이메일', value: PARTICIPANT.email, tone: 'mint' },
          { label: '상담일', value: HELD_AT_LABEL, tone: 'blue' },
        ]}
      />
      <WireCallout tone="lavender" title="입력 원칙" testId="intake-required-guidance">
        모든 항목이 필수입니다. 확인되지 않았거나 답하지 않은 항목은
        &lsquo;무응답&rsquo;을 고르세요.
      </WireCallout>
      <div className="wire-container rail-grid intake-grid" data-grid="true">
        <IntakeStepRail
          currentStep={step}
          items={INTAKE_STEP_TOTALS.map((total, index) => ({
            countLabel: `${total}/${total}`,
            ariaCount: `${total}/${total} 완료`,
            state: (step === index + 1 ? 'current' : 'done') as 'current' | 'done',
          }))}
          onSelect={noop}
          headerAccessory={<DraftStatus savedAt={DRAFT_SAVED_AT} available />}
        />

        <section className="wizard-stack">
          {step === 1 ? (
            <div className="wizard-stack">
              <div className="intake-step-toolbar"><h2>1. 상담 신청 및 기본정보</h2></div>

              <WireCard title={<h3 id={intakeSectionAnchor('1-1. 당사자 기본정보')}>1-1. 당사자 기본정보</h3>} testId="intake-basic-info">
                <p className="panel-meta">
                  당사자 등록에 저장된 값입니다. 이 화면에서는 고칠 수 없고 상담 기록에도 남지 않습니다.{' '}
                  <a href="#prototype-only">당사자 등록 정보에서 수정</a>
                </p>
                <ReadOnlyRow label="이름" value={PARTICIPANT.name} emphasis />
                <ReadOnlyRow label="생년월일" value={PARTICIPANT.birthDate} />
                <ReadOnlyRow label="전화번호" value={PARTICIPANT.phone} />
                <ReadOnlyRow label="이메일" value={PARTICIPANT.email} />
                <ReadOnlyRow label="주소 또는 거주지역" value={PARTICIPANT.region} />
                <ReadOnlyRow label="성별" value={PARTICIPANT.gender} />
              </WireCard>

              <WireCard title={<h3 id={intakeSectionAnchor('동의 기록')}>동의 기록</h3>} testId="intake-consent-status">
                <ReadOnlyRow label="개인정보 수집·이용 동의" value="기록됨" />
                <ReadOnlyRow label="AI를 활용한 녹취기록 동의" value="기록됨" />
              </WireCard>

              {renderGroups(STEP_GROUPS[0]!, {
                '1-3. 상담 운영정보': (
                  <>
                    <WireFormField label="상담일" required htmlFor="intake-held-at">
                      <DateTimePickerControl id="intake-held-at" fieldLabel="상담일" value={HELD_AT} onChange={noop} />
                    </WireFormField>
                    <div className="wire-form-grid">
                      <ReadOnlyRow label="실무자" value={WORKER_LABEL} />
                      <div className="wizard-field" data-testid="intake-readonly-row">
                        <span className="wire-field-label">상담 회차</span>
                        <span><WireBadge>1회</WireBadge></span>
                      </div>
                    </div>
                  </>
                ),
              })}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="wizard-stack">
              <div className="intake-step-toolbar"><h2>2. 현재 생활상황</h2></div>
              {renderGroups(STEP_GROUPS[1]!)}
              <RowTable
                title="대출·부채 현황 표"
                hint="채무별로 기관·채권자, 구분, 잔액, 월 상환액, 연체 여부와 상태를 기록합니다. 채무가 없으면 첫 행에 '해당 없음'을 기입합니다. 첫 칸은 필수라 비워 두면 완료할 수 없습니다."
                columns={DEBT_COLUMNS}
                rows={DEBT_ROWS}
                testId="intake-debt-table"
                required
              />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="wizard-stack">
              <div className="intake-step-toolbar"><h2>3. 필요한 도움과 활용 가능한 자원</h2></div>
              {renderGroups(STEP_GROUPS[2]!)}
              <RowTable
                title="3-3. 현재 연계된 기관·서비스"
                hint="이용 중이거나 연결이 진행 중인 자원을 기록합니다. 연계 자원이 없으면 첫 행에 '해당 없음'을 기입합니다. 첫 칸은 필수라 비워 두면 완료할 수 없습니다."
                columns={LINKED_ORG_COLUMNS}
                rows={LINKED_ORG_ROWS}
                testId="intake-linked-org-table"
                required
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="wizard-stack">
              <div className="intake-step-toolbar"><h2>4. 상담 정리와 후속관리</h2></div>
              {renderGroups([STEP_GROUPS[3]![0]!])}
              <RowTable
                title="4-2. 추가 확인사항"
                hint="다음 상담 전에 확인할 것을 적습니다."
                columns={ADDITIONAL_COLUMNS}
                rows={ADDITIONAL_ROWS}
                testId="intake-additional-table"
              />
              {renderGroups([STEP_GROUPS[3]![1]!])}
              <WireCard className="wire-form-card" title={<h3 id={intakeSectionAnchor('전체 목표')}>전체 목표</h3>} testId="intake-overall-goal">
                <p className="panel-meta">
                  당사자와 합의한 지원 방향을 한 문장으로 적습니다.
                  첫 상담에서 합의가 어려우면 비워 두세요. 본 상담에서 채워도 됩니다.
                </p>
                <div className="wire-form-grid">
                  <ReadOnlyRow label="1순위 지원욕구 (3-1)" value={ANSWERS.need_primary!.text} />
                  <ReadOnlyRow label="2순위 지원욕구 (3-1)" value={ANSWERS.need_secondary!.text} />
                  <ReadOnlyRow label="주요 지원방향 (4-3)" value={ANSWERS.summary_direction!.text} />
                </div>
                <WireFormField label="전체 목표" hideLabel htmlFor="intake-overall-goal-input">
                  <input
                    id="intake-overall-goal-input"
                    aria-labelledby={intakeSectionAnchor('전체 목표')}
                    type="text"
                    maxLength={200}
                    defaultValue={OVERALL_GOAL}
                    placeholder="이 당사자와 무엇을 향해 가는지 한 문장으로 적습니다"
                  />
                </WireFormField>
              </WireCard>
              <WireCard className="wire-form-card" title={<div className="wire-card-head"><h3 id={intakeSectionAnchor('담당 실무자 종합의견')}>담당 실무자 종합의견</h3><WireRequiredMarker /></div>}>
                <p className="panel-meta">실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.</p>
                <WireFormField label="담당 실무자 종합의견" hideLabel control="textarea">
                  <textarea
                    aria-labelledby={intakeSectionAnchor('담당 실무자 종합의견')}
                    aria-required="true"
                    rows={3}
                    defaultValue={MANAGER_OPINION}
                  />
                </WireFormField>
              </WireCard>
              <WireCard title={<h3 id={intakeSectionAnchor('연결된 상담 일정')}>연결된 상담 일정</h3>} testId="intake-schedule-completion">
                <p className="panel-meta">
                  이 인테이크로 완료 처리할 예정 일정입니다. 체크를 풀면 일정은 예정 그대로 남습니다.
                </p>
                <WireChoice
                  type="checkbox"
                  label={`${HELD_AT_LABEL} 일정을 완료로 표시`}
                  defaultChecked
                />
              </WireCard>
            </div>
          ) : null}

          <div className="wizard-actions">
            {step > 1 ? <WireButton variant="secondary" className="page-back" chevron="left">이전</WireButton> : null}
            {step < STEP_TITLES.length
              ? <WireButton chevron>다음: {STEP_TITLES[step]}</WireButton>
              : null}
            <WireButton size="large" icon={<Icon name="check" />}>완료</WireButton>
          </div>
        </section>

        <WireCard as="nav" labelledBy="intake-toc-title" testId="intake-toc" className="wire-toc-rail"
          title={<span id="intake-toc-title">바로가기</span>}>
          <ol className="wire-toc-list">
            {stepTocLabels.map((label) => (
              <li key={label}><a href={`#${intakeSectionAnchor(label)}`}>{label}</a></li>
            ))}
          </ol>
        </WireCard>
      </div>
    </>
  );
}

// ── 상담 일정 등록 (schedules/new/schedule-wizard.tsx) ───────────────────────
interface Candidate {
  value: string;
  beneficiaryId: string;
  supportCaseId: string;
  intakeAt: string | null;
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
}

const CANDIDATES: Candidate[] = [
  {
    value: 'crane-001:case-001',
    beneficiaryId: 'crane-001',
    supportCaseId: 'case-001',
    intakeAt: '2026-09-10T05:00:00Z',
    participantName: '김하늘',
    participantPhone: '010-0000-1042',
    participantEmail: 'haneul@example.com',
  },
  {
    value: 'otter-014:case-014',
    beneficiaryId: 'otter-014',
    supportCaseId: 'case-014',
    intakeAt: null,
    participantName: '박도윤',
    participantPhone: '010-0000-2210',
    participantEmail: 'doyun@example.com',
  },
  {
    value: 'fox-007:case-007',
    beneficiaryId: 'fox-007',
    supportCaseId: 'case-007',
    intakeAt: '2026-08-20T05:00:00Z',
    participantName: '최은재',
    participantPhone: '010-0000-3391',
    participantEmail: 'eunjae@example.com',
  },
];

/** 원본 candidateLabel 그대로 — 실명·가명 ID·연락처·이메일 메타 줄. */
function candidateLabel(candidate: Candidate) {
  return (
    <span className="wire-meta-row">
      <span className="schedule-candidate-name-cell">
        <span className="schedule-candidate-name">
          {candidate.participantName ?? candidate.beneficiaryId}
        </span>
        {candidate.participantName !== null && (
          <span className="participant-card-id">{candidate.beneficiaryId}</span>
        )}
      </span>
      {candidate.participantPhone !== null && candidate.participantPhone !== '' && (
        <span className="schedule-candidate-phone">{candidate.participantPhone}</span>
      )}
      {candidate.participantEmail !== null && candidate.participantEmail !== '' && (
        <span className="schedule-candidate-email">{candidate.participantEmail}</span>
      )}
    </span>
  );
}

/** 2단계 맥락 바 — 원본은 ListRow(selected)라 next/link 를 물어 정적 렌더 마크업을 그대로 적는다. */
function ContextBar({ candidate }: { candidate: Candidate }) {
  return (
    <div className="surface-card wire-row schedule-candidate-row" data-align="left" data-static="true" data-selected="true">
      <span className="wire-row-text">{candidateLabel(candidate)}</span>
    </div>
  );
}

/** 원본 SessionKindPicker 그대로. */
function SessionKindPicker({
  hasIntake,
  value,
}: {
  hasIntake: boolean;
  value: 'regular' | 'intake';
}) {
  const showIntakeWarning = hasIntake && value === 'intake';
  return (
    <div className="schedule-kind">
      <WireFormField
        label="상담 유형"
        control="select"
        htmlFor="schedule-session-kind"
        hint={hasIntake
          ? '인테이크가 끝난 당사자라 기본 상담으로 잡았습니다.'
          : '아직 인테이크 기록이 없어 인테이크로 잡았습니다.'}
      >
        <select id="schedule-session-kind" defaultValue={value}>
          <option value="regular">기본 상담</option>
          <option value="intake">인테이크</option>
        </select>
      </WireFormField>
      {showIntakeWarning && (
        <WireCallout tone="lavender" role="alert" title="이 당사자는 인테이크를 이미 마쳤습니다">
          그대로 진행하면 인테이크가 두 번이 됩니다.{' '}
          <a href="#prototype-only">기존 인테이크 기록 보기</a>
        </WireCallout>
      )}
    </div>
  );
}

/** 맞춤형 질문 카드 — 기본 상담(오른쪽 열)과 인테이크(단독)가 같은 부품. */
function QuestionsCard({ questions }: { questions: string[] }) {
  return (
    <WireCard
      className="wire-form-card"
      title={<>맞춤형 질문<p className="panel-meta">AI가 만드는 질문과 별개로, 이번 상담에서 직접 묻고 싶은 것을 적습니다.</p></>}
    >
      <div className="session-goal-list">
        {questions.map((question, index) => (
          <div key={index} className="session-goal-entry" data-kind="question">
            <div className="session-goal-field">
              <label className="session-goal-label" htmlFor={`custom-question-${index}`}>질문 {index + 1}</label>
              <div className="session-goal-input">
                <span className="wire-input-box" data-control="textarea">
                  <textarea
                    id={`custom-question-${index}`}
                    aria-label={`맞춤형 질문 ${index + 1}`}
                    rows={2}
                    defaultValue={question}
                  />
                </span>
                <WireRepeatActions
                  itemLabel="질문"
                  onAdd={index === questions.length - 1 ? noop : undefined}
                  onRemove={questions.length > 1 ? noop : undefined}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </WireCard>
  );
}

const CASE_GOALS = [
  { id: 'goal-1', title: '울타리대출 신청 완료' },
  { id: 'goal-2', title: '월 상환 계획 세우기' },
];

function ScheduleStep1({ kind }: { kind: 'regular' | 'intake' }) {
  const selected = kind === 'intake' ? CANDIDATES[1]! : CANDIDATES[0]!;
  return (
    <div className="wizard-stack">
      <WireSteps
        className="schedule-wizard-steps"
        current={1}
        steps={kind === 'intake'
          ? [{ label: '당사자 선택' }, { label: '맞춤형 질문' }]
          : [{ label: '당사자 선택' }, { label: '상담 목표와 맞춤형 질문' }]}
      />
      <div className="wizard-stack">
        <h2>당사자를 선택하세요</h2>
        <div className="schedule-candidate-list">
          {CANDIDATES.map((candidate) => (
            <div
              key={candidate.value}
              className="surface-card wire-row schedule-candidate-row schedule-candidate-item"
              data-selected={selected.value === candidate.value ? 'true' : undefined}
            >
              <button type="button" className="schedule-candidate-select">
                {candidateLabel(candidate)}
              </button>
              <WireButton variant="neutral" href="#prototype-only">
                당사자 정보
              </WireButton>
            </div>
          ))}
        </div>

        <div className="wizard-row">
          <div className="wire-form-grid">
            <SessionKindPicker hasIntake={selected.intakeAt !== null} value={kind} />
            <WireFormField label="상담 일시" htmlFor="schedule-scheduled-at">
              <DateTimePickerControl
                id="schedule-scheduled-at"
                fieldLabel="상담 일시"
                value={SCHEDULED_AT}
                onChange={noop}
              />
            </WireFormField>
          </div>
        </div>
        <div className="wizard-actions">
          <WireButton size="large" chevron>
            {kind === 'intake' ? '다음: 맞춤형 질문' : '다음: 이번 상담의 목표'}
          </WireButton>
        </div>
      </div>
    </div>
  );
}

function ScheduleStep2Regular() {
  const selected = CANDIDATES[0]!;
  const sessionGoals = [{ body: '울타리대출 신청에 필요한 서류 목록을 함께 확인한다.', caseGoalId: 'goal-1' }];
  const goalOptions = [
    { value: '', label: '연결 안 함' },
    ...CASE_GOALS.map((goal) => ({ value: goal.id, label: goal.title })),
  ];
  return (
    <div className="wizard-stack">
      <WireSteps
        className="schedule-wizard-steps"
        current={2}
        steps={[{ label: '당사자 선택' }, { label: '상담 목표와 맞춤형 질문' }]}
      />
      <div className="wizard-stack">
        <ContextBar candidate={selected} />
        <div className="wizard-goal-panel">
          <h2>이번 상담의 목표는 무엇인가요?</h2>
          <div className="card-grid">
            <WireCard title="세부 목표">
              <WireBullets items={CASE_GOALS.map((goal) => goal.title)} />
            </WireCard>
            <WireCard title="지난 상담 브리핑">
              <WireBullets items={[
                <span key="briefing" className="schedule-briefing-item">
                  <WireBadge tone="lavender">승인 요약</WireBadge>
                  {' '}카드대금 연체 1개월, 보증금 300만 원 소액대출 상담 의향을 확인했습니다. 다음 상담에서 신청 서류를 함께 준비합니다.
                </span>,
              ]} />
            </WireCard>
          </div>
          <div className="wire-form-grid">
            <WireCard className="wire-form-card">
              <div className="session-goal-list">
                {sessionGoals.map((goal, index) => (
                  <div key={index} className="session-goal-entry" data-testid={`session-goal-entry-${index}`}>
                    <WireFormField label="세부 목표 연결" control="select" htmlFor={`session-goal-case-${index}`} className="session-goal-link">
                      <select id={`session-goal-case-${index}`} defaultValue={goal.caseGoalId}>
                        {goalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </WireFormField>
                    <div className="session-goal-field">
                      <label className="session-goal-label" htmlFor={`session-goal-${index}`}>세션 목표 {index + 1}</label>
                      <div className="session-goal-input">
                        <span className="wire-input-box" data-control="textarea">
                          <textarea id={`session-goal-${index}`} rows={2} defaultValue={goal.body} />
                        </span>
                        <WireRepeatActions
                          itemLabel="목표"
                          onAdd={index === sessionGoals.length - 1 ? noop : undefined}
                          onRemove={sessionGoals.length > 1 ? noop : undefined}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </WireCard>
            <QuestionsCard questions={['월세 계약 갱신 시기와 보증금 부족액을 확인한다.']} />
          </div>
        </div>
        <div className="wizard-actions">
          <WireButton chevron="left">이전</WireButton>
          <WireButton size="large" icon={<Icon name="check" />}>완료</WireButton>
        </div>
      </div>
    </div>
  );
}

function ScheduleStep2Intake() {
  const selected = CANDIDATES[1]!;
  return (
    <div className="wizard-stack">
      <WireSteps
        className="schedule-wizard-steps"
        current={2}
        steps={[{ label: '당사자 선택' }, { label: '맞춤형 질문' }]}
      />
      <div className="wizard-stack">
        <ContextBar candidate={selected} />
        <QuestionsCard questions={['대출 목적과 가장 급하게 필요한 비용이 무엇인지 확인한다.']} />
        <div className="wizard-actions">
          <WireButton chevron="left">이전</WireButton>
          <WireButton size="large" icon={<Icon name="check" />}>완료</WireButton>
        </div>
      </div>
    </div>
  );
}

// ── 세션 목표 수정 (schedules/[scheduleId]/plan/session-plan-editor.tsx) ──────
function SessionPlanEdit() {
  const goals = [
    { body: '울타리대출 신청에 필요한 서류 목록을 함께 확인한다.', caseGoalId: 'goal-1' },
    { body: '월 상환액과 상환 유예 조건을 함께 정리한다.', caseGoalId: '' },
  ];
  const options = [
    { value: '', label: '연결 안 함' },
    { value: 'goal-1', label: '울타리대출 신청 완료' },
    { value: 'goal-2', label: '월 상환 계획 세우기' },
    { value: 'goal-3', label: '비상금 적립 시작 (종료됨)' },
  ];
  return (
    <>
      {/* 원본은 PageTitle·DraftStatus·저장 버튼이 한 .page-header 줄이다. 캡처에서는
          페이지 메타데이터 headerActions 가 제목 줄 오른쪽에 그린다. */}
      <WireCallout tone="info" title={`상담 일시: ${SCHEDULED_AT_LABEL}`}>
        일정 시작 전까지 수정할 수 있습니다. 시작 시각이 지나면 그날 계획의 기록으로 잠깁니다. <DraftRetentionNote />
      </WireCallout>
      <form id="session-plan-form" className="session-plan-stack">
        {goals.map((goal, index) => (
          <WireCardDetails
            key={index}
            open
            title={`세션 목표 ${index + 1}`}
            className="wire-form-card session-plan-card"
            testId={`session-goal-card-${index}`}
          >
            <div className="wire-form-grid">
              <div className="wizard-field">
                <WireFormField label="세부 목표 연결" control="select" htmlFor={`session-goal-case-${index}`}>
                  <select id={`session-goal-case-${index}`} name="sessionGoalCase" defaultValue={goal.caseGoalId}>
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </WireFormField>
                <WireRepeatActions
                  itemLabel="목표"
                  onAdd={index === goals.length - 1 ? noop : undefined}
                  onRemove={goals.length > 1 ? noop : undefined}
                />
              </div>
              <WireFormField label="목표 문장" control="textarea" htmlFor={`session-goal-${index}`}>
                <textarea
                  id={`session-goal-${index}`}
                  name="sessionGoalBody"
                  aria-label={`세션 목표 ${index + 1}`}
                  rows={4}
                  defaultValue={goal.body}
                />
              </WireFormField>
            </div>
          </WireCardDetails>
        ))}
      </form>
    </>
  );
}

// ── 당사자 기본정보 수정 (participants/[beneficiaryId]/edit) ─────────────────
function ParticipantBasicInfoEdit() {
  return (
    <>
      <ParticipantHeroCard
        name={PARTICIPANT.name}
        beneficiaryId={PARTICIPANT.beneficiaryId}
        nameSize="hub"
        details={[{ label: '당사자 ID', value: PARTICIPANT.beneficiaryId }]}
        actions={<WireButton type="submit" variant="primary" form="basic-info-form" icon={<Icon name="check" />}>저장</WireButton>}
      />
      <form id="basic-info-form">
        <div className="basic-info-stack">
          <WireCard className="wire-form-card" title={<h2>기본 정보</h2>}>
            <div className="wire-form-grid">
              <WireFormField label="이름" htmlFor="basicInfoName">
                <input id="basicInfoName" name="name" type="text" maxLength={100} defaultValue={PARTICIPANT.name} />
              </WireFormField>
              <WireFormField label="연락처" htmlFor="basicInfoPhone">
                <input id="basicInfoPhone" name="phone" type="tel" maxLength={32} defaultValue={PARTICIPANT.phone} />
              </WireFormField>
              <WireFormField label="이메일" htmlFor="basicInfoEmail">
                <input id="basicInfoEmail" name="email" type="email" maxLength={200} defaultValue={PARTICIPANT.email} />
              </WireFormField>
              <WireFormField label="생년월일" htmlFor="basicInfoBirthDate" hint={dateTextHint('1985-03-27')}>
                <DateTextInput
                  id="basicInfoBirthDate"
                  name="birthDate"
                  defaultValue={PARTICIPANT.birthDate}
                  autoComplete="bday"
                  describedBy="basicInfoBirthDate-hint"
                />
              </WireFormField>
            </div>
          </WireCard>
          <WireCard className="wire-form-card" title={<h2>추가 정보</h2>}>
            <div className="wire-form-grid">
              <WireFormField label="주소 또는 거주지역" htmlFor="basicInfoRegion">
                <input id="basicInfoRegion" name="region" type="text" maxLength={200} defaultValue={PARTICIPANT.region} />
              </WireFormField>
              <WireFormField label="성별" control="select" htmlFor="basicInfoGender">
                <select id="basicInfoGender" name="gender" defaultValue={PARTICIPANT.gender}>
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </WireFormField>
              <WireFormField
                label="계좌번호"
                htmlFor="basicInfoAccount"
                hint="지원금 입금 계좌입니다. 은행과 번호를 함께 적습니다."
              >
                <input id="basicInfoAccount" name="account" type="text" maxLength={100} defaultValue={PARTICIPANT.account} />
              </WireFormField>
              <WireFormField
                label="기타"
                note="(준비 중)"
                htmlFor="basicInfoEtc"
                hint="메모 칸은 준비 중입니다. 아직 저장되지 않습니다."
              >
                <input id="basicInfoEtc" name="etc" type="text" disabled />
              </WireFormField>
            </div>
          </WireCard>
        </div>
      </form>
    </>
  );
}

// ── 페이지 목록 ─────────────────────────────────────────────────────────────
export const pages = [
  {
    slug: 'participant-new',
    title: '당사자 등록',
    group: '당사자',
    source: 'apps/web/app/participants/new/register-form.tsx',
    content: <ParticipantRegister />,
    public: false,
  },
  {
    slug: 'participant-edit',
    title: '기본정보 수정',
    group: '당사자',
    source: 'apps/web/app/participants/[beneficiaryId]/edit/page.tsx + basic-info-form.tsx',
    content: <ParticipantBasicInfoEdit />,
    public: false,
  },
  {
    slug: 'intake-step-1',
    title: '인테이크 1단계 · 상담 신청 및 기본정보',
    heading: '인테이크',
    group: '인테이크 작성',
    source: 'apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-wizard.tsx',
    content: <IntakeStep step={1} />,
    public: false,
  },
  {
    slug: 'intake-step-2',
    title: '인테이크 2단계 · 현재 생활상황',
    heading: '인테이크',
    group: '인테이크 작성',
    source: 'apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-wizard.tsx',
    content: <IntakeStep step={2} />,
    public: false,
  },
  {
    slug: 'intake-step-3',
    title: '인테이크 3단계 · 필요한 도움과 활용 가능한 자원',
    heading: '인테이크',
    group: '인테이크 작성',
    source: 'apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-wizard.tsx',
    content: <IntakeStep step={3} />,
    public: false,
  },
  {
    slug: 'intake-step-4',
    title: '인테이크 4단계 · 상담 정리와 후속관리',
    heading: '인테이크',
    group: '인테이크 작성',
    source: 'apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-wizard.tsx',
    content: <IntakeStep step={4} />,
    public: false,
  },
  {
    slug: 'schedule-new-1',
    title: '상담 일정 등록 1단계 · 당사자 선택',
    heading: '상담 일정 등록',
    group: '상담 일정',
    source: 'apps/web/app/schedules/new/schedule-wizard.tsx',
    content: <ScheduleStep1 kind="regular" />,
    public: false,
  },
  {
    slug: 'schedule-new-2',
    title: '상담 일정 등록 2단계 · 상담 목표와 맞춤형 질문',
    heading: '상담 일정 등록',
    group: '상담 일정',
    source: 'apps/web/app/schedules/new/schedule-wizard.tsx',
    content: <ScheduleStep2Regular />,
    public: false,
  },
  {
    slug: 'schedule-new-intake-1',
    title: '상담 일정 등록 1단계 · 당사자 선택(인테이크)',
    heading: '상담 일정 등록',
    group: '상담 일정',
    source: 'apps/web/app/schedules/new/schedule-wizard.tsx',
    content: <ScheduleStep1 kind="intake" />,
    public: false,
  },
  {
    slug: 'schedule-new-intake-2',
    title: '상담 일정 등록 2단계 · 맞춤형 질문(인테이크)',
    heading: '상담 일정 등록',
    group: '상담 일정',
    source: 'apps/web/app/schedules/new/schedule-wizard.tsx',
    content: <ScheduleStep2Intake />,
    public: false,
  },
  {
    slug: 'schedule-plan-edit',
    title: '세션 목표 수정',
    group: '상담 일정',
    source: 'apps/web/app/schedules/[scheduleId]/plan/session-plan-editor.tsx',
    headerActions: (
      <div className="page-actions">
        <DraftStatus savedAt={DRAFT_SAVED_AT} available />
        <WireButton type="submit" variant="primary" form="session-plan-form" icon={<Icon name="check" />}>저장</WireButton>
      </div>
    ),
    content: <SessionPlanEdit />,
    public: false,
  },
];

// D88: 고르는 목록 안 카드 간격은 8px(--space-2). 일정 등록 후보 목록에만 적용한다.
export const css = `.capture-stack .schedule-candidate-list{gap:var(--space-2)}`;
