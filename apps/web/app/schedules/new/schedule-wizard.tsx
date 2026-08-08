'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GridContainer } from '../../components/wire/grid-container';
import { WireCallout } from '../../components/wire/wire-callout';
import { MetaRow } from '../../components/wire/meta-row';
import { PageTitle } from '../../components/wire/page-title';
import { ListRow } from '../../components/wire/list-row';
import { SearchInput } from '../../components/wire/search-input';
import { DateTimePickerControl, isCompleteDateTime } from '../../components/wire/date-picker-control';
import { WireFormField } from '../../components/wire/wire-form-field';
import { WireButton } from '../../components/wire/wire-button';
import { WireBullets, WireCard } from '../../components/wire/wire-card';
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

// D31: 당사자 행 라벨 — 실명·연락처·이메일 순. 실명이 없으면 가명 슬러그로 폴백하고,
// 비어 있는 필드는 MetaRow 가 거른다(예: 연락처만 있으면 "제비-003" "010-0000-0000" 두 노드).
// 굵기는 당사자 카드와 같은 계약이다(2026-08-07 Q "텍스트 weight 수정") — 이름만 600,
// 나머지 값은 행 기본 400. 행 자체의 400 은 .schedule-candidate-row 가 갖는다.
function candidateLabel(candidate: ScheduleWizardCandidate) {
  return (
    <MetaRow items={[
      <span key="name" className="schedule-candidate-name">
        {candidate.participantName ?? candidate.beneficiaryId}
      </span>,
      candidate.participantPhone,
      candidate.participantEmail,
    ]} />
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
 * 상담 유형 (D35 · ADR-0014 §5). **케이스 상태로 기본값을 잡고 다른 유형은 접는다** —
 * 인테이크가 없으면 '인테이크', 있으면 '기본 상담'이 기본이다. 평소에는 고를 일이 없고,
 * 필요할 때만 펼치면 된다.
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
  const defaultKind: 'regular' | 'intake' = hasIntake ? 'regular' : 'intake';
  const [open, setOpen] = useState(false);
  const showIntakeWarning = hasIntake && value === 'intake';

  return (
    <div className="schedule-kind">
      <div className="schedule-kind-value">
        <span className="wire-form-label">상담 유형</span>
        <strong className="schedule-kind-name">{value === 'intake' ? '인테이크' : '기본 상담'}</strong>
        <span className="panel-meta">
          {defaultKind === 'intake'
            ? '아직 인테이크 기록이 없어 인테이크로 잡았습니다.'
            : '인테이크가 끝난 당사자라 기본 상담으로 잡았습니다.'}
        </span>
      </div>
      {open ? (
        <div className="schedule-kind-picker">
          <SearchInput
            label="상담 유형 선택하기"
            variant="select"
            value={value}
            options={[
              { value: 'regular', label: '기본 상담' },
              { value: 'intake', label: '인테이크' },
            ]}
            onChange={(next) => onChange(next === 'intake' ? 'intake' : 'regular')}
          />
          {showIntakeWarning && (
            <WireCallout tone="lavender" role="alert" title="이 당사자는 인테이크를 이미 마쳤습니다">
              그대로 진행하면 인테이크가 두 번이 됩니다.{' '}
              <Link href={recordHref}>기존 인테이크 기록 보기</Link>
            </WireCallout>
          )}
        </div>
      ) : (
        <WireButton onClick={() => setOpen(true)}>다른 유형 선택</WireButton>
      )}
    </div>
  );
}

export function ScheduleWizard({ candidates, loadContext, submit, preselectValue, noticeText }: ScheduleWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const [caseGoals, setCaseGoals] = useState<string[]>(['']);
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
    // 인테이크는 케이스 목표를 새로 만드는 흐름이라 기존 목표·브리핑 참고 데이터가 필요 없다.
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
    if (sessionKind === 'intake' && caseGoals.every((goal) => goal.trim().length === 0)) {
      setError('상담의 목표를 측정 가능한 문장으로 최소 한 개 입력하세요.');
      return;
    }
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
      caseGoals,
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

  if (created) {
    return (
      <GridContainer as="main" className="page-content">
        <div className="page-header"><PageTitle>상담 일정 등록</PageTitle></div>
        <div className="wizard-stack">
          {contextBar}
          {/* 기록 템플릿 안내 카드는 삭제했다(2026-08-08 일괄 검토 A2) — GAS 는 D43 보류,
              AI 템플릿 조립은 D52 보류라 안내할 기능이 없다. */}
          <h2>등록을 완료했어요</h2>
          <div className="wizard-actions"><WireButton size="large" chevron href="/">다가오는 일정으로</WireButton></div>
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
          <p className="wire-badge" data-tone="blue" role="status" aria-live="polite">{noticeText}</p>
        )}
        <p className="panel-meta">{step} / 3 단계</p>
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
              <p className="panel-meta">담당 중인 활성 참여 사업이 없습니다. 당사자를 먼저 등록하세요.</p>
            ) : (
              /* 후보 목록은 낱개 카드라 폭을 다 쓴다 — .wizard-form(520) 밖이다. */
              <div className="schedule-candidate-list">
                {candidates.map((candidate) => (
                  <ListRow
                    key={candidate.value}
                    className="schedule-candidate-row"
                    selected={selected?.value === candidate.value}
                    onClick={() => selectCandidate(candidate)}
                  >
                    {candidateLabel(candidate)}
                  </ListRow>
                ))}
              </div>
            )}

            {selected !== null && (
              <div className="wizard-form">
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
            )}
            <div className="wizard-actions">
              <WireButton size="large" chevron disabled={busy || selected === null || !isCompleteDateTime(scheduledAt)} onClick={goToGoals}>
                {sessionKind === 'intake' ? '다음: 상담 목표' : '다음: 이번 상담의 목표'}
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

        {step === 2 && sessionKind === 'intake' ? (
          <div className="wizard-stack">
            {contextBar}
            <h2>상담의 목표는 무엇인가요?</h2>
            <p className="panel-meta">
              측정 가능한 문장으로 적습니다. 예: “월 5만원 저축을 3개월 유지한다”. 최대 3개까지 추가할 수 있어요.
            </p>
            <div className="wizard-form">
              {caseGoals.map((goal, index) => (
                <div key={index} className="wizard-field">
                  <WireFormField label={`상담 목표 ${index + 1}`} control="textarea" htmlFor={`case-goal-${index}`}>
                    <textarea
                      id={`case-goal-${index}`}
                      aria-label={`상담 목표 ${index + 1}`}
                      rows={4}
                      value={goal}
                      onChange={(event) => setCaseGoals((prev) => prev.map(
                        (item, itemIndex) => (itemIndex === index ? event.target.value : item),
                      ))}
                    />
                  </WireFormField>
                  {caseGoals.length > 1 ? (
                    <div className="wizard-actions">
                      <WireButton
                        onClick={() => setCaseGoals((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        이 목표 삭제
                      </WireButton>
                    </div>
                  ) : null}
                </div>
              ))}
              {caseGoals.length < 3 ? (
                <div className="wizard-actions">
                  <WireButton onClick={() => setCaseGoals((prev) => [...prev, ''])}>추가하기</WireButton>
                </div>
              ) : null}
            </div>
            <div className="wizard-actions">
              <WireButton onClick={() => { setError(null); setStep(1); }}>이전</WireButton>
              <WireButton size="large" chevron onClick={() => { setError(null); setStep(3); }}>
                다음: 맞춤형 질문
              </WireButton>
            </div>
          </div>
        ) : null}

        {step === 2 && sessionKind === 'regular' ? (
          <div className="wizard-stack">
            {contextBar}
            <h2>이번 상담의 목표는 무엇인가요?</h2>
            {/* 참고 카드 2장은 읽는 자료라 폭을 다 쓴다 — 입력 묶음(.wizard-form 520)과 다른 축이다. */}
            <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
              <div className="wire-col-6">
                <WireCard title="상담별 목표">
                  {(context?.caseGoals ?? []).length === 0 ? (
                    <p className="panel-meta">등록된 케이스 목표가 없습니다.</p>
                  ) : (
                    <WireBullets items={(context?.caseGoals ?? []).map((goal) => goal.title)} />
                  )}
                </WireCard>
              </div>
              <div className="wire-col-6">
                <WireCard title="지난 상담 브리핑">
                  <p className="panel-meta">
                    {context?.lastBriefing === null || context?.lastBriefing === undefined
                      ? '지난 상담 기록이 없습니다.'
                      : <MetaRow items={[context.lastBriefing.source === 'ai' ? '승인 요약' : '수기 메모', context.lastBriefing.text]} />}
                  </p>
                </WireCard>
              </div>
            </div>
            <div className="wizard-form">
              {sessionGoals.map((goal, index) => (
                <div key={index} className="wizard-field">
                  <WireFormField label={`세션 목표 ${index + 1}`} control="textarea" htmlFor={`session-goal-${index}`}>
                    <textarea
                      id={`session-goal-${index}`}
                      aria-label={`세션 목표 ${index + 1}`}
                      rows={4}
                      value={goal.body}
                      onChange={(event) => setSessionGoals((prev) => prev.map(
                        (item, itemIndex) => (itemIndex === index ? { ...item, body: event.target.value } : item),
                      ))}
                    />
                  </WireFormField>
                  <SearchInput
                    label="케이스 목표 연결"
                    variant="select"
                    value={goal.caseGoalId}
                    options={goalOptions}
                    onChange={(value) => setSessionGoals((prev) => prev.map(
                      (item, itemIndex) => (itemIndex === index ? { ...item, caseGoalId: value } : item),
                    ))}
                  />
                  {sessionGoals.length > 1 ? (
                    <div className="wizard-actions">
                      <WireButton
                        onClick={() => setSessionGoals((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        이 목표 삭제
                      </WireButton>
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="wizard-actions">
                <WireButton onClick={() => setSessionGoals((prev) => [...prev, { body: '', caseGoalId: '' }])}>
                  추가하기
                </WireButton>
              </div>
            </div>
            <div className="wizard-actions">
              <WireButton onClick={() => { setError(null); setStep(1); }}>이전</WireButton>
              <WireButton size="large" chevron onClick={() => { setError(null); setStep(3); }}>
                다음: 맞춤형 질문
              </WireButton>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="wizard-stack">
            {contextBar}
            <h2>맞춤형 질문</h2>
            <p className="panel-meta">AI가 만드는 질문과 별개로, 이번 상담에서 직접 묻고 싶은 것을 적습니다.</p>
            <div className="wizard-form">
              {customQuestions.map((question, index) => (
                <div key={index} className="wizard-field">
                  <WireFormField label={`질문 ${index + 1}`} control="textarea" htmlFor={`custom-question-${index}`}>
                    <textarea
                      id={`custom-question-${index}`}
                      aria-label={`맞춤형 질문 ${index + 1}`}
                      rows={4}
                      value={question}
                      onChange={(event) => setCustomQuestions((prev) => prev.map(
                        (item, itemIndex) => (itemIndex === index ? event.target.value : item),
                      ))}
                    />
                  </WireFormField>
                  {customQuestions.length > 1 ? (
                    <div className="wizard-actions">
                      <WireButton
                        onClick={() => setCustomQuestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        이 질문 삭제
                      </WireButton>
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="wizard-actions">
                <WireButton onClick={() => setCustomQuestions((prev) => [...prev, ''])}>추가하기</WireButton>
              </div>
            </div>
            <div className="wizard-actions">
              <WireButton onClick={() => { setError(null); setStep(2); }}>이전</WireButton>
              <WireButton size="large" chevron disabled={busy} onClick={complete}>완료</WireButton>
            </div>
          </div>
        ) : null}
      </div>
    </GridContainer>
  );
}
