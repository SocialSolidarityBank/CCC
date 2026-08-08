'use client';

// 세션 목표 수정 (D62 §6 · CCC-70). 일정을 잡을 때 대충 적었다가 상담 직전에 다듬는
// 흐름이라, 시작 시각 전까지는 묶음을 자유롭게 고친다(이력 없음). 입력 카드 레이아웃은
// 일정 위저드 2단계의 목표 카드와 같은 계약이다. 화면이 달라도 같은 일은 같은 모양.
// 잠금·활성 세부 목표만 연결·낙관 잠금은 전부 서버(게이트웨이)가 강제한다(R1).
import { useState } from 'react';
import { WireBadge } from '../../../components/wire/wire-badge';
import { WireButton } from '../../../components/wire/wire-button';
import { WireCard } from '../../../components/wire/wire-card';
import { WireFormField } from '../../../components/wire/wire-form-field';
import { WireRepeatActions } from '../../../components/wire/wire-repeat-actions';
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

export function SessionPlanEditor({
  scheduleId,
  beneficiaryId,
  supportCaseId,
  version,
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

  const options = [
    { value: '', label: '연결 안 함' },
    ...goalOptions.map((goal) => ({
      value: goal.id,
      label: goal.closed ? `${goal.title} (종료됨)` : goal.title,
    })),
  ];

  async function save() {
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
  }

  return (
    <div className="wizard-stack">
      {saved && <WireBadge tone="blue" role="status" aria-live="polite">세션 목표를 저장했습니다.</WireBadge>}
      {error !== null ? <p role="alert" className="wire-field-error">{error}</p> : null}
      <WireCard className="wire-form-card">
        <div className="wizard-row">
          {goals.map((goal, index) => (
            <div key={index} className="wizard-field">
              <div className="wire-form-grid">
                <WireFormField label={`세션 목표 ${index + 1}`} control="textarea" htmlFor={`session-goal-${index}`}>
                  <textarea
                    id={`session-goal-${index}`}
                    aria-label={`세션 목표 ${index + 1}`}
                    rows={4}
                    value={goal.body}
                    onChange={(event) => setGoals((prev) => prev.map(
                      (item, itemIndex) => (itemIndex === index ? { ...item, body: event.target.value } : item),
                    ))}
                  />
                </WireFormField>
                <WireFormField label="세부 목표 연결" control="select" htmlFor={`session-goal-case-${index}`}>
                  <select
                    id={`session-goal-case-${index}`}
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
              </div>
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
          ))}
        </div>
      </WireCard>
      <div className="wizard-actions">
        <WireButton size="large" chevron disabled={busy} onClick={save}>저장</WireButton>
      </div>
    </div>
  );
}
