'use client';

// 세션 목표 수정 (D62 §6 · CCC-70 · CCC-75 개편). 일정을 잡을 때 대충 적었다가 상담 직전에
// 다듬는 흐름이라, 시작 시각 전까지는 묶음을 자유롭게 고친다(이력 없음).
// 잠금·활성 세부 목표만 연결·낙관 잠금은 전부 서버(게이트웨이)가 강제한다(R1).
//
// CCC-75 로 바뀐 세 가지:
//  1. 저장은 카드 밖 **페이지 제목 줄 오른쪽**이다 — 기본정보 수정 화면과 같은 문법
//     (DESIGN.md §5 ParticipantHeroCard 예외 1건). 버튼이 폼 밖에 서므로 form 속성으로 잇는다.
//  2. 로컬 임시 저장(useDomDraft + DraftStatus, 상담 기록지와 같은 문법). 서버 자동 저장은
//     하지 않는다 — 저장마다 감사 기록이 남는 구조이고 D62 잠금 경계가 모호해진다(Q 확정).
//  3. 목표 한 묶음 = 전폭 접이식 카드(WireCardDetails) 하나. 본문은 2열(왼쪽 연결 select +
//     추가/삭제, 오른쪽 목표 문장), 기본 전부 펼침. 구 .wizard-row 720 제한은 쓰지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftRestorePrompt, DraftRetentionNote, DraftStatus } from '../../../components/draft/draft-notice';
import { PageTitle } from '../../../components/wire/page-title';
import { WireBadge } from '../../../components/wire/wire-badge';
import { WireButton } from '../../../components/wire/wire-button';
import { WireCallout } from '../../../components/wire/wire-callout';
import { WireCardDetails } from '../../../components/wire/wire-card';
import { WireFormField } from '../../../components/wire/wire-form-field';
import { WireRepeatActions } from '../../../components/wire/wire-repeat-actions';
import { draftKey, readDraft, type FieldValues } from '../../../lib/form-draft';
import { useDomDraft } from '../../../lib/use-dom-draft';
import type { UpdateSessionGoalsActionInput, UpdateSessionGoalsActionResult } from '../../../actions';

export interface SessionPlanGoalDraft {
  body: string;
  caseGoalId: string;
}

export interface SessionPlanGoalOption {
  id: string;
  title: string;
  /** 종료된 세부 목표. 기존 연결 표시용으로만 남긴다. 저장하려 하면 서버가 거부한다. */
  closed: boolean;
}

export interface SessionPlanEditorProps {
  scheduleId: string;
  beneficiaryId: string;
  supportCaseId: string;
  /** 일정 행의 현재 version. 저장 성공 시 서버가 돌려준 새 값으로 갈아탄다. */
  version: number;
  /** 상담 일시 표기(서버가 기관 시간대로 만든 문자열). 안내 콜아웃이 쓴다. */
  scheduledAtLabel: string;
  initialGoals: SessionPlanGoalDraft[];
  goalOptions: SessionPlanGoalOption[];
  submit: (input: UpdateSessionGoalsActionInput) => Promise<UpdateSessionGoalsActionResult>;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: '저장할 수 없습니다. 일정 시작 시각이 지났거나 종료된 세부 목표 연결이 남아 있습니다.',
  validation_error: '저장할 수 없습니다. 일정 시작 시각이 지났거나 종료된 세부 목표 연결이 남아 있습니다.',
  conflict: '다른 곳에서 일정이 먼저 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도하세요.',
  access_denied: '담당 중인 케이스의 일정만 수정할 수 있습니다.',
  forbidden: '담당 중인 케이스의 일정만 수정할 수 있습니다.',
  not_found: '일정을 찾을 수 없습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금은 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function messageFor(status: string): string {
  return ERROR_MESSAGES[status] ?? '세션 목표를 저장하지 못했습니다.';
}

/**
 * 임시본이 담고 있던 목표 묶음 수. 임시본 키는 DOM 등장 순서(`이름#순번`)라, 저장 당시
 * 몇 번째 묶음까지 있었는지 키에서 되읽는다 — 되돌릴 때 카드 수를 이 값으로 맞춰야
 * 지금 카드 수보다 많던(적던) 묶음이 잘리거나 남지 않는다.
 */
function draftRowCount(values: FieldValues): number {
  let count = 0;
  for (const key of Object.keys(values)) {
    const match = /^sessionGoal(?:Body|Case)#(\d+)$/.exec(key);
    if (match !== null) count = Math.max(count, Number(match[1]) + 1);
  }
  return count;
}

function stringAt(values: FieldValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value : '';
}

/**
 * 임시본을 묶음 배열로 되읽는다. 이 화면은 값이 리액트 상태라(제어 컴포넌트) 임시본 복원도
 * 상태로 한다 — useDomDraft.resume 의 DOM 적용은 비제어 폼(기록지)용이고, 제어 폼에서는
 * 다음 렌더가 상태값으로 도로 덮는다. 빈 칸은 임시본에 담기지 않으므로(form-draft 규율)
 * 키가 없는 자리는 빈 값이 맞다. 연결 select 는 저장 이후 목표 목록이 바뀌었을 수 있어
 * 실재하는 선택지일 때만 되돌린다(applyFieldValues 의 select 규칙과 같은 이유, D6).
 */
function goalsFromDraft(values: FieldValues, optionIds: ReadonlySet<string>): SessionPlanGoalDraft[] {
  const count = Math.max(1, draftRowCount(values));
  return Array.from({ length: count }, (_, index) => {
    const caseGoalId = stringAt(values, `sessionGoalCase#${index}`);
    return {
      body: stringAt(values, `sessionGoalBody#${index}`),
      caseGoalId: optionIds.has(caseGoalId) ? caseGoalId : '',
    };
  });
}

export function SessionPlanEditor({
  scheduleId,
  beneficiaryId,
  supportCaseId,
  version,
  scheduledAtLabel,
  initialGoals,
  goalOptions,
  submit,
}: SessionPlanEditorProps) {
  const [goals, setGoals] = useState<SessionPlanGoalDraft[]>(
    initialGoals.length === 0 ? [{ body: '', caseGoalId: '' }] : initialGoals,
  );
  const [expectedVersion, setExpectedVersion] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 이 화면은 저장 결과를 화면 안에서 바로 아므로 submissionFailed 판정이 필요 없다 —
  // 성공하면 아래 save() 가 임시본을 즉시 지운다(보관 규율 2).
  const storageKey = draftKey('session-plan', scheduleId);
  const draft = useDomDraft({ storageKey, submissionFailed: false });

  const formRef = useRef<HTMLFormElement | null>(null);
  const setFormNode = useCallback((node: HTMLFormElement | null) => {
    formRef.current = node;
    draft.containerRef(node);
  }, [draft.containerRef]);

  // 묶음 추가·삭제는 input 이벤트를 내지 않아 임시본이 구조 변화를 못 본다. 카드 수가
  // 바뀌면 change 를 한 번 흘려 자동 저장을 깨운다(값 수집은 디바운스 뒤 DOM 에서 한다).
  const rowCountRef = useRef(goals.length);
  useEffect(() => {
    if (rowCountRef.current === goals.length) return;
    rowCountRef.current = goals.length;
    formRef.current?.dispatchEvent(new Event('change', { bubbles: true }));
  }, [goals.length]);

  // 이어쓰기: 임시본을 파싱해 **상태로** 되돌린다(goalsFromDraft 주석 참조). draft.resume()
  // 은 배너 해제·훅 내부 정리 몫으로만 부른다 — 그 DOM 적용이 남긴 값·이벤트는 바로 뒤
  // 상태 렌더가 같은 값으로 덮으므로 어느 환경에서든 결과가 같다.
  function handleResume() {
    const stored = readDraft<FieldValues>(storageKey);
    if (stored !== null) {
      const optionIds = new Set(goalOptions.map((goal) => goal.id));
      setGoals(goalsFromDraft(stored.values, optionIds));
    }
    draft.resume();
  }

  const options = [
    { value: '', label: '연결 안 함' },
    ...goalOptions.map((goal) => ({
      value: goal.id,
      label: goal.closed ? `${goal.title} (종료됨)` : goal.title,
    })),
  ];

  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    const result = await submit({
      scheduleId,
      beneficiaryId,
      supportCaseId,
      expectedVersion,
      sessionGoals: goals.map((goal) => ({
        body: goal.body,
        caseGoalId: goal.caseGoalId.length === 0 ? null : goal.caseGoalId,
      })),
    });
    setBusy(false);
    if (result.status !== 'saved') {
      setError(messageFor(result.status));
      return;
    }
    setExpectedVersion(result.version);
    setError(null);
    setSaved(true);
    // 서버 저장에 성공했으니 임시본은 즉시 지운다(form-draft 보관 규율 2). 제출 이벤트가
    // 대기 중이던 디바운스 저장을 이미 끊었으므로(useDomDraft) 지운 뒤 되살아나지 않는다.
    draft.discard();
  }

  return (
    <>
      {/* 카드 밖 페이지 제목 줄 + 저장(기본정보 수정 화면과 같은 문법). 자동 저장 상태는
          별도 임시 저장 버튼이 없으므로 저장 옆에 상시 보여준다(상담 기록지와 같은 이유). */}
      <div className="page-header">
        <PageTitle>세션 목표 수정</PageTitle>
        <div className="page-actions">
          <DraftStatus savedAt={draft.savedAt} available={draft.available} />
          <WireButton type="submit" variant="primary" form="session-plan-form" disabled={busy}>저장</WireButton>
        </div>
      </div>
      {saved && <WireBadge tone="blue" role="status" aria-live="polite">세션 목표를 저장했습니다.</WireBadge>}
      {error !== null ? <p role="alert" className="wire-field-error">{error}</p> : null}
      <WireCallout tone="info" title={`상담 일시: ${scheduledAtLabel}`}>
        일정 시작 전까지 수정할 수 있습니다. 시작 시각이 지나면 그날 계획의 기록으로 잠깁니다. <DraftRetentionNote />
      </WireCallout>
      {draft.restorable !== null && (
        <DraftRestorePrompt
          savedAt={draft.restorable.savedAt}
          uncertain={draft.restorable.uncertain}
          onResume={handleResume}
          onDiscard={draft.discard}
        />
      )}
      {/* 목표 한 묶음 = 접이식 카드 하나(전폭). 카드 스택 24 · 카드 안 20 은 §3-4 3단 그대로다. */}
      <form id="session-plan-form" className="session-plan-stack" ref={setFormNode}
        onSubmit={(event) => { event.preventDefault(); void save(); }}>
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
                  <select
                    id={`session-goal-case-${index}`}
                    name="sessionGoalCase"
                    value={goal.caseGoalId}
                    onChange={(event) => {
                      // currentTarget 은 이벤트 디스패치가 끝나면 null 이 된다. 업데이터가
                      // 나중에 돌므로 값을 먼저 집어 둔다(위저드 선택창의 잠복 버그와 동일).
                      const value = event.currentTarget.value;
                      setGoals((prev) => prev.map(
                        (item, itemIndex) => (itemIndex === index ? { ...item, caseGoalId: value } : item),
                      ));
                    }}
                  >
                    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </WireFormField>
                <WireRepeatActions
                  itemLabel="목표"
                  onAdd={index === goals.length - 1
                    ? () => setGoals((prev) => [...prev, { body: '', caseGoalId: '' }])
                    : undefined}
                  onRemove={goals.length > 1
                    ? () => setGoals((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                    : undefined}
                />
              </div>
              <WireFormField label="목표 문장" control="textarea" htmlFor={`session-goal-${index}`}>
                <textarea
                  id={`session-goal-${index}`}
                  name="sessionGoalBody"
                  aria-label={`세션 목표 ${index + 1}`}
                  rows={4}
                  value={goal.body}
                  onChange={(event) => setGoals((prev) => prev.map(
                    (item, itemIndex) => (itemIndex === index ? { ...item, body: event.target.value } : item),
                  ))}
                />
              </WireFormField>
            </div>
          </WireCardDetails>
        ))}
      </form>
    </>
  );
}
