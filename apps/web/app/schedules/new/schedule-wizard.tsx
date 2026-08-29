'use client';

import { WireBadge } from '../../components/wire/wire-badge';
import { WireSteps } from '../../components/wire/wire-steps';
import Link from 'next/link';
import { useState } from 'react';
import { GridContainer } from '../../components/wire/grid-container';
import { WireCallout } from '../../components/wire/wire-callout';
import { PageTitle } from '../../components/wire/page-title';
import { ListRow } from '../../components/wire/list-row';
import { DateTimePickerControl, isCompleteDateTime } from '../../components/wire/date-picker-control';
import { WireFormField } from '../../components/wire/wire-form-field';
import { WireButton } from '../../components/wire/wire-button';
import { WireBullets, WireCard } from '../../components/wire/wire-card';
import { WireEmpty } from '../../components/wire/wire-state';
import { WireRepeatActions } from '../../components/wire/wire-repeat-actions';
import type {
  CreateSchedulePlanInput,
  CreateSchedulePlanResult,
  ScheduleContextResult,
} from '../../actions';

/** 기존 인테이크가 담긴 전체 상담 기록 경로. 경고에서 "그럼 그건 어디 있나"를 답한다.
 *  인테이크 확인·수정 화면 직행은 전체 상담 기록·당사자 정보의 입구만 갖는다(2026-08-08 Q
 *  — 구 records/intake 직행 대체). */
function intakeRecordHref(candidate: ScheduleWizardCandidate): string {
  return `/participants/${encodeURIComponent(candidate.beneficiaryId)}`
    + `/programs/${encodeURIComponent(candidate.supportCaseId)}/records`;
}

export interface ScheduleWizardCandidate {
  value: string;
  beneficiaryId: string;
  supportCaseId: string;
  programLabel: string;
  /** 인테이크 완료 시각. null 이면 상담 유형 기본값이 '인테이크'가 된다 (D35 §5). */
  intakeAt: string | null;
  // D31·D24: 선택 UI 는 실명·연락처·이메일로 표시한다(사업명 대신). 미기입은 null.
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
}

// D31: 당사자 행 라벨 — 실명·가명 ID·연락처·이메일 순. 실명이 없으면 가명 슬러그가 이름
// 자리에 서고, 비어 있는 필드는 조각을 그리지 않는다(구 MetaRow 필터와 같은 규칙).
// 가명 ID 는 다른 당사자 카드·HERO 와 같은 공용 .participant-card-id 조각이다(회색 12/400
// --sub, 2026-08-28 Q "당사자 카드 디자인 통일" — 구 2026-08-09 mint 컬러 전용 클래스 대체).
// 이름이 없어 ID 가 이름 자리에 선 경우는 같은 값을 두 번 적지 않는다(D31 폴백 변형).
// 굵기는 당사자 카드와 같은 계약이다(2026-08-07 Q "텍스트 weight 수정") — 이름만 600,
// 나머지 값은 행 기본 400. 행 자체의 400 은 .schedule-candidate-row 가 갖는다.
// 2026-08-29 Q "카드끼리 같은 정보 세로 정렬": 조각마다 열 클래스를 달아 선택 목록에서는
// 고정폭 격자(layout.tsx .schedule-candidate-select>.wire-meta-row)에 오르고, 2단계 맥락
// 바에서는 종전 인라인 메타 줄 그대로다. MetaRow 부품 대신 같은 .wire-meta-row 계약을
// 직접 그린다 — 부품은 조각을 익명 span 으로 감싸 열을 지정할 수 없다.

function candidateLabel(candidate: ScheduleWizardCandidate) {
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

export interface ScheduleWizardProps {
  candidates: ScheduleWizardCandidate[];
  loadContext: (beneficiaryId: string, supportCaseId: string) => Promise<ScheduleContextResult>;
  submit: (input: CreateSchedulePlanInput) => Promise<CreateSchedulePlanResult>;
  preselectValue?: string;
  /** 도착 안내 한 줄(예: 당사자 등록 완료). 서버 페이지가 notice 쿼리를 읽어 문장으로 넘긴다. */
  noticeText?: string;
}

interface SessionGoalDraft {
  body: string;
  caseGoalId: string;
}

interface StepContext {
  caseGoals: Array<{ id: string; title: string }>;
  lastBriefing: { source: 'ai' | 'memo'; text: string } | null;
}

const NOTICE_MESSAGES: Record<string, string> = {
  invalid_request: '입력한 정보를 다시 확인하세요.',
  validation_error: '입력한 정보를 다시 확인하세요.',
  access_denied: '담당 중인 케이스에만 상담을 등록할 수 있습니다.',
  forbidden: '담당 중인 케이스에만 상담을 등록할 수 있습니다.',
  not_found: '선택한 당사자를 찾을 수 없습니다.',
  conflict: '이미 처리된 요청입니다. 다시 확인하세요.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 상담을 등록할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function messageFor(status: string): string {
  return NOTICE_MESSAGES[status] ?? '상담을 등록하지 못했습니다.';
}

// 2026-08-09 Q: 이 화면의 인라인 스타일 객체 8종을 공용 클래스로 옮겼다. guard:tokens 는
// layout.tsx·wire-styles.ts 두 파일만 훑으므로 인라인 값은 검사 밖이었고, 실제로 제목이
// 계단에 없는 20px 로 서 있었다(다른 화면 h2 는 18). 대응은 아래와 같다.
//   stackStyle → .wizard-stack · headingStyle → 그냥 h2(전역 18/600) · labelStyle·inputStyle·
//   textareaStyle → WireFormField(§5 입력칸 계약) · captionStyle → .panel-meta ·
//   errorStyle → .wire-field-error · rowActionsStyle → .wizard-actions
// inputStyle 은 선언만 있고 쓰는 곳이 없어 함께 지웠다.

/**
 * 상담 유형 (D35 · ADR-0014 §5). 케이스 상태가 기본값을 잡는다 — 인테이크가 없으면
 * '인테이크', 있으면 '기본 상담'이다.
 *
 * **2026-08-09 Q: 선택창 하나다**(구 '값 + 안내문 + 다른 유형 선택 버튼' 접힘 구조 대체).
 * 구 구조는 라벨·값·안내문·버튼 네 줄이 같은 위계로 쌓여 §2-2 규칙 1·2 를 정면으로 어겼고,
 * 실제로 화면에서 '기본 상담'이라는 낱말이 세 번 겹쳐 나왔다(값 · 안내문 · 선택창). 값을
 * 보여 주는 자리와 고치는 자리를 하나로 합치면 그 겹침이 함께 사라진다. 기본값 자동 판정은
 * 그대로이고, 왜 그 값인지는 선택창 아래 도움말 한 줄(12px)이 말한다.
 *
 * 이미 인테이크가 있는 케이스에서 인테이크를 다시 고르면 **경고와 기존 기록 링크**가 뜨되
 * **선택 자체를 막지 않는다**(CCC-14 의 "차단이 아니라 경고" 결정 유지 — 장기 중단 후 재개로
 * 인테이크를 다시 해야 할 때 우회로가 없어진다). 저장 시점의 "케이스당 인테이크 1회" 검사는
 * 게이트웨이에 그대로 있다.
 */
function SessionKindPicker({
  hasIntake,
  value,
  onChange,
  recordHref,
}: {
  hasIntake: boolean;
  value: 'regular' | 'intake';
  onChange: (kind: 'regular' | 'intake') => void;
  recordHref: string;
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
        <select
          id="schedule-session-kind"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value === 'intake' ? 'intake' : 'regular')}
        >
          <option value="regular">기본 상담</option>
          <option value="intake">인테이크</option>
        </select>
      </WireFormField>
      {showIntakeWarning && (
        <WireCallout tone="lavender" role="alert" title="이 당사자는 인테이크를 이미 마쳤습니다">
          그대로 진행하면 인테이크가 두 번이 됩니다.{' '}
          <Link href={recordHref}>기존 인테이크 기록 보기</Link>
        </WireCallout>
      )}
    </div>
  );
}

export function ScheduleWizard({ candidates, loadContext, submit, preselectValue, noticeText }: ScheduleWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const preselected = candidates.find((candidate) => candidate.value === preselectValue) ?? null;
  const [selected, setSelected] = useState<ScheduleWizardCandidate | null>(preselected);
  const [scheduledAt, setScheduledAt] = useState('');
  const [context, setContext] = useState<StepContext | null>(null);
  const [sessionGoals, setSessionGoals] = useState<SessionGoalDraft[]>([{ body: '', caseGoalId: '' }]);
  const [customQuestions, setCustomQuestions] = useState<string[]>(['']);
  // 상담 유형(#36): 'intake' 면 Step2 가 세션 목표 대신 케이스 목표(D12) 입력으로 갈린다.
  // 기본값은 케이스 상태가 정한다(D35 §5) — 상담 카드에서 당사자를 미리 지정해 들어온
  // 경로(preselectValue)도 같은 규칙을 타야 한다. 'regular' 로 고정하면 인테이크가 없는
  // 당사자에게 기본 상담이 잡힌다.
  const [sessionKind, setSessionKind] = useState<'regular' | 'intake'>(
    preselected !== null && preselected.intakeAt === null ? 'intake' : 'regular',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const goalOptions = [
    { value: '', label: '연결 안 함' },
    ...(context?.caseGoals ?? []).map((goal) => ({ value: goal.id, label: goal.title })),
  ];

  /**
   * 당사자를 고르면 상담 유형 기본값이 그 케이스의 인테이크 유무로 정해진다
   * (D35 · ADR-0014 §5). 당사자를 바꾸면 기본값도 다시 잡는다 — 앞 당사자 기준으로
   * 고른 유형이 남으면 인테이크가 끝난 사람에게 인테이크가 잡히는 식으로 어긋난다.
   */
  function selectCandidate(candidate: ScheduleWizardCandidate) {
    setSelected(candidate);
    setSessionKind(candidate.intakeAt === null ? 'intake' : 'regular');
    setError(null);
  }

  async function goToGoals() {
    if (selected === null || !isCompleteDateTime(scheduledAt)) {
      setError('당사자와 상담 일시를 먼저 선택하세요.');
      return;
    }
    // 인테이크는 세션 목표를 연결할 기존 목표가 아직 없으므로 참고 데이터를 부르지 않고,
    // 목표 입력 단계도 없다(CCC-64). 맞춤형 질문으로 바로 간다.
    if (sessionKind === 'intake') {
      setError(null);
      setStep(2);
      return;
    }
    setBusy(true);
    const result = await loadContext(selected.beneficiaryId, selected.supportCaseId);
    setBusy(false);
    if (result.status !== 'loaded') {
      setError(messageFor(result.status));
      return;
    }
    setContext({ caseGoals: result.caseGoals, lastBriefing: result.lastBriefing });
    setError(null);
    setStep(2);
  }

  async function complete() {
    if (selected === null) return;
    setBusy(true);
    const result = await submit({
      beneficiaryId: selected.beneficiaryId,
      supportCaseId: selected.supportCaseId,
      scheduledAt,
      sessionKind,
      sessionGoals: sessionGoals.map((goal) => ({
        body: goal.body,
        caseGoalId: goal.caseGoalId.length === 0 ? null : goal.caseGoalId,
      })),
      customQuestions,
    });
    setBusy(false);
    if (result.status !== 'created') {
      setError(messageFor(result.status));
      return;
    }
    setError(null);
    setCreated(true);
  }

  const contextBar = selected !== null
    ? <ListRow selected className="schedule-candidate-row">{candidateLabel(selected)}</ListRow>
    : null;

  // 맞춤형 질문 입력 묶음 — 병합된 2단계에서 기본 상담은 목표 옆 열로, 인테이크는 단독으로
  // 같은 UI 를 쓴다(2026-08-28 Q item ②·③, 구 별도 3단계 대체). 한 곳에 두어 두 경로가
  // 갈리지 않게 한다.
  const customQuestionsList = (
    <div className="session-goal-list">
      {customQuestions.map((question, index) => (
        <div key={index} className="session-goal-entry" data-kind="question">
          <div className="session-goal-field">
            <label className="session-goal-label" htmlFor={`custom-question-${index}`}>질문 {index + 1}</label>
            <div className="session-goal-input">
              <span className="wire-input-box" data-control="textarea">
                <textarea
                  id={`custom-question-${index}`}
                  aria-label={`맞춤형 질문 ${index + 1}`}
                  rows={2}
                  value={question}
                  onChange={(event) => setCustomQuestions((prev) => prev.map(
                    (item, itemIndex) => (itemIndex === index ? event.target.value : item),
                  ))}
                />
              </span>
              <WireRepeatActions
                itemLabel="질문"
                onAdd={index === customQuestions.length - 1
                  ? () => setCustomQuestions((prev) => [...prev, ''])
                  : undefined}
                onRemove={customQuestions.length > 1
                  ? () => setCustomQuestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                  : undefined}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // 맞춤형 질문 카드 — 기본 상담(목표 옆 열)과 인테이크(단독)가 같은 부품을 쓴다(자리가
  // 갈리지 않게). 설명은 제목 슬롯에 두어 본문이 바로 질문 목록으로 시작한다 — 본문 첫 줄에
  // p 를 두면 전역 p 위 마진 8 이 얹혀 옆 카드 시작선과 어긋난다(검수 반영).
  const questionsCard = (
    <WireCard
      className="wire-form-card"
      title={<>맞춤형 질문<p className="panel-meta">AI가 만드는 질문과 별개로, 이번 상담에서 직접 묻고 싶은 것을 적습니다.</p></>}
    >
      {customQuestionsList}
    </WireCard>
  );

  if (created) {
    return (
      <GridContainer as="main" className="page-content">
        <div className="page-header"><PageTitle>상담 일정 등록</PageTitle></div>
        <div className="wizard-stack">
          {contextBar}
          {/* 기록 템플릿 안내 카드는 삭제했다(2026-08-08 일괄 검토 A2) — GAS 는 D43 보류,
              AI 템플릿 조립은 D52 보류라 안내할 기능이 없다. */}
          <h2>등록을 완료했어요</h2>
          <div className="wizard-actions"><WireButton size="large" chevron href="/">일정으로</WireButton></div>
        </div>
      </GridContainer>
    );
  }

  return (
    // 셸(장폭·좌우 여백·섹션 gap)은 .page-content 가 갖는다 — 구 구조는 main 안에 GridContainer
    // 를, 그 안에 또 gap 20 짜리 div 를 두어 세로 간격이 24/24/20 세 겹으로 겹쳐 있었다.
    // 다른 화면(15초 페이지·상담 기록·기록 작성)과 같은 한 겹으로 맞춘다(§4-6 규칙 3).
    <GridContainer as="main" className="page-content">
      <div className="page-header"><PageTitle>상담 일정 등록</PageTitle></div>
      <div className="wizard-stack">
        {noticeText !== undefined && (
      <WireBadge role="status" aria-live="polite">{noticeText}</WireBadge>
        )}
        {/* 기본 상담·인테이크 모두 2단계다(2026-08-28 Q, 구 인테이크 2·기본 3단계 대체 —
            목표와 맞춤형 질문을 한 단계 2열로 합쳤다). 인테이크는 목표 칸이 없어 두 번째가
            맞춤형 질문 하나다. CCC-81 단계 부품을 쓴다. */}
        <WireSteps
          className="schedule-wizard-steps"
          current={step}
          steps={sessionKind === 'intake'
            ? [{ label: '당사자 선택' }, { label: '맞춤형 질문' }]
            : [{ label: '당사자 선택' }, { label: '상담 목표' }]}
        />
        {error !== null ? <p role="alert" className="wire-field-error">{error}</p> : null}

        {step === 1 ? (
          /* 1단계 순서는 **당사자 → 상담 유형 → 일시**다 (D35 · ADR-0014 §5).
             당사자가 정해지기 전에는 뒤 항목을 보이지 않는다 — 상담 유형 기본값이
             그 케이스의 인테이크 유무로 갈리므로, 당사자를 모르면 물어볼 수 없다.
             삭제한 것: **기관·참여 사업 선택**(사이드바 워크스페이스가 이미 정한 값을
             다시 묻는 중복). 숨긴 것: **상담 방법**(현재 '대면' 하나뿐 — D4. 선택지가
             늘면 되살린다). */
          <div className="wizard-stack">
            <h2>당사자를 선택하세요</h2>
            {candidates.length === 0 ? (
              <WireEmpty>담당 중인 활성 참여 사업이 없습니다. 당사자를 먼저 등록하세요.</WireEmpty>
            ) : (
              /* 후보 목록은 낱개 카드라 폭을 다 쓴다 — .wizard-form(520) 밖이다. */
              <div className="schedule-candidate-list">
                {candidates.map((candidate) => (
                  /* 카드가 곧 행이고 '당사자 정보' 버튼도 카드 안 오른쪽 끝이다(2026-08-09 Q
                     "버튼도 카드 안에, 카드는 full-width" — 구 행 밖 형제 버튼 대체).
                     행 전체를 button 으로 두면 안에 링크를 넣을 수 없으므로(버튼 속 버튼),
                     카드 = div, 고르기 = 안쪽 flex:1 버튼, 보기 = 링크 형제로 가른다 —
                     클릭 하나가 두 뜻을 갖지 않는 것은 그대로다. */
                  <div
                    key={candidate.value}
                    className="surface-card wire-row schedule-candidate-row schedule-candidate-item"
                    data-selected={selected?.value === candidate.value ? 'true' : undefined}
                  >
                    <button type="button" className="schedule-candidate-select" onClick={() => selectCandidate(candidate)}>
                      {candidateLabel(candidate)}
                    </button>
                    <WireButton variant="neutral" href={`/participants/${encodeURIComponent(candidate.beneficiaryId)}`}>
                      당사자 정보
                    </WireButton>
                  </div>
                ))}
              </div>
            )}

            {selected !== null && (
              /* 상담 유형·상담 일시는 **나란히 선다**(2026-08-09 Q). 둘 다 "이 상담이
                 무엇이고 언제인가"라는 한 묶음이라 세로로 쌓을 이유가 없었고, 세로로 두면
                 유형 칸의 도움말이 일시 라벨과 붙어 §2-2 규칙 1(연속 금지)에 걸린다.
                 767 미만은 .wire-form-grid 가 한 열로 접는다 — 새 격자를 만들지 않는다. */
              <div className="wizard-row">
                <div className="wire-form-grid">
                  <SessionKindPicker
                    hasIntake={selected.intakeAt !== null}
                    value={sessionKind}
                    onChange={(kind) => { setSessionKind(kind); setError(null); }}
                    recordHref={intakeRecordHref(selected)}
                  />
                  {/* D48: 네이티브 datetime-local 은 표기가 보는 사람의 브라우저 언어를 따라
                      팀원마다 달랐다(R6). 상담은 요일로 잡는 값이라 달력이 맞는 자리다(KRDS).
                      WireFormField 로 감싼다(2026-08-05) — 맨몸으로 두면 .wire-input-box 의
                      테두리·포커스 링이 없어 입력칸이 입력칸으로 보이지 않았다(기록 작성 화면과
                      같은 조합). */}
                  <WireFormField label="상담 일시" htmlFor="schedule-scheduled-at">
                    <DateTimePickerControl
                      id="schedule-scheduled-at"
                      fieldLabel="상담 일시"
                      value={scheduledAt}
                      onChange={setScheduledAt}
                    />
                  </WireFormField>
                </div>
              </div>
            )}
            <div className="wizard-actions">
              <WireButton size="large" chevron disabled={busy || selected === null || !isCompleteDateTime(scheduledAt)} onClick={goToGoals}>
                {sessionKind === 'intake' ? '다음: 맞춤형 질문' : '다음: 이번 상담의 목표'}
              </WireButton>
            </div>
            {selected === null || !isCompleteDateTime(scheduledAt) ? (
              <p className="panel-meta">
                {selected === null
                  ? '당사자를 선택하세요.'
                  : '상담 일시를 선택하면 다음으로 넘어갈 수 있습니다.'}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 인테이크 경로의 구 2단계('상담의 목표는 무엇인가요?', 필수 1~3개)는 없앴다
            (CCC-64, 2026-08-08 Q 결정). 그 값은 goals 표로 들어가는데 D43 이 그 층을 보류해
            읽는 화면이 없었다. 일정을 잡는 시점은 아직 당사자를 만나기 전이라, 목표를 미리
            지어내게 하는 것 자체가 순서에 맞지 않는다. 목표는 첫 상담에서 대화로 정해
            브리핑의 '전체 목표'에 적는다(D45). 인테이크는 이제 1단계에서 맞춤형 질문으로
            바로 넘어간다. */}

        {step === 2 ? (
          <div className="wizard-stack">
            {contextBar}
            {sessionKind === 'regular' ? (
              /* item ③(2026-08-28 Q): hero 카드와 목표 물음 사이 가로선을 없애고, '이번 상담의
                 목표는 무엇인가요?' 를 한 div 로 감싸 하위목표(세부 목표)·지난 브리핑·세부 목표
                 연결까지 그 안에 둔다(구 .wizard-section-head border-top 대체). 패널은 카드가
                 아니라 플랫 div 다 — 안에 WireCard 가 들어가 카드 속 카드가 되면 안 되기 때문. */
              <div className="wizard-goal-panel">
                <h2>이번 상담의 목표는 무엇인가요?</h2>
                {/* 참고 카드 2장은 읽는 자료라 폭을 다 쓴다. .card-grid 가 같은 줄 카드를
                    stretch 로 편다(높이 맞춤). */}
                <div className="card-grid">
                  {/* D62 용어(CCC-70): 선택창에는 활성 세부 목표만 올린다. */}
                  <WireCard title="세부 목표">
                    {(context?.caseGoals ?? []).length === 0 ? (
                      <WireEmpty>등록된 세부 목표가 없습니다.</WireEmpty>
                    ) : (
                      <WireBullets items={(context?.caseGoals ?? []).map((goal) => goal.title)} />
                    )}
                  </WireCard>
                  <WireCard title="지난 상담 브리핑">
                    {/* 출처는 배지로 가른다 — 수기 = 무채색, 승인 요약 = 라벤더(AI 축, D34). */}
                    {context?.lastBriefing === null || context?.lastBriefing === undefined
                      ? <WireEmpty>지난 상담 기록이 없습니다.</WireEmpty>
                      : <WireBullets items={[
                        <span key="briefing" className="schedule-briefing-item">
                          {context.lastBriefing.source === 'ai'
                            ? <WireBadge tone="lavender">승인 요약</WireBadge>
                            : <WireBadge>수기</WireBadge>}
                          {' '}{context.lastBriefing.text}
                        </span>,
                      ]} />}
                  </WireCard>
                </div>
                {/* item ②(2026-08-28 Q): 세부 목표 연결·세션 목표 칸을 반으로 줄여 맞춤형 질문과
                    2열로 둔다(구 별도 3단계 대체 — 단계 축소). .wire-form-grid 가 같은 폭 두 칸을
                    만들고 767 미만에서 한 열로 접는다. 두 칸 다 카드 안 body 20 을 쓴다. */}
                <div className="wire-form-grid">
                  <WireCard className="wire-form-card">
                    <div className="session-goal-list">
                      {sessionGoals.map((goal, index) => (
                      <div key={index} className="session-goal-entry" data-testid={`session-goal-entry-${index}`}>
                        <WireFormField label="세부 목표 연결" control="select" htmlFor={`session-goal-case-${index}`} className="session-goal-link">
                          <select
                            id={`session-goal-case-${index}`}
                            value={goal.caseGoalId}
                            onChange={(event) => {
                              // currentTarget 은 이벤트 디스패치가 끝나면 null 이 된다. 상태
                              // 업데이터가 나중에 돌므로 값을 먼저 집어 둔다(CCC-70).
                              const value = event.currentTarget.value;
                              setSessionGoals((prev) => prev.map(
                                (item, itemIndex) => (itemIndex === index ? { ...item, caseGoalId: value } : item),
                              ));
                            }}
                          >
                            {goalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </WireFormField>
                        <div className="session-goal-field">
                          <label className="session-goal-label" htmlFor={`session-goal-${index}`}>세션 목표 {index + 1}</label>
                          <div className="session-goal-input">
                            <span className="wire-input-box" data-control="textarea">
                              <textarea
                                id={`session-goal-${index}`}
                                rows={2}
                                value={goal.body}
                                onChange={(event) => setSessionGoals((prev) => prev.map(
                                  (item, itemIndex) => (itemIndex === index ? { ...item, body: event.target.value } : item),
                                ))}
                              />
                            </span>
                            <WireRepeatActions
                              itemLabel="목표"
                              onAdd={index === sessionGoals.length - 1
                                ? () => setSessionGoals((prev) => [...prev, { body: '', caseGoalId: '' }])
                                : undefined}
                              onRemove={sessionGoals.length > 1
                                ? () => setSessionGoals((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                                : undefined}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>
                  </WireCard>
                  {questionsCard}
                </div>
              </div>
            ) : (
              /* 인테이크는 연결할 세부 목표가 아직 없어 목표 칸이 없다(CCC-64). 맞춤형 질문
                 카드만 선다 — 기본 상담의 오른쪽 열과 같은 부품이라 자리가 갈리지 않는다. */
              questionsCard
            )}
            <div className="wizard-actions">
              <WireButton chevron="left" onClick={() => { setError(null); setStep(1); }}>이전</WireButton>
              <WireButton size="large" disabled={busy} onClick={complete}>완료</WireButton>
            </div>
          </div>
        ) : null}
      </div>
    </GridContainer>
  );
}
