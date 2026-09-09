import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import { type BusinessError, safeError } from '../business/errors';
import type {
  Briefing, ScheduleCandidate, ScheduleCard, SchedulePlan, ScheduleWindow,
} from '../business/schedules';
import type { Session } from '../business/session';

export type ScheduleView = 'day' | 'week' | 'month';

const STATUS_LABELS: Record<ScheduleCard['status'], string> = {
  scheduled: '예정', completed: '완료', cancelled: '취소', no_show: '오지 않음',
};
const FLAG_LABELS: Record<string, string> = {
  crisis_statement: '위기 발언', contact_loss_risk: '연락 두절 위험',
  living_condition_change: '주거, 생계, 건강 급변', debt_worsening: '부채 악화',
  repeated_no_show: '약속 불이행 반복', violence_exploitation: '폭력, 착취 피해',
};

/** 서버가 준 기관 시간대로 날짜와 시각을 읽는다. 브라우저 시간대로 다시 계산하지 않는다. */
function zoned(instant: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone, ...options }).format(new Date(instant));
}
function zonedDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function rangeOf(view: ScheduleView, date: string): { from: string; to: string; label: string } {
  if (view === 'day') return { from: date, to: date, label: date };
  if (view === 'week') {
    const from = mondayOf(date);
    const to = addDays(from, 6);
    return { from, to, label: `${from} ~ ${to}` };
  }
  const month = date.slice(0, 7);
  const from = `${month}-01`;
  const end = new Date(`${from}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10), label: month };
}
function shift(view: ScheduleView, date: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, direction * 7);
  const moved = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
  moved.setUTCMonth(moved.getUTCMonth() + direction);
  return moved.toISOString().slice(0, 10);
}

export function ScheduleScreen() {
  const session = useOutletContext<Session>();
  const [params, setParams] = useSearchParams();
  const view = ((): ScheduleView => {
    const value = params.get('view');
    return value === 'day' || value === 'month' ? value : 'week';
  })();
  const today = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(params.get('date') ?? '') ? params.get('date')! : today;
  const range = rangeOf(view, date);
  const months = useMemo(() => {
    const list = [range.from.slice(0, 7)];
    if (range.to.slice(0, 7) !== list[0]) list.push(range.to.slice(0, 7));
    return list;
  }, [range.from, range.to]);

  const [windows, setWindows] = useState<ScheduleWindow[] | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setWindows(null);
    setError(null);
    void Promise.all(months.map((month) => session.schedules.month(month))).then((value) => {
      if (own === generation.current) setWindows(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [months, session.schedules, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const timeZone = windows?.[0]?.timeZone ?? 'UTC';
  const byDate = useMemo(() => {
    const grouped = new Map<string, ScheduleCard[]>();
    for (const card of (windows ?? []).flatMap((window) => window.schedules)) {
      const day = zonedDate(card.scheduledAt, timeZone);
      if (day < range.from || day > range.to) continue;
      grouped.set(day, [...grouped.get(day) ?? [], card]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [windows, timeZone, range.from, range.to]);

  const move = (next: Partial<{ view: ScheduleView; date: string }>) => {
    setParams({ view: next.view ?? view, date: next.date ?? date });
  };

  return <WireCard title="일정">
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div></>}
    <div className="business-actions">
      <WireButton variant="neutral" onClick={() => move({ date: today })}>오늘</WireButton>
      <WireButton variant="neutral" onClick={() => move({ date: shift(view, date, -1) })}>이전</WireButton>
      <WireButton variant="neutral" onClick={() => move({ date: shift(view, date, 1) })}>다음</WireButton>
      <WireButton variant="neutral" href="/schedules/new">상담 일정 등록</WireButton>
    </div>
    <div className="business-form">
      <WireFormField label="보기" htmlFor="schedule-view" control="select">
        <select id="schedule-view" value={view}
          onChange={(event) => move({ view: event.target.value as ScheduleView })}>
          <option value="day">일간</option>
          <option value="week">주간</option>
          <option value="month">월간</option>
        </select>
      </WireFormField>
    </div>
    <WireDataRows>
      <WireDataRow label="기간" value={range.label} />
      <WireDataRow label="기관 시간대" value={timeZone} />
    </WireDataRows>
    {windows === null && error === null && <WireEmpty live reserve>일정을 불러오고 있습니다.</WireEmpty>}
    {windows !== null && byDate.length === 0 && <WireEmpty>이 기간에 등록된 일정이 없습니다.</WireEmpty>}
    {byDate.map(([day, cards]) => <WireCardSection key={day} title={day}>
      {cards.map((card) => <WireItem key={card.id}
        title={card.participantName ?? card.beneficiaryId}
        description={`${zoned(card.scheduledAt, timeZone, { hour: '2-digit', minute: '2-digit' })}, ${card.sessionKind === 'intake' ? '인테이크' : '기본 상담'}`}
        status={<WireBadge tone={card.status === 'scheduled' ? 'mint' : 'neutral'}>{STATUS_LABELS[card.status]}</WireBadge>}
        action={<>
          <WireButton variant="neutral" href={`/schedules/${encodeURIComponent(card.id)}/plan`}>계획 보기</WireButton>
          <WireButton variant="neutral"
            href={`/participants/${encodeURIComponent(card.beneficiaryId)}/programs/${encodeURIComponent(card.supportCaseId)}/briefing`}>
            15초 페이지
          </WireButton>
        </>} />)}
    </WireCardSection>)}
    <WireCallout tone="info" title="아직 목록 형태입니다">
      월간 7열 격자와 종일 일정 표시는 공유 부품이 필요해 design 인계로 남겼습니다. 지금은 날짜별 목록으로 같은 자료를 보여 줍니다.
    </WireCallout>
  </WireCard>;
}

export function ScheduleCreateScreen() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<ScheduleCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<BusinessError | null>(null);
  const [supportCaseId, setSupportCaseId] = useState('');
  const [localDateTime, setLocalDateTime] = useState('');
  const [goals, setGoals] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const own = ++generation.current;
    void session.schedules.candidates().then((value) => {
      if (own === generation.current) setCandidates(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setLoadError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
    return () => { generation.current += 1; };
  }, [session.schedules, session.auth]);

  const selected = (candidates ?? []).find((candidate) => candidate.supportCaseId === supportCaseId) ?? null;

  const submit = async () => {
    if (busy || selected === null || localDateTime === '') return;
    setBusy(true);
    setError(null);
    try {
      const created = await session.schedules.create({
        beneficiaryId: selected.beneficiaryId,
        supportCaseId: selected.supportCaseId,
        // 입력칸은 브라우저 지역 시각이다. 서버 계약은 UTC 순간이라 여기서 한 번만 바꾼다.
        scheduledAt: new Date(localDateTime).toISOString(),
        sessionKind: selected.intakeAt === null ? 'intake' : 'regular',
        sessionGoals: goals.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
      });
      void navigate(`/schedules/${encodeURIComponent(created.id)}/plan`);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="상담 일정 등록">
    {loadError && <WireError>{loadError.message}</WireError>}
    {error && <WireError>{error.message}</WireError>}
    {candidates === null && loadError === null && <WireEmpty live reserve>담당 당사자를 불러오고 있습니다.</WireEmpty>}
    {candidates !== null && candidates.length === 0 && <WireEmpty>담당 중인 활성 참여 사업이 없습니다.</WireEmpty>}
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <WireFormField label="당사자와 참여 사업" htmlFor="schedule-candidate" control="select" required>
        <select id="schedule-candidate" value={supportCaseId} required disabled={busy}
          onChange={(event) => setSupportCaseId(event.target.value)}>
          <option value="">고르세요</option>
          {(candidates ?? []).map((candidate) => <option key={candidate.supportCaseId} value={candidate.supportCaseId}>
            {candidate.participantName ?? candidate.beneficiaryId}
          </option>)}
        </select>
      </WireFormField>
      {selected !== null && <WireCallout tone="info" title="상담 유형">
        {selected.intakeAt === null
          ? '인테이크 기록이 없어 인테이크로 등록합니다.'
          : '인테이크가 끝난 사업이라 기본 상담으로 등록합니다.'}
      </WireCallout>}
      <WireFormField label="일시" htmlFor="schedule-at" required hint="이 기기의 시간대로 입력합니다">
        <input id="schedule-at" type="datetime-local" value={localDateTime} required disabled={busy}
          onChange={(event) => setLocalDateTime(event.target.value)} />
      </WireFormField>
      <WireFormField label="이번 상담의 목표" htmlFor="schedule-goals" control="textarea"
        hint="한 줄에 하나씩 적습니다. 비워 두어도 됩니다">
        <textarea id="schedule-goals" value={goals} rows={4} disabled={busy}
          onChange={(event) => setGoals(event.target.value)} />
      </WireFormField>
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy || selected === null || localDateTime === ''}>
          등록하기
        </WireButton>
      </div>
    </form>
  </WireCard>;
}

export function SchedulePlanScreen() {
  const session = useOutletContext<Session>();
  const { scheduleId = '' } = useParams();
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.schedules.plan(scheduleId).then((value) => {
      if (own !== generation.current) return;
      setPlan(value);
      setDraft((current) => current ?? value.sessionGoals.map((goal) => goal.body).join('\n'));
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [scheduleId, session.schedules, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const save = async () => {
    if (busy || plan === null || draft === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await session.schedules.saveSessionGoals(plan.scheduleId, plan.version,
        draft.split('\n').map((line) => line.trim()).filter((line) => line !== ''));
      setDraft(null);
      load();
      setSaved(true);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="상담 계획">
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>최신 계획 다시 읽기</WireButton></div></>}
    {saved && error === null && <WireCallout tone="info" title="저장했습니다">서버가 받은 값으로 다시 읽었습니다.</WireCallout>}
    {plan === null && error === null && <WireEmpty live reserve>계획을 불러오고 있습니다.</WireEmpty>}
    {plan !== null && <>
      <WireDataRows>
        <WireDataRow label="일시" value={plan.scheduledAt} />
        <WireDataRow label="상담 유형" value={plan.sessionKind === 'intake' ? '인테이크' : '기본 상담'} />
        <WireDataRow label="상태" value={STATUS_LABELS[plan.status]} />
      </WireDataRows>
      {plan.customQuestions.length > 0 && <WireCardSection title="맞춤형 질문">
        {plan.customQuestions.map((question) => <WireItem key={question.id} title={question.body} />)}
      </WireCardSection>}
      <form className="business-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <WireFormField label="이번 상담의 목표" htmlFor="plan-goals" control="textarea"
          hint="한 줄에 하나씩 적습니다. 시작 시각이 지나면 서버가 수정을 막습니다">
          <textarea id="plan-goals" rows={5} value={draft ?? ''} disabled={busy}
            onChange={(event) => setDraft(event.target.value)} />
        </WireFormField>
        <div className="business-actions">
          <WireButton type="submit" variant="primary" disabled={busy}>목표 저장</WireButton>
        </div>
      </form>
      <div className="business-actions">
        <WireButton variant="neutral"
          href={`/participants/${encodeURIComponent(plan.beneficiaryId)}/programs/${encodeURIComponent(plan.supportCaseId)}/briefing`}>
          15초 페이지 보기
        </WireButton>
      </div>
    </>}
  </WireCard>;
}

export function BriefingScreen() {
  const session = useOutletContext<Session>();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.schedules.briefing(beneficiaryId, supportCaseId).then((value) => {
      if (own !== generation.current) return;
      setBriefing(value);
      setGoalDraft((current) => current ?? value.overallGoal ?? '');
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [beneficiaryId, supportCaseId, session.schedules, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const saveGoal = async () => {
    if (busy || briefing === null || goalDraft === null) return;
    setBusy(true);
    setError(null);
    try {
      await session.schedules.saveOverallGoal(supportCaseId, goalDraft.trim() === '' ? null : goalDraft.trim());
      setGoalDraft(null);
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && briefing === null) {
    return <WireCard>
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div>
    </WireCard>;
  }
  if (briefing === null) return <WireCard><WireEmpty live reserve>15초 페이지를 불러오고 있습니다.</WireEmpty></WireCard>;

  return <>
    <WireCard title={briefing.participant.name ?? briefing.beneficiaryId}>
      {error && <WireError>{error.message}</WireError>}
      {briefing.focus.confirmedFlags.length > 0 && <WireCallout tone="info" title="확인된 리스크"
        items={briefing.focus.confirmedFlags.map((flag) => `${FLAG_LABELS[flag.flagType] ?? flag.flagType}${flag.quote === null ? '' : `: ${flag.quote}`}`)} />}
      <WireCardSection title="전체 목표">
        {briefing.canEditOverallGoal
          ? <form className="business-form" onSubmit={(event) => { event.preventDefault(); void saveGoal(); }}>
            <WireFormField label="전체 목표" htmlFor="briefing-overall-goal" hideLabel>
              <input id="briefing-overall-goal" value={goalDraft ?? ''} disabled={busy}
                onChange={(event) => setGoalDraft(event.target.value)} />
            </WireFormField>
            <div className="business-actions">
              <WireButton type="submit" variant="primary" disabled={busy}>전체 목표 저장</WireButton>
            </div>
          </form>
          : <p className="wire-section-value">{briefing.overallGoal ?? '설정 전'}</p>}
        {briefing.activeGoals.map((goal) => <WireItem key={goal.id} title={goal.title} />)}
      </WireCardSection>
    </WireCard>
    <WireCard title="오늘 만나기 전 꼭 기억할 것">
      {briefing.upcoming !== null && <WireCardSection title="이번 상담의 목표와 질문">
        {briefing.upcoming.sessionGoals.map((goal, index) => <WireItem key={`goal-${index}`} title={goal.body}
          description={goal.caseGoalTitle ?? undefined} />)}
        {briefing.upcoming.customQuestions.map((question, index) => <WireItem key={`question-${index}`} title={question} />)}
        {briefing.upcoming.sessionGoals.length === 0 && briefing.upcoming.customQuestions.length === 0
          && <WireEmpty>이번 회차의 목표가 아직 없습니다.</WireEmpty>}
      </WireCardSection>}
      <WireCardSection title="AI 제안">
        {briefing.focus.aiSuggestions.length === 0 && <WireEmpty>승인된 기록에서 만든 제안이 없습니다.</WireEmpty>}
        {briefing.focus.aiSuggestions.map((suggestion, index) => <WireItem key={`suggestion-${index}`}
          title={suggestion.title} description={suggestion.reason}
          action={suggestion.sessionId === null ? undefined
            : <WireButton variant="neutral"
              href={`/participants/${encodeURIComponent(briefing.beneficiaryId)}/programs/${encodeURIComponent(briefing.focusSupportCaseId)}/records#record-${suggestion.sessionId}`}>
              근거 회차
            </WireButton>} />)}
      </WireCardSection>
    </WireCard>
    <WireCard title="상담 내용 회차별 정리">
      {briefing.focus.pendingReviewCount > 0 && <WireBadge tone="lavender">
        {`승인 대기 ${briefing.focus.pendingReviewCount}건`}
      </WireBadge>}
      {briefing.focus.sessionRows.length === 0 && <WireEmpty>아직 기록이 없습니다.</WireEmpty>}
      {briefing.focus.sessionRows.map((row) => <WireItem key={row.sessionId}
        title={row.aiOneLiner ?? row.memoExcerpt ?? '내용 없음'}
        description={`${row.heldAt}, ${row.kind === 'intake' ? '인테이크' : '기본 상담'}`}
        status={row.aiOneLiner === null ? <WireBadge tone="neutral">수기</WireBadge> : undefined} />)}
    </WireCard>
    <WireCard title="내용 불일치">
      {briefing.focus.discrepancies.length === 0 && <WireEmpty>검출된 불일치가 없습니다.</WireEmpty>}
      {briefing.focus.discrepancies.map((item) => <WireCardSection key={item.id} title={item.kind}>
        <WireDataRows>
          <WireDataRow label="한쪽 기록" value={item.left} />
          <WireDataRow label="다른 쪽 기록" value={item.right} />
          <WireDataRow label="처리" value={item.resolution ?? '처리 전'} />
        </WireDataRows>
      </WireCardSection>)}
      <WireCallout tone="info" title="처리 기능은 아직 없습니다">
        불일치 처리 3종은 이 화면에 연결하지 않았습니다. 지금은 저장된 검출 결과만 읽습니다.
      </WireCallout>
    </WireCard>
    <WireCard title="미해결 액션">
      {briefing.focus.openActionItems.length === 0 && <WireEmpty>미해결 액션이 없습니다.</WireEmpty>}
      {briefing.focus.openActionItems.map((item) => <WireItem key={item.id} title={item.description}
        description={`기한 ${item.dueDate ?? '없음'}`} />)}
    </WireCard>
  </>;
}
