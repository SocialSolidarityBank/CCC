'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { WireEmpty } from '../../../../../../components/wire/wire-state';
import { WireFormField } from '../../../../../../components/wire/wire-form-field';
import type { GoalCloseReason, SupportCaseRecordGoal } from '../../../../../../lib/api';
import type { GoalActionResult, GoalUpcomingLinksResult } from '../../../../../../actions';

/**
 * 세부 목표 구획 (D62 · ADR-0032 §2·§5 · CCC-68). 상담 기록 작성 화면이 세부 목표의
 * 입력(본 상담 1회차)·수정(이후 회기)·닫기(사유 선택) 자리다.
 *
 * 기록지 폼과 별개의 **즉시 저장**이다 — 목표는 회차 기록이 아니라 케이스에 붙는 현재
 * 상태라서, 기록지의 제출 ID 재현 보호 틀에 싣지 않고 서버 액션을 바로 부른다. 이 구획은
 * 바깥 기록지 <form> 안에서 렌더되므로 두 가지를 지킨다: 입력칸에 name 을 주지 않고
 * (기록지 제출에 실리면 안 된다), Enter 는 바깥 폼의 암묵 제출 대신 이 구획의 저장을 잡는다.
 *
 * PR #91 의 목표 연결 선택창은 만들지 않는다(2026-08-09 Q 확정) — D62 구조에서 연결은
 * 일정 등록 몫이다. 닫은 목표는 다시 열지 않는다(D62 §5, DB 트리거가 결정론으로 강제).
 */

/** 게이트웨이 MAX_ACTIVE_GOALS 와 같은 값. 상한 판정의 정본은 게이트웨이다(R1). */
const MAX_ACTIVE_GOALS = 3;

/** 닫힘 사유(D62 §5) — 저장은 영문 선택값, 화면 배지는 한글이다. */
const closeReasonLabels: Record<GoalCloseReason, string> = {
  achieved: '달성',
  stopped: '중단',
  reset: '재설정',
};
const closeReasonOptions = Object.entries(closeReasonLabels) as Array<[GoalCloseReason, string]>;

function reasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return reason in closeReasonLabels ? closeReasonLabels[reason as GoalCloseReason] : null;
}

/** 액션 실패 코드 → 한 줄 안내. 상한·빈 문구는 화면이 먼저 막으므로 남는 실패는 셋이다. */
function messageFor(status: string): string {
  if (status === 'access_denied' || status === 'forbidden') {
    return '담당 실무자와 기관 관리자만 세부 목표를 수정할 수 있습니다.';
  }
  if (status === 'validation_error' || status === 'invalid_request' || status === 'conflict') {
    return '저장하지 못했습니다. 목표 문구와 활성 개수(3개 상한)를 확인하세요.';
  }
  return '지금 저장할 수 없습니다. 잠시 후 다시 시도하세요.';
}

type GoalInput = {
  beneficiaryId: string;
  supportCaseId: string;
};

export interface GoalSectionProps {
  beneficiaryId: string;
  supportCaseId: string;
  /** 서버가 내려준 목표 전체(활성+닫힘). 이후 변경은 액션 결과로 이 컴포넌트가 갱신한다. */
  goals: SupportCaseRecordGoal[];
  /** 서버 액션 3종. jsdom 테스트는 넘기지 않아도 렌더된다 — 없으면 조작 UI 를 그리지 않는다. */
  createAction?: (input: GoalInput & { title: string }) => Promise<GoalActionResult>;
  renameAction?: (input: GoalInput & { goalId: string; title: string }) => Promise<GoalActionResult>;
  closeAction?: (input: GoalInput & { goalId: string; reason: GoalCloseReason }) => Promise<GoalActionResult>;
  /**
   * 미래 회기 연결 수(D62 §5 · CCC-70 라우트). 닫기 패널을 열 때 불러 알림 한 줄을 판정한다.
   * 알림일 뿐 닫기를 막지 않으므로 없거나 실패해도 닫기 흐름은 그대로다.
   */
  upcomingLinksAction?: (input: GoalInput & { goalId: string }) => Promise<GoalUpcomingLinksResult>;
}

export function GoalSection({
  beneficiaryId,
  supportCaseId,
  goals: initialGoals,
  createAction,
  renameAction,
  closeAction,
  upcomingLinksAction,
}: GoalSectionProps) {
  const [goals, setGoals] = useState<SupportCaseRecordGoal[]>(initialGoals);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<GoalCloseReason>('achieved');
  /** 닫으려는 목표에 연결된 미래 회기 수. null = 아직 모르거나 조회 실패(알림 생략). */
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  /** 마지막으로 연결 수를 물어본 목표 — 늦게 온 답이 다른 닫기 패널에 붙는 것을 막는다. */
  const upcomingRequestFor = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = createAction !== undefined && renameAction !== undefined && closeAction !== undefined;
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const closedGoals = goals.filter((goal) => goal.status === 'closed');
  const capReached = activeGoals.length >= MAX_ACTIVE_GOALS;

  /** Enter 가 바깥 기록지 폼을 제출하지 않게 잡아 이 구획의 저장으로 돌린다. */
  function enterRuns(handler: () => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handler();
    };
  }

  async function submitCreate() {
    if (createAction === undefined || busy) return;
    const title = newTitle.trim();
    if (title.length === 0) {
      setNotice('목표 문구를 입력하세요.');
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await createAction({ beneficiaryId, supportCaseId, title });
    setBusy(false);
    if (result.status !== 'saved') {
      setNotice(messageFor(result.status));
      return;
    }
    setGoals((prev) => [...prev, {
      id: result.goal.id,
      title: result.goal.title,
      status: 'active',
      closedReason: null,
    }]);
    setNewTitle('');
  }

  async function submitRename(goalId: string) {
    if (renameAction === undefined || busy) return;
    const title = editTitle.trim();
    if (title.length === 0) {
      setNotice('목표 문구를 입력하세요.');
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await renameAction({ beneficiaryId, supportCaseId, goalId, title });
    setBusy(false);
    if (result.status !== 'saved') {
      setNotice(messageFor(result.status));
      return;
    }
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? { ...goal, title: result.goal.title } : goal)));
    setEditingId(null);
  }

  /** 닫기 패널 열기 + 미래 회기 연결 수 조회(D62 §5 알림 한 줄). 조회 실패는 알림 생략이다. */
  function startClose(goalId: string) {
    setClosingId(goalId);
    setCloseReason('achieved');
    setEditingId(null);
    setNotice(null);
    setUpcomingCount(null);
    if (upcomingLinksAction === undefined) return;
    upcomingRequestFor.current = goalId;
    void upcomingLinksAction({ beneficiaryId, supportCaseId, goalId }).then((result) => {
      // 그 사이 다른 목표의 닫기로 넘어갔으면 버린다 — 늦게 온 답이 다른 패널에 붙으면 안 된다.
      if (result.status !== 'ok' || upcomingRequestFor.current !== goalId) return;
      setUpcomingCount(result.upcomingCount);
    }).catch(() => undefined);
  }

  async function submitClose(goalId: string) {
    if (closeAction === undefined || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await closeAction({ beneficiaryId, supportCaseId, goalId, reason: closeReason });
    setBusy(false);
    if (result.status !== 'saved') {
      setNotice(messageFor(result.status));
      return;
    }
    setGoals((prev) => prev.map((goal) => (
      goal.id === goalId ? { ...goal, status: 'closed' as const, closedReason: closeReason } : goal
    )));
    setClosingId(null);
  }

  return (
    <WireCard
      as="section"
      className="wire-form-card"
      labelledBy="record-goals-title"
      testId="record-goal-section"
      title={(
        <>
          <h2 id="record-goals-title">
            세부 목표 <small>(선택)</small>{' '}
            {/* 활성 개수는 상태 낱말이라 배지다(§2-2 규칙 4, 민트 = 상태 축). 상한이 곧 보인다. */}
            <WireBadge tone="mint" aria-live="polite">활성 {activeGoals.length}/{MAX_ACTIVE_GOALS}</WireBadge>
          </h2>
          <p className="panel-meta">
            케이스에 붙어 여러 회기 지속되는 실행 목표입니다. 본 상담 1회차에 당사자와 합의해 적고,
            이후 회기에는 여기서 수정하거나 닫습니다. 아래 저장 버튼과 별개로 즉시 저장됩니다.
          </p>
        </>
      )}
    >
      {notice !== null ? <p role="alert" className="wire-field-error">{notice}</p> : null}

      {activeGoals.length === 0
        ? <WireEmpty testId="record-goal-empty">등록된 세부 목표가 없습니다. 측정할 수 있는 문장으로 적으세요.</WireEmpty>
        : activeGoals.map((goal) => (
          <div key={goal.id} className="wizard-field" data-testid="record-goal-row">
            {editingId === goal.id ? (
              <>
                <WireFormField label="목표 문구 수정" htmlFor={`record-goal-edit-${goal.id}`}>
                  <input
                    id={`record-goal-edit-${goal.id}`}
                    type="text"
                    maxLength={200}
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onKeyDown={enterRuns(() => void submitRename(goal.id))}
                  />
                </WireFormField>
                <div className="wizard-actions">
                  <WireButton variant="secondary" disabled={busy} onClick={() => void submitRename(goal.id)}>저장</WireButton>
                  <WireButton variant="neutral" onClick={() => { setEditingId(null); setNotice(null); }}>취소</WireButton>
                </div>
              </>
            ) : closingId === goal.id ? (
              <>
                <p className="wire-field-value">{goal.title}</p>
                {/* 미래 회기 연결 알림(D62 §5): 알림일 뿐 닫기를 막지 않는다. 기존 연결은
                    그날 계획의 기록이라 그대로 남는다. */}
                {upcomingCount !== null && upcomingCount > 0 ? (
                  <p className="panel-meta" role="status" data-testid="record-goal-upcoming">
                    아직 오지 않은 회기 {upcomingCount}건이 이 목표에 연결되어 있습니다.
                    닫아도 그 연결은 그날 계획의 기록으로 그대로 남습니다.
                  </p>
                ) : null}
                <WireFormField
                  label="닫는 사유"
                  control="select"
                  htmlFor={`record-goal-close-${goal.id}`}
                  hint="닫은 목표는 다시 열 수 없습니다. 같은 목표가 다시 필요하면 같은 문구로 새로 만드세요."
                >
                  <select
                    id={`record-goal-close-${goal.id}`}
                    value={closeReason}
                    aria-describedby={`record-goal-close-${goal.id}-hint`}
                    onChange={(event) => setCloseReason(event.target.value as GoalCloseReason)}
                  >
                    {closeReasonOptions.map(([reason, label]) => <option key={reason} value={reason}>{label}</option>)}
                  </select>
                </WireFormField>
                <div className="wizard-actions">
                  {/* 되돌리기 어려운 행동이라 위험 버튼이다(§5 버튼 5종 — 재개 불가, D62 §5). */}
                  <WireButton variant="danger" disabled={busy} onClick={() => void submitClose(goal.id)}>목표 닫기</WireButton>
                  <WireButton variant="neutral" onClick={() => { setClosingId(null); setNotice(null); }}>취소</WireButton>
                </div>
              </>
            ) : (
              <>
                <p className="wire-field-value">{goal.title}</p>
                {editable ? (
                  <div className="wizard-actions">
                    <WireButton
                      variant="neutral"
                      onClick={() => { setEditingId(goal.id); setEditTitle(goal.title); setClosingId(null); setNotice(null); }}
                    >
                      수정
                    </WireButton>
                    <WireButton variant="neutral" onClick={() => startClose(goal.id)}>닫기</WireButton>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}

      {editable ? (
        capReached ? (
          // 상한 도달(done 기준: 활성 상한 3개의 화면 반영) — 입력칸 대신 다음 행동을 알린다.
          <p className="panel-meta" data-testid="record-goal-cap">
            활성 세부 목표가 {MAX_ACTIVE_GOALS}개입니다. 새로 만들려면 먼저 기존 목표를 닫으세요.
          </p>
        ) : (
          <>
            <WireFormField label="새 세부 목표" htmlFor="record-goal-new">
              <input
                id="record-goal-new"
                type="text"
                maxLength={200}
                value={newTitle}
                placeholder="측정할 수 있는 문장으로 적습니다"
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={enterRuns(() => void submitCreate())}
              />
            </WireFormField>
            <div className="wizard-actions">
              <WireButton variant="secondary" disabled={busy} onClick={() => void submitCreate()}>목표 추가</WireButton>
            </div>
          </>
        )
      ) : null}

      {/* 수정과 재설정의 경계(D62 §4 — 운영 지침과 같은 문장). */}
      <p className="panel-meta">
        방향이 같고 표현만 다듬을 때는 수정하세요. 목표 자체가 바뀌면 &lsquo;재설정&rsquo;으로 닫고
        새로 만듭니다. 이전 문구는 이력으로 남습니다.
      </p>

      {closedGoals.length > 0 ? (
        // 접힌 이력 패턴 재사용(브리핑 '처리된 항목'과 같은 계약 — 새 스타일 없음).
        // 여기는 방금 닫은 결과 확인 자리이고, 닫힌 목표의 본 자리는 당사자 정보 허브다(D62 §8).
        <details className="briefing-history" data-testid="record-goal-closed">
          <summary>닫힌 목표 {closedGoals.length}건 <span className="wire-card-arrow" aria-hidden="true" /></summary>
          {closedGoals.map((goal) => {
            const label = reasonLabel(goal.closedReason);
            return (
              <p key={goal.id} className="panel-meta">
                {label !== null ? <WireBadge>{label}</WireBadge> : null} {goal.title}
              </p>
            );
          })}
        </details>
      ) : null}
    </WireCard>
  );
}
