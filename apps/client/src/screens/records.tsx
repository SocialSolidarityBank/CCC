import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/wire';
import { CLAIM_SECTION_LABELS, CONTRAST_AXIS_LABELS, type AiDraft } from '../business/ai-review';
import { type BusinessError, safeError } from '../business/errors';
import {
  ACTION_OWNER_LABELS, FLAG_LABELS, FLAG_TYPES, GOAL_CLOSE_LABELS, GOAL_CLOSE_REASONS,
  RECORD_DETAIL_KEYS, RECORD_DETAIL_LABELS,
  type ActionOwner, type ClosureInfo, type CounselingRecordList, type FlagType,
  type GoalCloseReason, type GoalTreeCase, type RecordDetailKey,
} from '../business/records';
import type { Session } from '../business/session';

interface ActionDraft { description: string; owner: ActionOwner; dueDate: string }

function useRecordList(session: Session, supportCaseId: string) {
  const [value, setValue] = useState<CounselingRecordList | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  const reload = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.records.list(supportCaseId).then((next) => {
      if (own === generation.current) setValue(next);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.records, session.auth, supportCaseId]);
  useEffect(() => {
    reload();
    return () => { generation.current += 1; };
  }, [reload]);
  return { value, error, reload };
}

function GoalTreeCard({ session, beneficiaryId, supportCaseId }: {
  session: Session; beneficiaryId: string; supportCaseId: string;
}) {
  const [tree, setTree] = useState<GoalTreeCase | null>(null);
  const [title, setTitle] = useState('');
  const [retitle, setRetitle] = useState<{ id: string; title: string } | null>(null);
  const [closing, setClosing] = useState<{ id: string; upcoming: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.caseWork.goalTree(beneficiaryId).then((cases) => {
      if (own !== generation.current) return;
      setTree(cases.find((entry) => entry.supportCaseId === supportCaseId) ?? null);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.caseWork, session.auth, beneficiaryId, supportCaseId]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="세부 목표">
    {error && <WireError>{error.message}</WireError>}
    {tree === null && error === null && <WireEmpty live reserve>목표 트리를 불러오고 있습니다.</WireEmpty>}
    {tree !== null && <>
      <WireDataRows>
        <WireDataRow label="전체 목표" value={tree.overallGoal ?? '설정 전'} />
      </WireDataRows>
      {tree.goals.length === 0 && <WireEmpty>등록된 세부 목표가 없습니다.</WireEmpty>}
      {tree.goals.map((goal) => <WireCardSection key={goal.id} title={goal.title}
        action={<WireBadge tone={goal.status === 'active' ? 'mint' : 'neutral'}>
          {goal.status === 'active'
            ? '진행 중'
            : `종료: ${GOAL_CLOSE_LABELS[goal.closedReason as GoalCloseReason] ?? goal.closedReason ?? '사유 없음'}`}
        </WireBadge>}>
        {goal.revisions.length > 1 && <WireDataRows>
          {goal.revisions.map((revision, index) => <WireDataRow key={`${goal.id}-${index}`}
            label={index === 0 ? '현재 문구' : '이전 문구'}
            value={`${revision.title ?? '지움'} (${revision.editedByName ?? '이름 없음'}, ${revision.editedAt})`} />)}
        </WireDataRows>}
        {goal.linkedSessions.map((linked) => <WireItem key={linked.sessionId}
          title={linked.oneLiner ?? '연결된 회차'} description={linked.heldAt} />)}
        {goal.status === 'active' && <div className="business-actions">
          <WireButton variant="neutral" disabled={busy}
            onClick={() => setRetitle({ id: goal.id, title: goal.title })}>문구 수정</WireButton>
          <WireButton variant="neutral" disabled={busy} onClick={() => {
            void run(async () => {
              const upcoming = await session.caseWork.goalUpcomingLinks(goal.id);
              setClosing({ id: goal.id, upcoming });
            });
          }}>닫기</WireButton>
        </div>}
        {retitle?.id === goal.id && <form className="business-form" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await session.caseWork.retitleGoal(goal.id, retitle.title);
            setRetitle(null);
          });
        }}>
          <WireFormField label="새 문구" htmlFor={`goal-title-${goal.id}`} required
            hint="이전 문구는 이력으로 남습니다">
            <input id={`goal-title-${goal.id}`} value={retitle.title} required disabled={busy}
              onChange={(event) => setRetitle({ id: goal.id, title: event.target.value })} />
          </WireFormField>
          <div className="business-actions">
            <WireButton type="submit" variant="primary" disabled={busy}>문구 저장</WireButton>
            <WireButton variant="neutral" disabled={busy} onClick={() => setRetitle(null)}>취소</WireButton>
          </div>
        </form>}
        {closing?.id === goal.id && <>
          {closing.upcoming > 0 && <WireCallout tone="info" title="앞으로의 회기에 연결돼 있습니다">
            {`이 목표는 예정된 회기 ${closing.upcoming}건에 연결돼 있습니다. 닫아도 그 연결은 그대로 남습니다.`}
          </WireCallout>}
          <div className="business-actions">
            {GOAL_CLOSE_REASONS.map((reason) => <WireButton key={reason} variant="neutral" disabled={busy}
              onClick={() => { void run(async () => {
                await session.caseWork.closeGoal(goal.id, reason);
                setClosing(null);
              }); }}>{`${GOAL_CLOSE_LABELS[reason]}으로 닫기`}</WireButton>)}
            <WireButton variant="neutral" disabled={busy} onClick={() => setClosing(null)}>취소</WireButton>
          </div>
        </>}
      </WireCardSection>)}
      <form className="business-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await session.caseWork.createGoal(supportCaseId, title);
          setTitle('');
        });
      }}>
        <WireFormField label="새 세부 목표" htmlFor="goal-new-title" required
          hint="측정할 수 있는 한 문장으로 적습니다">
          <input id="goal-new-title" value={title} required disabled={busy}
            onChange={(event) => setTitle(event.target.value)} />
        </WireFormField>
        <div className="business-actions">
          <WireButton type="submit" variant="primary" disabled={busy || title.trim() === ''}>세부 목표 추가</WireButton>
        </div>
      </form>
      <WireCallout tone="info" title="점수는 매기지 않습니다">
        GAS 채점은 보류 상태라 이 화면은 문구와 연결, 상태만 다룹니다.
      </WireCallout>
    </>}
  </WireCard>;
}

function ClosureCard({ session, supportCaseId }: { session: Session; supportCaseId: string }) {
  const [closure, setClosure] = useState<ClosureInfo | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.caseWork.closure(supportCaseId).then((value) => {
      if (own === generation.current) setClosure(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.caseWork, session.auth, supportCaseId]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const close = async () => {
    if (busy || reason.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      setClosure(await session.caseWork.close(supportCaseId, reason));
      setReason('');
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="사업 종결">
    {error && <WireError>{error.message}</WireError>}
    {closure === null && error === null && <WireEmpty live reserve>종결 상태를 불러오고 있습니다.</WireEmpty>}
    {closure !== null && <>
      <WireDataRows>
        <WireDataRow label="상태" value={closure.status === 'active' ? '진행 중' : '종결'} />
        <WireDataRow label="종결 시각" value={closure.closedAt ?? '없음'} />
        <WireDataRow label="종결 사유" value={closure.closedReason ?? '없음'} />
        <WireDataRow label="금고 파기 예정" value={closure.purgeDue ?? '보관 시계 시작 전'} />
        <WireDataRow label="이미 파기됨" value={closure.purgedAt ?? '아니오'} />
      </WireDataRows>
      {closure.status === 'active'
        ? <form className="business-form" onSubmit={(event) => { event.preventDefault(); void close(); }}>
          <WireFormField label="종결 사유" htmlFor="closure-reason" required>
            <input id="closure-reason" value={reason} required disabled={busy}
              onChange={(event) => setReason(event.target.value)} />
          </WireFormField>
          <div className="business-actions">
            <WireButton type="submit" variant="primary" disabled={busy || reason.trim() === ''}>사업 종결</WireButton>
          </div>
        </form>
        : <WireCallout tone="info" title="종결된 사업입니다">
          {closure.hasOtherActiveSupportCase
            ? '같은 당사자의 다른 사업이 진행 중이라 금고 보관 시계는 아직 시작하지 않았습니다.'
            : '보관 시계는 서버가 정합니다. 이 화면은 저장된 값을 읽기만 합니다.'}
        </WireCallout>}
    </>}
  </WireCard>;
}

export function RecordListScreen() {
  const session = useOutletContext<Session>();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  const { value, error, reload } = useRecordList(session, supportCaseId);
  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;

  if (error !== null && value === null) {
    return <WireCard>
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={reload}>다시 불러오기</WireButton></div>
    </WireCard>;
  }
  if (value === null) return <WireCard><WireEmpty live reserve>상담 기록을 불러오고 있습니다.</WireEmpty></WireCard>;

  return <>
    <WireCard title="상담 기록 확인하기">
      <WireDataRows>
        <WireDataRow label="전체 목표" value={value.overallGoal ?? '설정 전'} />
        <WireDataRow label="사업 상태" value={value.caseStatus === 'active' ? '진행 중' : '종결'} />
        <WireDataRow label="다음 일정" value={value.nextSchedule?.scheduledAt ?? '예정 없음'} />
      </WireDataRows>
      <div className="business-actions">
        <WireButton variant="primary" href={value.nextSchedule === null
          ? `${base}/records/new`
          : `${base}/records/new?scheduleId=${encodeURIComponent(value.nextSchedule.id)}`}>
          상담 기록하기
        </WireButton>
        <WireButton variant="neutral" href={`${base}/records/intake`}>인테이크 기록</WireButton>
        <WireButton variant="neutral" href={`${base}/briefing`}>15초 페이지</WireButton>
      <WireButton variant="neutral" href={`${base}/report`}>전체 상담 리포트</WireButton>
      </div>
    </WireCard>
    <WireCard title="회차">
      {value.records.length === 0 && <WireEmpty>아직 공식 기록이 없습니다.</WireEmpty>}
      {value.records.map((row) => <WireCardSection key={row.id}
        title={`${row.heldAt}, ${row.kind === 'intake' ? '인테이크' : '기본 상담'}`}
        action={row.aiOneLiner === null ? <WireBadge tone="neutral">수기</WireBadge> : <WireBadge tone="lavender">AI 승인</WireBadge>}>
        <p className="wire-section-value">{row.aiOneLiner ?? row.memoExcerpt ?? row.memo}</p>
        {value.recordErrorSessionIds.includes(row.id)
          && <WireCallout tone="info" title="기록 오류로 처리된 회차">
            원본은 그대로 두고 처리 표시만 붙습니다.
          </WireCallout>}
        {row.actionItems.length > 0 && <WireDataRows>
          {row.actionItems.map((action) => <WireDataRow key={action.id}
            label={action.resolved ? '해결된 액션' : '미해결 액션'}
            value={`${action.description} (${ACTION_OWNER_LABELS[action.owner as ActionOwner] ?? action.owner}, 기한 ${action.dueDate ?? '없음'})`} />)}
        </WireDataRows>}
        {row.flags.filter((flag) => flag.reviewStatus === 'confirmed').map((flag) => <WireItem key={flag.id}
          title={FLAG_LABELS[flag.flagType as FlagType] ?? flag.flagType}
          description={flag.quote ?? undefined} />)}
      </WireCardSection>)}
    </WireCard>
    <GoalTreeCard session={session} beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} />
    <ClosureCard session={session} supportCaseId={supportCaseId} />
  </>;
}

export function RecordCreateScreen() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  const [params] = useSearchParams();
  const scheduleId = params.get('scheduleId');
  const { value: list, error: listError } = useRecordList(session, supportCaseId);
  // 재전송해도 회차가 두 번 생기지 않도록 이 폼 한 벌이 같은 제출 ID를 계속 쓴다.
  const submissionId = useMemo(() => crypto.randomUUID(), []);
  const [heldAt, setHeldAt] = useState('');
  const [memo, setMemo] = useState('');
  const [details, setDetails] = useState<Record<RecordDetailKey, string>>({
    sessionGoalNote: '', changeSinceLast: '', safetyNote: '', counselorOpinion: '',
  });
  const [actions, setActions] = useState<ActionDraft[]>([]);
  const [flags, setFlags] = useState<FlagType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const [replayed, setReplayed] = useState(false);

  const schedule = list?.nextSchedule ?? null;
  const linked = scheduleId !== null && schedule !== null && schedule.id === scheduleId ? schedule : null;

  const submit = async () => {
    if (busy || heldAt === '' || memo.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.records.create(supportCaseId, {
        submissionId,
        heldAt: new Date(heldAt).toISOString(),
        memo: memo.trim(),
        details,
        actions: actions.filter((action) => action.description.trim() !== '').map((action) => ({
          description: action.description.trim(), owner: action.owner,
          ...(action.dueDate === '' ? {} : { dueDate: action.dueDate }),
        })),
        flagTypes: flags,
        ...(linked === null ? {} : { schedule: { id: linked.id, expectedVersion: linked.version } }),
      });
      setReplayed(result.replayed);
      void navigate(`/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records`);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="상담 기록하기">
    {listError && <WireError>{listError.message}</WireError>}
    {error && <WireError>{error.message}</WireError>}
    {replayed && <WireCallout tone="info" title="이미 저장된 제출입니다">
      같은 제출을 다시 보냈고 서버가 기존 회차를 그대로 돌려줬습니다. 회차가 두 번 생기지 않았습니다.
    </WireCallout>}
    <WireCallout tone="info" title="저장하면 바로 공식 기록입니다">
      직접 쓴 기록은 저장 즉시 공식 기록입니다. AI 정리는 승인 전까지 이 기록을 대신하지 않습니다.
    </WireCallout>
    {scheduleId !== null && linked === null && <WireCallout tone="info" title="일정 연결 없음">
      주소가 가리키는 일정을 이 사업의 다음 일정으로 확인하지 못해 일정 없이 기록합니다.
    </WireCallout>}
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <WireFormField label="상담 일시" htmlFor="record-held-at" required hint="이 기기의 시간대로 입력합니다">
        <input id="record-held-at" type="datetime-local" value={heldAt} required disabled={busy}
          onChange={(event) => setHeldAt(event.target.value)} />
      </WireFormField>
      <WireFormField label="상담 내용" htmlFor="record-memo" control="textarea" required>
        <textarea id="record-memo" rows={6} value={memo} required disabled={busy}
          onChange={(event) => setMemo(event.target.value)} />
      </WireFormField>
      {RECORD_DETAIL_KEYS.map((key) => <WireFormField key={key} label={RECORD_DETAIL_LABELS[key]} htmlFor={`record-${key}`} control="textarea">
        <textarea id={`record-${key}`} rows={3} value={details[key]} disabled={busy}
          onChange={(event) => setDetails({ ...details, [key]: event.target.value })} />
      </WireFormField>)}
      {actions.map((action, index) => <WireCardSection key={`action-${index}`} title={`액션 ${index + 1}`}>
        <WireFormField label="할 일" htmlFor={`action-description-${index}`} required>
          <input id={`action-description-${index}`} value={action.description} disabled={busy}
            onChange={(event) => setActions(actions.map((entry, position) => (
              position === index ? { ...entry, description: event.target.value } : entry)))} />
        </WireFormField>
        <WireFormField label="담당" htmlFor={`action-owner-${index}`} control="select">
          <select id={`action-owner-${index}`} value={action.owner} disabled={busy}
            onChange={(event) => setActions(actions.map((entry, position) => (
              position === index ? { ...entry, owner: event.target.value as ActionOwner } : entry)))}>
            {(Object.keys(ACTION_OWNER_LABELS) as ActionOwner[]).map((owner) => (
              <option key={owner} value={owner}>{ACTION_OWNER_LABELS[owner]}</option>
            ))}
          </select>
        </WireFormField>
        <WireFormField label="기한" htmlFor={`action-due-${index}`}>
          <input id={`action-due-${index}`} type="date" value={action.dueDate} disabled={busy}
            onChange={(event) => setActions(actions.map((entry, position) => (
              position === index ? { ...entry, dueDate: event.target.value } : entry)))} />
        </WireFormField>
      </WireCardSection>)}
      <div className="business-actions">
        <WireButton variant="neutral" disabled={busy}
          onClick={() => setActions([...actions, { description: '', owner: 'counselor', dueDate: '' }])}>
          액션 추가
        </WireButton>
      </div>
      <WireCardSection title="리스크 플래그">
        {FLAG_TYPES.map((flagType) => <WireChoice key={flagType} type="checkbox" label={FLAG_LABELS[flagType]}
          checked={flags.includes(flagType)} disabled={busy}
          onChange={(checked) => setFlags(checked ? [...flags, flagType] : flags.filter((entry) => entry !== flagType))} />)}
      </WireCardSection>
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy || heldAt === '' || memo.trim() === ''}>
          기록 저장
        </WireButton>
      </div>
    </form>
  </WireCard>;
}

export function RecordReviewScreen() {
  const session = useOutletContext<Session>();
  const { beneficiaryId = '', supportCaseId = '', sessionId = '' } = useParams();
  const [draft, setDraft] = useState<AiDraft | null | 'none'>(null);
  const [speakerConfirmed, setSpeakerConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  const [actionDraft, setActionDraft] = useState<
    { claimKey: string; description: string; owner: ActionOwner; dueDate: string } | null
  >(null);
  const [actionSaved, setActionSaved] = useState<string | null>(null);
  const aiOff = session.capabilities.llmMode === 'off';

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.aiReview.draft(sessionId).then((value) => {
      if (own === generation.current) setDraft(value ?? 'none');
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [sessionId, session.aiReview, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const review = async (decision: 'approved' | 'rejected') => {
    if (busy || draft === null || draft === 'none') return;
    setBusy(true);
    setError(null);
    try {
      const reviewed = await session.aiReview.review(sessionId, {
        expectedVersion: draft.version, decision, speakerMappingConfirmed: speakerConfirmed,
      });
      setDraft(reviewed);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  const registerAction = async () => {
    if (busy || actionDraft === null || actionDraft.description.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await session.caseWork.createActionItem(supportCaseId, {
        description: actionDraft.description, owner: actionDraft.owner,
        ...(actionDraft.dueDate === '' ? {} : { dueDate: actionDraft.dueDate }),
        sessionId,
      });
      setActionSaved(actionDraft.description.trim());
      setActionDraft(null);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  return <WireCard title="AI 정리 검토">
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div></>}
    {aiOff && <WireCallout tone="info" title="AI 처리가 꺼져 있습니다">
      이 설치는 AI 정리를 쓰지 않습니다. 상담은 직접 쓴 기록으로 남고, 이 화면은 저장된 초안이 있을 때만 내용을 보여 줍니다.
    </WireCallout>}
    {draft === null && error === null && <WireEmpty live reserve>초안을 확인하고 있습니다.</WireEmpty>}
    {draft === 'none' && <WireEmpty>이 회차에는 AI 초안이 없습니다.</WireEmpty>}
    <div className="business-actions">
      <WireButton variant="neutral" href={`${base}/records`}>상담 기록 확인하기</WireButton>
    </div>
    {draft !== null && draft !== 'none' && <>
      <WireDataRows>
        <WireDataRow label="초안 버전" value={String(draft.version)} />
        <WireDataRow label="상태" value={draft.reviewDecision === 'approved' ? '승인됨'
          : draft.reviewDecision === 'rejected' ? '반려됨' : '승인 전 초안'} />
        <WireDataRow label="핵심 한 줄" value={draft.oneLiner ?? '없음'} />
      </WireDataRows>
      {draft.reviewDecision !== 'approved' && <WireCallout tone="info" title="승인 전에는 공식 기록이 아닙니다">
        이 내용은 브리핑, 통계, 기록 목록 어디에도 아직 나가지 않습니다. 승인하면 그때 공식 기록이 됩니다.
      </WireCallout>}
      <WireCardSection title="요약">
        <p className="wire-section-value">{draft.summaryText}</p>
        {draft.claims.map((claim) => <WireItem key={claim.claimKey}
          title={CLAIM_SECTION_LABELS[claim.section] ?? claim.section} description={claim.text}
          action={claim.section === 'next_session_commitments'
            ? <WireButton variant="neutral" disabled={busy}
              onClick={() => { setActionDraft({ claimKey: claim.claimKey, description: claim.text, owner: 'counselor', dueDate: '' }); }}>
              액션으로 등록
            </WireButton>
            : undefined} />)}
        {/* D70: 문구만 프리필하고 담당과 기한은 실무자가 정한다. AI가 추정하지 않는다. */}
        {actionDraft !== null && <form className="business-form"
          onSubmit={(event) => { event.preventDefault(); void registerAction(); }}>
          <WireFormField label="액션 내용" htmlFor="review-action-description" required>
            <input id="review-action-description" value={actionDraft.description} required disabled={busy}
              onChange={(event) => setActionDraft({ ...actionDraft, description: event.target.value })} />
          </WireFormField>
          <WireFormField label="담당" htmlFor="review-action-owner" control="select">
            <select id="review-action-owner" value={actionDraft.owner} disabled={busy}
              onChange={(event) => setActionDraft({ ...actionDraft, owner: event.target.value as ActionOwner })}>
              {(Object.keys(ACTION_OWNER_LABELS) as ActionOwner[]).map((owner) => (
                <option key={owner} value={owner}>{ACTION_OWNER_LABELS[owner]}</option>
              ))}
            </select>
          </WireFormField>
          <WireFormField label="기한" htmlFor="review-action-due" hint="비워 두면 기한 없음">
            <input id="review-action-due" type="date" value={actionDraft.dueDate} disabled={busy}
              onChange={(event) => setActionDraft({ ...actionDraft, dueDate: event.target.value })} />
          </WireFormField>
          <div className="business-actions">
            <WireButton type="submit" variant="primary" disabled={busy || actionDraft.description.trim() === ''}>
              액션 등록
            </WireButton>
            <WireButton variant="neutral" disabled={busy} onClick={() => setActionDraft(null)}>취소</WireButton>
          </div>
        </form>}
        {actionSaved !== null && <WireCallout tone="info" title="액션을 등록했습니다">
          {actionSaved} 항목이 미해결 액션 목록에 올라갔습니다. 승인 상태는 이 등록으로 바뀌지 않습니다.
        </WireCallout>}
      </WireCardSection>
      <WireCardSection title="대조">
        {draft.contrast.length === 0 && <WireEmpty>대조 결과가 없습니다.</WireEmpty>}
        {draft.contrast.map((axis) => <WireItem key={axis.axis}
          title={CONTRAST_AXIS_LABELS[axis.axis] ?? axis.axis}
          description={axis.findings.length === 0
            ? `재료 없음 또는 처리 안 함 (${axis.status})`
            : axis.findings.map((finding) => finding.quote === null
              ? finding.description : `${finding.description}: ${finding.quote}`).join(' / ')} />)}
      </WireCardSection>
      <WireCardSection title="확인할 질문">
        {draft.questions.length === 0 && <WireEmpty>제안된 질문이 없습니다.</WireEmpty>}
        {draft.questions.map((question, index) => <WireItem key={`question-${index}`}
          title={question.title} description={question.reason ?? undefined} />)}
      </WireCardSection>
      <WireCardSection title="근거 인용">
        {draft.evidence.length === 0 && <WireEmpty>인용된 근거가 없습니다.</WireEmpty>}
        {draft.evidence.map((item) => <WireItem key={item.id} title={item.quote} description={item.claimKey} />)}
      </WireCardSection>
      {draft.reviewDecision === null && <>
        <WireChoice type="checkbox" label="화자 매핑을 확인했습니다" checked={speakerConfirmed}
          disabled={busy} onChange={setSpeakerConfirmed} />
        <div className="business-actions">
          <WireButton variant="primary" disabled={busy} onClick={() => { void review('approved'); }}>승인</WireButton>
          <WireButton variant="neutral" disabled={busy} onClick={() => { void review('rejected'); }}>반려</WireButton>
        </div>
      </>}
    </>}
  </WireCard>;
}
